// Los repositorios que una conexion alcanza, con la forma del contrato.
//
// POR QUE ESTA PROYECCION EXISTE EN VEZ DE DEVOLVER LO QUE CONTESTO LA FORJA.
// Porque lo que contesta la forja son sus nombres: `full_name`, `clone_url`,
// `default_branch`. Si eso viajara tal cual, la pantalla se escribiria contra
// el vocabulario de UNA forja concreta y el segundo proveedor obligaria a
// tocarla — que es exactamente lo que la fachada existe para evitar. Aqui la
// pantalla ve `nombre_completo`, `url_clon` y `rama_por_defecto`, y quien
// agregue otra forja declara de que campo crudo sale cada uno.
//
// Y LA OTRA MITAD: LO QUE NO SE COPIA. La proyeccion es una lista blanca. Un
// `...crudo` habria sido mas corto y habria arrastrado a la respuesta todo lo
// que la forja decida mandar — incluidos los bloques de permisos y los tokens
// de instalacion que algunas APIs incluyen en la misma fila. La regla del
// paquete es que ninguna respuesta lleva el valor de una credencial, y la unica
// forma de sostenerla es que lo que sale este enumerado.

import { fallar } from "./errores.mjs";

/** Los campos del contrato. El orden es el de la ficha que se dibuja. */
export const CAMPOS_DE_REPOSITORIO = Object.freeze([
  "id",
  "nombre",
  "nombre_completo",
  "descripcion",
  "privado",
  "rama_por_defecto",
  "url_clon",
  "url_ssh",
  "url_web",
  "actualizado",
]);

/** Cuantos se piden a la forja cuando nadie dice otra cosa. */
export const POR_PAGINA_POR_DEFECTO = 100;

/** Cuantos se devuelven cuando nadie dice otra cosa. Una pantalla, no un volcado. */
export const LIMITE_DE_REPOSITORIOS = 50;

/**
 * Texto comparable: sin mayusculas y sin acentos.
 *
 * Es la misma normalizacion que usa el catalogo consultable, y por el mismo
 * motivo: sin quitar los acentos, buscar un nombre acentuado falla y quien
 * busca no sabe que el que falla es su teclado.
 *
 * @param {unknown} texto
 */
export function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Rellena los huecos de la ruta declarada.
 *
 * Un hueco que la declaracion nombra y nadie rellena NO se deja escrito en la
 * URL: `page={pagina}` viajaria literal a la forja y contestaria un 422 cuyo
 * mensaje no menciona ninguna plantilla.
 *
 * @param {string} plantilla
 * @param {Record<string, string|number>} valores
 */
export function rellenarRuta(plantilla, valores) {
  return String(plantilla).replace(/\{(\w+)\}/g, (_, clave) => {
    if (!Object.prototype.hasOwnProperty.call(valores, clave)) {
      fallar(
        "hueco_sin_valor",
        `la ruta declarada para listar repositorios tiene el hueco '${clave}' y nadie lo rellena`,
        `quita '{${clave}}' de la ruta del catalogo, o pasale ese valor al listado: un hueco sin rellenar viaja literal a la API del proveedor`,
      );
    }
    return encodeURIComponent(String(valores[clave]));
  });
}

/**
 * La lista cruda que vino en el cuerpo, segun lo que declara el catalogo.
 *
 * @param {any} cuerpo
 * @param {string|null|undefined} propiedad  donde vive la lista, o nada si el cuerpo ES la lista
 * @param {string} slug
 * @returns {any[]}
 */
export function listaCruda(cuerpo, propiedad, slug) {
  const lista = propiedad ? cuerpo?.[propiedad] : cuerpo;
  if (!Array.isArray(lista)) {
    fallar(
      "respuesta_inesperada",
      `'${slug}' contesto al listado de repositorios con algo que no es una lista${
        propiedad ? ` en '${propiedad}'` : ""
      }`,
      "revisa `repos.lista` en el catalogo: dice en que propiedad de la respuesta viene la lista, o queda vacio si la respuesta es la lista misma",
    );
  }
  return lista;
}

/**
 * Un repositorio crudo, traducido al contrato. Lo que no esta declarado no sale.
 *
 * @param {any} crudo
 * @param {Record<string, string>} mapa  campo del contrato -> campo crudo
 */
export function proyectar(crudo, mapa) {
  /** @type {Record<string, any>} */
  const repo = {};
  for (const campo of CAMPOS_DE_REPOSITORIO) {
    const origen = mapa?.[campo];
    // Un campo que el catalogo no declara viaja como `null` y no se omite: una
    // ficha a la que le FALTA la propiedad obliga a la pantalla a distinguir
    // "no lo declara" de "vino vacio", y las dos se dibujan igual.
    repo[campo] = origen && crudo?.[origen] !== undefined ? crudo[origen] : null;
  }
  return repo;
}

/**
 * Filtra por texto sobre lo que el operador ve.
 *
 * SE BUSCA POR EL NOMBRE COMPLETO Y NO SOLO POR EL NOMBRE, y la diferencia es
 * el caso real: la misma persona tiene `web` en su cuenta y `web` en la de su
 * organizacion. Buscando solo por nombre salen los dos y no hay forma de
 * distinguirlos; escribiendo la organizacion sale el que se busca.
 *
 * @param {readonly any[]} repos
 * @param {string} texto
 */
export function filtrar(repos, texto) {
  const buscado = normalizar(texto).trim();
  if (!buscado) return [...repos];
  return repos.filter(
    (r) =>
      normalizar(r.nombre_completo).includes(buscado) ||
      normalizar(r.nombre).includes(buscado) ||
      normalizar(r.descripcion).includes(buscado),
  );
}
