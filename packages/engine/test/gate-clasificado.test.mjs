// El driver actuando distinto segun de QUIEN es el fallo del gate.
//
// Antes los tres casos eran uno solo: `bump`, devolver la salida al modelo, y
// repetir hasta agotar el presupuesto. Eso esta bien para un fallo de codigo y
// es puro gasto para los otros dos:
//
//   - ENTORNO: falta `pnpm`, no hay red. Tres invocaciones del modelo para
//     llegar al mismo lugar, y un diagnostico final que dice "el gate no paso"
//     cuando lo que pasa es que la maquina no puede correrlo.
//   - BASE: ya estaba roto. La tarea carga con un fallo ajeno, y si el modelo
//     "lo arregla", mete en su diff un cambio que no es suyo.

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
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-clase-"));
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

const modelo = (contador) => async (o) => {
  const t = o.task;
  if (contador) contador.fases.push(o.phase);
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

const rojo = (over = {}) => ({ ok: false, exitCode: 1, command: "x", durationMs: 1, output: "FAIL", timedOut: false, gaps: [], ...over });
const verde = () => ({ ok: true, exitCode: 0, command: "x", durationMs: 1, output: "", timedOut: false, gaps: [] });

const deps = (esc, over = {}) => ({
  config: { repos: { app: { gate: "true", fastGate: "true", baseBranch: "main", env: {}, gaps: [], remote: esc.remoto } } },
  home: esc.home,
  runPhase: modelo(over.contador),
  runSingleTest,
  runGate: () => verde(),
  createPR: async () => ({ url: "http://pr/1", alreadyExisted: false }),
  resolve: () => ({ repoPath: esc.repo, integrationPath: esc.integracion, itemBranch: "feature/1-h", baseBranch: "main" }),
  provider: null,
  maxParallelTasks: 4,
  ...over,
});

test("ENTORNO: bloquea en el PRIMER intento y no paga una sola invocacion de arreglo", async () => {
  const esc = escenario();
  const contador = { fases: [], gates: 0 };
  await runItem("1", deps(esc, {
    contador,
    runPhase: modelo(contador),
    runGate: () => { contador.gates++; return rojo({ exitCode: 127, output: "bash: pnpm: command not found" }); },
  }));

  const run = loadRun("1", { home: esc.home });
  const t = run.tasks[0];
  assert.equal(t.status, "blocked");
  assert.match(t.lastFailure, /entorno/i, `el diagnostico no dice que es del entorno: ${t.lastFailure}`);
  assert.match(t.lastFailure, /pnpm|command not found|PATH/i, "y tiene que traer la señal textual");

  // La afirmacion que importa: no se reintento nada.
  assert.equal(contador.fases.filter((f) => f === "GREEN").length, 1,
    "hubo mas de un GREEN: se pago al modelo para arreglar algo que el modelo no puede arreglar");
  assert.equal(contador.gates, 1, "se volvio a correr el gate con el entorno roto");
});

test("BASE: no se gasta el presupuesto de la tarea en un fallo que no es suyo", async () => {
  const esc = escenario();
  const contador = { fases: [], gates: 0 };
  await runItem("1", deps(esc, {
    contador,
    runPhase: modelo(contador),
    // Rojo en los dos lados: el de la tarea y el de la base.
    runGate: () => { contador.gates++; return rojo({ output: "FAIL test/viejo.test.ts" }); },
  }));

  const run = loadRun("1", { home: esc.home });
  const t = run.tasks[0];
  assert.equal(t.status, "blocked");
  assert.match(t.lastFailure, /base/i, `el diagnostico no dice que el fallo es de la base: ${t.lastFailure}`);
  assert.equal(t.attempts.gate, 0,
    "se consumio presupuesto de gate por un fallo que ya estaba antes de esta tarea");
  assert.equal(contador.fases.filter((f) => f === "GREEN").length, 1,
    "se le pidio al modelo que arregle la base: eso mete en el diff un cambio que no es de la tarea");
});

test("CODIGO: se comporta como siempre — se le devuelve el fallo al modelo y se reintenta", async () => {
  const esc = escenario();
  const contador = { fases: [], gates: 0 };
  let corridas = 0;
  await runItem("1", deps(esc, {
    contador,
    runPhase: modelo(contador),
    runGate: (repo, cwd) => {
      contador.gates++;
      // El worktree de integracion (la base) pasa; el de la tarea falla.
      if (cwd === esc.integracion) return verde();
      corridas++;
      return rojo({ output: "FAIL test/nuevo.test.ts\n  expected 100 to equal 90" });
    },
  }));

  const run = loadRun("1", { home: esc.home });
  const t = run.tasks[0];
  assert.equal(t.status, "blocked", "con el gate siempre rojo termina bloqueada, como antes");
  assert.ok(t.attempts.gate >= 1, "el presupuesto de gate SI se consume cuando el fallo es del codigo");
  assert.ok(contador.fases.filter((f) => f === "GREEN").length > 1,
    "no se reintento: un fallo de codigo es el unico caso donde reintentar sirve");
  assert.match(t.lastFailure, /expected 100 to equal 90/, "y la causa textual llega al diagnostico");
});

// ------------------------------------------- corte por no convergencia

test("el MISMO fallo dos veces corta antes de agotar el presupuesto", async () => {
  const esc = escenario();
  const contador = { fases: [], gates: 0 };
  await runItem("1", deps(esc, {
    contador,
    runPhase: modelo(contador),
    runGate: (repo, cwd) => {
      contador.gates++;
      if (cwd === esc.integracion) return verde(); // la base pasa: es fallo de codigo
      // Identico salvo la duracion, que es justo lo que la huella ignora.
      return rojo({ output: `FAIL test/x.test.ts (${100 + contador.gates} ms)\n  expected 100 to equal 90` });
    },
  }));

  const run = loadRun("1", { home: esc.home });
  const t = run.tasks[0];
  assert.equal(t.status, "blocked");
  assert.ok(t.attempts.gate < 3,
    `agoto el presupuesto (${t.attempts.gate}) en vez de cortar al ver el mismo fallo dos veces`);
  assert.match(t.lastFailure, /mismo fallo/i,
    `el diagnostico manda a mirar el presupuesto en vez del fallo: ${t.lastFailure}`);
  assert.match(t.lastFailure, /expected 100 to equal 90/, "y la causa textual sigue estando");
});

test("un fallo que CAMBIA no corta: eso es avance y se le deja el presupuesto", async () => {
  const esc = escenario();
  const contador = { fases: [], gates: 0 };
  await runItem("1", deps(esc, {
    contador,
    runPhase: modelo(contador),
    // El contador va SOLO sobre las corridas de la tarea: las de la base son
    // otra pregunta, y mezclarlas hacia que el fallo se estancara en "1 failed"
    // — que es no converger de verdad, asi que el motor tenia razon y el falso
    // estaba mal.
    runGate: (repo, cwd) => {
      contador.gates++;
      if (cwd === esc.integracion) return verde();
      contador.deLaTarea = (contador.deLaTarea || 0) + 1;
      // Cada vez falla un test menos: el caso que no se puede cortar.
      return rojo({ output: `Tests: ${10 - contador.deLaTarea} failed, ${contador.deLaTarea} passed` });
    },
  }));

  const run = loadRun("1", { home: esc.home });
  assert.equal(run.tasks[0].attempts.gate, 3, "corto un trabajo que estaba avanzando");
});
