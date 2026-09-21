// El motor del bootstrap: detectar, y solo entonces proponer.
//
// EL ORDEN ES LA FUNCION, NO UN DETALLE DE IMPLEMENTACION (FR-024). Para una
// capacidad que ya existe en el proyecto, el generador de cambios NO SE LLAMA.
// No es que se llame y se descarte el resultado: es que no hay resultado que
// descartar, y por eso no puede colarse en la lista por un filtro que alguien
// mueva de sitio mañana.
//
// LO QUE ESTE ARCHIVO NO SABE, A PROPOSITO. No sabe que es un hook, ni que
// formato tiene una skill, ni que archivos existen en ningun ecosistema. Sabe
// que hay entradas de catalogo, que cada una declara la capacidad que aporta, y
// que una entrada o deriva su cambio del snapshot o pregunta. Es el principio
// VI aplicado al bootstrap: si soportar una propuesta nueva exigiera tocar
// esto, la interfaz estaria mal y lo que se arregla es la interfaz.
//
// Y ANALIZAR NO ESCRIBE. Ni un archivo, ni un temporal, ni una cache. FR-026
// dice que ninguna recomendacion escribe sin aprobacion explicita, y la etapa
// que calcula las recomendaciones es exactamente donde una escritura se colaria
// sin que nadie la asociara a una aprobacion.

import { randomUUID } from "node:crypto";

import { snapshotIncompleto } from "../errores.mjs";
import { detectarExistente, valoresDe } from "./deteccion.mjs";
import { calcularCambios } from "./diff.mjs";
import { conflictoDe, invariantesDe } from "./conflicto.mjs";
import { CATALOGO_POR_DEFECTO } from "./catalogo.mjs";

/**
 * @param {{
 *   snapshot: any,
 *   arbol: import("../arbol.mjs").Arbol,
 *   constitution?: any,
 *   catalogo?: readonly any[],
 *   project_id: string,
 *   ahora?: number,
 *   repositorio?: import("../repositorio.mjs").RepositorioDeNucleo|null,
 * }} entrada
 */
export function analizar({
  snapshot,
  arbol,
  constitution = null,
  catalogo = CATALOGO_POR_DEFECTO,
  project_id,
  ahora = Date.now(),
  repositorio = null,
}) {
  if (snapshot?.estado !== "completo") throw snapshotIncompleto(snapshot?.estado ?? "desconocido");

  // ---- Primero: que hay ya. Antes de mirar el catalogo siquiera. ----------
  const deteccion = detectarExistente(snapshot);
  const valores = valoresDe(snapshot);
  const invariantes = invariantesDe(constitution);

  /** @type {any[]} */
  const recomendaciones = [];
  /** @type {any[]} */
  const preguntas = [];
  /** @type {any[]} */
  const ya_presentes = [];

  for (const entrada of catalogo) {
    const capacidad = deteccion.capacidades[entrada.capacidad];

    if (capacidad && capacidad.presente) {
      ya_presentes.push(
        Object.freeze({
          entrada: entrada.id,
          capacidad: entrada.capacidad,
          titulo: capacidad.titulo,
          evidencia: capacidad.evidencia,
          motivo:
            `ya existe en este proyecto y se detecto en ${capacidad.evidencia
              .slice(0, 3)
              .map((/** @type {any} */ e) => `\`${e.ruta}\``)
              .join(", ")}. Proponerlo otra vez es la recomendacion mas molesta que este producto puede dar: ` +
            "quien la recibe aprende que la herramienta no miro su repositorio.",
        }),
      );
      continue;
    }

    const plan = entrada.cambios({ snapshot, deteccion, valores, capacidad });

    if (plan && plan.pregunta) {
      preguntas.push(
        Object.freeze({
          entrada: entrada.id,
          capacidad: entrada.capacidad,
          tipo: entrada.tipo,
          titulo: entrada.titulo,
          texto: plan.pregunta.texto,
          falta: Object.freeze([...(plan.pregunta.falta ?? [])]),
        }),
      );
      continue;
    }

    const calculado = calcularCambios(arbol, plan?.cambios ?? []);

    if (calculado.cambios.length === 0) {
      ya_presentes.push(
        Object.freeze({
          entrada: entrada.id,
          capacidad: entrada.capacidad,
          titulo: entrada.titulo,
          evidencia: Object.freeze(calculado.identicos.map((/** @type {string} */ ruta) => ({ ruta }))),
          motivo:
            calculado.identicos.length > 0
              ? `el arbol ya tiene exactamente ese contenido en ${calculado.identicos
                  .map((/** @type {string} */ r) => `\`${r}\``)
                  .join(", ")}: no hay nada que aprobar ni que escribir.`
              : "la entrada no produjo ningun cambio que proponer, asi que no hay diff que revisar.",
        }),
      );
      continue;
    }

    const recomendacion = {
      id: `rec_${entrada.id}_${randomUUID().slice(0, 8)}`,
      project_id,
      entrada: entrada.id,
      tipo: entrada.tipo,
      capacidad: entrada.capacidad,
      titulo: entrada.titulo,
      justificacion: entrada.justificacion,
      efectos: Object.freeze([...(entrada.efectos ?? [])]),
      cambios: Object.freeze(calculado.cambios),
      cambios_propuestos: Object.freeze(calculado.cambios),
      base: Object.freeze(calculado.base),
      diff: calculado.diff,
      conflicto_constitution: /** @type {string|null} */ (null),
      conflicto_aceptado: false,
      decision: "pendiente",
      motivo_decision: /** @type {string|null} */ (null),
      decidida: /** @type {string|null} */ (null),
      historial: Object.freeze([]),
      calculada: new Date(ahora).toISOString(),
    };
    recomendacion.conflicto_constitution = conflictoDe(recomendacion, invariantes);

    const congelada = Object.freeze(recomendacion);
    recomendaciones.push(congelada);
    repositorio?.guardarRecomendacion(congelada);
  }

  return Object.freeze({
    project_id,
    snapshot_id: snapshot.id,
    deteccion,
    recomendaciones: Object.freeze(recomendaciones),
    preguntas: Object.freeze(preguntas),
    ya_presentes: Object.freeze(ya_presentes),
    // Se declara si habia constitution contra la que contrastar: sin ella, un
    // `conflicto_constitution: null` significa "no habia reglas que comprobar",
    // no "se comprobo y no hay conflicto". Son cosas distintas y la pantalla
    // tiene que poder decirlas distinto.
    constitution_evaluada: constitution !== null,
    analizado_en: new Date(ahora).toISOString(),
  });
}
