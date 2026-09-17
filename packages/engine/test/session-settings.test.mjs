// Las guardas viajan con la sesion, o no hay guardas.
//
// LO QUE ESTE ARCHIVO NO PUEDE PROBAR, y conviene decirlo antes de leerlo: que
// el motor de Claude Code APLIQUE la configuracion. Eso ya se midio y es un
// fallo silencioso: un bloque `hooks` mal formado se ignora con exit 0, stderr
// vacio y is_error:false, y el `git merge` se ejecuta igual. Pasar la config y
// que la config sirva son cosas distintas. La interceptacion de verdad se prueba
// pidiendo un merge desde una sesion real del motor y esperando el bloqueo —el
// test que research.md pone como condicion para publicar el modo daemon— y no
// es este. Este cubre lo que si es verificable sin sesion: que el objeto declara
// los cuatro hooks, que sus rutas existen, que la forma declarada realmente
// bloquea al ejecutarla, y que los dos transportes la propagan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRun, setActiveTask } from "../src/state.mjs";
import {
  buildHookSettings,
  defaultEngineRoot,
  validateHookSettings,
  writeHookSettings,
} from "../src/session-settings.mjs";
import { cliArgs, runPhase, sdkOptions } from "../src/runner.mjs";

// Los cuatro nombres van a mano y no importados del modulo: un test que compara
// la lista contra la constante que la produce no verifica nada.
const LOS_CUATRO = [
  "tdd-order-guard.mjs",
  "task-scope-guard.mjs",
  "no-prod-writes.mjs",
  "state-checkpoint.mjs",
];

const home = () => mkdtempSync(join(tmpdir(), "noxloop-settings-"));

/** Recorre el objeto sin asumir mas forma que la que el motor de hooks exige. */
function declarados(settings) {
  const out = [];
  for (const entradas of Object.values(settings?.hooks || {})) {
    for (const entrada of entradas || []) {
      for (const h of entrada.hooks || []) {
        out.push({ evento: null, matcher: entrada.matcher ?? null, ...h });
      }
    }
  }
  return out;
}

const rutas = (settings) =>
  declarados(settings)
    .flatMap((h) => [h.command, ...(h.args || [])])
    .filter((a) => typeof a === "string" && a.endsWith(".mjs"));

function porEvento(settings, evento) {
  const out = [];
  for (const entrada of settings.hooks[evento] || []) {
    for (const h of entrada.hooks || []) out.push({ matcher: entrada.matcher ?? null, ...h });
  }
  return out;
}

const nombres = (lista) =>
  lista.flatMap((h) => (h.args || []).map((a) => String(a).split("/").pop()));

// --------------------------------------------------- el objeto que se entrega

test("declara los CUATRO hooks: uno que falte es una guarda que no existe", () => {
  const s = buildHookSettings(defaultEngineRoot());
  const declaradas = rutas(s);
  for (const script of LOS_CUATRO) {
    assert.ok(
      declaradas.some((r) => r.endsWith(`/${script}`)),
      `la sesion saldria sin ${script}`,
    );
  }
});

test("cada ruta declarada es absoluta y existe en disco", () => {
  const s = buildHookSettings(defaultEngineRoot());
  const declaradas = rutas(s);
  assert.ok(declaradas.length >= 4);
  for (const r of declaradas) {
    assert.ok(isAbsolute(r), `ruta relativa: ${r}`);
    assert.ok(existsSync(r), `hook declarado que no existe: ${r}`);
  }
});

test("no queda ningun placeholder de plugin en las rutas", () => {
  // `${CLAUDE_PLUGIN_ROOT}` lo resuelve el cargador de plugins y NADIE mas. Por
  // esta via es texto literal, y una ruta con el dentro apunta a un archivo que
  // no existe: la sesion arranca igual, sin guarda.
  const s = buildHookSettings(defaultEngineRoot());
  for (const r of rutas(s)) assert.ok(!r.includes("${"), `placeholder sin resolver: ${r}`);
});

test("la forma declarada spawnea el binario directo, sin pasar por un shell", () => {
  // Un worktree con `$` o una comilla en la ruta rompe la forma que mete el
  // archivo dentro de `command`. Con `command` + `args` la ruta nunca llega a
  // un parser de shell.
  for (const h of declarados(buildHookSettings(defaultEngineRoot()))) {
    assert.equal(h.type, "command");
    assert.equal(h.command, "node");
    assert.ok(Array.isArray(h.args) && h.args.length === 1, "la ruta va en args, no en command");
    assert.ok(typeof h.timeout === "number" && h.timeout > 0, "un hook sin timeout cuelga el turno");
  }
});

test("cada hook queda colgado del evento y del matcher que le toca", () => {
  const s = buildHookSettings(defaultEngineRoot());

  const escrituras = porEvento(s, "PreToolUse").filter((h) => /Edit|Write/.test(h.matcher || ""));
  assert.deepEqual(
    nombres(escrituras).sort(),
    ["task-scope-guard.mjs", "tdd-order-guard.mjs"],
    "el orden test-primero y el alcance se fuerzan al escribir un archivo",
  );
  for (const h of escrituras) {
    for (const t of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) {
      assert.match(h.matcher, new RegExp(t), `el matcher deja pasar ${t} sin guarda`);
    }
  }

  const bash = porEvento(s, "PreToolUse").filter((h) => (h.matcher || "") === "Bash");
  assert.deepEqual(nombres(bash), ["no-prod-writes.mjs"], "el limite del principio IV vive en Bash");

  // El principio IV exige que el hook corra "dentro de cada subproceso". Si
  // SubagentStop no esta, un subagente cierra sin dejar constancia.
  assert.deepEqual(nombres(porEvento(s, "Stop")), ["state-checkpoint.mjs"]);
  assert.deepEqual(nombres(porEvento(s, "SubagentStop")), ["state-checkpoint.mjs"]);
});

test("la forma declarada, ejecutada tal cual, bloquea de verdad", () => {
  // No prueba que el motor de Claude Code la cargue. Prueba que el comando y
  // los argumentos declarados son ejecutables y que el proceso devuelve el
  // bloqueo: exit 2 y el motivo por stderr. Una ruta mal armada o un hook que
  // no arranca se ven aca y no en una sesion de produccion.
  const h = home();
  createRun({
    item: { id: "42", title: "s", level: "story", url: "u", provider: "fake" },
    repoScope: ["app"],
    tasks: [{
      id: "T001", repo: "app", title: "t", acceptance: "c",
      targetFiles: ["src/a.mjs"], testFiles: ["test/a.test.mjs"],
      tier: "small", dependsOn: [], dependencyKind: "hard",
    }],
  }, { home: h });
  setActiveTask("42", "T001", { home: h });

  const [hook] = porEvento(buildHookSettings(defaultEngineRoot()), "PreToolUse")
    .filter((x) => (x.matcher || "") === "Bash");

  const r = spawnSync(hook.command, hook.args, {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "gh pr merge 12 --squash" } }),
    env: { ...process.env, NOXLOOP_HOME: h },
    encoding: "utf8",
  });

  assert.equal(r.status, 2, `el hook no bloqueo el merge (stderr: ${r.stderr})`);
  assert.ok(r.stderr.trim().length > 10, "un bloqueo sin motivo no le dice nada al modelo");
});

// --------------------------------------------------------------- validacion

test("la validacion acepta el objeto real", () => {
  const v = validateHookSettings(buildHookSettings(defaultEngineRoot()));
  assert.equal(v.ok, true);
  assert.deepEqual(v.missing, []);
  assert.equal(v.paths.length >= 4, true);
});

test("la validacion detecta una ruta declarada que no existe", () => {
  // El fallo que esto atrapa: un hook declarado que apunta a un archivo
  // inexistente NO falla al arrancar la sesion. Se ignora, la sesion corre sin
  // guarda, y nadie se entera.
  const v = validateHookSettings(buildHookSettings("/no/existe/engine"));
  assert.equal(v.ok, false);
  assert.equal(v.missing.length, v.paths.length);
  // El mensaje NOMBRA la guarda que falta, no solo la ruta: con cuatro guardas,
  // saber cual es la que no esta es la diferencia entre arreglarlo y buscarlo.
  for (const m of v.missing) {
    assert.ok(m.includes("/no/existe/engine"), m);
    assert.match(m, /no-prod-writes|tdd-order-guard|task-scope-guard|state-checkpoint/, m);
  }
});

test("la validacion sobrevive a un objeto que no entiende, y no lo da por bueno", () => {
  assert.equal(validateHookSettings(null).ok, false);
  assert.equal(validateHookSettings({}).ok, false);
  assert.equal(validateHookSettings({ hooks: {} }).ok, false);
});

// ------------------------------------------------------ el camino con archivo

test("escribe el archivo y devuelve una ruta absoluta con el mismo objeto", () => {
  const dir = home();
  const ruta = writeHookSettings(dir, defaultEngineRoot());
  assert.ok(isAbsolute(ruta), ruta);
  assert.ok(existsSync(ruta));
  assert.deepEqual(JSON.parse(readFileSync(ruta, "utf8")), buildHookSettings(defaultEngineRoot()));
});

test("no escribe un archivo que dejaria la sesion sin guarda", () => {
  assert.throws(
    () => writeHookSettings(home(), "/no/existe/engine"),
    /hook|guarda/i,
  );
});

// ------------------------------------------------- propagacion en el runner

test("el transporte del SDK lleva las guardas en la sesion", () => {
  const settings = buildHookSettings(defaultEngineRoot());
  const o = sdkOptions({ cwd: "/tmp", allowedTools: ["Bash"], addDirs: [], hookSettings: settings });
  assert.deepEqual(o.settings, settings);
  for (const script of LOS_CUATRO) {
    assert.match(JSON.stringify(o.settings), new RegExp(script));
  }
});

test("el transporte del CLI lleva las guardas en la sesion", () => {
  const settings = buildHookSettings(defaultEngineRoot());
  const args = cliArgs({ prompt: "/x", cwd: "/tmp", allowedTools: ["Bash"], addDirs: [], hookSettings: settings });
  const i = args.indexOf("--settings");
  assert.ok(i >= 0, "el camino degradado corria sin guardas");
  assert.deepEqual(JSON.parse(args[i + 1]), settings);
});

test("runPhase le pasa las guardas al transporte, sin que nadie las pida", () => {
  // No son opcionales ni configurables: no hay bandera que las apague, porque
  // apagar un hook para que una tarea avance no esta disponible.
  let recibido = null;
  return runPhase(
    { prompt: "/x", cwd: "/tmp" },
    {
      transport: (o) => {
        recibido = o;
        return (async function* () {
          yield { type: "result", subtype: "success", is_error: false, session_id: "s1", result: "" };
        })();
      },
    },
  ).then(() => {
    assert.equal(validateHookSettings(recibido.hookSettings).ok, true);
    for (const script of LOS_CUATRO) assert.match(JSON.stringify(recibido.hookSettings), new RegExp(script));
  });
});

test("si falta un hook, la sesion NO se lanza", () => {
  // Correr sin guarda es peor que no correr: el paso RED se saltea y el limite
  // del PR deja de existir, y las dos cosas pasan en silencio.
  let llamado = false;
  return runPhase(
    { prompt: "/x", cwd: "/tmp" },
    {
      engineRoot: "/no/existe/engine",
      transport: () => { llamado = true; return (async function* () {})(); },
    },
  ).then((r) => {
    assert.equal(llamado, false, "se lanzo una sesion sin guardas");
    assert.equal(r.ok, false);
    assert.match(r.text, /hook/i);
  });
});
