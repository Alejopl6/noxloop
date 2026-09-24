// El catalogo de errores de la asistencia.
//
// POR QUE UN CATALOGO Y NO UN `throw new Error` EN CADA SITIO. Es la misma
// razon que en el servicio y en el nucleo: NFR-006 exige que todo error nombre
// la causa completa y la accion siguiente, y un mensaje escrito donde se
// detecta el fallo sale con lo que sabia quien lo escribio ese dia. Con el
// catalogo separado hay un sitio donde mirar que errores existen, y una prueba
// que los recorre todos.
//
// POR QUE CADA UNO TRAE SU `estado` HTTP. Porque este paquete se cablea detras
// de un servicio que tiene que contestar un codigo, y quien sabe cual
// corresponde es el dominio: una sugerencia que cita un hallazgo inventado no
// es un error de lo que pidio el operador (no es 400) ni una caida del servicio
// (no es 500) — es que el modelo devolvio algo que no se puede entregar. El
// servicio lee la forma `{codigo, causa, accion, estado}` y no importa esta
// clase: cada paquete viaja al escritorio por su cuenta.

export class ErrorDeAsistencia extends Error {
  /**
   * @param {string} codigo
   * @param {string} causa
   * @param {string} accion
   * @param {number} estado
   */
  constructor(codigo, causa, accion, estado) {
    super(causa);
    this.name = "ErrorDeAsistencia";
    this.codigo = codigo;
    this.causa = causa;
    this.accion = accion;
    this.estado = estado;
  }
}

/** @param {unknown} v */
const lista = (v) => (Array.isArray(v) ? v : [v]).map((x) => `\`${String(x)}\``).join(", ");

/**
 * @param {string} tarea
 * @param {readonly string[]} conocidas
 */
export function tareaDesconocida(tarea, conocidas) {
  return new ErrorDeAsistencia(
    "tarea_desconocida",
    `\`${String(tarea)}\` no es una tarea de asistencia. La lista es cerrada a proposito: cada tarea trae su ` +
      "esquema y su insumo, y una tarea sin esquema seria texto libre devuelto con forma de sugerencia.",
    `Pide una de estas: ${lista(conocidas)}.`,
    400,
  );
}

/**
 * Lo que falta para poder sugerir sin inventar.
 *
 * POR QUE ES UN ERROR Y NO UNA SUGERENCIA MAS FLOJA. Con un snapshot vacio —o
 * con un area que ningun hallazgo toca— lo que el modelo devolveria seria un
 * borrador sobre proyectos en general: texto razonable sobre un proyecto que no
 * es este. Eso es peor que la hoja en blanco, porque tiene aspecto de estar
 * derivado de algo.
 *
 * @param {string} que
 * @param {unknown} detalle
 * @param {string} [comoConseguirlo]
 */
export function insumoIncompleto(que, detalle, comoConseguirlo) {
  return new ErrorDeAsistencia(
    "insumo_incompleto",
    `No hay con que sugerir: falta ${String(que)}${detalle === undefined ? "" : ` (${lista(detalle)})`}. ` +
      "Sin ese insumo, lo que el modelo devolveria seria un texto razonable sobre un proyecto que no es este, " +
      "y eso es peor que no devolver nada porque tiene aspecto de estar derivado del escaneo.",
    comoConseguirlo ??
      "Corre el escaneo del proyecto (`POST /v1/projects/:id/scan`) y pide la sugerencia sobre un area que el " +
        "snapshot haya tocado.",
    422,
  );
}

/**
 * La salida del modelo no encaja en el esquema declarado.
 *
 * @param {unknown} problemas
 * @param {readonly string[]} [formas] las formas de comprobacion que si valen, cuando el fallo es esa
 */
export function salidaNoEncaja(problemas, formas) {
  return new ErrorDeAsistencia(
    "salida_no_encaja",
    "Lo que devolvio el modelo no encaja en el esquema de esta tarea: " +
      `${(Array.isArray(problemas) ? problemas : [problemas]).join("; ")}. No se entrega a medias: una ` +
      "sugerencia con la forma rota hay que leerla entera para saber que le falta, que es el trabajo que esto " +
      "venia a ahorrar.",
    formas && formas.length
      ? `Las formas de comprobacion que el runtime sabe correr son ${lista(formas)}. Vuelve a pedir la ` +
        "sugerencia; si el modelo insiste en una forma que no existe, el esquema que se le manda no la esta " +
        "restringiendo y el fallo esta en el esquema, no en la respuesta."
      : "Vuelve a pedir la sugerencia: la generacion no es determinista. Si el mismo snapshot la rompe siempre, " +
        "el esquema que viaja al modelo y el que valida la respuesta se separaron, y eso se arregla en el codigo.",
    502,
  );
}

/**
 * Una pieza sugerida cita un hallazgo que el snapshot no tiene.
 *
 * ESTE ES EL ERROR QUE JUSTIFICA EL PAQUETE. Una sugerencia que se apoya en un
 * hecho inventado no se distingue leyendola: esta bien escrita y es plausible.
 * Lo unico comprobable por maquina de una sugerencia es de donde dice que sale,
 * y por eso se comprueba.
 *
 * @param {unknown} clave
 * @param {unknown} existentes
 * @param {string} [donde]
 */
export function citaInventada(clave, existentes, donde) {
  const cuantas = Array.isArray(existentes) ? existentes.length : 0;
  return new ErrorDeAsistencia(
    "cita_inventada",
    `La sugerencia${donde ? ` en ${donde}` : ""} dice apoyarse en el hallazgo \`${String(clave)}\`, y este ` +
      `snapshot no tiene ninguno con esa clave (tiene ${cuantas}). Una sugerencia que cita un hecho que no ` +
      "existe esta igual de bien escrita que una que cita uno real: no se puede distinguir leyendola, asi que " +
      "no se entrega.",
    "Vuelve a pedir la sugerencia. Si se repite sobre el mismo snapshot, mira que hallazgos tiene de verdad en " +
      "`GET /v1/projects/:id/snapshot`: lo que se le esta pasando al modelo no contiene la clave que cita, y " +
      "entonces el fallo esta en el recorte del insumo.",
    502,
  );
}

/**
 * @param {unknown} enunciado
 */
export function sugerenciaSinApoyo(enunciado) {
  return new ErrorDeAsistencia(
    "sugerencia_sin_apoyo",
    `La pieza «${String(enunciado)}» no cita ningun hallazgo. Sin una cita no se apoya en este proyecto: se ` +
      "apoya en lo que el modelo sabe de los proyectos en general, que es lo que se puede leer en cualquier " +
      "sitio y no es lo que se le pidio.",
    "Vuelve a pedir la sugerencia. Si el modelo devuelve piezas sin apoyo de forma sistematica, el snapshot que " +
      "se le esta pasando no tiene hallazgos del area y hay que escanear antes.",
    502,
  );
}

/**
 * @param {unknown} detalle
 */
export function modeloNoContesto(detalle) {
  return new ErrorDeAsistencia(
    "modelo_no_contesto",
    `El proveedor del modelo no devolvio ninguna sugerencia: ${String(detalle)}. La asistencia es lo unico de ` +
      "este producto que depende de un servicio de fuera, asi que su caida se nombra como lo que es en vez de " +
      "salir como un fallo del servicio de control.",
    "Comprueba que la credencial del modelo sigue viva en `GET /v1/credentials` y que su grant no esta revocado " +
      "en `GET /v1/grants`. El resto del producto funciona entero sin esto.",
    502,
  );
}

/**
 * El SDK no esta donde el import lo busca.
 *
 * EL FALLO QUE ESTE ERROR HACE VISIBLE, Y ES EL DEL EMPAQUETADO. En el
 * repositorio el import resuelve siempre; en la aplicacion instalada resuelve
 * solo si el subarbol de `node_modules` viajo como recurso. Sin este error, lo
 * que el operador ve es una ventana que no abre y una traza que no es suya.
 *
 * @param {unknown} especificador
 * @param {unknown} [detalle]
 */
export function sdkAusente(especificador, detalle) {
  return new ErrorDeAsistencia(
    "sdk_ausente",
    `No se pudo cargar \`${String(especificador)}\`, que es el SDK con el que se le habla al modelo: ` +
      `${String(detalle ?? "ERR_MODULE_NOT_FOUND")}. En el repositorio este import resuelve siempre; en la ` +
      "aplicacion instalada resuelve solo si el paquete viajo como recurso del sidecar, porque el bundle no " +
      "lleva `node_modules`.",
    "Declara el subarbol del paquete en `bundle.resources` de `apps/desktop/src-tauri/tauri.conf.json` " +
      "(`../../../node_modules/<paquete>` hacia `app/node_modules/<paquete>`) y vuelve a construir la " +
      "aplicacion. La guarda que ata los imports a los recursos esta en " +
      "`packages/service/test/recursos-del-escritorio.test.mjs`.",
    503,
  );
}
