// El test primero en un runtime SIN hooks: la guarda que el motor aplica
// DESPUES de cada fase, sobre el worktree.
//
// EL HUECO QUE CIERRA. El principio I lo sostiene un hook `PreToolUse` que corre
// dentro del subproceso del runtime e intercepta cada escritura. Un runtime que
// declara `hooks: false` no tiene donde colgarlo, y hasta aqui no podia ser
// implementador: el servicio devolvia 409 `ejecutor_sin_soporte`.
//
// QUE HACE. Antes de la fase fotografia las ramas protegidas; despues lee el
// arbol entero (`git status`, con los archivos nuevos uno por uno) y compara
// contra lo que la fase podia tocar:
//
//   - RED:   solo los `testFiles`.
//   - GREEN: `targetFiles` ∪ `testFiles` ∪ lo ampliado con `noxloop add-target`.
//
// Lo que quedo fuera se REVIERTE a HEAD —lo modificado se restaura, lo borrado
// vuelve, lo nuevo se elimina— y la fase cuenta como fallida con la lista de
// rutas: el driver consume su intento y, agotado el presupuesto, bloquea la
// tarea con ese diagnostico. Si una rama protegida se movio, no se intenta
// arreglar: moverla de vuelta seria otra reescritura de historia. Se bloquea.
//
// POR QUE ES UNA GARANTIA EQUIVALENTE, Y EN QUE NO. El hook bloquea ANTES; esto
// deshace DESPUES. Para lo que el principio I protege basta:
//
//   1. el rojo lo sigue concediendo el motor CORRIENDO el test (exit code,
//      principio II) — esta guarda no concede nada, solo quita;
//   2. una fase RED que escribio produccion no llega a esa verificacion: falla
//      antes, y su produccion ya no esta en el arbol;
//   3. los commits de la tarea los hace el motor con rutas explicitas
//      (`vcs.mjs`), asi que lo revertido no puede colarse en el historial.
//
// Lo que NO da es el bloqueo en caliente: durante la fase el modelo pudo ver su
// propio codigo de produccion correr contra el test. Ese conocimiento no deja
// rastro en el PR, y el orden que el historial demuestra —test, rojo visto,
// implementacion— sigue siendo verdad.
//
// Y EL PRINCIPIO IV. El motor no mergea ni empuja en ninguna fase; la guarda
// de ramas es lo que hace que un runtime sin el hook de autonomia tampoco pueda
// hacerlo sin que se note: una rama base movida bloquea la tarea en el acto.
// Un empuje al remoto solo se ve si movio la rama de seguimiento local, y eso
// se mira tambien; uno que no deja rastro local queda fuera de lo que esta
// guarda puede afirmar, y se declara.

import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Lo que una fase puede tocar, o `null` si la fase no tiene guarda aqui.
 *
 * REVIEW y PLAN devuelven `null`: la revision corre en sandbox de solo lectura
 * en el runtime que la tenga, y ninguna de las dos cosas que escriba llega a un
 * commit —los commits del motor nombran sus rutas—.
 *
 * @param {string} fase
 * @param {any} t la tarea, releida del disco (por si se amplio durante la fase)
 * @returns {string[]|null}
 */
export function permitidosEnFase(fase, t) {
  const tests = [...(t?.testFiles || [])];
  if (fase === "RED") return tests;
  if (fase === "GREEN") {
    const ampliados = (t?.addedTargets || []).map((/** @type {any} */ a) => a.path);
    return [...new Set([...(t?.targetFiles || []), ...tests, ...ampliados])];
  }
  return null;
}

/**
 * Todas las rutas que difieren de HEAD, relativas a la raiz del worktree:
 * modificadas, borradas, renombradas (las dos puntas) y nuevas, estas una por
 * una aunque vivan en una carpeta nueva.
 *
 * `-z` y no la salida de lineas: una ruta con espacios o con comillas llega
 * entre comillas escapadas, y compararla contra la declarada fallaria.
 *
 * @param {string} worktree
 * @returns {string[]}
 */
export function cambiosDelArbol(worktree) {
  const crudo = git(worktree, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const trozos = crudo.split("\0");
  /** @type {Set<string>} */
  const rutas = new Set();
  for (let i = 0; i < trozos.length; i++) {
    const e = trozos[i];
    if (!e) continue;
    const xy = e.slice(0, 2);
    rutas.add(e.slice(3));
    // Un renombrado trae la ruta de ORIGEN en el trozo siguiente: tambien
    // cambio (desaparecio), y tambien tiene que estar permitida.
    if (xy.includes("R") || xy.includes("C")) rutas.add(trozos[++i]);
  }
  return [...rutas];
}

/**
 * Las rutas del cambio que la fase no podia tocar. Misma regla de coincidencia
 * que los hooks (`coincideRuta`): igualdad, o sufijo de carpeta.
 *
 * @param {string[]} cambios
 * @param {string[]} permitidos
 */
export function fueraDeAlcance(cambios, permitidos) {
  const limpias = permitidos.map((p) => String(p).replaceAll("\\", "/").replace(/^\.\//, ""));
  return cambios.filter((c) => !limpias.some((p) => c === p || c.endsWith(`/${p}`)));
}

/**
 * Devuelve cada ruta a como esta en HEAD: restaura la que HEAD tiene, elimina
 * la que HEAD no tiene. Tambien la saca del indice, por si la fase la agrego.
 *
 * @param {string} worktree
 * @param {string[]} rutas
 */
export function revertir(worktree, rutas) {
  for (const ruta of rutas) {
    let enHead = true;
    try {
      git(worktree, ["cat-file", "-e", `HEAD:${ruta}`]);
    } catch {
      enHead = false;
    }
    if (enHead) {
      git(worktree, ["restore", "--source=HEAD", "--staged", "--worktree", "--", ruta]);
    } else {
      try {
        git(worktree, ["rm", "-q", "--cached", "--ignore-unmatch", "--", ruta]);
      } catch { /* no estaba en el indice */ }
      rmSync(join(worktree, ruta), { force: true, recursive: true });
    }
  }
}

/**
 * La foto de las ramas protegidas: la local y cada rama de seguimiento remota
 * con ese nombre. Los refs son compartidos entre worktrees del mismo repo, asi
 * que da igual desde cual se mire.
 *
 * @param {string} worktree
 * @param {string[]} ramas
 * @returns {Record<string, string>} ref -> sha
 */
export function fotoDeRamas(worktree, ramas) {
  /** @type {Record<string, string>} */
  const foto = {};
  const nombres = new Set(ramas.filter(Boolean));
  if (!nombres.size) return foto;
  let crudo = "";
  try {
    crudo = git(worktree, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/remotes"]);
  } catch {
    return foto;
  }
  for (const linea of crudo.split("\n")) {
    const [ref, sha] = linea.trim().split(" ");
    if (!ref || !sha) continue;
    const corto = ref.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\/[^/]+\//, "");
    if (nombres.has(corto)) foto[ref] = sha;
  }
  return foto;
}

/**
 * La guarda entera, despues de la fase.
 *
 * @param {{fase: string, worktree: string, tarea: any, ramasAntes?: Record<string,string>|null, ramas?: string[]}} e
 * @returns {{ok: true} | {ok: false, revertidos: string[], ramasMovidas: string[], causa: string}}
 */
export function verificarAlcance(e) {
  const movidas = [];
  if (e.ramasAntes) {
    const despues = fotoDeRamas(e.worktree, e.ramas || []);
    for (const ref of new Set([...Object.keys(e.ramasAntes), ...Object.keys(despues)])) {
      if (e.ramasAntes[ref] !== despues[ref]) {
        movidas.push(`${ref} (${(e.ramasAntes[ref] || "no existia").slice(0, 10)} -> ${(despues[ref] || "borrada").slice(0, 10)})`);
      }
    }
  }

  const permitidos = permitidosEnFase(e.fase, e.tarea);
  const fuera = permitidos ? fueraDeAlcance(cambiosDelArbol(e.worktree), permitidos) : [];
  if (fuera.length) revertir(e.worktree, fuera);

  if (!fuera.length && !movidas.length) return { ok: true };

  const partes = [];
  if (movidas.length) {
    partes.push(
      `la fase ${e.fase} movio una rama protegida: ${movidas.join(", ")}. La autonomia termina en el PR abierto ` +
        "(principio IV) y el motor no la devuelve a su sitio —seria otra reescritura—: hace falta una persona.",
    );
  }
  if (fuera.length) {
    partes.push(
      `la fase ${e.fase} escribio fuera de lo que podia tocar (${(permitidos || []).join(", ") || "nada"}), y el ` +
        `motor lo dejo revertido a HEAD: ${fuera.join(", ")}. Este runtime no tiene hooks, asi que el orden del TDD lo fuerza ` +
        "el motor despues de la fase: lo revertido no entra en ningun commit y la fase cuenta como fallida.",
    );
  }
  return { ok: false, revertidos: fuera, ramasMovidas: movidas, causa: partes.join("\n") };
}
