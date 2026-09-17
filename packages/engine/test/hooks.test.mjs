import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRun, transition, saveRun, setActiveTask } from "../src/state.mjs";
import { decide as tddOrder } from "../src/hooks/tdd-order-guard.mjs";
import { decide as scope } from "../src/hooks/task-scope-guard.mjs";
import { decide as noProd } from "../src/hooks/no-prod-writes.mjs";
import { decide as checkpoint } from "../src/hooks/state-checkpoint.mjs";

const home = () => mkdtempSync(join(tmpdir(), "noxloop-hooks-"));

const tarea = (id, over = {}) => ({
  id, repo: "app", title: `t ${id}`, acceptance: "c",
  targetFiles: ["src/a.mjs"], testFiles: ["test/a.test.mjs"],
  tier: "small", dependsOn: [], dependencyKind: "hard", ...over,
});

function conTareaActiva(h, over = {}) {
  const run = createRun({
    item: { id: "42", title: "h", level: "story", url: "u", provider: "fake" },
    repoScope: ["app"],
    tasks: [tarea("T001", over)],
  }, { home: h });
  setActiveTask("42", "T001", { home: h });
  return run;
}

const edit = (path) => ({ tool_name: "Edit", tool_input: { file_path: path } });
const bash = (cmd) => ({ tool_name: "Bash", tool_input: { command: cmd } });

// -------------------------------------------- ante la duda, permitir

test("sin tarea activa, los tres hooks permiten TODO: no dejan a nadie sin trabajar", () => {
  const h = home();
  assert.equal(tddOrder(edit("/x/src/a.mjs"), { home: h }).allow, true);
  assert.equal(scope(edit("/x/cualquier/cosa.mjs"), { home: h }).allow, true);
  assert.equal(noProd(bash("git push --force"), { home: h }).allow, true);
});

test("un input que el hook no entiende se permite, no se bloquea", () => {
  const h = home();
  conTareaActiva(h);
  assert.equal(tddOrder({}, { home: h }).allow, true);
  assert.equal(scope({ tool_name: "Edit" }, { home: h }).allow, true);
  assert.equal(noProd({ tool_name: "Bash", tool_input: {} }, { home: h }).allow, true);
});

// -------------------------------------------- tdd-order-guard

test("tdd-order bloquea produccion sin rojo verificado, y deja escribir el test", () => {
  const h = home();
  conTareaActiva(h);
  const bloqueo = tddOrder(edit("src/a.mjs"), { home: h });
  assert.equal(bloqueo.allow, false);
  assert.match(bloqueo.reason, /rojo|red/i);
  assert.equal(tddOrder(edit("test/a.test.mjs"), { home: h }).allow, true, "el test SIEMPRE se puede escribir");
});

test("tdd-order deja pasar produccion una vez visto el rojo", () => {
  const h = home();
  let run = conTareaActiva(h);
  run = transition(run, "T001", "in_progress", { home: h });
  run = transition(run, "T001", "red", { home: h, redVerified: { command: "t", exitCode: 1, durationMs: 1 } });
  saveRun(run, { home: h });
  assert.equal(tddOrder(edit("src/a.mjs"), { home: h }).allow, true);
});

test("tdd-order corre en los CUATRO tiers: ningun tier saltea el rojo", () => {
  for (const tier of ["trivial", "small", "medium", "large"]) {
    const h = home();
    conTareaActiva(h, { tier });
    assert.equal(tddOrder(edit("src/a.mjs"), { home: h }).allow, false, `el tier ${tier} salteo el rojo`);
  }
});

// -------------------------------------------- task-scope-guard

test("scope bloquea un archivo no declarado y nombra como declararlo", () => {
  const h = home();
  conTareaActiva(h);
  const r = scope(edit("src/otro.mjs"), { home: h });
  assert.equal(r.allow, false);
  assert.match(r.reason, /add-target|declar/i);
  assert.equal(scope(edit("src/a.mjs"), { home: h }).allow, true);
  assert.equal(scope(edit("test/a.test.mjs"), { home: h }).allow, true);
});

test("scope bloquea migraciones, lockfiles y generados aunque esten declarados", () => {
  const h = home();
  conTareaActiva(h, { targetFiles: ["src/a.mjs", "migrations/001.sql", "pnpm-lock.yaml"] });
  assert.equal(scope(edit("migrations/001.sql"), { home: h }).allow, false);
  assert.equal(scope(edit("pnpm-lock.yaml"), { home: h }).allow, false);
});

// -------------------------------------------- no-prod-writes

test("no-prod-writes bloquea merge a rama protegida, deploy y force push", () => {
  const h = home();
  conTareaActiva(h);
  for (const cmd of [
    "gh pr merge 12 --squash",
    "git push --force origin main",
    "git push -f origin main",
    "git push origin main",
    "kubectl apply -f prod.yaml",
    "docker compose -f docker-compose.prod.yml up -d",
    "ssh deploy@vps 'bash deploy.sh'",
  ]) {
    const r = noProd(bash(cmd), { home: h });
    assert.equal(r.allow, false, `no bloqueo: ${cmd}`);
    assert.ok(r.reason.length > 10, `sin motivo util: ${cmd}`);
  }
});

test("no-prod-writes NO bloquea un comando legitimo que solo menciona la frase", () => {
  const h = home();
  conTareaActiva(h);
  for (const cmd of [
    "echo 'no hagas git push --force'",
    "grep -rn 'gh pr merge' docs/",
    "git log --oneline origin/main",
    "git push origin feature/42-x",
    "cat deploy.sh",
  ]) {
    assert.equal(noProd(bash(cmd), { home: h }).allow, true, `bloqueo de mas: ${cmd}`);
  }
});

test("no-prod-writes bloquea tambien cuando el comando viene encadenado", () => {
  const h = home();
  conTareaActiva(h);
  assert.equal(noProd(bash("npm test && gh pr merge 3"), { home: h }).allow, false);
  assert.equal(noProd(bash("cd /tmp; git push --force origin main"), { home: h }).allow, false);
});

// -------------------------------------------- state-checkpoint

test("checkpoint avisa una sola vez por ciclo cuando hay trabajo sin registrar", () => {
  const h = home();
  conTareaActiva(h);
  const primero = checkpoint({ hook_event_name: "Stop" }, { home: h, dirty: true });
  assert.equal(primero.notify, true);
  const segundo = checkpoint({ hook_event_name: "Stop" }, { home: h, dirty: true });
  assert.equal(segundo.notify, false, "avisa una vez, no en bucle");
});

test("checkpoint no avisa si no hay tarea activa ni trabajo sucio", () => {
  const h = home();
  assert.equal(checkpoint({ hook_event_name: "Stop" }, { home: h, dirty: true }).notify, false);
  conTareaActiva(h);
  assert.equal(checkpoint({ hook_event_name: "Stop" }, { home: h, dirty: false }).notify, false);
});
