// El hueco del adaptador alojado. NO esta implementado, y esto es la
// declaracion de lo que falta.
//
// POR QUE UN HUECO QUE FALLA Y NO UN ARCHIVO QUE NO EXISTE. Un archivo que no
// existe se descubre con un ERR_MODULE_NOT_FOUND, que no dice que falta ni que
// hace falta para llenarlo. Aqui queda escrito, donde se va a leer.
//
// QUE HACE FALTA PARA LLENARLO (T154, T156, T157, T158):
//
//   1. Los tres contenedores levantados en la maquina del operador, con
//      `SERVER_PORT=3003` EXPLICITO en el entorno. Sin eso el servidor escucha
//      en 8080 —el valor viene horneado en la imagen— mientras el compose
//      expone 3003, y no conecta nada. El fallo esta reportado y cerrado como
//      "not planned": no se va a arreglar solo.
//   2. Aplicaciones OAuth PROPIAS registradas con cada proveedor, con
//      `http://localhost:3003/oauth/callback` como redirect URI. No es un
//      tramite: con las aplicaciones compartidas los scopes son fijos, el
//      usuario autoriza a un tercero y no a este producto, y sobre todo NO se
//      pueden exportar los tokens. Es el seguro de portabilidad, y solo
//      funciona si esta puesto desde el principio.
//   3. La dependencia `@nangohq/node`, que es lo que trae la licencia.
//
// LA LICENCIA. `@nangohq/node` y `@nangohq/frontend` son Elastic License 2.0:
// no esta aprobada por la OSI y no es compatible con GPL/AGPL. La decision de
// meterla en el nucleo esta tomada; lo que no puede pasar es que sea una
// sorpresa para quien redistribuya. Esta declarada en
// `docs/licencia-de-integraciones.md`, con el texto que va a `LICENSE` y al
// `README`.

import { fallar } from "../errores.mjs";

/**
 * Lo que este adaptador va a necesitar cuando exista. Esta declarado ANTES de
 * implementarlo a proposito: el reparto entre adaptadores es una consecuencia
 * del coste, y el coste solo se puede comparar si esta escrito.
 */
export const REQUISITOS_DE_NANGO = Object.freeze([
  { nombre: "base de datos", tipo: "contenedor", detalle: "almacena conexiones y credenciales cifradas" },
  { nombre: "cache", tipo: "contenedor", detalle: "requerido por el servidor" },
  { nombre: "servidor de integraciones", tipo: "contenedor", detalle: "necesita SERVER_PORT=3003 explicito" },
  {
    nombre: "puerto del callback de OAuth",
    tipo: "puerto",
    puerto: 3003,
    detalle: "registrado como redirect URI en la aplicacion OAuth de cada proveedor: no se puede reasignar",
  },
  {
    nombre: "clave de cifrado en reposo",
    tipo: "secreto",
    detalle: "no rota: cambiarla rompe el descifrado, y sin ella las credenciales quedan en claro",
  },
]);

/**
 * @returns {never}
 */
export function crearAdaptadorNango() {
  return fallar(
    "adaptador_no_implementado",
    "el adaptador alojado todavia no existe: necesita sus tres contenedores levantados y una aplicacion OAuth propia registrada con cada proveedor, y ninguna de las dos cosas se puede montar desde aqui",
    "usa el adaptador `local` para los modos que no son oauth2, o el `fake` en las pruebas. Lo que falta para llenar este hueco esta en la cabecera de este archivo y en `docs/licencia-de-integraciones.md`",
  );
}
