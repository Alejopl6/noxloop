// La corrida del test que fallo se GUARDA, y llega al pull request.
//
// EL FALLO QUE CIERRA. `transition(..., "red")` exigia el objeto de la corrida
// —y lo validaba: sin exit code no pasa, con exit code 0 tampoco— y despues lo
// TIRABA: solo sobrevivia `redVerified: true`. O sea que el PR afirmaba que el
// rojo se vio y no podia mostrarlo, porque el motor no lo tenia.
//
// Quien revisa quedaba obligado a creerle al estado. Y el estado es confiable
// justamente porque hay evidencia detras: tirarla convierte la promesa central
// del proyecto —"el veredicto es un exit code"— en una afirmacion de README
// para todo el que no tenga acceso al disco donde corrio.
//
// Es la contraparte exacta del gate, que si se muestra: el mismo PR decia
// "exit 0" del gate y "creeme" del rojo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRun, transition, loadRun } from "../src/state.mjs";
import { prBody } from "../src/forge.mjs";

const unHome = () => mkdtempSync(join(tmpdir(), "nox-rojo-"));

const plan = {
  item: { id: "T-1", key: "T-1", title: "un ticket", provider: "fake", level: "story", url: "https://x" },
  repoScope: ["api"],
  tasks: [{
    id: "T001", repo: "api", title: "una tarea", acceptance: "algo observable",
    targetFiles: ["src/a.ts"], testFiles: ["test/a.test.ts"], tier: "small",
    dependsOn: [], dependencyKind: "hard",
  }],
};

const corridaRoja = {
  command: "npm test -- test/a.test.ts",
  exitCode: 1,
  ok: false,
  timedOut: false,
  durationMs: 1430,
  output: "FAIL test/a.test.ts\n  x recalcula el cupo\n  expected 100 to equal 90",
  ranAt: "2026-09-18T10:00:00.000Z",
  gaps: [],
};

function enRojo(home) {
  const run = createRun(plan, { home });
  transition(run, "T001", "in_progress", { home });
  transition(loadRun("T-1", { home }), "T001", "red", { home, redVerified: corridaRoja });
  return loadRun("T-1", { home });
}

test("la corrida se guarda, no solo el booleano", () => {
  const run = enRojo(unHome());
  const t = run.tasks[0];
  assert.equal(t.redVerified, true, "el booleano sigue siendo el que consultan las guardas");
  assert.ok(t.redEvidence, "la corrida que probo el rojo no se guardo: el PR no la puede mostrar");
  assert.equal(t.redEvidence.exitCode, 1);
  assert.equal(t.redEvidence.command, "npm test -- test/a.test.ts");
});

test("la salida del test viaja con la corrida: sin ella no se ve POR QUE fallo", () => {
  const run = enRojo(unHome());
  assert.match(run.tasks[0].redEvidence.output, /expected 100 to equal 90/);
});

test("el recorrido con la evidencia sigue validando contra su esquema", async () => {
  const { validate } = await import("../src/schema.mjs");
  const { readFileSync } = await import("node:fs");
  const esquema = JSON.parse(readFileSync(new URL("../schemas/run.schema.json", import.meta.url), "utf8"));
  assert.deepEqual(validate(esquema, enRojo(unHome())), []);
});

test("avanzar a green no borra la evidencia del rojo", () => {
  const home = unHome();
  enRojo(home);
  transition(loadRun("T-1", { home }), "T001", "green", { home });
  const t = loadRun("T-1", { home }).tasks[0];
  assert.ok(t.redEvidence, "el rojo se vio una vez y eso no deja de ser cierto porque ahora este verde");
});

// ------------------------------------------------------------ y al PR

const integrada = (over = {}) => ({
  id: "T001", title: "una tarea", repo: "api", status: "integrated",
  acceptance: "algo observable", targetFiles: ["src/a.ts"], testFiles: ["test/a.test.ts"],
  attempts: {}, redVerified: true, redEvidence: corridaRoja,
  gateEvidence: { command: "npm test", exitCode: 0, durationMs: 9000, timedOut: false },
  ...over,
});

const runPara = (tasks) => ({
  item: { id: "T-1", key: "T-1", title: "un ticket", url: "https://x/T-1", provider: "fake" },
  tasks, spent: { usd: 1, calls: 5 },
});

test("el PR muestra la corrida del rojo, igual que muestra la del gate", () => {
  const b = prBody(runPara([integrada()]), {});
  assert.match(b, /npm test -- test\/a\.test\.ts/, "el comando que se corrio");
  assert.match(b, /exit 1/, "y que salio distinto de cero, que es lo que prueba el rojo");
});

test("y la razon por la que fallo, que es lo que hace la evidencia util", () => {
  const b = prBody(runPara([integrada()]), {});
  assert.match(b, /expected 100 to equal 90/);
});

test("una salida enorme se recorta, y se DICE que se recorto", () => {
  const largo = { ...corridaRoja, output: "x".repeat(20000) };
  const b = prBody(runPara([integrada({ redEvidence: largo })]), {});
  assert.ok(b.length < 12000, `el cuerpo quedo en ${b.length}: un PR asi no lo acepta el forge`);
  assert.match(b, /recort|truncad/i, "recortar en silencio hace pensar que eso fue todo lo que salio");
});

test("sin evidencia del rojo se DICE, en vez de omitirlo", () => {
  // Omitirlo silenciosamente es indistinguible de "no habia nada que mostrar",
  // y son cosas muy distintas: una tarea vieja sin evidencia y una que nunca
  // vio el rojo se verian igual.
  const b = prBody(runPara([integrada({ redEvidence: null })]), {});
  assert.match(b, /sin evidencia|no se registro/i);
});

test("una tarea declarada sin tests no reclama evidencia del rojo", () => {
  const b = prBody(runPara([integrada({ testFiles: [], redEvidence: null, redVerified: false, noTestsBecause: "es un cambio de configuracion" })]), {});
  assert.match(b, /es un cambio de configuracion/);
  assert.doesNotMatch(b, /Rojo.*sin evidencia/s, "pedirle evidencia del rojo a algo que declaro no tener tests es ruido");
});
