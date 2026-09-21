// Los adaptadores viajan solos, igual que el scanner y el servicio de control.
//
// EL FALLO QUE EVITA. Este paquete se empaqueta como recurso del sidecar: al
// escritorio viajan `packages/adapters/{package.json,src}` y nada mas. Un import
// relativo que salga del paquete —a `packages/engine`, a `packages/vault`, a
// `providers/`— resuelve perfectamente dentro del repositorio y revienta al
// abrir la aplicacion instalada, con un ERR_MODULE_NOT_FOUND que el operador ve
// como una ventana que no abre y nadie relaciona con un import.
//
// Y hay un motivo extra aqui: si el paquete de adaptadores pudiera importar el
// motor, la costura se cerraria por el lado equivocado. Un adaptador que llama
// al driver ya no es un adaptador, es una segunda mitad del motor.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
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

test("ninguna fuente depende de un paquete de terceros instalado de forma obligatoria", () => {
  // El SDK del modelo es la UNICA dependencia de runtime del producto, es
  // `optionalDependencies` del motor y puede no estar instalado. Por eso entra
  // solo por carga dinamica y dentro de un `try`: un `import` estatico lo
  // convertiria en obligatorio y el paquete no cargaria en una maquina que no
  // lo tiene — que es el caso que el adaptador existe para degradar.
  const externos = [];
  for (const archivo of fuentes(SRC)) {
    const texto = readFileSync(archivo, "utf8");
    for (const m of texto.matchAll(/(?:^|\s)(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g)) {
      const especificador = m[1];
      if (especificador.startsWith(".") || especificador.startsWith("node:")) continue;
      externos.push(`${archivo}: ${especificador}`);
    }
  }
  assert.deepEqual(externos, [], `los adaptadores adquirieron dependencias obligatorias:\n${externos.join("\n")}`);
});

test("el manifiesto declara que lo que viaja es `src/`, y sin dependencias", () => {
  const manifiesto = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifiesto.files, ["src"]);
  assert.equal(manifiesto.type, "module");
  assert.equal(manifiesto.dependencies, undefined);
});

test("el paquete no importa el motor ni la boveda ni los proveedores, por ningun camino", () => {
  const hallazgos = [];
  for (const archivo of fuentes(SRC)) {
    const texto = readFileSync(archivo, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const m of texto.matchAll(/["']([^"']*(?:packages\/(?:engine|vault|core|store|service|scanner)|providers)\/[^"']*)["']/g)) {
      hallazgos.push(`${archivo}: ${m[1]}`);
    }
  }
  assert.deepEqual(hallazgos, [], `los adaptadores alcanzaron otro paquete:\n${hallazgos.join("\n")}`);
});
