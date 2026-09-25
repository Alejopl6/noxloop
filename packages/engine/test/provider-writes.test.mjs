import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRun, loadRun } from "../src/state.mjs";
import { runItem } from "../src/driver.mjs";

const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function escenario() {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-pw-"));
  const repo = join(raiz, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.test");
  git(repo, "config", "user.name", "T");
  mkdirSync(join(repo, "src")); mkdirSync(join(repo, "test"));
  writeFileSync(join(repo, "README.md"), "x\n");
  git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", "base");
  git(repo, "branch", "feature/1-h");
  const integracion = join(raiz, "wt-int");
  git(repo, "worktree", "add", "-q", integracion, "feature/1-h");
  const home = join(raiz, "home");
  createRun({
    item: { id: "1", title: "h", level: "story", url: "u", provider: "fake", acceptance: ["x"] },
    repoScope: ["app"],
    tasks: [{
      id: "T1", repo: "app", title: "T1", acceptance: "c",
      targetFiles: ["src/t1.mjs"], testFiles: ["test/t1.test.mjs"], tier: "small",
      dependsOn: [], dependencyKind: "hard",
    }],
  }, { home });
  return { raiz, repo, integracion, home };
}

/** Un gestor que registra cada escritura, para poder contarlas. */
function gestorQueCuenta(over = {}) {
  const escrituras = { estados: [], comentarios: [], enlaces: [] };
  const caps = {
    children: true, dependencies: false, createChild: false, setState: true,
    comment: true, linkUrl: true, labels: false, searchAssigned: false,
    searchMentioned: false, boardFields: false, ...over,
  };
  return {
    escrituras,
    mod: {
      meta: { name: "contador" },
      capabilities: () => caps,
      getItem: async () => ({ id: "1", title: "h", level: "story", url: "u", acceptance: ["x"] }),
      setState: async (id, estado) => {
        escrituras.estados.push(estado);
        // Un gestor sin ese estado devuelve `written: null`: el motor no puede
        // marcar como escrito algo que el gestor no tiene.
        return { written: caps[`estado_${estado}`] === false ? null : estado };
      },
      comment: async (id, texto) => { escrituras.comentarios.push(texto); return { id: "c" }; },
      linkUrl: async (id, url) => { escrituras.enlaces.push(url); return { ok: true }; },
    },
  };
}

function deps(esc, gestor, over = {}) {
  return {
    config: { repos: { app: { gate: "true", fastGate: "true", baseBranch: "main", env: {}, gaps: [], remote: "g" } } },
    home: esc.home,
    provider: gestor.mod,
    providerCtx: {},
    runPhase: async (o) => {
      const t = o.task;
      if (o.phase === "RED") {
        mkdirSync(join(o.cwd, "test"), { recursive: true });
        writeFileSync(join(o.cwd, t.testFiles[0]), `import { v } from "../${t.targetFiles[0]}";\nif (v!==1) throw new Error("rojo");\n`);
      }
      if (o.phase === "GREEN") {
        mkdirSync(join(o.cwd, "src"), { recursive: true });
        writeFileSync(join(o.cwd, t.targetFiles[0]), "export const v = 1;\n");
      }
      return { ok: true, sessionId: "s", budgetExhausted: false, text: "ok" };
    },
    runSingleTest: (repo, cwd, file) => {
      try {
        execFileSync("node", ["--input-type=module", "-e", `await import("file://${join(cwd, file)}")`],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        return { ok: true, exitCode: 0, command: "node", durationMs: 1, output: "", timedOut: false, gaps: [] };
      } catch (e) {
        return { ok: false, exitCode: 1, command: "node", durationMs: 1, output: `${e.stderr || ""}`, timedOut: false, gaps: [] };
      }
    },
    runGate: () => ({ ok: true, exitCode: 0, command: "true", durationMs: 1, output: "", timedOut: false, gaps: [] }),
    createPR: async () => ({ url: "http://forge/pr/7", alreadyExisted: false }),
    resolve: () => ({ repoPath: esc.repo, integrationPath: esc.integracion, itemBranch: "feature/1-h", baseBranch: "main" }),
    maxParallelTasks: 4,
    ...over,
  };
}

test("mueve el ticket a en-curso una sola vez, aunque se relance", async () => {
  const esc = escenario();
  const g = gestorQueCuenta();
  await runItem("1", deps(esc, g));
  const primera = [...g.escrituras.estados];
  assert.ok(primera.includes("in_progress"));

  // Relanzar: el recorrido ya esta terminado, y el estado NO se vuelve a
  // escribir. `providerStateWritten` es lo que lo vuelve idempotente.
  await runItem("1", deps(esc, g));
  const repetidos = g.escrituras.estados.filter((e) => e === "in_progress").length;
  assert.equal(repetidos, 1, `escribio in_progress ${repetidos} veces`);
});

test("no escribe un estado que el gestor no tiene, y no lo marca como escrito", async () => {
  const esc = escenario();
  const g = gestorQueCuenta({ estado_in_review: false });
  await runItem("1", deps(esc, g));
  const run = loadRun("1", { home: esc.home });
  // Se intento, el gestor dijo que no lo tiene, y el motor NO lo anota como
  // escrito: si lo anotara, un relanzamiento nunca reintentaria.
  assert.ok(g.escrituras.estados.includes("in_review"));
  assert.notEqual(run.item.providerStateWritten, "in_review");
});

test("el PR se enlaza nativo cuando el gestor puede, y como comentario cuando no", async () => {
  const conEnlace = escenario();
  const g1 = gestorQueCuenta();
  await runItem("1", deps(conEnlace, g1));
  assert.deepEqual(g1.escrituras.enlaces, ["http://forge/pr/7"]);
  // Spec 005, FR-003: ademas del adjunto, UN comentario de cierre con el
  // enlace. El adjunto dice «hay un PR»; el comentario es lo que se lee en la
  // conversacion del ticket y le llega por notificacion a quien lo sigue.
  assert.equal(g1.escrituras.comentarios.length, 1, "con linkUrl igual queda el comentario de cierre");
  assert.match(g1.escrituras.comentarios[0], /http:\/\/forge\/pr\/7/);

  const sinEnlace = escenario();
  const g2 = gestorQueCuenta({ linkUrl: false });
  await runItem("1", deps(sinEnlace, g2));
  // Degradacion declarada: sin `linkUrl`, el PR va como comentario. No se pierde.
  assert.deepEqual(g2.escrituras.enlaces, []);
  assert.equal(g2.escrituras.comentarios.length, 1);
  assert.match(g2.escrituras.comentarios[0], /http:\/\/forge\/pr\/7/);
});

test("un gestor que lanza al escribir no tumba el recorrido", async () => {
  const esc = escenario();
  const g = gestorQueCuenta();
  g.mod.comment = async () => { throw new Error("429 rate limited"); };
  g.mod.linkUrl = async () => { throw new Error("500 del gestor"); };
  const r = await runItem("1", deps(esc, g));
  // El trabajo ya esta hecho y el PR abierto: perderlo porque el tablero no
  // contesta seria tirar el recorrido por la parte menos importante.
  assert.equal(r.pr, "http://forge/pr/7");
  assert.deepEqual(r.integrated, ["T1"]);
});

test("nunca escribe `done`: cerrar el ticket diria que esta integrado", async () => {
  const esc = escenario();
  const g = gestorQueCuenta();
  await runItem("1", deps(esc, g));
  assert.ok(!g.escrituras.estados.includes("done"), `escribio: ${g.escrituras.estados.join(", ")}`);
});

test("sin capacidad de escribir estado, el recorrido igual llega al PR", async () => {
  const esc = escenario();
  const g = gestorQueCuenta({ setState: false, comment: false, linkUrl: false });
  const r = await runItem("1", deps(esc, g));
  assert.equal(r.pr, "http://forge/pr/7");
  assert.deepEqual(g.escrituras.estados, []);
});

// ---------------------------------------------------- spec 005, FR-003

test("FR-003: al abrir el PR, el estado pasa a in_review y queda UN comentario de cierre con el enlace y lo integrado", async () => {
  const esc = escenario();
  const g = gestorQueCuenta();
  const r = await runItem("1", deps(esc, g));
  assert.equal(r.pr, "http://forge/pr/7");
  assert.ok(g.escrituras.estados.includes("in_review"), `estados escritos: ${g.escrituras.estados.join(", ")}`);
  assert.equal(g.escrituras.comentarios.length, 1);
  const cierre = g.escrituras.comentarios[0];
  assert.match(cierre, /http:\/\/forge\/pr\/7/, "el comentario de cierre lleva el enlace al PR");
  assert.match(cierre, /T1/, "y dice que tareas quedaron integradas");
  assert.equal(loadRun("1", { home: esc.home }).item.providerStateWritten, "in_review");
});

test("FR-003: un relanzamiento que encuentra el PR ya abierto no repite el comentario de cierre", async () => {
  const esc = escenario();
  const g = gestorQueCuenta();
  await runItem("1", deps(esc, g));
  await runItem("1", deps(esc, g, { createPR: async () => ({ url: "http://forge/pr/7", alreadyExisted: true }) }));
  assert.equal(g.escrituras.comentarios.length, 1, `comento ${g.escrituras.comentarios.length} veces el mismo PR`);
});

test("FR-003: sin `comment`, el cierre se degrada al adjunto y al estado, sin tumbar nada", async () => {
  const esc = escenario();
  const g = gestorQueCuenta({ comment: false });
  const r = await runItem("1", deps(esc, g));
  assert.equal(r.pr, "http://forge/pr/7");
  assert.deepEqual(g.escrituras.enlaces, ["http://forge/pr/7"]);
  assert.deepEqual(g.escrituras.comentarios, [], "comment en false: el motor no lo llama");
  assert.ok(g.escrituras.estados.includes("in_review"));
});
