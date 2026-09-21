// La constitution como objeto, y el pie que la ata a una version.
//
// POR QUE EL PIE SE SELLA EN EL CONTENIDO Y NO SOLO EN EL ALMACEN. Porque el
// archivo es lo unico que viaja con el codigo. Si el almacen dice 1.1.0 y el
// documento dice 1.0.0, quien clone el repositorio en otra maquina —una persona
// o el runtime compilando contexto en CI— se cree el documento, porque es lo
// unico que tiene delante. Dos numeros que pueden discrepar acaban discrepando.

import { randomUUID } from "node:crypto";

import { constitutionVacia } from "../errores.mjs";

/**
 * Donde se escribe la constitution cuando el proyecto no tenia una.
 *
 * Es un archivo en mayusculas en la raiz porque esa es la FORMA que ya usan
 * `README`, `LICENSE` y `CONTRIBUTING` en cualquier ecosistema: se encuentra
 * sin saber nada del proyecto. No se elige la convencion de ninguna herramienta
 * concreta, porque el detector de guidelines ya encuentra la que el proyecto
 * use, y esa manda.
 */
export const RUTA_POR_DEFECTO = "CONSTITUTION.md";

/** La linea de pie, en la grafia que el detector de guidelines sabe leer. */
const PIE = /^\*\*Version\*\*:.*$/m;

/** @param {number|string} instante */
export function comoFecha(instante) {
  const d = typeof instante === "number" ? new Date(instante) : new Date(instante);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {string} contenido
 * @param {{version: string, ratificada: number|string, enmendada: number|string|null}} datos
 * @returns {string}
 */
export function sellarPie(contenido, { version, ratificada, enmendada }) {
  const pie =
    `**Version**: ${version} | **Ratified**: ${comoFecha(ratificada)} | ` +
    `**Last Amended**: ${enmendada === null ? "—" : comoFecha(enmendada)}`;
  const cuerpo = contenido.replace(/\s+$/, "");
  if (PIE.test(cuerpo)) return `${cuerpo.replace(PIE, pie)}\n`;
  return `${cuerpo}\n\n${pie}\n`;
}

/**
 * @typedef {object} Constitution
 * @property {string} id
 * @property {string} project_id
 * @property {string} version
 * @property {string} ruta_en_repo
 * @property {string} contenido
 * @property {string} ratificada
 * @property {string|null} enmendada
 * @property {boolean} vigente
 * @property {readonly any[]} invariantes reglas declaradas que el bootstrap contrasta (FR-028)
 */

/**
 * @param {{project_id: string, contenido: string, ruta_en_repo?: string, version?: string, invariantes?: any[], ahora?: number, id?: string}} datos
 * @returns {Constitution}
 */
export function crearConstitution({
  project_id,
  contenido,
  ruta_en_repo = RUTA_POR_DEFECTO,
  version = "1.0.0",
  invariantes = [],
  ahora = Date.now(),
  id,
}) {
  if (typeof contenido !== "string" || contenido.trim().length === 0) throw constitutionVacia();
  return Object.freeze({
    id: id ?? `con_${randomUUID()}`,
    project_id,
    version,
    ruta_en_repo,
    contenido: sellarPie(contenido, { version, ratificada: ahora, enmendada: null }),
    ratificada: new Date(ahora).toISOString(),
    enmendada: null,
    vigente: true,
    invariantes: Object.freeze([...invariantes]),
  });
}

/**
 * Donde vive la constitution de este proyecto, y con que certeza se sabe.
 *
 * EL FALLO QUE EVITA. Adoptar un proyecto que ya tiene sus reglas escritas en
 * un sitio y escribirle otras al lado. A partir de ahi hay dos documentos, el
 * runtime lee uno y el equipo mantiene el otro, y la divergencia no la descubre
 * nadie porque los dos parecen correctos por separado.
 *
 * @param {any} snapshot
 * @returns {{ruta: string, origen: 'detectado'|'inferido', evidencia: any[], motivo: string}}
 */
export function rutaDeConstitution(snapshot) {
  const hallazgos = Array.isArray(snapshot?.hallazgos) ? snapshot.hallazgos : [];
  const detectada = hallazgos.find(
    (/** @type {any} */ h) => h.clave === "guidelines.constitution" && !h.motivo && h.valor && h.valor.ruta,
  );
  if (detectada) {
    return {
      ruta: detectada.valor.ruta,
      origen: "detectado",
      evidencia: detectada.evidencia ?? [],
      motivo: "",
    };
  }
  return {
    ruta: RUTA_POR_DEFECTO,
    origen: "inferido",
    evidencia: [],
    motivo:
      "el snapshot no encontro ninguna constitution en el arbol, asi que esta ruta es una convencion y no una " +
      "deteccion: el operador puede cambiarla antes de fijar.",
  };
}
