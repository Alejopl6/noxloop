// Proveedores falsos minimos para el test de degradacion: uno por capacidad
// apagada.
//
// POR QUE ESTAN EN UN ARCHIVO APARTE Y NO DENTRO DEL TEST. Porque el test va
// primero y tiene que poder fallar antes de que exista el proveedor. Con las
// fabricas adentro del mismo archivo ese rojo no existe —el test y lo que
// prueba nacerian juntos— y el primer chequeo del ciclo se convierte en una
// formalidad. Este archivo se escribio DESPUES de ver el
// `ERR_MODULE_NOT_FOUND`.
//
// POR QUE NO ES UN STRAWMAN. Cada fake que devuelve `gestorFalso()` pasa los
// OCHO chequeos de `contractChecks`, los mismos que `azure-devops`, `github` y
// `linear`. Un modulo a medias que se rompe al llamarlo no prueba nada sobre la
// degradacion: prueba que un modulo roto se rompe. Lo que se quiere probar es
// que un gestor HONESTO, que declara poco, produce un recorrido que funciona.
//
// LAS DOS REGLAS QUE SE SIGUEN AL APAGAR UNA CAPACIDAD, y el fallo de cada una:
//
//   1. La funcion de una capacidad en `false` LANZA `NotSupportedError`. No
//      devuelve `[]`, ni `null`, ni `{ok: true}`. Una lista vacia es
//      indistinguible de "no hay nada" y un `{ok: true}` de mentira es peor:
//      el recorrido termina informando exito y el tablero queda mudo. Es el
//      mismo fallo que ya se conto en `docs/PROVIDERS.md` para Azure DevOps
//      —dos escrituras que decian "listo" sin escribir—.
//   2. `searchAssigned` y `searchMentioned` son la excepcion, porque comparten
//      `searchInbox`: apagar una devuelve esa mitad vacia y deja la otra en
//      pie, que es lo que hace `linear` de verdad. Apagadas las dos, la funcion
//      NO se exporta: una bandeja vacia haria girar al daemon para siempre sin
//      disparar nada y sin decir por que.
//
// Sin red, sin credenciales y sin `process.env`: todo llega por `ctx`. El
// chequeo 8 de la suite lee este archivo para verificarlo.

import { NotSupportedError } from "./contract.mjs";

const NOMBRE = "falso-degradado";

/** Donde vive este archivo. El chequeo 8 lee esta fuente. */
const FUENTE = new URL("./degradation-fakes.mjs", import.meta.url);

/**
 * El mapa de tipos nativos a niveles canonicos, con `default` explicito.
 *
 * `default: "task"` NO es un detalle: el item conocido de los fixtures es una
 * historia (`story`), asi que un proveedor impostor que devolviera un nivel
 * fijo no puede pasar el chequeo 6. Con `default: "story"` —el nivel de la
 * mayoria— ese impostor pasaba los ocho, y esta contado en `docs/PROVIDERS.md`.
 */
const NIVELES = {
  Hito: "epic",
  Paquete: "feature",
  Historia: "story",
  Tarea: "task",
  default: "task",
};

/**
 * El mapa de estados, total: todo estado canonico tiene entrada. `in_review`
 * nulo es el caso normal y no una excepcion —en varias plantillas ese estado no
 * existe—, y `done` nulo porque el motor no cierra tickets: la autonomia
 * termina en el PR abierto.
 */
const ESTADOS = {
  todo: "Nuevo",
  in_progress: "En curso",
  blocked: "Bloqueado",
  in_review: null,
  done: null,
};

/**
 * El tablero: un hito con dos historias, un paquete, y un item de un tipo que
 * ningun gestor tiene. `s1` trae campos de tablero para poder observar la
 * herencia de las hijas, y `s2` es el que depende de `s1`.
 *
 * Los campos nativos NO traen ninguna precedencia: las dependencias viven
 * aparte, en `DEPS`. Es deliberado — si el payload nativo trajera un
 * `predecessors`, la degradacion de `dependencies` se podria burlar leyendolo
 * desde `getItem`, que es justo el orden que el gestor no afirma.
 */
const TABLERO_BASE = {
  h1: { type: "Hito", title: "Un hito con dos historias", state: "Nuevo", parentId: null, children: ["s1", "s2"], boardFields: null },
  p1: { type: "Paquete", title: "Un paquete de trabajo", state: "Nuevo", parentId: "h1", children: ["s1"], boardFields: null },
  s1: { type: "Historia", title: "La primera historia", state: "Nuevo", parentId: "h1", children: [], boardFields: { iteration: "Sprint 7", area: "Plataforma" } },
  s2: { type: "Historia", title: "La segunda historia", state: "Nuevo", parentId: "h1", children: [], boardFields: { iteration: "Sprint 7", area: "Plataforma" } },
  raro: { type: "NingunGestorLlamaAsiAUnTipo", title: "Tipo desconocido", state: "Nuevo", parentId: null, children: [], boardFields: null },
};

/** Las precedencias que el gestor AFIRMA. La unica fuente de orden. */
const DEPS = {
  s1: { predecessors: [], successors: ["s2"] },
  s2: { predecessors: ["s1"], successors: [] },
};

/** La bandeja: una asignada y una mencionada, para poder distinguir los dos disparos. */
const BANDEJA = { assigned: ["s1"], mentioned: ["s2"] };

const TODAS_EN_TRUE = {
  children: true,
  dependencies: true,
  createChild: true,
  setState: true,
  comment: true,
  linkUrl: true,
  labels: true,
  searchAssigned: true,
  searchMentioned: true,
  boardFields: true,
};

/**
 * Un gestor falso con las capacidades que se le digan.
 *
 * @param {Record<string, boolean>} [overrides] las capacidades a cambiar
 * @returns {{mod: Record<string, any>, tablero: Record<string, any>, llamadas: Record<string, number>, fixtures: Record<string, any>}}
 *   `tablero` es lo que el gestor tiene escrito —para poder afirmar que NO se
 *   escribio nada—, y `llamadas` cuenta las invocaciones, para poder afirmar
 *   que una decision no necesito recorrer nada.
 */
export function gestorFalso(overrides = {}) {
  const caps = { ...TODAS_EN_TRUE, ...overrides };

  const tablero = {
    items: structuredClone(TABLERO_BASE),
    /** @type {Array<{id: string, text: string}>} */
    comentarios: [],
    /** @type {Record<string, string>} */
    estados: {},
    /** @type {Array<{id: string, parentId: string, spec: any}>} */
    creados: [],
    /** @type {Array<{id: string, url: string, title: string}>} */
    enlaces: [],
    /** @type {Array<{id: string, label: string}>} */
    etiquetas: [],
    /** Toda escritura, de cualquier tipo. Cero es una afirmacion verificable. */
    escrituras: 0,
  };

  const llamadas = {
    getItem: 0,
    children: 0,
    dependencies: 0,
    setState: 0,
    comment: 0,
    linkUrl: 0,
    addLabel: 0,
    createChild: 0,
    searchInbox: 0,
  };

  /** El estado canonico que corresponde a un nativo, segun el mapa del `ctx`. */
  function canonico(nativo, ctx) {
    const mapa = ctx?.options?.stateMap || {};
    const entrada = Object.entries(mapa).find(([, v]) => v === nativo);
    return entrada ? entrada[0] : "todo";
  }

  function aItem(id, crudo, ctx) {
    const nativo = tablero.estados[id] || crudo.state;
    return {
      id,
      key: `FALSO-${id}`,
      title: crudo.title,
      body: "",
      acceptance: crudo.acceptance || ["dado un estado, cuando algo, entonces algo"],
      // El nivel sale del MAPA, con default explicito, y nunca de comparar el
      // nombre del tipo contra una constante.
      level: NIVELES[crudo.type] ?? NIVELES.default,
      state: nativo,
      canonicalState: canonico(nativo, ctx),
      assignee: null,
      parentId: crudo.parentId,
      labels: crudo.labels || [],
      url: `falso://items/${id}`,
      // Sin la capacidad, no hay campos de tablero. Devolver los del padre
      // "porque estan ahi" haria que el motor crea que puede heredarlos.
      boardFields: caps.boardFields ? crudo.boardFields ?? null : null,
      raw: crudo,
    };
  }

  async function getItem(id, ctx) {
    llamadas.getItem++;
    const crudo = tablero.items[id];
    // "No existe" es una RESPUESTA, no un fallo.
    if (!crudo) return null;
    return aItem(id, crudo, ctx);
  }

  async function children(id, ctx) {
    llamadas.children++;
    const crudo = tablero.items[id];
    if (!crudo) return [];
    return Promise.all(crudo.children.map((/** @type {string} */ c) => getItem(c, ctx)));
  }

  async function dependencies(id, _ctx) {
    llamadas.dependencies++;
    // Clonado: el llamador no puede mutar lo que el gestor afirma.
    return structuredClone(DEPS[id] || { predecessors: [], successors: [] });
  }

  async function setState(id, canonicalState, ctx) {
    llamadas.setState++;
    const nativo = ctx?.options?.stateMap?.[canonicalState];
    // Un estado canonico que este proyecto no tiene NO se escribe. Inventar el
    // nombre nativo es como se mueve un ticket a un estado que no existe.
    if (!nativo) return { written: null, skipped: canonicalState };
    tablero.estados[id] = nativo;
    tablero.escrituras++;
    return { written: nativo };
  }

  async function comment(id, text, _ctx) {
    llamadas.comment++;
    tablero.comentarios.push({ id, text });
    tablero.escrituras++;
    return { id: `c${tablero.comentarios.length}` };
  }

  async function linkUrl(id, url, title, _ctx) {
    llamadas.linkUrl++;
    tablero.enlaces.push({ id, url, title });
    tablero.escrituras++;
    return { ok: true };
  }

  async function addLabel(id, label, _ctx) {
    llamadas.addLabel++;
    tablero.etiquetas.push({ id, label });
    tablero.escrituras++;
    return { ok: true };
  }

  async function createChild(parentId, spec, ctx) {
    llamadas.createChild++;
    const id = `t${tablero.creados.length + 1}`;
    tablero.items[id] = {
      type: "Tarea",
      title: spec.title,
      state: "Nuevo",
      parentId,
      children: [],
      acceptance: spec.acceptance ? [spec.acceptance] : [],
      boardFields: caps.boardFields ? spec.boardFields ?? null : null,
    };
    tablero.creados.push({ id, parentId, spec });
    tablero.escrituras++;
    return getItem(id, ctx);
  }

  async function searchInbox(ctx) {
    llamadas.searchInbox++;
    const resolver = (/** @type {string[]} */ ids) => Promise.all(ids.map((i) => getItem(i, ctx)));
    // Las dos seniales salen de UNA consulta: separarlas obligaria a dos viajes
    // a la API para lo mismo. La que esta apagada vuelve vacia.
    return {
      assigned: caps.searchAssigned ? await resolver(BANDEJA.assigned) : [],
      mentioned: caps.searchMentioned ? await resolver(BANDEJA.mentioned) : [],
    };
  }

  /** La funcion de una capacidad apagada: lanza, y nombra la capacidad. */
  function negar(capacidad) {
    return async () => {
      throw new NotSupportedError(capacidad, NOMBRE);
    };
  }

  /** @type {Record<string, any>} */
  const mod = {
    meta: { name: NOMBRE, version: "1.0.0" },
    capabilities: () => ({ ...caps }),
    requiredEnv: [],
    getItem,
    children: caps.children ? children : negar("children"),
    dependencies: caps.dependencies ? dependencies : negar("dependencies"),
    createChild: caps.createChild ? createChild : negar("createChild"),
    setState: caps.setState ? setState : negar("setState"),
    comment: caps.comment ? comment : negar("comment"),
    linkUrl: caps.linkUrl ? linkUrl : negar("linkUrl"),
    addLabel: caps.labels ? addLabel : negar("labels"),
    // Apagadas las dos busquedas, la funcion no se exporta: el daemon no puede
    // ni intentarlo, y el validador lo dice al arrancar.
    ...(caps.searchAssigned || caps.searchMentioned ? { searchInbox } : {}),
  };

  const fixtures = {
    ctx: {
      options: { stateMap: { ...ESTADOS }, levelMap: { ...NIVELES } },
      env: {},
      log: { info() {}, warn() {}, error() {} },
      fetch: async () => {
        throw new Error("el gestor falso de degradacion no hace red");
      },
    },
    defaultLevel: "task",
    knownItemId: "s1",
    unknownItemId: "no-existe",
    unknownTypeItemId: "raro",
    sourceUrl: FUENTE,
  };

  return { mod, tablero, llamadas, fixtures };
}

/** El mismo gestor con UNA capacidad apagada. Una fila de la tabla = una llamada. */
export function sinCapacidad(capacidad) {
  return gestorFalso({ [capacidad]: false });
}

/** Sin ninguna forma de disparo automatico: el caso de la ultima fila. */
export function sinDisparo() {
  return gestorFalso({ searchAssigned: false, searchMentioned: false });
}
