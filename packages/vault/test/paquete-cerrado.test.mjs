// La boveda viaja al escritorio como recurso suelto, igual que el servicio.
//
// EL FALLO QUE EVITA. Un import relativo que salga del paquete resuelve
// perfectamente en el repositorio y revienta al abrir la aplicacion instalada,
// con un ERR_MODULE_NOT_FOUND que el operador ve como una ventana que no abre.
// En este paquete el sintoma seria peor que en el servicio: la pantalla que no
// carga es la de las credenciales.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname;

function fuentes(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) fuentes(p, acc);
    else if (p.endsWith(".mjs")) acc.push(p);
  }
  return acc;
}

test("EL INVARIANTE: ningun import sale de `packages/vault/`", () => {
  const fuera = [];
  for (const archivo of fuentes(SRC)) {
    const texto = readFileSync(archivo, "utf8");
    for (const m of texto.matchAll(/from\s+["']([^"']+)["']/g)) {
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
  assert.equal(manifiesto.dependencies, undefined, "una dependencia de npm no viaja con el recurso");
});
