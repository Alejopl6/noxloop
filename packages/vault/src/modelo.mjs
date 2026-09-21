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
 * @typedef {object} Credential
 * @property {string} id
 * @property {string} workspace
 * @property {string} nombre         nombre legible; es lo que se ve en `[redactado:<nombre>]`
 * @property {string} tipo
 * @property {string} ref_boveda     la referencia opaca con la que se le pide al backend
 * @property {string|null} huella
 * @property {string} backend        que backend la guarda, declarado en la propia fila
 * @property {string} creadaEn
 * @property {string|null} rotadaEn
 */

/**
 * @param {{ workspace: string, nombre: string, tipo?: string, id?: string, backend: string, ahora?: number }} datos
 * @returns {Credential}
 */
export function crearCredencial({ workspace, nombre, tipo = "token", id, backend, ahora = Date.now() }) {
  const identificador = id ?? nuevoIdDeCredencial();
  return Object.freeze({
    id: identificador,
    workspace,
    nombre,
    tipo,
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
 * @property {string} otorgadoEn
 * @property {string|null} vigenciaHasta  `null` es sin caducidad, no "para siempre sin control": se revoca
 * @property {string|null} revocadoEn
 */

/**
 * @param {{ project_id: string, agent_id: string, credential_id: string, vigenciaHasta?: string|null, id?: string, ahora?: number }} datos
 * @returns {Grant}
 */
export function crearGrant({ project_id, agent_id, credential_id, vigenciaHasta = null, id, ahora = Date.now() }) {
  return Object.freeze({
    id: id ?? nuevoIdDeCredencial(),
    project_id,
    agent_id,
    credential_id,
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
 * @param {Grant} grant
 * @param {number} ahora
 * @returns {{ vigente: boolean, causa: string|null }}
 */
export function estadoDelGrant(grant, ahora) {
  if (grant.revocadoEn) {
    return { vigente: false, causa: `el grant ${grant.id} fue revocado el ${grant.revocadoEn}` };
  }
  if (grant.vigenciaHasta && Date.parse(grant.vigenciaHasta) <= ahora) {
    return { vigente: false, causa: `el grant ${grant.id} existe pero su vigencia termino el ${grant.vigenciaHasta}` };
  }
  return { vigente: true, causa: null };
}
