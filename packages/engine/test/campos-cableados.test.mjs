// Los cables que faltaban, uno por campo.
//
// Los seis campos de este archivo estaban declarados en los esquemas y NADIE
// los leia. Los encontro `campos-sin-consumidor.test.mjs`, no una persona
// leyendo — que es el punto de ese test. Dos de los seis tenian ademas una
// promesa escrita en la documentacion:
//
//   - `outOfScope`: data-model.md dice literalmente "Va al PR". No iba.
//   - `identity.assignee`: ADOPTING.md dice que lo consumen `inbox` y `daemon`.
//     No lo consumia nadie: los proveedores usaban implicitamente el dueño del
//     token, asi que declarar otro responsable no hacia nada y no avisaba.

import { test } from "node:test";
import assert from "node:assert/strict";

// ------------------------------------------------ identity -> contexto del proveedor

import { loadProvider } from "../src/wiring.mjs";

const configBase = {
  provider: { name: "fake", module: new URL("../../../providers/fake/index.mjs", import.meta.url).pathname, options: { a: 1 } },
  home: "/tmp/nox-test-home",
};

test("identity llega al contexto del proveedor: sin eso, declararlo no hace nada", async () => {
  const { ctx } = await loadProvider({ ...configBase, identity: { assignee: "bot@x.test", mention: "@noxloop" } });
  assert.deepEqual(ctx.identity, { assignee: "bot@x.test", mention: "@noxloop" });
});

test("sin identity declarada el contexto lo dice explicitamente, no queda undefined", async () => {
  const { ctx } = await loadProvider(configBase);
  assert.deepEqual(ctx.identity, { assignee: null, mention: null });
});

test("identity no se mezcla con options: son cosas distintas y el proveedor las distingue", async () => {
  const { ctx } = await loadProvider({ ...configBase, identity: { assignee: "x" } });
  assert.equal(ctx.options.assignee, undefined);
  assert.equal(ctx.identity.assignee, "x");
});

// --------------------------------------------------------- callsPerItem

import { techoDeLlamadas, excedeLlamadas } from "../src/driver.mjs";

test("callsPerItem sale de limits, con el default del esquema si no esta", () => {
  assert.equal(techoDeLlamadas({ limits: { callsPerItem: 40 } }), 40);
  assert.equal(techoDeLlamadas({ limits: {} }), 60, "el default del esquema es 60");
  assert.equal(techoDeLlamadas({}), 60);
});

test("un techo en cero o negativo no se acepta: dejaria el motor sin poder invocar nada", () => {
  assert.equal(techoDeLlamadas({ limits: { callsPerItem: 0 } }), 60);
  assert.equal(techoDeLlamadas({ limits: { callsPerItem: -3 } }), 60);
});

test("excedeLlamadas compara el gasto real del recorrido contra el techo", () => {
  assert.equal(excedeLlamadas({ spent: { calls: 59 } }, 60), false);
  assert.equal(excedeLlamadas({ spent: { calls: 60 } }, 60), true, "en el techo ya no se invoca mas");
  assert.equal(excedeLlamadas({ spent: { calls: 61 } }, 60), true);
});

test("un recorrido sin gasto registrado no se considera excedido", () => {
  assert.equal(excedeLlamadas({}, 60), false);
  assert.equal(excedeLlamadas({ spent: {} }, 60), false);
});

// ------------------------------------------- outOfScope y serializedBecause -> el PR

import { prBody } from "../src/forge.mjs";

const runBase = {
  item: { id: "T-1", key: "T-1", title: "un ticket", url: "https://x/T-1", provider: "fake" },
  tasks: [{ id: "T001", title: "una tarea", repo: "api", status: "integrated", targetFiles: ["src/a.ts"], testFiles: ["test/a.test.ts"], attempts: {}, gateEvidence: { exitCode: 0, command: "npm test" } }],
  spent: { usd: 1, calls: 5 },
};

test("outOfScope va al cuerpo del PR: la documentacion lo prometia y no pasaba", () => {
  const b = prBody({ ...runBase, outOfScope: ["no se toca la facturacion", "no se migra la tabla vieja"] }, {});
  assert.match(b, /no se toca la facturacion/);
  assert.match(b, /no se migra la tabla vieja/);
});

test("sin outOfScope el cuerpo no inventa una seccion vacia", () => {
  const b = prBody(runBase, {});
  assert.doesNotMatch(b, /Fuera de alcance/i);
});

test("serializedBecause va al PR: explica por que el orden fue serial", () => {
  const b = prBody({ ...runBase, serializedBecause: "el gestor no soporta dependencias entre items" }, {});
  assert.match(b, /no soporta dependencias/);
});

// --------------------------------------------------------- specialist

import { promptDeFase } from "../src/driver.mjs";

test("el specialist sugerido llega a quien implementa la tarea", () => {
  const p = promptDeFase("GREEN", runBase, { id: "T001", specialist: "ui-builder" });
  assert.match(p, /ui-builder/, "un especialista que no llega al prompt es un campo que no hace nada");
});

test("sin specialist el prompt queda igual que antes", () => {
  const p = promptDeFase("GREEN", runBase, { id: "T001" });
  assert.doesNotMatch(p, /especialista/i);
});

// ------------------------------------------- el cable COMPLETO, no medio cable
//
// `prBody` lee `run.outOfScope`, pero si `createRun` no lo copia del plan, en
// un recorrido de verdad nunca esta: seria el mismo cable cortado un nivel mas
// abajo. Lo mismo con el techo de llamadas — tenerlo como funcion y que nadie
// la llame no hace cumplir nada.

import { createRun } from "../src/state.mjs";
import { validate } from "../src/schema.mjs";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Un home desechable: `createRun` persiste, no opera en memoria. */
const unHome = () => ({ home: mkdtempSync(join(tmpdir(), "nox-campos-")) });

const planCompleto = {
  item: { id: "T-9", key: "T-9", title: "un ticket", provider: "fake", level: "story", url: "https://x" },
  repoScope: ["api"],
  outOfScope: ["no se toca la facturacion"],
  serializedBecause: "el gestor no soporta dependencias",
  tasks: [{
    id: "T001", repo: "api", title: "una tarea", acceptance: "algo observable",
    targetFiles: ["src/a.ts"], testFiles: ["test/a.test.ts"], tier: "small",
    dependsOn: [], dependencyKind: "hard", specialist: "ui-builder",
  }],
};

test("createRun se lleva outOfScope y serializedBecause del plan al recorrido", () => {
  const run = createRun(planCompleto, unHome());
  assert.deepEqual(run.outOfScope, ["no se toca la facturacion"]);
  assert.equal(run.serializedBecause, "el gestor no soporta dependencias");
});

test("y el specialist de la tarea tambien viaja", () => {
  const run = createRun(planCompleto, unHome());
  assert.equal(run.tasks[0].specialist, "ui-builder");
});

test("un plan sin esos campos no mete basura en el recorrido", () => {
  const { outOfScope, serializedBecause, ...pelado } = planCompleto;
  const run = createRun(pelado, unHome());
  assert.deepEqual(run.outOfScope, []);
  assert.equal(run.serializedBecause, null);
});

test("el recorrido resultante valida contra su propio esquema", () => {
  const run = createRun(planCompleto, unHome());
  const esquema = JSON.parse(readFileSync(new URL("../schemas/run.schema.json", import.meta.url), "utf8"));
  assert.deepEqual(validate(esquema, run), [], "el recorrido tiene campos que su esquema no admite");
});

// --------------------------- el techo, haciendose cumplir de verdad
//
// Tener `techoDeLlamadas` y `excedeLlamadas` y que nadie las llame no acota
// nada. Este test invoca la fase con un recorrido que YA paso el techo y exige
// que no se invoque al modelo: sin esto, el limite volveria a ser un limite que
// se lee como puesto y no lo esta.

import { fase } from "../src/driver.mjs";

test("en el techo de llamadas la fase NO invoca al modelo, y dice por que", async () => {
  const home = unHome().home;
  const run = createRun(planCompleto, { home });
  // 60 es el default: se lo deja justo en el techo.
  const { addSpend } = await import("../src/state.mjs");
  addSpend(run, { usd: 0, calls: 60 }, { home });

  let invocaciones = 0;
  const r = await fase("GREEN", createRun(planCompleto, { home }), "T001",
    { model: "m", effort: "low" },
    { home, config: { limits: { callsPerItem: 60 } }, runPhase: async () => { invocaciones++; return { ok: true }; } });

  assert.equal(invocaciones, 0, "se invoco al modelo con el techo agotado");
  assert.equal(r.ok, false);
  assert.equal(r.budgetExhausted, true, "el driver ya sabe tratar esto como corte por presupuesto");
  assert.match(r.text, /60/, "el motivo nombra el techo");
  assert.match(r.text, /callsPerItem/, "y el nombre del limite, para saber que subir");
});

test("por debajo del techo la fase invoca normalmente", async () => {
  const home = unHome().home;
  const run = createRun(planCompleto, { home });
  const { addSpend } = await import("../src/state.mjs");
  addSpend(run, { usd: 0, calls: 59 }, { home });

  let invocaciones = 0;
  await fase("GREEN", createRun(planCompleto, { home }), "T001",
    { model: "m", effort: "low" },
    { home, config: { limits: { callsPerItem: 60 } }, runPhase: async () => { invocaciones++; return { ok: true }; } });

  assert.equal(invocaciones, 1);
});

test("sin config declarada rige el default del esquema, no 'sin techo'", async () => {
  const home = unHome().home;
  const run = createRun(planCompleto, { home });
  const { addSpend } = await import("../src/state.mjs");
  addSpend(run, { usd: 0, calls: 60 }, { home });

  let invocaciones = 0;
  const r = await fase("GREEN", createRun(planCompleto, { home }), "T001",
    { model: "m", effort: "low" },
    { home, runPhase: async () => { invocaciones++; return { ok: true }; } });

  assert.equal(invocaciones, 0, "sin `config` el techo no puede volverse infinito");
  assert.equal(r.budgetExhausted, true);
});
