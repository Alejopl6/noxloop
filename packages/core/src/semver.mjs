// La version de la constitution, con el salto decidido por el tipo de cambio.
//
// POR QUE NO LA ESCRIBE QUIEN ENMIENDA. Porque quien enmienda es quien menos
// quiere que su cambio parezca grande: una retirada de principio publicada como
// `1.2.3` no la revisa nadie. El tipo de cambio es una declaracion sobre QUE se
// hizo —que se puede contrastar con la enmienda— y el numero sale de ahi.

import { tipoDeCambioDesconocido } from "./errores.mjs";

/** Que salto produce cada tipo de cambio. Es una tabla: un tipo mas es una fila. */
export const TIPOS_DE_CAMBIO = Object.freeze({
  // Un principio que no estaba. Amplia lo que la constitution cubre.
  principio_nuevo: "menor",
  // Un principio que ya estaba, dicho de otra forma o con otro alcance.
  principio_redefinido: "menor",
  // Un principio que deja de regir. Es incompatible con cualquier plan que lo
  // diera por hecho, y por eso sube mayor: quien tenga trabajo en curso bajo
  // esa regla tiene que enterarse.
  principio_retirado: "mayor",
  // Un principio que se endurece. Tambien rompe planes en curso.
  endurecimiento: "mayor",
  // Redaccion, ejemplos, erratas. No cambia lo que se puede o no se puede.
  aclaracion: "parche",
});

/** @type {readonly string[]} */
export const SALTOS = Object.freeze(["mayor", "menor", "parche"]);

/**
 * @param {string} version
 * @returns {[number, number, number]}
 */
export function partir(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  if (!m) return [1, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * @param {string} version
 * @param {string} tipoDeCambio
 * @returns {string}
 */
export function subir(version, tipoDeCambio) {
  const salto = /** @type {string|undefined} */ (
    /** @type {any} */ (TIPOS_DE_CAMBIO)[tipoDeCambio]
  );
  if (!salto) throw tipoDeCambioDesconocido(tipoDeCambio, Object.keys(TIPOS_DE_CAMBIO));
  const [mayor, menor, parche] = partir(version);
  if (salto === "mayor") return `${mayor + 1}.0.0`;
  if (salto === "menor") return `${mayor}.${menor + 1}.0`;
  return `${mayor}.${menor}.${parche + 1}`;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function comparar(a, b) {
  const x = partir(a);
  const y = partir(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
