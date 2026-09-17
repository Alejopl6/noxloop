import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, expandVars, ConfigError } from "../src/config.mjs";

const dir = () => mkdtempSync(join(tmpdir(), "noxloop-config-"));

function escribir(cfg) {
  const d = dir();
  const p = join(d, "noxloop.config.json");
  writeFileSync(p, JSON.stringify(cfg));
  return p;
}

const minima = {
  version: 1,
  provider: { name: "fake", module: "providers/fake/index.mjs" },
  repos: {
    app: { remote: "git@example.com:o/app.git", baseBranch: "main", gate: "npm test" },
  },
};

test("carga una configuracion valida y aplica los valores por defecto", () => {
  const cfg = loadConfig(escribir(minima), { env: {} });
  assert.equal(cfg.version, 1);
  assert.equal(cfg.limits.maxParallelTasks, 4);
  assert.equal(cfg.budgets.green, 3);
  // El techo por invocacion NO existe: corta a mitad de una unidad indivisible.
  assert.ok(!("maxBudgetUsdPerCall" in cfg.limits));
});

test("rechaza una configuracion invalida con un problema accionable por campo", () => {
  const mala = { version: 1, provider: { name: "fake" }, repos: {} };
  let err;
  try { loadConfig(escribir(mala), { env: {} }); } catch (e) { err = e; }
  assert.ok(err instanceof ConfigError, "tiene que ser un ConfigError");
  assert.ok(Array.isArray(err.problems));
  assert.ok(err.problems.length >= 2, "un problema por campo, no uno agregado");
  assert.ok(err.problems.some((p) => p.includes("module")), `falta el de module: ${err.problems}`);
  assert.ok(err.problems.some((p) => p.includes("repos")), `falta el de repos: ${err.problems}`);
});

test("resuelve ${VAR:-default} en el env de un repo", () => {
  const cfg = loadConfig(
    escribir({
      ...minima,
      repos: {
        app: {
          ...minima.repos.app,
          env: { DB: "${TEST_DB:-postgres://localhost:5432/x}", TOKEN: "${TOKEN_REAL}" },
        },
      },
    }),
    { env: { TOKEN_REAL: "secreto" } },
  );
  assert.equal(cfg.repos.app.env.DB, "postgres://localhost:5432/x");
  assert.equal(cfg.repos.app.env.TOKEN, "secreto");
});

test("expandVars deja constancia de una variable sin valor ni default", () => {
  assert.equal(expandVars("${A:-x}", {}), "x");
  assert.equal(expandVars("${A}", { A: "1" }), "1");
  assert.throws(() => expandVars("${FALTA}", {}), /FALTA/);
});

test("reporta un estado canonico sin mapear en vez de asumirlo", () => {
  const cfg = loadConfig(
    escribir({
      ...minima,
      provider: {
        ...minima.provider,
        stateMap: { todo: "New", in_progress: "Active", blocked: null, in_review: null, done: null },
      },
    }),
    { env: {} },
  );
  assert.deepEqual(cfg.unmappedStates, ["blocked", "in_review", "done"]);
});

test("no inventa el checkout de un repo: si no hay path, queda nulo para que doctor lo resuelva", () => {
  const cfg = loadConfig(escribir(minima), { env: {} });
  assert.equal(cfg.repos.app.path, null);
});
