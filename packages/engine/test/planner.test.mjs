import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRun } from "../src/state.mjs";
import { planItem, planFile } from "../src/planner.mjs";

const home = () => mkdtempSync(join(tmpdir(), "noxloop-plan-"));

const itemCon = (over = {}) => ({
  id: "42", key: "H-42", title: "la historia", body: "cuerpo",
  acceptance: ["dado un viewer, cuando abre la grilla, entonces no ve la columna costo"],
  level: "story", state: "Nuevo", canonicalState: "todo", assignee: null,
  parentId: null, labels: [], url: "http://g/42", boardFields: null, raw: {},
  ...over,
});

const planValido = {
  item: { id: "42", key: "H-42", title: "la historia", level: "story", url: "http://g/42", provider: "fake" },
  repoScope: ["app"],
  evidence: [{ repo: "app", why: "la grilla vive aca" }],
  tasks: [{
    id: "T001", repo: "app", title: "ocultar la columna", acceptance: "un viewer no ve la columna costo",
    targetFiles: ["src/grilla.mjs"], testFiles: ["test/grilla.test.mjs"], tier: "small",
    dependsOn: [], dependencyKind: "hard",
  }],
};

function deps(esc, over = {}) {
  return {
    home: esc.home,
    config: { repos: { app: { gate: "true", remote: "g", baseBranch: "main", env: {}, gaps: [] } }, provider: { name: "fake" } },
    provider: {
      meta: { name: "fake" },
      capabilities: () => ({ children: true, dependencies: true, createChild: true, setState: true,
                             comment: true, linkUrl: false, labels: false, searchAssigned: true,
                             searchMentioned: true, boardFields: false }),
      getItem: async () => esc.item,
      createChild: async (padre, spec) => ({ id: `hijo-${spec.id}`, title: spec.title }),
      comment: async () => ({ id: "c1" }),
    },
    providerCtx: {},
    workdir: esc.workdir,
    runPhase: async () => {
      mkdirSync(join(esc.home, "plans"), { recursive: true });
      writeFileSync(planFile(esc.home, "42"), JSON.stringify(esc.plan ?? planValido));
      return { ok: true, sessionId: "s1", budgetExhausted: false, text: "plan listo" };
    },
    log: { info() {}, warn() {}, error() {}, child() { return this; } },
    ...over,
  };
}

function escenario(over = {}) {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-plw-"));
  const workdir = join(raiz, "wd");
  mkdirSync(join(workdir, ".noxloop"), { recursive: true });
  return { raiz, workdir, home: home(), item: itemCon(), ...over };
}

test("de un ticket con criterios sale un plan validado y un recorrido", async () => {
  const esc = escenario();
  const r = await planItem("42", deps(esc));
  assert.equal(r.ok, true);
  assert.equal(r.tasks, 1);
  const run = loadRun("42", { home: esc.home });
  assert.equal(run.tasks[0].id, "T001");
  assert.equal(run.tasks[0].status, "pending");
});

test("un ticket SIN criterios verificables no produce codigo: se bloquea con la pregunta", async () => {
  const esc = escenario({ item: itemCon({ acceptance: [] }) });
  let invoco = false;
  const r = await planItem("42", deps(esc, { runPhase: async () => { invoco = true; return { ok: true }; } }));
  assert.equal(r.ok, false);
  assert.equal(invoco, false, "no se gasta una invocacion en algo que no se puede planificar");
  assert.match(r.reason, /criterio/i);
  assert.match(r.question, /criterio/i, "deja una pregunta concreta, no un diagnostico vago");
  assert.equal(loadRun("42", { home: esc.home }), null, "no queda un recorrido a medias");
});

test("un ticket que no existe se reporta como tal, no como fallo del planificador", async () => {
  const esc = escenario();
  const r = await planItem("no-existe", deps(esc, {
    provider: { ...deps(esc).provider, getItem: async () => null },
  }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /no existe|no se encontro/i);
});

test("un plan invalido se rechaza nombrando cada problema, y no crea recorrido", async () => {
  const esc = escenario({ plan: { ...planValido, tasks: [{ ...planValido.tasks[0], dependsOn: ["T999"] }] } });
  const r = await planItem("42", deps(esc));
  assert.equal(r.ok, false);
  assert.ok(r.problems.join(" ").includes("T999"));
  assert.equal(loadRun("42", { home: esc.home }), null);
});

test("un plan con un ciclo se rechaza nombrando el ciclo", async () => {
  const esc = escenario({
    plan: {
      ...planValido,
      tasks: [
        { ...planValido.tasks[0], id: "T001", dependsOn: ["T002"] },
        { ...planValido.tasks[0], id: "T002", dependsOn: ["T001"] },
      ],
    },
  });
  const r = await planItem("42", deps(esc));
  assert.equal(r.ok, false);
  assert.match(r.problems.join(" "), /T001 -> T002|T002 -> T001/);
});

test("si la fase no deja el archivo del plan, se dice eso y no se adivina la causa", async () => {
  const esc = escenario();
  const r = await planItem("42", deps(esc, { runPhase: async () => ({ ok: true, sessionId: "s", text: "hice cosas" }) }));
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes("plan-42.json"), `el motivo no nombra el archivo: ${r.reason}`);
  assert.ok(r.reason.includes("hice cosas"), "trae lo que dijo la fase, textual");
  // La primera version de un harness anterior decia "lo mas probable: la HU no
  // tiene criterios" y en el primer run real esa suposicion fue FALSA. Un
  // diagnostico inventado manda a revisar el lugar equivocado.
  assert.ok(!/probable/i.test(r.reason), "no inventa una causa");
});

test("un corte por presupuesto en la planificacion no se confunde con un plan vacio", async () => {
  const esc = escenario();
  const r = await planItem("42", deps(esc, {
    runPhase: async () => ({ ok: false, budgetExhausted: true, subtype: "error_max_budget_usd" }),
  }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /presupuesto/i);
});

test("es idempotente: relanzar no duplica el recorrido ni los tickets hijos", async () => {
  const esc = escenario();
  const hijos = [];
  const d = deps(esc, {
    provider: { ...deps(esc).provider, createChild: async (p, spec) => { hijos.push(spec.id); return { id: `h-${spec.id}` }; } },
    materialize: true,
  });
  await planItem("42", d);
  const segundo = await planItem("42", d);
  assert.equal(segundo.ok, true);
  assert.equal(segundo.alreadyPlanned, true);
  assert.deepEqual(hijos, ["T001"], "el hijo se creo una sola vez");
});

test("materializa las tareas como tickets hijos cuando el gestor lo soporta", async () => {
  const esc = escenario();
  const creados = [];
  await planItem("42", deps(esc, {
    materialize: true,
    provider: { ...deps(esc).provider, createChild: async (p, spec) => { creados.push({ p, spec }); return { id: "h1" }; } },
  }));
  assert.equal(creados.length, 1);
  assert.equal(creados[0].p, "42");
  const run = loadRun("42", { home: esc.home });
  assert.equal(run.tasks[0].providerItemId, "h1");
});

test("sin createChild el plan sigue valiendo: las tareas viven en el recorrido", async () => {
  const esc = escenario();
  const sinHijos = deps(esc);
  // Las capacidades originales se capturan ANTES de reemplazar el proveedor: si
  // el nuevo `capabilities` leyera el proveedor ya reemplazado, se llamaria a si
  // mismo.
  const capsOriginales = sinHijos.provider.capabilities();
  sinHijos.provider = {
    ...sinHijos.provider,
    capabilities: () => ({ ...capsOriginales, createChild: false }),
  };
  const r = await planItem("42", { ...sinHijos, materialize: true });
  assert.equal(r.ok, true);
  assert.equal(loadRun("42", { home: esc.home }).tasks[0].providerItemId, null);
  assert.match(r.notes.join(" "), /createChild|hijos|tablero/i);
});
