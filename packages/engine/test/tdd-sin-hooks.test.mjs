// El test primero, tambien en un runtime SIN hooks: el motor lo fuerza despues
// de la fase, sobre el worktree.
//
// EL HUECO QUE CIERRA. El principio I lo sostiene un hook `PreToolUse` que corre
// DENTRO del subproceso del runtime. Un runtime que no tiene hooks —Codex
// declara `hooks: false`— no podia ser implementador: el servicio devolvia 409
// `ejecutor_sin_soporte`. Aqui el motor mira lo que la fase dejo en el arbol y
// revierte lo que no le tocaba.
//
// POR QUE ES UNA GARANTIA EQUIVALENTE, Y EN QUE NO LO ES. El hook BLOQUEA la
// escritura antes de que ocurra; esto la DESHACE despues. Para lo que el
// principio I protege —que no llegue codigo de produccion al historial sin un
// rojo visto antes— basta: lo que se revierte no se commitea, la fase cuenta
// como fallida y consume su intento, y el rojo lo sigue concediendo el motor
// corriendo el test (exit code, principio II), no la prosa del modelo. Lo que
// no da es el bloqueo en caliente: durante la fase, el modelo pudo ver su
// propio codigo de produccion correr. Eso no llega a ningun lado.
//
// LO QUE SE MIDE: con el adaptador `fake` sin hooks y guionado para portarse
// mal, lo que la fase escribio fuera de su alcance desaparece del arbol, no
// entra en ningun commit, y la tarea lo dice con la ruta.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRun, loadRun, BUDGETS_DEFAULT } from "../src/state.mjs";
import { runItem } from "../src/driver.mjs";
import { buildDeps } from "../src/wiring.mjs";
import { cambiosDelArbol, fueraDeAlcance, permitidosEnFase, revertir } from "../src/alcance-de-fase.mjs";
import { crearAdaptadorFake } from "../../adapters/src/adaptadores/fake.mjs";

const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const muda = { info() {}, warn() {}, error() {}, child() { return this; } };

const TEST_ROJO = `import { valor } from "../src/T001.mjs";\nif (valor !== 42) throw new Error("rojo");\n`;
const PRODUCCION = "export const valor = 42;\n";

function repoDePrueba() {
  const raiz = realpathSync(mkdtempSync(join(tmpdir(), "noxloop-sin-hooks-")));
  const repo = join(raiz, "repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  mkdirSync(join(repo, "test"), { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.test");
  git(repo, "config", "user.name", "T");
  writeFileSync(join(repo, "README.md"), "base\n");
  writeFileSync(join(repo, "src", "existente.mjs"), "export const x = 1;\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  return { raiz, repo };
}

/** Un recorrido de verdad, con el runtime `fake` sin hooks guionado por fase. */
async function recorrido(fases, over = {}) {
  const { raiz, repo } = repoDePrueba();
  const itemBranch = "feature/1-historia";
  git(repo, "branch", itemBranch);
  const integracion = join(raiz, "wt-int");
  git(repo, "worktree", "add", "-q", integracion, itemBranch);

  const home = join(raiz, "home");
  createRun({
    item: { id: "1", key: "H-1", title: "la historia", level: "story", url: "http://g/1", provider: "fake",
            acceptance: ["hace lo que promete"] },
    repoScope: ["app"],
    tasks: [{
      id: "T001", repo: "app", title: "tarea", acceptance: "valor es 42",
      targetFiles: ["src/T001.mjs"], testFiles: ["test/T001.test.mjs"],
      tier: "small", dependsOn: [], dependencyKind: "hard",
    }],
  }, { home });

  const guion = join(raiz, "guion.json");
  writeFileSync(guion, JSON.stringify({ texto: "listo", exito: true, fases }));
  const fake = crearAdaptadorFake({ home, guion, visto: join(raiz, "visto.json") });
  assert.equal(fake.capabilities().hooks, false, "el escenario necesita un runtime SIN hooks");

  const config = {
    home,
    repos: { app: { gate: "true", fastGate: "true", baseBranch: "main", env: {}, gaps: [], remote: "git@x:o/app.git",
                    runners: { node: "node {file}" } } },
    tiers: { small: { model: null, effort: "medium", gate: "fast", review: true, fanout: false } },
    runtime: "fake",
  };
  const deps = await buildDeps({ id: "1" }, config, {
    provider: {}, providerCtx: {}, log: muda, adaptadores: [fake], env: { PATH: process.env.PATH || "/usr/bin" },
    inject: {
      runSingleTest: (_r, cwd, file) => {
        try {
          execFileSync(process.execPath, ["--input-type=module", "-e", `await import("file://${join(cwd, file)}")`],
            { stdio: ["ignore", "pipe", "pipe"] });
          return { ok: true, exitCode: 0, command: `node ${file}`, durationMs: 1, output: "", timedOut: false, gaps: [] };
        } catch (e) {
          return { ok: false, exitCode: 1, command: `node ${file}`, durationMs: 1, output: String(e.stderr || ""), timedOut: false, gaps: [] };
        }
      },
      runGate: () => ({ ok: true, exitCode: 0, command: "true", durationMs: 1, output: "ok", timedOut: false, gaps: [] }),
      createPR: async () => ({ url: "http://forge/pr/1", alreadyExisted: false, body: "" }),
      resolve: () => ({ repoPath: repo, integrationPath: integracion, itemBranch, baseBranch: "main" }),
      ...over,
    },
  });
  const r = await runItem("1", deps);
  const t = loadRun("1", { home }).tasks[0];
  return { r, t, repo, deps, raiz };
}

/** Todos los archivos que tocaron los commits de una rama. */
const tocadosEnLaRama = (repo, rama) => git(repo, "log", "--format=", "--name-only", rama).split("\n").filter(Boolean);

// ---------------------------------------------------------------------------
// las piezas
// ---------------------------------------------------------------------------

test("el arbol se lee entero —modificado, nuevo en carpeta nueva, borrado— y se revierte a HEAD", () => {
  const { repo } = repoDePrueba();
  writeFileSync(join(repo, "src", "existente.mjs"), "export const x = 2;\n");
  mkdirSync(join(repo, "nueva", "honda"), { recursive: true });
  writeFileSync(join(repo, "nueva", "honda", "a.txt"), "a");
  rmSync(join(repo, "README.md"));
  writeFileSync(join(repo, "test", "ok.test.mjs"), "t");

  const cambios = cambiosDelArbol(repo);
  assert.deepEqual([...cambios].sort(), ["README.md", "nueva/honda/a.txt", "src/existente.mjs", "test/ok.test.mjs"]);

  const fuera = fueraDeAlcance(cambios, ["test/ok.test.mjs"]);
  assert.deepEqual([...fuera].sort(), ["README.md", "nueva/honda/a.txt", "src/existente.mjs"]);

  revertir(repo, fuera);
  assert.equal(readFileSync(join(repo, "src", "existente.mjs"), "utf8"), "export const x = 1;\n");
  assert.equal(readFileSync(join(repo, "README.md"), "utf8"), "base\n", "un borrado fuera de alcance no se restauro");
  assert.equal(existsSync(join(repo, "nueva", "honda", "a.txt")), false);
  assert.equal(readFileSync(join(repo, "test", "ok.test.mjs"), "utf8"), "t", "se revirtio lo que SI estaba permitido");
  assert.deepEqual(cambiosDelArbol(repo), ["test/ok.test.mjs"]);
});

test("que puede tocar cada fase: RED solo sus tests; GREEN objetivos, tests y lo ampliado con add-target", () => {
  const t = { targetFiles: ["src/a.mjs", "src/ampliado.mjs"], testFiles: ["test/a.test.mjs"],
              addedTargets: [{ path: "src/ampliado.mjs", why: "x" }] };
  assert.deepEqual(permitidosEnFase("RED", t), ["test/a.test.mjs"]);
  assert.deepEqual([...permitidosEnFase("GREEN", t)].sort(), ["src/a.mjs", "src/ampliado.mjs", "test/a.test.mjs"]);
  assert.equal(permitidosEnFase("REVIEW", t), null, "una fase que no escribe no tiene guarda de alcance aqui");
});

test("el cableado enciende la guarda posterior para un runtime sin hooks, y no para uno con hooks", async () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-sin-hooks-"));
  const sin = await buildDeps({ id: "1" }, { home, repos: {} }, {
    provider: {}, providerCtx: {}, log: muda, adaptadores: [crearAdaptadorFake({ home })], env: {},
  });
  assert.equal(sin.alcancePorElMotor, true);
  const con = await buildDeps({ id: "1" }, { home, repos: {} }, {
    provider: {}, providerCtx: {}, log: muda, adaptadores: [crearAdaptadorFake({ home, hooks: [["true"]] })], env: {},
  });
  assert.equal(con.alcancePorElMotor, false);
});

// ---------------------------------------------------------------------------
// el recorrido
// ---------------------------------------------------------------------------

test("RED que escribe produccion: el motor la revierte, la fase falla con la ruta, y cuenta intento", async () => {
  const { t, repo } = await recorrido({
    RED: { escribir: { "test/T001.test.mjs": TEST_ROJO, "src/T001.mjs": PRODUCCION } },
    GREEN: { escribir: { "src/T001.mjs": PRODUCCION } },
  });

  assert.equal(t.status, "blocked", `la tarea avanzo con produccion escrita en RED: ${t.status}`);
  assert.equal(t.attempts.red, BUDGETS_DEFAULT.red, "la violacion no consumio los intentos del rojo");
  assert.ok(!t.redVerified, "se concedio el rojo en una fase que escribio produccion");
  assert.match(t.lastFailure, /src\/T001\.mjs/, `el diagnostico no nombra lo que se escribio: ${t.lastFailure}`);
  assert.match(t.lastFailure, /revert/i);
  assert.equal(existsSync(join(t.worktree, "src", "T001.mjs")), false, "la produccion escrita en RED sigue en el arbol");
  assert.ok(!tocadosEnLaRama(repo, t.branch).includes("src/T001.mjs"), "la produccion de RED entro en un commit");
});

test("GREEN que escribe fuera de su alcance: se revierte lo ajeno, se conserva lo suyo, y cuenta intento", async () => {
  const { t } = await recorrido({
    RED: { escribir: { "test/T001.test.mjs": TEST_ROJO } },
    GREEN: { escribir: { "src/T001.mjs": PRODUCCION, "src/existente.mjs": "export const x = 99;\n", "notas.txt": "x" } },
  });

  assert.ok(t.redVerified, "el rojo bien hecho no se concedio");
  assert.equal(t.status, "blocked");
  assert.equal(t.attempts.green, BUDGETS_DEFAULT.green);
  assert.match(t.lastFailure, /notas\.txt/);
  assert.match(t.lastFailure, /src\/existente\.mjs/);
  assert.equal(existsSync(join(t.worktree, "notas.txt")), false);
  assert.equal(readFileSync(join(t.worktree, "src", "existente.mjs"), "utf8"), "export const x = 1;\n");
  assert.equal(readFileSync(join(t.worktree, "src", "T001.mjs"), "utf8"), PRODUCCION, "se revirtio lo que la tarea declaro");
});

test("un runtime sin hooks que respeta el orden llega al PR: puede ser implementador", async () => {
  const { r, t, repo } = await recorrido({
    RED: { escribir: { "test/T001.test.mjs": TEST_ROJO } },
    GREEN: { escribir: { "src/T001.mjs": PRODUCCION } },
  });
  assert.equal(r.pr, "http://forge/pr/1", JSON.stringify({ r, t }, null, 2));
  assert.equal(t.status, "integrated");
  assert.equal(t.attempts.red, 0);
  const log = git(repo, "log", "--format=%s", t.branch).split("\n");
  assert.ok(log.findIndex((s) => s.startsWith("test(")) > log.findIndex((s) => s.startsWith("feat(")),
    "el commit del test no quedo antes que el de la implementacion");
});

test("si durante la fase se movio la rama base, la tarea se bloquea ahi mismo diciendolo", async () => {
  const { t, repo } = await recorrido({
    RED: {
      escribir: { "test/T001.test.mjs": TEST_ROJO },
      correr: [["git", "commit", "-q", "--allow-empty", "-m", "intruso"], ["git", "update-ref", "refs/heads/main", "HEAD"]],
    },
  });
  assert.equal(t.status, "blocked");
  assert.match(t.lastFailure, /main/);
  assert.match(t.lastFailure, /mov/i);
  assert.equal(t.attempts.red, 1, "un movimiento de la rama protegida no se reintenta: se bloquea en el primero");
  assert.ok(git(repo, "log", "--format=%s", "main").includes("intruso"), "el escenario no llego a mover la rama");
});
