// Los eventos del runtime, normalizados: lo que el transcript de una fase
// guarda, sin saber que runtime corrio (spec 004, FR-004).
//
// POR QUE SE NORMALIZA EN EL ADAPTADOR Y NO EN EL MOTOR. Cada runtime habla su
// protocolo —mensajes del SDK de Claude, un evento JSON por linea en Codex, el
// guion del falso—, y el motor no puede preguntar «¿cual es?» sin el `if` que
// el principio VI prohibe. El adaptador ya lee esa salida para sacar el
// resultado; aqui la traduce ademas a cinco tipos que cualquiera puede pintar.
//
// LO QUE SE MIDE: la forma (los cinco tipos, `t`, `contenido` como texto), que
// los tokens son los que el runtime reporto y no un cero inventado, que el
// orden es el del stream, y que un transcript roto no tumba la fase.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TIPOS_DE_EVENTO, validarEvento } from "../src/contrato.mjs";
import {
  CONTENIDO_MAXIMO,
  emisorDeEventos,
  eventosDeLineaCodex,
  eventosDeMensajeClaude,
  tokensDeUsoClaude,
  tokensDeUsoCodex,
} from "../src/eventos.mjs";
import { lanzar } from "../src/proceso.mjs";
import { leerResultadoStreamJson } from "../src/salida.mjs";
import { crearAdaptadorFake } from "../src/adaptadores/fake.mjs";
import { crearAdaptadorClaude } from "../src/adaptadores/claude-agent-sdk.mjs";

/** Lo que el emisor añade: el instante. Los normalizadores no lo ponen; el emisor si. */
const conT = (/** @type {any} */ e) => ({ t: new Date().toISOString(), ...e });

test("los cinco tipos del transcript, y ni uno mas", () => {
  assert.deepEqual([...TIPOS_DE_EVENTO], ["texto", "herramienta", "resultado_herramienta", "resultado", "error"]);
});

test("validarEvento: exige tipo conocido, t ISO y contenido de texto", () => {
  assert.equal(validarEvento({ t: new Date().toISOString(), tipo: "texto", contenido: "hola" }).ok, true);
  assert.equal(validarEvento({ t: "ayer", tipo: "texto", contenido: "hola" }).ok, false);
  assert.equal(validarEvento({ t: new Date().toISOString(), tipo: "pensamiento", contenido: "x" }).ok, false);
  assert.equal(validarEvento({ t: new Date().toISOString(), tipo: "texto", contenido: 3 }).ok, false);
  // Los tokens, si vienen, son numeros: un «0» de texto es un cero fingido.
  const conTokens = { t: new Date().toISOString(), tipo: "resultado", contenido: "", tokens: { entrada: "0", salida: 1 } };
  assert.equal(validarEvento(conTokens).ok, false);
});

test("un mensaje del SDK de Claude se parte en texto, herramienta y su resultado, con el nombre de la herramienta", () => {
  const herramientas = new Map();
  const a = eventosDeMensajeClaude(
    {
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "esto no se guarda" },
          { type: "text", text: "Voy a leer el **test**." },
          { type: "tool_use", id: "tu_1", name: "Read", input: { file_path: "test/a.test.mjs" } },
        ],
      },
    },
    herramientas,
  );
  assert.deepEqual(
    a.map((e) => [e.tipo, e.herramienta ?? null]),
    [["texto", null], ["herramienta", "Read"]],
  );
  assert.match(a[1].contenido, /test\/a\.test\.mjs/);

  const u = eventosDeMensajeClaude(
    {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "tu_1", content: [{ type: "text", text: "contenido del test" }] }] },
    },
    herramientas,
  );
  assert.equal(u.length, 1);
  assert.equal(u[0].tipo, "resultado_herramienta");
  // El resultado sabe DE QUE herramienta es: sin esto la interfaz pinta un
  // resultado huerfano y el operador tiene que casar ids a ojo.
  assert.equal(u[0].herramienta, "Read");
  assert.equal(u[0].contenido, "contenido del test");
  for (const e of [...a, ...u]) assert.equal(validarEvento(conT(e)).ok, true, JSON.stringify(e));
});

test("el resultado de Claude lleva los tokens que el runtime reporto; sin `usage`, no se inventan", () => {
  const herramientas = new Map();
  const [r] = eventosDeMensajeClaude(
    {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "listo",
      usage: { input_tokens: 120, output_tokens: 45, cache_read_input_tokens: 800, cache_creation_input_tokens: 30 },
    },
    herramientas,
  );
  assert.equal(r.tipo, "resultado");
  assert.deepEqual(r.tokens, { entrada: 120, salida: 45, cacheLectura: 800, cacheEscritura: 30 });

  const [sin] = eventosDeMensajeClaude({ type: "result", is_error: false, result: "listo" }, herramientas);
  assert.equal(sin.tokens, undefined, "sin `usage` no hay tokens: un cero seria un «medido» falso");

  const [mal] = eventosDeMensajeClaude({ type: "result", is_error: true, subtype: "error_max_turns", result: "" }, herramientas);
  assert.equal(mal.tipo, "error");
  assert.match(mal.contenido, /error_max_turns/);

  // Los parciales del stream no se guardan: el mensaje completo llega despues,
  // y guardar los dos duplicaria cada palabra.
  assert.deepEqual(eventosDeMensajeClaude({ type: "stream_event", event: { type: "content_block_delta" } }, herramientas), []);
  assert.deepEqual(eventosDeMensajeClaude({ type: "system", subtype: "init" }, herramientas), []);
});

test("tokens: los campos que el runtime no da quedan en null, no en cero", () => {
  assert.deepEqual(tokensDeUsoClaude({ input_tokens: 1, output_tokens: 2 }), {
    entrada: 1, salida: 2, cacheLectura: null, cacheEscritura: null,
  });
  assert.equal(tokensDeUsoClaude(undefined), undefined);
  assert.equal(tokensDeUsoClaude({}), undefined);
  assert.deepEqual(tokensDeUsoCodex({ input_tokens: 10, cached_input_tokens: 4, output_tokens: 20 }), {
    entrada: 10, salida: 20, cacheLectura: 4, cacheEscritura: null,
  });
});

test("una linea de Codex: mensaje, comando con su salida, archivos, fin de turno y fallo", () => {
  const estado = { ultimoMensaje: "" };
  const lineas = [
    { type: "thread.started", thread_id: "h-1" },
    { type: "item.completed", item: { type: "reasoning", text: "no se guarda" } },
    { type: "item.completed", item: { type: "agent_message", text: "Corro los tests." } },
    { type: "item.completed", item: { type: "command_execution", command: "npm test", aggregated_output: "ok 3", exit_code: 0 } },
    { type: "item.completed", item: { type: "file_change", changes: [{ path: "src/a.mjs", kind: "update" }] } },
    { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 20 } },
  ];
  const eventos = lineas.flatMap((l) => eventosDeLineaCodex(l, estado));
  assert.deepEqual(
    eventos.map((e) => [e.tipo, e.herramienta ?? null]),
    [
      ["texto", null],
      ["herramienta", "shell"],
      ["resultado_herramienta", "shell"],
      ["herramienta", "edicion"],
      ["resultado", null],
    ],
  );
  assert.match(eventos[1].contenido, /npm test/);
  assert.match(eventos[2].contenido, /ok 3/);
  assert.match(eventos[3].contenido, /src\/a\.mjs/);
  assert.equal(eventos.at(-1).contenido, "Corro los tests.");
  assert.deepEqual(eventos.at(-1).tokens, { entrada: 10, salida: 20, cacheLectura: null, cacheEscritura: null });
  for (const e of eventos) assert.equal(validarEvento(conT(e)).ok, true, JSON.stringify(e));

  const [fallo] = eventosDeLineaCodex({ type: "turn.failed", error: { message: "sin cuota" } }, estado);
  assert.equal(fallo.tipo, "error");
  assert.equal(fallo.contenido, "sin cuota");
});

test("el contenido enorme se recorta DICIENDOLO, y el emisor no deja que un callback roto tumbe la fase", () => {
  const recibidos = [];
  const emitir = emisorDeEventos((e) => recibidos.push(e));
  emitir({ tipo: "texto", contenido: "x".repeat(CONTENIDO_MAXIMO + 500) });
  assert.equal(recibidos.length, 1);
  assert.ok(recibidos[0].contenido.length < CONTENIDO_MAXIMO + 200);
  assert.match(recibidos[0].contenido, /recortado: 500 caracteres mas/);
  assert.equal(validarEvento(recibidos[0]).ok, true);

  const roto = emisorDeEventos(() => {
    throw new Error("el disco se lleno");
  });
  assert.doesNotThrow(() => roto({ tipo: "texto", contenido: "hola" }));
  // Sin callback, el emisor es un no-op y no un error.
  assert.doesNotThrow(() => emisorDeEventos(undefined)({ tipo: "texto", contenido: "hola" }));
});

test("lanzar entrega la salida por lineas MIENTRAS el proceso corre, no al final", async () => {
  const lineas = [];
  let antesDeTerminar = 0;
  const codigo = [
    'process.stdout.write("uno\\n");',
    'setTimeout(() => process.stdout.write("dos\\ntr"), 50);',
    'setTimeout(() => process.stdout.write("es"), 100);',
  ].join("");
  const l = await lanzar({
    comando: process.execPath,
    args: ["-e", codigo],
    env: {},
    cwd: tmpdir(),
    alLinea: (x) => {
      lineas.push(x);
      antesDeTerminar++;
    },
  });
  assert.equal(l.code, 0);
  // La ultima llega sin salto de linea y se entrega igual al cerrar: un
  // runtime que no termina su ultima linea no pierde su resultado.
  assert.deepEqual(lineas, ["uno", "dos", "tres"]);
  assert.equal(antesDeTerminar, 3);
});

test("leerResultadoStreamJson: un objeto suelto o el ultimo `result` de un stream por lineas", () => {
  const suelto = leerResultadoStreamJson(JSON.stringify({ session_id: "s", is_error: false, result: "hola", total_cost_usd: null }));
  assert.equal(suelto.texto, "hola");
  const stream = [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "pienso" }] } }),
    "una advertencia en texto plano",
    JSON.stringify({ type: "result", session_id: "s2", is_error: true, subtype: "error", result: "fallo", usage: { input_tokens: 1, output_tokens: 2 } }),
  ].join("\n");
  const r = leerResultadoStreamJson(stream);
  assert.equal(r.sessionId, "s2");
  assert.equal(r.isError, true);
  assert.equal(r.texto, "fallo");
  assert.deepEqual(r.tokens, { entrada: 1, salida: 2, cacheLectura: null, cacheEscritura: null });
  assert.equal(leerResultadoStreamJson("sin nada legible"), null);
});

test("el adaptador fake emite el guion como eventos, en orden, y el resultado al final", async () => {
  const dir = mkdtempSync(join(tmpdir(), "noxloop-eventos-fake-"));
  const guion = join(dir, "guion.json");
  writeFileSync(
    guion,
    JSON.stringify({
      texto: "Test en rojo, como se esperaba.",
      eventos: [
        { type: "assistant", message: { content: [{ type: "text", text: "Escribo el test primero." }] } },
        { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Write", input: { file_path: "test/a.test.mjs" } }] } },
        { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "escrito" }] } },
      ],
      usage: { input_tokens: 7, output_tokens: 3 },
    }),
  );
  const fake = crearAdaptadorFake({ guion });
  const eventos = [];
  const r = await fake.runPhase(
    { phase: "RED", taskId: "T001", cwd: dir, resume: null, model: "fake", prompt: "encargo", env: {} },
    { alEvento: (e) => eventos.push(e) },
  );
  assert.equal(r.ok, true, r.text);
  assert.deepEqual(
    eventos.map((e) => e.tipo),
    ["texto", "herramienta", "resultado_herramienta", "resultado"],
  );
  assert.equal(eventos[2].herramienta, "Write");
  assert.equal(eventos[3].contenido, "Test en rojo, como se esperaba.");
  assert.deepEqual(eventos[3].tokens, { entrada: 7, salida: 3, cacheLectura: null, cacheEscritura: null });
  const ts = eventos.map((e) => Date.parse(e.t));
  assert.deepEqual([...ts].sort((x, y) => x - y), ts, "los eventos llegan en el orden del stream");
});

test("el camino del SDK de Claude emite los mensajes normalizados mientras llegan", async () => {
  const sdk = async function* () {
    yield { type: "system", subtype: "init", session_id: "s-1" };
    yield { type: "assistant", message: { content: [{ type: "text", text: "hola" }, { type: "tool_use", id: "x", name: "Bash", input: { command: "npm test" } }] } };
    yield { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] } };
    yield { type: "result", subtype: "success", is_error: false, result: "fin", total_cost_usd: 0.01, usage: { input_tokens: 5, output_tokens: 6 } };
  };
  const a = crearAdaptadorClaude({ sdk, resolverSdk: () => ({ disponible: true, motivo: null }) });
  const eventos = [];
  const r = await a.runPhase(
    { phase: "GREEN", taskId: "T001", cwd: tmpdir(), resume: null, model: "m", prompt: "p", env: {} },
    { alEvento: (e) => eventos.push(e) },
  );
  assert.equal(r.ok, true);
  assert.deepEqual(eventos.map((e) => e.tipo), ["texto", "herramienta", "resultado_herramienta", "resultado"]);
  assert.equal(eventos[2].herramienta, "Bash");
  assert.deepEqual(eventos[3].tokens, { entrada: 5, salida: 6, cacheLectura: null, cacheEscritura: null });
});
