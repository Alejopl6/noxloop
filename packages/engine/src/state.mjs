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

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, readdirSync, unlinkSync, realpathSync } from "node:fs";
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
    // Lo que el plan dejo dicho y el PR tiene que repetir. Sin copiarlo aca,
    // `prBody` leeria un campo que en un recorrido de verdad nunca esta: el
    // mismo cable cortado, un nivel mas abajo.
    outOfScope: plan.outOfScope || [],
    serializedBecause: plan.serializedBecause ?? null,
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
      gateFingerprint: null,
      integratedAt: null,
    })),
    spent: { usd: 0, calls: 0 },
  };
  return saveRun(run, opts);
}

// ------------------------------------------------- lectura-modificacion-escritura

/**
 * Aplica una mutacion sobre el estado FRESCO del disco, no sobre la copia que
 * trajo el llamador.
 *
 * EL FALLO QUE EVITA, y es del paralelismo. Cada tarea que corre en paralelo
 * sostiene su propia referencia al recorrido entre `await`s. Sin esto, la
 * ultima en guardar borra lo que escribio la otra: se observo a una tarea
 * perder su worktree, volver a "pending", intentar crear el worktree de nuevo y
 * morir — con el error apareciendo en el lugar equivocado.
 *
 * Es seguro sin locks porque estas funciones son SINCRONAS: dentro de una
 * funcion sincrona no hay interleaving posible en Node, asi que leer, mutar y
 * escribir es atomico frente a cualquier otra tarea del mismo proceso. La
 * carrera venia de sostener el objeto ENTRE awaits, no de la escritura.
 *
 * Sin `home` no persiste nada y opera en memoria: es el modo que usan los tests
 * unitarios.
 */
function conEstadoFresco(run, opts, fn) {
  if (!opts || !opts.home) return fn(run);

  let fresco = null;
  try {
    fresco = loadRun(run.item.id, opts);
  } catch {
    fresco = null; // estado corrupto: se opera sobre lo que trajo el llamador
  }
  if (!fresco) fresco = run;

  // La mutacion va PRIMERO: si una guarda lanza, no se escribe nada.
  const resultado = fn(fresco);
  saveRun(fresco, opts);

  if (fresco !== run) {
    // El objeto del llamador queda al dia, incluida la parte que escribio otra
    // tarea mientras tanto.
    run.item = fresco.item;
    run.tasks = fresco.tasks;
    run.spent = fresco.spent;
    run.updatedAt = fresco.updatedAt;
    run.milestoneId = fresco.milestoneId;
  }
  return resultado;
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
 * @param {{home: string, evidence?: object, redVerified?: object, failure?: string, actor?: string, reviewWaived?: string}} opts
 */
export function transition(run, taskId, next, opts) {
  conEstadoFresco(run, opts, (fresco) => transicionar(fresco, taskId, next, opts));
  return run;
}

function transicionar(run, taskId, next, opts) {
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
    return;
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
    return;
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
    //
    // La UNICA salida es una renuncia explicita, que queda registrada y se
    // reporta en el PR. Un tier que declara `review: false` esta saltando la
    // revision en configuracion y a la vista — eso no es un salto silencioso,
    // que es lo que esta guarda existe para impedir.
    const renuncia = (opts.reviewWaived || "").trim();
    if (!renuncia) {
      throw new GuardError(`${taskId}: no se puede encolar sin revision (attempts.review esta en 0)`);
    }
    t.reviewWaived = renuncia;
  }

  if (next === "integrated" && opts.actor !== "merge-queue") {
    throw new GuardError(`${taskId}: solo la cola de integracion puede marcar integrated, despues de rebasar y volver a verificar`);
  }

  t.status = next;
  if (next === "integrated") t.integratedAt = new Date().toISOString();
}

/**
 * Consume un intento. Se llama EXPLICITAMENTE: un intento que no se registra no
 * existe, y una tarea que no registra puede iterar sin limite. Registrar es
 * parte del intento, no un reporte posterior.
 *
 * @returns {{count: number, exhausted: boolean, budget: number}}
 */
export function bump(run, taskId, loop, opts) {
  if (!LOOPS.includes(loop)) throw new Error(`"${loop}" no es un bucle conocido (${LOOPS.join(", ")})`);
  const budgets = { ...BUDGETS_DEFAULT, ...(opts.budgets || {}) };
  return conEstadoFresco(run, opts, (fresco) => {
    const t = tareaDe(fresco, taskId);
    t.attempts[loop] = (t.attempts[loop] || 0) + 1;
    return {
      count: t.attempts[loop],
      budget: budgets[loop],
      exhausted: t.attempts[loop] >= budgets[loop],
    };
  });
}

/**
 * Amplia el alcance de una tarea, con su motivo. Ampliar no esta prohibido; que
 * ocurra en silencio, si. El motivo se reporta en el PR.
 */
export function addTarget(run, taskId, path, why, opts = {}) {
  if (!why || !why.trim()) throw new GuardError(`ampliar el alcance con ${path} exige un motivo`);
  return conEstadoFresco(run, opts, (fresco) => {
    const t = tareaDe(fresco, taskId);
    if (!t.addedTargets.some((a) => a.path === path)) {
      t.addedTargets.push({ path, why: why.trim() });
    }
    if (!t.targetFiles.includes(path)) t.targetFiles.push(path);
    return t;
  });
}

/**
 * Limpia el fallo pendiente de una tarea, una vez que alguien lo atendio.
 *
 * `lastFailure` cumple dos papeles: es el diagnostico final de una tarea
 * bloqueada, y es la SENIA de que hay algo que arreglar cuando una tarea vuelve
 * a green —por un hallazgo del revisor o por un conflicto al rebasar—. El
 * segundo papel exige poder consumirlo: sin esto, el driver corre el gate, lo
 * ve pasar, y vuelve a chocar con el mismo hallazgo sin haber cambiado nada.
 */
export function clearLastFailure(run, taskId, opts = {}) {
  return conEstadoFresco(run, opts, (fresco) => {
    const t = tareaDe(fresco, taskId);
    const previo = t.lastFailure;
    t.lastFailure = null;
    return previo;
  });
}

/**
 * Anota el gasto de una invocacion en el recorrido.
 *
 * POR QUE HACE FALTA, y es un hueco que destapo el recorrido de un hito: el
 * techo de gasto por hito lee `run.spent.usd` para decidir si se detiene, y
 * NADA del motor lo escribia. El techo existia en la configuracion, en el
 * esquema y en el codigo que lo consulta, y no podia dispararse nunca — la peor
 * clase de limite, porque se lee como si estuviera puesto.
 *
 * Una invocacion que no informa costo cuenta igual como invocacion: un contador
 * que se queda en cero no es un contador, y el numero de invocaciones sigue
 * siendo un limite util cuando el costo no viene.
 *
 * @param {{usd?: number|null, calls?: number}} gasto
 * @param {{home?: string}} [opts]
 */
export function addSpend(run, gasto, opts = {}) {
  const usd = gasto.usd == null ? 0 : Number(gasto.usd);
  const calls = gasto.calls == null ? 0 : Number(gasto.calls);
  if (!Number.isFinite(usd) || usd < 0) {
    throw new GuardError(`el gasto no puede ser negativo ni no-numerico (llego ${gasto.usd}): el gasto solo sube`);
  }
  if (!Number.isFinite(calls) || calls < 0) {
    throw new GuardError(`las invocaciones no pueden ser negativas (llego ${gasto.calls})`);
  }
  return conEstadoFresco(run, opts, (fresco) => {
    fresco.spent = fresco.spent || { usd: 0, calls: 0 };
    fresco.spent.usd = Math.round((fresco.spent.usd + usd) * 1e6) / 1e6;
    fresco.spent.calls += calls;
    return fresco.spent;
  });
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
  conEstadoFresco(run, opts, (fresco) => Object.assign(fresco.item, fields));
  return run;
}

export function setTaskFields(run, taskId, fields, opts = {}) {
  // La lista es corta a proposito: lo que el driver puede escribir en una tarea
  // desde afuera es plomeria (donde corre, con que sesion) y nunca el estado ni
  // la evidencia, que solo se mueven por `transition`.
  //
  // `gateFingerprint` entra porque es diagnostico: la huella del ultimo fallo
  // del gate, que sirve para cortar cuando dos intentos producen exactamente lo
  // mismo. No decide si una tarea cumple.
  const PERMITIDOS = ["worktree", "branch", "sessionId", "providerItemId", "tier", "gateFingerprint"];
  for (const k of Object.keys(fields)) {
    if (!PERMITIDOS.includes(k)) {
      throw new GuardError(`"${k}" no se puede escribir en una tarea desde afuera (permitidos: ${PERMITIDOS.join(", ")})`);
    }
  }
  return conEstadoFresco(run, opts, (fresco) => Object.assign(tareaDe(fresco, taskId), fields));
}

// --------------------------------------------------------- tarea activa

// EL PUNTERO ES UNO POR WORKTREE, Y NO UNO GLOBAL.
//
// Es un requisito del paralelismo, no una comodidad: con N tareas corriendo a
// la vez, un puntero unico haria que el guardian de alcance de una bloquee los
// archivos de la otra, y que el guardian de orden mida el rojo de la tarea
// equivocada. El hook resuelve cual le toca por el worktree de donde viene la
// operacion.
//
// SE SIGUE ACEPTANDO un puntero sin worktree, para un recorrido serial: queda
// como entrada "_global" y se usa cuando es la unica activa.

const activeDir = (home) => join(home, "active-tasks");

function slugDeWorktree(worktree) {
  if (!worktree) return "_global";
  return worktree.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(-120) || "_raiz";
}

/**
 * @param {{home: string, worktree?: string, allowedCommands?: string[]}} opts
 *
 * `allowedCommands` viaja con el puntero porque el hook no tiene acceso a la
 * configuracion: corre como proceso aparte, con NOXLOOP_HOME y nada mas. Sin
 * esto, la guarda invertida no tendria contra que comparar y tendria que
 * adivinar — que es como se vuelve una lista de prohibidos otra vez.
 */
export function setActiveTask(itemId, taskId, opts) {
  mkdirSync(activeDir(opts.home), { recursive: true });
  escribirAtomico(join(activeDir(opts.home), `${slugDeWorktree(opts.worktree)}.json`), {
    itemId,
    taskId,
    worktree: opts.worktree || null,
    allowedCommands: opts.allowedCommands || null,
    since: new Date().toISOString(),
  });
}

/** @param {{home: string}} opts */
export function listActiveTasks(opts) {
  const dir = activeDir(opts.home);
  if (!existsSync(dir)) return [];
  const salida = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      salida.push(JSON.parse(readFileSync(join(dir, f), "utf8")));
    } catch {
      // Un puntero ilegible se ignora. Ante la duda, los hooks permiten: un
      // archivo corrupto no puede dejar a una persona sin poder trabajar.
    }
  }
  return salida;
}

/** @param {{home: string, worktree?: string}} opts */
export function clearActiveTask(opts) {
  const f = join(activeDir(opts.home), `${slugDeWorktree(opts.worktree)}.json`);
  if (existsSync(f)) unlinkSync(f);
}

/**
 * Resuelve enlaces simbolicos, sin fallar si la ruta no existe.
 *
 * EL FALLO QUE EVITA, medido en una sesion real: el home bajo /var/folders tiene
 * ruta real /private/var/folders en macOS. La sesion reportaba una grafia y el
 * puntero guardaba la otra, asi que con DOS tareas activas —donde no hay
 * respaldo de "la unica activa"— `activeTaskFull` devolvia null y la guarda
 * permitia todo. El hook se apartaba justo cuando tenia que actuar.
 */
function rutaReal(p) {
  if (!p) return p;
  try {
    return realpathSync(p);
  } catch {
    return p; // todavia no existe: se compara la grafia, que es lo mejor que hay
  }
}

/** Dentro de, o igual a. Por segmento, para que `/wt` no matchee `/wtotro`. */
function dentroDe(ruta, base) {
  if (!ruta || !base) return false;
  const a = rutaReal(ruta);
  const b = rutaReal(base);
  const dentro = (x, y) => x === y || x.startsWith(y.endsWith("/") ? y : `${y}/`);
  return dentro(a, b) || dentro(ruta, base);
}

/**
 * La tarea activa que corresponde a esta operacion, ya resuelta contra su
 * recorrido.
 *
 * @param {{home: string, cwd?: string, filePath?: string}} opts
 * @returns {{run: object, task: object, entry: object} | null}
 */
export function activeTaskFull(opts) {
  const entradas = listActiveTasks(opts);
  if (entradas.length === 0) return null;

  const conPista = entradas
    .filter((e) => e.worktree && (dentroDe(opts.filePath, e.worktree) || dentroDe(opts.cwd, e.worktree)))
    // El worktree mas especifico gana: con uno anidado dentro de otro, el
    // externo tambien matchea y elegirlo seria elegir la tarea equivocada.
    .sort((a, b) => b.worktree.length - a.worktree.length);

  // El respaldo a "la unica activa" aplica en dos casos, y no en un tercero:
  //
  //   SI  la unica activa no tiene worktree — es un recorrido serial, y el
  //       puntero vale para toda la sesion.
  //   SI  no vino ninguna pista — el evento del hook no trae cwd ni ruta, y
  //       negarse dejaria la guarda sin aplicar.
  //   NO  si vino una pista que NO cae dentro de su worktree. Eso significa que
  //       la operacion viene de otro lado —probablemente la sesion de una
  //       persona— y resolverla contra esta tarea haria que su guardian de
  //       alcance policie archivos ajenos. Sobre-resolver es sobre-bloquear.
  const hubopista = Boolean(opts.filePath || opts.cwd);
  const unica = entradas.length === 1 ? entradas[0] : null;
  const respaldo = unica && (!unica.worktree || !hubopista) ? unica : null;

  const elegida = conPista[0] || respaldo;
  // Con varias activas y sin pista de cual es, NO se adivina.
  if (!elegida) return null;

  let run;
  try {
    run = loadRun(elegida.itemId, opts);
  } catch {
    return null;
  }
  if (!run) return null;
  const task = run.tasks.find((t) => t.id === elegida.taskId);
  return task ? { run, task, entry: elegida } : null;
}

/** El puntero crudo, sin resolver el recorrido. */
export function getActiveTask(opts) {
  const resuelta = activeTaskFull(opts);
  return resuelta ? resuelta.entry : null;
}
