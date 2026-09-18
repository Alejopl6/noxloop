// El puente entre el plugin instalado y los hooks del motor.
//
// EL FALLO QUE ESTO CIERRA, y es el peor que tuvo el proyecto. `hooks.json`
// invocaba `${CLAUDE_PLUGIN_ROOT}/../engine/src/hooks/*.mjs`, pero el
// marketplace publica `./packages/plugin`: instalado, `../engine` no existe.
// Los cuatro hooks fallaban al arrancar con codigo 1 — que NO es 2 — asi que
// no bloqueaban nada. El adoptante leia en el README que el TDD y el limite de
// autonomia son hooks y no prompts, y no tenia ninguno de los dos. En silencio.
//
// LA INVERSION QUE IMPORTA. Que falte la guarda no puede significar "permitir".
// Con un recorrido activo, no poder cargar el guard BLOQUEA. Sin recorrido
// activo permite, igual que hoy: alguien que instalo el plugin para usar los
// comandos no puede quedarse sin poder escribir codigo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolverGuard, hayTareaActiva, decidirPuente } from "../../plugin/hooks/shim.mjs";

const existeSolo = (rutas) => (p) => rutas.includes(p);

test("NOXLOOP_ENGINE gana: es la salida explicita para un layout raro", () => {
  const r = resolverGuard("tdd-order-guard", {
    env: { NOXLOOP_ENGINE: "/opt/nox/engine" },
    pluginRoot: "/plug",
    existe: existeSolo(["/opt/nox/engine/src/hooks/tdd-order-guard.mjs"]),
  });
  assert.equal(r.ruta, "/opt/nox/engine/src/hooks/tdd-order-guard.mjs");
  assert.equal(r.de, "NOXLOOP_ENGINE");
});

test("NOXLOOP_ENGINE apuntando a la nada no se usa en silencio: se sigue buscando", () => {
  const r = resolverGuard("tdd-order-guard", {
    env: { NOXLOOP_ENGINE: "/no/existe" },
    pluginRoot: "/repo/packages/plugin",
    existe: existeSolo(["/repo/packages/engine/src/hooks/tdd-order-guard.mjs"]),
  });
  assert.equal(r.ruta, "/repo/packages/engine/src/hooks/tdd-order-guard.mjs");
  assert.equal(r.de, "el layout del repositorio");
});

test("en el monorepo encuentra el motor al lado del plugin", () => {
  const r = resolverGuard("no-prod-writes", {
    env: {},
    pluginRoot: "/repo/packages/plugin",
    existe: existeSolo(["/repo/packages/engine/src/hooks/no-prod-writes.mjs"]),
  });
  assert.equal(r.ruta, "/repo/packages/engine/src/hooks/no-prod-writes.mjs");
});

test("un motor vendorizado DENTRO del plugin tambien sirve", () => {
  const r = resolverGuard("state-checkpoint", {
    env: {},
    pluginRoot: "/plug",
    existe: existeSolo(["/plug/engine/src/hooks/state-checkpoint.mjs"]),
  });
  assert.equal(r.ruta, "/plug/engine/src/hooks/state-checkpoint.mjs");
  assert.equal(r.de, "el motor vendorizado en el plugin");
});

test("sin motor devuelve null Y las rutas que busco: un 'no lo encontre' sin rutas no se puede arreglar", () => {
  const r = resolverGuard("tdd-order-guard", { env: {}, pluginRoot: "/plug", existe: () => false });
  assert.equal(r.ruta, null);
  assert.ok(r.candidatas.length >= 2);
  assert.ok(r.candidatas.some((c) => c.includes("/plug")));
});

// ------------------------------------------------------- la tarea activa

function homeCon(punteros) {
  const home = mkdtempSync(join(tmpdir(), "nox-shim-"));
  if (punteros.length) mkdirSync(join(home, "active-tasks"), { recursive: true });
  punteros.forEach((p, i) => writeFileSync(join(home, "active-tasks", `wt-${i}.json`), JSON.stringify(p)));
  return home;
}

test("sin directorio de tareas activas no hay recorrido corriendo", () => {
  assert.equal(hayTareaActiva({ home: homeCon([]) }), false);
});

test("un home que no existe tampoco lanza", () => {
  assert.equal(hayTareaActiva({ home: "/no/existe/nada" }), false);
});

test("un puntero de tarea activa se detecta con fs pelado, sin el motor", () => {
  const home = homeCon([{ itemId: "T-1", taskId: "t1", worktree: "/tmp/wt" }]);
  assert.equal(hayTareaActiva({ home }), true);
});

// ----------------------------------------------------------- la inversion

test("SIN motor y SIN recorrido activo: permite, como hoy", async () => {
  const d = await decidirPuente({}, {
    nombre: "tdd-order-guard",
    resolucion: { ruta: null, candidatas: ["/a", "/b"] },
    home: homeCon([]),
  });
  assert.equal(d.allow, true);
});

test("SIN motor y CON recorrido activo: BLOQUEA. Es toda la razon de este archivo", async () => {
  const d = await decidirPuente({ tool_name: "Write", tool_input: { file_path: "/x/src/a.ts" } }, {
    nombre: "tdd-order-guard",
    resolucion: { ruta: null, candidatas: ["/plug/../engine/src/hooks/tdd-order-guard.mjs", "/plug/engine/src/hooks/tdd-order-guard.mjs"] },
    home: homeCon([{ itemId: "T-1", taskId: "t1" }]),
  });
  assert.equal(d.allow, false);
  assert.match(d.reason, /tdd-order-guard/, "se nombra el guard que falta");
  assert.match(d.reason, /T-1|recorrido activo/i, "y que hay un recorrido corriendo");
  assert.match(d.reason, /NOXLOOP_ENGINE/, "y como arreglarlo: un bloqueo sin salida no sirve");
  assert.ok(d.reason.includes("/plug"), "y las rutas que se buscaron");
});

test("CON motor presente delega, y lo que decide el guard es lo que sale", async () => {
  const falso = new URL("./fixtures/guard-que-niega.mjs", import.meta.url).pathname;
  const d = await decidirPuente({ tool_name: "Write" }, {
    nombre: "cualquiera",
    resolucion: { ruta: falso, de: "el test" },
    home: homeCon([{ itemId: "T-9", taskId: "t1" }]),
  });
  assert.equal(d.allow, false);
  assert.equal(d.reason, "lo dijo el guard de verdad");
});

test("un guard que revienta al cargarse NO se degrada a permitir con un recorrido activo", async () => {
  const d = await decidirPuente({ tool_name: "Write" }, {
    nombre: "roto",
    resolucion: { ruta: "/no/existe/guard.mjs", de: "el test" },
    home: homeCon([{ itemId: "T-7", taskId: "t1" }]),
  });
  assert.equal(d.allow, false, "cargar mal el guard es no tener guard, y eso bloquea");
  assert.match(d.reason, /no pude cargar/i);
});

// --------------------------------------- la guarda contra que esto vuelva
//
// El bug no fue una idea equivocada: fue una RUTA. `hooks.json` apuntaba fuera
// del arbol que el marketplace publica, y nada lo verificaba. Este test lee el
// manifiesto de verdad y exige que cada archivo que invoca exista dentro del
// plugin, porque eso es lo unico que el adoptante recibe.

import { readFileSync, existsSync as existeDeVerdad } from "node:fs";
import { execFileSync } from "node:child_process";

const RAIZ = new URL("../../../", import.meta.url).pathname;
const PLUGIN = join(RAIZ, "packages/plugin");

test("todo archivo que hooks.json invoca existe DENTRO del plugin publicado", () => {
  const d = JSON.parse(readFileSync(join(PLUGIN, "hooks/hooks.json"), "utf8"));
  const comandos = Object.values(d.hooks).flat().flatMap((g) => g.hooks || []).map((h) => h.command);
  assert.ok(comandos.length >= 4, "se esperaban los cuatro guards");

  const fuera = [];
  for (const c of comandos) {
    const m = c.match(/\$\{CLAUDE_PLUGIN_ROOT\}([^"]+)/);
    assert.ok(m, `el comando no usa CLAUDE_PLUGIN_ROOT: ${c}`);
    const rel = m[1].replace(/^\//, "");
    // `..` en la ruta es exactamente el bug: apunta afuera de lo que se publica.
    if (rel.includes("..")) fuera.push(c);
    else if (!existeDeVerdad(join(PLUGIN, rel))) fuera.push(`${c} -> no existe ${rel}`);
  }
  assert.deepEqual(fuera, [], `hooks.json invoca cosas que el adoptante no recibe:\n${fuera.join("\n")}`);
});

test("el manifiesto del marketplace publica el directorio que contiene esos archivos", () => {
  const m = JSON.parse(readFileSync(join(RAIZ, ".claude-plugin/marketplace.json"), "utf8"));
  const fuentes = (m.plugins || []).map((p) => p.source).filter(Boolean);
  assert.ok(fuentes.length > 0);
  for (const f of fuentes) {
    const dir = join(RAIZ, String(f).replace(/^\.\//, ""));
    assert.ok(existeDeVerdad(join(dir, "hooks/guard.mjs")),
      `${f} se publica pero no contiene hooks/guard.mjs: el adoptante quedaria sin guardas`);
  }
});

// ------------------------------------------- de punta a punta, como lo corre Claude Code

/** Corre guard.mjs de verdad, como proceso, y devuelve el codigo y stderr. */
function correrGuard(nombre, input, env) {
  try {
    execFileSync(process.execPath, [join(PLUGIN, "hooks/guard.mjs"), nombre], {
      input: JSON.stringify(input),
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stderr: "" };
  } catch (e) {
    return { code: e.status, stderr: String(e.stderr || "") };
  }
}

/**
 * Copia el plugin a un directorio suelto, que es COMO LO RECIBE EL ADOPTANTE.
 *
 * EL FALLO QUE ESTO EVITA, y se encontro escribiendo estos tests: dentro del
 * monorepo `../engine` existe siempre, asi que un test que corre desde el repo
 * encuentra el motor por el camino de repositorio y nunca ejercita el caso sin
 * motor. Medido: la version anterior de este test daba 0 y parecia correcta.
 */
function pluginAislado() {
  const destino = mkdtempSync(join(tmpdir(), "nox-plugin-"));
  cpSync(PLUGIN, join(destino, "plugin"), { recursive: true });
  return join(destino, "plugin");
}

function correrGuardEn(raizPlugin, nombre, input, env) {
  try {
    execFileSync(process.execPath, [join(raizPlugin, "hooks/guard.mjs"), nombre], {
      input: JSON.stringify(input),
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stderr: "" };
  } catch (e) {
    return { code: e.status, stderr: String(e.stderr || "") };
  }
}

test("de punta a punta, PLUGIN AISLADO y sin recorrido: sale 0. No se rompe a quien solo quiere los comandos", () => {
  const r = correrGuardEn(pluginAislado(), "tdd-order-guard",
    { tool_name: "Write", tool_input: { file_path: "/x/a.ts" } },
    { NOXLOOP_HOME: homeCon([]), NOXLOOP_ENGINE: "" });
  assert.equal(r.code, 0);
});

test("de punta a punta, PLUGIN AISLADO y CON recorrido activo: sale 2. Es el bug entero", () => {
  // El bug original salia 1, porque `node` no encontraba el archivo. Claude
  // Code trata el 1 como "el hook fallo" y sigue de largo; solo el 2 bloquea.
  // Ese uno era toda la fuga.
  const r = correrGuardEn(pluginAislado(), "tdd-order-guard",
    { tool_name: "Write", tool_input: { file_path: "/x/src/a.ts" } },
    { NOXLOOP_HOME: homeCon([{ itemId: "T-1", taskId: "t1" }]), NOXLOOP_ENGINE: "" });
  assert.equal(r.code, 2, "tiene que ser 2: con 1 Claude Code sigue de largo");
  assert.match(r.stderr, /BLOQUEADO/);
  assert.match(r.stderr, /NOXLOOP_ENGINE/, "y tiene que decir como arreglarlo");
});

test("de punta a punta, PLUGIN AISLADO + NOXLOOP_ENGINE apuntando al motor: vuelve a funcionar", () => {
  const r = correrGuardEn(pluginAislado(), "tdd-order-guard",
    { tool_name: "Write", tool_input: { file_path: "/x/src/a.ts" } },
    { NOXLOOP_HOME: homeCon([{ itemId: "T-1", taskId: "t1" }]), NOXLOOP_ENGINE: join(RAIZ, "packages/engine") });
  // Con el motor cargado decide el guard real. Sin el archivo entre los
  // objetivos de la tarea, permite — y lo que se prueba es que se cargo.
  assert.equal(r.code, 0, `salio ${r.code}: ${r.stderr}`);
});

test("los cuatro guards del manifiesto se pueden cargar de verdad, no solo el primero", () => {
  const aislado = pluginAislado();
  const home = homeCon([]);
  for (const g of ["tdd-order-guard", "task-scope-guard", "no-prod-writes", "state-checkpoint"]) {
    const r = correrGuardEn(aislado, g, { tool_name: "Write", tool_input: { file_path: "/x/a.ts" } },
      { NOXLOOP_HOME: home, NOXLOOP_ENGINE: join(RAIZ, "packages/engine") });
    assert.equal(r.code, 0, `${g} salio ${r.code}: ${r.stderr}`);
  }
});

test("de punta a punta: con el motor de verdad, el guard real decide", () => {
  const home = homeCon([]);
  const r = correrGuard("tdd-order-guard", { tool_name: "Write", tool_input: { file_path: "/x/a.ts" } }, {
    NOXLOOP_HOME: home,
    NOXLOOP_ENGINE: join(RAIZ, "packages/engine"),
  });
  // Sin tarea activa el guard real permite. Lo que se prueba es que se CARGO:
  // si no se hubiera cargado, el puente habria salido por su propio camino.
  assert.equal(r.code, 0);
  assert.equal(r.stderr, "");
});

// ------------------------------- las dos implementaciones del mismo protocolo
//
// `responder()` en el motor y la salida de `guard.mjs` implementan el MISMO
// protocolo en dos archivos distintos, porque el puente no puede depender del
// motor para responder cuando el motor es justamente lo que falta. Dos
// implementaciones que se separan es el modo de fallo obvio, y ya paso una vez:
// el puente usaba `if (d.allow)` y un hook `Stop` —que devuelve `{notify:
// false}`, sin `allow`— salia como bloqueo. Habria frenado cada fin de turno.

test("el puente y el motor responden igual para toda forma de decision", () => {
  const CASOS = [
    { decision: { allow: true }, code: 0, stderr: "" },
    { decision: { allow: false, reason: "no" }, code: 2, stderr: "no" },
    { decision: { notify: false }, code: 0, stderr: "" },
    { decision: { notify: true, message: "avisa" }, code: 0, stderr: "avisa" },
    { decision: {}, code: 0, stderr: "" },
    // El caso que se rompio: sin `allow` y sin `notify` NO es un bloqueo.
    { decision: { notify: false, message: "x" }, code: 0, stderr: "" },
  ];

  // La misma logica que tiene cada lado, escrita una vez para compararlas.
  const comoResponde = (d) => {
    if (d.allow === false) return { code: 2, stderr: String(d.reason ?? "") };
    if (d.notify && d.message) return { code: 0, stderr: d.message };
    return { code: 0, stderr: "" };
  };

  for (const c of CASOS) {
    assert.deepEqual(comoResponde(c.decision), { code: c.code, stderr: c.stderr },
      `la decision ${JSON.stringify(c.decision)} no se traduce igual`);
  }

  // Y que el codigo de los dos lados diga literalmente lo mismo: si alguien
  // cambia uno, este test manda a cambiar el otro.
  const motor = readFileSync(join(RAIZ, "packages/engine/src/hooks/_shared.mjs"), "utf8");
  const puente = readFileSync(join(PLUGIN, "hooks/guard.mjs"), "utf8");
  for (const marca of ["allow === false", "process.exit(2)", "d.notify", "process.exit(0)"]) {
    const enMotor = marca.replace("d.notify", "decision.notify");
    assert.ok(motor.includes(enMotor), `el motor ya no tiene \`${enMotor}\`: revisar el puente`);
    assert.ok(puente.includes(marca), `el puente ya no tiene \`${marca}\`: revisar el motor`);
  }
});

test("un hook Stop que avisa pasa el aviso tal cual, sin convertirlo en bloqueo", async () => {
  const fixture = new URL("./fixtures/guard-que-avisa.mjs", import.meta.url).pathname;
  const d = await decidirPuente({ tool_name: "Stop" }, {
    nombre: "state-checkpoint",
    resolucion: { ruta: fixture, de: "el test" },
    home: homeCon([{ itemId: "T-5", taskId: "t1" }]),
  });
  assert.notEqual(d.allow, false, "avisar no es negar, y con un recorrido activo la diferencia importa");
  assert.equal(d.notify, true);
  assert.equal(d.message, "dejo trabajo sin commitear");
});
