// El scanner viaja solo, igual que el servicio de control.
//
// EL FALLO QUE EVITA. Este paquete se empaqueta como recurso del sidecar: al
// escritorio viajan `packages/scanner/{package.json,src}` y nada mas. Un import
// relativo que salga del paquete —a `packages/engine`, a `providers/`— resuelve
// perfectamente dentro del repositorio y revienta al abrir la aplicacion
// instalada, con un ERR_MODULE_NOT_FOUND que el operador ve como una ventana
// que no abre y nadie relaciona con un import.
//
// El servicio ya tiene esta guarda por la misma razon. La lista de paquetes que
// tienen que viajar solos crece, y la guarda tiene que crecer con ella: un
// paquete nuevo que nadie mira es exactamente donde vuelve a entrar el import.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
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

test("ningun import de `src/` sale del paquete", () => {
  const fuera = [];
  for (const archivo of fuentes(SRC)) {
    const texto = readFileSync(archivo, "utf8");
    for (const m of texto.matchAll(/(?:from|import)\s*\(?\s*["'](\.\.?\/[^"']+)["']/g)) {
      if (/(^|\/)\.\.\/\.\.\//.test(m[1])) fuera.push(`${archivo}: ${m[1]}`);
    }
  }
  assert.deepEqual(fuera, [], `hay imports que salen del paquete:\n${fuera.join("\n")}`);
});

test("ninguna fuente depende de un paquete de terceros: el scanner corre con Node y nada mas", () => {
  // La constitucion lo dice del motor y vale igual aqui: sin dependencias en el
  // camino critico. Un scanner que necesita un parser de YAML instalado es un
  // scanner que no arranca en la maquina del operador el dia que el registro
  // esta caido.
  const externos = [];
  for (const archivo of fuentes(SRC)) {
    const texto = readFileSync(archivo, "utf8");
    for (const m of texto.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const especificador = m[1];
      if (especificador.startsWith(".")) continue;
      if (especificador.startsWith("node:")) continue;
      externos.push(`${archivo}: ${especificador}`);
    }
  }
  assert.deepEqual(externos, [], `el scanner adquirio dependencias:\n${externos.join("\n")}`);
});

test("el manifiesto declara que lo que viaja es `src/`", () => {
  const manifiesto = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifiesto.files, ["src"]);
  assert.equal(manifiesto.type, "module");
  assert.equal(manifiesto.dependencies, undefined, "el scanner no tiene dependencias de runtime");
});

test("el scanner no importa nada que pueda escribir ni ejecutar", () => {
  // La promesa se prueba midiendo el disco, pero esta guarda la protege antes:
  // `child_process` es como se ejecuta un script del proyecto ajeno con los
  // permisos del operador, y las funciones de escritura de `fs` son como se
  // rompe la promesa sin querer, en un `mkdtemp` para una cache.
  const PROHIBIDOS = [
    /["']node:child_process["']/,
    /["']node:worker_threads["']/,
    /\bwriteFile(?:Sync)?\b/,
    /\bappendFile(?:Sync)?\b/,
    /\bmkdir(?:Sync)?\b/,
    /\bmkdtemp(?:Sync)?\b/,
    /\brm(?:Sync|dir)?\b/,
    /\bunlink(?:Sync)?\b/,
    /\brename(?:Sync)?\b/,
    /\bchmod(?:Sync)?\b/,
    /\butimes(?:Sync)?\b/,
    /\bcreateWriteStream\b/,
    /\bfs\.open\b|openSync\([^)]*["']w/,
  ];
  const hallazgos = [];
  for (const archivo of fuentes(SRC)) {
    const texto = readFileSync(archivo, "utf8").replace(/^\s*\/\/.*$/gm, "");
    for (const re of PROHIBIDOS) {
      const m = texto.match(re);
      if (m) hallazgos.push(`${archivo}: ${m[0]}`);
    }
  }
  assert.deepEqual(hallazgos, [], `el scanner adquirio la capacidad de escribir o ejecutar:\n${hallazgos.join("\n")}`);
});
