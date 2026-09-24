// Lo que todos los manejadores necesitan, en un sitio.
//
// POR QUE `exigir` Y NO UN `if (!x) throw` EN CADA RUTA. Un campo obligatorio
// comprobado a mano sale como "falta nombre" la primera vez, como un 500 la
// segunda y como un `undefined` persistido la tercera — y la tercera es la
// cara: una fila con un hueco se lee despues como un dato verificado. Aqui el
// error sale siempre igual y siempre nombra TODOS los campos que faltan, no el
// primero: corregir de a uno obliga a cuatro viajes para descubrir los cuatro.

import { createHash } from "node:crypto";

import { ErrorDeServicio } from "./errores.mjs";

/**
 * @param {Record<string, any>} cuerpo
 * @param {string[]} campos
 * @param {string} [pista]
 */
export function exigir(cuerpo, campos, pista) {
  const faltan = campos.filter((c) => {
    const v = cuerpo?.[c];
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  });
  if (faltan.length > 0) {
    throw new ErrorDeServicio("cuerpo_invalido", {
      detalle: `${faltan.length === 1 ? "falta el campo" : "faltan los campos"} ${faltan
        .map((c) => `\`${c}\``)
        .join(", ")}${pista ? `. ${pista}` : ""}`,
      campos,
    });
  }
  return cuerpo;
}

/**
 * El proyecto, o el 404 que dice donde buscar el id bueno.
 *
 * @param {any} dep
 * @param {string} id
 */
export function exigirProyecto(dep, id) {
  const proyecto = dep.almacen.proyectos.porId(id);
  if (!proyecto) throw new ErrorDeServicio("proyecto_desconocido", { id });
  return proyecto;
}

/**
 * @param {string} tipo
 * @param {string} id
 * @param {string} donde donde se pide la lista de esos recursos
 * @param {string} [de] el contenedor, cuando lo hay
 */
export function noEsta(tipo, id, donde, de) {
  return new ErrorDeServicio("recurso_desconocido", { tipo, id, donde, de });
}

/**
 * El `ETag` de un valor cualquiera.
 *
 * POR QUE UN HASH DEL CONTENIDO Y NO UNA MARCA DE TIEMPO. `actualizado` tiene
 * resolucion de milisegundo, y dos escrituras dentro del mismo milisegundo
 * —dos ventanas guardando a la vez, que es justo el caso que esto cubre— dan la
 * misma marca. El cliente que leyo la primera pasaria el `If-Match` de la
 * segunda sin haberla visto.
 *
 * @param {any} valor
 */
export function etagDe(valor) {
  return `"${createHash("sha256").update(JSON.stringify(valor)).digest("hex").slice(0, 32)}"`;
}

/**
 * El compare-and-set del contrato: `412` si cambio por debajo.
 *
 * `If-Match` es OPCIONAL a proposito. Exigirlo siempre rompe a todo cliente que
 * no lo manda —la CLI, un `curl` de diagnostico— y el contrato lo declara como
 * la forma de detectar el conflicto, no como una obligacion de cada escritura.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {{tipo: string, id: string, actual: string}} recurso
 */
export function comprobarIfMatch(req, recurso) {
  const esperado = req.headers["if-match"];
  if (typeof esperado !== "string" || !esperado.trim() || esperado.trim() === "*") return;
  const declarados = esperado.split(",").map((e) => e.trim());
  if (declarados.includes(recurso.actual)) return;
  throw new ErrorDeServicio("estado_obsoleto", {
    tipo: recurso.tipo,
    id: recurso.id,
    esperado: declarados.join(", "),
    actual: recurso.actual,
  });
}

/**
 * Un slug a partir de un nombre. Minusculas, sin acentos y sin nada que no sea
 * alfanumerico: el slug viaja en URLs y en nombres de directorio.
 *
 * @param {string} nombre
 */
export function slugDe(nombre) {
  const base = String(nombre)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Un nombre escrito entero en un alfabeto sin equivalente latino se queda sin
  // slug. Devolver "" dejaria la clave unica del workspace colisionando para
  // todos ellos, asi que se declara lo que es: un slug que no se pudo derivar.
  return base || "proyecto";
}

/**
 * EL SOBRE DE TODA COLECCION. Siempre el mismo, siempre estos tres campos.
 *
 * POR QUE UN SOBRE Y NO EL ARRAY DESNUDO, NI UNA CLAVE POR RECURSO. Esto se
 * decidio tarde y a la fuerza: este servicio habia elegido `{agentes: [...]}` y
 * la interfaz habia elegido arrays desnudos, cada lado razonablemente, porque el
 * contrato no decia nada. Catorce rutas y once pantallas despues, la diferencia
 * aparecio al juntarlos. Los tres motivos por los que gana el sobre:
 *
 *   1. `avisos` lleva algo que NO TIENE OTRA CASA. Cuando se leen los runs y un
 *      archivo de estado esta ilegible, eso tiene que VERSE. Con un array
 *      desnudo la unica salida es omitir la fila en silencio, y una lista a la
 *      que le faltan elementos sin decirlo es peor que un error.
 *   2. `/v1/audit` ya lo necesitaba: declara `cursor` y `filtros_aplicados`, y
 *      ninguno de los dos cabe en un array.
 *   3. Un solo lector y un solo paginador. Con una clave distinta por recurso,
 *      un cliente generico necesita una tabla de traduccion por ruta que hay
 *      que mantener sincronizada con las rutas.
 *
 * Y CADA ELEMENTO VA COMPLETO. Nada de arrays de identificadores con tablas de
 * consulta al lado: a la escala de este producto —un operador, veinte
 * proyectos— normalizar la respuesta solo traslada el trabajo de unir al
 * cliente, y lo hace en doce sitios en vez de en uno.
 *
 * @param {any[]} items
 * @param {{cursor?: string|number|null, avisos?: Array<{codigo: string, causa: string, accion: string}>}} [opciones]
 * @param {Record<string, any>} [extra] datos propios de la ruta, JUNTO a `items` y nunca dentro
 */
export function coleccion(items, opciones = {}, extra = {}) {
  return {
    items,
    // `null` y no ausente: un campo que a veces no esta obliga a quien lo lee a
    // distinguir "no hay mas paginas" de "esta ruta no pagina", y las dos se
    // ven igual desde el cliente.
    cursor: opciones.cursor ?? null,
    avisos: opciones.avisos ?? [],
    ...extra,
  };
}

/**
 * La pagina que pide la query, acotada.
 *
 * @param {URL} url
 * @param {number} [porDefecto]
 * @param {number} [maximo]
 */
export function limiteDe(url, porDefecto = 100, maximo = 1000) {
  const crudo = url.searchParams.get("limite");
  if (!crudo) return porDefecto;
  const n = Number(crudo);
  if (!Number.isInteger(n) || n <= 0) return porDefecto;
  return Math.min(n, maximo);
}

/** Lo que el almacen guarda como JSON, devuelto como JSON y no como texto. */
export function conJson(fila, campos) {
  if (!fila) return fila;
  const salida = { ...fila };
  for (const campo of campos) {
    if (typeof salida[campo] === "string") {
      try {
        salida[campo] = JSON.parse(salida[campo]);
      } catch {
        // Una columna con JSON roto no puede tumbar la lectura entera: se deja
        // el texto crudo, que al menos deja ver que hay ahi.
      }
    }
  }
  return salida;
}
