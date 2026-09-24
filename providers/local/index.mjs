// El gestor de tareas LOCAL (spec 003, FR-030): las tareas que el operador crea
// en noxloop, sin Linear ni GitHub Issues. Es un gestor mas (principio VI): el
// motor lo usa por el mismo contrato que a los demas y no sabe que es local.
//
// -----------------------------------------------------------------------------
// EL UNICO ESCRITOR ES EL SERVICIO (principio VIII), Y ESO DECIDE LA FORMA
// -----------------------------------------------------------------------------
//
// Las tareas viven en el almacen del servicio. Este proveedor NO abre la base
// ni escribe un archivo: habla con una interfaz de cuatro verbos —obtener,
// listar, cambiarEstado, comentar— que le llega de uno de dos sitios:
//
//   1. `ctx.tareas`, inyectada por el servicio cuando el proveedor corre DENTRO
//      del servicio (el board lista las tareas). Es el almacen, a traves del
//      servicio.
//   2. Si no hay interfaz inyectada, el propio servicio por HTTP, con la URL y
//      el token de sesion que el lanzador pone en el entorno del motor
//      (`NOXLOOP_SERVICE_URL`, `NOXLOOP_SERVICE_TOKEN`). Es el caso del motor,
//      que corre como subproceso y NO PUEDE tocar el almacen: si lo abriera,
//      serian dos escritores con dos pids y la guarda de uno no veria lo que
//      hizo el otro.
//
// Por que HTTP y no un archivo de intercambio: el servicio ya tiene rutas con
// validacion, token y formato de error unico. Un archivo seria un segundo
// canal de escritura sin ninguna de esas tres cosas, y alguien tendria que
// sincronizarlo con el almacen — el tercer escritor que el principio VIII
// prohibe.
//
// El token viaja en el ENTORNO del subproceso (nunca en argv, principio IX) y
// en la cabecera `x-noxloop-token` (nunca en la URL: una URL acaba en un log).

import { CANONICAL_STATES, listQuery } from "../contract.mjs";

export const meta = { name: "local", version: "1.0.0" };

/**
 * Lo que el proveedor necesita del entorno cuando corre dentro del motor. El
 * lanzador del servicio lo pone; el motor lo exige al cargar
 * (`loadProvider`), asi que un motor lanzado sin el falla al arrancar y no a
 * mitad del plan.
 */
export const requiredEnv = ["NOXLOOP_SERVICE_URL", "NOXLOOP_SERVICE_TOKEN"];

/**
 * Las opciones: de que proyecto son las tareas. `listItems` las lista por
 * proyecto; el resto de verbos va por id, que es unico en el almacen.
 */
export const optionsSchema = Object.freeze({
  type: "object",
  required: ["projectId"],
  properties: { projectId: { type: "string" } },
  additionalProperties: false,
});

/**
 * El mapa de estados del gestor local: el nativo ES el canonico. `done` va en
 * `null` a proposito: el motor no cierra tickets, la autonomia termina en el PR
 * abierto (principio IV). Cerrar una tarea es cosa del operador.
 */
export const ESTADOS = Object.freeze({
  todo: "todo",
  in_progress: "in_progress",
  blocked: "blocked",
  in_review: "in_review",
  done: null,
});

/** La verdad, capacidad por capacidad. */
export function capabilities() {
  return {
    children: false,
    dependencies: false,
    createChild: false,
    setState: true,
    comment: true,
    // Sin `linkUrl` el motor deja el enlace al PR como comentario, que el
    // gestor local si guarda. Declarar `true` obligaria a un campo nuevo en la
    // tarea para algo que el comentario ya resuelve.
    linkUrl: false,
    labels: false,
    searchAssigned: false,
    searchMentioned: false,
    boardFields: false,
    identityAssignee: false,
    listItems: true,
  };
}

// ---------------------------------------------------------------------------
// La interfaz: inyectada, o el servicio por HTTP
// ---------------------------------------------------------------------------

/**
 * La interfaz de tareas que toca usar con este `ctx`.
 *
 * @param {any} ctx
 */
function puertoDe(ctx) {
  if (ctx?.tareas) return ctx.tareas;
  const url = ctx?.env?.NOXLOOP_SERVICE_URL;
  const token = ctx?.env?.NOXLOOP_SERVICE_TOKEN;
  if (!url || !token) {
    throw new Error(
      "el gestor local no tiene con que hablar: ni el servicio le inyecto la interfaz de tareas (`ctx.tareas`) " +
        "ni el entorno trae NOXLOOP_SERVICE_URL y NOXLOOP_SERVICE_TOKEN. El motor recibe las dos del lanzador del " +
        "servicio de control; lanzado a mano, arranca el servicio y pulsa Run desde el board.",
    );
  }
  return puertoHttp(String(url).replace(/\/+$/, ""), String(token), ctx.fetch ?? globalThis.fetch);
}

/**
 * La interfaz sobre las rutas del servicio. Cada verbo es UNA peticion.
 *
 * @param {string} base
 * @param {string} token
 * @param {typeof fetch} fetch
 */
function puertoHttp(base, token, fetch) {
  /**
   * @param {string} metodo
   * @param {string} ruta
   * @param {any} [cuerpo]
   * @param {{nuloSi404?: boolean}} [opts]
   * @returns {Promise<any>}
   */
  async function pedir(metodo, ruta, cuerpo, opts = {}) {
    const r = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { "x-noxloop-token": token, accept: "application/json", ...(cuerpo ? { "content-type": "application/json" } : {}) },
      ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
    });
    if (opts.nuloSi404 && r.status === 404) return null;
    /** @type {any} */
    let datos = null;
    try {
      datos = await r.json();
    } catch {
      /* un cuerpo que no es JSON se explica abajo con el codigo */
    }
    if (!r.ok) {
      const e = datos?.error;
      // La causa y la accion del SERVICIO, tal cual: son las que el operador
      // tiene que leer en el run fallido, no «el gestor devolvio 409».
      throw new Error(
        e?.causa
          ? `${e.causa}${e.accion ? ` ${e.accion}` : ""}`
          : `el servicio de control contesto ${r.status} a ${metodo} ${ruta} sin un error legible`,
      );
    }
    return datos;
  }

  return {
    async obtener(/** @type {string} */ id) {
      const d = await pedir("GET", `/v1/tasks/${encodeURIComponent(id)}`, undefined, { nuloSi404: true });
      return d ? d.tarea : null;
    },
    async listar(/** @type {string} */ projectId, /** @type {{limit: number, desde: number, includeDone: boolean}} */ q) {
      const qs = new URLSearchParams({ limit: String(q.limit), desde: String(q.desde) });
      if (q.includeDone) qs.set("includeDone", "1");
      const d = await pedir("GET", `/v1/projects/${encodeURIComponent(projectId)}/tasks?${qs}`);
      return { items: d.items ?? [], total: Number.isInteger(d.total) ? d.total : null };
    },
    async cambiarEstado(/** @type {string} */ id, /** @type {string} */ estado) {
      return (await pedir("PATCH", `/v1/tasks/${encodeURIComponent(id)}`, { estado })).tarea;
    },
    async comentar(/** @type {string} */ id, /** @type {string} */ texto) {
      return (await pedir("POST", `/v1/tasks/${encodeURIComponent(id)}/comments`, { texto })).comentario;
    },
  };
}

// ---------------------------------------------------------------------------
// De la tarea al Item del contrato
// ---------------------------------------------------------------------------

/**
 * @param {any} t la tarea como la devuelve el servicio
 */
function aItem(t) {
  return {
    id: String(t.id),
    key: t.key ?? null,
    title: String(t.titulo ?? ""),
    // El plan markdown ES el cuerpo del ticket: es lo que el planificador lee.
    body: String(t.plan ?? ""),
    acceptance: Array.isArray(t.criterios) ? t.criterios : [],
    // Una tarea local es una tarea: el planificador la parte en un plan de las
    // tareas que haga falta, igual que una historia.
    level: "task",
    state: t.estado,
    // El `Item` solo conoce los cinco canonicos: `backlog` se lee como `todo`
    // aqui y como `backlog` al listar (igual que el proveedor falso).
    canonicalState: CANONICAL_STATES.includes(t.estado) ? t.estado : "todo",
    assignee: null,
    parentId: null,
    labels: Array.isArray(t.etiquetas) ? t.etiquetas : [],
    url: `noxloop://tasks/${encodeURIComponent(String(t.id))}`,
    boardFields: null,
    // Lo que el board necesita para la cascada del ejecutor y el modo de
    // termino (FR-031, FR-032). Va en `raw` porque no es del contrato: es de
    // ESTE gestor, y el motor no lo lee.
    raw: t,
  };
}

export async function getItem(/** @type {string} */ id, /** @type {any} */ ctx) {
  const t = await puertoDe(ctx).obtener(id);
  // "No existe" es una respuesta, no un fallo.
  return t ? aItem(t) : null;
}

/**
 * Mueve el estado por el `stateMap`: un canonico que el mapa no nombra NO se
 * escribe (el motor pide `done` y el mapa lo tiene en `null` a proposito).
 */
export async function setState(/** @type {string} */ id, /** @type {string} */ canonicalState, /** @type {any} */ ctx) {
  const nativo = ctx?.options?.stateMap?.[canonicalState];
  if (!nativo) return { written: null, skipped: canonicalState };
  await puertoDe(ctx).cambiarEstado(id, nativo);
  return { written: nativo };
}

export async function comment(/** @type {string} */ id, /** @type {string} */ text, /** @type {any} */ ctx) {
  const c = await puertoDe(ctx).comentar(id, String(text));
  return { id: String(c?.id ?? "") };
}

/**
 * Las tareas del proyecto, como el board las pinta. El cursor es el
 * desplazamiento en string: el orden del servicio es estable (las mas nuevas
 * primero, por numero).
 *
 * @param {{limit?: number, cursor?: string|null, includeDone?: boolean}} query
 * @param {any} ctx
 */
export async function listItems(query, ctx) {
  const { limit, cursor, includeDone } = listQuery(query);
  const projectId = ctx?.options?.projectId;
  if (!projectId) throw new Error("el gestor local necesita `projectId` en sus opciones para listar las tareas de un proyecto");
  const desde = cursor ? Number(cursor) : 0;
  if (!Number.isInteger(desde) || desde < 0) throw new Error(`cursor invalido para el gestor local: ${JSON.stringify(cursor)}`);

  const { items, total } = await puertoDe(ctx).listar(String(projectId), { limit, desde, includeDone });
  const listados = items
    .filter((/** @type {any} */ t) => includeDone || t.estado !== "done")
    .slice(0, limit)
    .map((/** @type {any} */ t) => ({
      ...aItem(t),
      canonicalState: t.estado,
      priority: Number.isInteger(t.prioridad) ? t.prioridad : null,
      assignee: null,
      team: null,
      updatedAt: String(t.actualizado ?? t.creado ?? "1970-01-01T00:00:00.000Z"),
    }));
  const hasta = desde + listados.length;
  return {
    items: listados,
    nextCursor: total !== null && hasta < total ? String(hasta) : null,
    total,
  };
}

// ---------------------------------------------------------------------------
// Fixtures: la interfaz en memoria, que es tambien el ejemplo de lo que el
// servicio inyecta
// ---------------------------------------------------------------------------

/** Una interfaz de tareas en memoria, con la misma forma que la del servicio. */
function puertoEnMemoria() {
  /** @type {Map<string, any>} */
  const tareas = new Map();
  const comentarios = [];
  let n = 0;
  return {
    sembrar(/** @type {any} */ t) {
      n++;
      const tarea = {
        projectId: "p-fixture",
        key: `PAY-${n}`,
        plan: "",
        criterios: ["un criterio verificable"],
        prioridad: null,
        etiquetas: [],
        ejecutor: null,
        termino: "pr",
        estado: "todo",
        creado: "2026-09-24T00:00:00.000Z",
        actualizado: `2026-09-24T00:00:${String(n).padStart(2, "0")}.000Z`,
        ...t,
      };
      tareas.set(String(tarea.id), tarea);
      return tarea;
    },
    comentarios,
    async obtener(/** @type {string} */ id) {
      return tareas.get(id) ?? null;
    },
    async listar(/** @type {string} */ projectId, /** @type {any} */ q) {
      const todas = [...tareas.values()]
        .filter((t) => t.projectId === projectId && (q.includeDone || t.estado !== "done"))
        .reverse();
      return { items: todas.slice(q.desde, q.desde + q.limit), total: todas.length };
    },
    async cambiarEstado(/** @type {string} */ id, /** @type {string} */ estado) {
      const t = tareas.get(id);
      if (!t) throw new Error(`no hay ninguna tarea ${id}`);
      t.estado = estado;
      return t;
    },
    async comentar(/** @type {string} */ id, /** @type {string} */ texto) {
      comentarios.push({ id, texto });
      return { id: `c${comentarios.length}` };
    },
  };
}

/** Un ctx con la interfaz en memoria y tres tareas sembradas. */
export function fixturesConPuerto() {
  const puerto = puertoEnMemoria();
  puerto.sembrar({ id: "t-1", titulo: "cobrar con un clic" });
  puerto.sembrar({ id: "t-2", titulo: "devolver un cobro", estado: "in_progress", prioridad: 2 });
  puerto.sembrar({ id: "t-3", titulo: "exportar a CSV", etiquetas: ["csv"] });
  const ctx = {
    options: { projectId: "p-fixture", stateMap: { ...ESTADOS } },
    env: {},
    log: { info() {}, warn() {}, error() {} },
    fetch: async () => {
      throw new Error("con la interfaz inyectada el gestor local no hace red");
    },
    tareas: puerto,
  };
  return { ctx, puerto };
}

/** Lo que la suite de contrato necesita. */
export const fixtures = {
  ...(() => {
    const { ctx } = fixturesConPuerto();
    return { ctx };
  })(),
  defaultLevel: "task",
  knownItemId: "t-1",
  unknownItemId: "no-existe",
  // El gestor local no tiene tipos nativos: toda tarea es `task`, asi que el
  // «tipo desconocido» es cualquiera y tiene que caer en el nivel por defecto.
  unknownTypeItemId: "t-3",
  sourceUrl: new URL("./index.mjs", import.meta.url),
};
