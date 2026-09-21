// Las tres reglas del hallazgo, en el unico sitio donde se pueden hacer
// cumplir: la construccion.
//
// POR QUE AQUI Y NO EN UNA REVISION. El principio X existe porque el contexto
// inventado no se descubre nunca. El verde inventado se cae cuando el codigo
// falla; un snapshot que afirma "arquitectura hexagonal, cobertura 80%" sin un
// archivo detras se convierte en la constitution del proyecto y el runtime la
// aplica durante meses, y cada tarea hereda la suposicion como un hecho
// verificado. Una regla que depende de que el autor del proximo detector se
// acuerde ya fallo: los prompts de TDD funcionan dos iteraciones.
//
// Las tres reglas, tal cual estan en el contrato:
//
//   1. Detectado exige evidencia. Sin ruta que lo respalde es una opinion.
//   2. Inferido se declara inferido, con confianza honesta.
//   3. Vacio se declara vacio, con la constancia de que se busco.

import { CATEGORIAS } from "./fases.mjs";
import { redactar } from "./redaccion.mjs";

/** Un extracto mas largo que esto ya no es una cita: es una copia del archivo. */
const EXTRACTO_MAXIMO = 200;

export class ErrorDeHallazgo extends Error {
  /** @param {string} mensaje */
  constructor(mensaje) {
    super(mensaje);
    this.name = "ErrorDeHallazgo";
  }
}

/**
 * @typedef {object} Evidencia
 * @property {string} ruta relativa a la raiz del proyecto, con `/`
 * @property {number} [linea] 1-indexada
 * @property {string} [extracto] redactado antes de llegar aqui
 */

/**
 * @typedef {object} Hallazgo
 * @property {string} categoria
 * @property {string} clave
 * @property {unknown} valor
 * @property {'detectado'|'inferido'} origen
 * @property {Evidencia[]} evidencia
 * @property {'alta'|'media'|'baja'} confianza
 * @property {string} [motivo] por que el hueco esta vacio, cuando lo esta
 */

/**
 * @param {any} entrada
 * @param {{ sinExtracto?: boolean }} [opts]
 * @returns {Evidencia|null}
 */
function normalizar(entrada, opts = {}) {
  if (!entrada) return null;
  const ruta = typeof entrada === "string" ? entrada : entrada.ruta;
  if (typeof ruta !== "string" || ruta.length === 0) return null;
  /** @type {Evidencia} */
  const evidencia = { ruta };
  if (typeof entrada.linea === "number" && entrada.linea > 0) evidencia.linea = entrada.linea;
  if (!opts.sinExtracto && typeof entrada.extracto === "string" && entrada.extracto.length > 0) {
    // La redaccion ocurre ANTES de persistir (principio IX), y este es el
    // embudo por el que pasa todo extracto de todo detector.
    evidencia.extracto = redactar(entrada.extracto.trim().slice(0, EXTRACTO_MAXIMO));
  }
  return evidencia;
}

/**
 * @param {any[]} entradas
 * @param {{ sinExtracto?: boolean }} [opts]
 * @returns {Evidencia[]}
 */
export function evidenciaDe(entradas, opts = {}) {
  return (Array.isArray(entradas) ? entradas : [entradas]).map((e) => normalizar(e, opts)).filter((e) => e !== null);
}

/**
 * Regla 1. Un hecho: esta en el disco, y aqui esta la ruta.
 *
 * @param {string} categoria
 * @param {string} clave
 * @param {unknown} valor
 * @param {any[]} evidencia
 * @param {'alta'|'media'|'baja'} [confianza]
 * @returns {Hallazgo}
 */
export function detectado(categoria, clave, valor, evidencia, confianza = "alta") {
  const normalizada = evidenciaDe(evidencia);
  if (normalizada.length === 0) {
    throw new ErrorDeHallazgo(
      `\`${clave}\` se declara detectado sin evidencia. Un detectado sin la ruta que lo respalda es una ` +
        "opinion, y el principio X prohibe persistirla.",
    );
  }
  return { categoria, clave, valor, origen: "detectado", evidencia: normalizada, confianza };
}

/**
 * Regla 2. Una lectura razonable de unas señales, dicha como lo que es.
 *
 * POR QUE NO SE ADMITE CONFIANZA ALTA. Porque "inferido con confianza alta" es
 * la grafia con la que una suposicion se cuela como un hecho: quien lo lee en
 * la pantalla ve `alta` y deja de mirar el `inferido` de al lado. Si la certeza
 * es alta, hay un archivo detras — y entonces es un detectado con su ruta.
 *
 * @param {string} categoria
 * @param {string} clave
 * @param {unknown} valor
 * @param {any[]} evidencia señales que sostienen la lectura, si las hay
 * @param {'alta'|'media'|'baja'} [confianza] `alta` se acepta en la firma solo para poder rechazarla
 * @returns {Hallazgo}
 */
export function inferido(categoria, clave, valor, evidencia, confianza = "media") {
  if (confianza === "alta") {
    throw new ErrorDeHallazgo(
      `\`${clave}\` se declara inferido con confianza alta. Si la certeza es alta hay un archivo detras: ` +
        "emitelo como detectado con su ruta y su linea.",
    );
  }
  return { categoria, clave, valor, origen: "inferido", evidencia: evidenciaDe(evidencia), confianza };
}

/**
 * Regla 3. Se busco, y no habia. Es un hecho comprobado, no una ausencia de
 * dato: por eso el origen es `detectado` y por eso lleva evidencia de DONDE se
 * busco. Un repositorio sin tests emite `testing.runner = null`; no emite un
 * runner plausible, y sobre todo no se calla.
 *
 * @param {string} categoria
 * @param {string} clave
 * @param {any[]} dondeSeBusco
 * @param {string} motivo
 * @param {unknown} [valor] `null` salvo que el hueco sea una lista vacia
 * @returns {Hallazgo}
 */
export function vacio(categoria, clave, dondeSeBusco, motivo, valor = null) {
  const normalizada = evidenciaDe(dondeSeBusco);
  if (normalizada.length === 0) {
    throw new ErrorDeHallazgo(
      `\`${clave}\` declara un hueco sin decir donde se busco. Un hueco sin constancia de la busqueda no se ` +
        "distingue de un detector que no miro.",
    );
  }
  if (!motivo || motivo.length < 20) {
    throw new ErrorDeHallazgo(`\`${clave}\` declara un hueco sin motivo legible: "${motivo}"`);
  }
  return { categoria, clave, valor, origen: "detectado", evidencia: normalizada, confianza: "alta", motivo };
}

/**
 * La guarda del nucleo. Los constructores de arriba protegen al detector que
 * los usa; esto protege del que construya el objeto a mano — que es lo que hace
 * cualquiera que escriba un detector nuevo sin leer esta pagina.
 *
 * @param {any} h
 * @returns {string|null} el motivo del rechazo, o `null` si el hallazgo vale
 */
export function motivoDeRechazo(h) {
  if (!h || typeof h !== "object") return "el hallazgo no es un objeto";
  if (typeof h.clave !== "string" || h.clave.length === 0) return "el hallazgo no declara clave";
  if (!CATEGORIAS.includes(h.categoria)) return `categoria desconocida: ${h.categoria}`;
  if (h.origen !== "detectado" && h.origen !== "inferido") return `origen desconocido: ${h.origen}`;
  if (!["alta", "media", "baja"].includes(h.confianza)) return `confianza desconocida: ${h.confianza}`;
  if (h.origen === "inferido" && h.confianza === "alta") {
    return "un hallazgo inferido no puede declararse con confianza alta: si la certeza es alta, detectalo";
  }
  const evidencia = evidenciaDe(Array.isArray(h.evidencia) ? h.evidencia : []);
  if (h.origen === "detectado" && evidencia.length === 0) {
    return "un hallazgo detectado sin evidencia con ruta no se emite (principio X, regla 1)";
  }
  return null;
}
