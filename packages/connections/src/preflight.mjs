// El puerto del callback: la comprobacion de arranque, no un try/catch.
//
// POR QUE NO HAY REASIGNACION DINAMICA, QUE ES LO QUE CUALQUIERA HARIA. El
// puerto queda registrado como redirect URI en la aplicacion OAuth de CADA
// proveedor. Moverlo en caliente no degrada el flujo: lo rompe entero, y el
// error que devuelve el proveedor habla de un `redirect_uri` que no coincide,
// no de un puerto ocupado. Nadie relaciona los dos mensajes.
//
// Por eso es una condicion de arranque: se comprueba una vez, ruidosamente, y
// la accion que se propone es liberar el puerto — nunca cambiarlo.

import { createServer } from "node:net";

/**
 * El puerto del callback. Es un contrato con el mundo exterior: cambiarlo
 * obliga a volver a registrar el redirect URI en cada aplicacion OAuth.
 */
export const PUERTO_DE_CALLBACK = 3003;

/** La interfaz de loopback: el callback lo alcanza el navegador del operador, nadie mas. */
export const HOST_DE_CALLBACK = "127.0.0.1";

/**
 * Sondea un puerto abriendolo y cerrandolo. No habla con nadie: mira si se
 * puede escuchar, que es exactamente lo que va a hacer el callback.
 *
 * @param {number} puerto
 * @param {string} [host]
 * @returns {Promise<{ libre: boolean, causa?: string, evidencia?: string }>}
 */
export function sondearPuertoConNet(puerto, host = HOST_DE_CALLBACK) {
  return new Promise((resolver) => {
    const servidor = createServer();
    servidor.once("error", (e) => {
      resolver({ libre: false, causa: `${/** @type {any} */ (e).code ?? "error"} al intentar escuchar en ${host}:${puerto}` });
    });
    servidor.once("listening", () => {
      servidor.close(() => resolver({ libre: true, evidencia: `${host}:${puerto} acepto una escucha de prueba` }));
    });
    servidor.listen(puerto, host);
  });
}

/**
 * @param {number} puerto
 * @param {string} causa
 * @returns {{ codigo: string, causa: string, accion: string }}
 */
export function problemaDePuertoOcupado(puerto, causa) {
  return {
    codigo: "puerto_ocupado",
    causa: `el puerto ${puerto}, donde tiene que escuchar el callback de OAuth, ya esta ocupado: ${causa}`,
    accion:
      `libera el puerto ${puerto} —mira que proceso lo tiene con \`lsof -i :${puerto}\`— y vuelve a arrancar. ` +
      "El puerto no se puede cambiar sobre la marcha: esta registrado como redirect URI en la aplicacion OAuth de cada proveedor",
  };
}
