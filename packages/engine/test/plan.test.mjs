import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePlan, findCycle, topoOrder } from "../src/plan.mjs";

const tarea = (id, over = {}) => ({
  id,
  repo: "app",
  title: `tarea ${id}`,
  acceptance: "criterio verificable",
  targetFiles: [`src/${id}.mjs`],
  testFiles: [`test/${id}.test.mjs`],
  tier: "small",
  dependsOn: [],
  dependencyKind: "hard",
  ...over,
});

const plan = (tasks, over = {}) => ({
  item: { id: "1", title: "t", level: "story", url: "http://x/1", provider: "fake" },
  repoScope: ["app"],
  tasks,
  ...over,
});

test("acepta un plan valido", () => {
  const r = validatePlan(plan([tarea("T001"), tarea("T002", { dependsOn: ["T001"] })]), { repos: ["app"] });
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
});

test("rechaza un ciclo NOMBRANDO el ciclo, no con 'plan invalido'", () => {
  const r = validatePlan(
    plan([
      tarea("T001", { dependsOn: ["T003"] }),
      tarea("T002", { dependsOn: ["T001"] }),
      tarea("T003", { dependsOn: ["T002"] }),
    ]),
    { repos: ["app"] },
  );
  assert.equal(r.ok, false);
  const p = r.problems.join(" ");
  assert.ok(p.includes("T001") && p.includes("T002") && p.includes("T003"), `el ciclo no se nombra: ${p}`);
});

test("findCycle devuelve el camino del ciclo, y null si no hay", () => {
  assert.equal(findCycle([tarea("T001"), tarea("T002", { dependsOn: ["T001"] })]), null);
  const c = findCycle([tarea("T001", { dependsOn: ["T002"] }), tarea("T002", { dependsOn: ["T001"] })]);
  assert.ok(c.includes("T001") && c.includes("T002"));
});

test("rechaza un dependsOn que apunta a un id inexistente", () => {
  const r = validatePlan(plan([tarea("T001", { dependsOn: ["T099"] })]), { repos: ["app"] });
  assert.equal(r.ok, false);
  assert.ok(r.problems.join(" ").includes("T099"));
});

test("rechaza una tarea cuyo repo esta fuera de repoScope", () => {
  const r = validatePlan(plan([tarea("T001", { repo: "otro" })]), { repos: ["app", "otro"] });
  assert.equal(r.ok, false);
  assert.ok(r.problems.join(" ").includes("repoScope"));
});

test("rechaza un repo que no esta declarado en la configuracion", () => {
  const r = validatePlan(plan([tarea("T001")], { repoScope: ["app", "fantasma"] }), { repos: ["app"] });
  assert.equal(r.ok, false);
  assert.ok(r.problems.join(" ").includes("fantasma"));
});

test("rechaza testFiles vacio sin noTestsBecause", () => {
  const sin = validatePlan(plan([tarea("T001", { testFiles: [] })]), { repos: ["app"] });
  assert.equal(sin.ok, false);
  assert.ok(sin.problems.join(" ").includes("noTestsBecause"));

  const con = validatePlan(
    plan([tarea("T001", { testFiles: [], noTestsBecause: "renombra una variable de entorno" })]),
    { repos: ["app"] },
  );
  assert.equal(con.ok, true);
});

test("rechaza ids de tarea duplicados", () => {
  const r = validatePlan(plan([tarea("T001"), tarea("T001")]), { repos: ["app"] });
  assert.equal(r.ok, false);
  assert.ok(r.problems.join(" ").includes("T001"));
});

test("rechaza un plan sin tareas: es un ticket que hay que aclarar, no un plan", () => {
  const r = validatePlan(plan([]), { repos: ["app"] });
  assert.equal(r.ok, false);
});

test("topoOrder respeta las dependencias y es estable", () => {
  const t = [tarea("T003", { dependsOn: ["T001"] }), tarea("T001"), tarea("T002")];
  const o = topoOrder(t);
  assert.ok(o.indexOf("T001") < o.indexOf("T003"));
  assert.deepEqual(topoOrder(t), o, "dos corridas, el mismo orden");
});
