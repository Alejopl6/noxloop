// La flota dice COMO se fuerza el TDD de cada agente (spec 005, FR-008 (b)).
//
// El servicio ya manda `tdd` por agente (`por_hook`, `por_motor`, `no_aplica`,
// o `null`), y la pantalla no lo pintaba: el operador elegia un implementador
// sin hooks sin saber que el test-primero lo sostiene el motor DESPUES de la
// fase, revirtiendo, en vez de un hook que bloquea antes. Se prueba lo que se
// DICE, que es lo que puede mentir; la pintura compila igual.

import { test } from "node:test";
import assert from "node:assert/strict";

import { explicarTdd } from "../lib/tdd.ts";

test("por_hook: el hook bloquea ANTES de escribir", () => {
  const e = explicarTdd("por_hook");
  assert.equal(e.etiqueta, "TDD por hook");
  assert.match(e.frase, /hook/);
  assert.match(e.frase, /antes/i);
  assert.equal(e.tono, "exito");
});

test("por_motor: el motor revierte DESPUES de la fase, y se dice que no es el bloqueo en caliente", () => {
  const e = explicarTdd("por_motor");
  assert.equal(e.etiqueta, "TDD por el motor");
  assert.match(e.frase, /despu[eé]s/i);
  assert.match(e.frase, /revierte/);
  assert.equal(e.tono, "informativo");
});

test("no_aplica: el rol no escribe produccion", () => {
  const e = explicarTdd("no_aplica");
  assert.match(e.frase, /no escribe/);
});

test("null o ausente: NO se afirma nada — se dice que no se sabe o que nadie lo sostiene", () => {
  const nulo = explicarTdd(null);
  assert.equal(nulo.tono, "advertencia");
  assert.match(nulo.frase, /nadie|no se sabe/i);
  const ausente = explicarTdd(undefined);
  assert.match(ausente.frase, /no se sabe/i);
});
