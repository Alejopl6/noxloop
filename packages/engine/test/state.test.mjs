import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRun, loadRun, saveRun, transition, bump, addTarget,
  setItemFields, listRuns, GuardError, BUDGETS_DEFAULT,
} from "../src/state.mjs";

const home = () => mkdtempSync(join(tmpdir(), "noxloop-state-"));

const tarea = (id, over = {}) => ({
  id, repo: "app", title: `t ${id}`, acceptance: "criterio",
  targetFiles: [`src/${id}.mjs`], testFiles: [`test/${id}.test.mjs`],
  tier: "small", dependsOn: [], dependencyKind: "hard", ...over,
});

const plan = (tasks = [tarea("T001")]) => ({
  item: { id: "42", title: "historia", level: "story", url: "http://x/42", provider: "fake" },
  repoScope: ["app"],
  tasks,
});

const EVIDENCIA_OK = { command: "npm test", exitCode: 0, durationMs: 1200, output: "ok", timedOut: false };
const EVIDENCIA_MAL = { ...EVIDENCIA_OK, exitCode: 1, output: "1 failing" };

test("crea un recorrido con las tareas en pending y los contadores en cero", () => {
  const h = home();
  const run = createRun(plan(), { home: h });
  assert.equal(run.schemaVersion, 1);
  assert.equal(run.tasks[0].status, "pending");
  assert.deepEqual(run.tasks[0].attempts, { red: 0, green: 0, gate: 0, review: 0 });
  assert.equal(run.tasks[0].redVerified, false);
  assert.equal(run.item.providerStateWritten, null);
  assert.ok(loadRun("42", { home: h }), "queda persistido");
});

// ---------------------------------------------------- las guardas

test("in_progress -> red exige redVerified: escribir texto no concede el rojo", () => {
  const h = home();
  let run = createRun(plan(), { home: h });
  run = transition(run, "T001", "in_progress", { home: h });
  assert.throws(() => transition(run, "T001", "red", { home: h }), GuardError);
  run = transition(run, "T001", "red", { home: h, redVerified: EVIDENCIA_MAL });
  assert.equal(run.tasks[0].status, "red");
  assert.equal(run.tasks[0].redVerified, true);
});

test("redVerified solo se concede con una corrida que FALLO", () => {
  const h = home();
  let run = transition(createRun(plan(), { home: h }), "T001", "in_progress", { home: h });
  assert.throws(
    () => transition(run, "T001", "red", { home: h, redVerified: EVIDENCIA_OK }),
    /exit code 0|no prueba nada|paso/i,
    "un test que pasa sin el cambio no prueba nada",
  );
});

test("green -> gated exige gateEvidence con exitCode 0: sin el objeto no hay veredicto", () => {
  const h = home();
  let run = transition(createRun(plan(), { home: h }), "T001", "in_progress", { home: h });
  run = transition(run, "T001", "red", { home: h, redVerified: EVIDENCIA_MAL });
  run = transition(run, "T001", "green", { home: h });
  assert.throws(() => transition(run, "T001", "gated", { home: h }), GuardError);
  assert.throws(() => transition(run, "T001", "gated", { home: h, evidence: EVIDENCIA_MAL }), GuardError);
  run = transition(run, "T001", "gated", { home: h, evidence: EVIDENCIA_OK });
  assert.equal(run.tasks[0].gateEvidence.exitCode, 0);
});

test("reviewed -> queued exige que el contador de review no sea cero", () => {
  const h = home();
  let run = avanzarHasta("gated", h);
  run = transition(run, "T001", "reviewed", { home: h });
  assert.throws(() => transition(run, "T001", "queued", { home: h }), GuardError);
  bump(run, "T001", "review", {});
  run = transition(run, "T001", "queued", { home: h });
  assert.equal(run.tasks[0].status, "queued");
});

test("queued -> integrated solo la escribe la cola de integracion", () => {
  const h = home();
  let run = avanzarHasta("queued", h);
  assert.throws(() => transition(run, "T001", "integrated", { home: h }), GuardError);
  run = transition(run, "T001", "integrated", { home: h, actor: "merge-queue" });
  assert.equal(run.tasks[0].status, "integrated");
  assert.ok(run.tasks[0].integratedAt);
});

test("cualquier estado -> blocked exige una causa real", () => {
  const h = home();
  const run = createRun(plan(), { home: h });
  assert.throws(() => transition(run, "T001", "blocked", { home: h }), GuardError);
  assert.throws(() => transition(run, "T001", "blocked", { home: h, failure: "   " }), GuardError);
  const b = transition(run, "T001", "blocked", { home: h, failure: "presupuesto de green agotado: 3/3" });
  assert.match(b.tasks[0].lastFailure, /3\/3/);
});

test("no retrocede, salvo a green: es lo que hace la revision y el rebase", () => {
  const h = home();
  let run = avanzarHasta("gated", h);
  assert.throws(() => transition(run, "T001", "pending", { home: h }), GuardError);
  assert.throws(() => transition(run, "T001", "in_progress", { home: h }), GuardError);
  run = transition(run, "T001", "green", { home: h, failure: "hallazgo bloqueante del revisor" });
  assert.equal(run.tasks[0].status, "green");
  // El rojo verificado NO se pierde al volver: el test sigue existiendo.
  assert.equal(run.tasks[0].redVerified, true);
});

test("volver a green limpia la evidencia del gate: era de otro codigo", () => {
  const h = home();
  let run = avanzarHasta("gated", h);
  run = transition(run, "T001", "green", { home: h, failure: "conflicto al rebasar" });
  assert.equal(run.tasks[0].gateEvidence, null);
});

// ---------------------------------------------------- presupuestos

test("los presupuestos son por bucle e independientes entre si", () => {
  const h = home();
  const run = createRun(plan(), { home: h });
  for (let i = 0; i < BUDGETS_DEFAULT.green; i++) {
    const r = bump(run, "T001", "green", {});
    assert.equal(r.exhausted, i === BUDGETS_DEFAULT.green - 1);
  }
  const gate = bump(run, "T001", "gate", {});
  assert.equal(gate.exhausted, false, "agotar green no consume gate");
  assert.equal(run.tasks[0].attempts.green, BUDGETS_DEFAULT.green);
});

test("retomar no devuelve presupuesto consumido", () => {
  const h = home();
  const run = createRun(plan(), { home: h });
  bump(run, "T001", "green", {});
  bump(run, "T001", "green", {});
  saveRun(run, { home: h });
  const releido = loadRun("42", { home: h });
  assert.equal(releido.tasks[0].attempts.green, 2);
  const r = bump(releido, "T001", "green", {});
  assert.equal(r.exhausted, true, "el tercero agota, no el quinto");
});

// ---------------------------------------------------- persistencia

test("la escritura es atomica: un temporal a medias no se lee como estado", () => {
  const h = home();
  const run = createRun(plan(), { home: h });
  writeFileSync(join(h, "runs", "run-42.json.tmp-roto"), "{ esto no es json");
  const releido = loadRun("42", { home: h });
  assert.equal(releido.tasks[0].id, "T001", "el estado anterior se lee intacto");
  assert.equal(readdirSync(join(h, "runs")).filter((f) => f.endsWith(".json")).length, 1);
});

test("un estado corrupto se reporta, no se silencia con un recorrido vacio", () => {
  const h = home();
  createRun(plan(), { home: h });
  writeFileSync(join(h, "runs", "run-42.json"), "{ roto");
  assert.throws(() => loadRun("42", { home: h }), /run-42|corrupt|JSON/i);
});

test("setItemFields acepta solo la lista blanca, y nunca el id", () => {
  const h = home();
  const run = createRun(plan(), { home: h });
  setItemFields(run, { branch: "feature/42-x", providerStateWritten: "Active" });
  assert.equal(run.item.branch, "feature/42-x");
  assert.throws(() => setItemFields(run, { id: "99" }), /id/);
  assert.throws(() => setItemFields(run, { inventado: 1 }), /inventado/);
});

test("addTarget registra la ampliacion de alcance con su motivo", () => {
  const h = home();
  const run = createRun(plan(), { home: h });
  assert.throws(() => addTarget(run, "T001", "src/otro.mjs", ""), /motivo|why/i);
  addTarget(run, "T001", "src/otro.mjs", "el tipo compartido vive aca");
  assert.deepEqual(run.tasks[0].addedTargets, [{ path: "src/otro.mjs", why: "el tipo compartido vive aca" }]);
  assert.ok(run.tasks[0].targetFiles.includes("src/otro.mjs"), "queda declarado para el guardian de alcance");
});

test("listRuns enumera lo que hay sin interpretarlo", () => {
  const h = home();
  createRun(plan(), { home: h });
  const l = listRuns({ home: h });
  assert.equal(l.length, 1);
  assert.equal(l[0].item.id, "42");
});

test("una tarea desconocida es un error, no un no-op silencioso", () => {
  const h = home();
  const run = createRun(plan(), { home: h });
  assert.throws(() => transition(run, "T999", "in_progress", { home: h }), /T999/);
  assert.throws(() => bump(run, "T999", "green", {}), /T999/);
});

// ---------------------------------------------------- helper

function avanzarHasta(estado, h) {
  let run = createRun(plan(), { home: h });
  const camino = ["in_progress", "red", "green", "gated", "reviewed", "queued", "integrated"];
  for (const paso of camino) {
    const opciones = { home: h };
    if (paso === "red") opciones.redVerified = EVIDENCIA_MAL;
    if (paso === "gated") opciones.evidence = EVIDENCIA_OK;
    if (paso === "queued") bump(run, "T001", "review", {});
    if (paso === "integrated") opciones.actor = "merge-queue";
    run = transition(run, "T001", paso, opciones);
    if (paso === estado) return run;
  }
  return run;
}
