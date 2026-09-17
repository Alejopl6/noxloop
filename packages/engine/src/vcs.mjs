// Los commits de una tarea.
//
// DOS COMMITS POR TAREA, Y NO UNO. Uno para el test, otro para la
// implementacion, en ese orden. Es lo que hace que la promesa central del
// proyecto —el test existio y fallo antes del codigo— se pueda verificar SIN
// leer el motor:
//
//   git log --format='%h %s' --name-only <rama>
//
// Un commit unico por tarea, aunque sea mas prolijo de leer, borra exactamente
// la evidencia que hace creible al sistema.
//
// SE COMMITEAN SOLO LOS ARCHIVOS DECLARADOS. `git add -A` arrastraria al PR
// cualquier archivo suelto del worktree — un log, un dump, un artefacto de una
// corrida— y el alcance de la tarea vale tambien para el commit, no solo para
// el guardian de escrituras.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

function git(cwd, args, { permitirFallo = false } = {}) {
  try {
    return {
      ok: true,
      out: execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(),
    };
  } catch (e) {
    const out = `${e.stdout || ""}${e.stderr || ""}`.trim();
    if (!permitirFallo) throw new Error(`git ${args.join(" ")} fallo en ${cwd}:\n${out}`);
    return { ok: false, out };
  }
}

/** @returns {boolean} si el arbol tiene algo sin commitear */
export function hayCambios(worktree) {
  const r = git(worktree, ["status", "--porcelain"], { permitirFallo: true });
  return r.ok ? r.out.length > 0 : false;
}

/**
 * Commitea exactamente las rutas dadas.
 *
 * @param {string} worktree
 * @param {string[]} rutas relativas al repositorio
 * @param {string} mensaje
 * @returns {{committed: true, sha: string} | {committed: false, reason: string}}
 */
export function commitPaths(worktree, rutas, mensaje) {
  const existentes = rutas.filter((p) => existsSync(join(worktree, p)));
  if (existentes.length === 0) {
    return { committed: false, reason: "ninguna de las rutas declaradas existe en el worktree" };
  }

  git(worktree, ["add", "--", ...existentes]);

  // `diff --cached --quiet` sale 1 cuando HAY algo staged. Sin esta
  // comprobacion, una fase que no cambio nada produciria un commit vacio, y el
  // historial del PR diria que hubo trabajo donde no hubo.
  const staged = git(worktree, ["diff", "--cached", "--quiet"], { permitirFallo: true });
  if (staged.ok) {
    return { committed: false, reason: "no hay cambios en las rutas declaradas" };
  }

  git(worktree, ["commit", "-q", "-m", mensaje]);
  return { committed: true, sha: git(worktree, ["rev-parse", "HEAD"]).out };
}

// Un tier `trivial` no trae logica nueva por definicion —renombrar, mover,
// cambiar una constante— y llamarlo `feat` infla el historial.
const TIPO_POR_TIER = { trivial: "chore", small: "feat", medium: "feat", large: "feat" };

const MAX_ASUNTO = 72;

/**
 * El mensaje del commit de una fase, en Conventional Commits.
 *
 * Lleva el id de la tarea y el del ticket porque el PR de un ticket con ocho
 * tareas tiene dieciseis commits: sin esas dos referencias, el historial no se
 * puede leer.
 *
 * @param {"RED"|"GREEN"} fase
 */
export function mensajeDeFase(fase, task, item) {
  const tipo = fase === "RED" ? "test" : TIPO_POR_TIER[task.tier] || "feat";
  const ref = item.key || `#${item.id}`;
  const cola = ` (${task.id}, ${ref})`;
  const prefijo = `${tipo}(${task.repo}): `;

  const espacio = MAX_ASUNTO - prefijo.length - cola.length;
  let titulo = String(task.title || "").trim();
  if (titulo.length > espacio) titulo = `${titulo.slice(0, Math.max(1, espacio - 3))}...`;

  const cuerpo = fase === "RED"
    ? `El test del criterio, verificado en rojo antes de la implementacion.\n\nCriterio: ${task.acceptance || "(sin declarar)"}`
    : `Criterio: ${task.acceptance || "(sin declarar)"}`;

  return `${prefijo}${titulo}${cola}\n\n${cuerpo}\n`;
}
