// Retomar un recorrido interrumpido, y limpiar lo que dejo atras.
//
// POR QUE ESTE MODULO EXISTE. Un recorrido largo se interrumpe: se corta la luz,
// se cierra la terminal, se mata la sesion, se agota un presupuesto a mitad de
// un hito de doce historias. Es un hecho, no una excepcion. Sin esto, cada
// interrupcion cuesta el hito entero; con esto, cuesta un comando.
//
// LA LINEA QUE NO SE CRUZA. El estado en disco es la verdad, y retomar no
// regala presupuesto: una tarea que consumio tres intentos los conserva. Aca no
// se reinicia un contador, no se vuelve a correr una tarea integrada y no se
// pisa un arbol de trabajo con cambios sin commitear. Lo tercero es lo mas
// facil de romper y lo mas caro: un worktree sucio puede ser el UNICO lugar
// donde vive ese cambio, y "limpiarlo para poder seguir" no deja una tarea a
// medias — deja el trabajo perdido.
//
// POR QUE NO LO HACE EL DRIVER. El driver decide el siguiente paso mirando el
// estado; esto decide QUE ESTADO HAY cuando nadie cerro la puerta al salir. Son
// dos preguntas distintas, y mezclarlas produce la peor version de las dos: un
// driver que "arregla" lo que encuentra sin preguntarle a nadie.
//
// DIVISION DE TRABAJO: `diagnosticar` solo lee y enumera las decisiones que
// hacen falta; `prepararReanudacion` aplica las que se le pasan y no inventa
// ninguna; `destrabar` devuelve una tarea bloqueada al bucle registrando la
// decision, sin implementar nada; `limpiarHuerfanos` borra unicamente lo que no
// tiene nada que perder.
//
// LO QUE ESTE MODULO NO HACE: tomar el lock. Lo toma el comando que ejecuta el
// recorrido despues (`runItem`), y tomarlo aca lo dejaria afuera de su propio
// recorrido. Un lock huerfano de un proceso muerto ya lo recupera `lock.mjs`.
//
// PERO NO TOMARLO NO ES NO MIRARLO, y la distincion costo una medicion: con el
// driver corriendo de verdad en otro proceso, `prepararReanudacion` le movio una
// tarea de `in_progress` a `pending` por debajo mientras ese proceso estaba en
// su fase RED. Lo que sigue es lo peor de los dos mundos: la transicion del
// proceso vivo se rechaza por la guarda, su tarea queda en `pending`, y la
// vuelta siguiente del bucle la lanza OTRA VEZ. Dos veces la misma tarea es
// justo lo que el lock existe para no tener. Asi que todo lo que ESCRIBE en
// este modulo se niega cuando el lock lo tiene un proceso que sigue vivo.
//
// LO QUE ESTE MODULO NO PUEDE ARREGLAR SOLO, y queda dicho porque se midio: una
// tarea interrumpida en `green` o en `gated` no la retoma nadie. El unico
// estado desde el que el driver lanza una tarea es `pending` y el unico que
// camina solo es `queued`; rebobinar una de esas dos a `pending` haria
// re-verificar el rojo con la implementacion ya escrita al lado, que gasta el
// presupuesto de RED contra un rojo imposible y bloquea una tarea que estaba
// bien. Se informan en `sinRelanzar` y se anuncian en `advertencias`, y
// engancharlas es del cableado del driver — no de aca, que no puede correr ni
// el gate ni la revision.

import { existsSync, readdirSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import {
  loadRun, saveRun, listRuns, transition, setTaskFields, clearLastFailure,
  setActiveTask, listActiveTasks, clearActiveTask, traspasar, TRASPASABLES,
} from "./state.mjs";
// El mismo sobre de FR-034 que usa el cableado al cargar.
import { revisorComparteRuntime } from "../../adapters/src/index.mjs";
import { readySet, resumable } from "./scheduler.mjs";
import { inspect } from "./lock.mjs";
import { repoRoot } from "./repos.mjs";
import * as worktree from "./worktree.mjs";
import { comandosPermitidos } from "./wiring.mjs";

/**
 * Las tres salidas legitimas de una tarea que quedo a medias con su worktree
 * sucio. No hay una cuarta, y en particular no hay "seguir como si nada":
 *
 *   completar  — el trabajo sirve; la tarea sigue donde quedo y el driver la
 *                termina desde ahi.
 *   registrar  — queda constancia de por que quedo asi, con los archivos que
 *                habia sin commitear, y la tarea vuelve al bucle.
 *   bloquear   — la tarea se detiene con la causa real, y el recorrido sigue
 *                con las demas.
 */
export const DECISIONES = ["completar", "registrar", "bloquear"];

/** Los estados desde los que la maquina deja volver a `green` con una causa. */
const VUELVEN_A_GREEN = ["gated", "reviewed", "queued"];

/** Donde el driver crea los worktrees de las tareas. */
const dirWorktrees = (home) => join(home, "worktrees");

// ------------------------------------------------- el recorrido que esta vivo

/** Si el lock es de ESTE proceso. Un comando que ya lo tomo no se estorba. */
const esNuestro = (l) => l.pid === process.pid && l.host === hostname();

/**
 * El lock del recorrido, SOLO si lo tiene otro proceso que sigue vivo.
 *
 * Un lock huerfano —el pid ya no existe— devuelve null a proposito: es lo que
 * deja un corte de luz, y si bloqueara, un recorrido matado quedaria intocable
 * para siempre. Ese es el problema que el mecanismo del lock existe para no
 * tener, no uno que se pueda cambiar por este.
 */
function recorridoVivo(itemId, home) {
  const l = inspect(`run-${itemId}`, { home });
  if (!l || l.unreadable || !l.alive || esNuestro(l)) return null;
  return l;
}

const enCursoPorOtro = (l) =>
  `otro proceso esta recorriendo el item ahora mismo (pid ${l.pid} en ${l.host}, desde ${l.acquiredAt}): ` +
  `retomarlo por atras le moveria las tareas bajo los pies y terminaria corriendo dos veces la misma`;

// ------------------------------------------------------------ diagnostico

/**
 * El estado real de un recorrido, interrumpido o no. SOLO LECTURA.
 *
 * No escribe, no toca worktrees y no decide nada: si escribiera, dejaria de
 * poder correrse antes de decidir, que es justo para lo que sirve.
 *
 * @param {string} itemId
 * @param {{home: string, config?: object, repoPaths?: object|string[]}} opts
 *   `repoPaths` evita resolver los repositorios contra el remote declarado
 *   cuando el llamador ya sabe donde estan.
 */
export function diagnosticar(itemId, opts) {
  const { home, config = {} } = opts;

  const base = {
    item: itemId,
    existe: false,
    corrupto: false,
    error: null,
    // Un temporal que quedo al lado del recorrido es la pista de que el corte
    // fue a mitad de una escritura. El estado que se lee es el ANTERIOR, entero
    // — eso lo garantiza el temporal + rename de state.mjs — pero el resto
    // queda como evidencia de donde paso el corte.
    escriturasInterrumpidas: temporalesDe(home, itemId),
    integradas: [],
    bloqueadas: [],
    enVuelo: [],
    pendientes: [],
    listas: [],
    inalcanzables: [],
    decisionesPendientes: [],
    huerfanos: [],
    sinResolver: [],
    punteros: { vigentes: [], obsoletos: [], faltantes: [], huerfanos: [] },
    lock: inspect(`run-${itemId}`, { home }),
    // `lock` dice quien lo tomo; esto dice si hay que abstenerse. No es lo
    // mismo: un lock de un pid muerto esta ahi y no impide nada.
    enCurso: recorridoVivo(itemId, home),
    puedeSeguir: false,
    resumen: "",
  };

  let run = null;
  try {
    run = loadRun(itemId, { home });
  } catch (e) {
    // Un estado corrupto se REPORTA. Devolver un recorrido vacio seria peor que
    // el corte: el motor replanificaria encima de trabajo que existe.
    return {
      ...base,
      existe: true,
      corrupto: true,
      error: e.message,
      resumen: `el recorrido del item ${itemId} esta corrupto y no se puede retomar sin intervencion`,
    };
  }
  if (!run) {
    return { ...base, resumen: `no hay recorrido para el item ${itemId}` };
  }

  const enVuelo = resumable(run).map((id) => estadoDeTareaEnVuelo(run.tasks.find((t) => t.id === id)));
  // El ancho es el total de tareas a proposito: un diagnostico informa TODAS
  // las candidatas, no las que entrarian en el paralelismo configurado.
  const rs = readySet(run, { maxParallelTasks: run.tasks.length || 1 });

  const { mapa, sinResolver } = rutasDeRepos(run, opts, config);
  const { huerfanos, inseguro } = huerfanosDeWorktrees(home, mapa);
  const punteros = clasificarPunteros(home, itemId, run);

  const decisionesPendientes = enVuelo
    .filter((t) => t.requiereDecision)
    .map((t) => ({ task: t.task, opciones: t.opciones, porQue: t.porQue }));

  return {
    ...base,
    existe: true,
    integradas: run.tasks.filter((t) => t.status === "integrated").map((t) => t.id),
    bloqueadas: run.tasks
      .filter((t) => t.status === "blocked")
      .map((t) => ({ task: t.id, causa: t.lastFailure || "(sin causa registrada)", attempts: { ...t.attempts } })),
    enVuelo,
    pendientes: run.tasks.filter((t) => t.status === "pending").map((t) => t.id),
    listas: rs.ready,
    inalcanzables: rs.unreachable,
    decisionesPendientes,
    huerfanos,
    huerfanosInseguros: inseguro,
    sinResolver,
    punteros,
    puedeSeguir: decisionesPendientes.length === 0,
    resumen: resumir(itemId, run, enVuelo, decisionesPendientes, rs, base.enCurso),
  };
}

/**
 * Lo que hay que saber de una tarea que quedo en vuelo, y que decision admite.
 *
 * La regla: si su arbol esta limpio y su worktree existe, el driver puede
 * seguir solo —la maquina de estados se re-lee del disco en cada vuelta, asi
 * que retomar le sale gratis—. Lo que NO puede hacer solo es decidir sobre
 * cambios sin commitear ni sobre un worktree que ya no esta.
 */
function estadoDeTareaEnVuelo(t) {
  const worktreeExiste = Boolean(t.worktree) && existsSync(t.worktree);
  const cambios = worktreeExiste ? worktree.changes(t.worktree) : [];
  const sucio = cambios.length > 0;

  let requiereDecision = false;
  let opciones = [];
  let porQue = "";

  if (!worktreeExiste && !t.worktree && t.status === "in_progress" && !t.redVerified) {
    // CORTADA ANTES DE EMPEZAR: el driver la marco en vuelo y el proceso murio
    // antes de abrir su worktree. No hay trabajo que perder ni donde pudiera
    // estar, asi que se relanza sola desde `pending` —que es quien crea el
    // worktree— en vez de ofrecer solo `bloquear`, que dejaba sin salida una
    // tarea que no llego a hacer nada.
  } else if (!worktreeExiste) {
    requiereDecision = true;
    // No se ofrece `completar`: no hay nada que completar. Y no se ofrece
    // `registrar` porque dejaria la tarea en un estado del que el driver no
    // puede salir — el worktree solo se vuelve a crear pasando por `pending`.
    opciones = ["bloquear"];
    porQue = t.worktree
      ? `el worktree ${t.worktree} que la tarea declara ya no existe: el trabajo que hubiera ahi se perdio`
      : "la tarea quedo en vuelo sin worktree registrado, asi que no hay donde seguir";
  } else if (sucio) {
    requiereDecision = true;
    opciones = [...DECISIONES];
    porQue = `quedaron ${cambios.length} cambio(s) sin commitear en ${t.worktree}: pisarlos perderia el unico lugar donde viven`;
  }

  // Como sigue esta tarea si se retoma: la vuelve a lanzar el driver desde
  // `pending`, la toma la cola de integracion, o no la levanta nadie todavia.
  const relanzar = comoVolverAlBucle(t, cambios);

  return {
    task: t.id,
    status: t.status,
    attempts: { ...t.attempts },
    relanzarA: relanzar.a,
    motivoRelanzar: relanzar.motivo,
    redVerified: t.redVerified,
    worktree: t.worktree,
    worktreeExiste,
    sucio,
    cambios,
    lastFailure: t.lastFailure || null,
    requiereDecision,
    opciones,
    porQue,
  };
}

function resumir(itemId, run, enVuelo, decisionesPendientes, rs, enCurso) {
  const integradas = run.tasks.filter((t) => t.status === "integrated").length;
  const partes = [
    `item ${itemId}: ${integradas}/${run.tasks.length} integradas`,
    `${enVuelo.length} en vuelo`,
    `${rs.ready.length} listas`,
  ];
  // Primero lo que cambia que se pueda hacer algo: un recorrido vivo no se
  // retoma, y leer el resumen sin eso lleva a intentarlo.
  if (enCurso) partes.push(`EN CURSO en otro proceso (pid ${enCurso.pid})`);
  if (rs.unreachable.length) partes.push(`${rs.unreachable.length} inalcanzables`);
  if (decisionesPendientes.length) {
    partes.push(`${decisionesPendientes.length} decision(es) pendiente(s): ${decisionesPendientes.map((d) => d.task).join(", ")}`);
  }
  return partes.join("; ");
}

/**
 * Los punteros de tarea activa que hay en el home, clasificados. SOLO LECTURA.
 *
 * `faltantes` es el que importa al retomar: una tarea en vuelo cuyo puntero se
 * perdio va a correr sus fases sin que los hooks tengan contra que resolver.
 */
function clasificarPunteros(home, itemId, run) {
  const enVuelo = new Set(resumable(run));
  const vigentes = [];
  const obsoletos = [];
  const huerfanos = [];
  const ajenos = [];
  const punteros = listActiveTasks({ home });

  for (const p of punteros) {
    if (p.itemId === itemId) {
      if (enVuelo.has(p.taskId)) {
        vigentes.push(p);
      } else {
        obsoletos.push({
          ...p,
          motivo: run.tasks.some((t) => t.id === p.taskId)
            ? `la tarea ${p.taskId} ya no esta en vuelo (${run.tasks.find((t) => t.id === p.taskId).status})`
            : `la tarea ${p.taskId} no existe en el plan del item ${itemId}`,
        });
      }
      continue;
    }
    let otro = null;
    try {
      otro = loadRun(p.itemId, { home });
    } catch {
      // Ilegible no es ausente: no se declara huerfano lo que no se pudo leer.
      ajenos.push({ ...p, motivo: `el recorrido del item ${p.itemId} esta corrupto` });
      continue;
    }
    if (!otro) huerfanos.push({ ...p, motivo: `su recorrido (item ${p.itemId}) ya no existe` });
    else if (!otro.tasks.some((t) => t.id === p.taskId)) {
      huerfanos.push({ ...p, motivo: `la tarea ${p.taskId} no existe en el recorrido del item ${p.itemId}` });
    } else ajenos.push({ ...p, motivo: `es de otro recorrido vivo (item ${p.itemId})` });
  }

  const faltantes = [...enVuelo]
    .map((id) => run.tasks.find((t) => t.id === id))
    .filter((t) => t.worktree && existsSync(t.worktree))
    .filter((t) => !punteros.some((p) => p.itemId === itemId && p.taskId === t.id))
    .map((t) => ({ task: t.id, worktree: t.worktree }));

  return { vigentes, obsoletos, faltantes, huerfanos, ajenos };
}

/** Los temporales de escritura que quedaron junto al archivo del recorrido. */
function temporalesDe(home, itemId) {
  const dir = join(home, "runs");
  if (!home || !existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.startsWith(`run-${itemId}.json.tmp-`)).sort();
}

// -------------------------------------------------------- reanudacion

/**
 * Deja el recorrido en un estado desde el que el driver puede seguir.
 *
 * Lo que hace, y nada mas que esto:
 *   - se niega si el estado esta corrupto (nadie replanifica encima)
 *   - se niega si alguna tarea a medias exige una decision que no le dieron
 *   - aplica las decisiones EXPLICITAS que recibio, y las registra
 *   - repone el puntero de tarea activa de lo que sigue en vuelo, y borra el de
 *     lo que ya termino
 *
 * Lo que NO hace: tocar un contador de intentos, volver a correr una tarea
 * integrada, ni escribir nada si algo de lo anterior falla.
 *
 * @param {string} itemId
 * @param {{home: string, config?: object, decisiones?: Record<string, string|{accion: string, nota?: string}>}} opts
 */
export function prepararReanudacion(itemId, opts) {
  const { home, config = {}, decisiones = {} } = opts;
  const d = diagnosticar(itemId, opts);

  if (!d.existe) {
    return { ok: false, item: itemId, motivo: `no hay recorrido para el item ${itemId}`, diagnostico: d };
  }
  if (d.corrupto) {
    return {
      ok: false,
      item: itemId,
      motivo: `el recorrido del item ${itemId} esta corrupto: ${d.error}`,
      diagnostico: d,
    };
  }
  if (d.enCurso) {
    // Antes de la primera escritura, y antes incluso de validar las decisiones:
    // un recorrido vivo no se retoma por atras (FR-025, US4 escenario 5).
    return {
      ok: false,
      item: itemId,
      motivo: `no se puede retomar el item ${itemId}: ${enCursoPorOtro(d.enCurso)}`,
      enCurso: d.enCurso,
      diagnostico: d,
    };
  }

  const run = loadRun(itemId, { home });

  // TODA la validacion va antes de la primera escritura. Una reanudacion que
  // aplica media decision y falla en la otra deja un estado que nadie pidio.
  const pedidas = normalizarDecisiones(run, decisiones);

  const sinDecidir = d.decisionesPendientes.filter((p) => !pedidas.has(p.task));
  if (sinDecidir.length) {
    return {
      ok: false,
      item: itemId,
      motivo: `hay ${sinDecidir.length} tarea(s) a medias que exigen una decision`,
      requiereDecision: sinDecidir,
      diagnostico: d,
    };
  }

  const aplicadas = [];
  for (const [taskId, decision] of pedidas) {
    aplicadas.push(aplicarDecision(itemId, taskId, decision, { home, diagnostico: d }));
  }

  const { relanzadas, sinRelanzar } = volverAlBucle(itemId, { home });
  const punteros = ordenarPunteros(itemId, { home, config });
  const despues = diagnosticar(itemId, opts);

  // LO QUE SIGUE Y LO QUE NO, separados. `continua` es lo que un comando le
  // muestra a una persona para decirle que va a pasar cuando el recorrido
  // arranque, y solo hay dos mecanismos que levanten una tarea: el conjunto
  // listo —que excluye a proposito lo que esta en vuelo— y la cola, que solo
  // toma `queued`. Listar ahi una tarea que ninguno de los dos levanta
  // convierte un trabajo abandonado en un trabajo que parece encaminado.
  const laCola = despues.enVuelo.filter((t) => t.status === "queued").map((t) => t.task);
  const advertencias = sinRelanzar.map(
    (x) => `${x.task}: ningun mecanismo la levanta — ${x.motivo}`,
  );
  if (despues.sinResolver?.length) {
    advertencias.push(
      `no se pudo resolver el checkout de: ${despues.sinResolver.map((r) => r.repo).join(", ")}`,
    );
  }

  return {
    ok: true,
    item: itemId,
    aplicadas,
    relanzadas,
    sinRelanzar,
    advertencias,
    yaTerminadas: despues.integradas,
    bloqueadas: despues.bloqueadas.map((b) => b.task),
    continua: [...despues.listas, ...laCola],
    // La evidencia de que retomar no regalo presupuesto viaja en el resultado:
    // son los mismos contadores que habia antes de tocar nada.
    conserva: despues.enVuelo.map((t) => ({ task: t.task, attempts: t.attempts })),
    punteros,
    diagnostico: despues,
  };
}

/** @returns {Map<string, {accion: string, nota: string|null}>} */
function normalizarDecisiones(run, decisiones) {
  const salida = new Map();
  const enVuelo = new Set(resumable(run));
  for (const [taskId, cruda] of Object.entries(decisiones || {})) {
    const tarea = run.tasks.find((t) => t.id === taskId);
    if (!tarea) {
      throw new Error(`la tarea ${taskId} no existe en el recorrido del item ${run.item.id}`);
    }
    if (!enVuelo.has(taskId)) {
      // EL FALLO QUE EVITA. `blocked` es la unica transicion que la maquina
      // acepta desde cualquier estado —es una senial lateral, a proposito—, asi
      // que una decision mal tipeada sobre una tarea YA INTEGRADA la marcaba
      // como bloqueada. Su codigo sigue en la rama del item y en el PR: el
      // estado pasaba a mentir en la peor direccion, diciendo que falto lo que
      // ya entro. Una decision de reanudacion es sobre trabajo a medias, y
      // `${tarea.status}` no es trabajo a medias.
      throw new Error(
        `${taskId} no quedo a medias: esta en "${tarea.status}". Una decision de reanudacion solo aplica a una ` +
          `tarea en vuelo${tarea.status === "blocked" ? "; para una bloqueada, destrabar" : ""}`,
      );
    }
    const decision = typeof cruda === "string" ? { accion: cruda } : { ...cruda };
    if (!DECISIONES.includes(decision.accion)) {
      throw new Error(
        `"${decision.accion}" no es una decision valida para ${taskId} (${DECISIONES.join(", ")})`,
      );
    }
    const nota = (decision.nota || "").trim();
    if (decision.accion !== "completar" && !nota) {
      // Sin la nota no hay diagnostico, y una tarea bloqueada o retomada sin
      // decir por que es exactamente lo que este modulo existe para evitar.
      throw new Error(
        `${taskId}: la decision "${decision.accion}" exige la nota con la causa real (por que quedo asi)`,
      );
    }
    salida.set(taskId, { accion: decision.accion, nota: nota || null });
  }
  return salida;
}

function aplicarDecision(itemId, taskId, decision, { home, diagnostico }) {
  const enVuelo = diagnostico.enVuelo.find((t) => t.task === taskId);
  const tarea = loadRun(itemId, { home }).tasks.find((t) => t.id === taskId);
  const de = tarea.status;
  const cambios = enVuelo ? enVuelo.cambios : [];
  let a = de;

  if (decision.accion === "bloquear") {
    transition(loadRun(itemId, { home }), taskId, "blocked", { home, failure: decision.nota });
    a = "blocked";
    if (enVuelo && !enVuelo.worktreeExiste) {
      // El worktree ya no esta, asi que el puntero a esa ruta no apunta a nada.
      // Borrarlo es lo que permite que, cuando alguien destrabe la tarea, el
      // driver vuelva a crear el espacio de trabajo en vez de correr una fase
      // con `cwd` en un directorio inexistente. No se pierde nada que exista.
      setTaskFields(loadRun(itemId, { home }), taskId, { worktree: null, branch: null }, { home });
    }
  } else if (decision.accion === "registrar" && VUELVEN_A_GREEN.includes(de)) {
    // La evidencia del gate se midio sobre un arbol que ya no es el que hay.
    // Conservar ese verde seria arrastrar el veredicto de otro codigo — el
    // mismo motivo por el que un hallazgo del revisor la tira.
    transition(loadRun(itemId, { home }), taskId, "green", { home, failure: decision.nota });
    a = "green";
  }
  // `completar` no mueve el estado: es justamente la decision de que el driver
  // siga desde donde quedo.

  registrarDecision(itemId, { task: taskId, decision: decision.accion, nota: decision.nota, de, a, cambios }, { home });
  return { task: taskId, decision: decision.accion, nota: decision.nota, de, a, cambios };
}

/**
 * Devuelve al bucle lo que quedo en vuelo, cuando se puede hacer sin perder ni
 * repetir nada.
 *
 * POR QUE HACE FALTA. El unico estado desde el que el driver lanza una tarea es
 * `pending` (el conjunto listo excluye a proposito lo que esta en vuelo, para
 * no lanzar dos veces la misma tarea) y el unico que camina solo es `queued`
 * (la cola de integracion lo toma). Una tarea que quedo en `in_progress` no la
 * levanta nadie: el recorrido da dos vueltas sin avanzar y corta por estancado.
 *
 * POR QUE EL DESVIO POR `blocked`. La maquina de estados no tiene ninguna arista
 * hacia atras salvo `blocked -> pending|in_progress`, y eso es deliberado: todo
 * retroceso lleva una causa registrada y queda visible. Rebobinar por ahi es
 * usar la puerta que existe, no abrir una nueva — y los contadores de intentos
 * no se tocan, asi que el rebobinado no regala presupuesto.
 *
 * DONDE SE DETIENE, Y POR QUE. Una tarea que ya paso el gate no se rebobina: el
 * driver re-verifica el rojo al pasar por `in_progress`, y un test que ya tiene
 * su implementacion al lado PASA — el rebobinado gastaria el presupuesto de RED
 * contra un rojo imposible y terminaria bloqueando una tarea que estaba bien.
 * Esas se informan en `sinRelanzar`: las engancha el driver cuando se cablee su
 * propia reanudacion, y hasta entonces la decision es de quien mira el reporte.
 */
function volverAlBucle(itemId, { home }) {
  const relanzadas = [];
  const sinRelanzar = [];
  const run = loadRun(itemId, { home });

  for (const id of resumable(run)) {
    const t = run.tasks.find((x) => x.id === id);
    const como = comoVolverAlBucle(t);

    if (como.a === "encolar") {
      try {
        transition(loadRun(itemId, { home }), id, "queued", { home });
      } catch (e) {
        // La guarda de estado no deja encolar sin revision registrada, y aca no
        // se inventa una renuncia: eso lo declara un tier en configuracion y
        // queda a la vista. El contador ES la constancia de que la revision
        // ocurrio; pasarla por alto seria el verde inventado, otra vez.
        sinRelanzar.push({ task: id, status: t.status, motivo: e.message });
        continue;
      }
      registrarEn(itemId, "relanzadas", { task: id, de: t.status, a: "queued", causa: como.motivo }, { home });
      relanzadas.push({ task: id, de: t.status, a: "queued", attempts: { ...t.attempts } });
      continue;
    }

    if (como.a !== "pending") {
      if (como.a === null) sinRelanzar.push({ task: id, status: t.status, motivo: como.motivo });
      continue;
    }
    const causa = `el recorrido se interrumpio con la tarea en "${t.status}": vuelve al bucle sin perder sus ${suma(t.attempts)} intento(s) consumido(s)`;
    transition(loadRun(itemId, { home }), id, "blocked", { home, failure: causa });
    transition(loadRun(itemId, { home }), id, "pending", { home });
    // El bloqueo era el desvio, no un diagnostico: se consume para que el driver
    // no lo trate como algo pendiente de atender.
    clearLastFailure(loadRun(itemId, { home }), id, { home });
    registrarEn(itemId, "relanzadas", { task: id, de: t.status, a: "pending", causa }, { home });
    relanzadas.push({ task: id, de: t.status, a: "pending", attempts: { ...t.attempts } });
  }

  return { relanzadas, sinRelanzar };
}

/**
 * @param {object} t
 * @param {Array<{status: string, path: string}>} [cambios] lo que el arbol
 *   tiene sin commitear, si el llamador ya lo pregunto. Se pasa para no correr
 *   `git status` dos veces por tarea.
 * @returns {{a: "pending"|"encolar"|"cola"|null, motivo: string}}
 */
function comoVolverAlBucle(t, cambios) {
  if (t.status === "queued") {
    return { a: "cola", motivo: "la cola de integracion la toma en la vuelta siguiente" };
  }
  if (t.status === "reviewed") {
    // A esta tarea no le falta trabajo: le falta su TURNO. Encolarla es
    // exactamente lo que hace el driver desde `reviewed`, sin fase de por
    // medio. Sin esto, un corte entre la revision y el encolado dejaba una
    // tarea terminada y verificada fuera del PR — nadie levanta un `reviewed`.
    return { a: "encolar", motivo: "la revision ya ocurrio: lo unico que falta es su turno en la cola" };
  }
  if (t.status === "in_progress") {
    // No hay rojo verificado todavia, asi que la fase RED vuelve a correr igual
    // que si el driver la hubiera retomado: rebobinar no repite nada terminado.
    return { a: "pending", motivo: "la fase que se corto es la primera de la tarea" };
  }
  if (t.status === "red" && !implementacionEmpezada(t, cambios)) {
    // El test esta y la implementacion no: volver a pasar por RED da rojo otra
    // vez. Si la implementacion YA estuviera escrita (un corte a mitad de
    // GREEN), el rojo seria imposible.
    return { a: "pending", motivo: "el test ya esta y la implementacion todavia no" };
  }
  return {
    a: null,
    motivo: `quedo en "${t.status}", con trabajo ya verificado: rebobinarla a pending la haria re-verificar un rojo que ya no puede fallar`,
  };
}

/**
 * Si hay trabajo SIN COMMITEAR en los archivos que la tarea declara de destino.
 *
 * EL FALLO QUE EVITA, y es el caso normal de un repositorio que ya funciona: la
 * version anterior preguntaba si el archivo de destino EXISTIA. Casi ninguna
 * tarea crea su archivo desde cero —lo modifica—, asi que eso era siempre
 * cierto y toda tarea cortada en `red` se declaraba no relanzable. Medido con
 * un SIGKILL al empezar GREEN: la tarea se quedaba en `red` para siempre (el
 * conjunto listo excluye lo que esta en vuelo), el recorrido cortaba por
 * estancado, y el PR salio sin ella y sin la que dependia de ella.
 *
 * Al llegar a `red` el driver ya commiteo el test y todavia no la
 * implementacion, asi que "sin commitear en un archivo de destino" es
 * exactamente "GREEN alcanzo a escribir algo".
 */
function implementacionEmpezada(t, cambios) {
  if (!t.worktree || !existsSync(t.worktree)) return false;
  const objetivos = new Set(t.targetFiles || []);
  const sinCommitear = cambios || worktree.changes(t.worktree);
  return sinCommitear.some((c) => objetivos.has(c.path));
}

const suma = (attempts) => Object.values(attempts || {}).reduce((a, b) => a + b, 0);

/**
 * Pone al dia los punteros de tarea activa del recorrido.
 *
 * EL FALLO QUE EVITA. El puntero es lo unico contra lo que resuelven los hooks
 * de orden (test primero) y de alcance (solo los archivos declarados). Una
 * tarea retomada en `in_progress` nunca vuelve a pasar por `abrirTarea`, que es
 * quien escribe el puntero — asi que si nadie lo repone, sus fases corren sin
 * guardas justo en la vuelta donde el modelo ya tiene medio archivo escrito. Y
 * al reves: un puntero de una tarea que ya termino hace que, con dos punteros
 * en juego, el hook no pueda resolver cual le toca y se aparte.
 */
function ordenarPunteros(itemId, { home, config }) {
  const run = loadRun(itemId, { home });
  const enVuelo = new Set(resumable(run));
  const limpiados = [];
  const repuestos = [];

  for (const p of listActiveTasks({ home })) {
    if (p.itemId !== itemId) continue;
    if (enVuelo.has(p.taskId)) continue;
    clearActiveTask({ home, worktree: p.worktree });
    limpiados.push({ itemId: p.itemId, taskId: p.taskId, worktree: p.worktree });
  }

  const vigentes = listActiveTasks({ home });
  for (const id of enVuelo) {
    const t = run.tasks.find((x) => x.id === id);
    if (!t.worktree || !existsSync(t.worktree)) continue;
    if (vigentes.some((p) => p.itemId === itemId && p.taskId === id)) continue;
    setActiveTask(itemId, id, {
      home,
      worktree: t.worktree,
      // La lista viaja con el puntero porque el hook corre como proceso aparte,
      // con NOXLOOP_HOME y nada mas: no puede leer la configuracion.
      allowedCommands: comandosPermitidos(config.repos?.[t.repo]),
    });
    repuestos.push({ itemId, taskId: id, worktree: t.worktree });
  }

  return { limpiados, repuestos };
}

// ---------------------------------------------------------- destrabar

/**
 * Devuelve una tarea bloqueada al bucle, registrando la decision.
 *
 * NO IMPLEMENTA NADA: no toca el worktree, no commitea y no escribe una linea
 * de codigo. Si el hallazgo que la bloqueo exige codigo, lo escribe el ciclo
 * normal —con su test en rojo primero—, que es la unica forma en la que este
 * motor produce codigo.
 *
 * TAMPOCO REGALA PRESUPUESTO: los intentos consumidos quedan como estaban. Una
 * tarea destrabada que vuelve a fallar se bloquea antes, y eso es correcto: el
 * presupuesto mide lo que ya se gasto, no lo que queda de paciencia.
 *
 * @param {string} itemId
 * @param {string} taskId
 * @param {{home: string, nota?: string, volverA?: "pending"|"in_progress"}} opts
 */
export function destrabar(itemId, taskId, opts) {
  const { home, nota = null } = opts;
  const run = loadRun(itemId, { home });
  if (!run) throw new Error(`no hay recorrido para el item ${itemId}`);
  const t = run.tasks.find((x) => x.id === taskId);
  if (!t) throw new Error(`la tarea ${taskId} no existe en el recorrido del item ${itemId}`);

  // Destrabar ESCRIBE, asi que vale la misma abstencion que para retomar: no se
  // le mueve una tarea bajo los pies a un proceso que la esta trabajando.
  const vivo = recorridoVivo(itemId, home);
  if (vivo) throw new Error(`no se puede destrabar ${taskId}: ${enCursoPorOtro(vivo)}`);

  // POR QUE `pending` POR DEFECTO, Y NO `in_progress`. `pending` es el unico
  // estado desde el que el driver vuelve a pasar por `abrirTarea`, y
  // `abrirTarea` es quien reusa el worktree que ya existe y —sobre todo— vuelve
  // a escribir el puntero de tarea activa. Devolver la tarea directo a
  // `in_progress` la deja corriendo sus fases sin ese puntero, y sin puntero
  // los hooks de orden y de alcance no tienen contra que resolver: permiten
  // todo. `pending` no significa desde cero; el worktree y los intentos siguen
  // donde estaban.
  const destino = opts.volverA || "pending";
  if (!["pending", "in_progress"].includes(destino)) {
    throw new Error(
      `no se puede devolver ${taskId} a "${destino}": desde blocked solo se vuelve a "pending" o "in_progress"`,
    );
  }

  const nota_ = (nota || "").trim() || null;

  if (t.status !== "blocked") {
    if (t.status === destino && yaSeDestrabo(run, taskId, destino)) {
      // Idempotente: el mismo comando dos veces no duplica el registro ni mueve
      // nada. Un `unstick` se repite mas de lo que parece — se corre, se duda
      // de si corrio, se vuelve a correr.
      return { ok: true, idempotente: true, item: itemId, task: taskId, de: "blocked", a: destino, nota: nota_ };
    }
    throw new Error(
      `la tarea ${taskId} no esta bloqueada: esta en "${t.status}". Destrabar solo aplica a una tarea bloqueada.`,
    );
  }

  const bloqueoPrevio = t.lastFailure || null;
  transition(run, taskId, destino, { home });
  // `lastFailure` cumplia el papel de diagnostico del bloqueo; ya se atendio y
  // queda guardado en el registro. Si se dejara puesto, el driver volveria a
  // chocar con el mismo fallo sin que haya cambiado nada.
  clearLastFailure(loadRun(itemId, { home }), taskId, { home });
  registrarDecision(itemId, { task: taskId, decision: "destrabar", nota: nota_, de: "blocked", a: destino, bloqueoPrevio }, { home });

  const despues = loadRun(itemId, { home }).tasks.find((x) => x.id === taskId);
  return {
    ok: true,
    idempotente: false,
    item: itemId,
    task: taskId,
    de: "blocked",
    a: despues.status,
    nota: nota_,
    bloqueoPrevio,
    attempts: { ...despues.attempts },
  };
}

// ------------------------------------------------------------ hand-off

/**
 * Pasa una tarea a OTRO implementador (spec 005, US3, FR-007), o dice por que
 * no, con causa y accion. SOLO valida y registra: quien la sigue es el driver,
 * en el `resume` que viene despues (ver `comandos.mjs`).
 *
 * POR QUE AQUI Y NO EN EL SERVICIO. El servicio tambien lo comprueba —para
 * contestar el 409 antes de lanzar nada—, pero entre su pregunta y este
 * subproceso pueden pasar segundos, y el unico que puede afirmar el estado del
 * run en el instante de escribir es el motor que lo escribe. Las dos guardas
 * dicen lo mismo con el mismo codigo; esta es la que no se puede saltar.
 *
 * NO LANZA POR UN RECHAZO. Devuelve `{ok: false, codigo, causa, accion}`: es la
 * forma que el lanzador del servicio sabe explicar, y un rechazo no es un fallo
 * del motor — es un pedido que no tiene sentido ahora.
 *
 * @param {string} itemId
 * @param {string} taskId
 * @param {{home: string, runtime: string, agente?: string|null, nota?: string|null,
 *   de: string|null, revisor?: string|null, registrados: string[], budgets?: object}} opts
 *   `de` es el implementador EFECTIVO de la tarea hoy; `revisor`, el DECLARADO
 *   (sin revisor declarado la revision ya corre en el implementador del recorrido,
 *   y eso es un hueco que el cableado avisa, no un choque de este hand-off).
 */
export function pasarAOtroAgente(itemId, taskId, opts) {
  const { home } = opts;
  const no = (codigo, causa, accion) => ({ ok: false, item: itemId, task: taskId, codigo, causa, accion });

  const run = loadRun(itemId, { home });
  if (!run) return no("run_desconocido", `no hay recorrido para el item ${itemId}`, `planifica el item antes: \`noxloop plan ${itemId}\``);
  const t = run.tasks.find((x) => x.id === taskId);
  if (!t) {
    return no("tarea_desconocida", `la tarea ${taskId} no existe en el recorrido del item ${itemId}`,
      `mira las tareas del recorrido con \`noxloop status ${itemId}\``);
  }

  // PRIMERO lo que esta en vuelo: con otro proceso recorriendo el item, la
  // tarea puede estar a mitad de una fase, y cambiarle el implementador por
  // atras la dejaria con la fase de uno y el estado del otro.
  const vivo = recorridoVivo(itemId, home);
  if (vivo) {
    return no("fase_en_vuelo", `no se puede pasar ${taskId} a otro agente: ${enCursoPorOtro(vivo)}`,
      "Deten el run (o espera a que termine o se bloquee) y vuelve a pedir el hand-off.");
  }

  const runtime = String(opts.runtime || "").trim();
  if (!runtime || !opts.registrados.includes(runtime)) {
    return no("runtime_no_registrado",
      `el runtime "${runtime}" no esta registrado en el motor. Los que hay: ${opts.registrados.join(", ") || "ninguno"}`,
      "Elige uno de los runtimes registrados (Settings → Modelos dice cuales tienen sesion).");
  }
  if (opts.revisor && runtime === opts.revisor) {
    // FR-034 con el mismo sobre que el cableado: el revisor revisaria lo que
    // el mismo escribio.
    const e = revisorComparteRuntime(runtime, `revisor (${opts.revisor})`, `implementador de ${taskId} (${runtime})`);
    return no(e.codigo, e.causa, e.accion);
  }
  if (opts.de && runtime === opts.de) {
    return no("handoff_mismo_runtime",
      `${taskId} ya la implementa \`${runtime}\`: pasarsela a si mismo seria otro intento del mismo agente, sin decir por que`,
      `Si quieres que \`${runtime}\` lo intente de nuevo, destrabala con nota (\`noxloop unstick ${itemId} --task ${taskId} --nota "..."\`); ` +
        "si no, elige otro runtime.");
  }
  if (!TRASPASABLES.includes(t.status)) {
    return no("handoff_sin_implementacion",
      `${taskId} esta en "${t.status}": ya paso su GREEN con el gate verde (o esta integrada), y no le queda implementacion que pasar`,
      "Si lo que falla es la revision o la cola, mira el detalle del run; un hand-off solo cambia quien implementa.");
  }

  let r;
  try {
    r = traspasar(run, taskId, {
      runtime, agente: opts.agente ?? null, de: opts.de ?? null, motivo: opts.nota ?? null, budgets: opts.budgets,
    }, { home });
  } catch (e) {
    return no("handoff_rechazado", e.message, "Mira el estado de la tarea con `noxloop status` antes de repetirlo.");
  }
  registrarDecision(itemId, {
    task: taskId, decision: "handoff", nota: (opts.nota || "").trim() || null,
    de: r.de, a: r.a, estado: r.estado, retomarEn: r.retomarEn, presupuesto: r.presupuesto,
  }, { home });
  return { ok: true, item: itemId, task: taskId, ...r };
}

const yaSeDestrabo = (run, taskId, destino) =>
  (run.recovery?.decisiones || []).some((d) => d.task === taskId && d.decision === "destrabar" && d.a === destino);

/**
 * El registro de decisiones del recorrido.
 *
 * Vive en el recorrido y no en la tarea porque una decision de recuperacion no
 * es un campo de la tarea: es un hecho del recorrido, con su hora y su causa, y
 * el PR lo reporta. Y se escribe sobre el estado FRESCO del disco, no sobre la
 * copia del llamador, por el mismo motivo que todo lo demas en este motor: otra
 * tarea pudo escribir en el medio.
 */
function registrarDecision(itemId, entrada, opts) {
  return registrarEn(itemId, "decisiones", entrada, opts);
}

/**
 * `decisiones` guarda lo que alguien decidio; `relanzadas`, los rebobinados
 * mecanicos. Separados a proposito: mezclarlos haria que el reporte de un
 * recorrido no distinga una decision humana de un paso del motor.
 */
function registrarEn(itemId, campo, entrada, { home }) {
  const run = loadRun(itemId, { home });
  if (!run.recovery || typeof run.recovery !== "object") run.recovery = {};
  if (!Array.isArray(run.recovery[campo])) run.recovery[campo] = [];
  run.recovery[campo].push({ at: new Date().toISOString(), ...entrada });
  saveRun(run, { home });
  return run;
}

// ------------------------------------------------------ huerfanos

/**
 * Limpia lo que quedo de recorridos que ya no existen.
 *
 * CUATRO REGLAS, Y LAS CUATRO SON DEFENSIVAS:
 *
 *   1. Solo se considera lo que vive bajo `<home>/worktrees`. Un worktree fuera
 *      de ahi no lo creo el motor —es el de integracion, o el de una persona— y
 *      no es un huerfano: es de otro.
 *   2. Un worktree con cambios sin commitear NO se descarta sin `force`. Puede
 *      ser el unico lugar donde vive ese cambio.
 *   3. Con un recorrido corriendo en otro proceso no se limpia nada. El driver
 *      hace `git worktree add` y escribe la ruta en el estado DESPUES: entre las
 *      dos cosas, el worktree de una tarea viva no lo reclama nadie y parece un
 *      huerfano limpio. Medido: con el recorrido colgado dentro de esa ventana
 *      en otro proceso, esta limpieza le borro el espacio de trabajo a la tarea
 *      que el otro proceso estaba abriendo.
 *   4. Un remove que falla no se lleva el reporte. Sobre un worktree que git
 *      declara bloqueado (`git worktree lock`) el remove sale con error, y la
 *      excepcion se escapaba de aca: el llamador no recibia NADA, ni la lista de
 *      lo que la misma pasada ya habia borrado.
 *
 * @param {{home: string, config?: object, repoPath?: string, repoPaths?: object|string[], force?: boolean}} opts
 */
export function limpiarHuerfanos(opts) {
  const { home, force = false } = opts;
  const rutas = rutasDeReposPlanas(opts);
  const vivas = rutasVivas(home);
  const bajo = dirWorktrees(home);
  const enCurso = recorridosEnCurso(home);

  const limpiados = [];
  const conservados = [];
  const podados = [];

  // Por que se calcula una vez y no por worktree: es una razon para abstenerse
  // de la pasada entera, no una propiedad de cada arbol.
  const motivoParaAbstenerse = enCurso.length
    ? `hay ${enCurso.length} recorrido(s) corriendo en otro proceso (${enCurso.map((c) => `item ${c.item}, pid ${c.pid}`).join("; ")}): ` +
      `el worktree de una tarea recien abierta todavia no figura en el estado y no se distingue de un huerfano`
    : vivas.inseguro
      ? "hay un recorrido corrupto en el home: no se puede saber si este worktree es suyo"
      : null;

  for (const repoPath of rutas) {
    if (!existsSync(repoPath)) continue;
    const huerfanos = worktree.findOrphans(repoPath, vivas.rutas, { under: bajo });
    let hayQuePodar = false;

    for (const h of huerfanos) {
      if (motivoParaAbstenerse && !force) {
        // Un recorrido corrupto, o uno vivo, se atiende — no se limpia
        // alrededor.
        conservados.push({ ...h, motivo: motivoParaAbstenerse });
        continue;
      }
      if (h.locked) {
        // `git worktree lock` es alguien diciendo explicitamente que no se
        // toque, y ni `--force` alcanza (git pide dos). Aca no se sortea la
        // declaracion de nadie: se dice como sacarla.
        conservados.push({
          ...h,
          motivo: `git lo declara bloqueado (${h.locked}): se saca con \`git worktree unlock\`, y eso lo decide quien lo bloqueo`,
        });
        continue;
      }
      if (!h.exists || h.prunable) {
        // El directorio ya no esta: lo que queda es el registro de git, y para
        // eso no sirve `worktree remove` — sirve `prune`. Mientras el registro
        // queda sucio, `worktree add` se niega a reusar la ruta.
        podados.push(h.path);
        hayQuePodar = true;
        continue;
      }
      if (h.dirty && !force) {
        conservados.push({
          ...h,
          motivo: `tiene cambios sin commitear: con --force se descartan, y no hay vuelta atras`,
          cambios: worktree.changes(h.path),
        });
        continue;
      }
      try {
        worktree.remove(repoPath, h.path, { force: h.dirty });
        limpiados.push({ path: h.path, branch: h.branch, forzado: Boolean(h.dirty) });
      } catch (e) {
        // Se ensucio entre el diagnostico y el remove, o git se nego por un
        // motivo que no se previo. Las dos cosas fallan del lado seguro: el
        // arbol queda, y el reporte lo dice en vez de desaparecer.
        conservados.push({ ...h, motivo: `git no pudo quitarlo: ${e.message}` });
      }
    }

    // La poda es por repositorio: la hace una sola vez, y solo en el que tenia
    // un registro que sobraba.
    if (hayQuePodar) worktree.prune(repoPath);
  }

  return { limpiados, conservados, podados, repos: rutas, punteros: limpiarPunteros(home) };
}

/**
 * Los punteros de tarea activa que quedaron solos.
 *
 * EL FALLO QUE EVITA: el hook resuelve el puntero contra su recorrido. Uno que
 * apunta a un recorrido inexistente no se puede resolver, y con dos punteros en
 * juego —uno huerfano y uno valido— `activeTaskFull` no elige y devuelve null:
 * la guarda de orden y la de alcance se apartan justo cuando tenian que actuar.
 */
function limpiarPunteros(home) {
  const limpiados = [];
  const conservados = [];

  for (const p of listActiveTasks({ home })) {
    let run = null;
    try {
      run = loadRun(p.itemId, { home });
    } catch {
      // Un recorrido ilegible NO es un recorrido ausente. Borrar su puntero
      // seria decidir, con menos informacion que nadie, sobre una tarea que
      // quizas esta corriendo.
      conservados.push({ ...p, motivo: `el recorrido ${p.itemId} esta corrupto: se conserva hasta que alguien lo mire` });
      continue;
    }
    if (!run) {
      clearActiveTask({ home, worktree: p.worktree });
      limpiados.push({ ...p, motivo: `su recorrido (item ${p.itemId}) ya no existe` });
      continue;
    }
    if (!run.tasks.some((t) => t.id === p.taskId)) {
      clearActiveTask({ home, worktree: p.worktree });
      limpiados.push({ ...p, motivo: `la tarea ${p.taskId} no existe en el recorrido del item ${p.itemId}` });
      continue;
    }
    conservados.push({ ...p, motivo: "su recorrido y su tarea existen" });
  }

  return { limpiados, conservados };
}

/**
 * Los recorridos del home que otro proceso esta corriendo ahora mismo.
 *
 * Se pregunta por recorrido y no leyendo el directorio de locks porque el
 * nombre del recurso lo arma `runItem` y aca solo se conoce el del item: un
 * lock que no corresponda a ningun recorrido del home no dice nada sobre estos
 * worktrees.
 */
function recorridosEnCurso(home) {
  const salida = [];
  for (const run of listRuns({ home })) {
    const id = run?.item?.id;
    if (!id) continue;
    const l = recorridoVivo(id, home);
    if (l) salida.push({ item: id, pid: l.pid, host: l.host });
  }
  return salida;
}

/** Las rutas de worktree que algun recorrido del home declara en uso. */
function rutasVivas(home) {
  const rutas = [];
  let inseguro = false;
  for (const run of listRuns({ home })) {
    if (run.corrupto) {
      inseguro = true;
      continue;
    }
    for (const t of run.tasks || []) {
      if (t.worktree) rutas.push(t.worktree);
    }
  }
  return { rutas, inseguro };
}

function huerfanosDeWorktrees(home, mapa) {
  const vivas = rutasVivas(home);
  const bajo = dirWorktrees(home);
  const huerfanos = [];
  for (const [repo, ruta] of Object.entries(mapa)) {
    if (!ruta || !existsSync(ruta)) continue;
    for (const h of worktree.findOrphans(ruta, vivas.rutas, { under: bajo })) {
      huerfanos.push({ ...h, repo });
    }
  }
  return { huerfanos, inseguro: vivas.inseguro };
}

/** @returns {{mapa: Record<string, string>, sinResolver: Array<{repo: string, problema: string}>}} */
function rutasDeRepos(run, opts, config) {
  /** @type {Record<string, string>} */
  const mapa = {};
  /** @type {Array<{repo: string, problema: string}>} */
  const sinResolver = [];
  const declarados = new Set((run.tasks || []).map((t) => t.repo));

  if (Array.isArray(opts.repoPaths)) {
    opts.repoPaths.forEach((ruta, i) => { mapa[`repo-${i}`] = ruta; });
    return { mapa, sinResolver };
  }

  for (const repo of declarados) {
    const dado = opts.repoPaths?.[repo];
    if (dado) {
      mapa[repo] = dado;
      continue;
    }
    try {
      // Resolver verifica el remote: es lo que evita trabajar en el
      // repositorio equivocado porque un directorio dejo de corresponder.
      mapa[repo] = repoRoot(repo, config, opts);
    } catch (e) {
      sinResolver.push({ repo, problema: e.message });
    }
  }
  return { mapa, sinResolver };
}

function rutasDeReposPlanas(opts) {
  if (opts.repoPath) return [opts.repoPath];
  if (Array.isArray(opts.repoPaths)) return opts.repoPaths;
  if (opts.repoPaths && typeof opts.repoPaths === "object") return Object.values(opts.repoPaths);
  const config = opts.config || {};
  const rutas = [];
  for (const repo of Object.keys(config.repos || {})) {
    try {
      rutas.push(repoRoot(repo, config, opts));
    } catch {
      // Un repositorio que no se puede resolver no se limpia a ciegas: sin
      // saber cual es su checkout, no hay contra que preguntar los worktrees.
    }
  }
  return rutas;
}
