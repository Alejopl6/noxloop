// T190 — `InboxEntry` con la causa TEXTUAL Y COMPLETA (FR-062).
//
// EL FALLO QUE EVITA. Un resumen generado es el mismo verde inventado con otro
// disfraz, en la lectura en vez de en la ejecucion: el operador decide sobre una
// frase que produjo un modelo a partir de la causa, y la parte que se perdio en
// el resumen es exactamente la que le habria hecho decidir distinto. Y no se
// descubre nunca, porque el original ya no esta.
//
// El corolario incomodo: NO hay tope. Un stacktrace de 40 KB entra entero. Un
// tope "razonable" es un resumen que nadie declaro.

import { test } from "node:test";
import assert from "node:assert/strict";

import { TIPOS_DE_ENTRADA, ESTADOS_DE_ENTRADA, crearEntrada, resolverEntrada } from "../src/bandeja/entrada.mjs";
import { ErrorDeAdaptador } from "../src/errores.mjs";
import { capturar } from "./ayuda.mjs";

const BASE = {
  project_id: "p1",
  tipo: "gate_rojo",
  causa: "el gate fallo",
  contexto: {},
  decisiones_posibles: ["reintentar", "bloquear"],
};

test("los ocho tipos del modelo de datos, ni uno mas ni uno menos", () => {
  assert.deepEqual([...TIPOS_DE_ENTRADA], [
    "pregunta_agente",
    "autorizacion_credencial",
    "permiso_tool",
    "gate_rojo",
    "conflicto_integracion",
    "hallazgo_revision",
    "decision_merge",
    "decision_despliegue",
  ]);
  assert.deepEqual([...ESTADOS_DE_ENTRADA], [
    "esperando", "aprobada", "rechazada", "cambios_solicitados", "caducada",
  ]);
});

test("un tipo inventado se rechaza nombrando los que existen", () => {
  const e = capturar(() => crearEntrada({ ...BASE, tipo: "otra_cosa" }));
  assert.ok(e instanceof ErrorDeAdaptador, `no es un ErrorDeAdaptador: ${e}`);
  assert.equal(e.codigo, "tipo_de_entrada_desconocido");
  assert.ok(e.causa.includes("gate_rojo"));
});

test("FR-062 — la causa sobrevive entera, byte a byte, tambien despues de serializar", () => {
  const largo =
    "PRIMERA LINEA CENTINELA\n" +
    Array.from({ length: 2000 }, (_, i) => `    at fn${i} (/un/camino/muy/largo/archivo${i}.mjs:${i}:${i})`).join("\n") +
    "\nULTIMA LINEA CENTINELA";

  const entrada = crearEntrada({ ...BASE, causa: largo });
  assert.equal(entrada.causa, largo, "la causa se recorto al crear la entrada");

  const ida = JSON.parse(JSON.stringify(entrada));
  assert.equal(ida.causa, largo, "la causa se recorto al serializar");
  assert.ok(ida.causa.startsWith("PRIMERA LINEA CENTINELA"));
  assert.ok(ida.causa.endsWith("ULTIMA LINEA CENTINELA"));
  assert.equal(ida.causa.length, largo.length);
});

test("FR-062 — una causa que YA llega elidida se rechaza en vez de guardarse como si fuera completa", () => {
  // Quien construye la entrada puede haber recortado antes de llamar. Si se
  // acepta, la entrada dice "causa completa" sobre un texto que no lo es, y el
  // operador no tiene forma de saberlo: el original ya no existe.
  for (const elidida of [
    "Error: el gate fallo en el paso 3 …",
    "Error: el gate fallo [truncado]",
    "Error: el gate fallo... (+ 412 lineas mas)",
  ]) {
    const e = capturar(() => crearEntrada({ ...BASE, causa: elidida }));
    assert.ok(e instanceof ErrorDeAdaptador, `no es un ErrorDeAdaptador: ${e}`);
  assert.equal(e.codigo, "causa_resumida", `no se detecto la elision en: ${elidida}`);
    assert.ok(e.accion.includes("completo") || e.accion.includes("entero"));
  }
});

test("FR-062 — una causa vacia se rechaza: una entrada sin causa no se puede decidir", () => {
  for (const vacia of ["", "   ", null, undefined, 7]) {
    const e = capturar(() => crearEntrada({ ...BASE, causa: vacia }));
    assert.ok(e instanceof ErrorDeAdaptador, `no es un ErrorDeAdaptador: ${e}`);
  assert.equal(e.codigo, "causa_ausente");
  }
});

test("ninguna fuente de la bandeja recorta texto", async () => {
  const { readFileSync } = await import("node:fs");
  const fuente = readFileSync(new URL("../src/bandeja/entrada.mjs", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  // `slice` sobre la causa es como vuelve a entrar el resumen: para una vista
  // previa, para un log, para "que quepa". La deteccion de elision usa
  // expresiones regulares, no recortes.
  const hallazgos = [];
  for (const re of [/causa[^\n]{0,30}\.slice\(/, /causa[^\n]{0,30}\.substring\(/, /causa[^\n]{0,30}\.substr\(/]) {
    const m = fuente.match(re);
    if (m) hallazgos.push(m[0]);
  }
  assert.deepEqual(hallazgos, [], `la bandeja recorta la causa:\n${hallazgos.join("\n")}`);
});

test("la entrada nace `esperando` y habilita la metrica de bloqueo a respuesta", () => {
  const entrada = crearEntrada({ ...BASE, ahora: 1000 });
  assert.equal(entrada.estado, "esperando");
  assert.equal(entrada.resuelta, null);
  assert.equal(entrada.resuelta_por, null);

  const resuelta = resolverEntrada(entrada, { estado: "aprobada", por: "una persona", ahora: 4000 });
  assert.equal(resuelta.estado, "aprobada");
  assert.equal(resuelta.resuelta_por, "una persona");
  assert.equal(
    new Date(resuelta.resuelta).getTime() - new Date(resuelta.creada).getTime(),
    3000,
    "el tiempo de bloqueo a respuesta no se puede calcular con lo que guarda la entrada",
  );
  assert.equal(entrada.estado, "esperando", "resolver muto la entrada original");
});

test("resolver con un estado que no es una salida se rechaza", () => {
  const e = capturar(() => resolverEntrada(crearEntrada(BASE), { estado: "quiza", por: "alguien" }));
  assert.ok(e instanceof ErrorDeAdaptador, `no es un ErrorDeAdaptador: ${e}`);
  assert.equal(e.codigo, "estado_de_entrada_desconocido");
});

test("una entrada de workspace puede no tener proyecto, pero el campo existe", () => {
  const entrada = crearEntrada({ ...BASE, project_id: null });
  assert.equal(entrada.project_id, null);
});
