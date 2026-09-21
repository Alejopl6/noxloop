// La huella: identifica un valor sin revelarlo.
//
// POR QUE HMAC Y NO UN SHA DESNUDO. Una credencial no siempre tiene entropia de
// credencial: hay tokens de 40 caracteres aleatorios y hay contrasenas que una
// persona eligio. Un `sha256(valor)` de las segundas se invierte con un
// diccionario en segundos, y la huella pasa de "no revela" a "revela las
// debiles", que son justo las que mas importa no revelar. Con HMAC, quien tenga
// la huella y no tenga la sal no puede probar candidatos.
//
// POR QUE SE TRUNCA. La huella se muestra en la interfaz para comparar y para
// detectar una rotacion. 32 caracteres hexadecimales (128 bits) hacen imposible
// una colision accidental y caben en una linea.

import { createHmac, randomBytes } from "node:crypto";

/** Longitud en caracteres hexadecimales del resumen que se muestra. */
const LARGO = 32;

/**
 * Sal de la instalacion.
 *
 * TODO(persistencia): esta sal tiene que vivir junto al almacen, no en memoria.
 * Mientras se genera por proceso, la huella de un mismo valor cambia entre
 * arranques y "la huella cambio" deja de significar "alguien roto la
 * credencial". La decision de donde persistirla va con la del almacen, que
 * todavia no existe; hasta entonces el llamante puede pasar la suya.
 *
 * @returns {string}
 */
export function salPorDefecto() {
  return randomBytes(32).toString("hex");
}

/**
 * @param {string} valor
 * @param {string} sal
 * @returns {string} `sha256:<32 hex>`
 */
export function huellaDe(valor, sal) {
  const resumen = createHmac("sha256", sal).update(valor, "utf8").digest("hex");
  return `sha256:${resumen.slice(0, LARGO)}`;
}
