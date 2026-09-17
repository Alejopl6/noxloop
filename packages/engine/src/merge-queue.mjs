// La cola de integracion: lo que hace que el paralelismo no produzca conflictos.
//
// EL FALLO QUE EVITA, medido. Un recorrido anterior ejecuto catorce tareas
// ramificando cada una de la anterior. Cuando las diez primeras se integraron,
// las tres siguientes llegaron en conflicto: la base se habia movido debajo de
// ellas. La correccion de entonces fue serializar todo en una sola rama — que
// resuelve el conflicto y elimina el paralelismo.
//
// Esta cola es lo que permite tener las dos cosas. Durante la ejecucion, cada
// tarea vive aislada en su worktree y no ve a las demas. Al terminar, entra a
// una cola SERIAL que hace, en este orden y sin excepcion:
//
//   1. rebasa la rama de la tarea sobre la punta ACTUAL de la rama del item
//   2. vuelve a correr el gate — sobre la base rebasada
//   3. integra con fast-forward, que por construccion no puede conflictuar
//
// EL ORDEN DE 1 Y 2 ES EL PUNTO. Un verde sobre una base vieja no dice nada
// sobre la base en la que el codigo va a vivir. Verificar antes del rebase es
// la version sofisticada de no verificar.
//
// UN RECHAZO NO CONTAMINA. Si el rebase conflictua o el gate falla, la tarea
// vuelve al bucle con la causa textual y la rama del item queda exactamente
// como estaba. El recorrido sigue con las demas.

import { execFileSync } from "node:child_process";
import { transition, saveRun } from "./state.mjs";
import { queuedTasks } from "./scheduler.mjs";
import { runGate as runGateReal } from "./gate.mjs";

function git(cwd, args, { permitirFallo = false } = {}) {
  try {
    return {
      ok: true,
      out: execFileSync("git", ["-C", cwd, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim(),
    };
  } catch (e) {
    const out = `${e.stdout || ""}${e.stderr || ""}`.trim();
    if (!permitirFallo) throw new Error(`git ${args.join(" ")} fallo en ${cwd}:\n${out}`);
    return { ok: false, out };
  }
}

/**
 * Procesa la cola de integracion de un recorrido, de a una tarea.
 *
 * @param {object} run
 * @param {{
 *   home: string,
 *   config: object,
 *   resolve: (repo: string) => {repoPath: string, integrationPath: string, itemBranch: string},
 *   runGate?: Function,
 *   log?: {info: Function, warn: Function}
 * }} opts
 * @returns {Promise<{integrated: string[], rejected: Array<{task: string, reason: string}>}>}
 */
export async function drain(run, opts) {
  const gate = opts.runGate || runGateReal;
  const log = opts.log || { info() {}, warn() {} };
  const integrated = [];
  const rejected = [];

  // Serial, y en orden topologico. Serial no es una limitacion que se vaya a
  // optimizar despues: es el mecanismo. Dos integraciones simultaneas sobre la
  // misma rama son el problema que esto resuelve.
  for (const taskId of queuedTasks(run)) {
    const task = run.tasks.find((t) => t.id === taskId);
    const { repoPath, integrationPath, itemBranch } = opts.resolve(task.repo);

    if (!task.worktree || !task.branch) {
      const motivo = `la tarea ${taskId} esta en la cola sin worktree ni rama: no hay nada que integrar`;
      transition(run, taskId, "blocked", { home: opts.home, failure: motivo });
      rejected.push({ task: taskId, reason: motivo });
      continue;
    }

    // --- 1. rebase sobre la punta ACTUAL
    log.info(`cola: rebasando ${task.branch} sobre ${itemBranch}`);
    const rebase = git(task.worktree, ["rebase", itemBranch], { permitirFallo: true });
    if (!rebase.ok) {
      // Abortar NO es opcional. Sin esto el worktree queda en medio de un
      // rebase y cada reintento posterior falla antes de empezar, con un error
      // que no tiene nada que ver con la causa real.
      git(task.worktree, ["rebase", "--abort"], { permitirFallo: true });
      const motivo = `conflicto al rebasar ${task.branch} sobre ${itemBranch}:\n${rebase.out}`;
      transition(run, taskId, "green", { home: opts.home, failure: motivo });
      rejected.push({ task: taskId, reason: motivo });
      log.warn(`cola: ${taskId} rechazada por conflicto`);
      continue;
    }

    // --- 2. el gate, DESPUES del rebase
    const veredicto = gate(task.repo, task.worktree, opts.config, { kind: "fast" });
    if (!veredicto.ok) {
      const motivo =
        `el gate fallo despues de rebasar sobre ${itemBranch} ` +
        `(exit ${veredicto.exitCode}${veredicto.timedOut ? ", TIMEOUT" : ""}):\n${veredicto.output}`;
      transition(run, taskId, "green", { home: opts.home, failure: motivo });
      rejected.push({ task: taskId, reason: motivo });
      log.warn(`cola: ${taskId} rechazada por el gate`);
      continue;
    }

    // --- 3. fast-forward, que por construccion no conflictua
    const ff = git(integrationPath, ["merge", "--ff-only", task.branch], { permitirFallo: true });
    if (!ff.ok) {
      // Si esto falla despues de un rebase limpio, la punta se movio entre el
      // rebase y el merge: otro proceso esta tocando la rama. No se fuerza —
      // se devuelve al bucle y la proxima vuelta rebasa sobre la punta nueva.
      const motivo = `no se pudo integrar ${task.branch} con fast-forward; la punta de ${itemBranch} se movio:\n${ff.out}`;
      transition(run, taskId, "green", { home: opts.home, failure: motivo });
      rejected.push({ task: taskId, reason: motivo });
      continue;
    }

    transition(run, taskId, "integrated", { home: opts.home, actor: "merge-queue" });
    integrated.push(taskId);
    log.info(`cola: ${taskId} integrada en ${itemBranch}`);
  }

  saveRun(run, { home: opts.home });
  return { integrated, rejected };
}

/**
 * Deja la rama del item al dia con su base, antes de empezar.
 *
 * Se hace al principio del recorrido y no al final: arrancar sobre una base
 * vieja significa que cada tarea va a rebasar contra algo que ya cambio, y el
 * conflicto aparece al integrar en vez de al empezar.
 */
export function syncItemBranch(integrationPath, itemBranch, baseBranch) {
  git(integrationPath, ["fetch", "origin", baseBranch], { permitirFallo: true });
  const actual = git(integrationPath, ["rev-parse", "--abbrev-ref", "HEAD"]).out;
  if (actual !== itemBranch) {
    throw new Error(`${integrationPath} esta en "${actual}", no en la rama del item "${itemBranch}"`);
  }
  const base = git(integrationPath, ["rev-parse", "--verify", `origin/${baseBranch}`], { permitirFallo: true }).ok
    ? `origin/${baseBranch}`
    : baseBranch;
  const r = git(integrationPath, ["rebase", base], { permitirFallo: true });
  if (!r.ok) {
    git(integrationPath, ["rebase", "--abort"], { permitirFallo: true });
    return { ok: false, reason: `la rama del item ${itemBranch} conflictua con ${base}:\n${r.out}` };
  }
  return { ok: true, base };
}
