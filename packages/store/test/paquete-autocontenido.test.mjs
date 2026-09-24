// El almacen viaja solo, igual que el servicio, la boveda y el scanner.
//
// EL FALLO QUE EVITA. Este paquete se empaqueta como recurso del sidecar: al
// escritorio viajan `packages/store/{package.json,src}` y nada mas. Un import
// relativo que salga del paquete —a `packages/vault`, a `packages/engine`—
// resuelve perfectamente dentro del repositorio y revienta al abrir la
// aplicacion instalada, con un `ERR_MODULE_NOT_FOUND` que el operador ve como
// una ventana que no abre y nadie relaciona con un import.
//
// AQUI LA TENTACION TIENE NOMBRE. Este paquete implementa la interfaz
// `RepositorioDeBoveda` que declara `packages/vault/src/repositorio.mjs`, y lo
// natural es importar de ahi el `@typedef`, o `estadoDelGrant`, o las
// constantes de `BACKENDS`. Cualquiera de las tres mata el sidecar. La lista de
// metodos se copia a mano en `test/vista-inversa.test.mjs` a proposito: si la
// interfaz cambia, cae esa prueba, que es exactamente donde tiene que caer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname;

/** @param {string} dir @param {string[]} acc @returns {string[]} */
function fuentes(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) fuentes(p, acc);
    else if (p.endsWith(".mjs")) acc.push(p);
  }
  return acc;
}

test("EL INVARIANTE: ningun import de `src/` sale de `packages/store/`", () => {
  const fuera = [];
  for (const archivo of fuentes(SRC)) {
    const texto = readFileSync(archivo, "utf8");
    for (const m of texto.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const especificador = m[1];
      if (especificador.startsWith("node:")) continue;
      if (especificador.startsWith(".")) {
        if (/(^|\/)\.\.\/\.\.\//.test(especificador)) fuera.push(`${archivo}: ${especificador}`);
        continue;
      }
      // Sin dependencias de npm: lo unico importable es Node y el propio paquete.
      fuera.push(`${archivo}: ${especificador}`);
    }
  }
  assert.deepEqual(fuera, [], `hay imports que salen del paquete:\n${fuera.join("\n")}`);
});

test("el paquete declara como recurso lo mismo que importa", () => {
  const manifiesto = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifiesto.files, ["src"]);
  assert.equal(manifiesto.type, "module");
  assert.equal(manifiesto.dependencies, undefined, "una dependencia de npm no viaja con el recurso");
});

test("el manifiesto pide 22.5 y no 22: `node:sqlite` no existe antes", () => {
  // EL FALLO QUE EVITA. El resto del repositorio declara `>=22` y le vale. Este
  // paquete importa un modulo que Node 22.0 no trae: declarar `>=22` aqui es un
  // limite que se lee como puesto y no lo esta, y el sintoma en la maquina del
  // operador es `ERR_UNKNOWN_BUILTIN_MODULE` al abrir la aplicacion.
  const manifiesto = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(manifiesto.engines.node, /22\.5/);
});

test("el almacen no escribe estado de run: ni tareas, ni intentos, ni gates, ni locks", () => {
  // EL INVARIANTE DEL PRINCIPIO III, Y ES EL QUE SOSTIENE LA RETOMABILIDAD.
  // `data-model.md` lo dice con todas las letras: "el almacen consultable no
  // puede volverse la fuente de verdad del run. Si un hook necesitara abrir
  // SQLite para saber si el rojo existe, el principio III se rompe y con el la
  // retomabilidad". Un hook corre dentro de un worktree, sin dependencias y sin
  // conexion abierta: tiene que leer un archivo y decidir en milisegundos.
  //
  // Esta guarda mira el esquema, que es donde se veria: una tabla llamada
  // `task`, `attempt`, `gate`, `lock` o `run` seria la senal de que el almacen
  // empezo a guardar lo que le toca a `state.mjs`.
  const PROHIBIDAS = /^(run|runs|task|tasks|attempt|attempts|gate|gates|lock|locks|verdict|veredicto|budget|presupuesto)$/i;
  const hallazgos = [];
  for (const archivo of fuentes(SRC)) {
    const texto = readFileSync(archivo, "utf8");
    for (const m of texto.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z_]+)"?/gi)) {
      if (PROHIBIDAS.test(m[1])) hallazgos.push(`${archivo}: ${m[1]}`);
    }
  }
  assert.deepEqual(hallazgos, [], `el almacen empezo a guardar estado del run:\n${hallazgos.join("\n")}`);
});

test("el almacen no lee el estado del run: no toca `NOXLOOP_HOME` ni el sistema de archivos del run", () => {
  // La otra mitad del mismo principio. El almacen recibe una ruta de archivo y
  // abre esa: no sale a buscar el home, no lista directorios y no lee ningun
  // JSON de estado. La proyeccion archivos -> SQLite es una costura declarada
  // (ver el TODO en `src/almacen.mjs`) y no existe todavia.
  const PROHIBIDOS = [/NOXLOOP_HOME/, /readFileSync/, /readdirSync/, /["']node:fs["']/, /["']node:child_process["']/];
  const hallazgos = [];
  for (const archivo of fuentes(SRC)) {
    const texto = readFileSync(archivo, "utf8").replace(/^\s*\/\/.*$/gm, "");
    for (const re of PROHIBIDOS) {
      const m = texto.match(re);
      if (m) hallazgos.push(`${archivo}: ${m[0]}`);
    }
  }
  assert.deepEqual(hallazgos, [], `el almacen empezo a leer el estado del run:\n${hallazgos.join("\n")}`);
});
