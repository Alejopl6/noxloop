// Las estructuras del inventario. Ninguna tiene un campo para el valor.
//
// POR QUE NO EXISTE EL CAMPO, EN VEZ DE EXISTIR Y NO USARSE. Un campo `valor`
// que hoy esta a `null` es una invitacion: la proxima persona que necesite el
// valor a mano en un punto del codigo lo rellena, porque el sitio ya estaba
// hecho. Si el campo no existe, agregarlo es una decision visible en el diff.
//
// TODO(persistencia): estas estructuras se guardan hoy en memoria. El almacen
// persistente esta en decision (ver `repositorio.mjs`) y por eso aqui no hay
// ningun nombre de tabla, ningun tipo de columna y ninguna migracion: un esquema
// escrito antes de esa decision hay que rehacerlo.

import { construirRef, nuevoIdDeCredencial } from "./referencia.mjs";

/** Los propositos por los que se puede pedir una credencial (contrato de la boveda). */
export const PROPOSITOS = ["lanzar_runner", "llamar_api", "clonar_repo", "sesion_ssh"];

/** Los backends posibles. La eleccion se declara siempre; ver `backends/seleccion.mjs`. */
export const BACKENDS = ["keychain_so", "archivo_cifrado"];

/**
 * Los tipos de credencial. Es el enum de `data-model.md` §Credential, tal cual.
 *
 * POR QUE NO HAY UN VALOR POR DEFECTO. Lo hubo —`tipo = "token"`— y era un
 * valor que este enum NO CONTIENE: el almacen lo rechazaba al persistir, y el
 * fallo aparecia al integrar los dos paquetes y no al escribir el primero. Es
 * el mismo criterio que el motor ya aplica a la ruta de un repositorio: un
 * default razonable para algo que solo sabe quien llama es la forma de operar
 * sobre la cosa equivocada sin enterarse.
 */
export const TIPOS = ["api_token", "tracker", "scm", "modelo", "ssh"];

/** Ambito de una credencial: del workspace entero, o de un proyecto. */
export const AMBITOS = ["global", "proyecto"];

/**
 * @typedef {object} Credential
 * @property {string} id
 * @property {string} workspace
 * @property {string} nombre         nombre legible; es lo que se ve en `[redactado:<nombre>]`
 * @property {string} proveedor      quien la emite; el almacen lo exige y no lo inventa
 * @property {string} tipo           uno de TIPOS
 * @property {string} ambito         uno de AMBITOS
 * @property {string|null} project_id  obligatorio si `ambito === "proyecto"`
 * @property {string|null} alcance_declarado  lo que el operador DICE que permite hacer
 * @property {string} ref_boveda     la referencia opaca con la que se le pide al backend
 * @property {string|null} huella
 * @property {string} backend        que backend la guarda, declarado en la propia fila
 * @property {string} creadaEn
 * @property {string|null} rotadaEn
 */

/**
 * @param {{ workspace: string, nombre: string, proveedor: string, tipo: string, ambito?: string,
 *           project_id?: string|null, alcance_declarado?: string|null, id?: string,
 *           backend: string, ahora?: number }} datos
 * @returns {Credential}
 */
export function crearCredencial({
  workspace,
  nombre,
  proveedor,
  tipo,
  ambito = "global",
  project_id = null,
  alcance_declarado = null,
  id,
  backend,
  ahora = Date.now(),
}) {
  if (!proveedor) {
    throw new Error(
      "una credencial sin proveedor no se puede inventariar.\n" +
        "  Causa:  el inventario responde 'que credenciales existen y de quien son', y sin proveedor la segunda mitad falta.\n" +
        "  Accion: pasa `proveedor` con el nombre del servicio que la emite.",
    );
  }
  if (!TIPOS.includes(tipo)) {
    throw new Error(
      `tipo de credencial no reconocido: ${JSON.stringify(tipo)}.\n` +
        `  Causa:  el inventario solo admite ${TIPOS.join(", ")}, y un tipo fuera de esa lista no se puede gobernar por politica.\n` +
        "  Accion: usa uno de esos, o amplia el enum en `data-model.md` y aqui a la vez.",
    );
  }
  if (!AMBITOS.includes(ambito)) {
    throw new Error(
      `ambito no reconocido: ${JSON.stringify(ambito)}. Accion: usa ${AMBITOS.join(" o ")}.`,
    );
  }
  // Denegar por defecto tambien aqui: una credencial declarada de proyecto pero
  // sin proyecto quedaria de hecho global, que es MAS permiso del que se pidio.
  if (ambito === "proyecto" && !project_id) {
    throw new Error(
      "una credencial de ambito `proyecto` necesita `project_id`.\n" +
        "  Causa:  sin el, la credencial queda de hecho global — mas alcance del que se declaro.\n" +
        "  Accion: pasa `project_id`, o declara `ambito: \"global\"` si eso es lo que quieres.",
    );
  }

  const identificador = id ?? nuevoIdDeCredencial();
  return Object.freeze({
    id: identificador,
    workspace,
    nombre,
    proveedor,
    tipo,
    ambito,
    project_id,
    alcance_declarado,
    ref_boveda: construirRef(workspace, identificador),
    huella: null,
    backend,
    creadaEn: new Date(ahora).toISOString(),
    rotadaEn: null,
  });
}

/**
 * @typedef {object} Grant
 * @property {string} id
 * @property {string} project_id
 * @property {string} agent_id
 * @property {string} credential_id
 * @property {string} concedido_por  quien lo concedio. SIEMPRE una persona: sin autor, la auditoria no reconstruye quien autorizo
 * @property {string} otorgadoEn
 * @property {string|null} vigenciaHasta  `null` es sin caducidad, no "para siempre sin control": se revoca
 * @property {string|null} revocadoEn
 */

/**
 * @param {{ project_id: string, agent_id: string, credential_id: string, concedido_por: string, vigenciaHasta?: string|null, id?: string, ahora?: number }} datos
 * @returns {Grant}
 */
export function crearGrant({
  project_id,
  agent_id,
  credential_id,
  concedido_por,
  vigenciaHasta = null,
  id,
  ahora = Date.now(),
}) {
  // `concedido_por` es obligatorio y SIEMPRE es una persona.
  //
  // Se descartaba en silencio: los parametros no lo aceptaban, asi que quien
  // cableaba el servicio lo mandaba y desaparecia. Lo descubrio ese cableado,
  // no una revision, y mientras tanto el inventario no podia contestar quien
  // autorizo un acceso.
  //
  // Y es la pregunta que hace util a la auditoria. "Este agente alcanzo esta
  // credencial" sin "y quien se lo concedio" no reconstruye nada: la cadena de
  // responsabilidad se corta justo donde empieza la decision humana, que es la
  // unica parte que el sistema no puede tomar por su cuenta.
  if (!concedido_por) {
    throw new Error(
      "un grant sin `concedido_por` no se puede otorgar.\n" +
        "  Causa:  el grant es una decision humana, y sin su autor la auditoria no puede reconstruir quien autorizo el acceso.\n" +
        "  Accion: pasa `concedido_por` con quien concede. Nunca un valor de sistema: si no hubo persona, no hubo decision.",
    );
  }
  return Object.freeze({
    id: id ?? nuevoIdDeCredencial(),
    project_id,
    agent_id,
    credential_id,
    concedido_por,
    otorgadoEn: new Date(ahora).toISOString(),
    vigenciaHasta,
    revocadoEn: null,
  });
}

/**
 * La comprobacion que separa "existe la fila" de "autoriza ahora".
 *
 * EL FALLO QUE EVITA. Una consulta que solo pregunta si hay grant deja pasar el
 * que se otorgo para una tarea que termino el mes pasado. La vigencia se mira
 * en el instante del uso, no al planificar: entre planificar y usar puede haber
 * horas, y en esas horas alguien pudo revocar.
 *
 * El tipo admite las dos grafias a proposito: esta funcion recibe tanto un
 * `Grant` de este paquete como una fila cruda del almacen, y el dia que el tipo
 * solo declaraba una, la otra entraba como `undefined` y autorizaba. Declarar
 * lo que de verdad llega es parte del arreglo, no un adorno del arreglo.
 *
 * @param {{id: string, revocadoEn?: string|null, vigenciaHasta?: string|null, revocado_en?: string|null, vigencia_hasta?: string|null}} grant
 * @param {number} ahora
 * @returns {{ vigente: boolean, causa: string|null }}
 */
export function estadoDelGrant(grant, ahora) {
  // LOS DOS VOCABULARIOS SE ACEPTAN AQUI, Y NO ES COMODIDAD: ERA UN AGUJERO.
  //
  // Esta funcion leia solo `revocadoEn`/`vigenciaHasta` —el vocabulario de este
  // paquete— y el almacen guarda `revocado_en`/`vigencia_hasta`. Sobre una fila
  // venida del almacen los dos campos eran `undefined`, asi que:
  //
  //   estadoDelGrant({ revocado_en: "2020-01-01" }, Date.now())  ->  { vigente: true }
  //
  // Un grant revocado hacia meses seguia entregando el valor de cualquier
  // credencial, y el evento de auditoria quedaba escrito como `concedido`. El
  // registro decia que el acceso fue legitimo.
  //
  // El fallo NO ESTABA en quien llamaba: estaba aqui, en una funcion que es la
  // unica guarda entre "existe la fila" y "autoriza ahora" y que se creia la
  // unica forma de escribir un nombre. La traduccion en la costura tapaba el
  // sintoma en un camino; esto cierra la funcion para todos.
  //
  // `??` y no `||`: una cadena vacia es un dato distinto de la ausencia, y con
  // `||` un `revocadoEn: ""` caeria al otro campo en silencio.
  const revocado = grant.revocadoEn ?? grant.revocado_en;
  const hasta = grant.vigenciaHasta ?? grant.vigencia_hasta;

  if (revocado) {
    return { vigente: false, causa: `el grant ${grant.id} fue revocado el ${revocado}` };
  }
  if (hasta && Date.parse(hasta) <= ahora) {
    return { vigente: false, causa: `el grant ${grant.id} existe pero su vigencia termino el ${hasta}` };
  }
  return { vigente: true, causa: null };
}
