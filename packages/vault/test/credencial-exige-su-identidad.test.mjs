// Una credencial sin identidad no se puede inventariar, y el inventario es el
// diferencial declarado del producto.
//
// EL FALLO QUE ESTAS PRUEBAS FIJAN, y ocurrio de verdad. `crearCredencial`
// tenia `tipo = "token"` como valor por defecto, y `"token"` NO ESTA en el enum
// del modelo de datos (`api_token | tracker | scm | modelo | ssh`). El paquete
// pasaba sus 42 pruebas en verde, porque ninguna miraba el enum; el fallo
// aparecio al integrar con el almacen, que rechazo la fila al persistirla.
//
// Es el mismo criterio que el motor ya aplica a la ruta de un repositorio: un
// default razonable para algo que solo sabe quien llama es la forma de operar
// sobre la cosa equivocada sin enterarse. Con un default, "que tipo es esta
// credencial" nunca se pregunta. Sin el, se contesta o no se crea.

import { test } from "node:test";
import assert from "node:assert/strict";

import { AMBITOS, TIPOS, crearCredencial } from "../src/modelo.mjs";

/** Lo minimo valido, para que cada prueba quite exactamente una cosa. */
const completa = {
  workspace: "w1",
  nombre: "clave del tracker",
  proveedor: "un-tracker",
  tipo: "tracker",
  backend: "archivo_cifrado",
};

test("una credencial sin proveedor no se inventaria, y el error dice que falta", () => {
  const { proveedor, ...sinProveedor } = completa;
  assert.throws(
    () => crearCredencial(/** @type {any} */ (sinProveedor)),
    (e) => {
      assert.match(e.message, /proveedor/);
      // NFR-006: causa y accion, no solo el nombre del campo.
      assert.match(e.message, /Causa:/);
      assert.match(e.message, /Accion:/);
      return true;
    },
  );
});

test("el tipo tiene que estar en el enum, y el error enumera los que valen", () => {
  // "token" es el valor que estuvo por defecto y que el almacen rechazaba.
  assert.throws(
    () => crearCredencial({ ...completa, tipo: "token" }),
    (e) => {
      assert.match(e.message, /token/);
      for (const t of TIPOS) assert.ok(e.message.includes(t), `el error no nombra ${t}`);
      return true;
    },
  );
});

test("no hay tipo por defecto: omitirlo falla igual que poner uno inventado", () => {
  const { tipo, ...sinTipo } = completa;
  assert.throws(() => crearCredencial(/** @type {any} */ (sinTipo)), /tipo de credencial no reconocido/);
});

test("los cinco tipos del modelo de datos se aceptan", () => {
  for (const t of TIPOS) {
    const c = crearCredencial({ ...completa, tipo: t });
    assert.equal(c.tipo, t);
  }
});

test("una credencial de ambito proyecto sin project_id se rechaza: seria mas alcance del pedido", () => {
  // Denegar por defecto. Dejarla pasar la convierte de hecho en global, que es
  // MAS permiso del que se declaro — y el operador creyendo que acoto.
  assert.throws(
    () => crearCredencial({ ...completa, ambito: "proyecto" }),
    (e) => {
      assert.match(e.message, /project_id/);
      assert.match(e.message, /mas alcance del que se declaro/);
      return true;
    },
  );
});

test("con project_id, el ambito de proyecto se acepta y se conserva", () => {
  const c = crearCredencial({ ...completa, ambito: "proyecto", project_id: "p1" });
  assert.equal(c.ambito, "proyecto");
  assert.equal(c.project_id, "p1");
});

test("un ambito fuera del enum se rechaza", () => {
  assert.throws(() => crearCredencial({ ...completa, ambito: "equipo" }), /ambito no reconocido/);
  assert.deepEqual(AMBITOS, ["global", "proyecto"]);
});

test("el ambito por defecto es global, que es el unico que no necesita mas datos", () => {
  const c = crearCredencial(completa);
  assert.equal(c.ambito, "global");
  assert.equal(c.project_id, null);
});

test("la credencial creada sigue sin tener ningun campo para el valor", () => {
  // La regla no se relaja porque se hayan anadido campos de identidad.
  const c = crearCredencial({ ...completa, alcance_declarado: "solo lectura de issues" });
  assert.deepEqual(
    Object.keys(c).filter((k) => /valor|secret|password|token$/i.test(k)),
    [],
  );
  assert.ok(!JSON.stringify(c).includes("valor"));
});
