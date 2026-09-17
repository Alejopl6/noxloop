// Un espacio de trabajo aislado por tarea paralela.
//
// POR QUE UN WORKTREE Y NO UN CLON, NI EL CHECKOUT PRINCIPAL. El checkout
// principal puede tener trabajo de una persona, y un clon por tarea cuesta
// disco y tiempo de red. Un worktree comparte el objeto de git y aisla el arbol
// de trabajo, que es exactamente lo que hace falta.
//
// POR QUE EL AISLAMIENTO ES UN REQUISITO Y NO UNA COMODIDAD. Con dos tareas del
// mismo repositorio corriendo a la vez, un arbol compartido significa que el
// gate de una mide el codigo de la otra. El veredicto dejaria de significar
// nada, que es peor que no tener veredicto.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

function git(cwd, args, { permitirFallo = false } = {}) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (e) {
    if (permitirFallo) return null;
    const salida = `${e.stdout || ""}${e.stderr || ""}`.trim();
    throw new Error(`git ${args.join(" ")} fallo en ${cwd}:\n${salida}`);
  }
}

/**
 * Resuelve enlaces simbolicos sin fallar si la ruta no existe.
 *
 * EL FALLO QUE EVITA, y es el mismo que ya se midio en el puntero de tarea
 * activa: git informa SIEMPRE la ruta real de un worktree, y el estado guarda
 * la grafia con la que se creo. En macOS un temporal es /var/folders/... y su
 * ruta real es /private/var/folders/..., asi que comparando textos el worktree
 * de una tarea EN CURSO no aparecia en la lista de vivas — y la limpieza lo
 * veia limpio y lo borraba con la tarea trabajando adentro.
 */
function rutaReal(p) {
  if (!p) return p;
  try {
    return realpathSync(p);
  } catch {
    return p; // ya no existe: la grafia es lo mejor que hay
  }
}

const mismaRuta = (a, b) => Boolean(a) && Boolean(b) && (a === b || rutaReal(a) === rutaReal(b));

/** Dentro de, o igual a. Por segmento, para que `/wt` no matchee `/wtotro`. */
function dentroDe(ruta, base) {
  if (!ruta || !base) return false;
  const dentro = (x, y) => x === y || x.startsWith(y.endsWith("/") ? y : `${y}/`);
  return dentro(ruta, base) || dentro(rutaReal(ruta), rutaReal(base));
}

/**
 * @param {string} repoPath checkout principal
 * @param {{branch: string, base: string, dest: string, fetch?: boolean}} opts
 *   `base` va SIN el prefijo `origin/`: se antepone aca. Es un error que ya se
 *   cometio pasandolo de las dos formas segun el llamador.
 */
export function add(repoPath, opts) {
  const { branch, base, dest } = opts;
  if (existsSync(dest)) {
    const existente = list(repoPath).find((w) => mismaRuta(w.path, dest));
    if (existente) return { path: dest, branch: existente.branch, reused: true };
    throw new Error(`${dest} existe y no es un worktree de ${repoPath}`);
  }

  if (opts.fetch !== false) git(repoPath, ["fetch", "origin", base], { permitirFallo: true });

  const puntoBase = git(repoPath, ["rev-parse", "--verify", `origin/${base}`], { permitirFallo: true })
    ? `origin/${base}`
    : base;

  mkdirSync(join(dest, ".."), { recursive: true });

  const yaExiste = git(repoPath, ["rev-parse", "--verify", branch], { permitirFallo: true });
  if (yaExiste) {
    git(repoPath, ["worktree", "add", dest, branch]);
  } else {
    git(repoPath, ["worktree", "add", "-b", branch, dest, puntoBase]);
  }

  return { path: dest, branch, base: puntoBase, reused: false };
}

/**
 * El registro de worktrees del repositorio, tal como lo cuenta git.
 *
 * `exists` y `prunable` estan porque el registro y el disco pueden discrepar: si
 * alguien borro el directorio, el registro sigue apuntando ahi y `git worktree
 * remove` NO sirve para sacarlo (falla porque el arbol no esta). Distinguir los
 * dos casos es lo que permite podar el registro en vez de intentar un remove
 * que nunca va a andar — y mientras el registro queda sucio, `worktree add` se
 * niega a reusar esa ruta.
 *
 * @returns {Array<{path: string, head: string|null, branch: string|null, exists: boolean, prunable: string|null, locked: string|null}>}
 */
export function list(repoPath) {
  const salida = git(repoPath, ["worktree", "list", "--porcelain"], { permitirFallo: true }) || "";
  /** @type {Array<{path: string, head: string|null, branch: string|null, exists: boolean, prunable: string|null, locked: string|null}>} */
  const worktrees = [];
  /** @type {{path: string, head: string|null, branch: string|null, exists: boolean, prunable: string|null, locked: string|null} | null} */
  let actual = null;
  for (const linea of salida.split("\n")) {
    if (linea.startsWith("worktree ")) {
      if (actual) worktrees.push(actual);
      const ruta = linea.slice(9);
      actual = { path: ruta, head: null, branch: null, exists: existsSync(ruta), prunable: null, locked: null };
    } else if (linea.startsWith("HEAD ") && actual) {
      actual.head = linea.slice(5);
    } else if (linea.startsWith("branch ") && actual) {
      actual.branch = linea.slice(7).replace("refs/heads/", "");
    } else if (linea.startsWith("prunable") && actual) {
      // Viene con motivo (`prunable gitdir file points to non-existent location`)
      // o solo; en los dos casos lo que importa es que git ya lo declara podable.
      actual.prunable = linea.slice(8).trim() || "podable";
    } else if (linea.startsWith("locked") && actual) {
      actual.locked = linea.slice(6).trim() || "bloqueado";
    }
  }
  if (actual) worktrees.push(actual);
  return worktrees;
}

/**
 * QUE quedo sin commitear, no solo si quedo algo.
 *
 * Es lo que permite decir que se perderia al limpiar un worktree, en vez de
 * "tiene cambios": quien decide entre completar, registrar o bloquear necesita
 * ver los archivos, y el registro de la decision tiene que guardarlos.
 *
 * @returns {Array<{status: string, path: string}>} vacio si la ruta ya no esta
 */
export function changes(worktreePath) {
  // `-uall` y no el modo por defecto: git colapsa un directorio sin seguimiento
  // en una sola linea (`?? test/`), y el archivo que una tarea acababa de
  // escribir desaparecia del reporte justo cuando era lo unico que habia.
  const salida = git(worktreePath, ["status", "--porcelain", "-uall"], { permitirFallo: true });
  if (!salida) return [];
  return salida.split("\n").filter(Boolean).map((linea) => {
    const resto = linea.slice(3);
    // Un renombrado viene `R  viejo -> nuevo`: la ruta que importa es la nueva.
    const path = resto.includes(" -> ") ? resto.split(" -> ").pop() || resto : resto;
    return { status: linea.slice(0, 2).trim(), path };
  });
}

/** @returns {boolean} true si el arbol tiene cambios sin commitear */
export function isDirty(worktreePath) {
  const salida = git(worktreePath, ["status", "--porcelain"], { permitirFallo: true });
  return salida === null ? false : salida.length > 0;
}

/**
 * Quita un worktree. SIN `force` no descarta cambios sin commitear: un worktree
 * sucio puede ser una tarea a medias, y borrarla pierde el unico lugar donde
 * estaba ese trabajo.
 */
export function remove(repoPath, worktreePath, opts = {}) {
  if (!opts.force && isDirty(worktreePath)) {
    throw new Error(
      `${worktreePath} tiene cambios sin commitear. Decidi antes de quitarlo: completar, registrar por que quedo a medias, o bloquear la tarea. Con --force se descartan.`,
    );
  }
  git(repoPath, ["worktree", "remove", ...(opts.force ? ["--force"] : []), worktreePath]);
  return { removed: worktreePath };
}

/**
 * Worktrees que quedaron de recorridos que ya no existen.
 *
 * @param {string} repoPath
 * @param {string[]} rutasVivas las que el estado dice que estan en uso
 * @param {{under?: string}} [opts] `under` acota a un directorio: sirve para no
 *   considerar siquiera lo que el motor no creo —el worktree de integracion, o
 *   el de una persona—. Un worktree ajeno no es un huerfano, es de otro.
 * @returns {Array<{path: string, head: string|null, branch: string|null, exists: boolean, prunable: string|null, locked: string|null, dirty: boolean}>}
 */
export function findOrphans(repoPath, rutasVivas, opts = {}) {
  return list(repoPath)
    .filter((w) => !mismaRuta(w.path, repoPath))
    .filter((w) => !(rutasVivas || []).some((viva) => mismaRuta(viva, w.path)))
    .filter((w) => !opts.under || dentroDe(w.path, opts.under))
    // Un arbol que ya no esta en disco no puede estar sucio: preguntarlo daria
    // false de todos modos, pero por la razon equivocada (git falla), y ese
    // false es el que autorizaria un remove que no puede funcionar.
    .map((w) => ({ ...w, dirty: w.exists ? isDirty(w.path) : false }));
}

export function prune(repoPath) {
  git(repoPath, ["worktree", "prune"], { permitirFallo: true });
}
