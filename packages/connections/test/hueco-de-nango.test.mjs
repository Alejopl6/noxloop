// EL HUECO QUE ESTE ARCHIVO GUARDABA ESTA LLENO, y esta prueba es la que lo
// mide en la direccion contraria.
//
// LO QUE MEDIA ANTES. `crearAdaptadorNango()` lanzaba siempre
// `adaptador_no_implementado`, y esta prueba exigia que lo hiciera con causa y
// accion. Eso era correcto mientras el hueco existiera: un archivo que no
// existe se descubre con un ERR_MODULE_NOT_FOUND que no dice que falta.
//
// LO QUE MIDE AHORA. Que el adaptador existe, que se puede construir, y que
// NADA de lo que el hueco dejaba escrito se perdio al llenarlo: los requisitos
// siguen declarados —porque el reparto entre adaptadores es una consecuencia
// del coste, y el coste solo se compara si esta escrito— y el bug del puerto
// sigue documentado donde se va a leer.
//
// POR QUE EL BUG DEL PUERTO SIGUE AQUI Y NO SE BORRA CON EL HUECO. Esta
// reportado rio arriba y cerrado como "not planned": no se va a arreglar solo,
// y el sintoma —«no conecta nada»— no menciona ningun puerto. El dia que
// alguien limpie el comentario por parecer viejo, esto falla.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { crearAdaptadorNango, REQUISITOS_DE_NANGO } from "../src/adaptadores/nango.mjs";

test("EL INVARIANTE: el adaptador alojado ya no es un hueco — se construye y cumple el contrato", () => {
  const proveedor = crearAdaptadorNango({
    servidor: "http://localhost:3003",
    claveSecreta: "una-clave-de-prueba",
    peticion: async () => new Response("{}", { status: 200 }),
  });
  assert.equal(proveedor.id, "nango");
  for (const metodo of ["preflight", "catalogo", "conectar", "esperarConexion", "credenciales", "llamar", "revocar", "listar"]) {
    assert.equal(typeof proveedor[metodo], "function", `al adaptador alojado le falta \`${metodo}()\``);
  }
  // Lo que ademas trae, y que ningun otro adaptador necesita: el registro de
  // las aplicaciones OAuth, que es el unico paso que el producto no puede dar.
  assert.equal(typeof proveedor.aplicaciones, "function");
  assert.equal(typeof proveedor.registrarAplicacion, "function");
});

test("declara sus requisitos: tres contenedores, el puerto registrado y la aplicacion propia", () => {
  // Que esten DECLARADOS es lo que permite que el reparto de adaptadores sea
  // una consecuencia y no una opinion: levantar tres contenedores para guardar
  // un token personal es coste sin contrapartida, y eso solo se ve si el coste
  // esta escrito.
  const contenedores = REQUISITOS_DE_NANGO.filter((r) => r.tipo === "contenedor");
  assert.equal(contenedores.length, 3, `declara ${contenedores.length} contenedores`);
  const puerto = REQUISITOS_DE_NANGO.find((r) => r.tipo === "puerto");
  assert.ok(puerto, "no declara el puerto del callback, que es un contrato con el mundo exterior");
  assert.equal(puerto.puerto, 3003);

  // EL REQUISITO QUE SE DESCUBRIO MIDIENDO, y que no estaba antes: no hay
  // aplicaciones OAuth compartidas en una instancia propia. Es el unico
  // requisito que no se resuelve con `docker compose up`.
  const registro = REQUISITOS_DE_NANGO.find((r) => r.tipo === "registro");
  assert.ok(registro, "no declara que hace falta una aplicacion OAuth propia por proveedor");
  assert.match(registro.detalle, /compartidas/);
});

test("el adaptador deja escrito el bug del puerto, que es lo que muerde el primer dia", () => {
  const fuente = readFileSync(new URL("../src/adaptadores/nango.mjs", import.meta.url), "utf8");
  assert.match(fuente, /SERVER_PORT=3003/, "sin esto, el servidor escucha en 8080 y el compose expone 3003");
  assert.match(fuente, /8080/);
});
