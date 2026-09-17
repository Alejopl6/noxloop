import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRun, saveRun } from "../src/state.mjs";
import { drain } from "../src/merge-queue.mjs";

const git = (cwd, ...args) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const ITEM_BRANCH = "feature/1-historia";

/**
 * Un repositorio con la rama del item y DOS ramas de tarea que tocan la MISMA
 * linea del mismo archivo. Es el escenario que produjo el fallo medido.
 */
function escenario() {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-mq-"));
  const repo = join(raiz, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.test");
  git(repo, "config", "user.name", "T");
  writeFileSync(join(repo, "compartido.txt"), "base\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  git(repo, "branch", ITEM_BRANCH);

  const worktrees = {};
  for (const [tarea, contenido] of [["T1", "lo de T1\n"], ["T2", "lo de T2\n"]]) {
    const dest = join(raiz, `wt-${tarea}`);
    git(repo, "worktree", "add", "-q", "-b", `task/${tarea}`, dest, ITEM_BRANCH);
    writeFileSync(join(dest, "compartido.txt"), contenido);
    git(dest, "add", "-A");
    git(dest, "commit", "-q", "-m", `feat: ${tarea}`);
    worktrees[tarea] = dest;
  }

  const integracion = join(raiz, "wt-integracion");
  git(repo, "worktree", "add", "-q", integracion, ITEM_BRANCH);

  return { raiz, repo, worktrees, integracion };
}

function runCon(esc, home) {
  const run = createRun({
    item: { id: "1", title: "historia", level: "story", url: "u", provider: "fake" },
    repoScope: ["app"],
    tasks: ["T1", "T2"].map((id) => ({
      id, repo: "app", title: id, acceptance: "c",
      targetFiles: ["compartido.txt"], testFiles: ["t.test.mjs"],
      tier: "small", dependsOn: [], dependencyKind: "hard",
    })),
  }, { home });
  for (const t of run.tasks) {
    t.status = "queued";
    t.attempts.review = 1;
    t.worktree = esc.worktrees[t.id];
    t.branch = `task/${t.id}`;
  }
  run.item.branch = ITEM_BRANCH;
  // Se persiste: las transiciones leen el estado FRESCO del disco, que es lo
  // que evita que dos tareas en paralelo se pisen. Un estado que solo vive en
  // memoria no existe para ellas.
  saveRun(run, { home });
  return run;
}

const opcionesCon = (esc, home, over = {}) => ({
  home,
  config: { repos: { app: { gate: "true", fastGate: "true", env: {}, gaps: [] } } },
  resolve: () => ({ repoPath: esc.repo, integrationPath: esc.integracion, itemBranch: ITEM_BRANCH }),
  ...over,
});

test("la primera entra; la segunda se rechaza por conflicto y la rama base queda intacta", async () => {
  const esc = escenario();
  const home = mkdtempSync(join(tmpdir(), "noxloop-mqh-"));
  const run = runCon(esc, home);

  const r = await drain(run, opcionesCon(esc, home));

  assert.deepEqual(r.integrated, ["T1"]);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].task, "T2");
  // El motivo tiene que traer el texto del conflicto, no "fallo el rebase".
  assert.match(r.rejected[0].reason, /compartido\.txt/, `el motivo no nombra el archivo: ${r.rejected[0].reason}`);

  const t1 = run.tasks.find((t) => t.id === "T1");
  const t2 = run.tasks.find((t) => t.id === "T2");
  assert.equal(t1.status, "integrated");
  assert.ok(t1.integratedAt);
  assert.equal(t2.status, "green", "la rechazada vuelve al bucle, no se bloquea");
  assert.match(t2.lastFailure, /conflicto|conflict/i);

  // La rama del item tiene lo de T1 y NADA de T2: un rechazo no contamina.
  assert.equal(readFileSync(join(esc.integracion, "compartido.txt"), "utf8"), "lo de T1\n");
  assert.equal(git(esc.integracion, "rev-parse", "--abbrev-ref", "HEAD"), ITEM_BRANCH);
  assert.equal(git(esc.integracion, "status", "--porcelain"), "", "la integracion no queda a medias");
});

test("un rebase fallido no deja el worktree de la tarea en medio de un rebase", async () => {
  const esc = escenario();
  const home = mkdtempSync(join(tmpdir(), "noxloop-mqh-"));
  await drain(runCon(esc, home), opcionesCon(esc, home));
  // Sin el abort, el worktree queda en estado de rebase y la tarea no puede
  // volver a intentarlo: cada reintento fallaria antes de empezar.
  assert.equal(git(esc.worktrees.T2, "status", "--porcelain"), "");
  assert.equal(git(esc.worktrees.T2, "rev-parse", "--abbrev-ref", "HEAD"), "task/T2");
});

test("el gate corre DESPUES del rebase: mide el codigo en la base donde va a vivir", async () => {
  const esc = escenario();
  const home = mkdtempSync(join(tmpdir(), "noxloop-mqh-"));
  const run = runCon(esc, home);
  // T2 deja de conflictuar: toca otro archivo.
  writeFileSync(join(esc.worktrees.T2, "otro.txt"), "lo de T2\n");
  git(esc.worktrees.T2, "checkout", "-q", ITEM_BRANCH, "--", "compartido.txt");
  git(esc.worktrees.T2, "add", "-A");
  git(esc.worktrees.T2, "commit", "-q", "--amend", "-m", "feat: T2 sin conflicto");

  const vistos = [];
  const r = await drain(run, opcionesCon(esc, home, {
    runGate: (repo, cwd) => {
      vistos.push(readFileSync(join(cwd, "compartido.txt"), "utf8"));
      return { ok: true, exitCode: 0, command: "true", durationMs: 1, output: "", timedOut: false, gaps: [] };
    },
  }));

  assert.deepEqual(r.integrated, ["T1", "T2"]);
  // Cuando el gate de T2 corrio, el archivo ya tenia el cambio de T1: es la
  // prueba de que se rebaso primero. Un verde sobre la base vieja no dice nada
  // sobre la base en la que el codigo va a vivir.
  assert.deepEqual(vistos, ["lo de T1\n", "lo de T1\n"]);
});

test("si el gate falla despues del rebase, la tarea vuelve a green con la salida real", async () => {
  const esc = escenario();
  const home = mkdtempSync(join(tmpdir(), "noxloop-mqh-"));
  const run = runCon(esc, home);
  run.tasks = [run.tasks[0]];

  const r = await drain(run, opcionesCon(esc, home, {
    runGate: () => ({
      ok: false, exitCode: 1, command: "npm test", durationMs: 10,
      output: "FAIL src/x.test.mjs > el caso limite", timedOut: false, gaps: [],
    }),
  }));

  assert.deepEqual(r.integrated, []);
  assert.equal(run.tasks[0].status, "green");
  assert.match(run.tasks[0].lastFailure, /el caso limite/, "el motivo trae la salida textual del gate");
  assert.equal(readFileSync(join(esc.integracion, "compartido.txt"), "utf8"), "base\n", "nada entro");
});

test("la cola es serial y en orden topologico", async () => {
  const esc = escenario();
  const home = mkdtempSync(join(tmpdir(), "noxloop-mqh-"));
  const run = runCon(esc, home);
  run.tasks[1].dependsOn = ["T1"];
  writeFileSync(join(esc.worktrees.T2, "otro.txt"), "x\n");
  git(esc.worktrees.T2, "checkout", "-q", ITEM_BRANCH, "--", "compartido.txt");
  git(esc.worktrees.T2, "add", "-A");
  git(esc.worktrees.T2, "commit", "-q", "--amend", "-m", "feat: T2");

  const orden = [];
  const r = await drain(run, opcionesCon(esc, home, {
    runGate: (repo, cwd) => {
      orden.push(cwd.endsWith("T1") ? "T1" : "T2");
      return { ok: true, exitCode: 0, command: "true", durationMs: 1, output: "", timedOut: false, gaps: [] };
    },
  }));
  assert.deepEqual(orden, ["T1", "T2"]);
  assert.deepEqual(r.integrated, ["T1", "T2"]);
});

test("solo toca las que estan en queued", async () => {
  const esc = escenario();
  const home = mkdtempSync(join(tmpdir(), "noxloop-mqh-"));
  const run = runCon(esc, home);
  run.tasks[0].status = "green";
  run.tasks[1].status = "gated";
  const r = await drain(run, opcionesCon(esc, home));
  assert.deepEqual(r.integrated, []);
  assert.deepEqual(r.rejected, []);
  assert.equal(run.tasks[0].status, "green");
  assert.equal(run.tasks[1].status, "gated");
});
