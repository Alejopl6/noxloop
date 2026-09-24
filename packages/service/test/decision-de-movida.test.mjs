// «Seguir aqui» o «Soltarla»: la decision sobre una tarjeta «movida»
// (spec 005, US1 escenario 4, FR-004).
//
// LO QUE SE PRUEBA AQUI, Y POR QUE ASI:
//
//   1. `construirBoard` es PURA: la regla se prueba sin servicio. `seguir` deja
//      la tarjeta sin el chip «movida» (con el del run); `soltar` la saca del
//      board; una decision tomada para OTRO destino no vale (se vuelve a
//      preguntar); una decision sobre una issue que vuelve a cumplir las reglas
//      no pinta nada distinto.
//   2. La ruta, con el servicio de verdad y el proveedor de Linear sobre las
//      respuestas GRABADAS: valida, guarda, avisa por SSE, no le escribe NADA
//      al gestor (se cuenta cada llamada) y no toca el run en disco. Cambiar las
//      reglas del gestor olvida las decisiones del proyecto.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { construirBoard } from "../src/board.mjs";
import * as linear from "../../../providers/linear/index.mjs";
import { nuevoCtx, IDS, MAPA_ESTADOS } from "../../../providers/linear/fixtures.mjs";
import { conServicio, eventos, leerFrames, pedir } from "./ayuda.mjs";
import { proyectoActivo, runEnDisco } from "./ayuda-motor.mjs";

// ---------------------------------------------------------------------------
// 1. La regla, pura
// ---------------------------------------------------------------------------

const PROYECTO = { id: "prj-1", nombre: "Plataforma", estado: "ACTIVE" };

/** @param {Record<string, any>} [extra] */
const parte = (extra = {}) => ({
  proyecto: PROYECTO,
  gestor: "linear",
  listItems: true,
  tickets: [],
  runs: [],
  nota: null,
  lanzable: true,
  tieneRepo: true,
  motivo: null,
  ...extra,
});

/** @param {string} itemId @param {string} estado */
const run = (itemId, estado) => ({
  itemId,
  estado,
  detalle: null,
  posicion: null,
  pr: null,
  avance: null,
  gasto: { usd: 0, calls: 0, medido: true },
  titulo: `ticket ${itemId}`,
  key: `ENG-${itemId}`,
  url: null,
});

const MOVIDA = { destino: "Pagos", detalle: "ENG-7 ya no cumple las reglas de este proyecto: ahora esta en «Pagos»." };

/** @param {any} decisiones */
const boardCon = (decisiones) =>
  construirBoard({
    partes: [
      parte({
        runs: [run("7", "corriendo"), run("8", "corriendo")],
        movidas: new Map([
          ["7", MOVIDA],
          ["8", MOVIDA],
        ]),
        decisiones,
      }),
    ],
  });

/** @param {any} b @param {string} id */
const tarjeta = (b, id) => b.tarjetas.find((/** @type {any} */ t) => t.ticket.id === id);

test("pura: sin decision, la movida sale con su chip (como hasta ahora)", () => {
  const b = boardCon(new Map());
  assert.equal(tarjeta(b, "7").chip?.tipo, "movida");
  assert.equal(tarjeta(b, "7").movida.destino, "Pagos");
});

test("pura: `seguir` deja la tarjeta en el board sin el chip «movida», con el chip de su run", () => {
  const b = boardCon(new Map([["7", { decision: "seguir", destino: "Pagos", decidida: "t" }]]));
  const t = tarjeta(b, "7");
  assert.ok(t, "seguir no puede sacar la tarjeta");
  assert.notEqual(t.chip?.tipo, "movida");
  assert.equal(t.movida ?? null, null, "sin chip no hay decision pendiente que ofrecer");
  assert.equal(t.run.estado, "corriendo", "el run sigue siendo de este proyecto");
  assert.equal(tarjeta(b, "8").chip?.tipo, "movida", "la decision es por item: la otra sigue preguntando");
});

test("pura: `soltar` saca la tarjeta del board, y no cuenta en el resumen", () => {
  const b = boardCon(new Map([["7", { decision: "soltar", destino: "Pagos", decidida: "t" }]]));
  assert.equal(tarjeta(b, "7"), undefined);
  assert.ok(tarjeta(b, "8"));
  assert.equal(b.resumen.enCurso, 1);
  assert.equal(b.columnas.find((/** @type {any} */ c) => c.id === "in_progress").total, 1);
});

test("pura: una decision tomada para OTRO destino no vale — la issue se volvio a mover y se vuelve a preguntar", () => {
  const b = boardCon(new Map([["7", { decision: "soltar", destino: "Facturacion", decidida: "t" }]]));
  assert.equal(tarjeta(b, "7").chip?.tipo, "movida");
});

test("pura: una decision sin destino (el gestor no lo dijo) vale para cualquiera", () => {
  const b = boardCon(new Map([["7", { decision: "seguir", destino: null, decidida: "t" }]]));
  assert.notEqual(tarjeta(b, "7").chip?.tipo, "movida");
});

test("pura: si la issue vuelve a cumplir las reglas, la decision no pinta nada (ni `soltar` la esconde)", () => {
  const b = construirBoard({
    partes: [
      parte({
        tickets: [{ id: "7", key: "ENG-7", title: "t", canonicalState: "in_progress" }],
        runs: [run("7", "corriendo")],
        movidas: new Map(),
        decisiones: new Map([["7", { decision: "soltar", destino: "Pagos", decidida: "t" }]]),
      }),
    ],
  });
  assert.ok(tarjeta(b, "7"), "listada por las reglas, es del proyecto: se pinta");
  assert.notEqual(tarjeta(b, "7").chip?.tipo, "movida");
});

// ---------------------------------------------------------------------------
// 2. La ruta
// ---------------------------------------------------------------------------

/** El proveedor de Linear con la red grabada y CADA funcion contada. */
function linearContado() {
  const { ctx: grabado } = nuevoCtx();
  const llamadas = /** @type {string[]} */ ([]);
  const conRed = (/** @type {any} */ ctx) => ({ ...ctx, fetch: grabado.fetch, env: grabado.env });
  /** @type {any} */
  const mod = { ...linear, requiredEnv: [] };
  for (const [k, v] of Object.entries(linear)) {
    if (typeof v !== "function" || k === "capabilities") continue;
    mod[k] = (/** @type {any[]} */ ...args) => {
      llamadas.push(k);
      // El `ctx` es el ultimo argumento en todas las funciones del contrato.
      const ultimo = args.length - 1;
      if (ultimo >= 0 && args[ultimo] && typeof args[ultimo] === "object" && "options" in args[ultimo]) {
        args[ultimo] = conRed(args[ultimo]);
      }
      return /** @type {any} */ (v)(...args);
    };
  }
  return { mod, llamadas };
}

const conexionLinear = (/** @type {any} */ opciones) => [
  { clase: "tracker", proveedor: "linear", capacidades: { opcionesDelGestor: opciones, stateMap: MAPA_ESTADOS } },
];

/** @param {any} svc @param {string} proyectoId @param {string} itemId @param {any} cuerpo */
async function decidir(svc, proyectoId, itemId, cuerpo) {
  const r = await pedir(svc, `/v1/projects/${proyectoId}/board/movidas/${encodeURIComponent(itemId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  return { estado: r.status, cuerpo: await r.json() };
}

/** @param {any} svc @param {string} proyectoId */
async function laMovida(svc, proyectoId) {
  const board = await (await pedir(svc, `/v1/board?project=${proyectoId}`)).json();
  return board.tarjetas.find((/** @type {any} */ t) => t.ticket.id === IDS.historia2);
}

/** Un proyecto de «Plataforma» con un run sobre ENG-124, que vive en «Pagos». */
async function conMovida(/** @type {any} */ svc) {
  const p = await proyectoActivo(svc, { conexiones: conexionLinear({ teamKey: "ENG", reglas: { proyecto: "Plataforma" } }) });
  runEnDisco(svc.home, IDS.historia2, {
    projectId: p.id,
    item: { id: IDS.historia2, key: "ENG-124", title: "El PR queda adjunto al ticket", provider: "linear", url: "u", pr: null },
  });
  return p;
}

test("POST /board/movidas/:itemId `seguir`: la tarjeta se queda sin chip, avisa por SSE y el gestor no se entera", async () => {
  const { mod, llamadas } = linearContado();
  await conServicio({ motor: { intervaloMs: 0, cargarGestor: async () => mod } }, async (svc) => {
    const p = await conMovida(svc);
    assert.equal((await laMovida(svc, p.id)).chip?.tipo, "movida");

    const canal = await pedir(svc, "/v1/events");
    const pendientes = leerFrames(canal, (f) => eventos(f).some((e) => e.tipo === "board.invalidado"), 3000);
    const antes = llamadas.length;
    const r = await decidir(svc, p.id, IDS.historia2, { decision: "seguir" });
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
    assert.equal(r.cuerpo.decision.itemId, IDS.historia2);
    assert.equal(r.cuerpo.decision.decision, "seguir");
    assert.equal(r.cuerpo.decision.destino, "Pagos", "el destino sale de lo que el board acaba de pintar");
    assert.deepEqual(llamadas.slice(antes), [], "decidir no le pregunta ni le escribe nada al gestor");
    const frames = eventos(await pendientes);
    assert.ok(
      frames.some((e) => e.tipo === "board.invalidado" && e.datos.datos.projectId === p.id),
      `sin \`board.invalidado\` las demas ventanas siguen con el chip: ${JSON.stringify(frames)}`,
    );

    const t = await laMovida(svc, p.id);
    assert.ok(t, "seguir no saca la tarjeta");
    assert.notEqual(t.chip?.tipo, "movida");
    assert.equal(t.movida ?? null, null);
  });
});

test("POST `soltar`: la tarjeta deja de pintarse, y el run en disco queda exactamente como estaba", async () => {
  const { mod, llamadas } = linearContado();
  await conServicio({ motor: { intervaloMs: 0, cargarGestor: async () => mod } }, async (svc) => {
    const p = await conMovida(svc);
    await laMovida(svc, p.id);
    const archivo = join(svc.home, "runs", `run-${IDS.historia2}.json`);
    const antes = readFileSync(archivo, "utf8");
    const escrituras = ["setState", "linkUrl", "comment", "createItem", "updateItem"];

    const r = await decidir(svc, p.id, IDS.historia2, { decision: "soltar" });
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
    assert.equal(await laMovida(svc, p.id), undefined, "soltada, no se pinta en este board");
    assert.equal(readFileSync(archivo, "utf8"), antes, "soltar no toca el run: es del motor");
    assert.deepEqual(llamadas.filter((x) => escrituras.includes(x)), [], "soltar no escribe en Linear");
  });
});

test("POST: proyecto que no existe 404, decision fuera del enum 400 con las opciones, item sin run en el proyecto 404", async () => {
  const { mod } = linearContado();
  await conServicio({ motor: { intervaloMs: 0, cargarGestor: async () => mod } }, async (svc) => {
    const p = await conMovida(svc);
    assert.equal((await decidir(svc, "no-existe", IDS.historia2, { decision: "seguir" })).estado, 404);

    const mal = await decidir(svc, p.id, IDS.historia2, { decision: "borrar" });
    assert.equal(mal.estado, 400);
    assert.equal(mal.cuerpo.error.codigo, "cuerpo_invalido");
    assert.match(JSON.stringify(mal.cuerpo.error), /seguir/);
    assert.match(JSON.stringify(mal.cuerpo.error), /soltar/);

    const sinCuerpo = await decidir(svc, p.id, IDS.historia2, {});
    assert.equal(sinCuerpo.estado, 400);

    const sinRun = await decidir(svc, p.id, "otra-issue", { decision: "seguir" });
    assert.equal(sinRun.estado, 404);
    assert.equal(sinRun.cuerpo.error.codigo, "recurso_desconocido");
    assert.equal((await laMovida(svc, p.id)).chip?.tipo, "movida", "nada de lo rechazado se guardo");
  });
});

test("la decision se OLVIDA si la issue vuelve a cumplir las reglas: al salir otra vez, se vuelve a preguntar", async () => {
  const { mod } = linearContado();
  await conServicio({ motor: { intervaloMs: 0, cargarGestor: async () => mod } }, async (svc) => {
    const p = await conMovida(svc);
    await laMovida(svc, p.id);
    assert.equal((await decidir(svc, p.id, IDS.historia2, { decision: "soltar" })).estado, 200);
    assert.equal(await laMovida(svc, p.id), undefined);

    /** @param {any} opciones */
    const reglas = async (opciones) => {
      const r = await pedir(svc, `/v1/projects/${p.id}/tracker`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ opciones }),
      });
      assert.equal(r.status, 200, await r.clone().text());
    };
    // Las reglas ahora dejan pasar «Pagos»: la issue vuelve a ser del proyecto.
    await reglas({ teamKey: "ENG", reglas: { proyecto: "Pagos" } });
    const vuelta = await laMovida(svc, p.id);
    assert.ok(vuelta, "cumple las reglas: se pinta aunque se hubiera soltado");
    assert.notEqual(vuelta.chip?.tipo, "movida");

    // Y si vuelve a salir, la decision vieja no la esconde en silencio.
    await reglas({ teamKey: "ENG", reglas: { proyecto: "Plataforma" } });
    assert.equal((await laMovida(svc, p.id))?.chip?.tipo, "movida");
  });
});
