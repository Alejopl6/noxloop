// El diagnostico de un recorrido interrumpido, y destrabar una tarea.
//
// POR QUE ESTO ES UN MODULO Y NO UNA RAMA DEL DRIVER. El driver decide el
// siguiente paso mirando el estado; esto decide QUE ESTADO HAY cuando nadie
// cerro la puerta al salir. Son dos preguntas distintas, y mezclarlas produce
// la peor version de las dos: un driver que "arregla" lo que encuentra sin
// preguntar, que es exactamente pisar trabajo a medias.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRun, loadRun, transition, bump, setTaskFields, setActiveTask, listActiveTasks } from "../src/state.mjs";
import * as wt from "../src/worktree.mjs";
import { diagnosticar, destrabar, DECISIONES } from "../src/recovery.mjs";

const git = (cwd, ...a) =>
  execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const tarea = (id, over = {}) => ({
  id, repo: "app", title: `tarea ${id}`, acceptance: `criterio de ${id}`,
  targetFiles: [`src/${id}.mjs`], testFiles: [`test/${id}.test.mjs`],
  tier: "small", dependsOn: [], dependencyKind: "hard", ...over,
});

const plan = (tasks) => ({
  item: { id: "1", key: "H-1", title: "la historia", level: "story",
          url: "http://g/1", provider: "fake", acceptance: ["hace lo que promete"] },
  repoScope: ["app"],
  tasks,
});

const CONFIG = {
  repos: { app: { gate: "true", fastGate: "true", baseBranch: "main", env: {},
                  gaps: ["sin e2e"], remote: "git@x:o/app.git", runners: { node: "node {file}" } } },
};

function escenario(tasks = [tarea("T1"), tarea("T2")]) {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-rec-"));
  const repo = join(raiz, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.test");
  git(repo, "config", "user.name", "T");
  writeFileSync(join(repo, "README.md"), "base\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  git(repo, "branch", "feature/1-historia");
  const home = join(raiz, "home");
  createRun(plan(tasks), { home });
  return { raiz, repo, home, wtDe: (t) => join(home, "worktrees", "app", `1-${t}`) };
}

/**
 * Escribe el archivo de estado a mano.
 *
 * Es deliberado: lo que se prueba aca es como se lee un estado que un corte
 * dejo a mitad de camino, y llegar a esos estados por las transiciones exigiria
 * volver a correr el pipeline entero. Lo que NO se hace es escribir un estado
 * imposible: cada campo que se toca es uno que el motor escribe.
 */
function comoLoDejoElCorte(home, mutador) {
  const f = join(home, "runs", "run-1.json");
  const run = JSON.parse(readFileSync(f, "utf8"));
  mutador(run);
  writeFileSync(f, JSON.stringify(run, null, 2) + "\n");
  return run;
}

const abrirWorktree = (esc, taskId) => {
  const dest = esc.wtDe(taskId);
  wt.add(esc.repo, { branch: `task/1-${taskId}`, base: "feature/1-historia", dest, fetch: false });
  return dest;
};

const huella = (home) =>
  readdirSync(join(home, "runs")).map((f) => `${f}:${readFileSync(join(home, "runs", f), "utf8")}`).join("\n");

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

// ------------------------------------------------------------ diagnostico

test("diagnosticar un item sin recorrido lo dice, y no lanza", () => {
  const esc = escenario();
  const d = diagnosticar("999", { home: esc.home, config: CONFIG });
  assert.equal(d.existe, false);
  assert.equal(d.puedeSeguir, false);
  assert.match(d.resumen, /no hay recorrido|999/);
});

test("diagnosticar clasifica lo terminado, lo bloqueado, lo en vuelo y lo que ni pudo intentarse", () => {
  const esc = escenario([tarea("T1"), tarea("T2"), tarea("T3", { dependsOn: ["T2"] }), tarea("T4")]);
  const run = loadRun("1", { home: esc.home });
  transition(run, "T2", "blocked", { home: esc.home, failure: "el gate no paso (exit 1)" });
  comoLoDejoElCorte(esc.home, (r) => {
    const t1 = r.tasks.find((t) => t.id === "T1");
    t1.status = "integrated";
    t1.redVerified = true;
    t1.attempts = { red: 1, green: 2, gate: 1, review: 1 };
    t1.integratedAt = new Date().toISOString();
    const t4 = r.tasks.find((t) => t.id === "T4");
    t4.status = "red";
    t4.redVerified = true;
    t4.worktree = esc.wtDe("T4");
    t4.branch = "task/1-T4";
    t4.attempts = { red: 1, green: 1, gate: 0, review: 0 };
  });
  abrirWorktree(esc, "T4");

  const d = diagnosticar("1", { home: esc.home, config: CONFIG, repoPaths: { app: esc.repo } });

  assert.deepEqual(d.integradas, ["T1"]);
  assert.deepEqual(d.bloqueadas.map((b) => b.task), ["T2"]);
  assert.match(d.bloqueadas[0].causa, /exit 1/);
  assert.deepEqual(d.inalcanzables, ["T3"], "T3 depende de una bloqueada: no es lo mismo que estar bloqueada");
  assert.deepEqual(d.enVuelo.map((t) => t.task), ["T4"]);
  assert.equal(d.enVuelo[0].status, "red");
  assert.deepEqual(d.enVuelo[0].attempts, { red: 1, green: 1, gate: 0, review: 0 },
    "los intentos consumidos se informan tal cual: el diagnostico no redondea presupuesto");
  assert.equal(d.enVuelo[0].sucio, false);
  assert.equal(d.enVuelo[0].requiereDecision, false, "limpio y con su worktree: el driver puede seguir solo");
  assert.equal(d.puedeSeguir, true);
});

test("diagnosticar es de solo lectura: no escribe ni un byte", () => {
  const esc = escenario();
  const dest = abrirWorktree(esc, "T1");
  writeFileSync(join(dest, "a-medias.txt"), "algo\n");
  comoLoDejoElCorte(esc.home, (r) => {
    const t = r.tasks.find((x) => x.id === "T1");
    t.status = "in_progress";
    t.worktree = dest;
    t.branch = "task/1-T1";
  });
  const antes = huella(esc.home);

  diagnosticar("1", { home: esc.home, config: CONFIG, repoPaths: { app: esc.repo } });
  diagnosticar("1", { home: esc.home, config: CONFIG, repoPaths: { app: esc.repo } });

  assert.equal(huella(esc.home), antes, "un diagnostico que escribe deja de ser un diagnostico");
  assert.equal(existsSync(join(dest, "a-medias.txt")), true);
});

test("una tarea a medias con su worktree sucio exige una decision, y el diagnostico enumera las tres", () => {
  const esc = escenario();
  const dest = abrirWorktree(esc, "T1");
  writeFileSync(join(dest, "sucio.txt"), "el unico lugar donde vive esto\n");
  comoLoDejoElCorte(esc.home, (r) => {
    const t = r.tasks.find((x) => x.id === "T1");
    t.status = "in_progress";
    t.worktree = dest;
    t.branch = "task/1-T1";
    t.attempts = { red: 1, green: 0, gate: 0, review: 0 };
  });

  const d = diagnosticar("1", { home: esc.home, config: CONFIG, repoPaths: { app: esc.repo } });
  const enVuelo = d.enVuelo.find((t) => t.task === "T1");
  assert.equal(enVuelo.sucio, true);
  assert.ok(enVuelo.cambios.some((c) => c.path === "sucio.txt"), "dice que hay adentro");
  assert.equal(enVuelo.requiereDecision, true);
  assert.deepEqual([...enVuelo.opciones].sort(), [...DECISIONES].sort());
  assert.deepEqual(DECISIONES.slice().sort(), ["bloquear", "completar", "registrar"]);
  assert.deepEqual(d.decisionesPendientes.map((x) => x.task), ["T1"]);
  assert.equal(d.puedeSeguir, false, "sin decision, no avanza");
});

test("diagnosticar informa el worktree que se perdio, y no lo da por bueno", () => {
  const esc = escenario();
  comoLoDejoElCorte(esc.home, (r) => {
    const t = r.tasks.find((x) => x.id === "T1");
    t.status = "red";
    t.redVerified = true;
    t.worktree = esc.wtDe("T1"); // nunca se creo, o alguien lo borro
    t.branch = "task/1-T1";
  });

  const d = diagnosticar("1", { home: esc.home, config: CONFIG, repoPaths: { app: esc.repo } });
  const t1 = d.enVuelo[0];
  assert.equal(t1.worktreeExiste, false);
  assert.equal(t1.requiereDecision, true);
  assert.ok(t1.opciones.includes("bloquear"));
  assert.match(t1.porQue, /worktree/i);
});

test("diagnosticar delata el recorrido corrupto en vez de tratarlo como vacio", () => {
  const esc = escenario();
  writeFileSync(join(esc.home, "runs", "run-1.json"), '{"tasks": [{"id": "T1"');
  writeFileSync(join(esc.home, "runs", "run-1.json.tmp-999"), '{"a medio escribir');

  const d = diagnosticar("1", { home: esc.home, config: CONFIG });
  assert.equal(d.corrupto, true);
  assert.equal(d.puedeSeguir, false);
  assert.match(d.error, /corrupto|JSON/i);
  assert.deepEqual(d.escriturasInterrumpidas, ["run-1.json.tmp-999"],
    "el temporal que quedo es la pista de que el corte fue a mitad de una escritura");
  // Devolver un recorrido vacio seria peor que el corte: el motor
  // replanificaria encima de trabajo que existe.
  assert.deepEqual(d.integradas, []);
  assert.deepEqual(d.enVuelo, []);
});

test("diagnosticar suma lo que sobro afuera: worktrees y punteros huerfanos", () => {
  const esc = escenario();
  const ajeno = join(esc.home, "worktrees", "app", "77-T3");
  wt.add(esc.repo, { branch: "task/77-T3", base: "main", dest: ajeno, fetch: false });
  setActiveTask("77", "T3", { home: esc.home, worktree: ajeno });

  const d = diagnosticar("1", { home: esc.home, config: CONFIG, repoPaths: { app: esc.repo } });
  assert.ok(d.huerfanos.some((h) => h.path.endsWith("77-T3")));
  assert.ok(d.punteros.huerfanos.some((p) => p.itemId === "77"));
  // Y no propone limpiar nada: diagnosticar no decide.
  assert.equal(listActiveTasks({ home: esc.home }).length, 1);
});

// --------------------------------------------------------- 8. destrabar

test("destrabar devuelve la tarea al bucle, registra la nota y conserva los intentos", () => {
  const esc = escenario();
  const run = loadRun("1", { home: esc.home });
  bump(run, "T1", "gate", { home: esc.home });
  bump(run, "T1", "gate", { home: esc.home });
  bump(run, "T1", "gate", { home: esc.home });
  transition(loadRun("1", { home: esc.home }), "T1", "blocked", {
    home: esc.home, failure: "el gate no paso tres veces: falta una migracion",
  });

  const r = destrabar("1", "T1", { home: esc.home, nota: "la migracion la aplico una persona a mano" });

  const despues = loadRun("1", { home: esc.home });
  const t1 = despues.tasks.find((t) => t.id === "T1");
  assert.equal(r.de, "blocked");
  assert.equal(t1.status, "pending", "vuelve al bucle");
  assert.equal(t1.attempts.gate, 3, "retomar no regala presupuesto, y destrabar tampoco");
  assert.deepEqual(t1.attempts, { red: 0, green: 0, gate: 3, review: 0 });

  const registro = despues.recovery.decisiones.filter((d) => d.task === "T1");
  assert.equal(registro.length, 1);
  assert.equal(registro[0].decision, "destrabar");
  assert.equal(registro[0].nota, "la migracion la aplico una persona a mano");
  assert.match(registro[0].bloqueoPrevio, /falta una migracion/,
    "la causa por la que estaba bloqueada no se pierde al destrabar");
  assert.equal(t1.lastFailure, null, "el fallo ya se atendio: si queda, el driver vuelve a chocar con el");
});

test("destrabar vuelve a pending por defecto: es lo que hace que el driver vuelva a poner el puntero de tarea activa", () => {
  const esc = escenario();
  const dest = abrirWorktree(esc, "T1");
  comoLoDejoElCorte(esc.home, (r) => {
    const t = r.tasks.find((x) => x.id === "T1");
    t.status = "blocked";
    t.lastFailure = "se agoto el presupuesto de green";
    t.worktree = dest;
    t.branch = "task/1-T1";
    t.attempts = { red: 1, green: 3, gate: 0, review: 0 };
  });

  const r = destrabar("1", "T1", { home: esc.home, nota: "el test estaba mal escrito" });
  assert.equal(r.a, "pending");
  // EL FALLO QUE EVITA: `in_progress` es un estado del que el driver no vuelve a
  // pasar por `abrirTarea`, y `abrirTarea` es quien escribe el puntero de tarea
  // activa. Una tarea devuelta directo a `in_progress` corre sus fases sin
  // puntero, y sin puntero los hooks de orden y de alcance no tienen contra que
  // resolver: se apartan. Volver a `pending` reusa el worktree que ya existe y
  // recupera las guardas.
  const t1 = loadRun("1", { home: esc.home }).tasks.find((t) => t.id === "T1");
  assert.equal(t1.worktree, dest, "el worktree no se pierde: pending no significa desde cero");
  assert.equal(t1.attempts.green, 3);
});

test("destrabar acepta el estado al que volver, cuando quien decide lo pide", () => {
  const esc = escenario();
  transition(loadRun("1", { home: esc.home }), "T1", "blocked", { home: esc.home, failure: "x" });
  const r = destrabar("1", "T1", { home: esc.home, nota: "sigo yo desde el worktree", volverA: "in_progress" });
  assert.equal(r.a, "in_progress");
  assert.equal(loadRun("1", { home: esc.home }).tasks[0].status, "in_progress");
});

test("destrabar es idempotente: dos veces no duplican el registro ni mueven el estado", () => {
  const esc = escenario();
  transition(loadRun("1", { home: esc.home }), "T1", "blocked", { home: esc.home, failure: "se agoto el gate" });

  const primera = destrabar("1", "T1", { home: esc.home, nota: "arreglado a mano" });
  const antes = huella(esc.home);
  const segunda = destrabar("1", "T1", { home: esc.home, nota: "arreglado a mano" });

  assert.equal(primera.idempotente, false);
  assert.equal(segunda.idempotente, true);
  assert.equal(segunda.a, "pending");
  assert.equal(huella(esc.home), antes, "la segunda no escribe: ni una entrada mas en el registro");
  const run = loadRun("1", { home: esc.home });
  assert.equal(run.recovery.decisiones.filter((d) => d.task === "T1").length, 1);
});

test("destrabar no implementa nada: no toca el worktree ni el historial", () => {
  const esc = escenario();
  const dest = abrirWorktree(esc, "T1");
  writeFileSync(join(dest, "a-medias.txt"), "lo que quedo\n");
  comoLoDejoElCorte(esc.home, (r) => {
    const t = r.tasks.find((x) => x.id === "T1");
    t.status = "blocked";
    t.lastFailure = "el gate no paso";
    t.worktree = dest;
    t.branch = "task/1-T1";
  });
  const cabeza = git(dest, "rev-parse", "HEAD");

  destrabar("1", "T1", { home: esc.home, nota: "hay que revisar el schema" });

  assert.equal(readFileSync(join(dest, "a-medias.txt"), "utf8"), "lo que quedo\n");
  assert.equal(git(dest, "rev-parse", "HEAD"), cabeza, "ni un commit: si el hallazgo exige codigo, lo escribe el ciclo normal");
  assert.deepEqual(wt.changes(dest).map((c) => c.path), ["a-medias.txt"]);
});

test("destrabar se niega sobre una tarea que no esta bloqueada, y dice en que estado esta", () => {
  const esc = escenario();
  transition(loadRun("1", { home: esc.home }), "T1", "in_progress", { home: esc.home });
  assert.throws(
    () => destrabar("1", "T1", { home: esc.home, nota: "n" }),
    /in_progress/,
  );
});

test("destrabar exige que el recorrido y la tarea existan", () => {
  const esc = escenario();
  assert.throws(() => destrabar("999", "T1", { home: esc.home, nota: "n" }), /recorrido|999/);
  assert.throws(() => destrabar("1", "T9", { home: esc.home, nota: "n" }), /T9/);
});

test("destrabar rechaza un estado al que la maquina no deja volver", () => {
  const esc = escenario();
  transition(loadRun("1", { home: esc.home }), "T1", "blocked", { home: esc.home, failure: "x" });
  assert.throws(() => destrabar("1", "T1", { home: esc.home, nota: "n", volverA: "integrated" }), /integrated/);
  assert.equal(loadRun("1", { home: esc.home }).tasks[0].status, "blocked", "y no lo dejo a mitad");
});

// -------------------------------------- un recorrido que esta corriendo AHORA

test("destrabar se niega mientras otro proceso esta recorriendo el item", async () => {
  const esc = escenario();
  transition(loadRun("1", { home: esc.home }), "T1", "blocked", { home: esc.home, failure: "el gate no paso" });
  const antes = huella(esc.home);

  const otro = await otroProcesoConElLock(esc.home, "run-1");
  try {
    // EL FALLO QUE EVITA. Este modulo no toma el lock a proposito —lo toma el
    // comando que ejecuta el recorrido despues— pero no tomarlo no es lo mismo
    // que no mirarlo: destrabar ESCRIBE el estado, y escribirlo por debajo de
    // un recorrido que esta corriendo le mueve la tarea bajo los pies al
    // proceso que la esta trabajando. Es el escenario 5 de US4: un segundo
    // proceso sobre el mismo item no arranca, y esto tambien es un segundo
    // proceso.
    assert.throws(() => destrabar("1", "T1", { home: esc.home, nota: "arregle el gate" }), /otro proceso|lock/i);
    assert.equal(huella(esc.home), antes, "y no escribe una sola linea del estado ajeno");
    assert.equal(loadRun("1", { home: esc.home }).tasks[0].status, "blocked");
  } finally {
    otro.kill("SIGKILL");
  }
});

test("un lock huerfano de un proceso muerto no impide destrabar: para eso lo recupera lock.mjs", () => {
  const esc = escenario();
  transition(loadRun("1", { home: esc.home }), "T1", "blocked", { home: esc.home, failure: "el gate no paso" });
  // Un pid que ya no existe es exactamente lo que deja un corte de luz. Si esto
  // bloqueara, un recorrido matado quedaria intocable para siempre: el problema
  // que el mecanismo del lock existe para no tener.
  mkdirSync(join(esc.home, "locks"), { recursive: true });
  writeFileSync(join(esc.home, "locks", "run-1.json"), JSON.stringify({
    pid: 999999, host: hostname(), token: "viejo", resource: "run-1", acquiredAt: new Date().toISOString(),
  }));

  const r = destrabar("1", "T1", { home: esc.home, nota: "arregle el gate a mano" });
  assert.equal(r.a, "pending");
});
