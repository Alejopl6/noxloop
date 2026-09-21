// FR-015: cancelado es un estado, no una excepcion que se traga.
//
// EL FALLO QUE EVITA. El operador aprieta cancelar sobre un monorepo enorme. Si
// el scanner devuelve lo que llevaba y lo marca `completo`, el snapshot parcial
// entra en el almacen como si fuera una lectura entera del proyecto: la
// constitution se construye sobre la mitad del arbol que dio tiempo a mirar, y
// no hay nada en el objeto que diga que falta la otra mitad. Un snapshot
// incompleto marcado como completo es indistinguible de un proyecto sin tests.
//
// Por eso `cancelado` no arrastra hallazgos: no hay forma de saber cuales
// faltaban, y una lista a medias invita a usarla igual.

import { test } from "node:test";
import assert from "node:assert/strict";

import { escanear } from "../src/index.mjs";
import { FASES } from "../src/fases.mjs";
import { arbolTemporal, escribir } from "./ayuda.mjs";

/** Un arbol con bastantes archivos para que la cancelacion llegue a tiempo. */
function arbolGrande() {
  /** @type {Record<string, string>} */
  const archivos = { "package.json": JSON.stringify({ name: "grande", type: "module" }) };
  for (let i = 0; i < 400; i++) archivos[`src/modulo${i}/archivo.mjs`] = `export const n${i} = ${i};\n`;
  return arbolTemporal(archivos);
}

test("cancelado a mitad deja estado cancelado y ningun hallazgo parcial", async () => {
  const raiz = arbolGrande();
  const control = new AbortController();

  const snapshot = await escanear({
    ruta: raiz,
    señales: control.signal,
    alProgresar: () => control.abort(),
  });

  assert.equal(snapshot.estado, "cancelado");
  assert.deepEqual(snapshot.hallazgos, [], "un snapshot cancelado arrastro hallazgos: invita a usarlos");
  assert.ok(FASES.includes(snapshot.fase_cancelada), `no se dijo en que fase se corto: ${snapshot.fase_cancelada}`);
  assert.ok(snapshot.motivo_cancelacion.length > 20, "no se dijo por que el snapshot esta a medias");
  assert.equal(typeof snapshot.duracion_ms, "number");
});

test("cancelar antes de empezar no arranca el recorrido", async () => {
  const raiz = arbolGrande();
  const control = new AbortController();
  control.abort();

  const snapshot = await escanear({ ruta: raiz, señales: control.signal });
  assert.equal(snapshot.estado, "cancelado");
  assert.equal(snapshot.fase_cancelada, "inventario");
  assert.deepEqual(snapshot.hallazgos, []);
});

test("cada fase atiende la señal: cancelar en la ultima fase tampoco devuelve un completo", async () => {
  // Una cancelacion que solo se mira al principio deja al operador esperando el
  // recorrido entero de un monorepo despues de haber apretado cancelar.
  const raiz = arbolGrande();
  for (const fase of FASES.slice(1)) {
    const control = new AbortController();
    const snapshot = await escanear({
      ruta: raiz,
      señales: control.signal,
      alProgresar: (p) => {
        if (p.fase === fase) control.abort();
      },
    });
    assert.equal(snapshot.estado, "cancelado", `cancelar en la fase \`${fase}\` devolvio un snapshot completo`);
    assert.deepEqual(snapshot.hallazgos, []);
  }
});

test("sin cancelacion, el progreso recorre todas las fases y la cuenta nunca retrocede", async () => {
  // "Nunca una barra que no se mueve": el progreso es lo unico que el operador
  // ve mientras el scanner trabaja, y una barra congelada se lee como colgado.
  const raiz = arbolTemporal({
    "package.json": JSON.stringify({ name: "x", type: "module", scripts: { test: "node --test" } }),
    "src/a.mjs": "export const a = 1;\n",
    "test/a.test.mjs": "import 'node:test';\n",
  });
  escribir(raiz, { ".github/workflows/ci.yml": "on: [push]\njobs:\n  t:\n    steps:\n      - run: npm test\n" });

  /** @type {any[]} */
  const progresos = [];
  const snapshot = await escanear({ ruta: raiz, alProgresar: (p) => progresos.push(p) });

  assert.equal(snapshot.estado, "completo");
  const fasesVistas = [...new Set(progresos.map((p) => p.fase))];
  assert.deepEqual(fasesVistas, FASES, "el progreso no recorre las fases del contrato en orden");

  for (const p of progresos) {
    assert.equal(typeof p.archivos_vistos, "number");
    assert.equal(typeof p.total_estimado, "number");
    assert.ok(p.archivos_vistos <= p.total_estimado, `${p.fase}: vistos por encima del total estimado`);
  }
});
