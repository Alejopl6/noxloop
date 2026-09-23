// «Todavia no» no es un error, y confundirlos pinta la pantalla de rojo cada
// segundo mientras todo va bien.
//
// EL FALLO MEDIDO, contra el servicio corriendo con el adaptador alojado y una
// instancia propia del servidor de integraciones. La pantalla abre el navegador
// del sistema y, mientras el operador autoriza, sonda
// `POST /v1/connections/:handle/callback` una vez por segundo. Cada una de esas
// llamadas devolvia:
//
//   504 {"error":{"codigo":"espera_agotada","causa":"pasaron 2s y el handle
//   '05be7a29-…' sigue sin autorizar","accion":"abre otra vez el enlace…"}}
//
// La interfaz pinta todo error con causa y accion, asi que el operador veria
// «pasaron 2s y sigue sin autorizar» parpadeando en rojo durante los cuarenta
// segundos que tarda en leer la pantalla de permisos del proveedor — y el
// mensaje le dice que vuelva a abrir el enlace, que es justo lo que no tiene
// que hacer.
//
// POR QUE EL ARREGLO VA EN EL SERVICIO Y NO EN LA PANTALLA. Se penso en que la
// pantalla ignorara ese codigo, y es peor: obliga a cada cliente a conocer un
// codigo de error para no enseñarlo, y el segundo cliente que se escriba no lo
// sabra. «¿Ya autorizo?» tiene tres respuestas legitimas —si, todavia no, y
// algo se rompio— y solo la tercera es un error.
//
// LO QUE NO CAMBIA: un handle que no existe sigue siendo un error, y una
// conexion revocada mientras se esperaba, tambien. Convertir esos dos en
// «todavia no» dejaria a la pantalla sondeando para siempre algo que nunca va
// a llegar.

import { test } from "node:test";
import assert from "node:assert/strict";

import { conServicio, pedir } from "./ayuda.mjs";

/**
 * Un proveedor cuyo flujo de autorizacion tarda: los primeros sondeos no
 * encuentran nada, y a partir del tercero la conexion aparece.
 */
function proveedorQueTarda({ sondeosEnBlanco = 2 } = {}) {
  let restantes = sondeosEnBlanco;
  const estado = { intentos: 0 };
  return {
    estado,
    proveedor: {
      id: "nango",
      async catalogo() {
        return [
          { slug: "github", nombre: "GitHub", modo: "oauth2", clase: "scm", entorno: {}, api: {} },
        ];
      },
      async listar() {
        return [];
      },
      async preflight() {
        return { ok: true, requisitos: [], problemas: [] };
      },
      async esperarConexion(handle) {
        estado.intentos += 1;
        if (handle === "handle-que-no-existe") {
          const e = new Error("handle_desconocido");
          Object.assign(e, {
            name: "ErrorDeConexion",
            codigo: "handle_desconocido",
            causa: `no hay ninguna conexion en curso con el handle '${handle}'`,
            accion: "vuelve a llamar a `conectar`",
          });
          throw e;
        }
        if (restantes > 0) {
          restantes -= 1;
          const e = new Error("espera_agotada");
          Object.assign(e, {
            name: "ErrorDeConexion",
            codigo: "espera_agotada",
            causa: `pasaron 2s y el handle '${handle}' sigue sin autorizar`,
            accion: "abre otra vez el enlace en el navegador del sistema",
          });
          throw e;
        }
        return {
          id: "conexion-1",
          project_id: null,
          slug: "github",
          modo: "oauth2",
          handle,
          estado: "conectada",
          deposito: {},
        };
      },
    },
  };
}

/** @param {any} svc @param {string} handle */
async function sondear(svc, handle) {
  const r = await pedir(svc, `/v1/connections/${handle}/callback`, { method: "POST" });
  return { estado: r.status, cuerpo: await r.json() };
}

test("EL INVARIANTE: sondear mientras el operador autoriza NO es un error", async () => {
  const { proveedor } = proveedorQueTarda();
  await conServicio({ proveedorDeConexiones: proveedor }, async (svc) => {
    const primero = await sondear(svc, "handle-1");
    assert.equal(
      primero.estado,
      200,
      `sondear una autorizacion en curso devolvio ${primero.estado}: la pantalla lo pinta en rojo una vez por segundo`,
    );
    assert.equal(primero.cuerpo.conexion, null, "dijo que hay conexion cuando todavia no la hay");
    assert.equal(primero.cuerpo.esperando, true, "no dice que sigue esperando: quien sonda no sabe si seguir");
    assert.ok(!primero.cuerpo.error, "vino con un error dentro de una respuesta que dice 200");
  });
});

test("cuando el proveedor contesta, el mismo sondeo devuelve la conexion", async () => {
  const { proveedor, estado } = proveedorQueTarda({ sondeosEnBlanco: 2 });
  await conServicio({ proveedorDeConexiones: proveedor }, async (svc) => {
    assert.equal((await sondear(svc, "handle-1")).cuerpo.esperando, true);
    assert.equal((await sondear(svc, "handle-1")).cuerpo.esperando, true);

    const tercero = await sondear(svc, "handle-1");
    assert.equal(tercero.estado, 200);
    assert.equal(tercero.cuerpo.conexion?.id, "conexion-1");
    assert.ok(!tercero.cuerpo.esperando, "sigue diciendo que espera despues de entregar la conexion");
    assert.equal(estado.intentos, 3);
  });
});

test("un handle que no existe SIGUE siendo un error: si no, la pantalla sonda para siempre", async () => {
  // La contracara, y es la que impide que el arreglo se pase de largo. Un
  // handle desconocido no va a aparecer nunca: tratarlo como «todavia no»
  // dejaria la pantalla girando cinco minutos antes de decir nada.
  const { proveedor } = proveedorQueTarda();
  await conServicio({ proveedorDeConexiones: proveedor }, async (svc) => {
    const r = await sondear(svc, "handle-que-no-existe");
    assert.notEqual(r.estado, 200, "un handle inexistente contesto 200: quien sonda no sabe que parar");
    assert.equal(r.cuerpo.error?.codigo, "handle_desconocido");
    assert.ok(r.cuerpo.error?.accion, "el error no dice que hacer");
  });
});
