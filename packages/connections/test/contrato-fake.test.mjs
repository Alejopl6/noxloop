// T152 · el adaptador `fake` pasa la suite de contrato entera, sin red y sin
// credenciales.
//
// POR QUE EL FALSO CORRE LA MISMA SUITE QUE LOS DEMAS. Es el ejemplo minimo:
// si la suite solo corriera contra los adaptadores "de verdad", nadie sabria si
// un chequeo falla porque el adaptador esta mal o porque el chequeo exige algo
// que solo cumple quien tiene red. El falso es la linea base que separa las dos
// cosas.

import { test } from "node:test";
import assert from "node:assert/strict";

import { chequeosDeContrato } from "../src/contrato.mjs";
import { crearAdaptadorFalso, fixturesDeContrato } from "../src/adaptadores/fake.mjs";

test("el adaptador falso pasa la suite de contrato", async (t) => {
  const fx = fixturesDeContrato();
  const chequeos = chequeosDeContrato(fx);
  assert.equal(chequeos.length, 9, "la suite del contrato son nueve pruebas");
  for (const chequeo of chequeos) {
    await t.test(chequeo.name, async () => {
      await chequeo.run();
    });
  }
});

test("el falso ejercita LOS DOS caminos: hay un proveedor oauth2 y uno que no lo es", async () => {
  // Un falso con un solo modo deja sin ejercitar justo el camino donde estaba
  // el error: Azure DevOps y Vercel no son oauth2, y un adaptador probado solo
  // con oauth2 pasa verde y revienta con ellos.
  const proveedor = crearAdaptadorFalso();
  const catalogo = await proveedor.catalogo();
  const modos = new Set(catalogo.map((p) => p.modo));
  assert.ok(modos.has("oauth2"), "el catalogo falso no ejercita el camino oauth2");
  assert.ok([...modos].some((m) => m !== "oauth2"), "el catalogo falso no ejercita ningun camino que no sea oauth2");
});

test("el falso no habla con nadie: ni red, ni bóveda, ni contenedores", async () => {
  const proveedor = crearAdaptadorFalso();
  const estado = await proveedor.preflight();
  assert.equal(estado.ok, true, `el falso no deberia tener requisitos: ${JSON.stringify(estado.problemas)}`);
  assert.deepEqual(
    estado.requisitos.filter((r) => r.tipo === "contenedor"),
    [],
    "el falso declaro un contenedor: deja de servir como linea base de las pruebas",
  );
});
