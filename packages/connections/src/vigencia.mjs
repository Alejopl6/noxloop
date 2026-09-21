// Cuanto puede sostenerse una credencial antes de volver a pedirla.
//
// DE DONDE SALE EL TOPE. Cinco minutos es la recomendacion del propio proveedor
// de la capa de integracion, y el motivo es concreto: un token que vive en
// memoria del servicio aparece en un volcado, en un diagnostico y en el estado
// de un proceso que alguien dejo corriendo tres semanas. La credencial se pide
// justo antes de lanzar el subproceso, se inyecta y se descarta.
//
// QUE NO SIGNIFICA `vigencia_ms`. No es "cuanto se puede cachear". Es cuanto
// puede sostener el valor quien YA lo tiene en la mano, fuera del servicio. En
// el servicio no queda nada entre una llamada y la siguiente, y por eso el tope
// acota un riesgo de verdad en vez de ser un numero decorativo.

import { fallar } from "./errores.mjs";

export const VIGENCIA_MAXIMA_MS = 5 * 60 * 1000;

/** Lo que se sostiene cuando el motor no propone nada. Corto a proposito. */
export const VIGENCIA_POR_DEFECTO_MS = 60 * 1000;

/**
 * Acota la vigencia propuesta al tope del contrato.
 *
 * EL FALLO QUE EVITA. El proveedor externo contesta `expires_in: 3600` y el
 * adaptador lo copia tal cual, porque es lo que dice el proveedor. El tope no
 * es del proveedor: es nuestro, y por eso el recorte vive aqui y no en cada
 * adaptador, donde el que falte en uno no se nota.
 *
 * @param {number} propuesta
 * @returns {number}
 */
export function acotarVigencia(propuesta) {
  if (typeof propuesta !== "number" || !Number.isFinite(propuesta) || propuesta <= 0) {
    fallar(
      "vigencia_invalida",
      `la vigencia propuesta (${JSON.stringify(propuesta)}) no es un numero de milisegundos mayor que cero`,
      "una vigencia de cero o negativa no se puede sostener: propone un numero de milisegundos, o no propongas nada y se usa el valor por defecto",
    );
  }
  return Math.min(propuesta, VIGENCIA_MAXIMA_MS);
}
