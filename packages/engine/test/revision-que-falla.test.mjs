// Una REVISION QUE NO PUDO CORRER no es una revision limpia.
//
// MEDIDO EN UN RUN REAL (2026-09-24): se mato el motor a mitad de la fase RED,
// la tarea quedo en `in_progress`, y Retry (`noxloop resume`) escribia
// "retomando 1 tarea(s) que quedaron en vuelo" y cortaba al instante por
// "el estado dejo de avanzar": el conjunto listo excluye a proposito lo que
// esta en vuelo, y `prepararReanudacion` —que rebobina lo que se puede
// relanzar sin riesgo— estaba importada en comandos.mjs y nunca se llamaba.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRun, loadRun, transition } from "../src/state.mjs";
import { ejecutarComando } from "../src/comandos.mjs";

const muda = { info() {}, warn() {}, error() {}, child() { return this; } };
const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const PLAN = {
  item: { id: "1", key: "H-1", title: "la historia", level: "story", url: "http://g/1", provider: "fake", acceptance: ["a"] },
  repoScope: ["app"],
  tasks: [{
    id: "T001", repo: "app", title: "tarea", acceptance: "valor es 42",
    targetFiles: ["src/T001.mjs"], testFiles: ["test/T001.test.mjs"],
    tier: "small", dependsOn: [], dependencyKind: "hard",
  }],
};

/** @param {string} id @param {{hooks?: boolean, requiredEnv?: string[], fases?: Record<string, any>}} [o] */
function runtime(id, o = {}) {
  /** @type {any[]} */
  const vistas = [];
  return {
    id,
    requiredEnv: o.requiredEnv ?? [],
    capabilities: () => ({ resume: false, cost: false, effort: false, hooks: o.hooks ?? true, models: "desconocido", comandos: true }),
    preflight: async () => ({ ok: true }),
    runPhase: async (/** @type {any} */ req, /** @type {any} */ llamada) => {
      vistas.push(req);
      llamada?.alEvento?.({ t: new Date().toISOString(), tipo: "texto", contenido: `${id} en ${req.phase}` });
      const guion = o.fases?.[req.phase];
      for (const [ruta, contenido] of Object.entries(guion?.escribir ?? {})) {
        mkdirSync(join(req.cwd, ruta, ".."), { recursive: true });
        writeFileSync(join(req.cwd, ruta), String(contenido));
      }
      return { ok: true, sessionId: `sesion-${id}`, usd: null, text: guion?.texto ?? "listo", budgetExhausted: false, subtype: null };
    },
    vistas,
  };
}

const TEST_ROJO = `import { valor } from "../src/T001.mjs";\nif (valor !== 42) throw new Error("rojo: " + valor);\n`;

function escenario() {
  const raiz = realpathSync(mkdtempSync(join(tmpdir(), "noxloop-handoff-e2e-")));
  const repo = join(raiz, "repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.test");
  git(repo, "config", "user.name", "T");
  writeFileSync(join(repo, "README.md"), "base\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  const itemBranch = "feature/1-historia";
  git(repo, "branch", itemBranch);
  const integracion = join(raiz, "wt-int");
  git(repo, "worktree", "add", "-q", integracion, itemBranch);
  const home = join(raiz, "home");
  createRun(PLAN, { home });

  const primero = runtime("primero", {
    fases: {
      RED: { escribir: { "test/T001.test.mjs": TEST_ROJO } },
      GREEN: { escribir: { "src/T001.mjs": "export const valor = 42;\n" } },
    },
  });
  const otro = runtime("otro", {
    fases: {
      RED: { escribir: { "test/T001.test.mjs": "throw new Error('RED repetido');\n" } },
      GREEN: { escribir: { "src/T001.mjs": "export const valor = 42;\n" } },
    },
  });
  const rev = runtime("rev", { fases: { REVIEW: { texto: "sin hallazgos bloqueantes" } } });

  const config = {
    home,
    repos: { app: { gate: "true", fastGate: "true", baseBranch: "main", env: {}, gaps: [], remote: "git@x:o/app.git" } },
    tiers: { small: { model: null, effort: "medium", gate: "fast", review: true, fanout: false } },
    runtimes: { implementador: "primero", revisor: "rev" },
  };
  const inject = {
    runSingleTest: (/** @type {string} */ _r, /** @type {string} */ cwd, /** @type {string} */ file) => {
      try {
        execFileSync(process.execPath, ["--input-type=module", "-e", `await import("file://${join(cwd, file)}")`], { stdio: ["ignore", "pipe", "pipe"] });
        return { ok: true, exitCode: 0, command: `node ${file}`, durationMs: 1, output: "", timedOut: false, gaps: [] };
      } catch (e) {
        return { ok: false, exitCode: 1, command: `node ${file}`, durationMs: 1, output: String(/** @type {any} */ (e).stderr || ""), timedOut: false, gaps: [] };
      }
    },
    runGate: () => ({ ok: true, exitCode: 0, command: "true", durationMs: 1, output: "ok", timedOut: false, gaps: [] }),
    createPR: async () => ({ url: "http://forge/pr/1", alreadyExisted: false, body: "" }),
    resolve: () => ({ repoPath: repo, integrationPath: integracion, itemBranch, baseBranch: "main" }),
  };
  const opciones = { provider: {}, providerCtx: {}, log: muda, adaptadores: [primero, otro, rev], env: { PATH: process.env.PATH || "/usr/bin" }, inject };
  return { raiz, repo, home, config, primero, otro, rev, opciones };
}


// MEDIDO EN EL PRIMER RUN REAL (2026-09-24): el revisor era Codex con la
// sesion vencida ("Your access token could not be refreshed"). La fase REVIEW
// volvio `ok: false` sin veredicto, y el motor la trato como "sin hallazgos":
// la tarea se integro SIN que nadie la revisara. Es el verde inventado del
// principio II. Una revision que no corrio se reintenta con su presupuesto, y
// al agotarlo la tarea se bloquea con la causa real.
test("un revisor que FALLA no aprueba: la tarea no se integra, y se bloquea con la causa", async () => {
  const e = escenario();
  // El revisor falla siempre, como un runtime con la sesion vencida.
  e.rev.runPhase = async () => ({ ok: false, sessionId: null, usd: null, text: "Your access token could not be refreshed. Please log out and sign in again.", budgetExhausted: false, subtype: null });

  const r = /** @type {any} */ (await ejecutarComando("run", "1", e.config, e.opciones));
  const t = loadRun("1", { home: e.home }).tasks[0];

  assert.notEqual(t.status, "integrated", "se integro una tarea que nadie reviso");
  assert.equal(t.status, "blocked");
  assert.match(t.lastFailure, /revision/i);
  assert.match(t.lastFailure, /access token could not be refreshed/);
  assert.equal(r.pr ?? null, null, "se abrio un PR con una tarea sin revisar");
});

// Una SESION VENCIDA no es un fallo del codigo: reintentar con la misma sesion
// da lo mismo y solo quema los intentos de la tarea. Se bloquea en el acto con
// la accion que la arregla (`codex login` / `claude auth login`).
test("una fase que falla por sesion vencida bloquea la tarea en el acto, con la accion, sin gastar reintentos", async () => {
  const e = escenario();
  let llamadas = 0;
  e.primero.runPhase = async () => {
    llamadas++;
    return {
      ok: false, sessionId: null, usd: null, budgetExhausted: false,
      subtype: "sin_sesion",
      text: "la sesion de codex esta vencida",
      causa: "la sesion de codex esta vencida: el runtime no pudo renovar su token",
      accion: "Corre `codex login` y vuelve a lanzar la tarea.",
    };
  };

  await ejecutarComando("run", "1", e.config, e.opciones);
  const t = loadRun("1", { home: e.home }).tasks[0];

  assert.equal(t.status, "blocked");
  assert.match(t.lastFailure, /codex login/);
  assert.equal(llamadas, 1, "reintento con una sesion vencida: quema intentos sin poder avanzar");
});
