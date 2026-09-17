import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRun, saveRun } from "../src/state.mjs";
import { readySet, resumable } from "../src/scheduler.mjs";

const home = () => mkdtempSync(join(tmpdir(), "noxloop-sched-"));

const tarea = (id, over = {}) => ({
  id, repo: "app", title: `t ${id}`, acceptance: "c",
  targetFiles: [`src/${id}.mjs`], testFiles: [`test/${id}.test.mjs`],
  tier: "small", dependsOn: [], dependencyKind: "hard", ...over,
});

// El DAG del escenario 2 del quickstart:
//   T1  T2      sin dependencias entre si
//   T3 <- T1    dura
//   T4 <- T3    dura
function elDag(h) {
  return createRun({
    item: { id: "1", title: "h", level: "story", url: "u", provider: "fake" },
    repoScope: ["app"],
    tasks: [
      tarea("T1"),
      tarea("T2"),
      tarea("T3", { dependsOn: ["T1"] }),
      tarea("T4", { dependsOn: ["T3"] }),
    ],
  }, { home: h });
}

const estado = (run, id, status) => {
  run.tasks.find((t) => t.id === id).status = status;
  return run;
};

test("todo pending: corren las dos que no dependen de nada", () => {
  const r = readySet(elDag(home()), { maxParallelTasks: 4 });
  assert.deepEqual(r.ready, ["T1", "T2"]);
  assert.deepEqual(r.unreachable, []);
});

test("con T1 integrada, T3 se suelta", () => {
  const run = estado(elDag(home()), "T1", "integrated");
  assert.deepEqual(readySet(run, { maxParallelTasks: 4 }).ready, ["T2", "T3"]);
});

test("una tarea en vuelo no vuelve a entrar al conjunto", () => {
  let run = estado(elDag(home()), "T1", "integrated");
  run = estado(run, "T2", "green");
  assert.deepEqual(readySet(run, { maxParallelTasks: 4 }).ready, ["T3"]);
});

test("una dependencia dura GATED no alcanza: hace falta INTEGRADA", () => {
  const run = estado(elDag(home()), "T1", "gated");
  // T1 esta en vuelo (no entra) y T3 sigue esperando: un verde sobre una base
  // que todavia no se integro no habilita a nadie a ramificar encima.
  assert.deepEqual(readySet(run, { maxParallelTasks: 4 }).ready, ["T2"]);
});

test("una dependencia BLANDA no bloquea: asume el contrato y lo declara", () => {
  const run = createRun({
    item: { id: "2", title: "h", level: "story", url: "u", provider: "fake" },
    repoScope: ["app"],
    tasks: [tarea("T1"), tarea("T2", { dependsOn: ["T1"], dependencyKind: "soft" })],
  }, { home: home() });
  assert.deepEqual(readySet(run, { maxParallelTasks: 4 }).ready, ["T1", "T2"]);
});

test("el ancho recorta, respetando el orden topologico", () => {
  const r = readySet(elDag(home()), { maxParallelTasks: 1 });
  assert.deepEqual(r.ready, ["T1"]);
  assert.equal(r.capped, true);
});

test("el ancho cuenta las que ya corren, no solo las nuevas", () => {
  const run = estado(elDag(home()), "T1", "green");
  const r = readySet(run, { maxParallelTasks: 2 });
  assert.equal(r.inFlight, 1);
  assert.deepEqual(r.ready, ["T2"], "con una en vuelo y ancho 2, entra una sola mas");
});

test("una bloqueada vuelve INALCANZABLES a las que dependen de ella, y eso no es lo mismo que bloqueadas", () => {
  const run = estado(elDag(home()), "T1", "blocked");
  const r = readySet(run, { maxParallelTasks: 4 });
  assert.deepEqual(r.ready, ["T2"]);
  // T3 depende de T1; T4 de T3. Las dos quedan inalcanzables por arrastre.
  assert.deepEqual(r.unreachable.sort(), ["T3", "T4"]);
  // La distincion es la que hace util el reporte final: una tarea que fallo y
  // una que nunca pudo intentarse no son el mismo problema.
  assert.ok(!r.unreachable.includes("T1"));
});

test("una inalcanzable por dependencia BLANDA no existe: la blanda no arrastra", () => {
  const run = createRun({
    item: { id: "3", title: "h", level: "story", url: "u", provider: "fake" },
    repoScope: ["app"],
    tasks: [tarea("T1"), tarea("T2", { dependsOn: ["T1"], dependencyKind: "soft" })],
  }, { home: home() });
  estado(run, "T1", "blocked");
  const r = readySet(run, { maxParallelTasks: 4 });
  assert.deepEqual(r.unreachable, []);
  assert.deepEqual(r.ready, ["T2"]);
});

test("recorrido terminado: nada listo, nada inalcanzable", () => {
  let run = elDag(home());
  for (const id of ["T1", "T2", "T3", "T4"]) run = estado(run, id, "integrated");
  const r = readySet(run, { maxParallelTasks: 4 });
  assert.deepEqual(r.ready, []);
  assert.equal(r.done, true);
});

test("no se cachea: se recalcula desde el estado en cada llamada", () => {
  const h = home();
  const run = elDag(h);
  assert.deepEqual(readySet(run, { maxParallelTasks: 4 }).ready, ["T1", "T2"]);
  estado(run, "T1", "integrated");
  saveRun(run, { home: h });
  // Cachear el conjunto es exactamente como un scheduler lanza dos veces la
  // misma tarea.
  assert.deepEqual(readySet(run, { maxParallelTasks: 4 }).ready, ["T2", "T3"]);
});

test("resumable devuelve las que quedaron en vuelo de un recorrido interrumpido", () => {
  let run = estado(elDag(home()), "T1", "green");
  run = estado(run, "T2", "in_progress");
  assert.deepEqual(resumable(run).sort(), ["T1", "T2"]);
  assert.deepEqual(resumable(elDag(home())), [], "sin nada en vuelo, nada que retomar");
});

test("las tareas reclamadas por otro proceso se excluyen explicitamente", () => {
  const r = readySet(elDag(home()), { maxParallelTasks: 4, claimed: ["T1"] });
  assert.deepEqual(r.ready, ["T2"]);
});
