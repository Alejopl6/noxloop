// El transcript de cada fase, en el home y REDACTADO antes de tocar disco
// (spec 004, US2, FR-004, SC-003; principios III y IX).
//
// LO QUE SE MIDE Y POR QUE ASI. El principio IX lo dice en una linea: «se
// prueba sobre el objeto serializado con un valor centinela, no sobre la
// intencion». Por eso la prueba que importa aqui no mira el redactor: planta un
// secreto en lo que el runtime FALSO imprime —un subproceso de verdad, por el
// cableado de verdad— y despues lee los BYTES del disco. Si el secreto esta en
// cualquier archivo bajo `transcripts/`, falla, lo haya escrito quien lo haya
// escrito.
//
// Y el transcript no es estado: el unico escritor del estado del run sigue
// siendo `state.mjs`. Se comprueba que escribir un transcript no toca el
// archivo del run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { abrirTranscript, leerTokens, rutaDeTranscript } from "../src/transcript.mjs";
import { resumenDeTokens } from "../../adapters/src/eventos.mjs";
import { buildDeps } from "../src/wiring.mjs";
import { createRun } from "../src/state.mjs";
import { crearAdaptadorFake } from "../../adapters/src/adaptadores/fake.mjs";
import { validarEvento } from "../../adapters/src/contrato.mjs";

const muda = { info() {}, warn() {}, error() {}, child() { return this; } };
const SECRETO = "sk-centinela-del-transcript-4f1e9a7c";

/** Todo lo que hay bajo un directorio, concatenado: lo que se busca es el BYTE, no el campo. */
function todoElDisco(dir) {
  let texto = "";
  if (!existsSync(dir)) return texto;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    texto += statSync(p).isDirectory() ? todoElDisco(p) : `${e}\n${readFileSync(p, "utf8")}\n`;
  }
  return texto;
}

const lineas = (ruta) => readFileSync(ruta, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("la ruta: <home>/runs/<item>/transcripts/<tarea>-<fase>[-<lente>].jsonl, sin caracteres que escapen del directorio", () => {
  assert.equal(
    rutaDeTranscript("/h", { itemId: "PAY-142", taskId: "T001", fase: "GREEN" }),
    "/h/runs/PAY-142/transcripts/T001-GREEN.jsonl",
  );
  assert.equal(
    rutaDeTranscript("/h", { itemId: "PAY-142", taskId: "T001", fase: "REVIEW", lente: "seguridad" }),
    "/h/runs/PAY-142/transcripts/T001-REVIEW-seguridad.jsonl",
  );
  // `plan:<item>` es el taskId de la planificacion; los `:` y las barras no
  // pueden llegar al nombre del archivo: una barra seria un directorio ajeno.
  const plan = rutaDeTranscript("/h", { itemId: "../fuera", taskId: "plan:../../x", fase: "PLAN" });
  assert.ok(plan.startsWith("/h/runs/"), plan);
  assert.ok(!plan.slice("/h/runs/".length).includes(".."), plan);
  assert.equal(plan.split("/").length, "/h/runs/X/transcripts/Y.jsonl".split("/").length, plan);
});

test("cada evento es una linea JSON con su instante, y el resumen de tokens sale de lo que el runtime reporto", async () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-transcript-"));
  const tr = await abrirTranscript({ home, itemId: "1", taskId: "T001", fase: "GREEN", env: {}, secretos: [] });
  tr.alEvento({ t: new Date().toISOString(), tipo: "texto", contenido: "Leo el test." });
  tr.alEvento({ t: new Date().toISOString(), tipo: "herramienta", herramienta: "Read", contenido: '{"file_path":"a"}' });
  tr.alEvento({
    t: new Date().toISOString(),
    tipo: "resultado",
    contenido: "hecho",
    tokens: { entrada: 100, salida: 20, cacheLectura: 5, cacheEscritura: null },
  });
  tr.cerrar({ ok: true, text: "hecho" });

  const ev = lineas(tr.ruta);
  assert.deepEqual(ev.map((e) => e.tipo), ["texto", "herramienta", "resultado"]);
  for (const e of ev) assert.equal(validarEvento(e).ok, true, JSON.stringify(e));

  assert.deepEqual(leerTokens(tr.ruta), {
    medido: true, entrada: 100, salida: 20, cacheLectura: 5, cacheEscritura: null,
  });
});

test("sin tokens del runtime el resumen dice `medido: false`, y no cero; un reintento suma, y uno sin medir lo contagia", async () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-transcript-"));
  const tr = await abrirTranscript({ home, itemId: "1", taskId: "T001", fase: "RED", env: {}, secretos: [] });
  tr.alEvento({ t: new Date().toISOString(), tipo: "resultado", contenido: "rojo" });
  tr.cerrar({ ok: true, text: "rojo" });
  assert.deepEqual(leerTokens(tr.ruta), { medido: false, entrada: null, salida: null, cacheLectura: null, cacheEscritura: null });

  // Dos intentos medidos de la misma fase: se SUMAN. Lo gastado en el que
  // fallo tambien se gasto.
  const tokens = (entrada, salida) => ({ entrada, salida, cacheLectura: null, cacheEscritura: null });
  for (const [entrada, salida] of [[10, 1], [30, 3]]) {
    const intento = await abrirTranscript({ home, itemId: "1", taskId: "T002", fase: "GREEN", env: {}, secretos: [] });
    intento.alEvento({ t: new Date().toISOString(), tipo: "resultado", contenido: "x", tokens: tokens(entrada, salida) });
    intento.cerrar({ ok: true, text: "x" });
  }
  const dos = rutaDeTranscript(home, { itemId: "1", taskId: "T002", fase: "GREEN" });
  assert.deepEqual(leerTokens(dos), { medido: true, entrada: 40, salida: 4, cacheLectura: null, cacheEscritura: null });

  // Un tercer intento sin medir: el total deja de ser medido. Un numero con
  // una parte sin contar se lee como el gasto entero y es menos.
  const tercero = await abrirTranscript({ home, itemId: "1", taskId: "T002", fase: "GREEN", env: {}, secretos: [] });
  tercero.cerrar({ ok: false, subtype: "cancelada", text: "cortada" });
  assert.equal(leerTokens(dos).medido, false);

  assert.deepEqual(
    resumenDeTokens([
      { tipo: "texto" },
      { tipo: "resultado", tokens: { entrada: 1, salida: 2, cacheLectura: null, cacheEscritura: null } },
      { tipo: "error", tokens: { entrada: 3, salida: 4, cacheLectura: 1, cacheEscritura: null } },
    ]),
    { medido: true, entrada: 4, salida: 6, cacheLectura: 1, cacheEscritura: null },
  );
});

test("un runtime que no emite nada deja igual su cierre: el resultado, o el error con su causa", async () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-transcript-"));
  const bien = await abrirTranscript({ home, itemId: "1", taskId: "T001", fase: "GREEN", env: {}, secretos: [] });
  bien.cerrar({ ok: true, text: "listo sin eventos" });
  assert.deepEqual(lineas(bien.ruta).map((e) => [e.tipo, e.contenido]), [["resultado", "listo sin eventos"]]);

  const mal = await abrirTranscript({ home, itemId: "1", taskId: "T002", fase: "GREEN", env: {}, secretos: [] });
  mal.cerrar({ ok: false, subtype: "cancelada", text: "la fase se cancelo" });
  const [e] = lineas(mal.ruta);
  assert.equal(e.tipo, "error");
  assert.match(e.contenido, /cancelada/);
  assert.match(e.contenido, /la fase se cancelo/);
});

test("el secreto de la fase se redacta ANTES de escribir, tambien en el nombre de la herramienta y en el cierre", async () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-transcript-"));
  const tr = await abrirTranscript({
    home, itemId: "1", taskId: "T001", fase: "GREEN",
    env: { PATH: "/usr/bin", CLAVE_DEL_MODELO: SECRETO }, secretos: ["CLAVE_DEL_MODELO"],
  });
  tr.alEvento({ t: new Date().toISOString(), tipo: "texto", contenido: `uso la clave ${SECRETO} para llamar` });
  tr.alEvento({ t: new Date().toISOString(), tipo: "herramienta", herramienta: `h-${SECRETO}`, contenido: "{}" });
  tr.cerrar({ ok: false, subtype: "error", text: `401 con ${SECRETO}` });

  const disco = todoElDisco(join(home, "runs"));
  assert.ok(!disco.includes(SECRETO), "el valor del secreto llego al disco");
  assert.match(disco, /\[redactado:CLAVE_DEL_MODELO\]/, "la marca nombra la credencial: sin nombre no se puede diagnosticar");
  // `PATH` no es secreto: no se redacta (redactarlo convertiria cada ruta en ruido).
  const conRuta = await abrirTranscript({
    home, itemId: "1", taskId: "T009", fase: "GREEN", env: { PATH: "/usr/bin" }, secretos: [],
  });
  conRuta.alEvento({ t: new Date().toISOString(), tipo: "texto", contenido: "corro /usr/bin/node" });
  assert.match(readFileSync(conRuta.ruta, "utf8"), /\/usr\/bin\/node/);
});

test("si no se puede redactar, no se escribe: la redaccion es previa a la escritura", async () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-transcript-"));
  const tr = await abrirTranscript({
    home, itemId: "1", taskId: "T001", fase: "GREEN", env: {}, secretos: [],
    redactar: () => {
      throw new Error("el redactor de la boveda no esta cargado");
    },
  });
  tr.alEvento({ t: new Date().toISOString(), tipo: "texto", contenido: "algo" });
  tr.cerrar({ ok: true, text: "fin" });
  assert.equal(existsSync(tr.ruta), false, "se escribio un transcript sin poder redactarlo");
});

test("CENTINELA (SC-003): el runtime falso imprime el secreto por el cableado de verdad, y el disco no lo tiene", async () => {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-centinela-transcript-"));
  const home = join(raiz, "home");
  const worktree = join(raiz, "wt");
  mkdirSync(worktree, { recursive: true });
  const guion = join(raiz, "guion.json");
  // El runtime REPRODUCE el secreto en todo lo que dice: en su texto, en la
  // entrada de una herramienta, en el resultado de esa herramienta y en su
  // resultado final. Es el fallo con nombre propio del redactor: la
  // credencial a mitad de una frase, sin `API_KEY=` delante.
  writeFileSync(
    guion,
    JSON.stringify({
      texto: `listo; la clave era ${SECRETO}`,
      eventos: [
        { type: "assistant", message: { content: [{ type: "text", text: `Encontre ${SECRETO} en el entorno.` }] } },
        { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: `curl -H 'x: ${SECRETO}'` } }] } },
        { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: `eco ${SECRETO}` }] } },
      ],
    }),
  );

  const run = createRun({
    item: { id: "77", key: "H-77", title: "la historia", level: "story", url: "http://g/77", provider: "fake", acceptance: ["x"] },
    repoScope: ["app"],
    tasks: [{ id: "T001", repo: "app", title: "t", acceptance: "a", targetFiles: ["src/a.mjs"], testFiles: ["test/a.test.mjs"], tier: "small", dependsOn: [], dependencyKind: "hard" }],
  }, { home });
  const archivoDelRun = join(home, "runs", "run-77.json");
  const antes = readFileSync(archivoDelRun, "utf8");

  // Un runtime que declara la credencial que necesita: asi es como una
  // variable llega secreta al entorno de la fase (`requiredEnv`).
  const fake = { ...crearAdaptadorFake({ guion }), requiredEnv: ["CLAVE_DEL_MODELO"] };
  const deps = await buildDeps(run.item, { home, repos: {}, runtime: "fake" }, {
    provider: {}, providerCtx: {}, log: muda, adaptadores: [fake],
    env: { PATH: process.env.PATH ?? "/usr/bin", CLAVE_DEL_MODELO: SECRETO },
  });

  const r = await deps.runPhase({
    phase: "GREEN", taskId: "T001", task: run.tasks[0], item: run.item, cwd: worktree,
    resume: null, model: "fake", effort: null, prompt: "# encargo expandido\n\nFase GREEN.", tier: "small",
  });
  assert.equal(r.ok, true, r.text);

  const ruta = rutaDeTranscript(home, { itemId: "77", taskId: "T001", fase: "GREEN" });
  assert.ok(existsSync(ruta), "el cableado no dejo transcript de la fase");
  const ev = lineas(ruta);
  assert.deepEqual(ev.map((e) => e.tipo), ["texto", "herramienta", "resultado_herramienta", "resultado"]);

  const disco = todoElDisco(join(home, "runs", "77"));
  assert.ok(!disco.includes(SECRETO), "SC-003: un transcript en disco contiene el secreto de la boveda");
  assert.match(disco, /\[redactado:CLAVE_DEL_MODELO\]/);

  // Y el transcript no es estado: el archivo del run no lo toco nadie.
  assert.equal(readFileSync(archivoDelRun, "utf8"), antes, "escribir el transcript modifico el estado del run");
});
