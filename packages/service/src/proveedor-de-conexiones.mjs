// Que adaptador —o adaptadores— de conexiones monta este servicio.
//
// -----------------------------------------------------------------------------
// POR QUE LOS DOS, Y NO UNO EN LUGAR DEL OTRO
// -----------------------------------------------------------------------------
//
// El adaptador alojado existe desde hoy. La tentacion inmediata es cambiar el
// `local` por el, y eso convierte la mejora en una regresion medible: la
// pantalla de conexiones solo ofrece lo que atiende el adaptador montado, asi
// que el operador que levanta los contenedores para poder usar OAuth PIERDE
// todos los proveedores de modo `api_key` y `basic` — tres de los ocho del
// catalogo, y los unicos que funcionaban hasta ahora.
//
// Lo que se pidio es lo contrario: el token personal deja de ser el camino por
// DEFECTO y pasa a ser LA ALTERNATIVA para quien no quiera contenedores. Una
// alternativa que desaparece en cuanto llega la opcion principal no lo es.
//
// Asi que se montan los dos, repartidos por el modo del catalogo, que es la
// regla que gobierna el paquete entero.
//
// -----------------------------------------------------------------------------
// POR QUE LA CONFIGURACION SALE DEL ENTORNO Y NO DE UNA BANDERA
// -----------------------------------------------------------------------------
//
// La clave secreta del servidor de integraciones es un secreto, y una bandera
// de linea de comandos queda en la tabla de procesos de la maquina entera —es
// la misma razon por la que este producto no pasa credenciales por `argv`
// (principio IX)—. El escritorio lanza este binario como sidecar y le pasa el
// entorno, que no aparece en `ps`.
//
// -----------------------------------------------------------------------------
// SIN NADA CONFIGURADO, EL PRODUCTO SIGUE ENTERO
// -----------------------------------------------------------------------------
//
// Sin las variables, se monta el `local` y ya esta. No hay error, ni aviso
// rojo, ni una pantalla que prometa un flujo que no existe: hay un camino
// menos, y el catalogo ya declara por cada proveedor que adaptador lo
// atenderia, asi que la pantalla puede decir cual falta sin inventarse nada.

import { crearAdaptadorLocal } from "../../connections/src/adaptadores/local.mjs";
import { crearAdaptadorNango } from "../../connections/src/adaptadores/nango.mjs";
import { crearProveedorReunido } from "../../connections/src/reunido.mjs";
import { SERVIDOR_POR_DEFECTO } from "../../connections/src/aplicacion-oauth.mjs";

/**
 * Lo que este modulo lee del entorno, declarado.
 *
 * VA EN UNA CONSTANTE EXPORTADA Y NO EN UN `process.env` SUELTO porque es lo
 * que imprime la ayuda del ejecutable: una variable que solo existe dentro de
 * un `if` no se puede documentar sin copiar su nombre a mano a otro sitio, y la
 * copia se queda vieja.
 */
export const LEE_DEL_ENTORNO = Object.freeze([
  Object.freeze({
    nombre: "NOXLOOP_NANGO_URL",
    para: "la direccion del servidor de integraciones que sirve el callback de OAuth",
    donde: `por defecto \`${SERVIDOR_POR_DEFECTO}\`, que es donde lo deja el compose de \`packages/connections/nango/\``,
    secreto: false,
  }),
  Object.freeze({
    nombre: "NOXLOOP_NANGO_SECRET_KEY",
    para: "la clave secreta del entorno del servidor de integraciones, con la que se autoriza cada llamada",
    donde:
      "del panel del servidor, o de su base de datos: " +
      "`select secret_key from _nango_environments where name = 'dev'`",
    secreto: true,
  }),
  Object.freeze({
    nombre: "NOXLOOP_NANGO_ENV",
    para: "que entorno del servidor de integraciones se usa",
    donde: "por defecto `dev`, que es el que el servidor crea al arrancar por primera vez",
    secreto: false,
  }),
]);

/**
 * Monta el proveedor de conexiones que corresponde a esta maquina.
 *
 * @param {{boveda: any|null, workspace: {id: string}, entorno?: Record<string, string|undefined>}} piezas
 * @returns {any|null} `null` cuando no hay ningun camino disponible
 */
export function elegirProveedorDeConexiones({ boveda, workspace, entorno = process.env }) {
  const adaptadores = [];

  const servidor = entorno.NOXLOOP_NANGO_URL ?? SERVIDOR_POR_DEFECTO;
  const claveSecreta = entorno.NOXLOOP_NANGO_SECRET_KEY;

  // LA CLAVE ES LO QUE DECIDE, NO LA DIRECCION. La direccion tiene valor por
  // defecto —siempre es el mismo puerto, que ademas es un contrato con cada
  // proveedor— asi que su presencia no dice nada. Montar el alojado sin clave
  // lo dejaria contestando 401 `invalid_env` en cada llamada, y ese mensaje no
  // menciona ninguna clave, ningun entorno y ningun archivo: el operador leeria
  // "entorno invalido" y se iria a revisar el compose.
  if (typeof claveSecreta === "string" && claveSecreta.length > 0) {
    adaptadores.push(
      crearAdaptadorNango({
        servidor,
        claveSecreta,
        entorno: entorno.NOXLOOP_NANGO_ENV ?? "dev",
      }),
    );
  }

  // EL LOCAL NECESITA LA BOVEDA y el alojado no: este guarda el valor en SU
  // servidor, cifrado con la clave en reposo de esa instancia. Por eso la
  // ausencia de boveda no puede dejar sin ningun camino a quien ya tiene los
  // contenedores levantados.
  if (boveda) {
    // El espacio de trabajo viaja porque el deposito indexa por el, y porque un
    // proyecto NO es un espacio de trabajo: pasarle el proyecto es lo que hacia
    // que guardar el primer token muriera con un error de clave foranea.
    adaptadores.push(crearAdaptadorLocal({ boveda, workspaceId: workspace.id }));
  }

  if (adaptadores.length === 0) return null;
  return crearProveedorReunido({ adaptadores });
}
