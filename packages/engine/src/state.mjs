// El estado de un recorrido. Es la fuente de verdad; la conversacion no.
//
// POR QUE VIVE FUERA DE LOS REPOSITORIOS. Un ticket puede abarcar varios, y los
// hooks que corren dentro de uno tienen que ver la misma tarea activa que los
// que corren dentro de otro. Un `.noxloop/` por repositorio no puede dar eso.
//
// POR QUE LAS TRANSICIONES TIENEN GUARDA. Este archivo es el unico lugar del
// motor que puede escribir el estado de una tarea, y hay un test de constitucion
// que lo verifica buscando asignaciones a `.status` en el resto del fuente. La
// razon es el modo de fallo que el proyecto existe para matar: una tarea
// marcada como cumplida sin evidencia de que algo corrio. Aca eso no es una
// cuestion de disciplina del llamador — es un `throw`.

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export const LOOPS = ["red", "green", "gate", "review"];

/**
 * Intentos por bucle, por tarea. Son POR BUCLE y no globales: una tarea que
 * necesito tres intentos de GREEN todavia tiene sus tres de GATE. Agotado
 * cualquiera, la tarea se bloquea — nunca un bucle infinito, y nunca su gemelo
 * peor, el "lo di por bueno".
 */
export const BUDGETS_DEFAULT = { red: 2, green: 3, gate: 3, review: 2 };

export const STATUSES = [
  "pending",      // en el plan, sin empezar
  "in_progress",  // worktree listo, sin test todavia
  "red",          // el test existe y se VIO fallar
  "green",        // el test pasa
  "gated",        // el gate del repositorio dio exitCode 0
  "reviewed",     // revisada, sin hallazgos bloqueantes
  "queued",       // esperando su turno en la cola de integracion
  "integrated",   // integrada a la rama del ticket
  "blocked",      // presupuesto agotado, o dependencia imposible
];

// Las aristas permitidas. Todo lo que no este aca se rechaza, incluido
// retroceder: el unico retroceso legitimo es volver a GREEN, y lo producen dos
// cosas concretas — un hallazgo bloqueante del revisor, o un conflicto al
// rebasar en la cola.
const ADELANTE = {
  pending: ["in_progress"],
  in_progress: ["red"],
  red: ["green"],
  green: ["gated"],
  gated: ["reviewed"],
  reviewed: ["queued"],
  queued: ["integrated"],
  integrated: [],
  blocked: ["pending", "in_progress"], // destrabar explicitamente
};
const VUELVEN_A_GREEN = ["gated", "reviewed", "queued"];

export class GuardError extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = "GuardError";
  }
}

// --------------------------------------------------------------- rutas

const runsDir = (home) => join(home, "runs");
const runFile = (home, id) => join(runsDir(home), `run-${id}.json`);
const activeFile = (home) => join(home, "active-task");

// --------------------------------------------------- lectura y escritura

/**
 * Escritura atomica: temporal + rename. Un corte a mitad no deja el estado
 * corrupto, que es justo el momento en que mas falta hace poder retomar.
 */
function escribirAtomico(file, datos) {
  mkdirSync(join(file, "..").toString(), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(datos, null, 2) + "\n");
  renameSync(tmp, file);
}

/** @param {{home: string}} opts */
export function saveRun(run, opts) {
  run.updatedAt = new Date().toISOString();
  escribirAtomico(runFile(opts.home, run.item.id), run);
  return run;
}

/**
 * @param {string} itemId
 * @param {{home: string}} opts
 * @returns {object | null} null si no hay recorrido; LANZA si hay uno corrupto.
 */
export function loadRun(itemId, opts) {
  const file = runFile(opts.home, itemId);
  if (!existsSync(file)) return null;
  const crudo = readFileSync(file, "utf8");
  try {
    return JSON.parse(crudo);
  } catch (e) {
    // Un estado corrupto se REPORTA. Devolver un recorrido vacio seria peor que
    // el corte: el motor replanificaria encima de trabajo que existe.
    throw new Error(`el recorrido run-${itemId}.json esta corrupto y no se pudo parsear como JSON: ${e.message}`);
  }
}

/** @param {{home: string}} opts */
export function listRuns(opts) {
  const dir = runsDir(opts.home);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^run-.+\.json$/.test(f))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), "utf8"));
      } catch {
        return { item: { id: f.replace(/^run-|\.json$/g, "") }, corrupto: true, tasks: [] };
      }
    });
}

// ------------------------------------------------------------ creacion

/**
 * @param {object} plan validado con plan.mjs
 * @param {{home: string, milestoneId?: string}} opts
 */
export function createRun(plan, opts) {
  const existente = loadRun(plan.item.id, opts);
  if (existente) return existente; // idempotente: relanzar no pierde el avance

  const ahora = new Date().toISOString();
  const run = {
    schemaVersion: 1,
    milestoneId: opts.milestoneId || null,
    createdAt: ahora,
    updatedAt: ahora,
    item: {
      ...plan.item,
      branch: null,
      baseBranch: null,
      prTarget: null,
      pr: null,
      providerStateWritten: null,
      boardFields: plan.item.boardFields || null,
    },
    tasks: plan.tasks.map((t) => ({
      ...t,
      status: "pending",
      attempts: { red: 0, green: 0, gate: 0, review: 0 },
      redVerified: false,
      worktree: null,
      branch: null,
      sessionId: null,
      providerItemId: null,
      gateEvidence: null,
      addedTargets: [],
      lastFailure: null,
      integratedAt: null,
    })),
    spent: { usd: 0, calls: 0 },
  };
  return saveRun(run, opts);
}

// ---------------------------------------------------------- transiciones

function tareaDe(run, taskId) {
  const t = run.tasks.find((x) => x.id === taskId);
  if (!t) throw new Error(`la tarea ${taskId} no existe en el recorrido del item ${run.item.id}`);
  return t;
}

/**
 * @param {object} run
 * @param {string} taskId
 * @param {string} next
 * @param {{home: string, evidence?: object, redVerified?: object, failure?: string, actor?: string}} opts
 */
export function transition(run, taskId, next, opts) {
  const t = tareaDe(run, taskId);
  if (!STATUSES.includes(next)) throw new GuardError(`"${next}" no es un estado conocido`);
  const actual = t.status;

  if (next === "blocked") {
    const causa = (opts.failure || "").trim();
    // Una tarea bloqueada con un diagnostico honesto vale mas que diez
    // iteraciones que terminan en un cambio que nadie entiende. Sin causa, no
    // hay diagnostico.
    if (!causa) throw new GuardError(`${taskId}: bloquear exige la causa real del fallo`);
    t.status = "blocked";
    t.lastFailure = causa;
    return saveRun(run, opts);
  }

  if (next === "green" && VUELVEN_A_GREEN.includes(actual)) {
    const causa = (opts.failure || "").trim();
    if (!causa) throw new GuardError(`${taskId}: volver a green exige decir por que (hallazgo del revisor, conflicto al rebasar)`);
    t.status = "green";
    t.lastFailure = causa;
    // La evidencia del gate era de OTRO codigo: el de antes del cambio que
    // viene. Conservarla seria arrastrar un verde que ya no corresponde.
    t.gateEvidence = null;
    // redVerified NO se pierde: el test sigue existiendo y sigue habiendo
    // fallado alguna vez contra el codigo viejo.
    return saveRun(run, opts);
  }

  if (!(ADELANTE[actual] || []).includes(next)) {
    throw new GuardError(`${taskId}: no se puede pasar de "${actual}" a "${next}"`);
  }

  if (next === "red") {
    const ev = opts.redVerified;
    if (!ev || typeof ev.exitCode !== "number") {
      throw new GuardError(`${taskId}: marcar red exige la evidencia de la corrida del test que fallo`);
    }
    if (ev.exitCode === 0) {
      throw new GuardError(
        `${taskId}: el test paso (exit code 0) sin el cambio, asi que no prueba nada. Reescribilo hasta que falle por la razon correcta.`,
      );
    }
    t.redVerified = true;
  }

  if (next === "gated") {
    const ev = opts.evidence;
    if (!ev || typeof ev.exitCode !== "number") {
      throw new GuardError(`${taskId}: sin el objeto del gate no hay veredicto. "se ve bien" no es evidencia.`);
    }
    if (ev.exitCode !== 0) {
      throw new GuardError(`${taskId}: el gate salio con exit code ${ev.exitCode}; eso no es verde`);
    }
    t.gateEvidence = { ...ev, ranAt: ev.ranAt || new Date().toISOString() };
  }

  if (next === "queued" && (t.attempts.review || 0) === 0) {
    // El contador ES la constancia de que la revision ocurrio. Dejarlo en cero
    // equivale a no haberla hecho, y ya paso: tareas que cerraron con los
    // cuatro contadores en cero y su codigo entro al PR sin filtro.
    throw new GuardError(`${taskId}: no se puede encolar sin revision (attempts.review esta en 0)`);
  }

  if (next === "integrated" && opts.actor !== "merge-queue") {
    throw new GuardError(`${taskId}: solo la cola de integracion puede marcar integrated, despues de rebasar y volver a verificar`);
  }

  t.status = next;
  if (next === "integrated") t.integratedAt = new Date().toISOString();
  return saveRun(run, opts);
}

/**
 * Consume un intento. Se llama EXPLICITAMENTE: un intento que no se registra no
 * existe, y una tarea que no registra puede iterar sin limite. Registrar es
 * parte del intento, no un reporte posterior.
 *
 * @returns {{count: number, exhausted: boolean, budget: number}}
 */
export function bump(run, taskId, loop, opts) {
  const t = tareaDe(run, taskId);
  if (!LOOPS.includes(loop)) throw new Error(`"${loop}" no es un bucle conocido (${LOOPS.join(", ")})`);
  const budgets = { ...BUDGETS_DEFAULT, ...(opts.budgets || {}) };
  t.attempts[loop] = (t.attempts[loop] || 0) + 1;
  const home = opts.home;
  if (home) saveRun(run, { home });
  return {
    count: t.attempts[loop],
    budget: budgets[loop],
    exhausted: t.attempts[loop] >= budgets[loop],
  };
}

/**
 * Amplia el alcance de una tarea, con su motivo. Ampliar no esta prohibido; que
 * ocurra en silencio, si. El motivo se reporta en el PR.
 */
export function addTarget(run, taskId, path, why) {
  const t = tareaDe(run, taskId);
  if (!why || !why.trim()) throw new GuardError(`ampliar el alcance con ${path} exige un motivo`);
  if (!t.addedTargets.some((a) => a.path === path)) {
    t.addedTargets.push({ path, why: why.trim() });
  }
  if (!t.targetFiles.includes(path)) t.targetFiles.push(path);
  return t;
}

const CAMPOS_ITEM = ["branch", "baseBranch", "prTarget", "pr", "providerStateWritten", "boardFields"];

/**
 * Los unicos campos del item que el recorrido puede escribir. `id` no esta:
 * indexa el archivo del recorrido, y cambiarlo lo moveria bajo los pies del
 * comando que lo esta escribiendo.
 */
export function setItemFields(run, fields, opts = {}) {
  for (const k of Object.keys(fields)) {
    if (!CAMPOS_ITEM.includes(k)) {
      throw new GuardError(`"${k}" no es un campo escribible del item (permitidos: ${CAMPOS_ITEM.join(", ")})`);
    }
  }
  Object.assign(run.item, fields);
  const home = opts.home;
  if (home) saveRun(run, { home });
  return run;
}

export function setTaskFields(run, taskId, fields, opts = {}) {
  const PERMITIDOS = ["worktree", "branch", "sessionId", "providerItemId", "tier"];
  const t = tareaDe(run, taskId);
  for (const k of Object.keys(fields)) {
    if (!PERMITIDOS.includes(k)) {
      throw new GuardError(`"${k}" no se puede escribir en una tarea desde afuera (permitidos: ${PERMITIDOS.join(", ")})`);
    }
  }
  Object.assign(t, fields);
  const home = opts.home;
  if (home) saveRun(run, { home });
  return t;
}

// --------------------------------------------------------- tarea activa

/**
 * El puntero que leen los hooks. Es lo que les permite saber, desde dentro de
 * cualquier repositorio, cual es la tarea en curso y que puede tocar.
 */
export function setActiveTask(itemId, taskId, opts) {
  mkdirSync(opts.home, { recursive: true });
  escribirAtomico(activeFile(opts.home), { itemId, taskId, since: new Date().toISOString() });
}

export function getActiveTask(opts) {
  const f = activeFile(opts.home);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    // Ante la duda, los hooks permiten. Un puntero ilegible no puede dejar a
    // una persona sin poder trabajar.
    return null;
  }
}

export function clearActiveTask(opts) {
  const f = activeFile(opts.home);
  if (existsSync(f)) unlinkSync(f);
}

/** La tarea activa ya resuelta contra su recorrido, o null. */
export function activeTaskFull(opts) {
  const puntero = getActiveTask(opts);
  if (!puntero) return null;
  let run;
  try {
    run = loadRun(puntero.itemId, opts);
  } catch {
    return null;
  }
  if (!run) return null;
  const task = run.tasks.find((t) => t.id === puntero.taskId);
  return task ? { run, task } : null;
}
