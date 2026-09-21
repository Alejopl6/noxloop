// El espacio de trabajo al que pertenece la credencial que deja una conexion.
//
// EL FALLO CONCRETO, Y NO SALIO DE UN TEST SINO DE PEGARLE AL SERVICIO VIVO.
// El adaptador llamaba a `boveda.registrar({ workspace: projectId, ... })`:
// pasaba el identificador del PROYECTO donde el deposito espera el del
// ESPACIO DE TRABAJO. En las pruebas del paquete no se notaba —el repositorio
// en memoria de la boveda no comprueba claves foraneas— y contra el almacen de
// verdad la primera conexion moria con:
//
//     adaptador_caido: el deposito de secretos no pudo guardar 'token' de
//     <proveedor>: FOREIGN KEY constraint failed
//
// Un mensaje que manda a revisar el llavero del sistema, que es el unico sitio
// donde el problema NO estaba.
//
// POR QUE EL VALOR SE EXIGE AL MONTAR Y NO SE ADIVINA. Adivinarlo es lo que
// produjo el fallo, y un adaptador que adivina no falla al montarse: falla al
// guardar el primer token del operador, con un error de clave foranea que no
// menciona ningun espacio de trabajo. Exigirlo mueve el fallo al arranque, que
// es donde se puede leer.

import { test } from "node:test";
import assert from "node:assert/strict";

import { crearAdaptadorLocal } from "../src/adaptadores/local.mjs";
import { CATALOGO_POR_DEFECTO } from "../src/catalogo.mjs";
import { ErrorDeConexion } from "../src/errores.mjs";

const WORKSPACE = "espacio-de-trabajo-7";
const PROYECTO = "proyecto-3";

/** Un proveedor curado que se conecta pegando un valor. */
const SIN_OAUTH = CATALOGO_POR_DEFECTO.find((e) => e.modo !== "oauth2");

/** Un deposito que solo anota con que argumentos lo llamaron. */
function depositoQueAnota(anotado) {
  return {
    async registrar(datos) {
      anotado.push(datos);
      return { credencial: { id: `cred-${anotado.length}`, ref_boveda: `ref-${anotado.length}` } };
    },
    async otorgar(datos) {
      anotado.push({ grant: datos });
      return { id: `grant-${anotado.length}` };
    },
    async recuperar() {
      return "un-valor";
    },
    async borrar() {},
    async revocar() {},
  };
}

test("la credencial se registra en el espacio de trabajo declarado, no en el proyecto", async () => {
  const anotado = [];
  const proveedor = crearAdaptadorLocal({ boveda: depositoQueAnota(anotado), workspaceId: WORKSPACE });

  const valores = Object.fromEntries(SIN_OAUTH.campos.map((c) => [c.nombre, "un-valor"]));
  await proveedor.conectar({ projectId: PROYECTO, slug: SIN_OAUTH.slug, valores });

  const alta = anotado.find((a) => a.workspace !== undefined);
  assert.ok(alta, "el adaptador no registro ninguna credencial en el deposito");
  assert.equal(
    alta.workspace,
    WORKSPACE,
    "el adaptador paso el identificador del proyecto donde el deposito espera el del espacio de trabajo: " +
      "contra un almacen con claves foraneas eso es un `FOREIGN KEY constraint failed` que no menciona ningun workspace",
  );
  // Y el proyecto sigue viajando por su propio campo: la credencial es de
  // ambito `proyecto` y sin `project_id` el almacen la rechaza por su propio
  // CHECK.
  assert.equal(alta.project_id, PROYECTO);
  assert.equal(alta.ambito, "proyecto");
});

test("montar el adaptador sin espacio de trabajo falla AL MONTAR, con causa y accion", () => {
  assert.throws(
    () => crearAdaptadorLocal({ boveda: depositoQueAnota([]) }),
    (e) => {
      assert.ok(e instanceof ErrorDeConexion, `lanzo un ${e?.name} sin forma`);
      assert.equal(e.codigo, "workspace_ausente");
      assert.ok(e.causa.length > 10, "no dice que falta");
      assert.ok(e.accion.length > 10, "no dice que hacer");
      return true;
    },
  );
});
