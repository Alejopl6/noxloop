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
import { existsSync, mkdirSync } from "node:fs";
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
 * @param {string} repoPath checkout principal
 * @param {{branch: string, base: string, dest: string, fetch?: boolean}} opts
 *   `base` va SIN el prefijo `origin/`: se antepone aca. Es un error que ya se
 *   cometio pasandolo de las dos formas segun el llamador.
 */
export function add(repoPath, opts) {
  const { branch, base, dest } = opts;
  if (existsSync(dest)) {
    const existente = list(repoPath).find((w) => w.path === dest);
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

/** @returns {Array<{path: string, head: string|null, branch: string|null}>} */
export function list(repoPath) {
  const salida = git(repoPath, ["worktree", "list", "--porcelain"], { permitirFallo: true }) || "";
  /** @type {Array<{path: string, head: string|null, branch: string|null}>} */
  const worktrees = [];
  /** @type {{path: string, head: string|null, branch: string|null} | null} */
  let actual = null;
  for (const linea of salida.split("\n")) {
    if (linea.startsWith("worktree ")) {
      if (actual) worktrees.push(actual);
      actual = { path: linea.slice(9), head: null, branch: null };
    } else if (linea.startsWith("HEAD ") && actual) {
      actual.head = linea.slice(5);
    } else if (linea.startsWith("branch ") && actual) {
      actual.branch = linea.slice(7).replace("refs/heads/", "");
    }
  }
  if (actual) worktrees.push(actual);
  return worktrees;
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
 * @param {string[]} rutasVivas las que el estado dice que estan en uso
 */
export function findOrphans(repoPath, rutasVivas) {
  const vivas = new Set(rutasVivas);
  return list(repoPath)
    .filter((w) => w.path !== repoPath && !vivas.has(w.path))
    .map((w) => ({ ...w, dirty: isDirty(w.path) }));
}

export function prune(repoPath) {
  git(repoPath, ["worktree", "prune"], { permitirFallo: true });
}
