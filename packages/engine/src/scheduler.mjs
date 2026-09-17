// Que corre AHORA.
//
// Es el unico lugar del motor que decide paralelismo, y es deliberadamente una
// funcion pura sobre el estado: recibe un recorrido, devuelve un conjunto. No
// lanza nada, no escribe nada, no recuerda nada.
//
// POR QUE NO RECUERDA NADA. Cachear el conjunto listo es exactamente como un
// scheduler lanza dos veces la misma tarea: entre el calculo y el lanzamiento
// el estado cambio, y el conjunto viejo ya no es cierto. Se recalcula desde el
// disco en cada vuelta. Es barato y es correcto.
//
// LA REGLA, ENTERA: una tarea corre si ninguna de sus dependencias DURAS esta
// sin integrar. No "sin terminar" — sin INTEGRAR. Un verde sobre una base que
// todavia no se integro no habilita a nadie a ramificar encima, y confundir
// esas dos cosas es el fallo que se midio: catorce ramas encadenadas, cada una
// sobre el trabajo no integrado de la anterior, y las tres ultimas en conflicto
// cuando las primeras entraron.

import { topoOrder } from "./plan.mjs";

/** Estados en los que una tarea ya no va a avanzar mas. */
const TERMINALES = ["integrated", "blocked"];

/** Estados en los que una tarea esta siendo trabajada ahora mismo. */
const EN_VUELO = ["in_progress", "red", "green", "gated", "reviewed", "queued"];

/**
 * @param {object} run
 * @param {{maxParallelTasks?: number, claimed?: string[]}} [opts]
 *   `claimed` son las que otro proceso ya tomo. Se pasan explicitamente en vez
 *   de deducirse del estado, porque entre reclamar y escribir el estado hay una
 *   ventana, y esa ventana es donde se duplica el trabajo.
 * @returns {{ready: string[], unreachable: string[], inFlight: number, capped: boolean, done: boolean, waiting: Record<string, string[]>}}
 */
export function readySet(run, opts = {}) {
  const ancho = opts.maxParallelTasks ?? 4;
  const reclamadas = new Set(opts.claimed || []);
  const tasks = run.tasks || [];
  const porId = new Map(tasks.map((t) => [t.id, t]));

  const enVuelo = tasks.filter((t) => EN_VUELO.includes(t.status));
  const inFlight = enVuelo.length;

  const inalcanzables = calcularInalcanzables(tasks, porId);
  const esInalcanzable = new Set(inalcanzables);

  /** @type {Record<string, string[]>} */
  const waiting = {};
  const candidatas = [];

  for (const t of tasks) {
    if (TERMINALES.includes(t.status)) continue;
    if (EN_VUELO.includes(t.status)) continue;
    if (reclamadas.has(t.id)) continue;
    if (esInalcanzable.has(t.id)) continue;

    const sinIntegrar = (t.dependencyKind === "hard" ? t.dependsOn || [] : []).filter((d) => {
      const dep = porId.get(d);
      return !dep || dep.status !== "integrated";
    });

    if (sinIntegrar.length) {
      waiting[t.id] = sinIntegrar;
      continue;
    }
    candidatas.push(t.id);
  }

  // El orden topologico decide a quien se le da el lugar cuando el ancho
  // recorta. Estable a proposito: dos recorridos del mismo plan tienen que
  // poder compararse.
  const orden = topoOrder(tasks);
  candidatas.sort((a, b) => orden.indexOf(a) - orden.indexOf(b));

  // El ancho cuenta las que YA corren. Un ancho que solo mira las nuevas no es
  // un ancho: es un minimo.
  const lugares = Math.max(0, ancho - inFlight - reclamadas.size);
  const ready = candidatas.slice(0, lugares);

  const abiertas = tasks.filter((t) => !TERMINALES.includes(t.status) && !esInalcanzable.has(t.id));

  return {
    ready,
    unreachable: inalcanzables,
    inFlight,
    capped: candidatas.length > ready.length,
    done: abiertas.length === 0,
    waiting,
  };
}

/**
 * Las que dependen —directa o transitivamente, y siempre por una arista DURA—
 * de una tarea bloqueada.
 *
 * Es una categoria aparte de `blocked` a proposito. Una tarea que fallo y una
 * que nunca pudo intentarse no son el mismo problema, y el reporte final solo
 * sirve si los distingue: la primera pide un diagnostico, la segunda pide
 * destrabar otra cosa.
 */
function calcularInalcanzables(tasks, porId) {
  const bloqueadas = new Set(tasks.filter((t) => t.status === "blocked").map((t) => t.id));
  if (bloqueadas.size === 0) return [];

  const inalcanzables = new Set();
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const t of tasks) {
      if (bloqueadas.has(t.id) || inalcanzables.has(t.id)) continue;
      if (t.status === "integrated") continue;
      if (t.dependencyKind !== "hard") continue; // la blanda no arrastra
      const arrastrada = (t.dependsOn || []).some((d) => bloqueadas.has(d) || inalcanzables.has(d));
      if (arrastrada) {
        inalcanzables.add(t.id);
        cambio = true;
      }
    }
  }
  return [...inalcanzables];
}

/**
 * Las tareas que quedaron en vuelo de un recorrido interrumpido.
 *
 * Se devuelven aparte de `ready` porque no son lo mismo: una tarea a medias con
 * su worktree sucio necesita una DECISION antes de seguir —completar, registrar
 * por que quedo asi, o bloquear— y meterla en el conjunto listo la pisaria.
 */
export function resumable(run) {
  return (run.tasks || []).filter((t) => EN_VUELO.includes(t.status)).map((t) => t.id);
}

/** Las que estan esperando integracion, en orden topologico: la cola. */
export function queuedTasks(run) {
  const orden = topoOrder(run.tasks || []);
  return (run.tasks || [])
    .filter((t) => t.status === "queued")
    .sort((a, b) => orden.indexOf(a.id) - orden.indexOf(b.id))
    .map((t) => t.id);
}
