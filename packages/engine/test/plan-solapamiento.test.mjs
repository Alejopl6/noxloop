// Dos tareas que pueden correr a la vez no pueden declarar el mismo archivo.
//
// EL FALLO QUE CIERRA. `targetFiles` era `required` en el esquema y `plan.mjs`
// no lo mencionaba una sola vez: nada impedia que dos tareas SIN arista entre
// ellas declararan el mismo archivo. El scheduler las lanza en paralelo —eso es
// lo que el DAG autoriza— cada una en su worktree, y el choque aparece al
// rebasar en la cola de integracion, como conflicto. Es exactamente el modo de
// fallo que el DAG existe para evitar: "el proyecto anterior encadeno catorce
// ramas una sobre otra y las tres ultimas llegaron en conflicto".
//
// SE RECHAZA EN LA PLANIFICACION y no en la cola porque en la cola ya se
// gastaron dos recorridos de modelo. Un plan invalido cuesta cero.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePlan } from "../src/plan.mjs";

const T = (id, over = {}) => ({
  id, repo: "api", title: `tarea ${id}`, acceptance: "algo observable",
  targetFiles: [`src/${id}.ts`], testFiles: [`test/${id}.test.ts`],
  tier: "small", dependsOn: [], dependencyKind: "hard", ...over,
});

const plan = (tasks, over = {}) => ({
  item: { id: "T-1", key: "T-1", title: "un ticket", provider: "fake", level: "story", url: "https://x" },
  repoScope: ["api", "web"],
  tasks,
  ...over,
});

const ctx = { repos: ["api", "web"] };

test("dos tareas paralelas sobre el mismo archivo se rechazan, nombrando el archivo", () => {
  const r = validatePlan(plan([
    T("T001", { targetFiles: ["src/saldo.ts"] }),
    T("T002", { targetFiles: ["src/saldo.ts"] }),
  ]), ctx);

  assert.equal(r.ok, false);
  const p = r.problems.join("\n");
  assert.match(p, /src\/saldo\.ts/, "el archivo tiene que estar en el mensaje");
  assert.match(p, /T001/);
  assert.match(p, /T002/);
});

test("con una arista entre ellas se permite: no corren a la vez", () => {
  const r = validatePlan(plan([
    T("T001", { targetFiles: ["src/saldo.ts"] }),
    T("T002", { targetFiles: ["src/saldo.ts"], dependsOn: ["T001"] }),
  ]), ctx);
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
});

test("una dependencia TRANSITIVA tambien alcanza: t3 nunca corre con t1", () => {
  const r = validatePlan(plan([
    T("T001", { targetFiles: ["src/saldo.ts"] }),
    T("T002", { dependsOn: ["T001"] }),
    T("T003", { targetFiles: ["src/saldo.ts"], dependsOn: ["T002"] }),
  ]), ctx);
  assert.deepEqual(r.problems, [], "el camino t1 -> t2 -> t3 las ordena igual que una arista directa");
});

test("el mismo nombre de archivo en repositorios DISTINTOS no es un choque", () => {
  const r = validatePlan(plan([
    T("T001", { repo: "api", targetFiles: ["src/index.ts"] }),
    T("T002", { repo: "web", targetFiles: ["src/index.ts"] }),
  ]), ctx);
  assert.deepEqual(r.problems, [], "son dos archivos distintos en dos worktrees distintos");
});

test("las rutas se comparan normalizadas: ./src/a.ts y src/a.ts son el mismo archivo", () => {
  const r = validatePlan(plan([
    T("T001", { targetFiles: ["./src/a.ts"] }),
    T("T002", { targetFiles: ["src/a.ts"] }),
  ]), ctx);
  assert.equal(r.ok, false, "escribir la ruta distinto no vuelve al archivo distinto");
});

test("un solapamiento de tres tareas se reporta por archivo, no tres veces lo mismo", () => {
  const r = validatePlan(plan([
    T("T001", { targetFiles: ["src/x.ts"] }),
    T("T002", { targetFiles: ["src/x.ts"] }),
    T("T003", { targetFiles: ["src/x.ts"] }),
  ]), ctx);
  const delSolape = r.problems.filter((p) => /src\/x\.ts/.test(p));
  assert.equal(delSolape.length, 1, `se esperaba un problema por archivo y hubo ${delSolape.length}`);
  assert.match(delSolape[0], /T001/);
  assert.match(delSolape[0], /T002/);
  assert.match(delSolape[0], /T003/);
});

test("varios archivos solapados dan varios problemas: cada uno se arregla aparte", () => {
  const r = validatePlan(plan([
    T("T001", { targetFiles: ["src/a.ts", "src/b.ts"] }),
    T("T002", { targetFiles: ["src/a.ts", "src/b.ts"] }),
  ]), ctx);
  assert.equal(r.problems.filter((p) => /src\/a\.ts|src\/b\.ts/.test(p)).length, 2);
});

test("una cadena larga sin solapamiento sigue siendo valida", () => {
  const r = validatePlan(plan([
    T("T001"), T("T002", { dependsOn: ["T001"] }), T("T003", { dependsOn: ["T002"] }),
    T("T004", { dependsOn: ["T001"] }), T("T005", { repo: "web" }),
  ]), ctx);
  assert.deepEqual(r.problems, []);
});

test("un plan con ciclo no se cuelga buscando alcanzabilidad", () => {
  // El calculo de alcanzabilidad recorre el grafo, y un ciclo lo haria girar
  // para siempre si no se cortara. Se reporta el ciclo y se termina.
  const r = validatePlan(plan([
    T("T001", { dependsOn: ["T002"], targetFiles: ["src/x.ts"] }),
    T("T002", { dependsOn: ["T001"], targetFiles: ["src/x.ts"] }),
  ]), ctx);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /ciclo/.test(p)));
});
