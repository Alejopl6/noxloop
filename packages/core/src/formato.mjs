// Como se escribe el valor de un hallazgo cuando tiene que leerlo una persona.
//
// Vive aparte porque lo usan dos sitios que no se conocen —la propuesta de
// constitution y los documentos que genera el bootstrap— y porque el corte
// tiene una razon: un valor entero volcado en una linea convierte el documento
// en un JSON con markdown alrededor, y entonces nadie lo lee. Lo que se ve es
// un resumen; lo entero esta en el hallazgo, con su ruta al lado.

/** Mas alla de esto deja de ser un resumen y empieza a ser un volcado. */
const MAXIMO_ELEMENTOS = 8;
const MAXIMO_CAMPOS = 6;

/**
 * @param {unknown} valor
 * @returns {string}
 */
export function resumir(valor) {
  if (valor === null || valor === undefined) return "null";
  if (typeof valor === "string") return `\`${valor}\``;
  if (typeof valor === "number" || typeof valor === "boolean") return `\`${valor}\``;
  if (Array.isArray(valor)) {
    if (valor.length === 0) return "(lista vacia)";
    const primeros = valor.slice(0, MAXIMO_ELEMENTOS).map((v) => resumir(v));
    return primeros.join(", ") + (valor.length > MAXIMO_ELEMENTOS ? `, ... (${valor.length} en total)` : "");
  }
  return Object.entries(valor)
    .slice(0, MAXIMO_CAMPOS)
    .map(([k, v]) => `${k}: ${resumir(v)}`)
    .join("; ");
}

/**
 * La cita de donde sale un dato. Sin la linea, un hallazgo obliga a abrir un
 * archivo de doscientas lineas para comprobarlo: eso no es evidencia, es una
 * pista.
 *
 * @param {any} evidencia
 * @returns {string}
 */
export function cita(evidencia) {
  if (!evidencia || typeof evidencia.ruta !== "string") return "";
  return evidencia.linea ? `\`${evidencia.ruta}:${evidencia.linea}\`` : `\`${evidencia.ruta}\``;
}
