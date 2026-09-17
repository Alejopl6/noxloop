import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRun, loadRun, transition, bump, setTaskFields, addTarget } from "../src/state.mjs";

const home = () => mkdtempSync(join(tmpdir(), "noxloop-race-"));

const tarea = (id) => ({
  id, repo: "app", title: id, acceptance: "c",
  targetFiles: [`src/${id}.mjs`], testFiles: [`test/${id}.test.mjs`],
  tier: "small", dependsOn: [], dependencyKind: "hard",
});

const plan = (n) => ({
  item: { id: "1", title: "h", level: "story", url: "u", provider: "fake" },
  repoScope: ["app"],
  tasks: Array.from({ length: n }, (_, i) => tarea(`T${i + 1}`)),
});

// EL FALLO QUE ESTOS TESTS FIJAN. Con dos tareas en paralelo, cada una sostenia
// su propia copia del recorrido entre `await`s y la ultima en guardar borraba lo
// que habia escrito la otra. La consecuencia observada: una tarea perdia su
// worktree, volvia a "pending", intentaba crear el worktree de nuevo y moria.

test("dos escrituras sobre tareas distintas no se pisan, aunque los objetos sean viejos", () => {
  const h = home();
  const a = createRun(plan(2), { home: h });
  const b = loadRun("1", { home: h });   // otra referencia, leida antes

  setTaskFields(a, "T1", { worktree: "/wt/T1" }, { home: h });
  setTaskFields(b, "T2", { worktree: "/wt/T2" }, { home: h });

  const disco = loadRun("1", { home: h });
  assert.equal(disco.tasks[0].worktree, "/wt/T1", "la escritura de T1 sobrevivio");
  assert.equal(disco.tasks[1].worktree, "/wt/T2");
});

test("el objeto del llamador queda al dia despues de que otro escribio", () => {
  const h = home();
  const a = createRun(plan(2), { home: h });
  const b = loadRun("1", { home: h });
  setTaskFields(b, "T2", { worktree: "/wt/T2" }, { home: h });
  // `a` no sabia nada de eso; al escribir, se sincroniza con el disco.
  setTaskFields(a, "T1", { worktree: "/wt/T1" }, { home: h });
  assert.equal(a.tasks[1].worktree, "/wt/T2", "el objeto viejo ve lo que escribio el otro");
});

test("las transiciones de dos tareas en paralelo conviven", () => {
  const h = home();
  const a = createRun(plan(2), { home: h });
  const b = loadRun("1", { home: h });
  transition(a, "T1", "in_progress", { home: h });
  transition(b, "T2", "in_progress", { home: h });
  const disco = loadRun("1", { home: h });
  assert.deepEqual(disco.tasks.map((t) => t.status), ["in_progress", "in_progress"]);
});

test("los contadores no se pierden entre tareas concurrentes", () => {
  const h = home();
  const a = createRun(plan(2), { home: h });
  const b = loadRun("1", { home: h });
  bump(a, "T1", "green", { home: h });
  bump(b, "T2", "green", { home: h });
  bump(a, "T1", "green", { home: h });
  const disco = loadRun("1", { home: h });
  assert.equal(disco.tasks[0].attempts.green, 2);
  assert.equal(disco.tasks[1].attempts.green, 1);
});

test("una ampliacion de alcance no borra la de la otra tarea", () => {
  const h = home();
  const a = createRun(plan(2), { home: h });
  const b = loadRun("1", { home: h });
  addTarget(a, "T1", "src/compartido.mjs", "el tipo vive aca", { home: h });
  addTarget(b, "T2", "src/otro.mjs", "idem", { home: h });
  const disco = loadRun("1", { home: h });
  assert.equal(disco.tasks[0].addedTargets.length, 1);
  assert.equal(disco.tasks[1].addedTargets.length, 1);
});

test("sin home sigue funcionando en memoria: es lo que usan los tests unitarios", () => {
  const h = home();
  const run = createRun(plan(1), { home: h });
  const r = bump(run, "T1", "green", {});
  assert.equal(r.count, 1);
  assert.equal(run.tasks[0].attempts.green, 1);
  // Sin `home` no se persiste: el disco sigue en cero.
  assert.equal(loadRun("1", { home: h }).tasks[0].attempts.green, 0);
});
