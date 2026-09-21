// La tabla de rutas, y el emparejador que la recorre.
//
// POR QUE UNA TABLA DE DATOS Y NO UNA CADENA DE `if`. Por tres motivos, y los
// tres ya costaron algo en este repositorio.
//
//   1. El 405 tiene que poder decir QUE metodos acepta la ruta, y eso no se
//      reconstruye desde un `if` que ya decidio que no.
//   2. El 404 tiene que distinguir "esa ruta no existe" de "existe pero no con
//      ese metodo". Con `if`s encadenados las dos caen en el mismo `else`.
//   3. Y el que de verdad importa: NFR-004 exige una prueba que recorra TODAS
//      las rutas y busque un centinela en cada respuesta. Una prueba que trae
//      su propia lista de rutas escrita a mano se queda vieja el dia que
//      alguien agrega la ruta numero cuarenta y uno — y esa es exactamente la
//      que va a filtrar el valor, porque es la que nadie reviso. La lista tiene
//      que salir de aqui, que es donde el servidor la mira.
//
// POR QUE LOS PARAMETROS SE DECLARAN EN EL PATRON. Para que la prueba de arriba
// pueda FABRICAR una URL concreta de cada ruta sin saber nada del dominio:
// sustituye cada `:nombre` por un id y pide. Un router que empareja con
// expresiones regulares sueltas no deja hacer eso.

/**
 * @typedef {object} Peticion
 * @property {any} estado el estado del servidor: home, token, bus, origenes
 * @property {any} dep las dependencias ya montadas: almacen, boveda, conexiones
 * @property {Record<string, string>} parametros lo capturado del patron
 * @property {URL} url
 * @property {string} metodo
 * @property {() => Promise<any>} cuerpo el JSON del cuerpo, leido una sola vez
 * @property {import("node:http").IncomingMessage} req
 * @property {import("node:http").ServerResponse} res
 * @property {Record<string, string>} cors
 */

/**
 * @typedef {object} Entrada
 * @property {string} patron
 * @property {string[]} metodos
 * @property {boolean} [publica] si se contesta sin token
 * @property {boolean} [crudo] si el manejador escribe la respuesta el mismo (SSE)
 * @property {(p: Peticion) => any} manejar
 * @property {string[]} segmentos
 * @property {string[]} parametros
 * @property {number} literales
 */

/**
 * Parte un patron en segmentos y saca los nombres de sus parametros.
 *
 * @param {string} patron
 */
export function compilar(patron) {
  const segmentos = patron.split("/").filter((s) => s.length > 0);
  const parametros = segmentos.filter((s) => s.startsWith(":")).map((s) => s.slice(1));
  const literales = segmentos.filter((s) => !s.startsWith(":")).length;
  return { segmentos, parametros, literales };
}

/**
 * Monta la tabla. Valida al construir y no al servir: una ruta declarada dos
 * veces, o una sin manejador, tiene que romper al arrancar el servicio y no en
 * la peticion del operador.
 *
 * @param {Array<{patron: string, metodos: string[], publica?: boolean, crudo?: boolean, manejar: (p: any) => any}>} declaradas
 * @returns {Entrada[]}
 */
export function crearTabla(declaradas) {
  /** @type {Entrada[]} */
  const tabla = [];
  const vistos = new Set();
  for (const d of declaradas) {
    if (vistos.has(d.patron)) {
      throw new Error(
        `la ruta \`${d.patron}\` se declaro dos veces en la tabla: la segunda no se alcanzaria nunca, y el ` +
          "metodo que solo esta en ella daria 405 sin que nadie entienda por que",
      );
    }
    if (typeof d.manejar !== "function") {
      throw new Error(`la ruta \`${d.patron}\` no trae manejador: se declaro y no hace nada`);
    }
    if (!Array.isArray(d.metodos) || d.metodos.length === 0) {
      throw new Error(`la ruta \`${d.patron}\` no declara metodos: el 405 no tendria que ofrecer`);
    }
    vistos.add(d.patron);
    tabla.push({ ...d, ...compilar(d.patron) });
  }
  // Lo literal gana a lo parametrico: `/v1/projects/nuevo` tiene que ganarle a
  // `/v1/projects/:id` aunque las dos empareje. Se ordena UNA vez al montar en
  // vez de en cada peticion.
  return tabla.sort((a, b) => b.literales - a.literales);
}

/**
 * La ruta que corresponde, o `null`.
 *
 * @param {Entrada[]} tabla
 * @param {string} ruta
 * @returns {{entrada: Entrada, parametros: Record<string, string>}|null}
 */
export function emparejar(tabla, ruta) {
  const partes = ruta.split("/").filter((s) => s.length > 0);
  for (const entrada of tabla) {
    if (entrada.segmentos.length !== partes.length) continue;
    /** @type {Record<string, string>} */
    const parametros = {};
    let encaja = true;
    for (let i = 0; i < partes.length; i++) {
      const esperado = entrada.segmentos[i];
      if (esperado.startsWith(":")) {
        // Un parametro vacio no empareja: `/v1/projects//scan` no es una ruta
        // de este servicio, y aceptarla la convierte en un id vacio que el
        // almacen busca y no encuentra, con un 404 que no dice lo que pasa.
        if (!partes[i]) {
          encaja = false;
          break;
        }
        parametros[esperado.slice(1)] = decodeURIComponent(partes[i]);
      } else if (esperado !== partes[i]) {
        encaja = false;
        break;
      }
    }
    if (encaja) return { entrada, parametros };
  }
  return null;
}

/**
 * Una URL concreta a partir de un patron, sustituyendo cada parametro.
 *
 * Existe para la prueba del centinela (NFR-004), que tiene que pedir TODAS las
 * rutas sin saber nada de ninguna. Vive aqui y no en el test porque la forma
 * del patron la decide este archivo: si manana un patron admite un comodin, el
 * test no tiene por que enterarse.
 *
 * @param {string} patron
 * @param {Record<string, string>} valores
 */
export function concretar(patron, valores) {
  return (
    "/" +
    compilar(patron)
      .segmentos.map((s) => (s.startsWith(":") ? encodeURIComponent(valores[s.slice(1)] ?? s.slice(1)) : s))
      .join("/")
  );
}
