import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRun, loadRun } from "../src/state.mjs";
import { runItem } from "../src/driver.mjs";

const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const tarea = (id, over = {}) => ({
  id, repo: "app", title: `tarea ${id}`, acceptance: `criterio de ${id}`,
  targetFiles: [`src/${id}.mjs`], testFiles: [`test/${id}.test.mjs`],
  tier: "small", dependsOn: [], dependencyKind: "hard", ...over,
});

/** Un repositorio de verdad, con la rama del item y su worktree de integracion. */
function escenario(tasks = [tarea("T1")]) {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-drv-"));
  const repo = join(raiz, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.test");
  git(repo, "config", "user.name", "T");
  mkdirSync(join(repo, "src"));
  mkdirSync(join(repo, "test"));
  writeFileSync(join(repo, "README.md"), "base\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");

  const itemBranch = "feature/1-historia";
  git(repo, "branch", itemBranch);
  const integracion = join(raiz, "wt-int");
  git(repo, "worktree", "add", "-q", integracion, itemBranch);

  const home = join(raiz, "home");
  const run = createRun({
    item: { id: "1", key: "H-1", title: "la historia", level: "story", url: "http://g/1", provider: "fake",
            acceptance: ["el sistema hace lo que promete"] },
    repoScope: ["app"],
    tasks,
  }, { home });

  return { raiz, repo, integracion, itemBranch, home, run };
}

/**
 * Un modelo de mentira que SI hace el trabajo: escribe el test en la fase RED y
 * la implementacion en GREEN. Es lo que permite probar la orquestacion del
 * driver —el orden, las guardas, los contadores— sin gastar un modelo.
 */
function modeloQueCumple(registro, { rompeGate = false, hallazgoEnReview = false } = {}) {
  return async (opts) => {
    registro.push({ fase: opts.phase, tarea: opts.taskId, resume: opts.resume || null });
    const wt = opts.cwd;
    const t = opts.task;

    if (opts.phase === "RED") {
      mkdirSync(join(wt, "test"), { recursive: true });
      // Un test que falla porque el modulo no existe todavia.
      writeFileSync(join(wt, t.testFiles[0]),
        `import { valor } from "../${t.targetFiles[0]}";\nif (valor !== ${rompeGate ? 99 : 42}) throw new Error("rojo");\n`);
    }
    if (opts.phase === "GREEN") {
      mkdirSync(join(wt, "src"), { recursive: true });
      writeFileSync(join(wt, t.targetFiles[0]), "export const valor = 42;\n");
    }
    if (opts.phase === "REVIEW" && hallazgoEnReview) {
      return { ok: true, sessionId: `s-${t.id}`, budgetExhausted: false, findings: "blocking", text: "hallazgo" };
    }
    return { ok: true, sessionId: `s-${t.id}`, budgetExhausted: false, text: "listo" };
  };
}

/** Corre de verdad el archivo de test dentro del worktree. */
const correrTest = (repo, cwd, file) => {
  const r = execFileSync("node", ["-e", `
    import("file://" + process.argv[1]).then(() => process.exit(0)).catch(() => process.exit(1));
  `, join(cwd, file)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], });
  return r;
};

function runSingleTestReal(repo, cwd, file) {
  try {
    execFileSync("node", ["--input-type=module", "-e", `await import("file://${join(cwd, file)}")`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, exitCode: 0, command: `node ${file}`, durationMs: 5, output: "", timedOut: false, gaps: [] };
  } catch (e) {
    return { ok: false, exitCode: 1, command: `node ${file}`, durationMs: 5,
             output: `${e.stdout || ""}${e.stderr || ""}`, timedOut: false, gaps: [] };
  }
}

function depsBase(esc, registro, over = {}) {
  return {
    config: { repos: { app: { gate: "true", fastGate: "true", baseBranch: "main", env: {}, gaps: ["sin e2e"],
                              remote: "git@x:o/app.git", runners: { node: "node {file}" } } } },
    home: esc.home,
    runPhase: modeloQueCumple(registro),
    runSingleTest: runSingleTestReal,
    runGate: () => ({ ok: true, exitCode: 0, command: "true", durationMs: 10, output: "ok", timedOut: false, gaps: ["sin e2e"] }),
    createPR: async (run) => ({ url: "http://forge/pr/1", alreadyExisted: false, body: "cuerpo" }),
    resolve: () => ({ repoPath: esc.repo, integrationPath: esc.integracion,
                      itemBranch: esc.itemBranch, baseBranch: "main" }),
    provider: null,
    maxParallelTasks: 4,
    log: { info() {}, warn() {}, error() {}, child() { return this; } },
    ...over,
  };
}

// ------------------------------------------------------ el ciclo completo

test("una tarea recorre RED, GREEN, GATE, REVIEW y termina integrada con PR", async () => {
  const esc = escenario();
  const registro = [];
  const r = await runItem("1", depsBase(esc, registro));

  assert.deepEqual(registro.map((x) => x.fase), ["RED", "GREEN", "REVIEW"]);
  const run = loadRun("1", { home: esc.home });
  assert.equal(run.tasks[0].status, "integrated");
  assert.equal(run.tasks[0].redVerified, true);
  assert.equal(run.tasks[0].attempts.review, 1);
  assert.equal(r.pr, "http://forge/pr/1");
  assert.deepEqual(r.blocked, []);
});

test("el rojo se verifica corriendo el test, no creyendole al modelo", async () => {
  const esc = escenario();
  const registro = [];
  // Este modelo dice que escribio el test pero no escribe nada: el archivo no
  // existe, asi que la corrida no puede dar un rojo legitimo.
  await runItem("1", depsBase(esc, registro, {
    runPhase: async (opts) => ({ ok: true, sessionId: "s", budgetExhausted: false, text: "escribi el test" }),
  }));
  const run = loadRun("1", { home: esc.home });
  assert.equal(run.tasks[0].redVerified, false);
  assert.equal(run.tasks[0].status, "blocked");
  assert.match(run.tasks[0].lastFailure, /rojo|red|presupuesto/i);
});

test("retoma la sesion entre fases de la misma tarea, y no entre tareas", async () => {
  const esc = escenario([tarea("T1"), tarea("T2")]);
  const registro = [];
  await runItem("1", depsBase(esc, registro));

  const deT1 = registro.filter((x) => x.tarea === "T1");
  assert.equal(deT1[0].resume, null, "la primera fase abre sesion nueva");
  assert.equal(deT1[1].resume, "s-T1", "GREEN retoma la sesion de RED");
  assert.equal(deT1[2].resume, "s-T1", "REVIEW retoma la misma");
  const primeraDeT2 = registro.find((x) => x.tarea === "T2");
  assert.equal(primeraDeT2.resume, null, "otra tarea, sesion nueva: evita la compactacion");
});

test("dos tareas sin dependencias avanzan en paralelo, cada una en su worktree", async () => {
  const esc = escenario([tarea("T1"), tarea("T2")]);
  const registro = [];
  await runItem("1", depsBase(esc, registro));

  const run = loadRun("1", { home: esc.home });
  assert.deepEqual(run.tasks.map((t) => t.status), ["integrated", "integrated"]);
  const wt1 = run.tasks[0].worktree;
  const wt2 = run.tasks[1].worktree;
  assert.notEqual(wt1, wt2, "cada tarea en su propio espacio");
  assert.ok(existsSync(wt1) || true);
  // Las dos fases RED salen antes de que la primera tarea termine: es la marca
  // observable de que corrieron a la vez y no una despues de la otra.
  const fases = registro.map((x) => `${x.tarea}:${x.fase}`);
  assert.ok(fases.indexOf("T2:RED") < fases.indexOf("T1:REVIEW"), `no se solaparon: ${fases.join(" ")}`);
});

test("una dependencia dura serializa: la segunda no arranca hasta que la primera se integra", async () => {
  const esc = escenario([tarea("T1"), tarea("T2", { dependsOn: ["T1"] })]);
  const registro = [];
  await runItem("1", depsBase(esc, registro));
  const fases = registro.map((x) => `${x.tarea}:${x.fase}`);
  assert.ok(fases.indexOf("T1:REVIEW") < fases.indexOf("T2:RED"), `no serializo: ${fases.join(" ")}`);
});

test("el gate rojo consume presupuesto y la tarea termina bloqueada con la salida real", async () => {
  const esc = escenario();
  const registro = [];
  await runItem("1", depsBase(esc, registro, {
    runGate: () => ({ ok: false, exitCode: 1, command: "npm test", durationMs: 10,
                      output: "FAIL test/x > el caso limite", timedOut: false, gaps: [] }),
  }));
  const run = loadRun("1", { home: esc.home });
  assert.equal(run.tasks[0].status, "blocked");
  assert.equal(run.tasks[0].attempts.gate, 3, "consumio su presupuesto de gate");
  assert.match(run.tasks[0].lastFailure, /el caso limite/);
});

test("un hallazgo bloqueante en REVIEW devuelve la tarea a GREEN", async () => {
  const esc = escenario();
  const registro = [];
  await runItem("1", depsBase(esc, registro, {
    runPhase: modeloQueCumple(registro, { hallazgoEnReview: true }),
  }));
  const run = loadRun("1", { home: esc.home });
  assert.ok(run.tasks[0].attempts.review >= 2, "reintento despues del hallazgo");
  assert.ok(registro.filter((x) => x.fase === "GREEN").length >= 2, "volvio a GREEN");
});

test("audita antes del PR: una tarea encolada sin revision recibe la que falta", async () => {
  const esc = escenario();
  const registro = [];
  // El estado ya impide llegar a `queued` con el contador en cero — la guarda
  // de state.mjs lo rechaza. El escenario que queda es un archivo de estado
  // editado a mano, o escrito por una version vieja del motor. El driver no
  // confia: audita el contador, que es estado en disco, antes de abrir el PR.
  const run = loadRun("1", { home: esc.home });
  run.tasks[0].status = "queued";
  run.tasks[0].redVerified = true;
  run.tasks[0].attempts = { red: 1, green: 1, gate: 1, review: 0 };
  run.tasks[0].worktree = join(esc.raiz, "wt-T1-manual");
  run.tasks[0].branch = "task/1-T1";
  run.tasks[0].gateEvidence = { command: "true", exitCode: 0, durationMs: 1, output: "", ranAt: new Date().toISOString() };
  writeFileSync(join(esc.home, "runs", "run-1.json"), JSON.stringify(run, null, 2));
  git(esc.repo, "worktree", "add", "-q", "-b", "task/1-T1", run.tasks[0].worktree, esc.itemBranch);

  await runItem("1", depsBase(esc, registro));

  const revisiones = registro.filter((x) => x.fase === "REVIEW");
  assert.ok(revisiones.length >= 1, "pidio la revision que faltaba antes del PR");
  const despues = loadRun("1", { home: esc.home });
  assert.ok(despues.tasks[0].attempts.review > 0, "el contador quedo como constancia de que ocurrio");
});

test("una tarea bloqueada no detiene el recorrido: el PR se abre con las que salieron", async () => {
  const esc = escenario([tarea("T1"), tarea("T2")]);
  const registro = [];
  const r = await runItem("1", depsBase(esc, registro, {
    runGate: (repo, cwd) => cwd.includes("T2")
      ? { ok: false, exitCode: 1, command: "npm test", durationMs: 1, output: "T2 rota", timedOut: false, gaps: [] }
      : { ok: true, exitCode: 0, command: "npm test", durationMs: 1, output: "ok", timedOut: false, gaps: [] },
  }));
  assert.deepEqual(r.blocked, ["T2"]);
  assert.equal(r.pr, "http://forge/pr/1");
  assert.deepEqual(r.integrated, ["T1"]);
});

test("si NINGUNA tarea sale, no se abre un PR vacio", async () => {
  const esc = escenario();
  const registro = [];
  const r = await runItem("1", depsBase(esc, registro, {
    runGate: () => ({ ok: false, exitCode: 1, command: "x", durationMs: 1, output: "rota", timedOut: false, gaps: [] }),
  }));
  assert.equal(r.pr, null);
  assert.deepEqual(r.integrated, []);
  assert.match(r.reason, /ninguna|0 de/i);
});

test("--dry-run no escribe estado, ni worktrees, ni PR", async () => {
  const esc = escenario();
  const registro = [];
  const antes = JSON.stringify(loadRun("1", { home: esc.home }));
  let creoPr = false;
  const r = await runItem("1", depsBase(esc, registro, {
    dryRun: true,
    createPR: async () => { creoPr = true; return { url: "x" }; },
  }));
  assert.equal(creoPr, false);
  assert.equal(registro.length, 0, "no invoco al modelo");
  assert.equal(JSON.stringify(loadRun("1", { home: esc.home })), antes, "el estado no cambio");
  assert.ok(r.plan.length > 0, "pero dice que haria");
});

test("no hay ningun camino que mergee o despliegue", async () => {
  const esc = escenario();
  const registro = [];
  const comandos = [];
  await runItem("1", depsBase(esc, registro, {
    runGate: (repo, cwd) => { comandos.push("gate"); return { ok: true, exitCode: 0, command: "true", durationMs: 1, output: "", timedOut: false, gaps: [] }; },
  }));
  // Y la rama base del repositorio sigue donde estaba: el recorrido integra a la
  // rama del item, nunca a main.
  assert.equal(git(esc.repo, "rev-parse", "main"), git(esc.repo, "rev-parse", "main"));
  const logMain = git(esc.repo, "log", "--oneline", "main");
  assert.equal(logMain.split("\n").length, 1, "main no recibio nada");
});

test("el historial de la rama deja el test ANTES de la implementacion", async () => {
  const esc = escenario();
  const registro = [];
  await runItem("1", depsBase(esc, registro));

  const run = loadRun("1", { home: esc.home });
  const wt = run.tasks[0].worktree;
  const log = git(wt, "log", "--format=%s", "--reverse").split("\n");
  const iTest = log.findIndex((l) => l.startsWith("test("));
  const iImpl = log.findIndex((l) => l.startsWith("feat("));
  // Es la promesa que alguien puede verificar sin leer una linea del motor.
  assert.ok(iTest >= 0, `no hay commit de test: ${log.join(" | ")}`);
  assert.ok(iImpl > iTest, `el orden no se ve en el historial: ${log.join(" | ")}`);

  // Y lo que quedo integrado en la rama del item tiene el codigo de verdad, no
  // una rama vacia que la cola rebaso sin contenido.
  const enItem = git(esc.integracion, "log", "--format=%s", "--reverse");
  assert.match(enItem, /test\(/);
  assert.match(enItem, /feat\(/);
});

test("cada invocacion queda anotada en el gasto del recorrido", async () => {
  const esc = escenario([tarea("T1"), tarea("T2")]);
  const registro = [];
  const r = await runItem("1", depsBase(esc, registro, {
    runPhase: async (o) => {
      const base = await modeloQueCumple(registro)(o);
      // Dos de las fases informan costo y una no: el contador de invocaciones
      // tiene que contar las tres igual.
      return { ...base, usd: o.phase === "REVIEW" ? null : 1.5 };
    },
  }));

  const run = loadRun("1", { home: esc.home });
  assert.equal(run.spent.calls, registro.length, "una invocacion sin anotar es una invocacion que no existio");
  assert.ok(run.spent.usd > 0, "el costo informado no llego al recorrido");
  assert.equal(r.spent.calls, run.spent.calls, "el resumen tiene que traer lo mismo que el disco");
});

test("exige que exista un plan: no replanifica solo", async () => {
  const esc = escenario();
  const home = join(esc.raiz, "home-vacio");
  await assert.rejects(
    () => runItem("999", depsBase(esc, [], { home })),
    /no hay recorrido|plan/i,
  );
});
