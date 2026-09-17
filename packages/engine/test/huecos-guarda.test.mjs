// Los cuatro huecos que la revision adversarial dejo abiertos, cada uno con su
// medicion. Ninguno se encontro leyendo codigo: los cuatro se ejecutaron.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRun, setActiveTask, activeTaskFull } from "../src/state.mjs";
import { runSingleTest } from "../src/gate.mjs";
import { buildHookSettings, validateHookSettings } from "../src/session-settings.mjs";
import { validatePlan } from "../src/plan.mjs";

const tarea = (id, over = {}) => ({
  id, repo: "app", title: id, acceptance: "c",
  targetFiles: [`src/${id}.mjs`], testFiles: [`test/${id}.test.mjs`],
  tier: "small", dependsOn: [], dependencyKind: "hard", ...over,
});

// ------------------------------------------------------------------- H2

test("H2 — el worktree se resuelve por ruta REAL, no por la grafia del string", () => {
  // La medicion: con el home bajo /var/folders (cuya ruta real es
  // /private/var/folders en macOS) y DOS tareas activas, activeTaskFull
  // devolvia null y la guarda permitia TODO. No hay respaldo de "la unica
  // activa" cuando hay dos, asi que el hook se apartaba teniendo que actuar.
  const home = mkdtempSync(join(tmpdir(), "noxloop-h2-"));
  const wtA = mkdtempSync(join(tmpdir(), "noxloop-h2-wtA-"));
  const wtB = mkdtempSync(join(tmpdir(), "noxloop-h2-wtB-"));

  createRun({
    item: { id: "1", title: "h", level: "story", url: "u", provider: "fake" },
    repoScope: ["app"], tasks: [tarea("T1"), tarea("T2")],
  }, { home });
  setActiveTask("1", "T1", { home, worktree: wtA });
  setActiveTask("1", "T2", { home, worktree: wtB });

  const real = realpathSync(wtA);
  assert.notEqual(real, wtA, "el escenario exige que la ruta real difiera de la grafia");

  // La sesion reporta la ruta REAL; el puntero guardo la que le dieron.
  const porRealpath = activeTaskFull({ home, cwd: real });
  assert.ok(porRealpath, "con dos tareas activas y la ruta real, no puede devolver null");
  assert.equal(porRealpath.task.id, "T1");

  // Y al reves: el puntero con la ruta real, la sesion reportando la grafia.
  assert.equal(activeTaskFull({ home, cwd: wtA }).task.id, "T1");
  assert.equal(activeTaskFull({ home, cwd: join(real, "src") }).task.id, "T1");
});

test("H2 — una ruta que de verdad esta afuera sigue dando null", () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-h2b-"));
  const wtA = mkdtempSync(join(tmpdir(), "noxloop-h2b-wtA-"));
  const wtB = mkdtempSync(join(tmpdir(), "noxloop-h2b-wtB-"));
  createRun({
    item: { id: "1", title: "h", level: "story", url: "u", provider: "fake" },
    repoScope: ["app"], tasks: [tarea("T1"), tarea("T2")],
  }, { home });
  setActiveTask("1", "T1", { home, worktree: wtA });
  setActiveTask("1", "T2", { home, worktree: wtB });
  assert.equal(activeTaskFull({ home, cwd: "/tmp/otro/lado/completamente" }), null);
});

// ------------------------------------------------------------------- H4

test("H4 — el runner de un test no pasa por un shell: la ruta la escribe un modelo", () => {
  // La medicion: `runSingleTest` interpolaba {file} en la plantilla y corria con
  // shell:true. `file` sale de task.testFiles, que lo escribe el planificador —
  // un modelo — y que el esquema aceptaba como string libre. Con un plan que
  // valida, el motor ejecutaba lo que el modelo quisiera.
  const cwd = mkdtempSync(join(tmpdir(), "noxloop-h4-"));
  const testigo = join(cwd, "ejecutado.txt");
  const config = { repos: { app: { gate: "true", env: {}, runners: { node: "node --test {file}" } } } };

  runSingleTest("app", cwd, `x.test.mjs; echo comprometido > ${testigo}`, config, { runner: "node" });

  // Si la ruta hubiera pasado por un shell, el `;` habria corrido el segundo
  // comando y el testigo existiria. Que no exista ES la prueba.
  assert.equal(existsSync(testigo), false, "la ruta del test se ejecuto en un shell");
});

test("H4 — el esquema del plan rechaza una ruta que no es una ruta", () => {
  const plan = (files) => ({
    item: { id: "1", title: "t", level: "story", url: "u", provider: "fake" },
    repoScope: ["app"],
    tasks: [{ ...tarea("T001"), testFiles: files, targetFiles: files }],
  });
  const ok = validatePlan(plan(["test/a.test.mjs"]), { repos: ["app"] });
  assert.equal(ok.ok, true);

  for (const malo of ["a.mjs; rm -rf /", "a.mjs && curl x", "a.mjs | sh", "$(whoami).mjs", "`id`.mjs", "a.mjs\nrm x"]) {
    const r = validatePlan(plan([malo]), { repos: ["app"] });
    assert.equal(r.ok, false, `el esquema acepto ${JSON.stringify(malo)}`);
  }
});

// ------------------------------------------------------------------- H5

test("H5 — la validacion exige las cuatro guardas en su evento, no cuatro rutas cualesquiera", () => {
  // La medicion: `validateHookSettings` juntaba strings que terminaran en .mjs y
  // decia ok:true con el hook de Bash apuntando a un archivo inexistente, con
  // el nombre del evento mal escrito, y con PreToolUse vacio.
  const raiz = new URL("../", import.meta.url).pathname;
  const bueno = buildHookSettings(raiz);
  assert.equal(validateHookSettings(bueno).ok, true);

  const sinBash = structuredClone(bueno);
  sinBash.hooks.PreToolUse = sinBash.hooks.PreToolUse.filter((m) => m.matcher !== "Bash");
  assert.equal(validateHookSettings(sinBash).ok, false, "sin la guarda de Bash no hay limite de autonomia");

  const eventoMalEscrito = structuredClone(bueno);
  eventoMalEscrito.hooks.PreToolUsee = eventoMalEscrito.hooks.PreToolUse;
  delete eventoMalEscrito.hooks.PreToolUse;
  assert.equal(validateHookSettings(eventoMalEscrito).ok, false);

  const vacio = structuredClone(bueno);
  vacio.hooks.PreToolUse = [];
  assert.equal(validateHookSettings(vacio).ok, false);

  const otroArchivo = structuredClone(bueno);
  const bash = otroArchivo.hooks.PreToolUse.find((m) => m.matcher === "Bash");
  bash.hooks[0].args = ["/no/existe/no-prod-writes.mjs"];
  assert.equal(validateHookSettings(otroArchivo).ok, false);
});

test("H5 — la validacion nombra que falta, no dice solo que algo falta", () => {
  const raiz = new URL("../", import.meta.url).pathname;
  const sinBash = structuredClone(buildHookSettings(raiz));
  sinBash.hooks.PreToolUse = sinBash.hooks.PreToolUse.filter((m) => m.matcher !== "Bash");
  const r = validateHookSettings(sinBash);
  assert.ok(r.missing.join(" ").includes("no-prod-writes"), `no nombra la guarda: ${JSON.stringify(r)}`);
});

// ------------------------------------------------------------------- H3

test("H3 — la sesion que lanza el motor recibe NOXLOOP_HOME, no el de por defecto", async () => {
  // La medicion: el motor lanzaba la sesion con {...process.env, CI:"1"} y nunca
  // inyectaba NOXLOOP_HOME. Pero `home` es un campo de la configuracion, asi que
  // el operador que lo pone en el archivo en vez de exportarlo corria todas sus
  // sesiones con los hooks mirando ~/.noxloop: cero tareas activas, cero guarda.
  const { runPhase } = await import("../src/runner.mjs");
  let recibido = null;
  await runPhase(
    { prompt: "/x", cwd: "/tmp", home: "/un/home/declarado/en/el/archivo" },
    {
      transport: (o) => {
        recibido = o;
        return (async function* () {
          yield { type: "system", subtype: "init", session_id: "s" };
          yield { type: "result", subtype: "success", is_error: false, session_id: "s", num_turns: 1 };
        })();
      },
    },
  );
  assert.equal(recibido.env.NOXLOOP_HOME, "/un/home/declarado/en/el/archivo");
  // Y la guarda no depende de que la tarea activa se resuelva: dentro de una
  // sesion del motor el limite vale siempre.
  assert.equal(recibido.env.NOXLOOP_GUARD_ALWAYS, "1");
});

// ------------------------------------------- la lista de permitidos

test("la lista de permitidos sale de la configuracion del repositorio, no de una constante", async () => {
  const { comandosPermitidos } = await import("../src/wiring.mjs");
  const permitidos = comandosPermitidos({
    gate: "pnpm run lint && pnpm typecheck && pnpm test",
    fastGate: "pnpm test",
    runners: { node: "node --test {file}", vitest: "pnpm exec vitest run {file}" },
  });
  assert.ok(permitidos.includes("pnpm"), `falta pnpm: ${permitidos}`);
  assert.ok(permitidos.includes("node"), `falta node: ${permitidos}`);
  // Y nada mas: la lista es lo que el repositorio declara necesitar.
  assert.ok(!permitidos.includes("curl"));
  assert.ok(!permitidos.includes("env"), "un prefijo ejecutor no entra ni declarandolo");
});

test("un repositorio sin gate declarado no produce una lista vacia en silencio", async () => {
  const { comandosPermitidos } = await import("../src/wiring.mjs");
  assert.deepEqual(comandosPermitidos({}), []);
  assert.deepEqual(comandosPermitidos(null), []);
});
