// El adaptador que habla con la capa de integracion alojada NO entra en esta
// tarea: necesita tres contenedores levantados y aplicaciones OAuth registradas
// con cada proveedor. Lo que si entra es su hueco, declarado.
//
// POR QUE UN HUECO QUE FALLA Y NO UN ARCHIVO QUE NO EXISTE. Un archivo que no
// existe se descubre con un ERR_MODULE_NOT_FOUND, que no dice nada de lo que
// falta. Un hueco declarado dice que falta, por que falta y que hace falta para
// llenarlo — y deja escrito, donde se va a leer, el bug del puerto que muerde
// el primer dia.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { crearAdaptadorNango, REQUISITOS_DE_NANGO } from "../src/adaptadores/nango.mjs";

test("EL INVARIANTE: construirlo falla diciendo que falta y que hace falta", () => {
  assert.throws(
    () => crearAdaptadorNango({}),
    (e) => {
      assert.equal(e.codigo, "adaptador_no_implementado");
      assert.ok(e.causa.length > 40, "una causa de cuatro palabras no explica por que no esta");
      assert.ok(e.accion, "sin accion, el que llegue aqui no sabe que hace falta para llenarlo");
      return true;
    },
  );
});

test("declara sus requisitos: tres contenedores y el puerto registrado", () => {
  // Que esten DECLARADOS es lo que permite que el reparto de adaptadores sea
  // una consecuencia y no una opinion: levantar tres contenedores para guardar
  // un PAT es coste sin contrapartida, y eso solo se ve si el coste esta escrito.
  const contenedores = REQUISITOS_DE_NANGO.filter((r) => r.tipo === "contenedor");
  assert.equal(contenedores.length, 3, `declara ${contenedores.length} contenedores`);
  const puerto = REQUISITOS_DE_NANGO.find((r) => r.tipo === "puerto");
  assert.ok(puerto, "no declara el puerto del callback, que es un contrato con el mundo exterior");
  assert.equal(puerto.puerto, 3003);
});

test("el hueco deja escrito el bug del puerto, que es lo que muerde el primer dia", () => {
  const fuente = readFileSync(new URL("../src/adaptadores/nango.mjs", import.meta.url), "utf8");
  assert.match(fuente, /SERVER_PORT=3003/, "sin esto, el servidor escucha en 8080 y el compose expone 3003");
  assert.match(fuente, /8080/);
});
