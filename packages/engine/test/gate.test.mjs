import { test } from "node:test";
import assert from "node:assert/strict";
import { runGate, runSingleTest } from "../src/gate.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cwd = () => mkdtempSync(join(tmpdir(), "noxloop-gate-"));
const cfg = (over = {}) => ({
  repos: { app: { gate: "exit 0", fastGate: "exit 0", timeoutMs: 5000, env: {}, gaps: [], ...over } },
});

test("devuelve el objeto con el exit code REAL, no una frase", () => {
  const r = runGate("app", cwd(), cfg({ gate: "exit 3" }));
  assert.equal(r.exitCode, 3);
  assert.equal(r.ok, false);
  assert.equal(r.command, "exit 3");
  assert.ok(typeof r.durationMs === "number");
  assert.ok(r.ranAt);
});

test("verde es exitCode 0 y nada mas", () => {
  const r = runGate("app", cwd(), cfg({ gate: "echo listo" }));
  assert.equal(r.ok, true);
  assert.equal(r.exitCode, 0);
  assert.match(r.output, /listo/);
});

test("respeta el timeout y lo marca: un timedOut nunca es verde", () => {
  const r = runGate("app", cwd(), cfg({ gate: "sleep 5", timeoutMs: 300 }));
  assert.equal(r.timedOut, true);
  assert.equal(r.ok, false);
});

test("inyecta el env declarado del repo, con ${VAR:-default} ya resuelto", () => {
  const r = runGate("app", cwd(), cfg({ gate: "echo $DB_URL", env: { DB_URL: "postgres://x:5436/y" } }));
  assert.match(r.output, /5436/);
});

test("reporta los gaps declarados: un verde con huecos no es un verde completo", () => {
  const r = runGate("app", cwd(), cfg({ gaps: ["sin typecheck"] }));
  assert.deepEqual(r.gaps, ["sin typecheck"]);
});

test("fast y full son comandos distintos y no se confunden", () => {
  const c = cfg({ gate: "echo COMPLETO", fastGate: "echo RAPIDO" });
  assert.match(runGate("app", cwd(), c, { kind: "full" }).output, /COMPLETO/);
  assert.match(runGate("app", cwd(), c, { kind: "fast" }).output, /RAPIDO/);
});

test("sin fastGate declarado, el rapido cae al completo en vez de inventar uno corto", () => {
  const c = cfg({ gate: "echo COMPLETO", fastGate: undefined });
  assert.match(runGate("app", cwd(), c, { kind: "fast" }).output, /COMPLETO/);
});

test("un repo sin gate declarado es un error de configuracion, no un verde", () => {
  assert.throws(() => runGate("otro", cwd(), cfg()), /otro/);
});

test("la salida se trunca pero deja dicho que se trunco", () => {
  const r = runGate("app", cwd(), cfg({ gate: "for i in $(seq 1 5000); do echo linea-larga-$i; done" }), { maxOutput: 500 });
  assert.ok(r.output.length < 2000);
  assert.match(r.output, /truncad/i);
});

test("runSingleTest usa el runner declarado y sustituye {file}", () => {
  const c = { repos: { app: { gate: "exit 0", env: {}, runners: { node: "echo corriendo {file}" } } } };
  const r = runSingleTest("app", cwd(), "test/x.test.mjs", c, { runner: "node" });
  assert.match(r.output, /corriendo test\/x\.test\.mjs/);
});
