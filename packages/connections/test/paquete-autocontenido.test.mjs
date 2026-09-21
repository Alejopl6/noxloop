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
// que falta —el que habla con la capa de integracion alojada— trae consigo dos
// dependencias con licencia Elastic 2.0. Mientras no entren, este paquete no
// depende de nada, y esta prueba es la que hace visible el dia que entren: no
// las prohibe para siempre, obliga a que su llegada sea una decision con diff
// en vez de un `npm install` de paso.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname;

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
      fuera.push(`${archivo}: ${especificador}`);
    }
  }
  assert.deepEqual(fuera, [], `hay imports que salen del paquete:\n${fuera.join("\n")}`);
});

test("la boveda llega inyectada, no importada: es la unica forma de que este paquete viaje solo", () => {
  const hallazgos = [];
  for (const archivo of fuentes(SRC)) {
    const texto = readFileSync(archivo, "utf8").replace(/^\s*\/\/.*$/gm, "");
    if (/vault|\/boveda\.mjs/.test(texto)) hallazgos.push(archivo);
  }
  assert.deepEqual(hallazgos, [], `una fuente alcanza la boveda por su ruta:\n${hallazgos.join("\n")}`);
});

test("el manifiesto declara que lo que viaja es `src/`, y que no hay dependencias", () => {
  const manifiesto = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifiesto.files, ["src"]);
  assert.equal(manifiesto.type, "module");
  assert.equal(manifiesto.dependencies, undefined, "una dependencia de npm no viaja con el recurso");
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
