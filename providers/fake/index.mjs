// El proveedor falso. Cumple dos funciones a la vez, y las dos importan:
//
//   1. Es el proveedor contra el que corren los tests del motor. Todo el
//      paralelismo, la cola de integracion y la maquina de estados se prueban
//      sin red, sin credenciales y sin costo.
//   2. Es el EJEMPLO MINIMO que alguien copia para agregar un gestor nuevo.
//      Por eso esta comentado como documentacion y no como codigo de prueba.
//
// Fijate que casi todas sus capacidades estan en `false`. Eso es correcto y
// produce un recorrido que funciona: empezar declarando poco es la forma
// recomendada de escribir un proveedor.

import { NotSupportedError } from "../contract.mjs";

export const meta = { name: "fake", version: "1.0.0" };

/**
 * Lo que este gestor sabe hacer. Se declara TODO, aunque sea false: el
 * validador rechaza un mapa incompleto, porque una capacidad sin declarar es
 * una capacidad que el motor no sabe si puede usar.
 */
export function capabilities() {
  return {
    children: true,
    dependencies: true,
    createChild: true,
    setState: true,
    comment: true,
    linkUrl: false,      // este gestor no sabe adjuntar una URL: va como comentario
    labels: false,
    searchAssigned: true,
    searchMentioned: true,
    boardFields: false,
  };
}

// El mapa de tipos nativos a niveles canonicos. La entrada `default` es
// OBLIGATORIA y es lo que evita el fallo de deducir el nivel del nombre del
// tipo: un gestor puede llamar "Product Backlog Item" a lo que otro llama
// "User Story", y un motor que compare nombres funciona en uno y calla en otro.
const NIVELES = {
  Epica: "epic",
  Feature: "feature",
  Historia: "story",
  Tarea: "task",
  default: "story",
};

const BASE = {
  "1": { type: "Epica", title: "Un hito de prueba", state: "Nuevo", parentId: null, children: ["2", "3"] },
  "2": { type: "Historia", title: "La primera historia", state: "Nuevo", parentId: "1", children: [] },
  "3": { type: "Historia", title: "La segunda historia", state: "Nuevo", parentId: "1", children: [] },
  "tipo-raro": { type: "EstoNoExisteEnNingunGestor", title: "Tipo desconocido", state: "Nuevo", parentId: null, children: [] },
};

/** Estado mutable del gestor falso: lo que un recorrido de prueba escribe. */
export const db = {
  items: structuredClone(BASE),
  /** @type {Array<{id: string, text: string}>} */
  comments: [],
  /** @type {Record<string, string>} */
  states: {},
  /** @type {Array<{id: string, parentId: string, spec: object}>} */
  created: [],
  deps: { "3": { predecessors: ["2"], successors: [] } },
  inbox: { assigned: [], mentioned: [] },
};

export function reset() {
  db.items = structuredClone(BASE);
  db.comments = [];
  db.states = {};
  db.created = [];
  db.deps = { "3": { predecessors: ["2"], successors: [] } };
  db.inbox = { assigned: [], mentioned: [] };
}

function canonico(nativo, ctx) {
  const mapa = ctx.options?.stateMap || {};
  const entrada = Object.entries(mapa).find(([, v]) => v === nativo);
  return entrada ? entrada[0] : "todo";
}

function aItem(id, crudo, ctx) {
  return {
    id,
    key: `FAKE-${id}`,
    title: crudo.title,
    body: crudo.body || "",
    acceptance: crudo.acceptance || ["dado un estado, cuando algo, entonces algo"],
    // El nivel sale del MAPA, con default explicito. Nunca de comparar el
    // nombre del tipo contra una constante.
    level: NIVELES[crudo.type] ?? NIVELES.default,
    state: db.states[id] || crudo.state,
    canonicalState: canonico(db.states[id] || crudo.state, ctx),
    assignee: crudo.assignee || null,
    parentId: crudo.parentId,
    labels: crudo.labels || [],
    url: `fake://items/${id}`,
    boardFields: null,
    raw: crudo,
  };
}

export async function getItem(id, ctx) {
  const crudo = db.items[id];
  // "No existe" es una RESPUESTA, no un fallo. Lanzar aca obligaria a todo
  // llamador a envolver en try/catch un caso perfectamente normal.
  if (!crudo) return null;
  return aItem(id, crudo, ctx);
}

export async function children(id, ctx) {
  const crudo = db.items[id];
  if (!crudo) return [];
  return Promise.all(crudo.children.map((c) => getItem(c, ctx)));
}

export async function dependencies(id, _ctx) {
  return db.deps[id] || { predecessors: [], successors: [] };
}

export async function setState(id, canonicalState, ctx) {
  const nativo = ctx.options?.stateMap?.[canonicalState];
  // Un estado canonico que este proyecto no tiene NO se escribe. Inventar el
  // nombre nativo es como se mueve un ticket a un estado que no existe.
  if (!nativo) return { written: null, skipped: canonicalState };
  db.states[id] = nativo;
  return { written: nativo };
}

export async function comment(id, text, _ctx) {
  db.comments.push({ id, text });
  return { id: `c${db.comments.length}` };
}

export async function linkUrl(_id, _url, _title, _ctx) {
  // Declarada en false: si el motor la llamara igual, esto lo delata en vez de
  // fallar en silencio o de fingir que hizo algo.
  throw new NotSupportedError("linkUrl", meta.name);
}

export async function addLabel(_id, _label, _ctx) {
  throw new NotSupportedError("labels", meta.name);
}

export async function createChild(parentId, spec, ctx) {
  const id = `t${db.created.length + 1}`;
  db.items[id] = {
    type: "Tarea",
    title: spec.title,
    state: "Nuevo",
    parentId,
    children: [],
    acceptance: spec.acceptance ? [spec.acceptance] : [],
  };
  db.created.push({ id, parentId, spec });
  return getItem(id, ctx);
}

export async function searchInbox(ctx) {
  const resolver = (ids) => Promise.all(ids.map((i) => getItem(i, ctx)));
  return {
    assigned: await resolver(db.inbox.assigned),
    mentioned: await resolver(db.inbox.mentioned),
  };
}

/** Lo que la suite de contrato necesita para ejercitar este proveedor. */
export const fixtures = {
  ctx: {
    options: {
      stateMap: {
        todo: "Nuevo",
        in_progress: "En curso",
        blocked: "Bloqueado",
        in_review: null,   // este gestor no tiene estado de revision, y lo dice
        done: null,        // el motor no cierra tickets: la autonomia termina en el PR
      },
    },
    env: {},
    log: { info() {}, warn() {}, error() {} },
    fetch: async () => {
      throw new Error("el proveedor falso no hace red");
    },
  },
  defaultLevel: "story",
  knownItemId: "2",
  unknownItemId: "no-existe",
  unknownTypeItemId: "tipo-raro",
  sourceUrl: new URL("./index.mjs", import.meta.url),
};
