// EL PARALELISMO ES REAL, NO NOMINAL.
//
// Es el unico archivo de test del proyecto cuyo objeto es la concurrencia
// misma. El resto de la suite prueba el paralelismo por sus piezas —el
// scheduler decide bien, la cola integra en serie, el estado tiene guardas— y
// eso deja afuera justo lo que mas caro salio: que dos cosas corriendo A LA VEZ
// sobre el MISMO repositorio no se arruinen entre ellas.
//
// Los cuatro fallos que este archivo fija, todos medidos y todos con la forma
// de "el mecanismo estaba, pero no se probaba con dos en vuelo":
//
//   1. ESTADO PISADO. Dos tareas paralelas sostenian cada una su copia del
//      recorrido entre `await`s, y la ultima en guardar borraba lo de la otra.
//      Consecuencia observada: una tarea perdia su worktree, volvia a
//      "pending", intentaba crear el worktree de nuevo y moria — con el error
//      apareciendo en el lugar equivocado. `state-concurrencia.test.mjs` fijo
//      el caso sobre las funciones de estado; aca se extiende al camino del
//      driver, que es donde las escrituras ocurren de verdad entre fases.
//
//   2. UN VEREDICTO QUE NO SIGNIFICA NADA. Si el gate de una tarea midiera el
//      codigo sin integrar de otra, un verde deja de decir algo sobre la tarea
//      que lo obtuvo. Es la razon entera del worktree por tarea, y se prueba
//      con contenido distinto por tarea, verificando lo que cada gate VE.
//
//   3. PARALELISMO NOMINAL. Un `Promise.all` sobre tareas que en realidad se
//      esperan una a la otra da el mismo resultado final que el paralelismo de
//      verdad, y por eso pasa desapercibido: lo unico que cambia es el tiempo.
//      Aca se mide el solapamiento observable, y se mide tambien que con ancho
//      1 NO exista — un test que no distingue las dos cosas no prueba nada.
//
//   4. EL DOBLE NIVEL. El hito corre historias en paralelo y cada historia
//      corre tareas en paralelo. Son dos `Promise.allSettled` anidados sobre el
//      mismo repositorio de git, y nunca se habian ejercido juntos.
//
// TODO CORRE SIN RED, SIN CREDENCIALES Y SIN MODELO: el proveedor es un objeto
// de mentira, `runItem`/`planItem`/`runPhase`/`runGate` entran inyectados, y
// los repositorios son repositorios de git de verdad pero desechables.
//
// Y SIN ESPERAS REALES. El tiempo de SC-002 se mide con un reloj de mentira
// (ver `relojDeMentira`): comparar relojes de pared en una maquina cargada
// produce un test intermitente, y un test intermitente es peor que ninguno
// porque enseña a ignorar el rojo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  createRun, loadRun, saveRun, setTaskFields, addTarget,
} from "../src/state.mjs";
import { runItem } from "../src/driver.mjs";
import { correrHito, leerHito } from "../src/milestone.mjs";

const git = (cwd, ...a) =>
  execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** Cede el turno del bucle de eventos. Sin esto, dos tareas "en paralelo" se
 * ejecutarian una despues de la otra y el test no probaria nada. */
const cede = () => new Promise((r) => setImmediate(r));

const listado = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith(".")).sort() : [];

// ---------------------------------------------------------- el escenario

const tarea = (id, over = {}) => ({
  id, repo: "app", title: `tarea ${id}`, acceptance: `criterio de ${id}`,
  targetFiles: [`src/${id}.mjs`], testFiles: [`test/${id}.test.mjs`],
  tier: "small", dependsOn: [], dependencyKind: "hard", ...over,
});

/**
 * UN repositorio de git de verdad —el mismo para las N tareas, que es el punto—
 * con la rama del item y su worktree de integracion. Copiado a proposito del
 * armado de `driver.test.mjs`: si el escenario difiere, la comparacion entre lo
 * que pasa con una tarea y lo que pasa con N deja de valer.
 */
function escenario(tasks, itemId = "1") {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-par-"));
  const repo = join(raiz, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.test");
  git(repo, "config", "user.name", "T");
  writeFileSync(join(repo, "README.md"), "base\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");

  const itemBranch = `feature/${itemId}-historia`;
  git(repo, "branch", itemBranch);
  const integracion = join(raiz, "wt-int");
  git(repo, "worktree", "add", "-q", integracion, itemBranch);

  const home = join(raiz, "home");
  createRun({
    item: { id: itemId, key: `H-${itemId}`, title: "la historia", level: "story",
            url: `http://g/${itemId}`, provider: "fake", acceptance: ["algo observable"] },
    repoScope: ["app"],
    tasks,
  }, { home });

  return { raiz, repo, integracion, itemBranch, home };
}

/**
 * Un modelo de mentira que SI hace el trabajo, instrumentado para la
 * concurrencia: registra cada entrada y salida de fase, cuenta cuantas hay a la
 * vez, y cede el turno del bucle de eventos en el medio.
 *
 * El contenido que escribe es DISTINTO por tarea (`item-tarea`) y su test
 * comprueba ese valor exacto: es lo que convierte "cada tarea en su worktree"
 * en algo que el test puede verificar en vez de asumir.
 */
function modeloInstrumentado(bitacora, marca, opts = {}) {
  let enVuelo = 0;
  return async (fase) => {
    const t = fase.task;
    const etiqueta = `${fase.item.id}-${fase.taskId}`;
    enVuelo += 1;
    marca.maxSimultaneas = Math.max(marca.maxSimultaneas, enVuelo);
    bitacora.push({
      ev: "entra", fase: fase.phase, tarea: fase.taskId, item: fase.item.id,
      // QUE VE ESTA FASE, EN EL MOMENTO EN QUE LO VE. Medirlo despues no sirve:
      // cuando el recorrido termina, la rama del item tiene el trabajo de todas
      // las tareas —y correctamente—, asi que una comprobacion posterior pasaria
      // sola. Lo que prueba el aislamiento es lo que se observa DURANTE.
      ve: listado(join(fase.cwd, "src")),
      hist: git(fase.cwd, "log", "--format=%s"),
    });

    await cede();

    if (fase.phase === "RED") {
      mkdirSync(join(fase.cwd, "test"), { recursive: true });
      writeFileSync(join(fase.cwd, t.testFiles[0]),
        `import { valor } from "../${t.targetFiles[0]}";\n` +
        `if (valor !== ${JSON.stringify(etiqueta)}) throw new Error("rojo");\n`);

      if (opts.escrituraRival) {
        // LA CARRERA, PROVOCADA A MANO. La fase sostiene una copia del
        // recorrido leida ANTES de ceder el turno, y escribe con ella despues.
        // Es exactamente la forma del fallo medido: con el camino viejo
        // —mutar la copia y guardarla— la ultima en guardar borra a la otra.
        const viejo = loadRun(fase.item.id, { home: opts.home });
        await cede();
        await cede();
        addTarget(viejo, fase.taskId, `src/compartido-${fase.taskId}.mjs`,
          "el tipo compartido vive aca", { home: opts.home });
        setTaskFields(viejo, fase.taskId, { providerItemId: `hijo-${fase.taskId}` },
          { home: opts.home });
      }
    }

    if (fase.phase === "GREEN") {
      mkdirSync(join(fase.cwd, "src"), { recursive: true });
      writeFileSync(join(fase.cwd, t.targetFiles[0]), `export const valor = ${JSON.stringify(etiqueta)};\n`);
    }

    await cede();
    enVuelo -= 1;
    bitacora.push({ ev: "sale", fase: fase.phase, tarea: fase.taskId, item: fase.item.id });
    return { ok: true, sessionId: `s-${etiqueta}`, budgetExhausted: false, text: "listo" };
  };
}

/** Corre de verdad el archivo de test dentro del worktree de la tarea. */
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

/**
 * Un gate que MIDE lo que ve, y cuyo veredicto depende de eso.
 *
 * Con `exigeAislamiento`, el gate completo de una tarea sale verde si y solo si
 * en `src/` hay exactamente un archivo: el suyo. Es la unica forma honesta de
 * probar el punto 2 — si el aislamiento se rompiera, el veredicto cambiaria, y
 * eso es precisamente lo que significa que el veredicto dependa del aislamiento.
 *
 * El gate RAPIDO —el que corre la cola DESPUES de rebasar— no exige nada: ahi
 * ver el trabajo de las otras tareas es correcto, porque ya esta integrado. La
 * distincion es el contenido del punto 2: lo que no se ve es lo NO integrado.
 */
function gateQueMide(observaciones, { exigeAislamiento = false } = {}) {
  return (repo, cwd, config, o = {}) => {
    const kind = o.kind || "full";
    const archivos = listado(join(cwd, "src"));
    const deQuien = basename(cwd).split("-").pop();
    observaciones.push({ kind, tarea: deQuien, archivos });
    const ok = !exigeAislamiento || kind !== "full" || archivos.length === 1;
    return {
      ok, exitCode: ok ? 0 : 1, command: "gate", durationMs: 1,
      output: ok ? "ok" : `el gate de ${deQuien} vio ${archivos.length} archivos: ${archivos.join(", ")}`,
      timedOut: false, gaps: [],
    };
  };
}

function depsBase(esc, over = {}) {
  return {
    home: esc.home,
    config: {
      repos: { app: { gate: "true", fastGate: "true", baseBranch: "main", env: {},
                      gaps: [], remote: "git@x:o/app.git", runners: { node: "node {file}" } } },
      limits: { maxParallelTasks: 4 },
    },
    runSingleTest: runSingleTestReal,
    runGate: gateQueMide([]),
    createPR: async (run) => ({ url: `http://forge/pr/${run.item.id}`, alreadyExisted: false }),
    resolve: () => ({ repoPath: esc.repo, integrationPath: esc.integracion,
                      itemBranch: esc.itemBranch, baseBranch: "main" }),
    provider: null,
    log: { info() {}, warn() {}, error() {}, child() { return this; } },
    ...over,
  };
}

// =====================================================================
// 1. N tareas concurrentes sobre el MISMO repositorio: nada se pierde
// =====================================================================

test("N tareas concurrentes sobre el mismo repositorio: ningun campo se pierde", async () => {
  const N = 6;
  const ids = Array.from({ length: N }, (_, i) => `T${i + 1}`);
  const esc = escenario(ids.map((id) => tarea(id)));
  const bitacora = [];
  const marca = { maxSimultaneas: 0 };

  const r = await runItem("1", depsBase(esc, {
    // Cada fase escribe con una copia vieja del recorrido, a proposito.
    runPhase: modeloInstrumentado(bitacora, marca, { escrituraRival: true, home: esc.home }),
    config: {
      ...depsBase(esc).config,
      limits: { maxParallelTasks: N },
    },
  }));

  assert.equal(marca.maxSimultaneas, N, `las ${N} tareas tenian que estar en vuelo a la vez`);

  const run = loadRun("1", { home: esc.home });
  assert.equal(run.tasks.length, N);
  assert.deepEqual(run.tasks.map((t) => t.status), ids.map(() => "integrated"));

  // NINGUN CAMPO PERDIDO. El fallo medido dejaba a una tarea sin worktree; la
  // forma general es que la escritura de una tarea desaparezca porque otra
  // guardo una copia vieja encima.
  for (const t of run.tasks) {
    assert.ok(t.worktree, `${t.id} perdio su worktree`);
    assert.ok(t.branch, `${t.id} perdio su rama`);
    assert.equal(t.sessionId, `s-1-${t.id}`, `${t.id} perdio su sesion`);
    assert.equal(t.providerItemId, `hijo-${t.id}`, `${t.id} perdio el campo que escribio con la copia vieja`);
    assert.equal(t.redVerified, true);
    assert.equal(t.gateEvidence?.exitCode, 0, `${t.id} perdio la evidencia de su gate`);
    assert.equal(t.attempts.review, 1, `${t.id} perdio su contador de revision`);
    assert.ok(t.integratedAt, `${t.id} no quedo con la marca de integracion`);
    assert.equal(t.lastFailure, null);
    assert.deepEqual(t.addedTargets, [{ path: `src/compartido-${t.id}.mjs`, why: "el tipo compartido vive aca" }],
      `${t.id} perdio su ampliacion de alcance`);
  }

  // Y cada una en su propio espacio: N worktrees y N ramas distintas.
  assert.equal(new Set(run.tasks.map((t) => t.worktree)).size, N);
  assert.equal(new Set(run.tasks.map((t) => t.branch)).size, N);

  // El resultado del recorrido coincide con el disco: las N integradas, ninguna
  // bloqueada, un solo PR.
  assert.deepEqual(r.integrated.sort(), [...ids].sort());
  assert.deepEqual(r.blocked, []);
  assert.equal(r.pr, "http://forge/pr/1");

  // Y la rama del item recibio las N tareas: 2 commits por tarea, en su orden.
  const log = git(esc.integracion, "log", "--format=%s");
  assert.equal((log.match(/^test\(/gm) || []).length, N, `faltan commits de test: ${log}`);
  assert.equal((log.match(/^feat\(/gm) || []).length, N, `faltan commits de implementacion: ${log}`);
  assert.equal(git(esc.repo, "log", "--oneline", "main").split("\n").length, 1, "main no recibio nada");
});

// =====================================================================
// 2. El control negativo: el mecanismo, medido contra su ausencia
// =====================================================================

test("el camino viejo —guardar una copia vieja— SI pierde la escritura de la otra tarea", () => {
  // Este test no prueba el motor: prueba que las afirmaciones del test anterior
  // no son vacias. Si escribir concurrentemente fuera inofensivo por si solo,
  // `conEstadoFresco` seria complejidad sin un fallo detras — y la constitucion
  // manda borrarla. Aca queda demostrado que el fallo existe.
  const esc = escenario([tarea("T1"), tarea("T2")]);
  const a = loadRun("1", { home: esc.home });
  const b = loadRun("1", { home: esc.home }); // otra referencia, leida antes

  // Camino viejo: mutar la copia propia y guardarla entera.
  a.tasks[0].worktree = "/wt/T1";
  saveRun(a, { home: esc.home });
  b.tasks[1].worktree = "/wt/T2";
  saveRun(b, { home: esc.home });

  const pisado = loadRun("1", { home: esc.home });
  assert.equal(pisado.tasks[1].worktree, "/wt/T2");
  assert.equal(pisado.tasks[0].worktree, null, "asi se perdia el worktree de T1: la ultima en guardar gana");

  // Camino del motor: la mutacion se aplica sobre el estado FRESCO del disco.
  const c = loadRun("1", { home: esc.home });
  const d = loadRun("1", { home: esc.home });
  setTaskFields(c, "T1", { worktree: "/wt/T1" }, { home: esc.home });
  setTaskFields(d, "T2", { worktree: "/wt/T2-bis" }, { home: esc.home });
  const sano = loadRun("1", { home: esc.home });
  assert.equal(sano.tasks[0].worktree, "/wt/T1", "con el camino del motor, la escritura de T1 sobrevive");
  assert.equal(sano.tasks[1].worktree, "/wt/T2-bis");
});

// =====================================================================
// 3. Ninguna tarea observa los cambios sin integrar de otra
// =====================================================================

test("ninguna tarea ve el trabajo sin integrar de otra, y el gate solo mide el suyo", async () => {
  const N = 4;
  const ids = Array.from({ length: N }, (_, i) => `T${i + 1}`);
  const esc = escenario(ids.map((id) => tarea(id)));
  const bitacora = [];
  const marca = { maxSimultaneas: 0 };
  const observaciones = [];

  const r = await runItem("1", depsBase(esc, {
    runPhase: modeloInstrumentado(bitacora, marca),
    // El veredicto del gate DEPENDE del aislamiento: si viera dos archivos en
    // `src/`, saldria rojo y la tarea terminaria bloqueada.
    runGate: gateQueMide(observaciones, { exigeAislamiento: true }),
  }));

  assert.equal(marca.maxSimultaneas, N, "las cuatro corrieron a la vez: es la condicion del test");
  assert.deepEqual(r.integrated.sort(), [...ids].sort(), `alguna tarea vio codigo ajeno: ${r.blocked.join(", ")}`);

  // 3a. Lo que vio cada gate COMPLETO —el de la fase, antes de integrar— es
  // exactamente su propio archivo.
  const completos = observaciones.filter((o) => o.kind === "full");
  assert.equal(completos.length, N, `un gate completo por tarea: ${completos.length}`);
  for (const o of completos) {
    assert.deepEqual(o.archivos, [`${o.tarea}.mjs`],
      `el gate de ${o.tarea} midio codigo que no era suyo: ${o.archivos.join(", ")}`);
  }

  // 3b. Y lo que vio cada fase al entrar: nunca el archivo de otra tarea, y
  // nunca sus commits. Las dos mitades importan: un worktree compartido rompe
  // la primera, y una rama compartida rompe la segunda.
  for (const e of bitacora.filter((x) => x.ev === "entra")) {
    const ajenos = e.ve.filter((f) => f !== `${e.tarea}.mjs`);
    assert.deepEqual(ajenos, [], `la fase ${e.fase} de ${e.tarea} vio ${ajenos.join(", ")}`);
    const commitsAjenos = ids.filter((id) => id !== e.tarea && e.hist.includes(`(${id},`));
    assert.deepEqual(commitsAjenos, [],
      `la fase ${e.fase} de ${e.tarea} tenia en su historial commits de ${commitsAjenos.join(", ")}`);
    if (e.fase === "RED") {
      assert.equal(e.hist, "base", `${e.tarea} arranco sobre algo que no es la rama del item: ${e.hist}`);
    }
  }

  // 3c. El test de cada tarea corrio contra SU modulo: el valor es unico por
  // tarea y su test exige ese valor exacto. Cuatro rojos verificados y cuatro
  // verdes significa cuatro modulos distintos, cada uno en su espacio.
  const run = loadRun("1", { home: esc.home });
  for (const t of run.tasks) assert.equal(t.redVerified, true);

  // 3d. Y LA CONTRACARA, sin la cual 3a no probaria nada: despues de rebasar,
  // la cola SI ve el trabajo ya integrado. El aislamiento es de lo no
  // integrado, no de todo — si las tareas nunca vieran nada, el test anterior
  // pasaria con un repositorio roto.
  const rapidos = observaciones.filter((o) => o.kind === "fast");
  assert.equal(rapidos.length, N, "la cola corre el gate rapido una vez por tarea, despues del rebase");
  assert.equal(Math.max(...rapidos.map((o) => o.archivos.length)), N,
    `la ultima en integrar tenia que ver las ${N}: ${rapidos.map((o) => o.archivos.length).join(",")}`);
});

// =====================================================================
// 4. El paralelismo es observable — y con ancho 1 no existe
// =====================================================================

test("con N tareas independientes y ancho N, las N arrancan antes de que la primera termine", async () => {
  const N = 4;
  const ids = Array.from({ length: N }, (_, i) => `T${i + 1}`);
  const esc = escenario(ids.map((id) => tarea(id)));
  const bitacora = [];
  const marca = { maxSimultaneas: 0 };

  await runItem("1", depsBase(esc, { runPhase: modeloInstrumentado(bitacora, marca) }));

  // La medida directa: cuantas fases habia en vuelo a la vez.
  assert.equal(marca.maxSimultaneas, N, "cuatro tareas, cuatro fases simultaneas");

  // Y la medida observable desde afuera, que es la que importa: las N
  // arrancaron antes de que la primera llegara a su ultima fase. Un
  // `Promise.all` sobre tareas que se esperan entre si daria el mismo estado
  // final; esto es lo unico que distingue el paralelismo real del nominal.
  const secuencia = bitacora.filter((x) => x.ev === "entra").map((x) => `${x.tarea}:${x.fase}`);
  const primerCierre = bitacora.findIndex((x) => x.ev === "entra" && x.fase === "REVIEW");
  assert.ok(primerCierre > 0, `ninguna tarea llego a su ultima fase: ${secuencia.join(" ")}`);
  const arranques = bitacora.slice(0, primerCierre).filter((x) => x.ev === "entra" && x.fase === "RED");
  assert.equal(arranques.length, N,
    `solo ${arranques.length} de ${N} tareas arrancaron antes del primer cierre: ${secuencia.join(" ")}`);
});

test("con ancho 1 no hay dos tareas en vuelo: el ancho es un tope, no una sugerencia", async () => {
  const ids = ["T1", "T2", "T3"];
  const esc = escenario(ids.map((id) => tarea(id)));
  const bitacora = [];
  const marca = { maxSimultaneas: 0 };

  await runItem("1", depsBase(esc, {
    runPhase: modeloInstrumentado(bitacora, marca),
    config: { ...depsBase(esc).config, limits: { maxParallelTasks: 1 } },
  }));

  assert.equal(marca.maxSimultaneas, 1, "con ancho 1 nunca puede haber dos fases a la vez");

  // Y el recorrido queda AGRUPADO por tarea: ninguna tarea vuelve a aparecer
  // despues de que otra empezo. Es lo que hace que este test sea el control del
  // anterior: el mismo instrumento, sobre el mismo motor, tiene que dar lo
  // contrario cuando el ancho es 1.
  const porTarea = bitacora.filter((x) => x.ev === "entra").map((x) => x.tarea);
  const bloques = porTarea.filter((t, i) => t !== porTarea[i - 1]);
  assert.deepEqual(bloques, ids, `las tareas se intercalaron con ancho 1: ${porTarea.join(" ")}`);
  const run = loadRun("1", { home: esc.home });
  assert.deepEqual(run.tasks.map((t) => t.status), ids.map(() => "integrated"));
});

// =====================================================================
// 5. Historias en paralelo, ademas de tareas: los dos niveles juntos
// =====================================================================

/** Un gestor de mentira con dos historias hijas, sin dependencias entre ellas. */
function proveedor(hijos = ["2", "3"]) {
  const items = {
    "1": { id: "1", key: "E-1", title: "el hito", level: "epic", url: "fake://1",
           parentId: null, acceptance: [], canonicalState: "todo", boardFields: null },
  };
  for (const h of hijos) {
    items[h] = { id: h, key: `H-${h}`, title: `la historia ${h}`, level: "story", url: `fake://${h}`,
                 parentId: "1", acceptance: ["algo observable"], canonicalState: "todo", boardFields: null };
  }
  return {
    meta: { name: "gestor-de-mentira", version: "1.0.0" },
    capabilities: () => ({ children: true, dependencies: true, createChild: false, setState: true,
                           comment: true, linkUrl: false, labels: false, searchAssigned: false,
                           searchMentioned: false, boardFields: false }),
    getItem: async (id) => items[id] || null,
    children: async (id) => hijos.map((h) => items[h]).filter((x) => x.parentId === id),
    dependencies: async () => ({ predecessors: [], successors: [] }),
    setState: async (id, estado) => ({ written: estado }),
    comment: async () => ({ id: "c1" }),
  };
}

/** Un repositorio con su rama base, sin ramas de item: las crea el hito. */
function escenarioHito() {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-par-hito-"));
  const repo = join(raiz, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.test");
  git(repo, "config", "user.name", "T");
  writeFileSync(join(repo, "README.md"), "base\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  return { raiz, repo, home: join(raiz, "home") };
}

/**
 * El `resolve` del cableado: cache por (repo, rama) y no por repo, porque un
 * hito resuelve varias ramas del mismo repositorio —la suya y una por historia—
 * y un cache por repo le devolveria la del hito a todas.
 */
function hacerResolve(esc) {
  const cache = new Map();
  return (repo, opts = {}) => {
    assert.ok(opts.itemBranch, "el hito resuelve siempre con la rama explicita");
    assert.ok(opts.baseBranch, "el hito resuelve siempre con la base explicita");
    const clave = `${repo}:${opts.itemBranch}`;
    if (cache.has(clave)) return cache.get(clave);
    const dest = join(esc.home, "worktrees", repo, opts.itemBranch.replace(/[^A-Za-z0-9]+/g, "_"));
    mkdirSync(join(dest, ".."), { recursive: true });
    if (!existsSync(dest)) {
      if (git(esc.repo, "branch", "--list", opts.itemBranch)) {
        git(esc.repo, "worktree", "add", "-q", dest, opts.itemBranch);
      } else {
        git(esc.repo, "worktree", "add", "-q", "-b", opts.itemBranch, dest, opts.baseBranch);
      }
    }
    const r = { repoPath: esc.repo, integrationPath: dest, itemBranch: opts.itemBranch, baseBranch: opts.baseBranch };
    cache.set(clave, r);
    return r;
  };
}

test("el hito corre historias en paralelo y cada historia sus tareas en paralelo", async () => {
  const esc = escenarioHito();
  const bitacora = [];
  const marca = { maxSimultaneas: 0 };

  const r = await correrHito("1", {
    home: esc.home,
    config: {
      repos: { app: { remote: "git@x:o/app.git", baseBranch: "main", gate: "true", fastGate: "true", gaps: [] } },
      // Dos historias a la vez, y dos tareas a la vez dentro de cada una: los
      // dos `Promise.allSettled` anidados, sobre el mismo repositorio de git.
      limits: { maxParallelItems: 2, maxParallelTasks: 2 },
    },
    provider: proveedor(),
    providerCtx: {},
    resolve: hacerResolve(esc),
    log: { info() {}, warn() {}, error() {}, child() { return this; } },
    // La planificacion de la historia deja su recorrido en disco, que es lo que
    // el driver ejecuta despues. Los archivos son unicos POR HISTORIA: dos
    // historias que tocan el mismo archivo son un conflicto al integrar en la
    // rama del hito, y eso es otro test (el de la cola), no este.
    planItem: async (id) => {
      createRun({
        item: { id, key: `H-${id}`, title: `la historia ${id}`, level: "story",
                url: `fake://${id}`, provider: "gestor-de-mentira", acceptance: ["algo observable"] },
        repoScope: ["app"],
        tasks: ["T1", "T2"].map((t) => tarea(t, {
          targetFiles: [`src/h${id}-${t}.mjs`], testFiles: [`test/h${id}-${t}.test.mjs`],
        })),
      }, { home: esc.home });
      return { ok: true, tasks: 2, repos: ["app"] };
    },
    // El driver de verdad, sin modelo: las fases y el gate entran inyectados.
    runItem,
    runPhase: modeloInstrumentado(bitacora, marca),
    runSingleTest: runSingleTestReal,
    runGate: gateQueMide([]),
    createPR: async (run) => ({ url: `http://forge/pr/${run.item.id}`, alreadyExisted: false }),
  });

  assert.equal(r.ok !== false, true, r.reason);

  // CUATRO fases a la vez: dos historias por dos tareas. Con el paralelismo de
  // un solo nivel el maximo seria 2, y con ninguno, 1.
  assert.equal(marca.maxSimultaneas, 4, `el paralelismo no llego a los dos niveles: ${marca.maxSimultaneas}`);

  const m = leerHito("1", { home: esc.home });
  assert.deepEqual(m.items.map((it) => it.status), ["integrated", "integrated"]);

  // Cada tarea de cada historia, en su propio worktree: cuatro espacios.
  const worktrees = ["2", "3"].flatMap((id) => loadRun(id, { home: esc.home }).tasks.map((t) => t.worktree));
  assert.equal(new Set(worktrees).size, 4, "cuatro tareas, cuatro worktrees");
  for (const id of ["2", "3"]) {
    const run = loadRun(id, { home: esc.home });
    assert.deepEqual(run.tasks.map((t) => t.status), ["integrated", "integrated"]);
  }

  // Y ninguna historia vio el trabajo sin integrar de la otra: las fases de la
  // historia 2 nunca vieron un archivo `h3-*`, y al reves.
  for (const e of bitacora.filter((x) => x.ev === "entra")) {
    const ajena = e.item === "2" ? "h3-" : "h2-";
    assert.deepEqual(e.ve.filter((f) => f.startsWith(ajena)), [],
      `la fase ${e.fase} de la historia ${e.item} vio ${e.ve.join(", ")}`);
  }

  // La rama del hito termina con las cuatro implementaciones integradas.
  const { integrationPath } = hacerResolve(esc)("app", { itemBranch: m.branch, baseBranch: m.baseBranch });
  const enHito = listado(join(integrationPath, "src"));
  assert.deepEqual(enHito, ["h2-T1.mjs", "h2-T2.mjs", "h3-T1.mjs", "h3-T2.mjs"]);
  assert.equal(git(esc.repo, "log", "--oneline", "main").split("\n").length, 1, "main no recibio nada");
});

// =====================================================================
// 6. SC-002: el tiempo total se aproxima al de la mas lenta
// =====================================================================

/**
 * UN RELOJ DE MENTIRA, y por que no se miden relojes de pared.
 *
 * SC-002 es una afirmacion sobre tiempo: un hito de tres historias
 * independientes termina en un tiempo cercano al de la mas lenta, y nunca por
 * encima del 60% de la suma. Medirlo con esperas reales lo vuelve intermitente
 * —una maquina cargada, un `git` que tarda, un runner compartido— y un test
 * intermitente es peor que ninguno: enseña a ignorar el rojo.
 *
 * Asi que el tiempo se simula. Cada historia declara su duracion, y en vez de
 * dormir se PARA en este reloj. El reloj avanza SOLO cuando todas las corridas
 * en vuelo estan paradas en el: mientras alguna siga progresando por su cuenta,
 * mover el reloj le adelantaria el arranque de su fase siguiente y el makespan
 * medido seria una casualidad del orden de las promesas.
 *
 * Lo que se mide entonces es real: el solapamiento lo produce el motor —el
 * ancho del hito y su `Promise.allSettled`—, no el reloj. Con ancho 1 el mismo
 * instrumento tiene que dar la suma, y ese es el control que hace que el
 * numero signifique algo.
 */
function relojDeMentira() {
  let ahora = 0;
  let enVuelo = 0;
  let parados = [];
  let bombeando = false;
  let turnos = 0;

  function bombear() {
    bombeando = true;
    setImmediate(() => {
      // Tope de seguridad: si algo no avanza, el test falla por sus
      // afirmaciones en vez de colgarse para siempre.
      if (++turnos > 50000) {
        const todos = parados; parados = [];
        for (const p of todos) p.resolve();
        bombeando = false;
        return;
      }
      if (parados.length > 0 && parados.length === enVuelo) {
        ahora = Math.min(...parados.map((p) => p.at));
        const listos = parados.filter((p) => p.at <= ahora);
        parados = parados.filter((p) => p.at > ahora);
        for (const p of listos) p.resolve();
      }
      if (parados.length > 0 || enVuelo > 0) bombear();
      else bombeando = false;
    });
  }

  return {
    get ahora() { return ahora; },
    entrar() { enVuelo += 1; if (!bombeando) bombear(); },
    salir() { enVuelo -= 1; },
    esperar(ms) {
      return new Promise((resolve) => {
        parados.push({ at: ahora + ms, resolve });
        if (!bombeando) bombear();
      });
    },
  };
}

/** Una corrida de historia que solo consume tiempo (simulado) y commitea. */
function runItemCronometrado(reloj, duraciones, intervalos) {
  return async (id, d) => {
    const { integrationPath } = d.resolve("app");
    const inicio = reloj.ahora;
    reloj.entrar();
    await reloj.esperar(duraciones[id]);
    reloj.salir();
    intervalos.push({ id, inicio, fin: reloj.ahora });
    writeFileSync(join(integrationPath, `${id}.txt`), `historia ${id}\n`);
    git(integrationPath, "add", "-A");
    git(integrationPath, "commit", "-q", "-m", `feat(app): la historia ${id}`);
    return { item: id, pr: `http://forge/pr/${id}`, integrated: ["T1"], blocked: [] };
  };
}

async function correrConAncho(ancho, duraciones) {
  const esc = escenarioHito();
  const reloj = relojDeMentira();
  const intervalos = [];
  const r = await correrHito("1", {
    home: esc.home,
    config: {
      repos: { app: { remote: "git@x:o/app.git", baseBranch: "main", gate: "true" } },
      limits: { maxParallelItems: ancho },
    },
    provider: proveedor(Object.keys(duraciones)),
    providerCtx: {},
    resolve: hacerResolve(esc),
    log: { info() {}, warn() {}, error() {}, child() { return this; } },
    planItem: async () => ({ ok: true, tasks: 1, repos: ["app"] }),
    runItem: runItemCronometrado(reloj, duraciones, intervalos),
  });
  assert.equal(r.ok !== false, true, r.reason);
  assert.deepEqual(leerHito("1", { home: esc.home }).items.map((it) => it.status),
    Object.keys(duraciones).map(() => "integrated"));
  return { intervalos, makespan: Math.max(...intervalos.map((i) => i.fin)) };
}

test("el tiempo total se aproxima al de la historia mas lenta, no a la suma (SC-002)", async () => {
  // Tres historias independientes, con duraciones bien distintas para que
  // "cercano a la mas lenta" y "cercano a la suma" no se puedan confundir.
  const duraciones = { 2: 100, 3: 60, 4: 30 };
  const suma = 190;
  const masLenta = 100;

  const paralelo = await correrConAncho(3, duraciones);
  const serie = await correrConAncho(1, duraciones);

  // El numero de SC-002, tal como esta escrito en el criterio.
  assert.equal(paralelo.makespan, masLenta, "el hito paralelo tiene que terminar con la historia mas lenta");
  assert.ok(paralelo.makespan <= 0.6 * serie.makespan,
    `${paralelo.makespan} no esta por debajo del 60% de ${serie.makespan}`);

  // El control que hace que el numero signifique algo: el MISMO instrumento,
  // sobre el MISMO motor, con ancho 1, da la suma.
  assert.equal(serie.makespan, suma, "con ancho 1 el tiempo es la suma de las tres");

  // Y la forma del solapamiento, no solo el total: en paralelo las tres
  // arrancan juntas; en serie, cada una donde termino la anterior.
  assert.deepEqual(paralelo.intervalos.map((i) => i.inicio), [0, 0, 0]);
  const enSerie = serie.intervalos.sort((a, b) => a.inicio - b.inicio);
  for (let i = 1; i < enSerie.length; i++) {
    assert.equal(enSerie[i].inicio, enSerie[i - 1].fin,
      `las historias en serie no se encadenaron: ${JSON.stringify(enSerie)}`);
  }
});
