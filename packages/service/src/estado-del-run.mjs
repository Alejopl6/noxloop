// En que esta un run, dicho con UNA palabra que el board, `/v1/runs` y el
// lanzador comparten.
//
// POR QUE UNA DERIVACION Y NO UN CAMPO. El estado de un run lo escriben dos
// sitios que no se hablan: el motor, en el archivo de estado (tareas, PR), y
// este servicio, en memoria (en cola, planificando, el fallo de un subproceso).
// Guardar una tercera version combinada seria un tercer escritor que se queda
// atras de los otros dos. Se deriva cada vez, con precedencia explicita.
//
// LA PRECEDENCIA, y el porque de cada escalon:
//
//   1. Lo que el servicio tiene EN VUELO (en cola, planificando, corriendo)
//      manda: el archivo de estado todavia no lo refleja, o refleja la vuelta
//      anterior.
//   2. Un PR abierto manda sobre todo lo que quede en disco: es el final del
//      recorrido (principio IV), aunque haya tareas bloqueadas —un PR con tres
//      bloqueadas y su diagnostico es un exito—. Con el termino `commit` el
//      final es la RAMA LISTA en el repositorio del operador, y manda igual.
//   3. Lo que el servicio sabe y el disco no: el plan que no se pudo hacer
//      (`necesita_criterios`, `fallido`) no deja archivo de run.
//   4. Un motor vivo de otra sesion (lock con pid vivo) esta corriendo.
//   5. Lo que dice el disco: bloqueado, plan sin empezar, o interrumpido.
//
// NO LEE NI ESCRIBE NADA: recibe el run y lo que el servicio sabe. Leer es de
// quien llama.

/** Los estados que ocupan un hueco de la cola del proyecto. */
export const EN_VUELO = Object.freeze(["planificando", "corriendo"]);

/** Los que esperan al operador: son los que cuenta «te necesitan». */
export const TE_NECESITAN = Object.freeze([
  "plan_listo",
  "necesita_criterios",
  "necesita_permiso",
  "bloqueado",
  "fallido",
  "interrumpido",
]);

/** Todos los estados que un run puede tener hacia fuera: el filtro de `/v1/runs` se valida contra esto. */
export const ESTADOS_DEL_RUN = Object.freeze([
  "en_cola",
  "planificando",
  "corriendo",
  "plan_listo",
  "necesita_criterios",
  "necesita_permiso",
  "bloqueado",
  "fallido",
  "interrumpido",
  "pr_abierto",
  // El final del termino `commit`: la rama del ticket, commiteada en el
  // repositorio del operador, sin empujar. Es a `commit` lo que `pr_abierto` a `pr`.
  "rama_lista",
  "terminado",
]);

/**
 * La accion que tiene sentido en cada estado. Es la MISMA para el board (el
 * boton de la tarjeta) y para el 409 de `run_sin_esa_accion` (lo que si se
 * puede hacer): dos tablas acabarian ofreciendo un boton que la ruta rechaza.
 *
 * @param {string|null} estado
 * @returns {"run"|"open_run"|"retry"|"approve"}
 */
export function accionDelEstado(estado) {
  if (estado === null) return "run";
  if (estado === "plan_listo") return "approve";
  if (["bloqueado", "fallido", "interrumpido", "necesita_criterios", "necesita_permiso"].includes(estado)) return "retry";
  return "open_run";
}

/** Estados de tarea en los que algo esta pasando. */
const TAREA_EN_VUELO = ["in_progress", "red", "green", "gated", "reviewed", "queued"];

/**
 * La fase que se esta haciendo, a partir del ULTIMO estado alcanzado por la
 * tarea. `red` quiere decir que el test ya se vio fallar, asi que lo que se
 * esta haciendo ahora es implementar; y asi con el resto.
 */
const FASE_POR_ESTADO = Object.freeze({
  in_progress: "Test",
  red: "Implementar",
  green: "Gate",
  gated: "Revisión",
  reviewed: "Revisión",
  queued: "Revisión",
});

/**
 * El gasto de un run, distinguiendo «sin medir» de cero (FR-028).
 *
 * El motor no guarda si el runtime mide gasto; lo que queda es la huella: un
 * run con invocaciones y cero dolares no fue gratis, corrio sobre un runtime
 * que no mide (el adaptador `fake` declara `cost: false`). Decir `0 USD` ahi
 * seria afirmar que fue gratis. Si algun dia el motor escribe `spent.medido`,
 * gana ese dato.
 *
 * @param {any} run
 */
export function gastoDe(run) {
  const usd = Number(run?.spent?.usd) || 0;
  const calls = Number(run?.spent?.calls) || 0;
  const medido = typeof run?.spent?.medido === "boolean" ? run.spent.medido : !(calls > 0 && usd === 0);
  return { usd, calls, medido };
}

/**
 * Tareas integradas sobre el total, y la fase de la primera en vuelo.
 *
 * @param {any} run
 * @param {string|null} estado
 */
export function avanceDe(run, estado) {
  if (estado === "planificando") return { hechas: 0, total: 0, fase: "Leer" };
  const tareas = Array.isArray(run?.tasks) ? run.tasks : [];
  if (!tareas.length) return null;
  const enVuelo = tareas.find((/** @type {any} */ t) => TAREA_EN_VUELO.includes(t?.status));
  return {
    hechas: tareas.filter((/** @type {any} */ t) => t?.status === "integrated").length,
    total: tareas.length,
    fase: enVuelo ? /** @type {any} */ (FASE_POR_ESTADO)[enVuelo.status] ?? null : null,
  };
}

/**
 * @param {any|null} run el archivo de estado del motor, o `null`
 * @param {{estado: string, detalle?: string|null, posicion?: number|null}|null} vivo lo que el servicio sabe
 * @param {{lockVivo?: boolean, permiso?: string|null}} [extra] `permiso`: la causa de una entrada de bandeja que pide un permiso para este run
 * @returns {{estado: string, detalle: string|null, posicion: number|null}|null} `null` si no hay run de ningun tipo
 */
export function estadoDelRun(run, vivo, extra = {}) {
  if (vivo && (vivo.estado === "en_cola" || EN_VUELO.includes(vivo.estado))) {
    return { estado: vivo.estado, detalle: vivo.detalle ?? null, posicion: vivo.posicion ?? null };
  }
  if (run?.item?.pr) return { estado: "pr_abierto", detalle: String(run.item.pr), posicion: null };
  if (run?.item?.ramaLista?.rama) return { estado: "rama_lista", detalle: String(run.item.ramaLista.rama), posicion: null };
  if (vivo && ["fallido", "necesita_criterios", "plan_listo"].includes(vivo.estado)) {
    return { estado: vivo.estado, detalle: vivo.detalle ?? null, posicion: null };
  }
  if (extra.lockVivo) return { estado: "corriendo", detalle: "lo esta corriendo un motor de otra sesion", posicion: null };
  // Una credencial sin grant detiene el run y deja una entrada en la bandeja.
  // Manda sobre lo que diga el disco: lo que resuelve es el permiso, y la causa
  // textual de la bandeja es la que el operador tiene que leer (FR-026).
  if (extra.permiso) return { estado: "necesita_permiso", detalle: extra.permiso, posicion: null };
  if (!run) return vivo ? { estado: vivo.estado, detalle: vivo.detalle ?? null, posicion: null } : null;

  const tareas = Array.isArray(run.tasks) ? run.tasks : [];
  const bloqueada = tareas.find((/** @type {any} */ t) => t?.status === "blocked");
  const hayEnVuelo = tareas.some((/** @type {any} */ t) => TAREA_EN_VUELO.includes(t?.status));
  if (bloqueada && !hayEnVuelo) {
    return {
      estado: "bloqueado",
      detalle: bloqueada.lastFailure ? String(bloqueada.lastFailure) : `la tarea ${bloqueada.id} quedo bloqueada sin causa escrita`,
      posicion: null,
    };
  }
  if (tareas.length && tareas.every((/** @type {any} */ t) => t?.status === "pending")) {
    return { estado: "plan_listo", detalle: null, posicion: null };
  }
  return {
    estado: "interrumpido",
    detalle: vivo?.detalle ?? "el run quedo a medias y no hay ningun motor corriendolo; se retoma desde el disco",
    posicion: null,
  };
}
