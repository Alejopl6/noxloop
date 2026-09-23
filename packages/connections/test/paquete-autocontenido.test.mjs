// La capa de integracion viaja sola, igual que la boveda, el scanner y el
// servicio.
//
// EL FALLO QUE EVITA. Este paquete se empaqueta como recurso del sidecar: al
// escritorio viajan `packages/connections/{package.json,src}` y nada mas. Un
// import relativo que salga del paquete —a la boveda, a `providers/`— resuelve
// perfectamente dentro del repositorio y revienta al abrir la aplicacion
// instalada, con un ERR_MODULE_NOT_FOUND que el operador ve como una pantalla
// de conexiones que no carga y que nadie relaciona con un import.
//
// Y LA OTRA MITAD, QUE AQUI PESA MAS QUE EN NINGUN OTRO PAQUETE. El adaptador
// alojado trae consigo una dependencia con licencia Elastic 2.0. Esta prueba
// nunca la prohibio para siempre: obliga a que su llegada sea una decision con
// diff en vez de un `npm install` de paso. ESE DIA LLEGO, y el diff es este.
//
// LO QUE CAMBIO Y LO QUE NO. Ya no es «ninguna dependencia»: es UNA, declarada
// por nombre en `DEPENDENCIAS_PERMITIDAS`, y cualquier otra sigue rompiendo
// esta prueba. La guarda no se aflojo, se hizo explicita — que es distinto de
// quitarla, porque la lista se lee y la segunda dependencia vuelve a ser una
// conversacion.
//
// Y HAY UNA SEGUNDA GUARDA QUE ESTA NO REEMPLAZA: un especificador desnudo
// resuelve en el repositorio y NO en la aplicacion instalada, donde no hay
// `node_modules`. Quien lo comprueba de verdad es
// `packages/service/test/recursos-del-escritorio.test.mjs`, que monta el
// subarbol declarado fuera del repositorio y lo importa con un Node limpio.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname;

/**
 * Lo unico de npm que este paquete puede importar, y por que.
 *
 * `@nangohq/node` es el cliente oficial del servidor de integraciones. Entra
 * con su licencia Elastic 2.0 declarada en `LICENSE`, en el `README` y en
 * `docs/licencia-de-integraciones.md`, y hay una guarda en
 * `packages/engine/test/constitution.test.mjs` que ata las dos cosas.
 */
const DEPENDENCIAS_PERMITIDAS = Object.freeze(["@nangohq/node"]);

/**
 * @param {string} dir
 * @param {string[]} acc
 * @returns {string[]}
 */
function fuentes(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) fuentes(p, acc);
    else if (p.endsWith(".mjs")) acc.push(p);
  }
  return acc;
}

test("EL INVARIANTE: ningun import de `src/` sale de `packages/connections/`", () => {
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
      // Un especificador desnudo solo pasa si esta en la lista declarada. El
      // paquete de `@scope/nombre/sub` es `@scope/nombre`.
      const partes = especificador.split("/");
      const paquete = especificador.startsWith("@") ? `${partes[0]}/${partes[1]}` : partes[0];
      if (DEPENDENCIAS_PERMITIDAS.includes(paquete)) continue;
      fuera.push(`${archivo}: ${especificador}`);
    }
  }
  assert.deepEqual(
    fuera,
    [],
    `hay imports que salen del paquete:\n${fuera.join("\n")}\n` +
      `Lo unico de npm que este paquete puede importar es: ${DEPENDENCIAS_PERMITIDAS.join(", ")}. ` +
      "Una dependencia mas no es una linea de configuracion: viaja entera dentro del instalador que el " +
      "operador descarga, y su licencia viaja con ella.",
  );
});

test("cada dependencia permitida se usa de verdad: una declarada y no importada es peso muerto", () => {
  // La direccion contraria, y no es simetria por gusto. Un paquete declarado
  // en el manifiesto y no importado engorda el instalador con codigo que nadie
  // ejecuta, Y hace creer a quien lea la lista que forma parte de la superficie
  // del producto. Con una dependencia de licencia restrictiva eso es peor: se
  // arrastra la obligacion legal sin la contrapartida.
  const importados = new Set();
  for (const archivo of fuentes(SRC)) {
    const texto = readFileSync(archivo, "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of texto.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const especificador = m[1];
      if (especificador.startsWith(".") || especificador.startsWith("node:")) continue;
      const partes = especificador.split("/");
      importados.add(especificador.startsWith("@") ? `${partes[0]}/${partes[1]}` : partes[0]);
    }
  }
  const sinUsar = DEPENDENCIAS_PERMITIDAS.filter((p) => !importados.has(p));
  assert.deepEqual(sinUsar, [], `permitidas y no importadas por ninguna fuente: ${sinUsar.join(", ")}`);
});

test("la boveda llega inyectada, no importada: es la unica forma de que este paquete viaje solo", () => {
  const hallazgos = [];
  for (const archivo of fuentes(SRC)) {
    const texto = readFileSync(archivo, "utf8").replace(/^\s*\/\/.*$/gm, "");
    // LO QUE SE BUSCA ES UNA RUTA, NO LA PALABRA. La version anterior era
    // `/vault/` a secas y empezo a fallar el dia que el catalogo empotrado de
    // Nango trajo `veeva-vault` y `veeva-vault-oauth`, que son dos proveedores
    // reales de otra empresa: la prueba acusaba a un archivo de datos de
    // alcanzar la boveda porque un cliente de Veeva se llama asi. El invariante
    // no cambia —lo que esta prohibido es llegar a `packages/vault` por su
    // ruta— y las dos formas de hacerlo siguen cubiertas: un import relativo
    // (`../../vault/...`) y una ruta escrita a mano (`packages/vault`).
    if (/[./]vault\/|packages\/vault|\/boveda\.mjs/.test(texto)) hallazgos.push(archivo);
  }
  assert.deepEqual(hallazgos, [], `una fuente alcanza la boveda por su ruta:\n${hallazgos.join("\n")}`);
});

test("el manifiesto declara que lo que viaja es `src/`, y exactamente que dependencias", () => {
  const manifiesto = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifiesto.files, ["src"]);
  assert.equal(manifiesto.type, "module");
  assert.deepEqual(
    Object.keys(manifiesto.dependencies ?? {}).sort(),
    [...DEPENDENCIAS_PERMITIDAS].sort(),
    "el manifiesto y la lista declarada en esta prueba dicen cosas distintas: una dependencia que esta en el " +
      "manifiesto y no en la lista entro sin decision, y una que esta en la lista y no en el manifiesto no se instala",
  );
  assert.equal(manifiesto.devDependencies, undefined);
});

test("la persistencia se inyecta: no hay ningun almacen escrito aqui dentro", () => {
  // `packages/store` decide el almacen. Escribir aqui un esquema es comprometer
  // esa decision desde el sitio equivocado, y hay que rehacerlo entero cuando
  // se tome. Lo que si esta fijado son las operaciones.
  const hallazgos = [];
  for (const archivo of fuentes(SRC)) {
    const texto = readFileSync(archivo, "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const re of [/CREATE TABLE/i, /node:sqlite/, /\bINSERT INTO\b/i, /writeFileSync/]) {
      const m = texto.match(re);
      if (m) hallazgos.push(`${archivo}: ${m[0]}`);
    }
  }
  assert.deepEqual(hallazgos, [], `la capa de integracion se puso a persistir por su cuenta:\n${hallazgos.join("\n")}`);
});
