// El documento de la propuesta, en la forma que tiene una constitution de
// verdad: principios numerados, cada uno con el fallo que lo motiva, la seccion
// de gobernanza y el pie de version.
//
// POR QUE LA FORMA IMPORTA Y NO ES COSMETICA. El documento que sale de aqui se
// versiona en el repositorio del proyecto y lo lee el runtime al compilar
// contexto. Un volcado de campos en JSON se lee como configuracion y se ignora;
// un documento con principios numerados se lee como reglas y se discute. La
// diferencia entre las dos cosas es exactamente lo que este producto vende.
//
// POR QUE EL HUECO SE IMPRIME EN VEZ DE DESAPARECER. Un apartado vacio que no
// sale en el documento es indistinguible de un apartado que nadie penso.
// Impreso como `[vacio]`, con lo que se busco y la pregunta que falta por
// responder, el hueco se ve y se cierra. Es el principio X: el hueco se declara
// hueco en vez de rellenarse con lo probable.

import { sellarPie } from "./modelo.mjs";

const ROMANOS = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

/** @param {number} n */
export function romano(n) {
  let resto = n;
  let salida = "";
  for (const [valor, letra] of ROMANOS) {
    while (resto >= Number(valor)) {
      salida += letra;
      resto -= Number(valor);
    }
  }
  return salida;
}

/** @param {any[]} evidencia */
function citas(evidencia) {
  return evidencia
    .slice(0, 6)
    .map((e) => (e.linea ? `\`${e.ruta}:${e.linea}\`` : `\`${e.ruta}\``))
    .join(", ");
}

/**
 * La linea que dice de donde sale el apartado. Es lo que el principio X exige
 * que este en la pantalla Y en el documento: una marca que solo vive en la
 * interfaz se pierde en cuanto alguien lee el archivo en el repositorio.
 *
 * @param {any} apartado
 */
function lineaDeOrigen(apartado) {
  if (apartado.origen === "detectado") return `**Origen**: detectado en ${citas(apartado.evidencia)}.`;
  if (apartado.origen === "inferido") {
    const donde = apartado.evidencia.length > 0 ? ` a partir de ${citas(apartado.evidencia)}` : "";
    return `**Origen**: inferido${donde}, confianza ${apartado.confianza}. No hay un archivo que lo afirme.`;
  }
  const donde = apartado.evidencia.length > 0 ? ` Se busco en ${citas(apartado.evidencia)}.` : "";
  return `**Origen**: [vacio]. ${apartado.motivo}${donde}`;
}

/**
 * @param {{proyecto: any, apartados: any[], version: string, snapshot: any, ahora: number, ruta: any}} datos
 * @returns {string}
 */
export function renderPropuesta({ proyecto, apartados, version, snapshot, ahora, ruta }) {
  const lineas = [];
  lineas.push(`# Constitution de ${proyecto?.nombre ?? "el proyecto"}`);
  lineas.push("");
  lineas.push(
    "Borrador derivado del snapshot `" +
      `${snapshot.id}\` sobre el commit \`${snapshot.commit ?? "sin commit"}\`. **No esta fijada.**`,
  );
  lineas.push("");
  lineas.push(
    "Cada apartado declara de donde sale: **detectado** con la ruta que lo respalda, **inferido** con su " +
      "confianza, o **[vacio]** con la constancia de que se busco y no habia. Un apartado inferido presentado " +
      "como detectado convierte una suposicion en la regla del proyecto, y el runtime la aplica durante meses " +
      "sin que nadie lo descubra: por eso la marca viaja en el documento y no solo en la pantalla.",
  );
  lineas.push("");
  lineas.push(`Se escribira en \`${ruta.ruta}\`${ruta.origen === "inferido" ? " (ruta por convencion, nadie la detecto)" : ""}.`);
  lineas.push("");
  lineas.push("## Core Principles");
  lineas.push("");

  apartados.forEach((apartado, i) => {
    lineas.push(`### ${romano(i + 1)}. ${apartado.titulo}`);
    lineas.push("");
    if (apartado.contenido === null) {
      lineas.push(`[vacio] ${apartado.motivo}`);
      lineas.push("");
      lineas.push(`**Pregunta pendiente**: ${apartado.pregunta}`);
    } else {
      lineas.push(apartado.contenido);
    }
    lineas.push("");
    lineas.push(lineaDeOrigen(apartado));
    lineas.push("");
    lineas.push(
      "**El fallo que lo motiva**: [vacio] — ningun scanner puede leerlo del arbol. Escribelo antes de fijar " +
        "la constitution: un principio sin un fallo concreto detras no es un principio, es una preferencia.",
    );
    lineas.push("");
  });

  lineas.push("## Governance");
  lineas.push("");
  lineas.push(
    "Esta seccion no sale del snapshot: es la regla que el producto impone a toda constitution que gestiona.",
  );
  lineas.push("");
  lineas.push(
    "Enmendar esta constitution requiere declarar tres cosas: el principio que cambia, el fallo concreto que " +
      "lo motiva y que se rompe si no se hace. Sin las tres, la enmienda se rechaza. Una enmienda sin un fallo " +
      "detras no es una enmienda: es una preferencia.",
  );
  lineas.push("");
  lineas.push(
    "Cada enmienda queda registrada con su fecha y su version, y la version anterior sigue siendo recuperable.",
  );
  lineas.push("");

  return sellarPie(lineas.join("\n"), { version, ratificada: ahora, enmendada: null }).replace(
    /\*\*Ratified\*\*: [\d-]+/,
    "**Ratified**: — (propuesta sin fijar)",
  );
}
