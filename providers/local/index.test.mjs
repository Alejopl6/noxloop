// El gestor local (spec 003, FR-030) pasa el MISMO contrato que Linear.
//
// LO QUE ESTE TEST DEFIENDE, ademas de la suite. El gestor local tiene un
// unico escritor —el servicio de control (principio VIII)— y dos caminos para
// llegar a el: dentro del servicio recibe la interfaz del almacen inyectada en
// `ctx.tareas`; dentro del motor, que es otro proceso, habla por HTTP con el
// servicio usando el token de sesion que le llega por entorno. Se prueban los
// dos, y se prueba que el proveedor no tiene con que escribir un archivo por su
// cuenta.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { contractChecks, validateListPage, validateProvider } from "../contract.mjs";
import * as local from "./index.mjs";

test("el gestor local pasa el contrato completo", async () => {
  for (const check of contractChecks(local, local.fixtures)) await check.run();
});

test("declara la verdad: sabe listar, mover el estado y comentar; no sabe hijos, dependencias ni bandeja", () => {
  assert.equal(validateProvider(local).ok, true);
  const caps = local.capabilities();
  assert.equal(caps.listItems, true);
  assert.equal(caps.setState, true);
  assert.equal(caps.comment, true);
  for (const k of ["children", "dependencies", "createChild", "searchAssigned", "searchMentioned", "linkUrl"]) {
    assert.equal(caps[k], false, `${k}: el gestor local no lo implementa y no puede decir que si`);
  }
});

test("NO ESCRIBE POR SU CUENTA: no importa ni el sistema de archivos, ni SQLite, ni el almacen", () => {
  const fuente = readFileSync(new URL("./index.mjs", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  for (const prohibido of [/node:fs/, /node:sqlite/, /packages\/store/, /child_process/]) {
    assert.ok(!prohibido.test(fuente), `el proveedor local importa ${prohibido}: tendria con que ser un segundo escritor`);
  }
});

test("un `backlog` del gestor local se LISTA como backlog, y en `getItem` es `todo` (el Item solo conoce los cinco)", async () => {
  const { ctx, puerto } = local.fixturesConPuerto();
  puerto.sembrar({ id: "b1", key: "PAY-9", titulo: "algun dia", estado: "backlog", criterios: ["x"] });
  const pagina = await local.listItems({ limit: 50 }, ctx);
  assert.equal(pagina.items.find((i) => i.id === "b1").canonicalState, "backlog");
  assert.equal((await local.getItem("b1", ctx)).canonicalState, "todo");
});

test("listItems devuelve el ejecutor y el termino de la tarea en `raw`, para que el board resuelva la cascada", async () => {
  const { ctx, puerto } = local.fixturesConPuerto();
  puerto.sembrar({ id: "e1", key: "PAY-3", titulo: "con ejecutor", ejecutor: { runtime: "codex", agente: null }, termino: "commit" });
  const item = (await local.listItems({ limit: 50 }, ctx)).items.find((i) => i.id === "e1");
  assert.deepEqual(item.raw.ejecutor, { runtime: "codex", agente: null });
  assert.equal(item.raw.termino, "commit");
});

// ---------------------------------------------------------------------------
// Dentro del motor: por HTTP, contra el servicio
// ---------------------------------------------------------------------------

/** Un servicio de mentira: registra lo que se le pide y contesta lo guionado. */
function servicioFalso(respuestas) {
  const pedidas = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    pedidas.push({ metodo: init.method ?? "GET", ruta: u.pathname, query: u.search, cabeceras: init.headers ?? {}, cuerpo: init.body ? JSON.parse(init.body) : null });
    const clave = `${init.method ?? "GET"} ${u.pathname}`;
    const [estado, cuerpo] = respuestas[clave] ?? [404, { error: { codigo: "recurso_desconocido", causa: "no hay", accion: "pide otra" } }];
    return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "content-type": "application/json" } });
  };
  return { fetch, pedidas };
}

const TAREA = {
  id: "t-1",
  projectId: "p-1",
  key: "PAY-1",
  titulo: "cobrar",
  plan: "## plan",
  criterios: ["cobra en un clic"],
  prioridad: 1,
  etiquetas: ["api"],
  ejecutor: null,
  termino: "pr",
  estado: "todo",
  actualizado: "2026-09-24T10:00:00.000Z",
};

const ctxHttp = (fetch) => ({
  options: { projectId: "p-1", stateMap: local.ESTADOS },
  env: { NOXLOOP_SERVICE_URL: "http://127.0.0.1:4999", NOXLOOP_SERVICE_TOKEN: "tok-de-sesion" },
  log: { info() {}, warn() {}, error() {} },
  fetch,
});

test("dentro del motor lee y escribe POR EL SERVICIO, con el token de sesion en la cabecera y nunca en la URL", async () => {
  const { fetch, pedidas } = servicioFalso({
    "GET /v1/tasks/t-1": [200, { tarea: TAREA }],
    "PATCH /v1/tasks/t-1": [200, { tarea: { ...TAREA, estado: "in_progress" } }],
    "POST /v1/tasks/t-1/comments": [201, { comentario: { id: "c-1" } }],
    "GET /v1/projects/p-1/tasks": [200, { items: [TAREA], total: 1, cursor: null, avisos: [] }],
  });
  const ctx = ctxHttp(fetch);

  const item = await local.getItem("t-1", ctx);
  assert.equal(item.key, "PAY-1");
  assert.equal(item.title, "cobrar");
  assert.equal(item.body, "## plan", "el plan markdown es el cuerpo que el planificador lee");
  assert.deepEqual(item.acceptance, ["cobra en un clic"]);

  assert.deepEqual(await local.setState("t-1", "in_progress", ctx), { written: "in_progress" });
  assert.deepEqual(await local.comment("t-1", "PR abierto", ctx), { id: "c-1" });
  const pagina = await local.listItems({ limit: 10, includeDone: true }, ctx);
  assert.equal(validateListPage(pagina, { limit: 10, includeDone: true }).ok, true);

  for (const p of pedidas) {
    assert.equal(p.cabeceras["x-noxloop-token"], "tok-de-sesion");
    assert.ok(!p.query.includes("tok-de-sesion"), "el token en la URL queda en cualquier log");
  }
  assert.deepEqual(pedidas.find((p) => p.metodo === "PATCH").cuerpo, { estado: "in_progress" });
  assert.deepEqual(pedidas.find((p) => p.metodo === "POST").cuerpo, { texto: "PR abierto" });
  assert.match(pedidas.find((p) => p.ruta.endsWith("/tasks")).query, /includeDone=1/);
});

test("un 404 del servicio es `null` en getItem; cualquier otro fallo lleva la causa del servicio", async () => {
  const { fetch } = servicioFalso({
    "PATCH /v1/tasks/t-1": [409, { error: { codigo: "x", causa: "la tarea cambio por debajo", accion: "relee" } }],
  });
  const ctx = ctxHttp(fetch);
  assert.equal(await local.getItem("no-existe", ctx), null);
  await assert.rejects(() => local.setState("t-1", "in_progress", ctx), /la tarea cambio por debajo/);
});

test("sin interfaz inyectada y sin el servicio en el entorno, falla DICIENDO que falta", async () => {
  const ctx = { options: { projectId: "p" }, env: {}, log: console, fetch: async () => { throw new Error("no"); } };
  await assert.rejects(() => local.getItem("t", ctx), /NOXLOOP_SERVICE_URL/);
});
