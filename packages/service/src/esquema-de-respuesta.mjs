// La version de la forma de las respuestas. Un cambio incompatible la sube.
//
// POR QUE VIVE SOLA EN UN ARCHIVO DE UNA LINEA. Porque la necesitan los dos
// extremos del cableado: `servidor.mjs`, que la exporta como parte de la
// superficie publica, y los manejadores, que la ponen en `/v1/health`. Si
// viviera en `servidor.mjs`, un manejador que la importa cierra el circulo
// —servidor → tabla → manejador → servidor— y el sintoma de un ciclo de
// modulos en ESM no es un error al cargar: es una constante que vale
// `undefined` en el primer import y el numero bueno en el segundo, segun cual
// se resolvio antes.

/** @type {number} */
export const ESQUEMA = 1;
