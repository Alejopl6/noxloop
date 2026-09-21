// «Una decision en vez de veinte»: la propuesta completa del bootstrap, ya
// calculada, esperando UNA aprobacion.
//
// QUE CAMBIA Y QUE NO. Lo que desaparece es el trabajo de pedir el analisis y
// de decidir recomendacion por recomendacion. Lo que NO desaparece es la puerta
// humana: aqui no se escribe nada, igual que en `analizar`. Esto agrupa lo que
// se puede aprobar junto y aparta lo que no, y `aplicarLote` sigue exigiendo
// una aprobacion explicita con el diff exacto delante (FR-026).
//
// POR QUE LA LINEA DEL BLOQUE VA POR «ADITIVO» Y NO POR «CUANTOS CAMBIOS». El
// riesgo no es que haya muchos cambios: es que haya UN cambio que el operador
// no habria hecho. Crear un archivo que no existia se deshace borrandolo y no
// destruye nada; pisar uno que el equipo escribio, no. Por eso una
// recomendacion que modifica un archivo existente sale del bloque y se presenta
// sola, aunque sea la unica de la lista y el bloque quede con dos.
//
// Y POR QUE LA QUE CONTRADICE LA CONSTITUTION NUNCA ENTRA (FR-028). Porque es
// exactamente la que existe para ser mirada. Un conflicto declarado y aprobado
// dentro de un «aprobar todo» es un conflicto que nadie leyo: la declaracion
// queda como decoracion y el proyecto acaba violando su propia regla con la
// firma del operador encima. El conflicto se acepta de uno en uno y con motivo,
// que es lo que `aplicar` ya exige.
//
// LO QUE ESTE ARCHIVO NO PUEDE PERDER AL AGRUPAR: `diff_obsoleto`. Entre
// calcular el diff y aprobarlo el arbol es de otro —el operador tiene el editor
// abierto—. Con una recomendacion suelta, `aplicar` compara la base y se niega.
// Con un lote, la forma ingenua es comprobar mientras se escribe, y entonces
// las tres primeras ya estan en el disco cuando la cuarta descubre que el arbol
// se movio: medio lote aplicado que nadie aprobo asi. Aqui las bases de TODAS
// se comprueban antes de escribir NINGUNA.

import { loteVacio, recomendacionFueraDelLote, rutaRepetidaEnElLote, diffObsoleto } from "../errores.mjs";
import { huellaDe } from "./diff.mjs";
import { aplicar } from "./decision.mjs";

/**
 * Los motivos por los que una recomendacion se decide sola.
 *
 * ES UNA TABLA DE DATOS Y NO UNA CADENA DE `if` por lo mismo que el catalogo:
 * la pantalla tiene que poder agrupar por motivo y explicarlo sin repetir el
 * texto, y un motivo nuevo tiene que ser una fila.
 *
 * @type {ReadonlyArray<{id: string, porque: string}>}
 */
export const MOTIVOS_FUERA_DEL_LOTE = Object.freeze([
  Object.freeze({
    id: "conflicto_constitution",
    porque:
      "contradice un invariante de la constitution del proyecto, y esa es justo la recomendacion que existe " +
      "para ser mirada: aceptar el conflicto es una decision con motivo, no una casilla dentro de un bloque.",
  }),
  Object.freeze({
    id: "pisa_un_archivo_existente",
    porque:
      "modifica archivos que ya estan en el arbol. Crear uno que no existia se deshace borrandolo; pisar el " +
      "que escribio el equipo, no — y el diff de esa sustitucion es lo que hay que leer antes, no despues.",
  }),
]);

/** @type {Record<string, string>} */
const PORQUE = Object.fromEntries(MOTIVOS_FUERA_DEL_LOTE.map((m) => [m.id, m.porque]));

/**
 * Por que esta recomendacion no se puede aprobar en bloque, o `null` si si.
 *
 * SE EXPORTA porque la pantalla necesita pintar el motivo junto a cada
 * recomendacion sin volver a derivarlo: dos derivaciones de la misma regla se
 * separan, y la que se separa es la de la pantalla —la que el operador lee.
 *
 * @param {any} recomendacion
 * @returns {string|null} el `id` del motivo
 */
export function fueraDelLote(recomendacion) {
  if (recomendacion?.conflicto_constitution) return "conflicto_constitution";
  const cambios = recomendacion?.cambios ?? [];
  // `accion` la puso `calcularCambios` leyendo el arbol: `crear` significa que
  // en ese momento el archivo no existia. Que hoy exista es un `diff_obsoleto`,
  // y lo detecta `aplicarLote` comparando la huella — no se adivina aqui.
  if (cambios.some((/** @type {any} */ c) => c.accion !== "crear")) return "pisa_un_archivo_existente";
  return null;
}

/** @param {any} recomendacion */
const rutasDe = (recomendacion) => (recomendacion?.cambios ?? []).map((/** @type {any} */ c) => c.ruta);

/**
 * La propuesta completa a partir de un analisis.
 *
 * NO RECALCULA NADA. Recibe el analisis —que ya trae el diff exacto de cada
 * recomendacion contra el arbol de ese momento— y lo reparte. Recalcular aqui
 * abriria la puerta a que la propuesta mostrara un diff y `aplicarLote`
 * escribiera otro.
 *
 * @param {any} analisis lo que devuelve `analizar`
 */
export function proponerBootstrap(analisis) {
  /** @type {any[]} */
  const lote = [];
  /** @type {any[]} */
  const aparte = [];

  for (const recomendacion of analisis?.recomendaciones ?? []) {
    const motivo = fueraDelLote(recomendacion);
    if (motivo === null) {
      lote.push(recomendacion);
      continue;
    }
    aparte.push(
      Object.freeze({
        recomendacion,
        motivo,
        porque: PORQUE[motivo],
        rutas: Object.freeze(rutasDe(recomendacion)),
        // Se repite el conflicto aqui, en vez de obligar a buscarlo dentro de la
        // recomendacion: es lo primero que la persona tiene que leer.
        conflicto_constitution: recomendacion.conflicto_constitution ?? null,
      }),
    );
  }

  const rutas = lote.flatMap(rutasDe);

  return Object.freeze({
    project_id: analisis?.project_id ?? null,
    snapshot_id: analisis?.snapshot_id ?? null,
    analizado_en: analisis?.analizado_en ?? null,
    constitution_evaluada: analisis?.constitution_evaluada ?? false,

    lote: Object.freeze({
      recomendaciones: Object.freeze(lote),
      rutas: Object.freeze(rutas),
      // El diff del bloque ENTERO, en el mismo orden en que se va a escribir.
      // Va aqui y no se pide aparte: aprobar en bloque sin el diff delante es
      // fe, que es exactamente lo que FR-026 prohibe.
      diff: lote.map((r) => r.diff).join("\n\n"),
      aprobable: lote.length > 0,
    }),

    aparte: Object.freeze(aparte),

    // Agrupar no es esconder: lo que el analisis no pudo proponer y lo que ya
    // estaba viajan igual. Una propuesta que solo muestra el bloque hace creer
    // que el bootstrap termina ahi.
    preguntas: analisis?.preguntas ?? Object.freeze([]),
    ya_presentes: analisis?.ya_presentes ?? Object.freeze([]),
    deteccion: analisis?.deteccion ?? null,

    // CUANTAS VECES HAY QUE DECIDIR. Es el numero que mide si el rediseño sirvio
    // de algo, y por eso se publica en vez de dejarlo implicito: si vuelve a ser
    // uno por recomendacion, se ve aqui y no en la queja del operador.
    decisiones: (lote.length > 0 ? 1 : 0) + aparte.length,
  });
}

/**
 * Comprueba la base de TODOS los cambios del lote contra el arbol de ahora.
 *
 * Devuelve lo que falta por escribir y lo que ya estaba escrito igual. No
 * escribe: esa es la funcion.
 *
 * @param {import("../arbol.mjs").Arbol} arbol
 * @param {any[]} recomendaciones
 */
function comprobarTodasLasBases(arbol, recomendaciones) {
  /** @type {{ruta: string, motivo: string}[]} */
  const desfasados = [];

  for (const recomendacion of recomendaciones) {
    for (const cambio of recomendacion.cambios ?? []) {
      const actual = arbol.leer(cambio.ruta);
      if (actual === cambio.contenido) continue; // ya esta escrito asi: idempotente
      const esperada = ((recomendacion.base ?? []).find((/** @type {any} */ b) => b.ruta === cambio.ruta) ?? cambio)
        .huella_antes;
      const real = huellaDe(actual);
      if (real === esperada) continue;
      desfasados.push({
        ruta: cambio.ruta,
        motivo:
          esperada === null
            ? "el diff decia crearlo y el archivo ya existe"
            : real === null
              ? "el archivo que el diff iba a modificar ya no esta"
              : "su contenido cambio despues de calcularse el diff",
      });
    }
  }

  // TODOS los desfases de golpe, no el primero. El operador que recalcula
  // quiere saber cuanto se movio el arbol, no descubrirlo de uno en uno.
  if (desfasados.length > 0) throw diffObsoleto(desfasados);
}

/**
 * Aprueba el bloque entero: una decision del operador, todas sus escrituras.
 *
 * EL ORDEN ES LA GARANTIA. Primero se comprueba que ninguna esta fuera del
 * bloque, despues que ninguna pisa a otra, despues que el arbol no se movio
 * bajo ninguna — y solo entonces se escribe. Cualquiera de las tres
 * comprobaciones hecha mientras se escribe deja medio lote aplicado.
 *
 * @param {any} propuesta lo que devuelve `proponerBootstrap`, o `{lote: {recomendaciones}}`
 * @param {{
 *   arbol: import("../arbol.mjs").Arbol,
 *   repositorio: import("../repositorio.mjs").RepositorioDeNucleo,
 *   ahora?: number,
 *   motivo?: string|null,
 * }} opts
 */
export function aplicarLote(propuesta, { arbol, repositorio, ahora = Date.now(), motivo = null }) {
  const recomendaciones = propuesta?.lote?.recomendaciones ?? propuesta?.recomendaciones ?? [];
  if (recomendaciones.length === 0) throw loteVacio();

  // 1. Ninguna que exija mirarse. La guarda se repite aqui a proposito: ver la
  //    cabecera de `recomendacionFueraDelLote`.
  for (const recomendacion of recomendaciones) {
    const fuera = fueraDelLote(recomendacion);
    if (fuera) throw recomendacionFueraDelLote(recomendacion.id, fuera, PORQUE[fuera]);
  }

  // 2. Ninguna pisa a otra dentro del mismo lote.
  /** @type {Map<string, string[]>} */
  const porRuta = new Map();
  for (const recomendacion of recomendaciones) {
    for (const ruta of rutasDe(recomendacion)) {
      if (!porRuta.has(ruta)) porRuta.set(ruta, []);
      porRuta.get(ruta)?.push(recomendacion.id);
    }
  }
  for (const [ruta, ids] of porRuta) {
    if (ids.length > 1) throw rutaRepetidaEnElLote(ruta, ids);
  }

  // 3. El arbol no se movio bajo ninguna. Lanza antes de la primera escritura.
  comprobarTodasLasBases(arbol, recomendaciones);

  // 4. Y ahora si. Cada una pasa por `aplicar`, que es donde viven el registro
  //    de la decision (FR-027) y la escritura del contenido exacto: duplicar
  //    eso aqui seria una segunda copia que se separa de la primera.
  /** @type {any[]} */
  const aplicadas = [];
  /** @type {string[]} */
  const escrituras = [];
  /** @type {string[]} */
  const sin_cambios = [];

  for (const recomendacion of recomendaciones) {
    const salida = aplicar(recomendacion, { arbol, repositorio, ahora, motivo });
    aplicadas.push(salida.recomendacion);
    escrituras.push(...salida.escrituras);
    if (salida.sin_cambios) sin_cambios.push(recomendacion.id);
  }

  return {
    aplicadas,
    escrituras,
    sin_cambios,
    // Lo que sigue esperando una decision. Va en la respuesta para que la
    // pantalla no tenga que volver a preguntar para saber si el bootstrap
    // quedo resuelto o no.
    aparte: propuesta?.aparte ?? [],
    preguntas: propuesta?.preguntas ?? [],
  };
}
