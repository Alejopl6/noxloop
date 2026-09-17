import { test } from "node:test";
import assert from "node:assert/strict";
import { progressEvents, reduceMessages, runPhase, sdkAvailable } from "../src/runner.mjs";

// Mensajes con la forma que emite el stream del Agent SDK.
const init = (sessionId, model = "claude-opus-5") => ({
  type: "system", subtype: "init", session_id: sessionId, model,
});
const asistente = (bloques) => ({ type: "assistant", message: { content: bloques } });
const resultado = (over = {}) => ({
  type: "result", subtype: "success", is_error: false, session_id: "s1",
  num_turns: 3, total_cost_usd: 1.25, result: "listo", ...over,
});

const stream = (mensajes) => (async function* () { for (const m of mensajes) yield m; })();

// ------------------------------------------------------- progressEvents

test("traduce el init y las llamadas a herramienta", () => {
  assert.deepEqual(progressEvents(init("s1")), [
    { tipo: "init", detalle: { sessionId: "s1", model: "claude-opus-5" } },
  ]);
  const e = progressEvents(asistente([
    { type: "text", text: "voy a leer el archivo" },
    { type: "tool_use", name: "Read", id: "t1", input: { file_path: "a.mjs" } },
  ]));
  assert.deepEqual(e, [{ tipo: "tool_use", detalle: { nombre: "Read", id: "t1", entrada: { file_path: "a.mjs" } } }]);
});

test("un mensaje que no se entiende no produce eventos ni lanza", () => {
  assert.deepEqual(progressEvents(null), []);
  assert.deepEqual(progressEvents("texto suelto"), []);
  assert.deepEqual(progressEvents({ type: "desconocido" }), []);
});

// ------------------------------------------------------- reduceMessages

test("reduce un turno exitoso a un hecho", async () => {
  const r = await reduceMessages(stream([init("s1"), asistente([{ type: "text", text: "ok" }]), resultado()]));
  assert.equal(r.ok, true);
  assert.equal(r.sessionId, "s1");
  assert.equal(r.turns, 3);
  assert.equal(r.usd, 1.25);
  assert.equal(r.budgetExhausted, false);
});

test("el corte por presupuesto NO es ok, y viaja como campo propio", async () => {
  const r = await reduceMessages(stream([
    init("s1"), resultado({ subtype: "error_max_budget_usd", is_error: true, total_cost_usd: 8.01 }),
  ]));
  // Es el fallo medido: 13 invocaciones aterrizaron contra el techo y se
  // registraron como exit 0. Un corte a mitad anotado como exito es el "verde
  // inventado" que el harness existe para evitar.
  assert.equal(r.budgetExhausted, true);
  assert.equal(r.ok, false);
  assert.equal(r.subtype, "error_max_budget_usd");
});

test("distingue un error del turno de un corte por presupuesto", async () => {
  const r = await reduceMessages(stream([init("s1"), resultado({ is_error: true, subtype: "error_during_execution" })]));
  assert.equal(r.ok, false);
  assert.equal(r.budgetExhausted, false);
  assert.equal(r.isError, true);
});

test("con forkSession se queda con el sessionId NUEVO, no con el que se paso", async () => {
  // El init de una bifurcacion trae un id distinto del que se pidio retomar.
  // Quedarse con el viejo perderia la bifurcacion y el proximo resume volveria
  // a la rama equivocada de la conversacion.
  const r = await reduceMessages(stream([init("s2-fork"), resultado({ session_id: "s2-fork" })]));
  assert.equal(r.sessionId, "s2-fork");
});

test("un stream que se corta sin result no se da por bueno", async () => {
  const r = await reduceMessages(stream([init("s1"), asistente([{ type: "text", text: "a medias" }])]));
  assert.equal(r.ok, false);
  assert.match(r.text, /sin resultado|incompleto/i);
});

test("acumula el texto parcial de una sola fuente, sin duplicarlo", async () => {
  const r = await reduceMessages(stream([
    init("s1"),
    { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "hola " } } },
    { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "mundo" } } },
    asistente([{ type: "text", text: "hola mundo" }]),
    resultado({ result: "hola mundo" }),
  ]));
  assert.equal(r.text, "hola mundo");
});

test("informa el progreso mientras corre, no solo al final", async () => {
  const vistos = [];
  await reduceMessages(
    stream([init("s1"), asistente([{ type: "tool_use", name: "Bash", id: "t1", input: {} }]), resultado()]),
    { onProgress: (e) => vistos.push(e.tipo) },
  );
  assert.deepEqual(vistos, ["init", "tool_use"]);
});

// ------------------------------------------------------------- runPhase

test("pasa resume y fork al transporte: es lo que reusa el contexto entre fases", async () => {
  let recibido = null;
  await runPhase(
    { prompt: "/x", cwd: "/tmp", resume: "s1", fork: true, model: "claude-sonnet-5", effort: "high" },
    { transport: (o) => { recibido = o; return stream([init("s1"), resultado()]); } },
  );
  assert.equal(recibido.resume, "s1");
  assert.equal(recibido.fork, true);
  assert.equal(recibido.model, "claude-sonnet-5");
  assert.equal(recibido.effort, "high");
});

test("sin resume no manda fork: bifurcar de nada no significa nada", async () => {
  let recibido = null;
  await runPhase(
    { prompt: "/x", cwd: "/tmp", fork: true },
    { transport: (o) => { recibido = o; return stream([init("s1"), resultado()]); } },
  );
  assert.equal(recibido.fork, false);
});

test("nunca pasa un techo de costo por invocacion", async () => {
  let recibido = null;
  await runPhase(
    { prompt: "/x", cwd: "/tmp", maxCostUsd: 8 },
    { transport: (o) => { recibido = o; return stream([init("s1"), resultado()]); } },
  );
  // El techo es por hito, no por invocacion: uno por invocacion corta a mitad
  // de una unidad de trabajo indivisible y el reintento cuesta mas que lo que
  // el techo ahorro.
  assert.ok(!("maxBudgetUsd" in recibido), "un techo por invocacion es una amputacion, no un ahorro");
});

test("un transporte que lanza se reporta como fallo, no se propaga", async () => {
  const r = await runPhase(
    { prompt: "/x", cwd: "/tmp" },
    { transport: () => { throw new Error("el SDK no esta instalado"); } },
  );
  assert.equal(r.ok, false);
  assert.match(r.text, /SDK no esta instalado/);
});

test("declara por que via corrio", async () => {
  const r = await runPhase(
    { prompt: "/x", cwd: "/tmp" },
    { transport: () => stream([init("s1"), resultado()]), via: "agent-sdk" },
  );
  assert.equal(r.via, "agent-sdk");
});

test("sdkAvailable responde sin lanzar, este o no el paquete", () => {
  assert.equal(typeof sdkAvailable(), "boolean");
});
