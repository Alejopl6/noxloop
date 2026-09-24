// LAS DOS TAREAS, Y POR QUE SON ESTAS DOS.
//
// EL CRITERIO PARA ELEGIRLAS. Este producto ya detecta muchas cosas de forma
// determinista, con evidencia, y una sugerencia de modelo donde ya hay un hecho
// medido es peor que nada: compite con el hecho, se parece a el, y lo unico que
// puede hacer es empeorarlo. Asi que la pregunta no fue «que puede hacer un
// modelo» sino «que hueco del producto tiene HOY una hoja en blanco delante del
// operador, y no se puede llenar con codigo».
//
// LO QUE SE DESCARTO, CON SU MOTIVO:
//
//   - EXPLICAR UN HALLAZGO EN LENGUAJE LLANO. El hallazgo ya trae categoria,
//     clave, valor y las rutas que lo respaldan. Una parafrasis no añade dato y
//     si añade riesgo: un texto del modelo al lado de un hecho medido es la
//     forma mas rapida de que los dos se lean con la misma autoridad. Es
//     exactamente el caso que el enunciado de esta tarea llama «peor que nada».
//   - QUE REVISAR PRIMERO DE UN DIFF. El servicio de control no expone ningun
//     diff: lo que hay es el diff del bootstrap, que ya viene con sus cambios
//     calculados y su huella. Sugerir sobre algo que no existe todavia seria
//     construir la mitad que se ve de una funcion que no tiene la otra mitad.
//   - LA FLOTA. Ya se sugiere, y de forma determinista, desde el registro de
//     adaptadores (`/v1/projects/:id/agents/suggest`). Meter un modelo ahi es
//     sustituir un calculo por una opinion.
//
// LO QUE SE ELIGIO, Y ES LO MISMO LAS DOS VECES: un hueco que el producto
// declara vacio Y NO PUEDE LLENAR.
//
//   1. EL BORRADOR DE UNA GUIDELINE POR AREA. `crearGuideline` acepta
//      `contenido` —prosa libre— y `reglas`. Hoy el operador entra al area de
//      testing y encuentra un textarea vacio. El producto no tiene con que
//      llenarlo: sabe que el runner es `node:test` y que no hay cobertura, pero
//      convertir eso en «como se escriben los tests aqui» es redaccion, y la
//      redaccion no se deriva. Y la mitad que SI es verificable —si una regla
//      propuesta se puede comprobar sola— no la decide el modelo: la decide
//      `motivoDeNoVerificable` en `packages/core`, sobre la lista cerrada de
//      formas que este paquete recibe como insumo y no copia.
//   2. LOS INVARIANTES DE LA CONSTITUTION. El nucleo ya deriva los APARTADOS
//      del snapshot con su origen marcado; lo que no deriva son los
//      invariantes. `invariantesDe` solo saca el implicito —que el bootstrap no
//      reescriba la constitution— y cualquier otro conflicto declarado por el
//      operador deja de detectarse si nadie lo escribe. Escribirlos es decidir
//      que prohibe este proyecto, y eso es una decision humana: lo que un
//      modelo puede hacer es poner candidatos sobre la mesa, cada uno con el
//      hallazgo que lo motiva, para que la hoja deje de estar en blanco.
//
// LAS DOS PROPONEN Y NINGUNA DECIDE: lo que devuelven es un borrador que el
// operador pega —o no— en el `PUT` que ya existe. Ninguna ruta de asistencia
// escribe nada.

import { insumoIncompleto } from "./errores.mjs";
import { CATEGORIAS_POR_AREA, hallazgosDe, hechosComoTexto } from "./insumo.mjs";

/**
 * Lo que se le dice al modelo en todas las tareas.
 *
 * LAS TRES REGLAS SON LAS DEL SCANNER, DICHAS HACIA DENTRO. No estan aqui por
 * cortesia: el esquema restringe la FORMA de la respuesta y no su contenido, y
 * la unica forma de que el contenido se apoye en el snapshot es pedirlo y
 * despues comprobarlo. Lo segundo —la comprobacion de citas— es lo que tiene
 * dientes; esto sube la probabilidad de que la comprobacion pase.
 */
const SISTEMA =
  "Trabajas dentro de una herramienta que distingue lo detectado de lo supuesto, y esa distincion es su " +
  "principio central. Estas reglas no son de estilo:\n" +
  "1. Solo puedes apoyarte en los hechos de la lista que se te da. No conoces este proyecto por ningun otro " +
  "camino: no hay repositorio que mirar ni archivos que abrir.\n" +
  "2. Cada pieza que propongas tiene que citar, en `se_apoya_en`, las claves EXACTAS de los hechos en los que " +
  "se apoya. Una clave que no este en la lista hace que se rechace la respuesta entera, no solo esa pieza.\n" +
  "3. Un hecho marcado HUECO DECLARADO significa que se busco y no habia. Es informacion, no un campo que " +
  "falta: no lo rellenes con lo probable, pero si puedes proponer que se llene.\n" +
  "4. Un hecho marcado LECTURA no tiene ningun archivo detras. Puedes apoyarte en el, pero no lo trates como " +
  "algo comprobado.\n" +
  "5. No afirmes nada que no puedas anclar a una clave. Si no tienes con que sostener una pieza, no la " +
  "propongas: una sugerencia de menos no cuesta nada y una inventada cuesta meses.\n" +
  "Escribe en español, sin tildes en los identificadores y sin adornos.";

/** @param {readonly string[]} formas */
function esquemaDeGuideline(formas) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["borrador", "se_apoya_en", "reglas"],
    properties: {
      borrador: {
        type: "string",
        minLength: 1,
        description:
          "El texto en markdown de la guideline: como se trabaja esta area EN ESTE proyecto, segun los hechos. " +
          "Es documentacion para quien va a escribir codigo, no un resumen del escaneo.",
      },
      se_apoya_en: {
        type: "array",
        items: { type: "string" },
        description: "Claves de los hechos en los que se apoya el borrador. Al menos una, y todas de la lista.",
      },
      reglas: {
        type: "array",
        description:
          "Reglas candidatas que un runtime podria comprobar solo. Puede ir vacia: si nada de esta area es " +
          "comprobable con las formas disponibles, no inventes una regla para llenar el hueco.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["enunciado", "comprobacion", "se_apoya_en"],
          properties: {
            enunciado: { type: "string", minLength: 1, description: "La regla, en una frase." },
            comprobacion: {
              type: "object",
              additionalProperties: false,
              required: ["tipo"],
              properties: {
                tipo: { type: "string", enum: [...formas] },
                comando: { type: "string" },
                ruta: { type: "string" },
                patron: { type: "string" },
              },
            },
            se_apoya_en: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  };
}

const ESQUEMA_DE_INVARIANTES = {
  type: "object",
  additionalProperties: false,
  required: ["invariantes"],
  properties: {
    invariantes: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["enunciado", "porque", "se_apoya_en"],
        properties: {
          enunciado: {
            type: "string",
            minLength: 1,
            description:
              "Lo que este proyecto NO se permite. Un invariante es una prohibicion: si se puede cumplir a " +
              "medias, no es un invariante, es una preferencia.",
          },
          porque: {
            type: "string",
            minLength: 1,
            description: "Que fallo concreto evita. No la intencion: el fallo.",
          },
          se_apoya_en: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

/**
 * @typedef {object} Tarea
 * @property {string} clave
 * @property {string} titulo
 * @property {string} para_que
 * @property {string} por_que_no_es_determinista
 * @property {string} esquema_id
 * @property {(opciones: any) => any} esquema
 * @property {(datos: {snapshot: any, opciones: any}) => {sistema: string, instruccion: string}} preparar
 */

/** @type {readonly Tarea[]} */
export const TAREAS = Object.freeze([
  Object.freeze({
    clave: "guideline",
    titulo: "Borrador de la guideline de un area",
    para_que:
      "Convertir los hallazgos del area en el texto que el runtime leera antes de tocar codigo, mas las reglas " +
      "candidatas que podrian comprobarse solas.",
    por_que_no_es_determinista:
      "El producto sabe QUE hay en el area —el runner, si hay cobertura, que corre en CI— pero convertir eso en " +
      "«como se trabaja aqui» es redaccion, y la redaccion no se deriva de una tabla. Hoy el operador se " +
      "encuentra un textarea vacio y nadie tiene con que llenarlo.",
    esquema_id: "guideline/1",
    /** @param {any} opciones */
    esquema: (opciones) => esquemaDeGuideline(opciones.formas_de_comprobacion),
    /** @param {{snapshot: any, opciones: any}} datos */
    preparar({ snapshot, opciones }) {
      const area = opciones.area;
      if (!area) throw insumoIncompleto("el area de la guideline", "area");
      if (!CATEGORIAS_POR_AREA[area]) {
        throw insumoIncompleto(
          `una correspondencia declarada entre el area \`${area}\` y las categorias del scanner`,
          Object.keys(CATEGORIAS_POR_AREA),
          "Pide la sugerencia sobre un area que tenga correspondencia declarada en `insumo.mjs`. La tabla se " +
            "escribe a mano a proposito: dejar que el modelo decida que hallazgos son del area pone esa " +
            "decision donde nadie la puede revisar.",
        );
      }
      if (!Array.isArray(opciones.formas_de_comprobacion) || opciones.formas_de_comprobacion.length === 0) {
        throw insumoIncompleto(
          "la lista de `formas_de_comprobacion` que el runtime sabe correr",
          "formas_de_comprobacion",
          "Pasa las formas que declara `packages/core` (`COMPROBACIONES`). Este paquete no las copia a " +
            "proposito: dos listas de lo mismo en dos sitios se separan, y el dia que se separen la pantalla " +
            "enseñara como verificable una regla que ningun runtime puede correr.",
        );
      }

      const hallazgos = hallazgosDe(snapshot, area);
      if (hallazgos.length === 0) {
        throw insumoIncompleto(
          `hallazgos del area \`${area}\` en este snapshot`,
          CATEGORIAS_POR_AREA[area],
          `El escaneo de este proyecto no produjo ningun hallazgo de las categorias que tocan \`${area}\`. ` +
            "Escanea otra vez, o escribe la guideline a mano: un borrador sobre un area que el escaneo no vio " +
            "seria texto sobre proyectos en general.",
        );
      }

      return {
        sistema: SISTEMA,
        instruccion:
          `Area: ${area}.\n\n` +
          "Hechos del escaneo que tocan esta area (son TODO lo que sabes del proyecto):\n" +
          `${hechosComoTexto(hallazgos)}\n\n` +
          "Escribe el borrador de la guideline de esta area y propon las reglas candidatas que un runtime " +
          "podria comprobar solo. Para cada regla elige una de las formas de comprobacion disponibles y " +
          `rellena sus campos: ${opciones.formas_de_comprobacion.join(", ")}. Una regla que no encaje en ` +
          "ninguna de esas formas no la propongas como regla: metela en el borrador, que es donde vive lo que " +
          "se lee pero no se comprueba.",
      };
    },
  }),

  Object.freeze({
    clave: "invariantes",
    titulo: "Invariantes candidatos para la constitution",
    para_que:
      "Poner sobre la mesa que podria prohibir este proyecto, con el hallazgo que motiva cada prohibicion, para " +
      "que la constitution no se fije con la lista de invariantes vacia.",
    por_que_no_es_determinista:
      "El nucleo deriva los apartados del snapshot con su origen marcado, pero los invariantes no: solo saca el " +
      "implicito. Sin los demas, el contraste del bootstrap (FR-028) no detecta ningun conflicto declarado y " +
      "nadie se entera, porque no falla: propone la recomendacion sin marcarla.",
    esquema_id: "invariantes/1",
    esquema: () => ESQUEMA_DE_INVARIANTES,
    /** @param {{snapshot: any, opciones: any}} datos */
    preparar({ snapshot }) {
      const hallazgos = hallazgosDe(snapshot);
      if (hallazgos.length === 0) {
        throw insumoIncompleto("un snapshot con hallazgos", "hallazgos");
      }
      return {
        sistema: SISTEMA,
        instruccion:
          "Hechos del escaneo de este proyecto (son TODO lo que sabes de el):\n" +
          `${hechosComoTexto(hallazgos)}\n\n` +
          "Propon invariantes candidatos para la constitution de este proyecto. Un invariante es una " +
          "PROHIBICION que no admite excepcion: algo que, si se rompe, invalida el trabajo aunque todo lo " +
          "demas este bien. No propongas buenas practicas ni objetivos — eso son guidelines. Cada invariante " +
          "tiene que evitar un fallo concreto que estos hechos hagan posible, y citarlos.",
      };
    },
  }),
]);

/** @param {string} clave */
export function tareaPorClave(clave) {
  return TAREAS.find((t) => t.clave === clave) ?? null;
}
