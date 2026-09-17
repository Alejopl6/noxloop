import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRun, setActiveTask, clearActiveTask, activeTaskFull, listActiveTasks } from "../src/state.mjs";
import { decide as tddOrder } from "../src/hooks/tdd-order-guard.mjs";
import { decide as scope } from "../src/hooks/task-scope-guard.mjs";

const home = () => mkdtempSync(join(tmpdir(), "noxloop-active-"));

const tarea = (id, over = {}) => ({
  id, repo: "app", title: id, acceptance: "c",
  targetFiles: [`src/${id.toLowerCase()}.mjs`], testFiles: [`test/${id.toLowerCase()}.test.mjs`],
  tier: "small", dependsOn: [], dependencyKind: "hard", ...over,
});

function dosTareasEnParalelo(h) {
  const run = createRun({
    item: { id: "9", title: "h", level: "story", url: "u", provider: "fake" },
    repoScope: ["app"],
    tasks: [tarea("T1"), tarea("T2")],
  }, { home: h });
  setActiveTask("9", "T1", { home: h, worktree: "/wt/T1" });
  setActiveTask("9", "T2", { home: h, worktree: "/wt/T2" });
  return run;
}

test("dos tareas pueden estar activas a la vez, cada una con su worktree", () => {
  const h = home();
  dosTareasEnParalelo(h);
  const activas = listActiveTasks({ home: h });
  assert.equal(activas.length, 2);
  assert.deepEqual(activas.map((a) => a.taskId).sort(), ["T1", "T2"]);
});

test("se resuelve por el worktree del que viene la operacion", () => {
  const h = home();
  dosTareasEnParalelo(h);
  assert.equal(activeTaskFull({ home: h, cwd: "/wt/T1" }).task.id, "T1");
  assert.equal(activeTaskFull({ home: h, cwd: "/wt/T2" }).task.id, "T2");
  // Tambien por la ruta del archivo que se va a escribir.
  assert.equal(activeTaskFull({ home: h, filePath: "/wt/T2/src/t2.mjs" }).task.id, "T2");
});

test("con varias activas y sin pista de cual es, NO adivina", () => {
  const h = home();
  dosTareasEnParalelo(h);
  // Adivinar aca haria que el guardian de alcance de una tarea bloquee los
  // archivos de la otra. Ante la duda, permitir.
  assert.equal(activeTaskFull({ home: h, cwd: "/otro/lado" }), null);
  assert.equal(activeTaskFull({ home: h }), null);
});

test("con UNA sola activa, se usa sin necesitar la pista", () => {
  const h = home();
  const run = createRun({
    item: { id: "8", title: "h", level: "story", url: "u", provider: "fake" },
    repoScope: ["app"], tasks: [tarea("T1")],
  }, { home: h });
  setActiveTask("8", "T1", { home: h, worktree: "/wt/solo" });
  // Sin ninguna pista se usa: negarse dejaria la guarda sin aplicar cuando el
  // evento del hook no trae cwd ni ruta.
  assert.equal(activeTaskFull({ home: h }).task.id, "T1");
  // Pero con una pista que cae FUERA de su worktree, no. Esa operacion viene de
  // otro lado —probablemente la sesion de una persona— y resolverla contra esta
  // tarea haria que su guardian de alcance policie archivos ajenos.
  assert.equal(activeTaskFull({ home: h, cwd: "/cualquiera" }), null);
  // Un puntero de recorrido serial (sin worktree) si vale para toda la sesion.
  setActiveTask("8", "T1", { home: h });
  clearActiveTask({ home: h, worktree: "/wt/solo" });
  assert.equal(activeTaskFull({ home: h, cwd: "/cualquiera" }).task.id, "T1");
});

test("el worktree mas especifico gana sobre uno que es prefijo del otro", () => {
  const h = home();
  createRun({
    item: { id: "7", title: "h", level: "story", url: "u", provider: "fake" },
    repoScope: ["app"], tasks: [tarea("T1"), tarea("T2")],
  }, { home: h });
  setActiveTask("7", "T1", { home: h, worktree: "/wt" });
  setActiveTask("7", "T2", { home: h, worktree: "/wt/anidado" });
  assert.equal(activeTaskFull({ home: h, cwd: "/wt/anidado/src" }).task.id, "T2");
  assert.equal(activeTaskFull({ home: h, cwd: "/wt/otro" }).task.id, "T1");
});

test("limpiar una no afecta a la otra", () => {
  const h = home();
  dosTareasEnParalelo(h);
  clearActiveTask({ home: h, worktree: "/wt/T1" });
  assert.equal(listActiveTasks({ home: h }).length, 1);
  assert.equal(activeTaskFull({ home: h, cwd: "/wt/T2" }).task.id, "T2");
  assert.equal(activeTaskFull({ home: h, cwd: "/wt/T1" }), null);
});

test("sigue funcionando el puntero sin worktree, para un recorrido serial", () => {
  const h = home();
  createRun({
    item: { id: "6", title: "h", level: "story", url: "u", provider: "fake" },
    repoScope: ["app"], tasks: [tarea("T1")],
  }, { home: h });
  setActiveTask("6", "T1", { home: h });
  assert.equal(activeTaskFull({ home: h }).task.id, "T1");
});

// ------------------------------------------- los hooks, con paralelismo

test("el guardian de alcance de una tarea no bloquea los archivos de la otra", () => {
  const h = home();
  dosTareasEnParalelo(h);
  const entrada = (p) => ({ tool_name: "Edit", tool_input: { file_path: p }, cwd: p.split("/src")[0] });

  // Cada tarea ve SUS archivos declarados, resueltos por su worktree.
  assert.equal(scope(entrada("/wt/T1/test/t1.test.mjs"), { home: h }).allow, true);
  assert.equal(scope(entrada("/wt/T2/test/t2.test.mjs"), { home: h }).allow, true);
  // Y la de T1 no puede escribir el archivo de T2, aunque este declarado en OTRA tarea.
  assert.equal(scope(entrada("/wt/T1/src/t2.mjs"), { home: h }).allow, false);
});

test("el guardian de orden mide el rojo de la tarea correcta", () => {
  const h = home();
  const run = dosTareasEnParalelo(h);
  run.tasks[0].redVerified = true;
  run.tasks[0].status = "red";
  import("../src/state.mjs").then(({ saveRun }) => saveRun(run, { home: h }));
  // T1 ya vio su rojo; T2 no. El mismo hook, dos veredictos, segun de donde venga.
  const entrada = (wt, p) => ({ tool_name: "Edit", tool_input: { file_path: `${wt}/${p}` }, cwd: wt });
  assert.equal(tddOrder(entrada("/wt/T2", "src/t2.mjs"), { home: h }).allow, false);
});
