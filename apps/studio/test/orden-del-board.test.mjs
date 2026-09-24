// El orden a mano del board, en el cliente (`components/board/orden.ts`, spec
// 005, FR-005): que lista le manda la pantalla al servicio al subir, bajar o
// soltar una tarjeta.
//
// POR QUE IMPORTA. El servicio REEMPLAZA el orden de la columna con la lista
// que llega. Una lista con solo lo visible (con un filtro puesto) borraria la
// posicion de lo oculto; una lista con tarjetas de otro proyecto (en «Todos»)
// guardaria en un proyecto ids que son del otro. Eso compila y se ve bien
// hasta que el operador quita el filtro.

import { test } from "node:test";
import assert from "node:assert/strict";

import { moverTarjeta, puedeMover, soltarAntesDe } from "../components/board/orden.ts";

const t = (proyecto, id) => ({ id: `${proyecto}:${id}`, proyecto: { id: proyecto }, ticket: { id } });

const columna = [t("a", "1"), t("b", "1"), t("a", "2"), t("a", "3")];

test("subir: se cambia con la anterior DE SU proyecto, y la lista es solo de ese proyecto", () => {
  assert.deepEqual(moverTarjeta(columna, columna, "a:2", -1), { proyectoId: "a", itemIds: ["2", "1", "3"] });
  assert.deepEqual(moverTarjeta(columna, columna, "a:3", -1), { proyectoId: "a", itemIds: ["1", "3", "2"] });
});

test("bajar, y los bordes: la primera no sube, la ultima no baja", () => {
  assert.deepEqual(moverTarjeta(columna, columna, "a:1", 1), { proyectoId: "a", itemIds: ["2", "1", "3"] });
  assert.equal(moverTarjeta(columna, columna, "a:1", -1), null);
  assert.equal(moverTarjeta(columna, columna, "a:3", 1), null);
  assert.equal(puedeMover(columna, "a:1", -1), false);
  assert.equal(puedeMover(columna, "a:1", 1), true);
  assert.equal(puedeMover(columna, "b:1", 1), false, "b:1 es la unica de su proyecto");
});

test("con filtro: se salta lo oculto, pero lo oculto SIGUE en la lista que se manda", () => {
  const visibles = [t("a", "1"), t("a", "3")];
  assert.deepEqual(moverTarjeta(columna, visibles, "a:3", -1), { proyectoId: "a", itemIds: ["3", "1", "2"] });
});

test("soltar antes de otra del mismo proyecto; sobre otro proyecto o sobre si misma no hace nada", () => {
  assert.deepEqual(soltarAntesDe(columna, "a:3", "a:1"), { proyectoId: "a", itemIds: ["3", "1", "2"] });
  assert.deepEqual(soltarAntesDe(columna, "a:1", null), { proyectoId: "a", itemIds: ["2", "3", "1"] }, "null = al final");
  assert.equal(soltarAntesDe(columna, "a:1", "b:1"), null);
  assert.equal(soltarAntesDe(columna, "a:1", "a:1"), null);
  assert.equal(soltarAntesDe(columna, "a:1", "a:2"), null, "ya estaba justo antes");
});

// ---------------------------------------------------------------------------
// La fila de espera de la cola global (`lib/orden-de-cola.ts`, FR-006)
// ---------------------------------------------------------------------------

import { reordenarEspera } from "../lib/orden-de-cola.ts";

test("cola: subir, bajar, «el siguiente» y los bordes", () => {
  const fila = ["a", "b", "c", "d"];
  assert.deepEqual(reordenarEspera(fila, "d", -3), ["d", "a", "b", "c"], "el ultimo pasa a ser el siguiente");
  assert.deepEqual(reordenarEspera(fila, "b", 1), ["a", "c", "b", "d"]);
  assert.deepEqual(reordenarEspera(fila, "c", -10), ["c", "a", "b", "d"], "acotado al borde");
  assert.equal(reordenarEspera(fila, "a", -1), null);
  assert.equal(reordenarEspera(fila, "zzz", 1), null);
});
