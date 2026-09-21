// Las guardas de empaquetado de ESTE paquete, que es el primero del bundle con
// dependencias de terceros.
//
// LO QUE CAMBIA RESPECTO DE LOS OTROS PAQUETES. `packages/core`,
// `packages/scanner`, `packages/vault`, `packages/store` y `packages/adapters`
// tienen una guarda que dice, literalmente, "ninguna fuente depende de un
// paquete de terceros". Aqui no se puede decir eso: la asistencia ES una
// llamada a un SDK. Lo que se puede decir, y es lo que esta guarda dice, es
// donde esta permitido importarlo:
//
//   - UN solo archivo —`proveedor-ai-sdk.mjs`— tiene especificadores desnudos.
//     Todo lo demas corre con Node y nada mas, y por eso todo lo demas se puede
//     probar sin red y sigue funcionando cuando el SDK no esta.
//   - Ese archivo importa DINAMICAMENTE. No es estilo: un import estatico hace
//     que cargar el paquete falle entero si el SDK no esta, y entonces la
//     asistencia no puede declarar su ausencia porque ni siquiera llega a
//     cargarse. La ausencia declarada es el producto; la excepcion de carga es
//     una ventana que no abre.
//
// EL FALLO QUE ESTO CIERRA, Y YA MORDIO DOS VECES EN ESTE REPOSITORIO. Al
// escritorio viaja lo que `tauri.conf.json` declara y nada mas. Un import que
// resuelve en el repositorio y no en el bundle muere con `ERR_MODULE_NOT_FOUND`
// al abrir la aplicacion instalada, y el operador lo ve como una ventana que no
// abre. La guarda que ata los imports a los recursos vive en
// `packages/service/test/recursos-del-escritorio.test.mjs`; esta de aqui
// sostiene la mitad que le toca: que la frontera sea UNA y este donde se dice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { fuentes } from "./ayuda.mjs";

const SRC = new URL("../src/", import.meta.url).pathname;

/** El unico archivo con permiso para nombrar un paquete de terceros. */
const LA_FRONTERA = "proveedor-ai-sdk.mjs";

/**
 * Los especificadores no relativos de un texto, estaticos y dinamicos.
 *
 * @param {string} texto
 * @returns {string[]}
 */
function desnudos(texto) {
  const sinComentarios = texto.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const encontrados = [];
  for (const m of sinComentarios.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    if (m[1].startsWith(".")) continue;
    if (m[1].startsWith("node:")) continue;
    encontrados.push(m[1]);
  }
  return encontrados;
}

test("ningun import de `src/` sale del paquete por arriba", () => {
  const fuera = [];
  for (const archivo of fuentes(SRC)) {
    const texto = readFileSync(archivo, "utf8");
    for (const m of texto.matchAll(/(?:from|import)\s*\(?\s*["'](\.\.?\/[^"']+)["']/g)) {
      if (/(^|\/)\.\.\/\.\.\//.test(m[1])) fuera.push(`${archivo}: ${m[1]}`);
    }
  }
  assert.deepEqual(fuera, [], `hay imports que salen del paquete:\n${fuera.join("\n")}`);
});

test("LA FRONTERA ES UNA: solo `proveedor-ai-sdk.mjs` nombra un paquete de terceros", () => {
  const infractores = [];
  let enLaFrontera = 0;
  for (const archivo of fuentes(SRC)) {
    const encontrados = desnudos(readFileSync(archivo, "utf8"));
    if (basename(archivo) === LA_FRONTERA) {
      enLaFrontera += encontrados.length;
      continue;
    }
    for (const e of encontrados) infractores.push(`${archivo}: ${e}`);
  }

  // Sin esto el test es vacio: si la frontera se quedara sin imports, el resto
  // pasaria por no haber nada que encontrar en ninguna parte.
  assert.ok(
    enLaFrontera >= 2,
    `\`${LA_FRONTERA}\` no importa ningun paquete de terceros (${enLaFrontera}): o la frontera se movio ` +
      "y esta guarda dejo de mirar donde tiene que mirar, o el proveedor de verdad desaparecio",
  );

  assert.deepEqual(
    infractores,
    [],
    "hay paquetes de terceros importados fuera de la frontera:\n" +
      infractores.join("\n") +
      `\nTodo lo que no sea \`${LA_FRONTERA}\` tiene que correr con Node y nada mas: es lo que hace que la ` +
      "asistencia se pueda probar sin red y que el resto del producto siga entero cuando el SDK no esta.",
  );
});

test("la frontera importa DINAMICAMENTE: un import estatico impide declarar la ausencia", () => {
  const texto = readFileSync(new URL(`../src/${LA_FRONTERA}`, import.meta.url), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const estaticos = [...texto.matchAll(/^\s*import\s+[^(]*?from\s+["']([^"'.][^"']*)["']/gm)].map((m) => m[1]);
  assert.deepEqual(
    estaticos,
    [],
    "hay imports estaticos de terceros en la frontera:\n" +
      estaticos.join("\n") +
      "\nCon un import estatico, cargar este modulo revienta cuando el SDK no esta — y entonces la " +
      "asistencia no puede declarar su ausencia con causa y accion, porque no llega a cargarse.",
  );

  assert.ok(
    /await\s+import\s*\(\s*["']ai["']\s*\)/.test(texto),
    "la frontera ya no hace `await import(\"ai\")`: si el SDK se carga de otra forma, esta guarda dejo de mirar",
  );
});

test("el manifiesto declara las dependencias que la frontera importa, y ninguna mas", () => {
  // Las dos listas tienen que coincidir. Un paquete importado y no declarado no
  // aparece en ningun inventario; uno declarado y no importado engorda el
  // instalador con codigo muerto y hace creer que forma parte de la superficie.
  const manifiesto = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const declaradas = Object.keys(manifiesto.dependencies ?? {}).sort();

  const importados = new Set();
  for (const archivo of fuentes(SRC)) {
    for (const especificador of desnudos(readFileSync(archivo, "utf8"))) {
      // `ai/test` y `@ai-sdk/anthropic/internal` son subrutas del mismo paquete.
      const partes = especificador.split("/");
      importados.add(especificador.startsWith("@") ? `${partes[0]}/${partes[1]}` : partes[0]);
    }
  }

  assert.deepEqual([...importados].sort(), declaradas);
  assert.equal(manifiesto.type, "module");
  assert.deepEqual(manifiesto.files, ["src"]);
});

test("este paquete no ejecuta nada ni escribe nada: propone, y proponer no toca el disco", () => {
  // Una asistencia con `child_process` es un camino por el que el texto que
  // devolvio un modelo acaba siendo un comando que corre con los permisos del
  // operador. Y una que escribe con `fs` decide, que es justo lo que este
  // paquete no hace: la escritura de una guideline pasa por `PUT` y por una
  // persona.
  const PROHIBIDOS = [/["']node:child_process["']/, /["']node:fs["']/, /["']node:vm["']/, /\bexecSync\b/];
  const hallazgos = [];
  for (const archivo of fuentes(SRC)) {
    const texto = readFileSync(archivo, "utf8").replace(/^\s*\/\/.*$/gm, "");
    for (const re of PROHIBIDOS) {
      const m = texto.match(re);
      if (m) hallazgos.push(`${archivo}: ${m[0]}`);
    }
  }
  assert.deepEqual(hallazgos, [], `la asistencia adquirio la capacidad de ejecutar o de escribir:\n${hallazgos.join("\n")}`);
});

test("NINGUNA PRUEBA DE ESTE PAQUETE LLAMA A UN MODELO: ni importa la frontera, ni toca la red", () => {
  // La guarda de la guarda. Una suite que llama al modelo de verdad tarda,
  // cuesta dinero, y falla cuando no hay red — y lo que falla cuando no hay red
  // se acaba desactivando. Ademas seria no determinista: el dia que el modelo
  // devuelva algo distinto, el fallo aparece sin que nadie haya tocado nada.
  const TESTS = new URL("../test/", import.meta.url).pathname;
  const infractores = [];
  let laEjercitan = 0;
  for (const archivo of fuentes(TESTS)) {
    const texto = readFileSync(archivo, "utf8").replace(/^\s*\/\/.*$/gm, "");
    // Quien importe la frontera tiene que inyectarle `cargar`. Sin eso, el
    // modulo del SDK se carga de verdad y la siguiente linea es una llamada a
    // la red — que es justo lo que no puede pasar.
    if (texto.includes(`../src/${LA_FRONTERA}`)) {
      laEjercitan++;
      if (!/cargar\s*:/.test(texto)) infractores.push(`${archivo}: importa la frontera sin inyectarle \`cargar\``);
    }
    for (const re of [/\bfetch\s*\(/, /["']node:https?["']/, /\bANTHROPIC_API_KEY\b/]) {
      const m = texto.match(re);
      if (m) infractores.push(`${archivo}: ${m[0]}`);
    }
  }
  assert.ok(laEjercitan > 0, "ninguna prueba ejercita la frontera: su degradacion no esta cubierta por nadie");
  assert.deepEqual(infractores, [], `hay pruebas que podrian llamar a un modelo de verdad:\n${infractores.join("\n")}`);
});
