// Todo campo secreto declara QUE permite hacer la credencial que guarda.
//
// EL FALLO CONCRETO, Y SALIO DE PEGARLE AL SERVICIO VIVO. Conectar dos de los
// proveedores curados —los dos que llevan mas tiempo en el catalogo— moria con:
//
//     campo_obligatorio_ausente: Falta `alcance_declarado` para escribir en
//     `credential`, y `data-model.md` lo declara obligatorio.
//
// El adaptador manda `alcance_declarado: campo.alcance ?? null`, y ninguno de
// los dos declaraba `alcance`. El almacen tiene razon en rechazarlo: el alcance
// es lo que el operador DICE que esa credencial permite hacer, y es lo unico
// que da sentido a la vista inversa —"estos agentes la alcanzan" sin saber que
// significa alcanzarla no es una respuesta—. Inventarlo aqui seria escribir un
// dato que despues se lee como verificado.
//
// POR QUE LA GUARDA VA EN LA VALIDACION DEL CATALOGO Y NO EN UN `?? "algo"`.
// Porque un valor por defecto hace que el catalogo incompleto NO falle al
// montar: falla cuando el operador pega su primer token, con un error que habla
// de una columna de una tabla. Validandolo al montar, un catalogo al que le
// falta el alcance no arranca, y lo dice nombrando el campo.

import { test } from "node:test";
import assert from "node:assert/strict";

import { CATALOGO_POR_DEFECTO } from "../src/catalogo.mjs";
import { CATALOGO_FALSO } from "../src/adaptadores/fake.mjs";
import { validarEntradaDeCatalogo } from "../src/modelo.mjs";

test("todos los campos secretos del catalogo propio declaran su alcance", () => {
  const sinAlcance = [];
  for (const entrada of CATALOGO_POR_DEFECTO) {
    for (const campo of entrada.campos ?? []) {
      if (campo.secreto && (typeof campo.alcance !== "string" || campo.alcance.trim().length === 0)) {
        sinAlcance.push(`${entrada.slug}.${campo.nombre}`);
      }
    }
  }
  assert.deepEqual(
    sinAlcance,
    [],
    "estos campos guardan una credencial sin decir que permite hacer, y el almacen los rechaza al escribirla",
  );
});

test("el catalogo del adaptador de pruebas cumple la misma regla: si no, prueba algo que el real no puede hacer", () => {
  for (const entrada of CATALOGO_FALSO) {
    const r = validarEntradaDeCatalogo(entrada);
    assert.ok(r.ok, `${entrada.slug}: ${r.problemas.join("; ")}`);
  }
});

test("una entrada con un campo secreto sin alcance no valida, y lo dice nombrando el campo", () => {
  const r = validarEntradaDeCatalogo({
    slug: "sin-alcance",
    nombre: "Sin alcance",
    modo: "api_key",
    clase: "infra",
    campos: [{ nombre: "clave", etiqueta: "Clave", secreto: true, requerido: true }],
    entorno: { clave: "CLAVE" },
  });
  assert.equal(r.ok, false, "un campo secreto sin alcance paso la validacion del catalogo");
  assert.ok(
    r.problemas.some((p) => p.includes("clave") && p.includes("alcance")),
    `el problema no nombra el campo ni el alcance: ${JSON.stringify(r.problemas)}`,
  );
});
