// Spec 005, frente A — Linear completo, visto desde el servicio.
//
//   - FR-001: las reglas de ruteo se guardan por el PATCH del tracker (contra el
//     `optionsSchema` del proveedor) y el board las aplica: dos proyectos sobre
//     el mismo equipo ven cada uno solo lo suyo. Una regla que no deja pasar
//     nada se DICE en la columna.
//   - FR-002: `GET /v1/projects/:id/tracker/estados` trae los estados REALES
//     del equipo y el `stateMap` vigente, con los estados sin asignar nombrados.
//     Sin `listStates`, la degradacion declarada.
//   - FR-004: un run cuya issue salio de las reglas del proyecto sale «movida»,
//     con su destino, y la consulta al gestor entra en la cache del board.
//
// EL GESTOR ES EL PROVEEDOR DE LINEAR DE VERDAD, sobre las respuestas GRABADAS
// de `providers/linear/fixtures.mjs`. Lo unico que se cambia al envolverlo es de
// donde sale la red (el `fetch` grabado en vez de `globalThis.fetch`) y la
// credencial (`requiredEnv: []`, asi el servicio no va a la boveda): el filtro
// de GraphQL que se prueba es el que el proveedor arma.

import { test } from "node:test";
import assert from "node:assert/strict";

import * as linear from "../../../providers/linear/index.mjs";
import * as fake from "../../../providers/fake/index.mjs";
import { nuevoCtx, IDS, MAPA_ESTADOS } from "../../../providers/linear/fixtures.mjs";
import { conServicio, pedir } from "./ayuda.mjs";
import { proyectoActivo, runEnDisco } from "./ayuda-motor.mjs";

/**
 * El proveedor de Linear con la red grabada. Cuenta las llamadas por funcion:
 * la cache del board se prueba contandolas.
 */
function linearGrabado() {
  const { ctx: grabado } = nuevoCtx();
  const llamadas = { listItems: 0, getItem: 0, listStates: 0 };
  const conRed = (/** @type {any} */ ctx) => ({ ...ctx, fetch: grabado.fetch, env: grabado.env });
  const mod = {
    ...linear,
    requiredEnv: [],
    listItems: async (/** @type {any} */ q, /** @type {any} */ ctx) => {
      llamadas.listItems++;
      return linear.listItems(q, conRed(ctx));
    },
    getItem: async (/** @type {any} */ id, /** @type {any} */ ctx) => {
      llamadas.getItem++;
      return linear.getItem(id, conRed(ctx));
    },
    listStates: async (/** @type {any} */ ctx) => {
      llamadas.listStates++;
      return linear.listStates(conRed(ctx));
    },
  };
  return { mod, llamadas };
}

/** Una conexion de Linear DEL PROYECTO con estas opciones. */
const conexionLinear = (opciones, stateMap = MAPA_ESTADOS) => [
  { clase: "tracker", proveedor: "linear", capacidades: { opcionesDelGestor: opciones, stateMap } },
];

/** @param {any} svc @param {string} id @param {any} cuerpo */
async function patch(svc, id, cuerpo) {
  const r = await pedir(svc, `/v1/projects/${id}/tracker`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  return { estado: r.status, cuerpo: await r.json() };
}

/** @param {any} svc @param {string} id */
async function estados(svc, id) {
  const r = await pedir(svc, `/v1/projects/${id}/tracker/estados`);
  return { estado: r.status, cuerpo: await r.json() };
}

// ---------------------------------------------------------------- FR-001

test("FR-001: el PATCH del tracker acepta las reglas de Linear y rechaza una mal escrita, nombrandola", async () => {
  const { mod } = linearGrabado();
  await conServicio({ motor: { intervaloMs: 0, cargarGestor: async () => mod } }, async (svc) => {
    const p = await proyectoActivo(svc, { conexiones: conexionLinear({ teamKey: "ENG" }) });
    const ok = await patch(svc, p.id, { opciones: { teamKey: "ENG", reglas: { proyecto: "Pagos", etiquetas: ["Story"] } } });
    assert.equal(ok.estado, 200, JSON.stringify(ok.cuerpo));
    assert.deepEqual(ok.cuerpo.gestor.opciones.reglas, { proyecto: "Pagos", etiquetas: ["Story"] });

    const mal = await patch(svc, p.id, { opciones: { teamKey: "ENG", reglas: { proyect: "Pagos" } } });
    assert.equal(mal.estado, 400);
    assert.match(mal.cuerpo.error.causa, /proyect/);
    const etiquetaNoTexto = await patch(svc, p.id, { opciones: { teamKey: "ENG", reglas: { etiquetas: [7] } } });
    assert.equal(etiquetaNoTexto.estado, 400);
    assert.match(etiquetaNoTexto.cuerpo.error.causa, /etiquetas/);
  });
});

test("SC-001: dos proyectos sobre el mismo equipo, con reglas distintas, ven cada uno solo sus issues en el board", async () => {
  const { mod } = linearGrabado();
  await conServicio({ motor: { intervaloMs: 0, cargarGestor: async () => mod } }, async (svc) => {
    const pagos = await proyectoActivo(svc, { nombre: "Pagos", conexiones: conexionLinear({ teamKey: "ENG", reglas: { proyecto: "Pagos" } }) });
    const plataforma = await proyectoActivo(svc, {
      nombre: "Plataforma",
      conexiones: conexionLinear({ teamKey: "ENG", reglas: { proyecto: IDS.proyecto } }),
    });
    const board = await (await pedir(svc, "/v1/board")).json();
    const de = (/** @type {string} */ id) =>
      board.tarjetas.filter((/** @type {any} */ t) => t.proyecto.id === id).map((/** @type {any} */ t) => t.ticket.key).sort();
    assert.deepEqual(de(pagos.id), ["ENG-124", "ENG-500"]);
    assert.deepEqual(de(plataforma.id), ["ENG-100", "ENG-123"]);
  });
});

test("FR-001, borde: una regla que no deja pasar nada lo DICE en Backlog y Todo, nombrando la regla", async () => {
  const { mod } = linearGrabado();
  await conServicio({ motor: { intervaloMs: 0, cargarGestor: async () => mod } }, async (svc) => {
    const p = await proyectoActivo(svc, { conexiones: conexionLinear({ teamKey: "ENG", reglas: { proyecto: "No existe", etiquetas: ["x"] } }) });
    const board = await (await pedir(svc, `/v1/board?project=${p.id}`)).json();
    assert.equal(board.tarjetas.length, 0);
    const [backlog, todo] = board.columnas;
    for (const c of [backlog, todo]) {
      assert.match(String(c.nota), /reglas/, "un board vacio sin explicacion se lee como «no hay trabajo»");
      assert.match(String(c.nota), /No existe/, "la nota nombra la regla que no deja pasar nada");
      assert.match(String(c.nota), /Settings/, "y dice donde se cambia");
    }
  });
});

test("FR-001: sin reglas, un board vacio NO culpa a las reglas", async () => {
  const vacio = { ...linearGrabado().mod, listItems: async () => ({ items: [], nextCursor: null, total: null }) };
  await conServicio({ motor: { intervaloMs: 0, cargarGestor: async () => vacio } }, async (svc) => {
    const p = await proyectoActivo(svc, { conexiones: conexionLinear({ teamKey: "ENG" }) });
    const board = await (await pedir(svc, `/v1/board?project=${p.id}`)).json();
    assert.equal(board.columnas[1].nota, null);
  });
});

// ---------------------------------------------------------------- FR-002

test("FR-002: GET /tracker/estados trae los estados reales del equipo, el stateMap y los sin asignar nombrados", async () => {
  const { mod, llamadas } = linearGrabado();
  await conServicio({ motor: { intervaloMs: 0, cargarGestor: async () => mod } }, async (svc) => {
    const mapa = { ...MAPA_ESTADOS, blocked: "Blocked" };
    const p = await proyectoActivo(svc, { conexiones: conexionLinear({ teamKey: "ENG" }, mapa) });
    const r = await estados(svc, p.id);
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
    const c = r.cuerpo;
    assert.equal(c.gestor.nombre, "linear");
    assert.deepEqual(c.gestor.opciones, { teamKey: "ENG" });
    assert.ok(c.esquema?.properties?.reglas, "el esquema viaja: la interfaz pinta los campos que el proveedor declara");
    assert.equal(c.editable, true);
    assert.equal(c.listStates, true);
    assert.equal(llamadas.listStates, 1);
    assert.deepEqual(c.estados.map((/** @type {any} */ e) => e.name), ["Backlog", "Todo", "In Progress", "Listo para QA", "Done", "Canceled"]);
    const porNombre = Object.fromEntries(c.estados.map((/** @type {any} */ e) => [e.name, e]));
    assert.equal(porNombre.Todo.asignado, "todo");
    assert.equal(porNombre["In Progress"].asignado, "in_progress");
    assert.equal(porNombre["Listo para QA"].asignado, null);
    assert.equal(porNombre["Listo para QA"].suggested, "in_progress");
    assert.deepEqual(c.stateMap, mapa);
    assert.deepEqual(c.sinAsignar, ["Backlog", "Listo para QA", "Done", "Canceled"]);
    // El mapa promete "Blocked" y el equipo no lo tiene: setState fallaria en
    // el primer bloqueo. Se dice ahora, en el editor.
    assert.deepEqual(c.desconocidos, [{ canonico: "blocked", nombre: "Blocked" }]);
    assert.equal(c.nota, null);
  });
});

test("FR-002: el editor guarda por el PATCH de siempre, y la siguiente lectura ya lo refleja", async () => {
  const { mod } = linearGrabado();
  await conServicio({ motor: { intervaloMs: 0, cargarGestor: async () => mod } }, async (svc) => {
    const p = await proyectoActivo(svc, { conexiones: conexionLinear({ teamKey: "ENG" }) });
    const nuevo = { todo: "Todo", in_progress: "In Progress", blocked: null, in_review: "Listo para QA", done: "Done" };
    const g = await patch(svc, p.id, { stateMap: nuevo });
    assert.equal(g.estado, 200, JSON.stringify(g.cuerpo));
    const c = (await estados(svc, p.id)).cuerpo;
    assert.deepEqual(c.stateMap, nuevo);
    assert.deepEqual(c.sinAsignar, ["Backlog", "Canceled"]);
  });
});

test("FR-002, degradacion: un gestor sin listStates no inventa la lista — lo dice, y trae el mapa vigente", async () => {
  await conServicio({ motor: { intervaloMs: 0 } }, async (svc) => {
    const p = await proyectoActivo(svc, { conexiones: [{ clase: "tracker", proveedor: "fake" }] });
    const r = await estados(svc, p.id);
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
    assert.equal(r.cuerpo.listStates, false);
    assert.deepEqual(r.cuerpo.estados, []);
    assert.match(String(r.cuerpo.nota), /listStates/);
    assert.match(String(r.cuerpo.nota), /fake/);
    assert.equal(r.cuerpo.stateMap.todo, fake.fixtures.ctx.options.stateMap.todo);
  });
});

test("FR-002: un gestor que falla al listar sus estados contesta 200 con la causa textual, no un editor vacio mudo", async () => {
  const caido = { ...linearGrabado().mod, listStates: async () => { throw new Error("Linear: Authentication required"); } };
  await conServicio({ motor: { intervaloMs: 0, cargarGestor: async () => caido } }, async (svc) => {
    const p = await proyectoActivo(svc, { conexiones: conexionLinear({ teamKey: "ENG" }) });
    const r = await estados(svc, p.id);
    assert.equal(r.estado, 200);
    assert.equal(r.cuerpo.listStates, true);
    assert.deepEqual(r.cuerpo.estados, []);
    assert.match(String(r.cuerpo.nota), /Authentication required/);
  });
});

test("FR-002: el gestor del ESPACIO se lee pero no se edita desde un proyecto; el local no tiene estados que mapear", async () => {
  const { mod } = linearGrabado();
  await conServicio({ motor: { intervaloMs: 0, cargarGestor: async () => mod } }, async (svc) => {
    const p = await proyectoActivo(svc, {
      conexiones: [{ clase: "tracker", proveedor: "linear", delEspacio: true, capacidades: { opcionesDelGestor: { teamKey: "ENG" }, stateMap: MAPA_ESTADOS } }],
    });
    const r = await estados(svc, p.id);
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
    assert.equal(r.cuerpo.editable, false);
    assert.match(String(r.cuerpo.motivo), /espacio/);
    assert.ok(r.cuerpo.estados.length > 0);
  });
  await conServicio({ motor: { intervaloMs: 0 } }, async (svc) => {
    const local = await proyectoActivo(svc, { nombre: "Local", conexiones: [] });
    const r = await estados(svc, local.id);
    assert.equal(r.estado, 409);
    assert.equal(r.cuerpo.error.codigo, "sin_gestor");
    assert.equal((await estados(svc, "no-existe")).estado, 404);
  });
});

// ---------------------------------------------------------------- FR-004

test("FR-004: un run cuya issue salio de las reglas sale «movida», con su destino; y la consulta se cachea", async () => {
  const { mod, llamadas } = linearGrabado();
  let ahora = 1_000_000;
  await conServicio({ motor: { intervaloMs: 0, cargarGestor: async () => mod, reloj: () => ahora } }, async (svc) => {
    const p = await proyectoActivo(svc, { conexiones: conexionLinear({ teamKey: "ENG", reglas: { proyecto: "Plataforma" } }) });
    // ENG-124 vive en «Pagos»; este proyecto es el de «Plataforma».
    runEnDisco(svc.home, IDS.historia2, {
      projectId: p.id,
      item: { id: IDS.historia2, key: "ENG-124", title: "El PR queda adjunto al ticket", provider: "linear", url: "u", pr: null },
    });
    // ENG-321 esta cancelada: no es una movida, es una issue que ya no es trabajo.
    runEnDisco(svc.home, IDS.cancelada, {
      projectId: p.id,
      item: { id: IDS.cancelada, key: "ENG-321", title: "Cancelada", provider: "linear", url: "u", pr: null },
    });

    const board = await (await pedir(svc, `/v1/board?project=${p.id}`)).json();
    const movida = board.tarjetas.find((/** @type {any} */ t) => t.ticket.id === IDS.historia2);
    assert.ok(movida, "la tarjeta del run desaparecio");
    assert.equal(movida.chip?.tipo, "movida", JSON.stringify(movida.chip));
    assert.equal(movida.chip.destino, "Pagos");
    assert.match(movida.chip.texto, /Pagos/);
    assert.match(String(movida.chip.detalle), /ENG-124/);
    assert.match(String(movida.chip.detalle), /Settings/, "la accion se dice: donde se ajustan las reglas");
    assert.deepEqual({ destino: movida.movida.destino }, { destino: "Pagos" });

    const cancelada = board.tarjetas.find((/** @type {any} */ t) => t.ticket.id === IDS.cancelada);
    assert.ok(cancelada);
    assert.notEqual(cancelada.chip?.tipo, "movida");
    assert.equal(cancelada.movida ?? null, null);

    const consultas = llamadas.getItem;
    assert.equal(consultas, 2, "una consulta por run fuera del listado");
    await pedir(svc, `/v1/board?project=${p.id}`);
    assert.equal(llamadas.getItem, consultas, "la segunda pintada volvio a preguntar: la movida no entro en la cache");
    ahora += 31_000;
    await pedir(svc, `/v1/board?project=${p.id}`);
    assert.equal(llamadas.getItem, consultas + 2, "pasados 30 s se vuelve a preguntar, como el listado");
  });
});

test("FR-004: con el listado CORTADO no se afirma ninguna movida (la issue puede estar en la pagina siguiente)", async () => {
  const base = linearGrabado();
  const cortado = {
    ...base.mod,
    listItems: async (/** @type {any} */ q, /** @type {any} */ ctx) => ({ ...(await base.mod.listItems({ ...q, limit: 1 }, ctx)), nextCursor: "mas" }),
  };
  await conServicio({ motor: { intervaloMs: 0, cargarGestor: async () => cortado } }, async (svc) => {
    const p = await proyectoActivo(svc, { conexiones: conexionLinear({ teamKey: "ENG", reglas: { proyecto: "Plataforma" } }) });
    runEnDisco(svc.home, IDS.historia2, {
      projectId: p.id,
      item: { id: IDS.historia2, key: "ENG-124", title: "t", provider: "linear", url: "u", pr: null },
    });
    const board = await (await pedir(svc, `/v1/board?project=${p.id}`)).json();
    const t = board.tarjetas.find((/** @type {any} */ x) => x.ticket.id === IDS.historia2);
    assert.notEqual(t.chip?.tipo, "movida");
    assert.equal(base.llamadas.getItem, 0, "sin la pagina completa no hay nada que preguntar");
  });
});
