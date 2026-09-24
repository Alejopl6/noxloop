// El hand-off: pasar una tarea a OTRO implementador sin perder lo hecho (spec
// 005, US3, FR-007).
//
// EL HUECO QUE CIERRA. El implementador era uno por recorrido (`runtimes`), asi
// que una tarea que Codex no sabia terminar solo tenia dos salidas: destrabarla
// para que el MISMO runtime lo intentara otra vez, o replanificar y perder el
// rojo verificado y los commits. Ninguna es "que lo termine otro".
//
// LO QUE SE MIDE, y cada cosa por una razon:
//   - el override vive en el estado del run y lo escribe SOLO `state.mjs`
//     (principio VIII del motor: un escritor);
//   - conserva `redVerified`, la evidencia del rojo, los intentos y el worktree
//     con sus commits — retomar no regala presupuesto (principio III);
//   - se rechaza con causa y accion lo que romperia algo: el revisor como
//     implementador (FR-034), un recorrido vivo (fase en vuelo), un runtime que
//     no esta registrado, o el mismo implementador (eso es `unstick`, con nota);
//   - el recorrido de punta a punta: GREEN falla con el primero, se pasa al
//     segundo, y termina en PR SIN repetir RED;
//   - el transcript dice que runtime hizo cada fase.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import {
  createRun, loadRun, transition, bump, traspasar, retomarEnRojo, GuardError, BUDGETS_DEFAULT,
} from "../src/state.mjs";
import { pasarAOtroAgente } from "../src/recovery.mjs";
import { buildDeps } from "../src/wiring.mjs";
import { runItem } from "../src/driver.mjs";
import { ejecutarComando } from "../src/comandos.mjs";
import { rutaDeTranscript } from "../src/transcript.mjs";

const muda = { info() {}, warn() {}, error() {}, child() { return this; } };
const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const PLAN = {
  item: { id: "1", key: "H-1", title: "la historia", level: "story", url: "http://g/1", provider: "fake", acceptance: ["a"] },
  repoScope: ["app"],
  tasks: [{
    id: "T001", repo: "app", title: "tarea", acceptance: "valor es 42",
    targetFiles: ["src/T001.mjs"], testFiles: ["test/T001.test.mjs"],
    tier: "small", dependsOn: [], dependencyKind: "hard",
  }],
};

const ROJO = { command: "node test/T001.test.mjs", exitCode: 1, durationMs: 3, output: "rojo", timedOut: false };

/** Un run con T001 en rojo verificado y bloqueado en GREEN por presupuesto. */
function bloqueadoEnGreen(home) {
  const run = createRun(PLAN, { home });
  transition(run, "T001", "in_progress", { home });
  transition(loadRun("1", { home }), "T001", "red", { home, redVerified: ROJO });
  for (let i = 0; i < BUDGETS_DEFAULT.green; i++) bump(loadRun("1", { home }), "T001", "green", { home });
  transition(loadRun("1", { home }), "T001", "blocked", { home, failure: "el test no llego a pasar:\nAssertionError 41 !== 42" });
  return loadRun("1", { home });
}

// ---------------------------------------------------------------------------
// state.mjs: el unico que escribe el override
// ---------------------------------------------------------------------------

test("traspasar: bloqueada en GREEN vuelve a pending con otro implementador, conservando rojo, intentos y fallo", () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-handoff-"));
  const antes = bloqueadoEnGreen(home);
  const tAntes = antes.tasks[0];

  const r = traspasar(antes, "T001", { runtime: "otro", agente: null, de: "primero", motivo: "Codex no converge" }, { home });
  const t = loadRun("1", { home }).tasks[0];

  assert.equal(t.status, "pending", "el driver solo lanza desde pending: es lo que repone el puntero de tarea activa");
  assert.deepEqual(t.implementador, { runtime: "otro", agente: null });
  assert.equal(t.retomarEn, "red", "con el rojo verificado, se retoma en GREEN y no se repite RED");
  assert.equal(t.redVerified, true);
  assert.deepEqual(t.redEvidence, tAntes.redEvidence, "se perdio la evidencia del rojo");
  assert.deepEqual(t.attempts, tAntes.attempts, "el hand-off toco los contadores: regalaria presupuesto");
  assert.match(t.lastFailure, /41 !== 42/, "el fallo pendiente es el contexto del nuevo agente, no se tira");
  assert.equal(t.sessionId, null, "la sesion era del otro runtime: retomarla desde este no tiene sentido");
  assert.equal(t.handoffs.length, 1);
  assert.equal(t.handoffs[0].de, "primero");
  assert.equal(t.handoffs[0].a, "otro");
  assert.equal(t.handoffs[0].estado, "blocked");
  assert.deepEqual(r.presupuesto.agotados, ["green"], "no se declaro que el bucle de GREEN ya estaba agotado");
});

test("traspasar: sin rojo verificado se retoma desde RED (no hay rojo que conservar)", () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-handoff-"));
  const run = createRun(PLAN, { home });
  transition(run, "T001", "in_progress", { home });
  transition(loadRun("1", { home }), "T001", "blocked", { home, failure: "no se llego a un rojo" });
  traspasar(loadRun("1", { home }), "T001", { runtime: "otro", de: "primero" }, { home });
  const t = loadRun("1", { home }).tasks[0];
  assert.equal(t.status, "pending");
  assert.equal(t.retomarEn, null);
});

test("traspasar: una tarea que ya paso GREEN, o integrada, no tiene implementacion que pasar", () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-handoff-"));
  const run = createRun(PLAN, { home });
  transition(run, "T001", "in_progress", { home });
  transition(loadRun("1", { home }), "T001", "red", { home, redVerified: ROJO });
  transition(loadRun("1", { home }), "T001", "green", { home });
  transition(loadRun("1", { home }), "T001", "gated", { home, evidence: { exitCode: 0, command: "true", output: "" } });
  assert.throws(
    () => traspasar(loadRun("1", { home }), "T001", { runtime: "otro", de: "primero" }, { home }),
    (e) => e instanceof GuardError && /gated/.test(e.message),
  );
  assert.throws(() => traspasar(loadRun("1", { home }), "T001", { runtime: "", de: "x" }, { home }), GuardError);
});

test("retomarEnRojo: in_progress -> red con la evidencia que ya habia, y SOLO si el hand-off lo marco", () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-handoff-"));
  traspasar(bloqueadoEnGreen(home), "T001", { runtime: "otro", de: "primero" }, { home });
  transition(loadRun("1", { home }), "T001", "in_progress", { home });
  retomarEnRojo(loadRun("1", { home }), "T001", { home });
  const t = loadRun("1", { home }).tasks[0];
  assert.equal(t.status, "red");
  assert.equal(t.retomarEn, null, "la marca se consume: un segundo paso por pending si tiene que rehacer RED");
  assert.equal(t.redEvidence.exitCode, 1);

  // Sin la marca, la guarda no deja inventar un rojo.
  const home2 = mkdtempSync(join(tmpdir(), "noxloop-handoff-"));
  const run2 = createRun(PLAN, { home: home2 });
  transition(run2, "T001", "in_progress", { home: home2 });
  assert.throws(() => retomarEnRojo(loadRun("1", { home: home2 }), "T001", { home: home2 }), GuardError);
});

// ---------------------------------------------------------------------------
// recovery.mjs: las guardas del hand-off, con causa y accion
// ---------------------------------------------------------------------------

test("hand-off rechazado: el revisor como implementador (FR-034), con causa y accion", () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-handoff-"));
  bloqueadoEnGreen(home);
  const r = pasarAOtroAgente("1", "T001", { home, runtime: "rev", de: "primero", revisor: "rev", registrados: ["primero", "rev", "otro"] });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, "revisor_comparte_runtime");
  assert.ok(r.causa && r.accion);
  assert.equal(loadRun("1", { home }).tasks[0].status, "blocked", "un rechazo escribio el estado");
});

test("hand-off rechazado: runtime no registrado, y el mismo implementador (eso es unstick)", () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-handoff-"));
  bloqueadoEnGreen(home);
  const base = { home, de: "primero", revisor: "rev", registrados: ["primero", "rev", "otro"] };
  const noEsta = pasarAOtroAgente("1", "T001", { ...base, runtime: "inventado" });
  assert.equal(noEsta.codigo, "runtime_no_registrado");
  assert.match(noEsta.causa, /inventado/);
  const mismo = pasarAOtroAgente("1", "T001", { ...base, runtime: "primero" });
  assert.equal(mismo.codigo, "handoff_mismo_runtime");
  assert.match(mismo.accion, /unstick|destrab/i);
});

test("hand-off rechazado: con el recorrido vivo en otro proceso (fase en vuelo) — primero se detiene", () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-handoff-"));
  bloqueadoEnGreen(home);
  mkdirSync(join(home, "locks"), { recursive: true });
  writeFileSync(join(home, "locks", "run-1.json"), JSON.stringify({
    pid: process.ppid, host: hostname(), token: "t", resource: "run-1", acquiredAt: new Date().toISOString(),
  }));
  const r = pasarAOtroAgente("1", "T001", { home, runtime: "otro", de: "primero", revisor: "rev", registrados: ["primero", "rev", "otro"] });
  assert.equal(r.codigo, "fase_en_vuelo");
  assert.match(r.accion, /deten/i);
  assert.equal(loadRun("1", { home }).tasks[0].status, "blocked");
});

test("hand-off aceptado: queda registrado como decision del recorrido", () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-handoff-"));
  bloqueadoEnGreen(home);
  const r = pasarAOtroAgente("1", "T001", {
    home, runtime: "otro", de: "primero", revisor: "rev", registrados: ["primero", "rev", "otro"], nota: "que lo intente otro",
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const run = loadRun("1", { home });
  const d = run.recovery.decisiones.at(-1);
  assert.equal(d.decision, "handoff");
  assert.equal(d.de, "primero");
  assert.equal(d.a, "otro");
});

// ---------------------------------------------------------------------------
// wiring.mjs: el override elige el runtime de la fase de ESA tarea
// ---------------------------------------------------------------------------

/** @param {string} id @param {{hooks?: boolean, requiredEnv?: string[], fases?: Record<string, any>}} [o] */
function runtime(id, o = {}) {
  /** @type {any[]} */
  const vistas = [];
  return {
    id,
    requiredEnv: o.requiredEnv ?? [],
    capabilities: () => ({ resume: false, cost: false, effort: false, hooks: o.hooks ?? true, models: "desconocido", comandos: true }),
    preflight: async () => ({ ok: true }),
    runPhase: async (/** @type {any} */ req, /** @type {any} */ llamada) => {
      vistas.push(req);
      llamada?.alEvento?.({ t: new Date().toISOString(), tipo: "texto", contenido: `${id} en ${req.phase}` });
      const guion = o.fases?.[req.phase];
      for (const [ruta, contenido] of Object.entries(guion?.escribir ?? {})) {
        mkdirSync(join(req.cwd, ruta, ".."), { recursive: true });
        writeFileSync(join(req.cwd, ruta), String(contenido));
      }
      return { ok: true, sessionId: `sesion-${id}`, usd: null, text: guion?.texto ?? "listo", budgetExhausted: false, subtype: null };
    },
    vistas,
  };
}

test("wiring: la fase del implementador de una tarea con override va a SU runtime, con SU credencial y SU guarda", async () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-handoff-"));
  const a = runtime("primero", { hooks: true, requiredEnv: ["CLAVE_A"] });
  const b = runtime("otro", { hooks: false, requiredEnv: ["CLAVE_B"] });
  const rev = runtime("rev", { requiredEnv: ["CLAVE_R"] });
  const deps = await buildDeps({ id: "1" }, { home, repos: {}, runtimes: { implementador: "primero", revisor: "rev" } }, {
    provider: {}, providerCtx: {}, log: muda, adaptadores: [a, b, rev],
    env: { PATH: "/usr/bin", CLAVE_A: "valor-a-1111", CLAVE_B: "valor-b-2222", CLAVE_R: "valor-r-3333" },
  });
  const tarea = { id: "T001", implementador: { runtime: "otro", agente: null }, testFiles: [], targetFiles: [] };
  const pet = { phase: "GREEN", taskId: "T001", task: tarea, item: { id: "1" }, cwd: home, resume: null, prompt: "/noxloop-task 1 T001 --phase GREEN", tier: "small" };
  await deps.runPhase({ ...pet, env: deps.entorno(pet) });
  await deps.runPhase({ ...pet, phase: "REVIEW", env: deps.entorno({ ...pet, phase: "REVIEW" }) });

  assert.equal(a.vistas.length, 0, "la tarea pasada a otro siguio corriendo en el primero");
  assert.deepEqual(b.vistas.map((v) => v.phase), ["GREEN"]);
  assert.equal(b.vistas[0].env.CLAVE_B, "valor-b-2222");
  assert.equal(b.vistas[0].env.CLAVE_A, undefined, "el nuevo implementador recibio la credencial del anterior");
  assert.deepEqual(rev.vistas.map((v) => v.phase), ["REVIEW"], "el override movio tambien la revision");
  assert.equal(deps.alcancePorElMotorDe(tarea), true, "el nuevo implementador no tiene hooks y no se le aplica la guarda");
  assert.equal(deps.alcancePorElMotorDe({ id: "T002" }), false);
});

test("wiring: un override igual al revisor se rechaza AL CARGAR (FR-034), aunque el estado lo traiga", async () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-handoff-"));
  const run = createRun(PLAN, { home });
  run.tasks[0].implementador = { runtime: "rev", agente: null };
  writeFileSync(join(home, "runs", "run-1.json"), JSON.stringify(run));
  const adaptadores = [runtime("primero"), runtime("rev")];
  await assert.rejects(
    buildDeps({ id: "1" }, { home, repos: {}, runtimes: { implementador: "primero", revisor: "rev" } }, {
      provider: {}, providerCtx: {}, log: muda, adaptadores, env: {},
    }),
    (e) => e.codigo === "revisor_comparte_runtime",
  );
});

// ---------------------------------------------------------------------------
// De punta a punta: GREEN falla con uno, se pasa a otro, y termina en PR
// ---------------------------------------------------------------------------

const TEST_ROJO = `import { valor } from "../src/T001.mjs";\nif (valor !== 42) throw new Error("rojo: " + valor);\n`;

function escenario() {
  const raiz = realpathSync(mkdtempSync(join(tmpdir(), "noxloop-handoff-e2e-")));
  const repo = join(raiz, "repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.test");
  git(repo, "config", "user.name", "T");
  writeFileSync(join(repo, "README.md"), "base\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  const itemBranch = "feature/1-historia";
  git(repo, "branch", itemBranch);
  const integracion = join(raiz, "wt-int");
  git(repo, "worktree", "add", "-q", integracion, itemBranch);
  const home = join(raiz, "home");
  createRun(PLAN, { home });

  const primero = runtime("primero", {
    fases: {
      RED: { escribir: { "test/T001.test.mjs": TEST_ROJO } },
      GREEN: { escribir: { "src/T001.mjs": "export const valor = 41;\n" } },
    },
  });
  const otro = runtime("otro", {
    fases: {
      RED: { escribir: { "test/T001.test.mjs": "throw new Error('RED repetido');\n" } },
      GREEN: { escribir: { "src/T001.mjs": "export const valor = 42;\n" } },
    },
  });
  const rev = runtime("rev", { fases: { REVIEW: { texto: "sin hallazgos bloqueantes" } } });

  const config = {
    home,
    repos: { app: { gate: "true", fastGate: "true", baseBranch: "main", env: {}, gaps: [], remote: "git@x:o/app.git" } },
    tiers: { small: { model: null, effort: "medium", gate: "fast", review: true, fanout: false } },
    runtimes: { implementador: "primero", revisor: "rev" },
  };
  const inject = {
    runSingleTest: (/** @type {string} */ _r, /** @type {string} */ cwd, /** @type {string} */ file) => {
      try {
        execFileSync(process.execPath, ["--input-type=module", "-e", `await import("file://${join(cwd, file)}")`], { stdio: ["ignore", "pipe", "pipe"] });
        return { ok: true, exitCode: 0, command: `node ${file}`, durationMs: 1, output: "", timedOut: false, gaps: [] };
      } catch (e) {
        return { ok: false, exitCode: 1, command: `node ${file}`, durationMs: 1, output: String(/** @type {any} */ (e).stderr || ""), timedOut: false, gaps: [] };
      }
    },
    runGate: () => ({ ok: true, exitCode: 0, command: "true", durationMs: 1, output: "ok", timedOut: false, gaps: [] }),
    createPR: async () => ({ url: "http://forge/pr/1", alreadyExisted: false, body: "" }),
    resolve: () => ({ repoPath: repo, integrationPath: integracion, itemBranch, baseBranch: "main" }),
  };
  const opciones = { provider: {}, providerCtx: {}, log: muda, adaptadores: [primero, otro, rev], env: { PATH: process.env.PATH || "/usr/bin" }, inject };
  return { raiz, repo, home, config, primero, otro, rev, opciones };
}

test("de punta a punta: GREEN falla con el primero, hand-off al segundo, PR sin repetir RED", async () => {
  const e = escenario();

  // 1. El primero hace el rojo bien y no sabe pasar el test: bloqueada en GREEN.
  const r1 = await runItem("1", await buildDeps({ id: "1" }, e.config, e.opciones));
  assert.equal(r1.pr, null);
  const bloqueada = loadRun("1", { home: e.home }).tasks[0];
  assert.equal(bloqueada.status, "blocked");
  assert.equal(bloqueada.redVerified, true);
  assert.equal(bloqueada.attempts.green, BUDGETS_DEFAULT.green);
  const commitsAntes = git(bloqueada.worktree, "log", "--format=%H", bloqueada.branch).split("\n");

  // 2. El hand-off, por el comando que lanza el servicio: `resume` con la tarea y el runtime.
  const r2 = /** @type {any} */ (await ejecutarComando("resume", "1", e.config, {
    ...e.opciones, task: "T001", runtime: "otro", nota: "el primero no converge",
  }));
  assert.equal(r2.pr, "http://forge/pr/1", `no llego al PR: ${JSON.stringify(r2.humano ?? r2)}`);

  // 3. Sin repetir RED, en la misma rama y con los commits de antes.
  assert.equal(e.primero.vistas.filter((v) => v.phase === "RED").length, 1);
  assert.equal(e.otro.vistas.filter((v) => v.phase === "RED").length, 0, "el nuevo agente repitio RED");
  assert.deepEqual(e.otro.vistas.map((v) => v.phase), ["GREEN"]);
  assert.match(e.otro.vistas[0].prompt, /41|rojo/, "el fallo pendiente no le llego como contexto al nuevo agente");
  assert.equal(e.otro.vistas[0].resume, null, "el nuevo runtime intento retomar la sesion del anterior");

  const t = loadRun("1", { home: e.home }).tasks[0];
  assert.equal(t.status, "integrated");
  assert.equal(t.branch, bloqueada.branch, "el hand-off cambio de rama");
  assert.equal(t.attempts.red, bloqueada.attempts.red);
  assert.equal(t.attempts.green, bloqueada.attempts.green, "el hand-off regalo intentos de GREEN");
  assert.deepEqual(t.implementador, { runtime: "otro", agente: null });
  const commitsDespues = git(t.worktree, "log", "--format=%H", t.branch).split("\n");
  for (const c of commitsAntes) assert.ok(commitsDespues.includes(c), `se perdio el commit ${c}`);

  // 4. El transcript dice quien hizo cada fase.
  const green = readFileSync(rutaDeTranscript(e.home, { itemId: "1", taskId: "T001", fase: "GREEN" }), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const quienes = new Set(green.map((ev) => ev.runtime));
  assert.ok(quienes.has("primero") && quienes.has("otro"), `el transcript de GREEN no distingue runtimes: ${[...quienes]}`);
  const red = readFileSync(rutaDeTranscript(e.home, { itemId: "1", taskId: "T001", fase: "RED" }), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(red.every((ev) => ev.runtime === "primero"));
});

test("de punta a punta: un hand-off rechazado por el motor no escribe nada y lo dice", async () => {
  const e = escenario();
  await runItem("1", await buildDeps({ id: "1" }, e.config, e.opciones));
  const antes = readFileSync(join(e.home, "runs", "run-1.json"), "utf8");
  const r = /** @type {any} */ (await ejecutarComando("resume", "1", e.config, { ...e.opciones, task: "T001", runtime: "rev" }));
  assert.equal(r.ok, false);
  assert.equal(r.codigo, "revisor_comparte_runtime");
  assert.ok(r.reason, "el lanzador explica un fallo con `reason`");
  assert.equal(readFileSync(join(e.home, "runs", "run-1.json"), "utf8"), antes);
});
