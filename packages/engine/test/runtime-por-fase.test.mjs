// El runtime se elige POR FASE: planifica el planificador, implementa el
// implementador y revisa el revisor (FR-034).
//
// EL HUECO QUE CIERRA. El motor montaba UN runtime para todo el recorrido
// (`config.runtime`). Con Codex elegido como implementador, Codex tambien
// revisaba: el revisor miraba con la misma cabeza el codigo que acababa de
// escribir, que es exactamente lo que FR-034 prohibe — y la flota del proyecto,
// que declaraba otro revisor, no llegaba al motor.
//
// LO QUE SE MIDE: con un implementador sin hooks y un revisor con hooks, RED y
// GREEN van al primero y la revision (lentes y sintesis) al segundo, cada uno
// con SU entorno y SUS capacidades; y un revisor igual al implementador se
// rechaza al cargar, con causa y accion.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../src/config.mjs";
import { buildDeps } from "../src/wiring.mjs";
import { fase } from "../src/driver.mjs";
import { createRun, loadRun } from "../src/state.mjs";

const muda = { info() {}, warn() {}, error() {}, child() { return this; } };
const FAKE = new URL("../../../providers/fake/index.mjs", import.meta.url).pathname;

/**
 * Un runtime de mentira que cumple el contrato y apunta lo que recibe.
 *
 * @param {string} id
 * @param {{hooks: boolean, comandos?: boolean, requiredEnv?: string[], sessionId?: string|null}} caps
 */
function runtime(id, { hooks, comandos = false, requiredEnv = [], sessionId = null }) {
  /** @type {any[]} */
  const vistas = [];
  return {
    id,
    requiredEnv,
    capabilities: () => ({ resume: false, cost: false, effort: false, hooks, models: "desconocido", comandos }),
    preflight: async () => ({ ok: true }),
    runPhase: async (/** @type {any} */ req) => {
      vistas.push(req);
      return { ok: true, sessionId, usd: null, text: "listo", budgetExhausted: false, subtype: null };
    },
    vistas,
  };
}

function montar(runtimes, over = {}) {
  const home = mkdtempSync(join(tmpdir(), "noxloop-por-fase-"));
  const impl = runtime("impl-sin-hooks", { hooks: false, requiredEnv: ["CLAVE_IMPL"] });
  const rev = runtime("rev-con-hooks", { hooks: true, comandos: true, requiredEnv: ["CLAVE_REV"] });
  const plan = runtime("planificador", { hooks: true, comandos: true });
  return {
    home, impl, rev, plan,
    deps: () => buildDeps({ id: "1" }, { home, repos: {}, runtimes, ...over }, {
      provider: {}, providerCtx: {}, log: muda, adaptadores: [impl, rev, plan],
      env: { PATH: "/usr/bin", CLAVE_IMPL: "valor-impl-1234", CLAVE_REV: "valor-rev-5678" },
    }),
  };
}

const peticion = (phase, extra = {}) => ({
  phase, taskId: "T001", task: { id: "T001", testFiles: ["test/a.test.mjs"], targetFiles: ["src/a.mjs"] },
  item: { id: "1" }, cwd: "/tmp", resume: null, model: null, effort: null,
  prompt: `/noxloop-task 1 T001 --phase ${phase}`, tier: "small", ...extra,
});

test("el esquema acepta `runtimes` por rol y rechaza un rol inventado o un id que no es texto", () => {
  const dir = mkdtempSync(join(tmpdir(), "noxloop-por-fase-"));
  const base = {
    version: 1,
    home: join(dir, "home"),
    provider: { name: "fake", module: FAKE, stateMap: { todo: "Nuevo", in_progress: null, blocked: null, in_review: null, done: null } },
    repos: { app: { path: dir, remote: join(dir, "origin.git"), baseBranch: "main", gate: "npm test" } },
  };
  const ruta = join(dir, "c.json");
  const runtimes = { implementador: "codex", revisor: "claude-agent-sdk", planificador: "claude-agent-sdk" };
  writeFileSync(ruta, JSON.stringify({ ...base, runtimes }));
  assert.deepEqual(loadConfig(ruta, { env: {} }).runtimes, runtimes);

  writeFileSync(ruta, JSON.stringify({ ...base, runtimes: { ...runtimes, verificadorz: "codex" } }));
  assert.throws(() => loadConfig(ruta, { env: {} }), /runtimes/);

  writeFileSync(ruta, JSON.stringify({ ...base, runtimes: { implementador: 7 } }));
  assert.throws(() => loadConfig(ruta, { env: {} }), /runtimes/);
});

test("RED y GREEN van al implementador; la revision —lentes y sintesis— al revisor; PLAN al planificador", async () => {
  const m = montar({ implementador: "impl-sin-hooks", revisor: "rev-con-hooks", planificador: "planificador" });
  const deps = await m.deps();

  for (const f of ["RED", "GREEN"]) await deps.runPhase(peticion(f, { env: deps.entorno(peticion(f)) }));
  await deps.runPhase(peticion("REVIEW", { lens: "seguridad", env: deps.entorno(peticion("REVIEW")) }));
  await deps.runPhase(peticion("REVIEW-SINTESIS", { env: deps.entorno(peticion("REVIEW-SINTESIS")) }));
  await deps.runPhase({ ...peticion("PLAN"), taskId: "plan:1", task: null, prompt: "/noxloop-plan 1 --out /tmp/p.json", env: deps.entorno({ phase: "PLAN" }) });

  assert.deepEqual(m.impl.vistas.map((v) => v.phase), ["RED", "GREEN"]);
  assert.deepEqual(m.rev.vistas.map((v) => v.phase), ["REVIEW", "REVIEW-SINTESIS"]);
  assert.deepEqual(m.plan.vistas.map((v) => v.phase), ["PLAN"]);
  assert.deepEqual(deps.runtimes, { implementador: "impl-sin-hooks", revisor: "rev-con-hooks", planificador: "planificador" });
});

test("cada fase lleva las capacidades de SU runtime: expansion del encargo y guarda posterior", async () => {
  const m = montar({ implementador: "impl-sin-hooks", revisor: "rev-con-hooks" });
  const deps = await m.deps();
  await deps.runPhase(peticion("GREEN", { env: deps.entorno(peticion("GREEN")) }));
  await deps.runPhase(peticion("REVIEW", { env: deps.entorno(peticion("REVIEW")) }));

  // El implementador no carga el plugin: recibe el TEXTO del comando.
  assert.ok(!m.impl.vistas[0].prompt.startsWith("/noxloop-task"), "al implementador sin plugin le llego el comando crudo");
  // El revisor si lo carga: recibe el comando tal cual.
  assert.ok(m.rev.vistas[0].prompt.startsWith("/noxloop-task"), "al revisor con plugin se le expandio el comando");
  // La guarda posterior la decide el implementador —el unico que escribe—, no el revisor.
  assert.equal(deps.alcancePorElMotor, true);

  const alReves = montar({ implementador: "rev-con-hooks", revisor: "impl-sin-hooks" });
  assert.equal((await alReves.deps()).alcancePorElMotor, false, "un implementador con hooks no necesita la guarda posterior");
});

test("cada fase recibe la credencial de SU runtime y no la del otro", async () => {
  const m = montar({ implementador: "impl-sin-hooks", revisor: "rev-con-hooks" });
  const deps = await m.deps();
  await deps.runPhase(peticion("GREEN", { env: deps.entorno(peticion("GREEN")) }));
  await deps.runPhase(peticion("REVIEW", { env: deps.entorno(peticion("REVIEW")) }));

  const [green] = m.impl.vistas;
  const [review] = m.rev.vistas;
  assert.equal(green.env.CLAVE_IMPL, "valor-impl-1234");
  assert.equal(green.env.CLAVE_REV, undefined, "el implementador recibio la credencial del revisor");
  assert.deepEqual(green.secretos, ["CLAVE_IMPL"]);
  assert.equal(review.env.CLAVE_REV, "valor-rev-5678");
  assert.equal(review.env.CLAVE_IMPL, undefined, "el revisor recibio la credencial del implementador");
  assert.deepEqual(review.secretos, ["CLAVE_REV"]);
});

test("sin planificador declarado planifica el implementador", async () => {
  const m = montar({ implementador: "impl-sin-hooks", revisor: "rev-con-hooks" });
  const deps = await m.deps();
  assert.equal(deps.runtimes.planificador, "impl-sin-hooks");
});

test("FR-034: un revisor igual al implementador se rechaza AL CARGAR, con causa y accion", async () => {
  const m = montar({ implementador: "impl-sin-hooks", revisor: "impl-sin-hooks" });
  await assert.rejects(m.deps(), (/** @type {any} */ e) => {
    assert.equal(e.codigo, "revisor_comparte_runtime");
    assert.match(e.causa, /impl-sin-hooks/);
    assert.ok(e.accion && e.accion.length > 0, "el rechazo no dice que hacer");
    return true;
  });
});

test("FR-034 tambien con el implementador de `runtime` (la cascada) y el revisor de `runtimes`", async () => {
  const m = montar({ revisor: "impl-sin-hooks" }, { runtime: "impl-sin-hooks" });
  await assert.rejects(m.deps(), /revisor/);
});

test("un runtime de rol que el registro no conoce falla al cargar, nombrando rol y runtime", async () => {
  const m = montar({ implementador: "impl-sin-hooks", revisor: "inventado" });
  await assert.rejects(m.deps(), /inventado[\s\S]*revisor|revisor[\s\S]*inventado/);
});

test("sin `runtimes` (configuracion de un solo runtime) todo corre en el mismo, y se avisa que la revision no es independiente", async () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-por-fase-"));
  const impl = runtime("impl-sin-hooks", { hooks: false });
  /** @type {string[]} */
  const avisos = [];
  const log = { ...muda, warn: (/** @type {string} */ m) => avisos.push(m) };
  const deps = await buildDeps({ id: "1" }, { home, repos: {}, runtime: "impl-sin-hooks" }, {
    provider: {}, providerCtx: {}, log, adaptadores: [impl], env: {},
  });
  assert.deepEqual(deps.runtimes, { implementador: "impl-sin-hooks", revisor: "impl-sin-hooks", planificador: "impl-sin-hooks" });
  assert.ok(avisos.some((a) => /FR-034/.test(a)), `no se aviso de la revision no independiente: ${avisos.join(" | ")}`);
});

// ---------------------------------------------------------------------------
// el driver
// ---------------------------------------------------------------------------

function unRun(home, worktree) {
  return createRun({
    item: { id: "1", key: "H-1", title: "h", level: "story", url: "http://g/1", provider: "fake", acceptance: ["a"] },
    repoScope: ["app"],
    tasks: [{
      id: "T001", repo: "app", title: "t", acceptance: "a", targetFiles: ["src/a.mjs"], testFiles: ["test/a.test.mjs"],
      tier: "small", dependsOn: [], dependencyKind: "hard", ...(worktree ? { worktree } : {}),
    }],
  }, { home });
}

test("la sesion de una revision NO se guarda en la tarea: el implementador retomaria la sesion de otro runtime", async () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-por-fase-"));
  const run = unRun(home);
  const deps = {
    home, config: {}, log: muda, entorno: () => ({}),
    runPhase: async () => ({ ok: true, sessionId: "sesion-del-revisor", usd: null, text: "ok", budgetExhausted: false }),
  };
  await fase("REVIEW", run, "T001", { model: null, effort: "high" }, deps);
  assert.equal(loadRun("1", { home }).tasks[0].sessionId ?? null, null, "la sesion del revisor quedo como la de la tarea");
});

test("una fase que necesita la guarda posterior y no tiene worktree donde aplicarla NO se invoca", async () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-por-fase-"));
  const run = unRun(home);
  let invocada = false;
  const deps = {
    home, config: {}, log: muda, entorno: () => ({}), alcancePorElMotor: true,
    runPhase: async () => { invocada = true; return { ok: true, sessionId: null, usd: null, text: "ok", budgetExhausted: false }; },
  };
  const r = await fase("RED", run, "T001", { model: null, effort: "high" }, deps);
  assert.equal(invocada, false, "un runtime sin hooks corrio RED sin ninguna guarda que sostenga el principio I");
  assert.equal(r.ok, false);
  assert.match(r.text, /worktree/);
});
