// Retomar un recorrido interrumpido.
//
// UN RECORRIDO LARGO SE INTERRUMPE: es un hecho, no una excepcion. Sin esto,
// cada interrupcion cuesta el hito entero. Lo que estos tests fijan es el
// precio: una interrupcion cuesta UN COMANDO, y ese comando no repite trabajo
// terminado, no devuelve presupuesto consumido y no pisa lo que quedo a medias.
//
// El caso que manda es el ultimo (SC-010): el resultado de un recorrido matado
// y retomado se compara contra una corrida LIMPIA DEL MISMO PLAN, no contra una
// expectativa escrita a mano. Una expectativa a mano se escribe mirando el
// codigo, y entonces prueba el codigo contra si mismo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, renameSync,
  symlinkSync, lstatSync, readdirSync, rmSync,
} from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRun, loadRun, saveRun, transition, setActiveTask, listActiveTasks } from "../src/state.mjs";
import { inspect } from "../src/lock.mjs";
import * as wt from "../src/worktree.mjs";
import { runItem } from "../src/driver.mjs";
import { diagnosticar, prepararReanudacion } from "../src/recovery.mjs";

const git = (cwd, ...a) =>
  execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const RUTA_DRIVER = fileURLToPath(new URL("../src/driver.mjs", import.meta.url));

const tarea = (id, over = {}) => ({
  id, repo: "app", title: `tarea ${id}`, acceptance: `criterio de ${id}`,
  targetFiles: [`src/${id}.mjs`], testFiles: [`test/${id}.test.mjs`],
  tier: "small", dependsOn: [], dependencyKind: "hard", ...over,
});

const CONFIG = {
  repos: { app: { gate: "true", fastGate: "true", baseBranch: "main", env: {},
                  gaps: ["sin e2e"], remote: "git@x:o/app.git", runners: { node: "node {file}" } } },
};

/** Un repositorio de verdad, con la rama del item y su worktree de integracion. */
function escenario(tasks = [tarea("T1")]) {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-res-"));
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
  createRun({
    item: { id: "1", key: "H-1", title: "la historia", level: "story", url: "http://g/1",
            provider: "fake", acceptance: ["el sistema hace lo que promete"] },
    repoScope: ["app"],
    tasks,
  }, { home });

  return { raiz, repo, integracion, itemBranch, home, wtDe: (t) => join(home, "worktrees", "app", `1-${t}`) };
}

/** El mismo modelo de mentira que usa el test del driver: escribe el test en
 * RED y la implementacion en GREEN. Prueba la orquestacion sin gastar modelo. */
function modeloQueCumple(registro, { arreglaGreen = true } = {}) {
  return async (opts) => {
    registro.push({ fase: opts.phase, tarea: opts.taskId });
    const t = opts.task;
    if (opts.phase === "RED") {
      mkdirSync(join(opts.cwd, "test"), { recursive: true });
      writeFileSync(join(opts.cwd, t.testFiles[0]),
        `import { valor } from "../${t.targetFiles[0]}";\nif (valor !== 42) throw new Error("rojo");\n`);
    }
    if (opts.phase === "GREEN" && arreglaGreen) {
      mkdirSync(join(opts.cwd, "src"), { recursive: true });
      writeFileSync(join(opts.cwd, t.targetFiles[0]), "export const valor = 42;\n");
    }
    return { ok: true, sessionId: `s-${t.id}`, budgetExhausted: false, text: "listo" };
  };
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

function depsBase(esc, registro, over = {}) {
  return {
    config: CONFIG,
    home: esc.home,
    runPhase: modeloQueCumple(registro),
    runSingleTest: runSingleTestReal,
    runGate: () => ({ ok: true, exitCode: 0, command: "true", durationMs: 10, output: "ok", timedOut: false, gaps: ["sin e2e"] }),
    createPR: async () => ({ url: "http://forge/pr/1", alreadyExisted: false, body: "cuerpo" }),
    resolve: () => ({ repoPath: esc.repo, integrationPath: esc.integracion,
                      itemBranch: esc.itemBranch, baseBranch: "main" }),
    provider: null,
    maxParallelTasks: 1,
    log: { info() {}, warn() {}, error() {}, child() { return this; } },
    ...over,
  };
}

/**
 * El resultado final observable de un recorrido, normalizado.
 *
 * Lo que se compara son HECHOS: en que estado quedo cada tarea, que intentos
 * consumio, que commits entraron a la rama del item y en que orden, y que PR
 * salio. Nada de rutas ni de horas, que cambian entre corridas sin que cambie
 * el resultado.
 */
function resultadoFinal(esc) {
  const run = loadRun("1", { home: esc.home });
  return {
    tareas: run.tasks.map((t) => ({
      id: t.id, status: t.status, redVerified: t.redVerified, attempts: t.attempts,
    })),
    pr: run.item.pr,
    commits: git(esc.integracion, "log", "--format=%s", "--reverse").split("\n").filter(Boolean),
    archivos: git(esc.integracion, "ls-files").split("\n").filter(Boolean).sort(),
  };
}

const escribirEstado = (home, mutador) => {
  const f = join(home, "runs", "run-1.json");
  const run = JSON.parse(readFileSync(f, "utf8"));
  mutador(run);
  writeFileSync(f, JSON.stringify(run, null, 2) + "\n");
  return run;
};

const huella = (home) =>
  readdirSync(join(home, "runs")).map((f) => `${f}:${readFileSync(join(home, "runs", f), "utf8")}`).join("\n");

// ------------------------- 1. no repite trabajo terminado, ni duplica commits

test("una tarea integrada no se vuelve a correr, y su commit no se duplica", async () => {
  const esc = escenario([tarea("T1"), tarea("T2", { dependsOn: ["T1"] })]);

  // T1 ya entro a la rama del item, con sus dos commits: el del test y el de la
  // implementacion. Es el estado que deja un corte despues de una integracion.
  mkdirSync(join(esc.integracion, "test"), { recursive: true });
  mkdirSync(join(esc.integracion, "src"), { recursive: true });
  writeFileSync(join(esc.integracion, "test", "T1.test.mjs"), "// el test de T1\n");
  git(esc.integracion, "add", "-A");
  git(esc.integracion, "commit", "-q", "-m", "test(app): tarea T1 (T1, H-1)");
  writeFileSync(join(esc.integracion, "src", "T1.mjs"), "export const valor = 42;\n");
  git(esc.integracion, "add", "-A");
  git(esc.integracion, "commit", "-q", "-m", "feat(app): tarea T1 (T1, H-1)");
  escribirEstado(esc.home, (r) => {
    const t1 = r.tasks.find((t) => t.id === "T1");
    t1.status = "integrated";
    t1.redVerified = true;
    t1.attempts = { red: 1, green: 1, gate: 1, review: 1 };
    t1.worktree = esc.wtDe("T1");
    t1.branch = "task/1-T1";
    t1.integratedAt = new Date().toISOString();
    t1.gateEvidence = { command: "true", exitCode: 0, durationMs: 1, output: "", ranAt: new Date().toISOString() };
  });

  const prep = prepararReanudacion("1", { home: esc.home, config: CONFIG });
  assert.equal(prep.ok, true);
  assert.deepEqual(prep.yaTerminadas, ["T1"]);

  const registro = [];
  const r = await runItem("1", depsBase(esc, registro));

  assert.deepEqual(registro.filter((x) => x.tarea === "T1"), [], "no se le pidio ni una fase a la tarea terminada");
  assert.deepEqual(r.integrated.sort(), ["T1", "T2"]);
  const commits = git(esc.integracion, "log", "--format=%s").split("\n");
  assert.equal(commits.filter((c) => c === "test(app): tarea T1 (T1, H-1)").length, 1, `commit duplicado: ${commits.join(" | ")}`);
  assert.equal(commits.filter((c) => c === "feat(app): tarea T1 (T1, H-1)").length, 1);
  const t1 = loadRun("1", { home: esc.home }).tasks.find((t) => t.id === "T1");
  assert.deepEqual(t1.attempts, { red: 1, green: 1, gate: 1, review: 1 }, "ni un intento mas: no se toco");
});

// ------------------------------- 2. no devuelve presupuesto ya consumido

test("una tarea que gasto sus intentos de GREEN los conserva al retomar", async () => {
  const esc = escenario([tarea("T1")]);
  const dest = esc.wtDe("T1");
  wt.add(esc.repo, { branch: "task/1-T1", base: esc.itemBranch, dest, fetch: false });
  mkdirSync(join(dest, "test"), { recursive: true });
  writeFileSync(join(dest, "test/T1.test.mjs"),
    'import { valor } from "../src/T1.mjs";\nif (valor !== 42) throw new Error("rojo");\n');
  git(dest, "add", "-A");
  git(dest, "commit", "-q", "-m", "test(app): tarea T1 (T1, H-1)");
  escribirEstado(esc.home, (r) => {
    const t = r.tasks[0];
    t.status = "red";
    t.redVerified = true;
    t.worktree = dest;
    t.branch = "task/1-T1";
    // Dos intentos de GREEN ya gastados. El presupuesto por defecto es 3.
    t.attempts = { red: 1, green: 2, gate: 0, review: 0 };
  });

  const prep = prepararReanudacion("1", { home: esc.home, config: CONFIG });
  assert.equal(prep.ok, true);
  assert.deepEqual(loadRun("1", { home: esc.home }).tasks[0].attempts, { red: 1, green: 2, gate: 0, review: 0 },
    "preparar la reanudacion no toca un solo contador");

  const registro = [];
  // Un modelo que NO arregla nada: el test sigue en rojo.
  await runItem("1", depsBase(esc, registro, { runPhase: modeloQueCumple(registro, { arreglaGreen: false }) }));

  const t = loadRun("1", { home: esc.home }).tasks[0];
  assert.equal(t.attempts.green, 3, "el tercer intento agoto el presupuesto: no se regalaron tres nuevos");
  assert.equal(t.status, "blocked");
  assert.equal(registro.filter((x) => x.fase === "GREEN").length, 1, "un solo intento, el que quedaba");
});

// ---------- 3. una tarea a medias con su worktree sucio EXIGE una decision

/** Deja un recorrido con T1 a medias y su worktree sucio. */
function aMedias(esc, { status = "in_progress", attempts = { red: 1, green: 0, gate: 0, review: 0 } } = {}) {
  const dest = esc.wtDe("T1");
  wt.add(esc.repo, { branch: "task/1-T1", base: esc.itemBranch, dest, fetch: false });
  mkdirSync(join(dest, "test"), { recursive: true });
  writeFileSync(join(dest, "test/T1.test.mjs"), "// a medio escribir\n");
  escribirEstado(esc.home, (r) => {
    const t = r.tasks[0];
    t.status = status;
    t.redVerified = status !== "in_progress";
    t.worktree = dest;
    t.branch = "task/1-T1";
    t.attempts = attempts;
    if (status === "gated") {
      t.gateEvidence = { command: "true", exitCode: 0, durationMs: 1, output: "", ranAt: new Date().toISOString() };
    }
  });
  return dest;
}

test("sin decision no avanza: la reanudacion se niega y no escribe nada", () => {
  const esc = escenario();
  const dest = aMedias(esc);
  const antes = huella(esc.home);

  const prep = prepararReanudacion("1", { home: esc.home, config: CONFIG });

  assert.equal(prep.ok, false);
  assert.deepEqual(prep.requiereDecision.map((x) => x.task), ["T1"]);
  assert.deepEqual([...prep.requiereDecision[0].opciones].sort(), ["bloquear", "completar", "registrar"]);
  assert.equal(huella(esc.home), antes, "una reanudacion que no puede seguir no deja rastro");
  assert.equal(readFileSync(join(dest, "test/T1.test.mjs"), "utf8"), "// a medio escribir\n",
    "y sobre todo: no pisa el worktree");
});

test("decision `completar`: la tarea vuelve al bucle con su worktree y sus intentos, y el driver la termina", async () => {
  const esc = escenario();
  const dest = aMedias(esc);

  const prep = prepararReanudacion("1", { home: esc.home, config: CONFIG, decisiones: { T1: "completar" } });
  assert.equal(prep.ok, true);
  assert.deepEqual(prep.aplicadas.map((a) => [a.task, a.decision]), [["T1", "completar"]]);

  const enDisco = loadRun("1", { home: esc.home }).tasks[0];
  // El unico estado desde el que el driver lanza una tarea es `pending`, y el
  // unico camino hacia atras que la maquina de estados admite pasa por
  // `blocked` con su causa. `pending` no significa desde cero: el worktree y
  // los contadores siguen donde estaban.
  assert.equal(enDisco.status, "pending");
  assert.equal(enDisco.worktree, dest);
  assert.equal(enDisco.attempts.red, 1, "el rebobinado no devuelve presupuesto");
  assert.equal(enDisco.lastFailure, null, "el desvio por blocked no deja un fallo pendiente inventado");
  assert.deepEqual(prep.relanzadas.map((r) => [r.task, r.de, r.a]), [["T1", "in_progress", "pending"]]);
  assert.equal(loadRun("1", { home: esc.home }).recovery.decisiones.length, 1, "y la decision queda registrada");
  assert.equal(existsSync(join(dest, "test/T1.test.mjs")), true, "sin pisar lo que habia");

  const registro = [];
  await runItem("1", depsBase(esc, registro));
  assert.equal(loadRun("1", { home: esc.home }).tasks[0].status, "integrated");
});

test("decision `registrar`: la nota queda en el recorrido y el worktree no se toca", () => {
  const esc = escenario();
  const dest = aMedias(esc);

  const prep = prepararReanudacion("1", {
    home: esc.home, config: CONFIG,
    decisiones: { T1: { accion: "registrar", nota: "quedo a medias por un corte de luz; el test estaba sin terminar" } },
  });

  assert.equal(prep.ok, true);
  const run = loadRun("1", { home: esc.home });
  assert.equal(run.tasks[0].status, "pending", "sigue en el bucle");
  assert.deepEqual(run.tasks[0].attempts, { red: 1, green: 0, gate: 0, review: 0 });
  const entrada = run.recovery.decisiones.at(-1);
  assert.equal(entrada.decision, "registrar");
  assert.match(entrada.nota, /corte de luz/);
  assert.ok(entrada.cambios.some((c) => c.path === "test/T1.test.mjs"), "queda constancia de que habia sin commitear");
  assert.equal(readFileSync(join(dest, "test/T1.test.mjs"), "utf8"), "// a medio escribir\n");
});

test("decision `registrar` sobre una tarea ya con gate verde la devuelve a green con la nota pendiente", () => {
  const esc = escenario();
  aMedias(esc, { status: "gated", attempts: { red: 1, green: 1, gate: 1, review: 0 } });

  const prep = prepararReanudacion("1", {
    home: esc.home, config: CONFIG,
    decisiones: { T1: { accion: "registrar", nota: "quedaron cambios fuera del commit del gate" } },
  });

  // Y no se rebobina a `pending`: el driver re-verifica el rojo al pasar por
  // `in_progress`, y un test que ya tiene su implementacion al lado pasa. El
  // rebobinado gastaria el presupuesto de RED contra un rojo imposible.
  assert.deepEqual(prep.relanzadas, []);
  assert.deepEqual(prep.sinRelanzar.map((x) => x.task), ["T1"]);
  assert.match(prep.sinRelanzar[0].motivo, /rojo/i);

  const t = loadRun("1", { home: esc.home }).tasks[0];
  // El gate midio un arbol que ya no es el que hay. Conservar ese verde seria
  // arrastrar evidencia de otro codigo — el mismo motivo por el que un hallazgo
  // del revisor tira la evidencia del gate.
  assert.equal(t.status, "green");
  assert.equal(t.gateEvidence, null);
  assert.match(t.lastFailure, /fuera del commit del gate/);
  assert.deepEqual(t.attempts, { red: 1, green: 1, gate: 1, review: 0 }, "y sin regalar presupuesto");
});

test("decision `bloquear`: queda bloqueada con la causa, y el recorrido sigue con las demas", async () => {
  const esc = escenario([tarea("T1"), tarea("T2")]);
  aMedias(esc);

  const prep = prepararReanudacion("1", {
    home: esc.home, config: CONFIG,
    decisiones: { T1: { accion: "bloquear", nota: "el criterio no es verificable como esta escrito" } },
  });
  assert.equal(prep.ok, true);

  const t1 = loadRun("1", { home: esc.home }).tasks[0];
  assert.equal(t1.status, "blocked");
  assert.match(t1.lastFailure, /no es verificable/);

  const registro = [];
  const r = await runItem("1", depsBase(esc, registro));
  assert.deepEqual(r.blocked, ["T1"]);
  assert.deepEqual(r.integrated, ["T2"], "una bloqueada no detiene el recorrido");
});

test("una tarea cuyo worktree desaparecio solo admite bloquear, y suelta la ruta que ya no existe", () => {
  const esc = escenario();
  escribirEstado(esc.home, (r) => {
    const t = r.tasks[0];
    t.status = "in_progress";
    t.worktree = esc.wtDe("T1"); // el directorio no esta: alguien lo borro
    t.branch = "task/1-T1";
    t.attempts = { red: 1, green: 0, gate: 0, review: 0 };
  });

  const d = diagnosticar("1", { home: esc.home, config: CONFIG, repoPaths: { app: esc.repo } });
  assert.deepEqual(d.decisionesPendientes[0].opciones, ["bloquear"], "no hay nada que completar ni que registrar");

  prepararReanudacion("1", {
    home: esc.home, config: CONFIG,
    decisiones: { T1: { accion: "bloquear", nota: "alguien borro el worktree a mano" } },
  });

  const t = loadRun("1", { home: esc.home }).tasks[0];
  assert.equal(t.status, "blocked");
  // El puntero a una ruta que no existe es lo que haria correr una fase con
  // `cwd` en un directorio inexistente. Soltarlo no pierde nada —el directorio
  // ya no esta— y permite que, al destrabarla, el driver cree el espacio de
  // trabajo de nuevo.
  assert.equal(t.worktree, null);
  assert.equal(t.branch, null);
  assert.equal(t.attempts.red, 1, "y los intentos siguen contados");
});

test("`registrar` y `bloquear` exigen decir por que; una decision inventada se rechaza", () => {
  const esc = escenario();
  aMedias(esc);
  const antes = huella(esc.home);

  for (const d of [{ accion: "registrar" }, { accion: "bloquear", nota: "  " }]) {
    assert.throws(
      () => prepararReanudacion("1", { home: esc.home, config: CONFIG, decisiones: { T1: d } }),
      /nota|causa|por que/i,
    );
  }
  assert.throws(
    () => prepararReanudacion("1", { home: esc.home, config: CONFIG, decisiones: { T1: "pisala" } }),
    /pisala|completar/,
  );
  assert.throws(
    () => prepararReanudacion("1", { home: esc.home, config: CONFIG, decisiones: { T9: "completar" } }),
    /T9/,
  );
  assert.equal(huella(esc.home), antes, "ninguna decision mal formada escribio nada");
});

test("la reanudacion repone el puntero de tarea activa de la tarea en vuelo, y borra el de la terminada", () => {
  const esc = escenario([tarea("T1"), tarea("T2")]);
  // T1 quedo esperando su turno en la cola de integracion: es una tarea que
  // sigue en vuelo y a la que el driver NO vuelve a abrir —la toma la cola—,
  // asi que su puntero no lo repone nadie mas.
  const dest = esc.wtDe("T1");
  wt.add(esc.repo, { branch: "task/1-T1", base: esc.itemBranch, dest, fetch: false });
  escribirEstado(esc.home, (r) => {
    const t1 = r.tasks.find((t) => t.id === "T1");
    t1.status = "queued";
    t1.redVerified = true;
    t1.worktree = dest;
    t1.branch = "task/1-T1";
    t1.attempts = { red: 1, green: 1, gate: 1, review: 1 };
    t1.gateEvidence = { command: "true", exitCode: 0, durationMs: 1, output: "", ranAt: new Date().toISOString() };
    const t2 = r.tasks.find((t) => t.id === "T2");
    t2.status = "integrated";
    t2.redVerified = true;
    t2.worktree = esc.wtDe("T2");
    t2.branch = "task/1-T2";
    t2.attempts = { red: 1, green: 1, gate: 1, review: 1 };
  });
  // Lo que deja un proceso matado: el puntero de una tarea que ya termino,
  // apuntando a trabajo que no existe mas.
  setActiveTask("1", "T2", { home: esc.home, worktree: esc.wtDe("T2") });

  const prep = prepararReanudacion("1", { home: esc.home, config: CONFIG });
  assert.equal(prep.ok, true);

  const punteros = listActiveTasks({ home: esc.home });
  assert.deepEqual(punteros.map((p) => p.taskId), ["T1"]);
  // EL FALLO QUE EVITA: el puntero es lo unico contra lo que resuelven los
  // hooks de orden y de alcance. Una tarea retomada en `in_progress` nunca
  // vuelve a pasar por `abrirTarea`, asi que si nadie repone su puntero, sus
  // fases corren sin guardas — y el guardian de TDD se aparta justo en la
  // vuelta donde el modelo ya tiene medio archivo escrito.
  assert.equal(punteros[0].worktree, dest);
  assert.ok(punteros[0].allowedCommands.includes("true"), "y con la lista de comandos del repo, que el hook no puede leer");
  assert.deepEqual(prep.punteros.repuestos.map((p) => p.taskId), ["T1"]);
  assert.deepEqual(prep.punteros.limpiados.map((p) => p.taskId), ["T2"]);
});

// ------------------- 4. un corte a mitad de una escritura de estado

test("state.mjs escribe con temporal + rename: el archivo anterior nunca se trunca", () => {
  const esc = escenario();
  const f = join(esc.home, "runs", "run-1.json");
  const anterior = join(esc.home, "runs", "anterior.json");

  // La prueba del mecanismo, no de su intencion: se deja el archivo del
  // recorrido como un enlace simbolico. Un `writeFileSync` sobre la ruta
  // seguiria el enlace y escribiria SOBRE el destino —truncandolo primero, que
  // es la ventana donde un corte deja el estado a medias—. Un temporal +
  // rename reemplaza el enlace y deja el destino intacto.
  renameSync(f, anterior);
  symlinkSync(anterior, f);
  const contenidoAnterior = readFileSync(anterior, "utf8");

  const run = loadRun("1", { home: esc.home });
  run.item.branch = "feature/1-historia";
  saveRun(run, { home: esc.home });

  assert.equal(lstatSync(f).isSymbolicLink(), false, "el rename reemplazo la entrada, no escribio a traves de ella");
  assert.equal(readFileSync(anterior, "utf8"), contenidoAnterior, "el estado anterior quedo completo");
  assert.equal(loadRun("1", { home: esc.home }).item.branch, "feature/1-historia", "y el nuevo se lee entero");
});

test("un temporal que quedo de una escritura cortada no confunde la lectura, y el diagnostico lo delata", () => {
  const esc = escenario();
  transition(loadRun("1", { home: esc.home }), "T1", "in_progress", { home: esc.home });
  // Lo que deja un corte a mitad del `writeFileSync` del temporal.
  writeFileSync(join(esc.home, "runs", "run-1.json.tmp-4242"), '{"schemaVersion": 1, "tasks": [{"id": "T');

  const run = loadRun("1", { home: esc.home });
  assert.equal(run.tasks[0].status, "in_progress", "el estado anterior se lee completo");

  const d = diagnosticar("1", { home: esc.home, config: CONFIG });
  assert.equal(d.corrupto, false);
  assert.deepEqual(d.escriturasInterrumpidas, ["run-1.json.tmp-4242"]);
});

test("un recorrido corrupto se reporta y detiene la reanudacion: nadie replanifica encima", () => {
  const esc = escenario();
  writeFileSync(join(esc.home, "runs", "run-1.json"), '{"schemaVersion": 1, "tasks": [{"id": "T');
  const antes = huella(esc.home);

  const d = diagnosticar("1", { home: esc.home, config: CONFIG });
  assert.equal(d.corrupto, true);

  const prep = prepararReanudacion("1", { home: esc.home, config: CONFIG });
  assert.equal(prep.ok, false);
  assert.match(prep.motivo, /corrupto/i);
  assert.equal(huella(esc.home), antes, "y no lo sobreescribe con un recorrido nuevo");
});

// ------------------------------------------- 7. el mismo resultado final (SC-010)

/**
 * Corre el driver en un proceso aparte y lo mata de verdad.
 *
 * No hay forma honesta de simular esto en proceso: lo que se quiere probar es
 * que el estado en disco alcanza, y un `throw` a mitad de una funcion deja
 * intacto todo lo que vive en memoria del mismo proceso. `SIGKILL` no le da a
 * nadie la oportunidad de ordenar la salida — que es exactamente el corte de
 * luz del escenario 7 del quickstart.
 */
async function matarAMitad(esc, marcador) {
  const guion = join(esc.raiz, "corrida.mjs");
  writeFileSync(guion, `
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const [driver, home, repo, integracion, itemBranch, marcador] = process.argv.slice(2);
const { runItem } = await import(driver);

const runSingleTest = (r, cwd, file) => {
  try {
    execFileSync("node", ["--input-type=module", "-e", \`await import("file://\${join(cwd, file)}")\`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, exitCode: 0, command: "node " + file, durationMs: 5, output: "", timedOut: false, gaps: [] };
  } catch (e) {
    return { ok: false, exitCode: 1, command: "node " + file, durationMs: 5,
             output: String(e.stdout || "") + String(e.stderr || ""), timedOut: false, gaps: [] };
  }
};

await runItem("1", {
  config: ${JSON.stringify(CONFIG)},
  home,
  runSingleTest,
  runGate: () => ({ ok: true, exitCode: 0, command: "true", durationMs: 10, output: "ok", timedOut: false, gaps: ["sin e2e"] }),
  createPR: async () => ({ url: "http://forge/pr/1", alreadyExisted: false, body: "cuerpo" }),
  resolve: () => ({ repoPath: repo, integrationPath: integracion, itemBranch, baseBranch: "main" }),
  provider: null,
  maxParallelTasks: 1,
  runPhase: async (opts) => {
    const t = opts.task;
    if (opts.phase === "RED") {
      mkdirSync(join(opts.cwd, "test"), { recursive: true });
      writeFileSync(join(opts.cwd, t.testFiles[0]),
        'import { valor } from "../' + t.targetFiles[0] + '";\\nif (valor !== 42) throw new Error("rojo");\\n');
      if (t.id === "T2") {
        // El corte cae ACA: el test de T2 escrito y sin commitear, la tarea en
        // vuelo, y nadie va a cerrar la puerta al salir.
        //
        // El temporizador no es decorativo: sin ningun handle pendiente, node
        // ve el bucle de eventos vacio y TERMINA el proceso —aunque haya una
        // promesa sin resolver—, asi que la corrida se moria sola antes de que
        // llegara la senial y el test quedaba esperando a un proceso que ya no
        // estaba. Con el temporizador, el unico final posible es el SIGKILL.
        writeFileSync(marcador, "ahora");
        await new Promise(() => { setInterval(() => {}, 1000); });
      }
    }
    if (opts.phase === "GREEN") {
      mkdirSync(join(opts.cwd, "src"), { recursive: true });
      writeFileSync(join(opts.cwd, t.targetFiles[0]), "export const valor = 42;\\n");
    }
    return { ok: true, sessionId: "s-" + t.id, budgetExhausted: false, text: "listo" };
  },
});
`);

  const hijo = spawn(process.execPath, [guion, RUTA_DRIVER, esc.home, esc.repo, esc.integracion, esc.itemBranch, marcador],
    { stdio: ["ignore", "pipe", "pipe"] });
  let salida = "";
  hijo.stdout.on("data", (d) => { salida += d; });
  hijo.stderr.on("data", (d) => { salida += d; });

  const termino = () => hijo.exitCode !== null || hijo.signalCode !== null;
  const limite = Date.now() + 60000;
  while (!existsSync(marcador)) {
    if (termino()) throw new Error(`la corrida termino antes de llegar al corte:\n${salida}`);
    if (Date.now() > limite) {
      hijo.kill("SIGKILL");
      throw new Error(`la corrida no llego al corte en 60s:\n${salida}`);
    }
    await new Promise((r) => setTimeout(r, 40));
  }

  // El listener se registra mirando primero si ya termino: entre la ultima
  // vuelta del bucle y el `kill` hay una ventana, y esperar un evento que ya
  // paso es una espera para siempre.
  const muerto = new Promise((r) => (termino() ? r() : hijo.on("exit", r)));
  hijo.kill("SIGKILL");
  await muerto;
  return { pid: hijo.pid, signal: hijo.signalCode, salida };
}

test("un recorrido matado a mitad y retomado termina en el MISMO resultado que uno sin interrupcion", async () => {
  const tareas = () => [
    tarea("T1"),
    tarea("T2", { dependsOn: ["T1"] }),
    tarea("T3", { dependsOn: ["T2"] }),
  ];

  // ---- la corrida limpia, el patron de comparacion
  const limpio = escenario(tareas());
  await runItem("1", depsBase(limpio, []));
  const esperado = resultadoFinal(limpio);
  assert.deepEqual(esperado.tareas.map((t) => t.status), ["integrated", "integrated", "integrated"]);

  // ---- la misma cosa, cortada por la mitad
  const cortado = escenario(tareas());
  const { pid, signal } = await matarAMitad(cortado, join(cortado.raiz, "llego-al-corte"));
  assert.equal(signal, "SIGKILL", "el corte tiene que ser una senial, no una salida ordenada");

  const enElCorte = loadRun("1", { home: cortado.home });
  assert.equal(enElCorte.tasks.find((t) => t.id === "T1").status, "integrated", "T1 alcanzo a integrarse");
  assert.equal(enElCorte.tasks.find((t) => t.id === "T2").status, "in_progress");
  assert.equal(enElCorte.tasks.find((t) => t.id === "T3").status, "pending");

  const d = diagnosticar("1", { home: cortado.home, config: CONFIG, repoPaths: { app: cortado.repo } });
  assert.deepEqual(d.integradas, ["T1"]);
  assert.deepEqual(d.enVuelo.map((t) => t.task), ["T2"]);
  assert.equal(d.enVuelo[0].sucio, true, "el test de T2 quedo escrito y sin commitear");
  assert.equal(d.puedeSeguir, false, "y eso exige una decision");

  // El lock quedo tomado por un proceso que ya no existe. Que eso no sea un
  // recorrido bloqueado para siempre lo resuelve lock.mjs — y se verifica, no
  // se asume.
  const lock = inspect("run-1", { home: cortado.home });
  assert.equal(lock.pid, pid);
  assert.equal(lock.alive, false);

  const prep = prepararReanudacion("1", { home: cortado.home, config: CONFIG, decisiones: { T2: "completar" } });
  assert.equal(prep.ok, true);

  const registro = [];
  await runItem("1", depsBase(cortado, registro));

  assert.deepEqual(registro.filter((x) => x.tarea === "T1"), [], "no se repitio nada de la tarea ya integrada");
  const obtenido = resultadoFinal(cortado);
  assert.deepEqual(obtenido, esperado, "el resultado final de un recorrido retomado tiene que ser el mismo");
});

// ------------- 8. el corte que cae al EMPEZAR una fase, con el arbol limpio

/**
 * El caso que rompe la version ingenua, y es el caso NORMAL: la tarea modifica
 * un archivo que YA EXISTE en la base. Casi ninguna tarea de un repositorio que
 * ya funciona crea su archivo de destino desde cero.
 *
 * EL FALLO QUE EVITA, medido con un SIGKILL de verdad al empezar GREEN sobre un
 * plan de dos tareas: la reanudacion preguntaba si el archivo de destino
 * EXISTIA para decidir si la implementacion ya estaba escrita. Con un archivo
 * preexistente eso es siempre cierto, asi que la tarea se declaraba "no
 * relanzable", se quedaba en `red` para siempre —el conjunto listo excluye lo
 * que esta en vuelo—, el recorrido cortaba por estancado y el PR salio sin ella
 * y sin la que dependia de ella.
 */
test("un corte al empezar GREEN se retoma igual, aunque el archivo de destino ya existiera en la base", async () => {
  const conElArchivoYaEnLaBase = (esc) => {
    mkdirSync(join(esc.integracion, "src"), { recursive: true });
    writeFileSync(join(esc.integracion, "src/T1.mjs"), "export const valor = 0;\n");
    git(esc.integracion, "add", "-A");
    git(esc.integracion, "commit", "-q", "-m", "chore(app): el archivo que la tarea va a modificar");
  };

  const limpio = escenario([tarea("T1")]);
  conElArchivoYaEnLaBase(limpio);
  await runItem("1", depsBase(limpio, []));
  const esperado = resultadoFinal(limpio);

  const esc = escenario([tarea("T1")]);
  conElArchivoYaEnLaBase(esc);
  const dest = esc.wtDe("T1");
  wt.add(esc.repo, { branch: "task/1-T1", base: esc.itemBranch, dest, fetch: false });
  mkdirSync(join(dest, "test"), { recursive: true });
  writeFileSync(join(dest, "test/T1.test.mjs"),
    'import { valor } from "../src/T1.mjs";\nif (valor !== 42) throw new Error("rojo");\n');
  git(dest, "add", "-A");
  git(dest, "commit", "-q", "-m", "test(app): tarea T1 (T1, H-1)");
  escribirEstado(esc.home, (r) => {
    const t = r.tasks[0];
    t.status = "red";
    t.redVerified = true;
    t.worktree = dest;
    t.branch = "task/1-T1";
  });
  // Lo que define el caso: el arbol esta LIMPIO. El corte cayo antes de que el
  // modelo escribiera una linea de la implementacion, asi que volver a pasar
  // por RED da rojo otra vez y no repite nada terminado.
  assert.deepEqual(wt.changes(dest), []);

  const prep = prepararReanudacion("1", { home: esc.home, config: CONFIG });
  assert.deepEqual(prep.relanzadas.map((x) => [x.task, x.de, x.a]), [["T1", "red", "pending"]]);
  assert.deepEqual(prep.sinRelanzar, []);

  await runItem("1", depsBase(esc, []));
  assert.deepEqual(resultadoFinal(esc), esperado, "el resultado final tiene que ser el mismo (SC-010)");
});

test("una tarea con la implementacion a medio escribir NO se rebobina, y se dice quien la tiene que mirar", () => {
  const esc = escenario([tarea("T1")]);
  const dest = esc.wtDe("T1");
  wt.add(esc.repo, { branch: "task/1-T1", base: esc.itemBranch, dest, fetch: false });
  mkdirSync(join(dest, "test"), { recursive: true });
  mkdirSync(join(dest, "src"), { recursive: true });
  writeFileSync(join(dest, "test/T1.test.mjs"), "// el test, ya commiteado\n");
  git(dest, "add", "-A");
  git(dest, "commit", "-q", "-m", "test(app): tarea T1 (T1, H-1)");
  // Y ahora si: la implementacion a medio escribir, sin commitear.
  writeFileSync(join(dest, "src/T1.mjs"), "export const valor = /* a medio */\n");
  escribirEstado(esc.home, (r) => {
    const t = r.tasks[0];
    t.status = "red";
    t.redVerified = true;
    t.worktree = dest;
    t.branch = "task/1-T1";
  });

  const prep = prepararReanudacion("1", {
    home: esc.home, config: CONFIG,
    decisiones: { T1: { accion: "registrar", nota: "la implementacion quedo a medio escribir" } },
  });

  // Rebobinarla a `pending` haria re-verificar el rojo, y un test con su
  // implementacion al lado puede pasar: se gastaria el presupuesto de RED
  // contra un rojo imposible y terminaria bloqueando una tarea que estaba bien.
  assert.deepEqual(prep.relanzadas, []);
  assert.deepEqual(prep.sinRelanzar.map((x) => x.task), ["T1"]);
  assert.equal(readFileSync(join(dest, "src/T1.mjs"), "utf8"), "export const valor = /* a medio */\n",
    "y lo que quedo escrito sigue exactamente donde estaba");
});

// -------------------------------- 9. lo que la reanudacion NO puede prometer

test("la reanudacion no anuncia como `continua` lo que nadie va a retomar", () => {
  const esc = escenario([tarea("T1"), tarea("T2", { dependsOn: ["T1"] })]);
  aMedias(esc, { status: "gated", attempts: { red: 1, green: 1, gate: 1, review: 0 } });

  const prep = prepararReanudacion("1", { home: esc.home, config: CONFIG, decisiones: { T1: "completar" } });

  assert.equal(prep.ok, true, "la preparacion en si funciono: se aplico la decision y se ordenaron los punteros");
  assert.deepEqual(prep.sinRelanzar.map((x) => x.task), ["T1"]);
  // EL FALLO QUE EVITA. `continua` es lo que un comando le muestra a una
  // persona para decirle que va a pasar cuando el recorrido arranque. Listar
  // ahi una tarea que ningun mecanismo levanta —el conjunto listo excluye lo
  // que esta en vuelo, y la cola solo toma `queued`— convierte un trabajo
  // abandonado en un trabajo que parece encaminado.
  assert.ok(!prep.continua.includes("T1"), `continua promete T1 y nadie la retoma: ${JSON.stringify(prep.continua)}`);
  assert.ok((prep.advertencias || []).some((a) => /T1/.test(a)),
    `la reanudacion tiene que decirlo en voz alta: ${JSON.stringify(prep.advertencias)}`);
});

test("una decision de reanudacion no se acepta sobre una tarea que no quedo a medias", () => {
  const esc = escenario([tarea("T1"), tarea("T2")]);
  escribirEstado(esc.home, (r) => {
    const t = r.tasks[0];
    t.status = "integrated";
    t.redVerified = true;
    t.integratedAt = new Date().toISOString();
    t.attempts = { red: 1, green: 1, gate: 1, review: 1 };
  });
  const antes = huella(esc.home);

  // EL FALLO QUE EVITA. `blocked` es la unica transicion que la maquina de
  // estados acepta desde cualquier punto —es una senial lateral, a proposito—,
  // asi que una decision mal tipeada sobre una tarea YA INTEGRADA la marcaba
  // como bloqueada. Su codigo sigue en la rama del item y en el PR: el estado
  // pasaba a mentir en la direccion peor, diciendo que falto lo que ya entro.
  assert.throws(
    () => prepararReanudacion("1", {
      home: esc.home, config: CONFIG,
      decisiones: { T1: { accion: "bloquear", nota: "se me fue el dedo" } },
    }),
    /T1|integrated|a medias/i,
  );
  assert.equal(loadRun("1", { home: esc.home }).tasks[0].status, "integrated");
  assert.equal(huella(esc.home), antes);
});

// ---------------- 10. una tarea revisada a la que solo le falta su turno

test("una tarea que quedo en `reviewed` vuelve a la cola, que es quien la toma", async () => {
  const esc = escenario([tarea("T1")]);
  const dest = esc.wtDe("T1");
  wt.add(esc.repo, { branch: "task/1-T1", base: esc.itemBranch, dest, fetch: false });
  mkdirSync(join(dest, "test"), { recursive: true });
  mkdirSync(join(dest, "src"), { recursive: true });
  writeFileSync(join(dest, "test/T1.test.mjs"),
    'import { valor } from "../src/T1.mjs";\nif (valor !== 42) throw new Error("rojo");\n');
  git(dest, "add", "-A");
  git(dest, "commit", "-q", "-m", "test(app): tarea T1 (T1, H-1)");
  writeFileSync(join(dest, "src/T1.mjs"), "export const valor = 42;\n");
  git(dest, "add", "-A");
  git(dest, "commit", "-q", "-m", "feat(app): tarea T1 (T1, H-1)");
  escribirEstado(esc.home, (r) => {
    const t = r.tasks[0];
    t.status = "reviewed";
    t.redVerified = true;
    t.worktree = dest;
    t.branch = "task/1-T1";
    t.attempts = { red: 1, green: 1, gate: 1, review: 1 };
    t.gateEvidence = { command: "true", exitCode: 0, durationMs: 1, output: "", ranAt: new Date().toISOString() };
  });

  // A esta tarea no le falta trabajo: le falta su TURNO. El unico estado que
  // camina solo es `queued` —lo toma la cola de integracion—, y encolarla es
  // exactamente lo que hace el driver desde `reviewed`, sin fase de por medio.
  // Sin esto, un corte entre la revision y el encolado dejaba una tarea
  // terminada y verificada fuera del PR.
  const prep = prepararReanudacion("1", { home: esc.home, config: CONFIG });
  assert.deepEqual(prep.relanzadas.map((x) => [x.task, x.de, x.a]), [["T1", "reviewed", "queued"]]);
  assert.equal(loadRun("1", { home: esc.home }).tasks[0].status, "queued");
  assert.deepEqual(loadRun("1", { home: esc.home }).tasks[0].attempts,
    { red: 1, green: 1, gate: 1, review: 1 }, "y sin regalar presupuesto");

  const registro = [];
  await runItem("1", depsBase(esc, registro));
  assert.equal(loadRun("1", { home: esc.home }).tasks[0].status, "integrated");
  assert.deepEqual(registro, [], "no se repitio ninguna fase: la revision ya habia ocurrido");
});

test("una tarea en `reviewed` sin revision registrada NO se encola: la renuncia no se inventa aca", () => {
  const esc = escenario([tarea("T1")]);
  const dest = esc.wtDe("T1");
  wt.add(esc.repo, { branch: "task/1-T1", base: esc.itemBranch, dest, fetch: false });
  escribirEstado(esc.home, (r) => {
    const t = r.tasks[0];
    t.status = "reviewed";
    t.redVerified = true;
    t.worktree = dest;
    t.branch = "task/1-T1";
    t.attempts = { red: 1, green: 1, gate: 1, review: 0 };
  });

  const prep = prepararReanudacion("1", { home: esc.home, config: CONFIG });
  // El contador ES la constancia de que la revision ocurrio. Encolar sin el
  // seria el verde inventado, una version mas: la unica salida legitima es una
  // renuncia explicita, y eso lo declara un tier en configuracion, no esto.
  assert.deepEqual(prep.relanzadas, []);
  assert.deepEqual(prep.sinRelanzar.map((x) => x.task), ["T1"]);
  assert.match(prep.sinRelanzar[0].motivo, /revision|review/i);
  assert.equal(loadRun("1", { home: esc.home }).tasks[0].status, "reviewed");
});

// ---------------------- 11. un recorrido que esta corriendo AHORA MISMO (US4-5)

/**
 * OTRO proceso, vivo, con el lock del recorrido tomado.
 *
 * Tiene que ser un proceso de verdad: `lock.mjs` decide si un lock esta vivo
 * preguntandole al sistema operativo por el pid, asi que un lock escrito a mano
 * con un pid inventado prueba lo contrario de lo que hace falta.
 */
async function otroProcesoConElLock(home, recurso) {
  const rutaLock = fileURLToPath(new URL("../src/lock.mjs", import.meta.url));
  const guion =
    `const { acquire } = await import(${JSON.stringify(rutaLock)});\n` +
    `if (!acquire(${JSON.stringify(recurso)}, { home: ${JSON.stringify(home)} }).ok) process.exit(9);\n` +
    `console.log("tomado");\nsetInterval(() => {}, 1000);\n`;
  const hijo = spawn(process.execPath, ["--input-type=module", "-e", guion], { stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((listo, fallo) => {
    hijo.stdout.on("data", (d) => String(d).includes("tomado") && listo());
    hijo.on("exit", (c) => fallo(new Error(`el proceso que tenia que tomar el lock murio (${c})`)));
  });
  return hijo;
}

test("un recorrido que otro proceso esta recorriendo no se retoma por atras", async () => {
  const esc = escenario([tarea("T1"), tarea("T2")]);
  aMedias(esc);
  const antes = huella(esc.home);

  const otro = await otroProcesoConElLock(esc.home, "run-1");
  try {
    // EL FALLO QUE EVITA, medido con el driver corriendo de verdad en otro
    // proceso: la reanudacion le movio T1 de `in_progress` a `pending` por
    // debajo, mientras ese proceso estaba en su fase RED. Lo que sigue es lo
    // peor de los dos mundos: la transicion del proceso vivo se rechaza por la
    // guarda, su tarea queda `pending`, y la vuelta siguiente del bucle la
    // lanza OTRA VEZ — dos veces la misma tarea, que es exactamente lo que el
    // lock existe para no tener (FR-025, US4 escenario 5).
    const prep = prepararReanudacion("1", { home: esc.home, config: CONFIG, decisiones: { T1: "completar" } });
    assert.equal(prep.ok, false);
    assert.match(prep.motivo, /otro proceso|corriendo/i);
    assert.equal(huella(esc.home), antes, "y no escribe una sola linea del estado ajeno");
    assert.equal(loadRun("1", { home: esc.home }).tasks[0].status, "in_progress");
  } finally {
    otro.kill("SIGKILL");
  }
});

test("el lock huerfano que deja un proceso matado no impide retomar: eso lo recupera lock.mjs", () => {
  const esc = escenario([tarea("T1")]);
  aMedias(esc);
  // Un pid que ya no existe es lo que deja un corte de luz. Si esto bloqueara,
  // un recorrido matado quedaria intocable para siempre: justo el problema que
  // el mecanismo del lock existe para no tener.
  mkdirSync(join(esc.home, "locks"), { recursive: true });
  writeFileSync(join(esc.home, "locks", "run-1.json"), JSON.stringify({
    pid: 999999, host: hostname(), token: "viejo", resource: "run-1", acquiredAt: new Date().toISOString(),
  }));

  const prep = prepararReanudacion("1", { home: esc.home, config: CONFIG, decisiones: { T1: "completar" } });
  assert.equal(prep.ok, true);
  assert.equal(loadRun("1", { home: esc.home }).tasks[0].status, "pending");
});
