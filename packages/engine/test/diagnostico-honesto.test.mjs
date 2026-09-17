// Los dos fallos que la revision en frio encontro leyendo el codigo contra la
// documentacion, y que violan el principio del diagnostico honesto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRun, loadRun } from "../src/state.mjs";
import { runItem } from "../src/driver.mjs";

const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const tarea = (id) => ({
  id, repo: "app", title: `t ${id}`, acceptance: "c",
  targetFiles: [`src/${id}.mjs`], testFiles: [`test/${id}.test.mjs`],
  tier: "small", dependsOn: [], dependencyKind: "hard",
});

function escenario() {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-diag-"));
  const remoto = join(raiz, "origin.git");
  mkdirSync(remoto);
  git(remoto, "init", "-q", "--bare", "-b", "main");
  const repo = join(raiz, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.test");
  git(repo, "config", "user.name", "T");
  git(repo, "remote", "add", "origin", remoto);
  mkdirSync(join(repo, "src")); mkdirSync(join(repo, "test"));
  writeFileSync(join(repo, "README.md"), "x\n");
  git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", "base");
  git(repo, "push", "-q", "origin", "main");
  git(repo, "branch", "feature/1-h");
  const integracion = join(raiz, "wt-int");
  git(repo, "worktree", "add", "-q", integracion, "feature/1-h");
  const home = join(raiz, "home");
  createRun({
    item: { id: "1", title: "h", level: "story", url: "u", provider: "fake", acceptance: ["x"] },
    repoScope: ["app"], tasks: [tarea("T1")],
  }, { home });
  return { raiz, repo, remoto, integracion, home };
}

const modelo = () => async (o) => {
  const t = o.task;
  if (o.phase === "RED") {
    mkdirSync(join(o.cwd, "test"), { recursive: true });
    writeFileSync(join(o.cwd, t.testFiles[0]), `import { v } from "../${t.targetFiles[0]}";\nif (v!==1) throw new Error("rojo");\n`);
  }
  if (o.phase === "GREEN") {
    mkdirSync(join(o.cwd, "src"), { recursive: true });
    writeFileSync(join(o.cwd, t.targetFiles[0]), "export const v = 1;\n");
  }
  return { ok: true, sessionId: "s", budgetExhausted: false, usd: 0.1, text: "ok" };
};

const runSingleTest = (repo, cwd, file) => {
  try {
    execFileSync("node", ["--input-type=module", "-e", `await import("file://${join(cwd, file)}")`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, exitCode: 0, command: "node", durationMs: 1, output: "", timedOut: false, gaps: [] };
  } catch (e) {
    return { ok: false, exitCode: 1, command: "node", durationMs: 1, output: `${e.stderr || ""}`, timedOut: false, gaps: [] };
  }
};

const deps = (esc, over = {}) => ({
  config: { repos: { app: { gate: "true", fastGate: "true", baseBranch: "main", env: {}, gaps: [], remote: esc.remoto } } },
  home: esc.home,
  runPhase: modelo(),
  runSingleTest,
  runGate: () => ({ ok: true, exitCode: 0, command: "true", durationMs: 1, output: "", timedOut: false, gaps: [] }),
  createPR: async () => ({ url: "http://pr/1", alreadyExisted: false }),
  resolve: () => ({ repoPath: esc.repo, integrationPath: esc.integracion, itemBranch: "feature/1-h", baseBranch: "main" }),
  provider: null,
  maxParallelTasks: 4,
  ...over,
});

test("cuando el PR no se puede abrir, la causa REAL llega al reporte", async () => {
  // EL FALLO: `createPR` devuelve {url: null, error: <stderr del forge>} y el
  // driver retornaba `pr: null` sin `reason` ni `error`. El usuario leia
  // "sin PR: no se llego a abrir" y la causa —que el forge dijo algo concreto,
  // como que la rama no esta empujada o que no hay permisos— se tiraba. Es el
  // mismo fallo que el proyecto prohibe en las tareas: nunca resumir un error a
  // "falla el build".
  const esc = escenario();
  const r = await runItem("1", deps(esc, {
    createPR: async () => ({
      url: null, alreadyExisted: false,
      error: "gh: pull request create failed: No commits between main and feature/1-h",
    }),
  }));

  assert.equal(r.pr, null);
  assert.ok(r.reason, "el resumen tiene que traer una causa");
  assert.match(r.reason, /No commits between main/, `la causa real se perdio: ${r.reason}`);
  // Y el trabajo NO se pierde: las tareas siguen integradas en la rama.
  assert.deepEqual(r.integrated, ["T1"]);
});

test("un PR que si se abre no inventa una causa", async () => {
  const esc = escenario();
  const r = await runItem("1", deps(esc));
  assert.equal(r.pr, "http://pr/1");
  assert.ok(!r.reason, `invento una causa: ${r.reason}`);
});

test("la rama del item se pone al dia con su base antes de empezar", async () => {
  // EL FALLO: `syncItemBranch` existia en merge-queue.mjs y solo la importaba
  // el recorrido de un hito. Un `noxloop run <historia>` nunca ponia la rama al
  // dia, asi que con el worktree del item creado en un recorrido anterior, las
  // tareas rebasaban contra una base vieja y el conflicto aparecia al integrar
  // en vez de al empezar — que es justo lo que la cola existe para evitar.
  const esc = escenario();

  // Alguien avanza `main` despues de que la rama del item nacio.
  writeFileSync(join(esc.repo, "nuevo-en-main.txt"), "avanzo\n");
  git(esc.repo, "add", "-A");
  git(esc.repo, "commit", "-q", "-m", "chore: main avanzo");
  git(esc.repo, "push", "-q", "origin", "main");

  const antes = git(esc.integracion, "rev-parse", "HEAD");
  await runItem("1", deps(esc));
  const despues = git(esc.integracion, "log", "--format=%s", "HEAD");

  assert.notEqual(git(esc.integracion, "rev-parse", "HEAD"), antes, "la rama del item no se movio");
  assert.match(despues, /main avanzo/, "la rama del item no recibio lo que ya estaba en su base");
});
