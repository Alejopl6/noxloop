// FR-023 — la etapa de diseño es omitible sin penalizacion ni bloqueo.
//
// EL FALLO QUE EVITA. Un proyecto sin superficie visual —un motor, una
// libreria, un demonio— no tiene nada que diseñar. Una etapa obligatoria ahi
// produce una de dos cosas, las dos malas: el operador la rellena con cualquier
// cosa para poder avanzar, y a partir de ese momento el runtime compila
// contexto con un sistema de diseño inventado que aplica durante meses; o el
// operador se queda atascado y abandona el establecimiento a mitad, que es
// justo donde el producto todavia no le ha dado nada.
//
// POR QUE `bloquea` ES UN CAMPO Y NO UNA AUSENCIA DE CODIGO. Porque "no
// bloquea" solo se puede probar si alguien lo afirma. Con el campo, hay una
// prueba que recorre los tres estados y comprueba que ninguno bloquea; sin el,
// la unica forma de comprobarlo es leer todos los sitios donde podria haberse
// colado una guarda, y eso se deja de hacer a la tercera pantalla.
//
// POR QUE OMITIR NO EXIGE MOTIVO. Porque exigirlo es la penalizacion por otra
// via: friccion para el caso que la spec declara legitimo. Se registra el
// motivo si lo hay, y si no, se registra que no lo hubo.

import { crearGuideline, guardarGuideline } from "./modelo.mjs";

/** La etapa se llama como el area: no hay dos vocabularios para lo mismo. */
export const ETAPA = "diseno";

/**
 * @param {import("../repositorio.mjs").RepositorioDeNucleo} repositorio
 * @param {string} project_id
 * @returns {{estado: 'pendiente'|'omitida'|'definida', bloquea: false, penalizacion: null, motivo: string|null}}
 */
export function etapaDeDiseno(repositorio, project_id) {
  const definida = repositorio.guideline(project_id, ETAPA);
  if (definida) return { estado: "definida", bloquea: false, penalizacion: null, motivo: null };

  const omision = repositorio
    .decisiones(project_id)
    .filter((/** @type {any} */ d) => d.etapa === ETAPA && d.decision === "omitida")
    .at(-1);
  if (omision) return { estado: "omitida", bloquea: false, penalizacion: null, motivo: omision.motivo };

  return { estado: "pendiente", bloquea: false, penalizacion: null, motivo: null };
}

/**
 * @param {{project_id: string, motivo?: string|null, repositorio: import("../repositorio.mjs").RepositorioDeNucleo, ahora?: number}} datos
 */
export function omitirDiseno({ project_id, motivo = null, repositorio, ahora = Date.now() }) {
  const registro = Object.freeze({
    project_id,
    etapa: ETAPA,
    decision: "omitida",
    motivo: typeof motivo === "string" && motivo.trim().length > 0 ? motivo.trim() : null,
    instante: new Date(ahora).toISOString(),
  });
  repositorio.registrarDecision(registro);
  return { registro, etapa: etapaDeDiseno(repositorio, project_id) };
}

/**
 * Definirla es guardar la guideline del area `diseno`: no hay un almacen
 * aparte para el diseño, porque es una guideline mas y se versiona igual.
 *
 * @param {{
 *   project_id: string,
 *   contenido: string,
 *   reglas?: any[],
 *   arbol: import("../arbol.mjs").Arbol,
 *   repositorio: import("../repositorio.mjs").RepositorioDeNucleo,
 *   ruta_en_repo: string,
 *   ahora?: number,
 * }} datos
 */
export function definirDiseno({ project_id, contenido, reglas = [], arbol, repositorio, ruta_en_repo, ahora = Date.now() }) {
  const guideline = crearGuideline({ project_id, area: ETAPA, contenido, reglas, ruta_en_repo, ahora });
  const guardada = guardarGuideline({ guideline, arbol, repositorio, ruta_en_repo });
  repositorio.registrarDecision({
    project_id,
    etapa: ETAPA,
    decision: "definida",
    motivo: null,
    instante: new Date(ahora).toISOString(),
  });
  return { ...guardada, etapa: etapaDeDiseno(repositorio, project_id) };
}
