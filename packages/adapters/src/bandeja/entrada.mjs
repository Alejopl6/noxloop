// T190 — `InboxEntry`: la entrada de la bandeja, con la causa TEXTUAL Y
// COMPLETA (FR-062).
//
// EL FALLO QUE EVITA. Un resumen generado es el verde inventado con otro
// disfraz, aplicado a la lectura en vez de a la ejecucion: el operador decide
// sobre una frase que produjo un modelo a partir de la causa, y la parte que se
// perdio en el resumen es exactamente la que le habria hecho decidir distinto. Y
// no se descubre nunca, porque el original ya no esta. El principio X lo dice
// para lo que el sistema lee; esto es lo mismo para lo que el sistema cuenta.
//
// EL COROLARIO INCOMODO: NO HAY TOPE. Un stacktrace de 40 KB entra entero. Un
// tope "razonable" es un resumen que nadie declaro, y el sitio donde recortar
// —si hay que recortar— es la pantalla al pintarlo, con el texto completo
// todavia detras y un aviso de que hay mas.

import { randomUUID } from "node:crypto";

import { causaAusente, causaResumida, estadoDeEntradaDesconocido, tipoDeEntradaDesconocido } from "../errores.mjs";

/**
 * Los ocho tipos del modelo de datos. Conjunto cerrado: la pantalla decide con
 * el tipo que decisiones ofrece, asi que una entrada de un tipo inventado llega
 * a la bandeja sin acciones posibles y se queda ahi bloqueando el trabajo que la
 * genero.
 *
 * @type {readonly string[]}
 */
export const TIPOS_DE_ENTRADA = Object.freeze([
  "pregunta_agente",
  "autorizacion_credencial",
  "permiso_tool",
  "gate_rojo",
  "conflicto_integracion",
  "hallazgo_revision",
  "decision_merge",
  "decision_despliegue",
]);

/**
 * Las cinco salidas. Una mas —"luego", "quiza"— es una entrada que se queda
 * esperando para siempre y una decision que nadie registro.
 *
 * @type {readonly string[]}
 */
export const ESTADOS_DE_ENTRADA = Object.freeze([
  "esperando",
  "aprobada",
  "rechazada",
  "cambios_solicitados",
  "caducada",
]);

/**
 * Las grafias con las que un texto declara que le falta algo.
 *
 * SE DETECTA LA ELISION EN LA ENTRADA, no se confia en quien llama. Quien
 * construye la entrada puede haber recortado antes; si se acepta, la entrada
 * dice "causa completa" sobre un texto que no lo es, y el operador no tiene
 * forma de saberlo porque el original ya no existe.
 *
 * Son marcas EXPLICITAS de continuacion, no heuristicas de estilo: un texto que
 * termina en puntos suspensivos porque el autor escribia asi es un falso
 * positivo caro —entrena a ignorar la guarda— asi que se exige que la marca sea
 * la ultima cosa del texto o un contador de lo omitido.
 *
 * @type {ReadonlyArray<{re: RegExp, que: string}>}
 */
const MARCAS_DE_ELISION = Object.freeze([
  { re: /[…⋯]\s*$/, que: "termina en puntos suspensivos" },
  { re: /\.\.\.\s*$/, que: "termina en puntos suspensivos" },
  { re: /\[\s*(?:truncad\w*|recortad\w*|omitid\w*|snip+ed)\s*[^\]]*\]/i, que: "lleva una marca de truncado" },
  { re: /\(\s*[+y]\s*\d+\s*(?:linea|línea|caracter|carácter|byte|palabra|mas|más|more)\w*/i, que: "lleva un contador de lo omitido" },
]);

/**
 * @typedef {object} InboxEntry
 * @property {string} id
 * @property {string|null} project_id nullable para entradas de workspace
 * @property {string} tipo
 * @property {string} causa textual y completa (FR-062)
 * @property {object} contexto lo que hace falta para decidir sin salir de la app
 * @property {readonly string[]} decisiones_posibles
 * @property {string} estado
 * @property {string} creada
 * @property {string|null} resuelta
 * @property {string|null} resuelta_por
 */

/**
 * @param {any} datos
 * @returns {InboxEntry}
 */
export function crearEntrada({
  project_id = null,
  tipo,
  causa,
  contexto = {},
  decisiones_posibles = [],
  id,
  ahora = Date.now(),
}) {
  if (!TIPOS_DE_ENTRADA.includes(tipo)) throw tipoDeEntradaDesconocido(String(tipo), TIPOS_DE_ENTRADA);

  if (typeof causa !== "string" || causa.trim().length === 0) throw causaAusente();
  for (const { re, que } of MARCAS_DE_ELISION) {
    if (re.test(causa)) throw causaResumida(que);
  }

  return Object.freeze({
    id: id ?? `inb_${randomUUID()}`,
    project_id: project_id ?? null,
    tipo,
    // TAL CUAL. Ni `trim`, ni normalizacion de saltos de linea, ni nada: la
    // sangria de un stacktrace y las lineas en blanco de un diff son parte de lo
    // que hay que leer para decidir.
    causa,
    contexto: Object.freeze({ ...contexto }),
    decisiones_posibles: Object.freeze([...decisiones_posibles]),
    estado: "esperando",
    creada: new Date(ahora).toISOString(),
    // `resuelta` y `resuelta_por` existen desde el principio con null explicito:
    // la metrica que esta tabla habilita —tiempo de bloqueo a respuesta— se
    // calcula con los dos instantes, y un campo que aparece despues no se puede
    // distinguir de uno que nunca se escribio.
    resuelta: null,
    resuelta_por: null,
  });
}

/**
 * Resuelve una entrada devolviendo OTRA, sin tocar la original.
 *
 * El historial de la bandeja es lo que alimenta la metrica de bloqueo a
 * respuesta, y mutar la entrada en el sitio pierde el estado anterior sin dejar
 * constancia. Quien persiste decide si guarda las dos.
 *
 * @param {InboxEntry} entrada
 * @param {{estado: string, por: string, ahora?: number}} decision
 * @returns {InboxEntry}
 */
export function resolverEntrada(entrada, { estado, por, ahora = Date.now() }) {
  if (!ESTADOS_DE_ENTRADA.includes(estado) || estado === "esperando") {
    throw estadoDeEntradaDesconocido(String(estado), ESTADOS_DE_ENTRADA.filter((e) => e !== "esperando"));
  }
  return Object.freeze({
    ...entrada,
    estado,
    resuelta: new Date(ahora).toISOString(),
    resuelta_por: por ?? null,
  });
}

/**
 * El tiempo que una persona tardo en desbloquear el trabajo, en milisegundos.
 *
 * @param {InboxEntry} entrada
 * @returns {number|null} null mientras siga esperando: no saber no es cero
 */
export function tiempoDeBloqueoAResp(entrada) {
  if (!entrada?.resuelta) return null;
  return new Date(entrada.resuelta).getTime() - new Date(entrada.creada).getTime();
}
