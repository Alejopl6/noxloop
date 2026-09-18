// Ningun tope puede acotar cobertura en silencio.
//
// POR QUE. Un recorte que no se registra se lee como "se cubrio todo". Es el
// mismo modo de fallo que el verde inventado, aplicado al alcance: no es que se
// afirme algo falso, es que se omite lo que haria dudar. Quien mira el resultado
// no tiene forma de distinguir "esto es todo lo que habia" de "esto es lo que
// entro antes de que cortara el tope".
//
// Tres topes del motor YA avisaban y no se tocan: `truncar` de la salida del
// gate dice cuantos caracteres omitio, el cupo del daemon nombra los primeros
// diez aplazados y cuenta el resto, y el hito devuelve `stoppedBy`. Este archivo
// cubre los que no avisaban.

import { test } from "node:test";
import assert from "node:assert/strict";

// -------------------------------------- el informe de una lente del abanico

import { recorteQueAvisa } from "../src/prompt.mjs";

test("un texto por debajo del tope sale intacto", () => {
  assert.equal(recorteQueAvisa("corto", 100), "corto");
});

test("un texto por encima se recorta Y se dice cuanto quedo afuera", () => {
  const r = recorteQueAvisa("x".repeat(500), 100);
  assert.ok(r.length < 500);
  assert.match(r, /400/, "tiene que decir cuantos caracteres se omitieron, no solo que se omitio");
  assert.match(r, /recort|truncad/i);
});

test("el tope cuenta sobre el texto original, no sobre el aviso", () => {
  // Si el aviso contara para el tope, un maximo chico daria un resultado mas
  // largo que el maximo y el limite no seria un limite.
  const r = recorteQueAvisa("y".repeat(1000), 50);
  assert.ok(r.startsWith("y".repeat(50)), "se recorto en otro lado del que dice");
});

test("un texto vacio no inventa un aviso", () => {
  assert.equal(recorteQueAvisa("", 10), "");
  assert.equal(recorteQueAvisa(null, 10), "");
});

// ------------------------------------------- la paginacion del proveedor

import { paginacionIncompleta } from "../../../providers/github/index.mjs";

test("el tope de paginas se alcanza con la ultima pagina LLENA: hay mas y se estan tirando", () => {
  const r = paginacionIncompleta({ paginas: 20, maxPaginas: 20, ultimoLote: 100, porPagina: 100 });
  assert.equal(r.incompleta, true);
  assert.match(r.aviso, /maxPages/, "hay que nombrar la opcion que se sube para verlo entero");
  assert.match(r.aviso, /20/);
});

test("el tope se alcanza con la ultima pagina CORTA: se termino de verdad", () => {
  const r = paginacionIncompleta({ paginas: 20, maxPaginas: 20, ultimoLote: 37, porPagina: 100 });
  assert.equal(r.incompleta, false, "una pagina corta es el final, no un recorte");
});

test("no se llego al tope: nada que avisar", () => {
  const r = paginacionIncompleta({ paginas: 3, maxPaginas: 20, ultimoLote: 100, porPagina: 100 });
  assert.equal(r.incompleta, false);
});

// ------------------------------------------------ y que el motor los use

import { readFileSync } from "node:fs";

test("el abanico recorta los informes con el recorte que avisa, no con un slice pelado", () => {
  const src = readFileSync(new URL("../src/driver.mjs", import.meta.url), "utf8");
  const enElAbanico = src.slice(src.indexOf("const resumen = informes"), src.indexOf("const resumen = informes") + 400);
  assert.doesNotMatch(enElAbanico, /\.slice\(0, *\d+\)/,
    "un slice pelado recorta el informe de una lente sin decirlo: la sintesis juzga con menos de lo que hubo");
  assert.match(enElAbanico, /recorteQueAvisa/);
});

test("el planificador no recorta en silencio lo que dijo el modelo", () => {
  const src = readFileSync(new URL("../src/planner.mjs", import.meta.url), "utf8");
  // Es el caso peor: ese texto es el DIAGNOSTICO de por que no se pudo
  // planificar, y recortarlo a 500 sin decirlo deja a una persona leyendo media
  // causa sin saber que era media.
  assert.doesNotMatch(src, /\.slice\(0, *500\)/);
  assert.match(src, /recorteQueAvisa/);
});
