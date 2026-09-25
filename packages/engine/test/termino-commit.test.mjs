// El termino `commit`: el recorrido entero, sin remoto, y el resultado en una
// rama del repositorio del operador.
//
// EL HUECO QUE CIERRA, medido. Un repositorio local sin `origin` no podia
// correr nada: el esquema exigia `repos.<x>.remote`, `repoRoot` verificaba el
// remoto antes de devolver la ruta y el driver terminaba siempre en `createPR`.
// El referente termina una tarea «sin commitear», «con commit» o «con PR»;
// nosotros solo sabiamos la tercera, y un proyecto que empieza en una carpeta
// —que es como empieza casi todo— se quedaba en «Sin repo».
//
// POR QUE ESTO NO ESTIRA EL PRINCIPIO IV. «La autonomia termina en el PR
// abierto» existe para que nada llegue a una rama protegida sin revision
// humana. Un commit en una rama LOCAL queda del lado seguro con mas margen que
// un PR: no se empuja, no se mergea, y la rama base no se toca. Lo que este
// archivo mide es exactamente eso — que el recorrido es el mismo (worktrees,
// TDD con el test antes que la implementacion, gate, cola de integracion) y
// que al final NO hay fetch, ni push, ni `createPR`, y `main` sigue donde
// estaba.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as fake from "../../../providers/fake/index.mjs";
import { crearAdaptadorFake } from "../../adapters/src/adaptadores/fake.mjs";
import { ejecutarComando } from "../src/comandos.mjs";
import { loadConfig, ConfigError } from "../src/config.mjs";
import { loadRun } from "../src/state.mjs";

const git = (cwd, ...a) =>
  execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const RAIZ_MOTOR = new URL("../../../", import.meta.url).pathname;

// ---------------------------------------------------------------------------
// la configuracion
// ---------------------------------------------------------------------------

function escribir(cfg) {
  const d = mkdtempSync(join(tmpdir(), "noxloop-termino-"));
  const p = join(d, "noxloop.config.json");
  writeFileSync(p, JSON.stringify(cfg));
  return p;
}

const sinRemoto = (extra = {}) => ({
  version: 1,
  provider: { name: "fake", module: "providers/fake/index.mjs" },
  repos: { app: { baseBranch: "main", gate: "npm test" } },
  ...extra,
});

test("con `termino: commit` el remoto deja de ser obligatorio", () => {
  const cfg = loadConfig(escribir(sinRemoto({ termino: "commit" })), { env: {} });
  assert.equal(cfg.termino, "commit");
  assert.equal(cfg.repos.app.remote, undefined);
});

test("sin `termino` es `pr`, y `pr` sin remoto se rechaza con la causa y la salida", () => {
  let err;
  try {
    loadConfig(escribir(sinRemoto()), { env: {} });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof ConfigError, `tenia que rechazarse: ${err}`);
  const problema = err.problems.find((p) => p.includes("remote"));
  assert.ok(problema, `ningun problema nombra el remoto: ${err.problems}`);
  // La causa: el PR necesita un remoto contra el que abrirse.
  assert.match(problema, /pr/);
  // Y la accion: declararlo, o terminar en commit.
  assert.match(problema, /termino.*commit/);

  const conRemoto = loadConfig(escribir({ ...sinRemoto(), repos: { app: { remote: "git@x:o/app.git", baseBranch: "main", gate: "npm test" } } }), { env: {} });
  assert.equal(conRemoto.termino, "pr", "el termino por defecto sigue siendo el PR");
});

test("un termino que no existe no pasa el esquema: ninguno mergea", () => {
  assert.throws(() => loadConfig(escribir(sinRemoto({ termino: "merge" })), { env: {} }), ConfigError);
});

// ---------------------------------------------------------------------------
// el recorrido, de punta a punta, sin remoto
// ---------------------------------------------------------------------------

/** Un repositorio del operador SIN `origin`: una carpeta con git y nada mas. */
function repoLocal() {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-commit-"));
  const repo = join(raiz, "app");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "operador@example.test");
  git(repo, "config", "user.name", "El operador");
  mkdirSync(join(repo, "src"));
  mkdirSync(join(repo, "test"));
  writeFileSync(join(repo, "README.md"), "la app\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "chore: inicial");

  const home = join(raiz, "noxloop-home");
  const config = {
    home,
    version: 1,
    termino: "commit",
    provider: {
      name: "fake",
      module: join(RAIZ_MOTOR, "providers/fake/index.mjs"),
      stateMap: { todo: "Nuevo", in_progress: "En curso", blocked: "Bloqueado", in_review: "En revision", done: null },
    },
    repos: {
      app: {
        name: "app", path: repo, baseBranch: "main",
        gate: "test -f src/permisos.mjs", fastGate: "test -f src/permisos.mjs",
        runners: { node: "node {file}" },
        env: {}, gaps: [],
      },
    },
    limits: { maxParallelTasks: 4, maxParallelItems: 2, phaseTimeoutMin: 5, callsPerItem: 60, stallRounds: 2, pollIntervalSec: 120 },
    budgets: { red: 2, green: 3, gate: 3, review: 2 },
    tiers: { small: { model: null, effort: "medium", gate: "fast", review: true, fanout: false } },
    unmappedStates: ["done"],
  };
  return { raiz, repo, home, config };
}

/**
 * El modelo: escribe el plan, el test y la implementacion donde el motor lo
 * pide, y la fase la corre el adaptador `fake` DE VERDAD —un subproceso con el
 * entorno que el motor declara—, como en el fixture del servicio.
 */
function modelo() {
  const adaptador = crearAdaptadorFake();
  return async (fase) => {
    if (fase.phase === "PLAN") {
      const ruta = /--out (\S+)/.exec(fase.prompt)?.[1];
      assert.ok(ruta, `el prompt de PLAN tiene que decir donde escribir: ${fase.prompt}`);
      mkdirSync(join(ruta, ".."), { recursive: true });
      writeFileSync(ruta, JSON.stringify({
        repoScope: ["app"],
        evidence: [{ repo: "app", why: "los permisos viven en src/" }],
        tasks: [{
          id: "T001", repo: "app", title: "publicar el catalogo de permisos",
          acceptance: "el modulo de permisos exporta el catalogo",
          targetFiles: ["src/permisos.mjs"], testFiles: ["test/permisos.test.mjs"],
          tier: "small", dependsOn: [], dependencyKind: "hard",
        }],
      }));
    }
    const t = fase.task;
    if (fase.phase === "RED") {
      mkdirSync(join(fase.cwd, "test"), { recursive: true });
      writeFileSync(join(fase.cwd, t.testFiles[0]),
        `import { catalogo } from "../${t.targetFiles[0]}";\nif (!Array.isArray(catalogo)) throw new Error("rojo");\n`);
    }
    if (fase.phase === "GREEN") {
      mkdirSync(join(fase.cwd, "src"), { recursive: true });
      writeFileSync(join(fase.cwd, t.targetFiles[0]), "export const catalogo = [\"leer\", \"escribir\"];\n");
    }
    return await adaptador.runPhase(fase);
  };
}

test("sin remoto y con `termino: commit`, el ticket llega a «rama lista»: test antes que implementacion, y `main` intacto", async () => {
  fake.reset();
  const org = repoLocal();
  const mainAntes = git(org.repo, "rev-parse", "main");
  let prPedidos = 0;
  const inject = {
    runPhase: modelo(),
    // Con `commit` nadie abre un PR. Si el driver lo llama, el test lo cuenta.
    createPR: async () => {
      prPedidos++;
      return { url: "https://forge.test/pr/1", alreadyExisted: false };
    },
  };

  const plan = await ejecutarComando("plan", "2", org.config, { inject });
  assert.equal(plan.ok, true, `no planifico: ${JSON.stringify(plan)}`);

  const corrida = await ejecutarComando("run", "2", org.config, { inject });
  assert.equal(prPedidos, 0, "con `termino: commit` el motor no pide un PR");
  assert.equal(corrida.pr, null);
  assert.equal(corrida.termino, "commit");
  assert.deepEqual(corrida.integrated, ["T001"]);
  assert.deepEqual(corrida.blocked, []);

  const run = loadRun("2", { home: org.home });
  const rama = run.item.branch;
  assert.equal(corrida.rama, rama, "el resultado dice en que rama quedo el trabajo");
  assert.equal(run.item.termino, "commit");
  assert.equal(run.item.ramaLista?.rama, rama, "el estado del run dice que la rama esta lista");
  assert.equal(run.item.pr ?? null, null);

  // LA RAMA ESTA EN EL REPOSITORIO DEL OPERADOR: los worktrees comparten refs,
  // asi que `git log <rama>` funciona desde su checkout sin hacer nada.
  const historial = git(org.repo, "log", "--format=%s", "--reverse", `main..${rama}`).split("\n");
  const iTest = historial.findIndex((l) => l.startsWith("test("));
  const iImpl = historial.findIndex((l) => l.startsWith("feat("));
  assert.ok(iTest >= 0, `no hay commit de test: ${historial.join(" | ")}`);
  assert.ok(iImpl > iTest, `el test tiene que ir antes que la implementacion: ${historial.join(" | ")}`);
  assert.match(git(org.repo, "show", `${rama}:src/permisos.mjs`), /catalogo/);

  // Los commits que devuelve el resultado son esos, en el mismo orden.
  assert.deepEqual(corrida.commits.map((c) => c.asunto), historial);
  assert.ok(corrida.commits.every((c) => /^[0-9a-f]{40}$/.test(c.sha)));

  // LA RAMA BASE NO SE MOVIO, y nada salio de la maquina: no hay remoto al que
  // empujar, y el repositorio no gano ninguno por el camino.
  assert.equal(git(org.repo, "rev-parse", "main"), mainAntes, "el motor movio `main`");
  assert.equal(git(org.repo, "remote"), "", "el recorrido le agrego un remoto al repositorio del operador");
  assert.equal(git(org.repo, "status", "--porcelain"), "", "el checkout del operador quedo sucio");

  // EL GESTOR, AL DIA: en revision, y un comentario que dice donde mirar.
  assert.equal(fake.db.states["2"], "En revision");
  const cierre = fake.db.comments.find((c) => c.id === "2" && c.text.includes(rama));
  assert.ok(cierre, `el ticket no dice en que rama quedo: ${JSON.stringify(fake.db.comments)}`);
  assert.match(cierre.text, /git log/);
  assert.doesNotMatch(cierre.text, /pull request/i, "no se habla de un PR que no existe");

  // El resumen humano tampoco.
  assert.ok(corrida.humano.some((l) => l.includes(rama)), corrida.humano.join("\n"));
  assert.ok(!corrida.humano.some((l) => /sin PR/.test(l)), "«sin PR» se lee como un fallo, y no lo es");
});
