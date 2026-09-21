// Regla 6 del contrato (FR-032): git y el SCM no pasan por la capa de
// integracion.
//
// EL FALLO QUE EVITA. Clonar, ramificar y abrir un PR son el camino critico del
// motor. Si pasaran por aqui, cada tarea dependeria de que la capa de
// integracion este arriba: se cae, y no es que no puedas conectar Linear, es
// que no puedes trabajar. Lo que si pasa por aqui es la CREDENCIAL del SCM, que
// es inventario y no transporte.

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

test("EL INVARIANTE: ninguna fuente lanza un proceso ni ejecuta git", () => {
  const PROHIBIDOS = [
    [/["']node:child_process["']/, "lanzamiento de subprocesos"],
    [/\bgit\s+(?:clone|push|fetch|checkout|merge|commit)\b/, "una operacion de git"],
    [/\bpr\s+create\b/, "la apertura de un PR"],
  ];
  const hallazgos = [];
  for (const archivo of fuentes(SRC)) {
    const texto = readFileSync(archivo, "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [re, que] of PROHIBIDOS) {
      const m = texto.match(re);
      if (m) hallazgos.push(`${archivo}: ${que} (${m[0]})`);
    }
  }
  assert.deepEqual(hallazgos, [], `la capa de integracion se metio en el camino critico:\n${hallazgos.join("\n")}`);
});

test("la credencial del SCM si vive aqui: es inventario", async () => {
  // La otra mitad de la regla. Que git no pase por aqui no significa que el
  // token del SCM no se gestione aqui: el catalogo clasifica proveedores de
  // clase `scm` y son conexiones como cualquier otra.
  const { CATALOGO_POR_DEFECTO } = await import("../src/catalogo.mjs");
  const scm = CATALOGO_POR_DEFECTO.filter((p) => p.clase === "scm");
  assert.ok(scm.length > 0, "no hay ningun proveedor de clase scm: la credencial del SCM se quedo sin inventario");
});
