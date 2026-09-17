// De asignar un ticket a un pull request, por el cableado DE VERDAD.
//
// POR QUE ESTE ARCHIVO ES EL MAS IMPORTANTE DEL PROYECTO. Es el unico que
// ejercita el camino completo sin inyectar los pasos intermedios. La revision
// adversarial del daemon lo dejo dicho con estas palabras: "nada de esto prueba
// el cableado: `despachar` esta inyectado en todos los tests, asi que lo que
// corre de verdad cuando un ticket entra —resolver el nivel, planificar,
// ejecutar, abrir el PR— no esta ejercitado". Setenta tests afirmaban sobre el
// bucle y la bandeja, y cero sobre el recorrido.
//
// LO QUE SE INYECTA, y es todo lo que no puede existir sin red ni cuenta:
//   - `runPhase`  el modelo. Un modelo de mentira que SI hace el trabajo:
//                 escribe el plan, el test y la implementacion.
//   - `createPR`  el forge.
//
// LO QUE CORRE DE VERDAD: la bandeja, la deduplicacion, el despacho por nivel,
// el planificador con su validacion de DAG, el estado con sus guardas, el
// scheduler, los worktrees de git, el gate (un comando de shell real), los dos
// commits por tarea, la cola de integracion con su rebase, y el proveedor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fake from "../../../providers/fake/index.mjs";
import { ejecutarComando } from "../src/comandos.mjs";
import { planFile } from "../src/planner.mjs";
import { loadRun } from "../src/state.mjs";

const git = (cwd, ...a) =>
  execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const RAIZ_MOTOR = new URL("../../../", import.meta.url).pathname;

/** Un repositorio de trabajo con su remoto local, como el de una organizacion. */
function organizacion() {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-e2e-"));
  const remoto = join(raiz, "origin.git");
  mkdirSync(remoto);
  git(remoto, "init", "-q", "--bare", "-b", "main");

  const repo = join(raiz, "app");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "equipo@example.test");
  git(repo, "config", "user.name", "El equipo");
  git(repo, "remote", "add", "origin", remoto);
  mkdirSync(join(repo, "src"));
  mkdirSync(join(repo, "test"));
  writeFileSync(join(repo, "README.md"), "la app\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "chore: inicial");
  git(repo, "push", "-q", "origin", "main");

  const home = join(raiz, "noxloop-home");
  const config = {
    home,
    version: 1,
    provider: {
      name: "fake",
      module: join(RAIZ_MOTOR, "providers/fake/index.mjs"),
      stateMap: { todo: "Nuevo", in_progress: "En curso", blocked: "Bloqueado", in_review: null, done: null },
    },
    forge: { kind: "github", cli: "gh" },
    identity: { assignee: "noxloop[bot]", mention: "@noxloop" },
    repos: {
      app: {
        name: "app", path: repo, remote: remoto, baseBranch: "main",
        // Gates REALES: comandos de shell que corren de verdad.
        gate: "test -f src/permisos.mjs", fastGate: "test -f src/permisos.mjs",
        runners: { node: "node {file}" },
        env: {}, gaps: ["sin cobertura de e2e"],
      },
    },
    limits: { maxParallelTasks: 4, maxParallelItems: 2, phaseTimeoutMin: 5, callsPerItem: 60, stallRounds: 2, pollIntervalSec: 120 },
    budgets: { red: 2, green: 3, gate: 3, review: 2 },
    tiers: { small: { model: null, effort: "medium", gate: "fast", review: true, fanout: false } },
    unmappedStates: ["in_review", "done"],
  };
  return { raiz, repo, remoto, home, config };
}

/**
 * El modelo. De mentira, pero hace el trabajo: en PLAN escribe el DAG donde el
 * motor lo espera, en RED el test, en GREEN la implementacion.
 */
function modelo(registro) {
  return async (fase) => {
    registro.push(`${fase.phase}${fase.taskId ? `:${fase.taskId}` : ""}`);

    if (fase.phase === "PLAN") {
      const destino = planFile(fase.cwd.includes("noxloop-home") ? "" : "", "2");
      // La ruta la manda el motor en el prompt; se la respeta.
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
      return { ok: true, sessionId: "s-plan", budgetExhausted: false, usd: 0.4, text: "plan listo" };
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
    return { ok: true, sessionId: `s-${t.id}`, budgetExhausted: false, usd: 0.2, text: "hecho" };
  };
}

const forgeFalso = (capturado) => async (run, opts) => {
  capturado.push({ base: opts.base, cuerpo: opts.gaps, rama: run.item.branch });
  return { url: "https://forge.test/pr/1", alreadyExisted: false };
};

// ---------------------------------------------------------------------------

test("un ticket asignado llega a pull request por el cableado real", async () => {
  fake.reset();
  const org = organizacion();
  const registro = [];
  const prs = [];
  const inject = { runPhase: modelo(registro), createPR: forgeFalso(prs) };

  // 1. Alguien asigna el ticket en el gestor. Eso es TODO lo que hace.
  fake.db.inbox = { assigned: ["2"], mentioned: [] };

  // 2. La bandeja lo ve. Corre de verdad: consulta el proveedor y deduplica.
  const bandeja = await ejecutarComando("inbox", null, org.config, { inject });
  assert.equal(bandeja.nuevos.length, 1, `la bandeja no lo vio: ${JSON.stringify(bandeja)}`);
  assert.equal(bandeja.nuevos[0].id, "2");

  // 3. El despacho resuelve el nivel PREGUNTANDOLE al proveedor.
  const despacho = await ejecutarComando("dispatch", "2", org.config, { inject });
  assert.equal(despacho.level, "story");
  assert.equal(despacho.accion, "plan+run");

  // 4. Planificar. Corre el planificador de verdad: valida el DAG, el alcance y
  //    los criterios, y crea el recorrido.
  const plan = await ejecutarComando("plan", "2", org.config, { inject });
  assert.equal(plan.ok, true, `no planifico: ${JSON.stringify(plan)}`);
  assert.equal(plan.tasks, 1);

  // 5. Ejecutar. Worktrees, ciclo TDD, gate real, commits, cola de integracion.
  const corrida = await ejecutarComando("run", "2", org.config, { inject });
  assert.equal(corrida.pr, "https://forge.test/pr/1", `no llego al PR: ${JSON.stringify(corrida)}`);
  assert.deepEqual(corrida.integrated, ["T001"]);
  assert.deepEqual(corrida.blocked, []);

  // --- y ahora lo que de verdad importa: QUE QUEDO ---

  const run = loadRun("2", { home: org.home });
  const rama = run.item.branch;

  // El test existio y fallo antes de la implementacion, y se puede comprobar
  // en el historial sin leer una linea del motor.
  const historial = git(org.repo, "log", "--format=%s", "--reverse", rama).split("\n");
  const iTest = historial.findIndex((l) => l.startsWith("test("));
  const iImpl = historial.findIndex((l) => l.startsWith("feat("));
  assert.ok(iTest >= 0, `no hay commit de test: ${historial.join(" | ")}`);
  assert.ok(iImpl > iTest, `el orden no se ve en el historial: ${historial.join(" | ")}`);

  // El codigo esta de verdad en la rama del ticket.
  assert.match(git(org.repo, "show", `${rama}:src/permisos.mjs`), /catalogo/);

  // La rama base NO se movio: la autonomia termina en el PR abierto.
  assert.equal(git(org.repo, "log", "--oneline", "main").split("\n").length, 1);
  assert.equal(git(org.remoto, "log", "--oneline", "main").split("\n").length, 1);

  // El PR apunta a la base, y el cuerpo trae los huecos declarados del gate.
  assert.equal(prs.length, 1);
  assert.equal(prs[0].base, "main");
  assert.deepEqual(prs[0].cuerpo.app, ["sin cobertura de e2e"]);

  // El gasto de cada invocacion quedo anotado.
  assert.ok(run.spent.calls >= registro.length - 1, `invocaciones sin anotar: ${JSON.stringify(run.spent)}`);

  // El gestor quedo al dia y NUNCA se cerro el ticket.
  assert.equal(run.item.providerStateWritten, "in_progress");
  assert.ok(!fake.db.states["2"] || fake.db.states["2"] !== "Cerrado");
  assert.ok(fake.db.comments.some((c) => c.text.includes("https://forge.test/pr/1")),
    "el PR tiene que quedar en el ticket; el gestor falso no soporta linkUrl, asi que va como comentario");

  // Y la bandeja ya no lo ofrece: tiene recorrido.
  const segunda = await ejecutarComando("inbox", null, org.config, { inject });
  assert.equal(segunda.nuevos.length, 0, "lo volveria a despachar");
  assert.equal(segunda.vistos.length, 1);
});

test("el mismo ticket asignado Y mencionado produce UN solo recorrido, por el cableado real", async () => {
  fake.reset();
  const org = organizacion();
  const inject = { runPhase: modelo([]), createPR: forgeFalso([]) };
  fake.db.inbox = { assigned: ["2"], mentioned: ["2"] };

  const bandeja = await ejecutarComando("inbox", null, org.config, { inject });
  assert.equal(bandeja.nuevos.length, 1);
  assert.deepEqual(bandeja.nuevos[0].disparos.sort(), ["assigned", "mentioned"]);
});

test("un ticket sin criterios verificables no produce codigo, y lo dice", async () => {
  fake.reset();
  const org = organizacion();
  const registro = [];
  const inject = { runPhase: modelo(registro), createPR: forgeFalso([]) };
  // Se le quitan los criterios al ticket.
  fake.db.items["2"].acceptance = [];
  fake.db.inbox = { assigned: ["2"], mentioned: [] };

  const plan = await ejecutarComando("plan", "2", org.config, { inject });
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /criterio/i);
  assert.ok(plan.question, "tiene que dejar la pregunta concreta");
  assert.deepEqual(registro, [], "no se gasta una invocacion en algo que no se puede planificar");
  assert.equal(loadRun("2", { home: org.home }), null, "no queda un recorrido a medias");
});

test("`run` sin plan se niega: el motor no replanifica solo", async () => {
  fake.reset();
  const org = organizacion();
  const inject = { runPhase: modelo([]), createPR: forgeFalso([]) };
  const r = await ejecutarComando("run", "2", org.config, { inject });
  assert.equal(r.ok, false);
  assert.match(r.humano.join(" "), /plan/i);
});

test("--dry-run recorre el cableado y no escribe nada", async () => {
  fake.reset();
  const org = organizacion();
  const registro = [];
  const inject = { runPhase: modelo(registro), createPR: forgeFalso([]) };
  await ejecutarComando("plan", "2", org.config, { inject });

  const antes = JSON.stringify(loadRun("2", { home: org.home }));
  const cuantas = registro.length;
  const r = await ejecutarComando("run", "2", org.config, { inject, dryRun: true });

  assert.equal(r.dryRun, true);
  assert.equal(registro.length, cuantas, "invoco al modelo en un dry-run");
  assert.equal(JSON.stringify(loadRun("2", { home: org.home })), antes, "escribio estado en un dry-run");
  // El worktree del ITEM ya existe, y esta bien: lo creo el paso `plan`, porque
  // la especificacion que produce tiene que vivir donde vive el trabajo que
  // describe. Lo que un dry-run no puede crear es el worktree de una TAREA.
  const worktrees = join(org.home, "worktrees", "app");
  const deTareas = existsSync(worktrees)
    ? readdirSync(worktrees).filter((d) => /^2-T\d+$/.test(d))
    : [];
  assert.deepEqual(deTareas, [], "un dry-run creo el worktree de una tarea");
});
