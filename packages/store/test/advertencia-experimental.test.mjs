// La advertencia de `node:sqlite`, y por que se silencia SOLO esa.
//
// EL FALLO QUE EVITA, Y ES POR QUE NO SE USA `--no-warnings`. `node:sqlite`
// emite `ExperimentalWarning: SQLite is an experimental feature...` al cargarse
// en Node 22 y 24. Esa linea sale por el stderr del sidecar —que el escritorio
// lee para saber si el servicio arranco— y por el stderr de CI, donde convierte
// una suite verde en una suite verde con ruido que la gente aprende a ignorar.
//
// La salida facil es apagar todas las advertencias del proceso:
// `--no-warnings`, `NODE_NO_WARNINGS=1` o `process.removeAllListeners("warning")`.
// Las tres apagan tambien `DeprecationWarning` de una API que se va en la
// proxima mayor, y el aviso de una promesa rechazada sin manejar. Es el mismo
// fallo que la constitution nombra en otro sitio: no se baja un umbral para que
// una tarea avance.
//
// Lo que se hace es acotado en las dos dimensiones. En el TIEMPO: el parche
// vive solo mientras se carga el modulo, y se deshace en un `finally`. En el
// CONTENIDO: solo se traga la advertencia cuyo tipo es `ExperimentalWarning` y
// cuyo texto nombra SQLite; cualquier otra se reenvia al `emitWarning` real,
// aunque llegue durante esa ventana.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { esAdvertenciaExperimentalDeSqlite, sinLaAdvertenciaDeSqlite } from "../src/sqlite.mjs";

const SRC = new URL("../src/", import.meta.url).pathname;

test("el filtro reconoce la advertencia de SQLite en las dos formas de `emitWarning`", () => {
  assert.equal(
    esAdvertenciaExperimentalDeSqlite("SQLite is an experimental feature and might change at any time", "ExperimentalWarning"),
    true,
  );
  assert.equal(
    esAdvertenciaExperimentalDeSqlite("SQLite is an experimental feature", { type: "ExperimentalWarning" }),
    true,
  );
  const comoError = Object.assign(new Error("SQLite is an experimental feature"), { name: "ExperimentalWarning" });
  assert.equal(esAdvertenciaExperimentalDeSqlite(comoError, undefined), true);
});

test("EL INVARIANTE: el filtro NO se traga ninguna otra advertencia", () => {
  const otras = [
    ["util.isArray is deprecated", "DeprecationWarning"],
    ["Fetch API is an experimental feature", "ExperimentalWarning"],
    ["vm.measureMemory is an experimental feature", "ExperimentalWarning"],
    ["Unhandled promise rejection", "UnhandledPromiseRejectionWarning"],
    ["SQLite connection is slow", "PerformanceWarning"],
    ["MaxListenersExceededWarning: 11 listeners added", "MaxListenersExceededWarning"],
  ];
  for (const [texto, tipo] of otras) {
    assert.equal(esAdvertenciaExperimentalDeSqlite(texto, tipo), false, `se tragaria: ${tipo} ${texto}`);
  }
});

test("durante la ventana solo desaparece la de SQLite: el resto llega al `emitWarning` real", async () => {
  // Esto se prueba sin depender de la version de Node: la advertencia real solo
  // existe en 22 y 24, y esta prueba tiene que valer tambien en la version en
  // la que `node:sqlite` deje de ser experimental.
  const original = process.emitWarning;
  const llegaron = [];
  process.emitWarning = (aviso, ...resto) => llegaron.push([String(aviso), resto[0]]);
  try {
    await sinLaAdvertenciaDeSqlite(async () => {
      process.emitWarning("SQLite is an experimental feature", "ExperimentalWarning");
      process.emitWarning("otra cosa del todo", "DeprecationWarning");
      await Promise.resolve();
      process.emitWarning("Fetch API is an experimental feature", "ExperimentalWarning");
    });
  } finally {
    process.emitWarning = original;
  }
  assert.deepEqual(llegaron, [
    ["otra cosa del todo", "DeprecationWarning"],
    ["Fetch API is an experimental feature", "ExperimentalWarning"],
  ]);
});

test("el parche se deshace aunque lo de dentro reviente", () => {
  const original = process.emitWarning;
  return sinLaAdvertenciaDeSqlite(() => {
    throw new Error("revento");
  }).then(
    () => assert.fail("tenia que propagar el error"),
    () => assert.equal(process.emitWarning, original, "el `emitWarning` quedo parcheado para siempre"),
  );
});

/** Corre un guion de modulo en un proceso limpio y devuelve sus dos salidas. */
function enUnProcesoLimpio(guion) {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", guion], { encoding: "utf8" });
  assert.equal(r.status, 0, `el guion fallo:\n${r.stderr}`);
  return { stdout: r.stdout, stderr: r.stderr };
}

const IMPORTA_EL_ALMACEN = `import { abrirAlmacen } from ${JSON.stringify(new URL("../src/index.mjs", import.meta.url).href)};`;

test("abrir el almacen en un proceso limpio no escribe NADA en stderr", () => {
  // La prueba de verdad, la que cae en Node 22 y 24 si el parche no esta. En
  // una version donde `node:sqlite` ya no avisa pasa trivialmente — y sigue
  // valiendo, porque lo que afirma es la promesa: el sidecar no ensucia su
  // stderr solo por abrir el almacen.
  const { stdout, stderr } = enUnProcesoLimpio(`
    ${IMPORTA_EL_ALMACEN}
    abrirAlmacen({ ruta: ":memory:" }).cerrar();
    process.stdout.write("listo");
  `);
  assert.equal(stderr, "", `el almacen escribio en stderr al abrirse:\n${stderr}`);
  assert.equal(stdout, "listo");
});

test("EL INVARIANTE: importar el almacen NO apaga las advertencias del proceso que lo usa", () => {
  // EL FALLO QUE EVITA. Un silenciado global puesto al cargar el modulo no se
  // nota hasta que alguien pierde una `DeprecationWarning` en el sidecar y
  // descubre en la siguiente mayor de Node que llevaba meses avisando.
  const { stderr } = enUnProcesoLimpio(`
    ${IMPORTA_EL_ALMACEN}
    abrirAlmacen({ ruta: ":memory:" }).cerrar();
    process.emitWarning("una advertencia que si importa", "DeprecationWarning");
    await new Promise((r) => setTimeout(r, 30));
  `);
  assert.match(stderr, /una advertencia que si importa/, "el almacen dejo el proceso sordo a las advertencias");
  assert.ok(!/SQLite is an experimental feature/.test(stderr), "la advertencia de SQLite si tenia que desaparecer");
});

test("ningun archivo del paquete apaga las advertencias a lo bruto", () => {
  const PROHIBIDOS = [/--no-warnings/, /NODE_NO_WARNINGS/, /removeAllListeners\(\s*["']warning["']/];
  const hallazgos = [];
  for (const archivo of fuentes(SRC)) {
    const texto = readFileSync(archivo, "utf8").replace(/^\s*\/\/.*$/gm, "");
    for (const re of PROHIBIDOS) {
      const m = texto.match(re);
      if (m) hallazgos.push(`${archivo}: ${m[0]}`);
    }
  }
  assert.deepEqual(hallazgos, [], `el almacen apaga advertencias que no son suyas:\n${hallazgos.join("\n")}`);
});

test("`node:sqlite` se menciona en UN solo archivo: es experimental y su API puede cambiar", () => {
  // Si la API cambia entre versiones de Node, el arreglo tiene que caber en un
  // archivo. Un `new DatabaseSync(...)` repartido por los repositorios convierte
  // un cambio de firma en un recorrido por todo el paquete.
  const conSqlite = fuentes(SRC).filter((a) => /["']node:sqlite["']/.test(readFileSync(a, "utf8")));
  assert.deepEqual(
    conSqlite.map((a) => a.slice(SRC.length)),
    ["sqlite.mjs"],
  );
});

/** @param {string} dir @param {string[]} acc @returns {string[]} */
function fuentes(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) fuentes(p, acc);
    else if (p.endsWith(".mjs")) acc.push(p);
  }
  return acc;
}
