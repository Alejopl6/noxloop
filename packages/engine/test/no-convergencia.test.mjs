// Cortar cuando el intento produce EXACTAMENTE el mismo fallo que el anterior.
//
// POR QUE NO ALCANZA EL PRESUPUESTO POR BUCLE. El presupuesto acota cuantas
// veces se intenta; no distingue "cada vez estuvo mas cerca" de "tres veces lo
// mismo". El segundo caso es el que importa: si el modelo leyo el fallo, cambio
// algo, y el fallo salio identico, el tercer intento va a costar lo mismo y
// terminar igual. Y el diagnostico final tambien mejora — "agoto sus tres
// intentos" manda a mirar el presupuesto; "produjo el mismo fallo dos veces
// seguidas" manda a mirar el fallo.
//
// LA HUELLA TIENE QUE IGNORAR LO QUE CAMBIA SOLO. Dos corridas del mismo test
// que falla traen duraciones distintas, rutas de worktree distintas y a veces un
// pid. Comparar el texto crudo diria "son distintos" siempre, y el corte no se
// dispararia nunca: seria otro limite que se lee como puesto y no lo esta.

import { test } from "node:test";
import assert from "node:assert/strict";
import { huellaDeFallo, noConverge } from "../src/gate.mjs";

test("dos corridas del mismo fallo con duraciones distintas dan la misma huella", () => {
  const a = "FAIL test/saldo.test.ts (1243 ms)\n  x recalcula el cupo\n  expected 100 to equal 90";
  const b = "FAIL test/saldo.test.ts (887 ms)\n  x recalcula el cupo\n  expected 100 to equal 90";
  assert.equal(huellaDeFallo(a), huellaDeFallo(b));
});

test("la ruta del worktree no cambia la huella: cada intento corre en otro directorio", () => {
  const a = "Error: Cannot find module '/var/folders/ab/T/noxloop-x1/wt/src/a.ts'";
  const b = "Error: Cannot find module '/var/folders/zz/T/noxloop-q9/wt/src/a.ts'";
  assert.equal(huellaDeFallo(a), huellaDeFallo(b));
});

test("los colores de la terminal tampoco", () => {
  const a = "[31mFAIL[0m test/a.test.ts";
  const b = "FAIL test/a.test.ts";
  assert.equal(huellaDeFallo(a), huellaDeFallo(b));
});

test("una hora y un sha no cambian la huella", () => {
  const a = "2026-09-17T21:04:11.101Z falla en a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
  const b = "2026-09-18T02:55:02.900Z falla en f0e1d2c3b4a59687786950413223140506070809";
  assert.equal(huellaDeFallo(a), huellaDeFallo(b));
});

test("dos fallos DISTINTOS dan huellas distintas: el corte no puede tragarse trabajo que avanza", () => {
  const a = "expected 100 to equal 90";
  const b = "expected 100 to equal 95";
  assert.notEqual(huellaDeFallo(a), huellaDeFallo(b));
});

test("pasar de tres tests que fallan a uno es avance, y se nota", () => {
  const a = "Tests: 3 failed, 10 passed";
  const b = "Tests: 1 failed, 12 passed";
  assert.notEqual(huellaDeFallo(a), huellaDeFallo(b), "los conteos son la señal de avance mas comun");
});

test("un texto vacio no tiene huella: no se puede comparar contra nada", () => {
  assert.equal(huellaDeFallo(""), null);
  assert.equal(huellaDeFallo(null), null);
  assert.equal(huellaDeFallo("   \n  "), null);
});

// ------------------------------------------------------------- la decision

test("la primera vez nunca corta: no hay con que comparar", () => {
  assert.equal(noConverge(null, "abc").corta, false);
});

test("dos veces la misma huella corta", () => {
  const r = noConverge("abc", "abc");
  assert.equal(r.corta, true);
  assert.match(r.porque, /mismo fallo/i);
});

test("una huella distinta no corta, aunque siga fallando", () => {
  assert.equal(noConverge("abc", "xyz").corta, false);
});

test("sin huella nueva no se corta: no saber no es converger ni dejar de hacerlo", () => {
  assert.equal(noConverge("abc", null).corta, false);
});
