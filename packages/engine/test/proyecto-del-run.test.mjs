// El proyecto del run, de quien lanza al archivo de estado.
//
// POR QUE ESTE TEST EXISTE. `createRun` ya sabia escribir `projectId` y
// `planItem` ya lo leia de `deps.projectId`, pero nadie se lo pasaba: la CLI no
// tenia la opcion y `planificar` no la reenviaba. Resultado, medido en el
// recorrido de punta a punta del servicio: todo run lanzado por el motor quedaba
// con `projectId: null`, y el servicio tenia que adivinarlo por la ruta de los
// repositorios. Con el board de la spec 003 el servicio LANZA el motor, asi que
// sabe de que proyecto es el run — y tiene que poder decirlo, no esperar a que
// se deduzca.
//
// Lo que se inyecta es lo mismo que en el e2e del motor: el modelo (que escribe
// el plan donde el motor lo pide) y nada mas. Planificar no toca el forge.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fake from "../../../providers/fake/index.mjs";
import { ejecutarComando } from "../src/comandos.mjs";
import { loadRun } from "../src/state.mjs";

const git = (cwd, ...a) =>
  execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const RAIZ = new URL("../../../", import.meta.url).pathname;

function organizacion() {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-proyecto-"));
  const remoto = join(raiz, "origin.git");
  mkdirSync(remoto);
  git(remoto, "init", "-q", "--bare", "-b", "main");
  const repo = join(raiz, "app");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "equipo@example.test");
  git(repo, "config", "user.name", "El equipo");
  git(repo, "remote", "add", "origin", remoto);
  writeFileSync(join(repo, "README.md"), "la app\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "chore: inicial");
  git(repo, "push", "-q", "origin", "main");
  const home = join(raiz, "home");
  return {
    home,
    config: {
      home,
      version: 1,
      provider: {
        name: "fake",
        module: join(RAIZ, "providers/fake/index.mjs"),
        stateMap: { todo: "Nuevo", in_progress: "En curso", blocked: "Bloqueado", in_review: null, done: null },
      },
      repos: {
        app: { name: "app", path: repo, remote: remoto, baseBranch: "main", gate: "true", runners: {}, env: {}, gaps: [] },
      },
      limits: { maxParallelTasks: 1, maxParallelItems: 1, phaseTimeoutMin: 5, callsPerItem: 10, stallRounds: 2, pollIntervalSec: 120 },
      budgets: { red: 1, green: 1, gate: 1, review: 1 },
      tiers: { small: { model: null, effort: "medium", gate: "fast", review: false, fanout: false } },
      unmappedStates: ["in_review", "done"],
    },
  };
}

/** El modelo que planifica: escribe el DAG donde el prompt dice. */
const planificador = async (fase) => {
  const ruta = /--out (\S+)/.exec(fase.prompt)?.[1];
  assert.ok(ruta, `el prompt de PLAN tiene que decir donde escribir: ${fase.prompt}`);
  mkdirSync(join(ruta, ".."), { recursive: true });
  writeFileSync(
    ruta,
    JSON.stringify({
      repoScope: ["app"],
      evidence: [{ repo: "app", why: "es el unico repositorio" }],
      tasks: [
        {
          id: "T001", repo: "app", title: "una tarea", acceptance: "algo verificable",
          targetFiles: ["src/a.mjs"], testFiles: ["test/a.test.mjs"],
          tier: "small", dependsOn: [], dependencyKind: "hard",
        },
      ],
    }),
  );
  return { ok: true, sessionId: "s-plan", budgetExhausted: false, usd: 0, text: "plan listo" };
};

test("`plan` con `projectId` lo deja escrito en el run: quien lanza sabe de que proyecto es", async () => {
  fake.reset();
  const org = organizacion();
  const r = await ejecutarComando("plan", "2", org.config, {
    inject: { runPhase: planificador },
    materialize: false,
    projectId: "prj-del-board",
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const run = loadRun("2", { home: org.home });
  assert.equal(
    run.projectId,
    "prj-del-board",
    "el run no lleva el proyecto de quien lo lanzo: el servicio tendria que adivinarlo por la ruta del repositorio",
  );
});

test("sin `projectId` el run sigue declarandose sin proyecto, no se inventa uno", async () => {
  fake.reset();
  const org = organizacion();
  const r = await ejecutarComando("plan", "2", org.config, { inject: { runPhase: planificador }, materialize: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(loadRun("2", { home: org.home }).projectId, null);
});

test("la CLI acepta `--project` y lo nombra en la ayuda", () => {
  // La ayuda es lo que lee quien lanza a mano, y el servicio la usa como
  // contrato: una opcion que existe y no se nombra es una opcion que nadie usa.
  // Sin argumentos la CLI imprime la ayuda por stderr y sale con 1.
  let ayuda = "";
  try {
    execFileSync(process.execPath, [join(RAIZ, "packages/engine/bin/noxloop.mjs")], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    ayuda = String(e.stderr);
  }
  assert.match(ayuda, /--project <id>/, "la ayuda no nombra `--project`");
});
