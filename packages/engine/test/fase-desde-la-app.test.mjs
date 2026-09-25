// Lo que el cableado del motor pone en cada fase para que corra igual desde la
// app de escritorio instalada que desde la terminal.
//
//   - El PATH de la fase, AMPLIADO: una app de macOS recibe
//     `/usr/bin:/bin:/usr/sbin:/sbin`, y el agente no encontraba `node` ni `gh`.
//   - La revision recibe el gate del repositorio de su tarea como lo unico que
//     puede correr ademas de leer (el runtime lo traduce a su lista cerrada).
//   - Una fase que falla con `sin_sesion` deja la señal en el home para que el
//     servicio diga «sesion vencida»; una buena despues la limpia.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { anotarSesion, buildDeps, entornoDeFase, gateDeLaTarea } from "../src/wiring.mjs";
import { rutaDeSesionVencida } from "../../adapters/src/autenticacion.mjs";

const muda = { info() {}, warn() {}, error() {}, child() { return this; } };
const PATH_DE_UNA_APP = "/usr/bin:/bin:/usr/sbin:/sbin";

const home = () => realpathSync(mkdtempSync(join(tmpdir(), "noxloop-fase-app-")));

/** Un runtime que anota cada peticion y devuelve lo que se le guione. */
function runtimeQueAnota(/** @type {any[]} */ respuestas = []) {
  /** @type {any[]} */
  const peticiones = [];
  return {
    peticiones,
    adaptador: {
      id: "anota",
      requiredEnv: [],
      sessionEnv: ["HOME"],
      capabilities: () => ({ resume: false, cost: false, effort: false, hooks: true, models: "desconocido", comandos: true }),
      preflight: async () => ({ ok: true }),
      runPhase: async (/** @type {any} */ req) => {
        peticiones.push(req);
        return respuestas.shift() ?? { ok: true, sessionId: null, usd: null, text: "hecho", budgetExhausted: false, subtype: null };
      },
    },
  };
}

test("entornoDeFase: con el PATH de una app de macOS, la fase recibe el PATH ampliado con lo recibido primero", () => {
  const env = entornoDeFase({ home: "/h" }, { env: { PATH: PATH_DE_UNA_APP, HOME: "/Users/op" } });
  const partes = env.PATH.split(delimiter);
  assert.deepEqual(partes.slice(0, 4), PATH_DE_UNA_APP.split(":"));
  for (const d of ["/opt/homebrew/bin", "/usr/local/bin", "/Users/op/.local/bin"]) {
    assert.ok(partes.includes(d), `falta ${d} en ${env.PATH}`);
  }
  assert.equal(new Set(partes).size, partes.length, "hay carpetas repetidas");
});

test("gateDeLaTarea: el gate y el gate corto del repositorio de la tarea, sin repetir", () => {
  const config = { repos: { app: { gate: "npm test", fastGate: "npm test" }, otro: { gate: "make check", fastGate: "make quick" } } };
  assert.deepEqual(gateDeLaTarea(config, { repo: "app" }), ["npm test"]);
  assert.deepEqual(gateDeLaTarea(config, { repo: "otro" }), ["make check", "make quick"]);
  assert.deepEqual(gateDeLaTarea(config, { repo: "no-esta" }), []);
  assert.deepEqual(gateDeLaTarea(config, null), []);
});

test("la revision recibe el gate como comandosPermitidos; las fases que escriben no", async () => {
  const h = home();
  const { adaptador, peticiones } = runtimeQueAnota();
  const config = { home: h, repos: { app: { gate: "npm test" } } };
  const deps = await buildDeps({ id: "1" }, config, {
    provider: {}, providerCtx: {}, log: muda, adaptadores: [adaptador], env: { PATH: PATH_DE_UNA_APP, HOME: h },
  });
  const tarea = { id: "T1", repo: "app" };
  const base = { taskId: "T1", task: tarea, item: { id: "1" }, cwd: h, resume: null, model: null, prompt: "x" };
  await deps.runPhase({ ...base, phase: "REVIEW" });
  await deps.runPhase({ ...base, phase: "REVIEW-SINTESIS" });
  await deps.runPhase({ ...base, phase: "GREEN" });

  assert.deepEqual(peticiones[0].comandosPermitidos, ["npm test"]);
  assert.deepEqual(peticiones[1].comandosPermitidos, ["npm test"]);
  assert.equal("comandosPermitidos" in peticiones[2], false, "una fase que escribe no necesita lista de revision");
  // Y el PATH ampliado llega de verdad a la peticion del runtime.
  assert.ok(peticiones[2].env.PATH.split(delimiter).includes("/opt/homebrew/bin"), peticiones[2].env.PATH);
});

test("una fase sin_sesion deja la señal «vencida» con hora, causa y accion; una buena despues la pasa a «ok»", async () => {
  const h = home();
  const vencida = {
    ok: false, sessionId: null, usd: null, budgetExhausted: false, subtype: "sin_sesion",
    text: "Codex rechazo su credencial", causa: "Codex rechazo su credencial (el token vencio)", accion: "Corre `codex login`",
  };
  const { adaptador } = runtimeQueAnota([vencida]);
  const deps = await buildDeps({ id: "1" }, { home: h, repos: {} }, {
    provider: {}, providerCtx: {}, log: muda, adaptadores: [adaptador], env: { PATH: PATH_DE_UNA_APP, HOME: h },
  });
  const base = { taskId: "T1", task: { id: "T1" }, item: { id: "1" }, cwd: h, resume: null, model: null, prompt: "x", phase: "GREEN" };

  const r = await deps.runPhase(base);
  assert.equal(r.subtype, "sin_sesion");
  const ruta = rutaDeSesionVencida(h, "anota");
  const senal = JSON.parse(readFileSync(ruta, "utf8"));
  assert.equal(senal.estado, "vencida");
  assert.equal(senal.runtime, "anota");
  assert.match(senal.accion, /codex login/);
  assert.ok(!Number.isNaN(Date.parse(senal.hora)));

  await deps.runPhase(base);
  const despues = JSON.parse(readFileSync(ruta, "utf8"));
  assert.equal(despues.estado, "ok");
  assert.ok(Date.parse(despues.hora) >= Date.parse(senal.hora));
});

test("anotarSesion: una fase buena sin vencida previa no escribe nada, y sin home no hace nada", () => {
  const h = home();
  anotarSesion(h, "codex", { ok: true });
  assert.equal(existsSync(rutaDeSesionVencida(h, "codex")), false);
  anotarSesion(undefined, "codex", { ok: false, subtype: "sin_sesion" });
  anotarSesion(h, "codex", { ok: false, subtype: "otra_cosa" });
  assert.equal(existsSync(rutaDeSesionVencida(h, "codex")), false);
});
