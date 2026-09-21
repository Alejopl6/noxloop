// FR-025 / FR-026 / FR-027 — las tres salidas de una recomendacion, y la
// garantia de que se escribe lo que el operador vio.
//
// POR QUE `aplicar` NO RECIBE EL CATALOGO NI EL SNAPSHOT. Porque la garantia no
// es que se abstenga de recalcular: es que no tiene con que. Recibe la
// recomendacion —que lleva el contenido exacto de cada archivo—, el arbol y el
// almacen. Aplicar algo distinto de lo mostrado es exactamente como se pierde
// la confianza en un instalador: el operador revisa un diff, aprueba, y lo que
// aparece es otra cosa. La siguiente vez no revisa el diff — o lo aplica todo a
// ciegas, o no lo aplica nunca. Las dos son peores que no tener la funcion.
//
// POR QUE LA BASE SE COMPRUEBA SIEMPRE. Entre calcular el diff y aprobarlo pasa
// tiempo, y en ese tiempo el arbol es de otro: el operador edita, una rama
// cambia, otra ventana aplica algo. Escribir encima de un cambio que nadie vio
// es la otra mitad del mismo fallo.
//
// POR QUE OMITIR SE REGISTRA IGUAL QUE APLICAR. Lo que mas informa a la
// evolucion continua no es lo que se aplico, es lo que se omitio y por que. Una
// propuesta que el 80% de los proyectos omite con el mismo motivo es una
// propuesta que hay que cambiar, y eso solo se sabe si el motivo se guardo.

import {
  conflictoNoAceptado,
  decisionDesconocida,
  diffObsoleto,
  personalizacionSinCambios,
  rutaFueraDelDiff,
} from "../errores.mjs";
import { huellaDe } from "./diff.mjs";

/** @type {readonly string[]} */
export const DECISIONES = Object.freeze(["aplicada", "personalizada", "omitida"]);

/**
 * Compara el arbol de ahora con la base que llevaba el diff.
 *
 * @param {import("../arbol.mjs").Arbol} arbol
 * @param {any[]} cambios
 * @param {any[]} base
 */
function comprobarBase(arbol, cambios, base) {
  /** @type {{ruta: string, motivo: string}[]} */
  const desfasados = [];
  /** @type {string[]} */
  const ya_aplicados = [];
  /** @type {any[]} */
  const pendientes = [];

  for (const cambio of cambios) {
    const actual = arbol.leer(cambio.ruta);
    if (actual === cambio.contenido) {
      // Ya esta escrito exactamente asi. Es el caso de aplicar dos veces, y
      // tiene que ser idempotente: el estado final es el que se aprobo.
      ya_aplicados.push(cambio.ruta);
      continue;
    }
    const esperada = (base.find((b) => b.ruta === cambio.ruta) ?? cambio).huella_antes;
    const real = huellaDe(actual);
    if (real !== esperada) {
      desfasados.push({
        ruta: cambio.ruta,
        motivo:
          esperada === null
            ? "el diff decia crearlo y el archivo ya existe"
            : real === null
              ? "el archivo que el diff iba a modificar ya no esta"
              : "su contenido cambio despues de calcularse el diff",
      });
      continue;
    }
    pendientes.push(cambio);
  }

  if (desfasados.length > 0) throw diffObsoleto(desfasados);
  return { ya_aplicados, pendientes };
}

/**
 * @param {any} recomendacion
 * @param {{decision: string, motivo?: string|null, ahora: number, conflicto_aceptado?: boolean, cambios?: any[]}} datos
 */
function conDecision(recomendacion, { decision, motivo = null, ahora, conflicto_aceptado = false, cambios }) {
  const entrada = Object.freeze({
    decision,
    motivo: typeof motivo === "string" && motivo.trim().length > 0 ? motivo.trim() : null,
    instante: new Date(ahora).toISOString(),
    conflicto_aceptado,
  });
  return Object.freeze({
    ...recomendacion,
    cambios: cambios ? Object.freeze(cambios) : recomendacion.cambios,
    decision,
    motivo_decision: entrada.motivo,
    decidida: entrada.instante,
    conflicto_aceptado: conflicto_aceptado || recomendacion.conflicto_aceptado === true,
    // El historial existe porque cambiar de opinion es legitimo y la primera
    // decision sigue informando: omitir hoy y aplicar mañana dice algo que
    // ninguna de las dos dice por separado.
    historial: Object.freeze([...(recomendacion.historial ?? []), entrada]),
  });
}

/**
 * @param {any} recomendacion
 * @param {any} decidida
 * @param {import("../repositorio.mjs").RepositorioDeNucleo} repositorio
 */
function registrar(recomendacion, decidida, repositorio) {
  repositorio.guardarRecomendacion(decidida);
  repositorio.registrarDecision({
    project_id: decidida.project_id,
    etapa: "bootstrap",
    recomendacion_id: decidida.id,
    entrada: decidida.entrada,
    capacidad: decidida.capacidad,
    decision: decidida.decision,
    motivo: decidida.motivo_decision,
    conflicto: recomendacion.conflicto_constitution ?? "",
    conflicto_aceptado: decidida.conflicto_aceptado,
    instante: decidida.decidida,
  });
}

/**
 * @param {any} recomendacion
 * @param {string} decision
 * @param {boolean} aceptado
 */
function exigirDecisionValida(recomendacion, decision, aceptado) {
  if (!DECISIONES.includes(decision)) throw decisionDesconocida(decision, DECISIONES);
  if (recomendacion.conflicto_constitution && decision !== "omitida" && !aceptado) {
    throw conflictoNoAceptado(recomendacion.conflicto_constitution);
  }
}

/**
 * @param {any} recomendacion
 * @param {{
 *   arbol: import("../arbol.mjs").Arbol,
 *   repositorio: import("../repositorio.mjs").RepositorioDeNucleo,
 *   ahora?: number,
 *   motivo?: string|null,
 *   conflicto_aceptado?: boolean,
 *   decision?: string,
 * }} opts
 */
export function aplicar(recomendacion, { arbol, repositorio, ahora = Date.now(), motivo = null, conflicto_aceptado = false, decision = "aplicada" }) {
  exigirDecisionValida(recomendacion, decision, conflicto_aceptado);

  const { ya_aplicados, pendientes } = comprobarBase(arbol, recomendacion.cambios, recomendacion.base);

  // Se escribe `cambio.contenido` tal cual viene de la recomendacion. Aqui no
  // hay plantilla, ni generador, ni snapshot: solo los bytes que se mostraron.
  for (const cambio of pendientes) arbol.escribir(cambio.ruta, cambio.contenido);

  const decidida = conDecision(recomendacion, { decision: "aplicada", motivo, ahora, conflicto_aceptado });
  registrar(recomendacion, decidida, repositorio);

  return {
    recomendacion: decidida,
    escrituras: pendientes.map((c) => c.ruta),
    sin_cambios: pendientes.length === 0 && ya_aplicados.length > 0,
  };
}

/**
 * @param {any} recomendacion
 * @param {{
 *   arbol: import("../arbol.mjs").Arbol,
 *   repositorio: import("../repositorio.mjs").RepositorioDeNucleo,
 *   cambios_modificados?: Array<{ruta: string, contenido: string}>,
 *   ahora?: number,
 *   motivo?: string|null,
 *   conflicto_aceptado?: boolean,
 * }} opts
 */
export function personalizar(recomendacion, { arbol, repositorio, cambios_modificados, ahora = Date.now(), motivo = null, conflicto_aceptado = false }) {
  exigirDecisionValida(recomendacion, "personalizada", conflicto_aceptado);
  if (!Array.isArray(cambios_modificados) || cambios_modificados.length === 0) throw personalizacionSinCambios();

  // Personalizar es cambiar el CONTENIDO de lo propuesto, no el alcance: una
  // ruta nueva no paso por la revision del operador, que aprobo una lista
  // concreta de archivos.
  const rutas = new Set(recomendacion.cambios.map((/** @type {any} */ c) => c.ruta));
  for (const cambio of cambios_modificados) {
    if (!rutas.has(cambio.ruta)) throw rutaFueraDelDiff(recomendacion.id, cambio.ruta);
  }

  const cambios = recomendacion.cambios.map((/** @type {any} */ original) => {
    const modificado = cambios_modificados.find((c) => c.ruta === original.ruta);
    if (!modificado) return original;
    return Object.freeze({
      ...original,
      contenido: modificado.contenido,
      huella_despues: huellaDe(modificado.contenido),
    });
  });

  // El operador partio de lo que vio: si el arbol se movio, su version tampoco
  // se puede escribir a ciegas.
  const { pendientes } = comprobarBase(arbol, cambios, recomendacion.base);
  for (const cambio of pendientes) arbol.escribir(cambio.ruta, cambio.contenido);

  const decidida = conDecision(recomendacion, { decision: "personalizada", motivo, ahora, conflicto_aceptado, cambios });
  registrar(recomendacion, decidida, repositorio);

  return { recomendacion: decidida, escrituras: pendientes.map((c) => c.ruta), sin_cambios: pendientes.length === 0 };
}

/**
 * @param {any} recomendacion
 * @param {{repositorio: import("../repositorio.mjs").RepositorioDeNucleo, ahora?: number, motivo?: string|null}} opts
 */
export function omitir(recomendacion, { repositorio, ahora = Date.now(), motivo = null }) {
  const decidida = conDecision(recomendacion, { decision: "omitida", motivo, ahora });
  registrar(recomendacion, decidida, repositorio);
  return { recomendacion: decidida, escrituras: [], sin_cambios: true };
}
