// `auditoria-no-editable` — la bitacora solo crece, y una alteracion se nota.
//
// EL FALLO QUE EVITA. Una auditoria que se puede editar no sirve para lo unico
// para lo que existe: explicar despues que paso. Si el mismo proceso que usa
// las credenciales puede borrar la linea que dice que las uso, la bitacora es
// una lista de las veces que alguien decidio dejar constancia.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { crearAuditoria } from "../src/auditoria.mjs";

test("EL INVARIANTE: no hay forma de editar ni borrar un evento", () => {
  const auditoria = crearAuditoria();
  auditoria.registrar({ tipo: "acceso", resultado: "concedido", ref: "noxloop:w1:a" });

  const verbos = /^(editar|borrar|eliminar|actualizar|modificar|reescribir|truncar|vaciar)/;
  const prohibidas = Object.keys(auditoria).filter((k) => verbos.test(k));
  assert.deepEqual(prohibidas, [], `la auditoria expone ${prohibidas.join(", ")}`);

  // Lo que se devuelve es una copia congelada: quedarse con la referencia del
  // evento y cambiarlo despues es la via mas corta a una bitacora falsa.
  const evento = auditoria.listar()[0];
  assert.throws(() => {
    evento.resultado = "denegado";
  }, TypeError);
  assert.equal(auditoria.listar()[0].resultado, "concedido");
});

test("EL INVARIANTE: la cadena de hash detecta una alteracion externa", () => {
  const auditoria = crearAuditoria();
  for (const r of ["concedido", "denegado", "concedido"]) {
    auditoria.registrar({ tipo: "acceso", resultado: r, ref: "noxloop:w1:a" });
  }
  assert.deepEqual(auditoria.verificar(), { ok: true, desde: null });

  // Un almacen es un archivo, y un archivo se edita con un editor de texto.
  // Se simula exactamente eso: alguien cambia una linea ya escrita.
  const alterado = auditoria.listar().map((e) => ({ ...e }));
  alterado[1].resultado = "concedido";
  const revision = crearAuditoria({ eventos: alterado }).verificar();
  assert.equal(revision.ok, false);
  assert.equal(revision.desde, 2, "tiene que decir a partir de que numero de evento deja de cuadrar");

  // Y borrar una linea del medio tambien rompe la cadena.
  const recortado = auditoria.listar().filter((e) => e.seq !== 2);
  assert.equal(crearAuditoria({ eventos: recortado }).verificar().ok, false);
});

test("cada evento encadena con el anterior y numera sin huecos", () => {
  const auditoria = crearAuditoria();
  auditoria.registrar({ tipo: "acceso", resultado: "concedido", ref: "r" });
  auditoria.registrar({ tipo: "acceso", resultado: "denegado", ref: "r" });
  const [uno, dos] = auditoria.listar();

  assert.equal(uno.seq, 1);
  assert.equal(dos.seq, 2);
  assert.equal(uno.hashPrevio, null, "el primero no tiene anterior y tiene que decirlo");
  assert.equal(dos.hashPrevio, uno.hash);
  assert.notEqual(uno.hash, dos.hash);
});

test("el modulo de auditoria no exporta ninguna via de escritura salvo registrar", () => {
  const fuente = readFileSync(new URL("../src/auditoria.mjs", import.meta.url), "utf8");
  const exportadas = [...fuente.matchAll(/export\s+function\s+(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(exportadas, ["crearAuditoria"], `el modulo exporta ademas: ${exportadas.join(", ")}`);
});
