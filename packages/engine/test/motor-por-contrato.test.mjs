// El motor invoca los runtimes POR EL CONTRATO, no por un puente.
//
// EL FALLO QUE ESTE ARCHIVO CIERRA, y estaba medido antes de escribirlo. El
// recorrido de punta a punta (`packages/service/test/punta-a-punta.test.mjs`)
// no podia entregarle al adaptador `fake` lo que el motor construia: tenia que
// interponer una funcion que rellenaba dos campos —`env` siempre, `taskId` en
// PLAN— porque `validarPeticion` del contrato los exige y los dos call sites
// del motor no los mandaban.
//
//   - `driver.mjs` construia la peticion SIN `env`. El motivo del rechazo esta
//     escrito en el propio contrato: "heredar el del motor no es un modo
//     degradado: es la fuga". El subproceso recibia `{...process.env}` desde
//     `runner.mjs`, o sea todas las credenciales cargadas en el proceso padre,
//     tenga grant o no — con lo que la capa de grants queda decorativa.
//   - `planner.mjs` la construia sin `env` y ademas sin `taskId`.
//
// Un puente en el test tapaba las dos cosas, asi que el recorrido demostraba
// que el motor y los adaptadores encajan cuando lo que demostraba es que casi.
//
// LO QUE SE MIDE AQUI. Que la peticion que el motor construye —los tres call
// sites del driver y el del planificador— la acepta `validarPeticion` tal cual,
// y que un adaptador de verdad la puede ejecutar sin que nadie la retoque por
// el camino.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRun, loadRun, setTaskFields } from "../src/state.mjs";
import { fase, runItem } from "../src/driver.mjs";
import { planItem, planFile } from "../src/planner.mjs";
import { buildDeps, entornoDeFase, VARIABLES_DE_LA_MAQUINA } from "../src/wiring.mjs";
import { validarPeticion } from "../../adapters/src/contrato.mjs";
import { crearAdaptadorFake } from "../../adapters/src/adaptadores/fake.mjs";

const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const muda = { info() {}, warn() {}, error() {}, child() { return this; } };

const tarea = (id, over = {}) => ({
  id, repo: "app", title: `tarea ${id}`, acceptance: `criterio de ${id}`,
  targetFiles: [`src/${id}.mjs`], testFiles: [`test/${id}.test.mjs`],
  tier: "small", dependsOn: [], dependencyKind: "hard", ...over,
});

/** Un repositorio de verdad con la rama del item y su worktree, como driver.test. */
function escenario(tasks = [tarea("T001")]) {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-contrato-"));
  const repo = join(raiz, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.test");
  git(repo, "config", "user.name", "T");
  mkdirSync(join(repo, "src"));
  mkdirSync(join(repo, "test"));
  writeFileSync(join(repo, "README.md"), "base\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");

  const itemBranch = "feature/1-historia";
  git(repo, "branch", itemBranch);
  const integracion = join(raiz, "wt-int");
  git(repo, "worktree", "add", "-q", integracion, itemBranch);

  const home = join(raiz, "home");
  const run = createRun({
    item: { id: "1", key: "H-1", title: "la historia", level: "story", url: "http://g/1", provider: "fake",
            acceptance: ["el sistema hace lo que promete"] },
    repoScope: ["app"],
    tasks,
  }, { home });

  return { raiz, repo, integracion, itemBranch, home, run };
}

function runSingleTestReal(repo, cwd, file) {
  try {
    execFileSync("node", ["--input-type=module", "-e", `await import("file://${join(cwd, file)}")`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, exitCode: 0, command: `node ${file}`, durationMs: 5, output: "", timedOut: false, gaps: [] };
  } catch (e) {
    return { ok: false, exitCode: 1, command: `node ${file}`, durationMs: 5,
             output: `${e.stdout || ""}${e.stderr || ""}`, timedOut: false, gaps: [] };
  }
}

/** El modelo de mentira que SI hace el trabajo, y ademas guarda la peticion entera. */
function modeloQueCumple(peticiones) {
  return async (p) => {
    peticiones.push(p);
    const t = p.task;
    if (p.phase === "RED") {
      mkdirSync(join(p.cwd, "test"), { recursive: true });
      writeFileSync(join(p.cwd, t.testFiles[0]),
        `import { valor } from "../${t.targetFiles[0]}";\nif (valor !== 42) throw new Error("rojo");\n`);
    }
    if (p.phase === "GREEN") {
      mkdirSync(join(p.cwd, "src"), { recursive: true });
      writeFileSync(join(p.cwd, t.targetFiles[0]), "export const valor = 42;\n");
    }
    return { ok: true, sessionId: `s-${t.id}`, budgetExhausted: false, text: "listo" };
  };
}

const configDePrueba = (home) => ({
  home,
  repos: { app: { gate: "true", fastGate: "true", baseBranch: "main", env: {}, gaps: ["sin e2e"],
                  remote: "git@x:o/app.git", runners: { node: "node {file}" } } },
  tiers: { small: { model: null, effort: "medium", gate: "fast", review: true, fanout: false },
           large: { model: null, effort: "high", gate: "full", review: true, fanout: true } },
});

function depsBase(esc, over = {}) {
  return {
    config: configDePrueba(esc.home),
    home: esc.home,
    runSingleTest: runSingleTestReal,
    runGate: () => ({ ok: true, exitCode: 0, command: "true", durationMs: 10, output: "ok", timedOut: false, gaps: ["sin e2e"] }),
    createPR: async () => ({ url: "http://forge/pr/1", alreadyExisted: false, body: "cuerpo" }),
    resolve: () => ({ repoPath: esc.repo, integrationPath: esc.integracion,
                      itemBranch: esc.itemBranch, baseBranch: "main" }),
    provider: null,
    maxParallelTasks: 4,
    log: muda,
    // El entorno de estas fases no lleva ninguna credencial: solo las variables
    // de la maquina. Declararlo importa — sin el campo, la guarda de argv mira
    // TODOS los valores, y el de `HOME` es prefijo de cualquier ruta absoluta.
    secretos: [],
    ...over,
  };
}

/** @param {any[]} peticiones @param {string} donde */
function exigirQueElContratoLasAcepte(peticiones, donde) {
  assert.ok(peticiones.length > 0, `${donde}: no se capturo ninguna peticion, el test no mide nada`);
  for (const p of peticiones) {
    const v = validarPeticion(p);
    assert.equal(
      v.ok,
      true,
      `${donde}: la peticion de la fase ${p.phase} no cumple el contrato de adaptadores y ningun runtime la ` +
        `puede ejecutar:\n  - ${v.problems.join("\n  - ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// los call sites del motor
// ---------------------------------------------------------------------------

test("las peticiones del driver cumplen el contrato: las tres, incluidas las del abanico", async () => {
  const esc = escenario([tarea("T001", { tier: "large" })]);
  const peticiones = [];
  // `tier: large` enciende `fanout`, que es el camino con DOS call sites mas
  // —una por lente y la sintesis—. Sin esto el test mediria un tercio del
  // driver y los otros dos seguirian sin poder invocar a ningun runtime.
  await runItem("1", depsBase(esc, { runPhase: modeloQueCumple(peticiones) }));

  exigirQueElContratoLasAcepte(peticiones, "driver");
  assert.ok(
    peticiones.some((p) => p.phase === "REVIEW-SINTESIS"),
    "el abanico no corrio: este test no llego a mirar los call sites de la revision",
  );
});

test("el revisor no retoma la sesion del implementador, tambien con el entorno puesto", async () => {
  const esc = escenario([tarea("T001")]);
  const peticiones = [];
  await runItem("1", depsBase(esc, { runPhase: modeloQueCumple(peticiones) }));

  for (const p of peticiones.filter((x) => /^REVIEW/.test(x.phase))) {
    assert.equal(p.resume, null, `la fase ${p.phase} llego con resume "${p.resume}": la revision vuelve a confirmar`);
  }
  assert.equal(
    peticiones.find((p) => p.phase === "GREEN")?.resume,
    "s-T001",
    "GREEN dejo de retomar la sesion de RED: el cableado perdio el contexto que si vale",
  );
});

test("la peticion del planificador cumple el contrato, y su taskId no finge ser una tarea", async () => {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-contrato-plan-"));
  const workdir = join(raiz, "wd");
  const home = join(raiz, "home");
  mkdirSync(workdir, { recursive: true });

  const peticiones = [];
  const plan = {
    item: { id: "42", key: "H-42", title: "la historia", level: "story", url: "http://g/42", provider: "fake" },
    repoScope: ["app"],
    evidence: [{ repo: "app", why: "vive aca" }],
    tasks: [{ id: "T001", repo: "app", title: "hacerlo", acceptance: "se observa",
              targetFiles: ["src/a.mjs"], testFiles: ["test/a.test.mjs"], tier: "small",
              dependsOn: [], dependencyKind: "hard" }],
  };

  const r = await planItem("42", {
    home,
    config: configDePrueba(home),
    provider: {
      meta: { name: "fake" },
      capabilities: () => ({ children: false, dependencies: false, createChild: false, setState: false,
                             comment: false, linkUrl: false, labels: false, searchAssigned: false,
                             searchMentioned: false, boardFields: false }),
      getItem: async () => ({
        id: "42", key: "H-42", title: "la historia", body: "cuerpo",
        acceptance: ["dado un viewer, cuando abre la grilla, entonces no ve la columna costo"],
        level: "story", state: "Nuevo", canonicalState: "todo", assignee: null,
        parentId: null, labels: [], url: "http://g/42", boardFields: null, raw: {},
      }),
    },
    providerCtx: {},
    workdir,
    materialize: false,
    log: muda,
    runPhase: async (p) => {
      peticiones.push(p);
      mkdirSync(join(home, "plans"), { recursive: true });
      writeFileSync(planFile(home, "42"), JSON.stringify(plan));
      return { ok: true, sessionId: "s1", budgetExhausted: false, text: "plan listo" };
    },
  });

  assert.equal(r.ok, true, JSON.stringify(r));
  exigirQueElContratoLasAcepte(peticiones, "planner");

  const { taskId } = peticiones[0];
  // AQUI NO HAY TAREA TODAVIA: se esta planificando, y las tareas nacen del
  // plan que esta invocacion produce. Un `taskId` con la forma de una tarea del
  // plan (`^T[0-9]{3,}$`, lo que exige plan.schema.json) haria que la bitacora
  // y la sesion de la planificacion se confundieran con las de una tarea real.
  assert.equal(/^T[0-9]{3,}$/.test(taskId), false, `el planificador se invento una tarea: ${taskId}`);
  assert.match(taskId, /42/, `el taskId de la planificacion no dice que item se estaba planificando: ${taskId}`);
});

// ---------------------------------------------------------------------------
// el entorno: lo que hace que el grant signifique algo
// ---------------------------------------------------------------------------

test("el entorno de una fase se construye: no hereda el del motor", () => {
  const centinela = "NOXLOOP_PRUEBA_DEL_ENTORNO_QUE_NO_SE_HEREDA";
  process.env[centinela] = "no-tendria-que-viajar";
  try {
    const env = entornoDeFase({ home: "/un/home" });
    assert.equal(
      Object.hasOwn(env, centinela),
      false,
      "una variable que nadie declaro llego a la fase: el subproceso hereda el entorno del motor y el grant no " +
        "significa nada",
    );
    assert.equal(env.NOXLOOP_HOME, "/un/home", "sin NOXLOOP_HOME los hooks miran otro home y corren sin guarda");
    assert.equal(env.NOXLOOP_GUARD_ALWAYS, "1");
    assert.equal(env.CI, "1");
    for (const [k, v] of Object.entries(env)) assert.equal(typeof v, "string", `${k} no es texto`);
  } finally {
    delete process.env[centinela];
  }
});

test("lo que un runtime declara necesitar viaja; lo que no declara nadie, no", () => {
  const declarada = "NOXLOOP_PRUEBA_DECLARADA_POR_EL_RUNTIME";
  const otra = "NOXLOOP_PRUEBA_QUE_NADIE_DECLARO";
  const env = entornoDeFase({ home: "/h" }, {
    env: { [declarada]: "si", [otra]: "no", PATH: "/usr/bin" },
    requeridas: [declarada],
  });
  assert.equal(env[declarada], "si", "un runtime que declara la variable que necesita no la recibe");
  assert.equal(Object.hasOwn(env, otra), false, "viajo una variable que ningun runtime declaro necesitar");
  assert.ok(VARIABLES_DE_LA_MAQUINA.includes("PATH"), "la lista de variables de la maquina tiene que estar nombrada");
});

// ---------------------------------------------------------------------------
// el cableado monta un adaptador, y el motor lo invoca sin puentes
// ---------------------------------------------------------------------------

test("wiring monta un adaptador del contrato y `deps.runPhase` lo invoca", async () => {
  const esc = escenario();
  const vistas = [];
  const espia = {
    id: "espia",
    capabilities: () => ({ resume: true, cost: true, effort: true, hooks: true, models: "desconocido" }),
    preflight: async () => ({ ok: true }),
    runPhase: async (req) => {
      vistas.push(req);
      return { ok: true, sessionId: "s1", usd: 0.1, text: "hecho", budgetExhausted: false, subtype: null };
    },
  };

  const deps = await buildDeps(esc.run.item, configDePrueba(esc.home), {
    provider: {},
    providerCtx: {},
    log: muda,
    adaptadores: [espia],
    runtime: "espia",
  });

  assert.equal(deps.runtime, "espia", "el cableado no dice por que runtime corre");
  // El entorno que trae la fase lleva una marca. Sirve para lo de abajo.
  const entornoDelMotor = { ...entornoDeFase(configDePrueba(esc.home)), NOXLOOP_MARCA_DEL_LLAMANTE: "la del motor" };
  await deps.runPhase({
    phase: "GREEN", taskId: "T001", task: tarea("T001"), item: esc.run.item,
    cwd: esc.integracion, resume: null, model: "un-modelo", effort: "medium",
    prompt: "/noxloop-task 1 T001 --phase GREEN", tier: "small",
    env: entornoDelMotor,
  });

  assert.equal(vistas.length, 1, "`deps.runPhase` no llego al adaptador: el registro sigue sin consultarse");
  exigirQueElContratoLasAcepte(vistas, "cableado");
  // EL ENTORNO QUE DECLARA EL LLAMANTE MANDA. La costura lo sobreescribia
  // siempre, porque daba por hecho que el motor no traia ninguno. Si vuelve a
  // hacerlo, el motor diria con que entorno quiere correr la fase y correria
  // con otro, sin que nada lo dijera.
  assert.equal(
    vistas[0].env.NOXLOOP_MARCA_DEL_LLAMANTE,
    "la del motor",
    "la costura reemplazo el entorno que construyo el motor por el suyo, en silencio",
  );
});

test("el adaptador que monta el cableado por defecto lleva las guardas puestas", async () => {
  const esc = escenario();
  const deps = await buildDeps(esc.run.item, configDePrueba(esc.home), { provider: {}, providerCtx: {}, log: muda });

  const caps = deps.adaptador.capabilities();
  assert.equal(
    caps.hooks,
    true,
    "el runtime montado declara `hooks: false`: las sesiones del motor correrian sin el hook del paso RED ni el " +
      "del limite de autonomia, y sin avisar",
  );
  assert.equal(typeof deps.adaptador.id, "string");
  assert.equal(typeof deps.entorno, "function", "el driver necesita de donde sacar el entorno de cada fase");
});

test("un resultado del contrato no trae veredicto, y el motor lo deriva en vez de perderlo", async () => {
  // EL CABLE QUE ESTO PROTEGE. El driver bloquea con `r.findings ===
  // "blocking"`, y ese campo lo producia el invocador de v1. Un `PhaseResult`
  // del contrato de adaptadores NO lo lleva: al montar el runtime por contrato,
  // la comparacion volvia a ser siempre falsa y la revision dejaba de poder
  // bloquear nada, en silencio. Es el mismo fallo que ya ocurrio una vez.
  const esc = escenario();
  setTaskFields(esc.run, "T001", { worktree: esc.integracion }, { home: esc.home });
  const run = loadRun("1", { home: esc.home });
  const politica = { model: null, effort: "medium" };

  // Lo que devuelve un adaptador: ni rastro de `findings`.
  const comoUnAdaptador = (texto) => async () => ({
    ok: true, sessionId: "s1", usd: null, text: texto, budgetExhausted: false, subtype: null, degradaciones: [],
  });

  const bloqueante = await fase("REVIEW", run, "T001", politica, depsBase(esc, {
    runPhase: comoUnAdaptador("Revise el diff.\n\nHALLAZGO BLOQUEANTE: el catch de la linea 40 no reporta."),
  }));
  assert.equal(bloqueante.findings, "blocking", "la revision no puede bloquear: el marcador del revisor no lo lee nadie");

  const limpia = await fase("REVIEW", run, "T001", politica, depsBase(esc, {
    runPhase: comoUnAdaptador("Revise criterio, seguridad, estilo y alcance. No hay hallazgos bloqueantes."),
  }));
  assert.equal(limpia.findings, "clean");

  // Y si el resultado YA trae veredicto, manda el suyo: `null` es "no se sabe",
  // que es distinto de no haberlo declarado, y derivarlo encima lo perderia.
  const sinVeredicto = await fase("REVIEW", run, "T001", politica, depsBase(esc, {
    runPhase: async () => ({ ok: false, text: "HALLAZGO BLOQUEANTE: da igual", findings: null }),
  }));
  assert.equal(sinVeredicto.findings, null, "se piso el veredicto que el resultado ya traia");
});

test("el motor invoca al adaptador `fake` sin que nadie retoque la peticion", async () => {
  // ES LA MEDICION QUE FALTABA. Se le entrega a `fase()` un `runPhase` que es
  // el adaptador PELADO: sin funcion intermedia que rellene campos. Si al motor
  // le falta uno, el adaptador responde `entorno_ausente` o `peticion_invalida`
  // y este test lo dice con el motivo del contrato dentro.
  const esc = escenario();
  const dir = mkdtempSync(join(tmpdir(), "noxloop-fake-"));
  const guion = join(dir, "guion.json");
  writeFileSync(guion, JSON.stringify({ texto: "hecho", exito: true }));
  const adaptador = crearAdaptadorFake({ guion, visto: join(dir, "visto.json") });

  // El worktree lo reparte `runItem`; aqui se invoca `fase()` sola, asi que se
  // le pone el que ya existe.
  setTaskFields(esc.run, "T001", { worktree: esc.integracion }, { home: esc.home });
  const run = loadRun("1", { home: esc.home });

  const deps = depsBase(esc, { runPhase: (p) => adaptador.runPhase(p) });
  const r = await fase("GREEN", run, "T001", { model: null, effort: "medium" }, deps);

  assert.notEqual(r.subtype, "entorno_ausente", `el motor invoco sin entorno:\n${r.text}`);
  assert.notEqual(r.subtype, "peticion_invalida", `el motor invoco con una peticion incompleta:\n${r.text}`);
  assert.equal(r.ok, true, `el adaptador no pudo correr la fase que el motor construyo:\n${r.text}`);
});
