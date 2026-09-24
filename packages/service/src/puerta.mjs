// La puerta del servicio: token de sesion y allowlist de origenes.
//
// EL FALLO QUE EVITA, con nombre y apellido: cualquier pagina que el operador
// tenga abierta puede hacer `fetch("http://127.0.0.1:<puerto>/v1/projects")`.
// Sin token, un anuncio en otra pestaña enumera sus proyectos, sus conexiones y
// su bandeja, y el operador no ve absolutamente nada. Ya le paso a otros
// productos de escritorio con servidor local, y no hace falta que el atacante
// sepa el puerto: se prueban mil en dos segundos.
//
// EL TOKEN CIERRA EL CASO GENERAL. La allowlist de `Origin` cierra el que
// queda: si el token se filtra alguna vez a una pagina, un origen que no esta
// declarado no recibe ni la cabecera de CORS, asi que el navegador no le deja
// leer lo que el servicio hubiera contestado.
//
// AUSENCIA DE `Origin` NO ES CONFIANZA. `curl` y el propio shell de escritorio
// no la mandan, asi que no se puede exigir; lo que se exige siempre es el
// token, que es lo que un navegador no puede adivinar.

import { createHash, timingSafeEqual } from "node:crypto";

/** La cabecera propia. Se declara aqui porque tambien va en la lista de CORS. */
export const CABECERA_TOKEN = "x-noxloop-token";

/**
 * Los origenes que la aplicacion de escritorio y el desarrollo de la interfaz
 * usan. Es un valor por defecto, no una lista cerrada: el principio VII pide
 * que esto sea configuracion, porque el origen de la web de un operador no lo
 * sabe este repositorio. Sin `--origen`, la unica salida seria abrirlo con `*`.
 */
export const ORIGENES_POR_DEFECTO = Object.freeze([
  "tauri://localhost",
  "http://tauri.localhost",
  // 3100 y no 3000: en la maquina donde se monto esto, Docker tenia 3000
  // tomado de forma permanente y `next dev` no podia arrancar. Es el puerto
  // mas disputado del ecosistema, asi que el default se movio. Tiene que
  // coincidir con `NOXLOOP_PUERTO_DEV` de la interfaz y con `devUrl` de Tauri.
  "http://localhost:3100",
]);

/**
 * Comparacion en tiempo constante. Se compara el hash y no el valor para que ni
 * siquiera la LONGITUD del token se filtre por el tiempo de respuesta: con el
 * valor crudo, `timingSafeEqual` exige longitudes iguales y hay que ramificar
 * antes, que es justo la ramificacion que se mide desde fuera.
 *
 * @param {string} a
 * @param {string} b
 */
export function mismoToken(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * De donde puede venir el token, en orden de preferencia.
 *
 * LA QUERY STRING ES SOLO PARA SSE. `EventSource` no acepta cabeceras: no hay
 * forma de mandarle `Authorization`. La alternativa era una cookie de sesion
 * con su propio CSRF solo para ese canal. El token en la query es peor en un
 * sentido conocido —queda en el historial del navegador y en el log de
 * cualquier proxy— y aqui no hay proxy ni log: es loopback y el token muere con
 * el proceso.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {URL} url
 * @returns {string|null}
 */
export function tokenDe(req, url) {
  const propia = req.headers[CABECERA_TOKEN];
  if (typeof propia === "string" && propia) return propia;

  const auth = req.headers.authorization;
  if (typeof auth === "string" && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();

  const query = url.searchParams.get("token");
  return query || null;
}

/**
 * Las cabeceras de CORS para un origen YA aceptado. Nunca `*`: con `*` la
 * allowlist no sirve para nada, y una pagina cualquiera puede leer la respuesta
 * el dia que consiga el token.
 *
 * @param {string|null} origen
 * @param {boolean} [preflight]
 * @param {readonly string[]|null} [metodos] los que acepta ESA ruta, si se conocen
 */
export function cabecerasCors(origen, preflight = false, metodos = null) {
  // `Vary: Origin` va siempre, tambien cuando no hay origen: sin el, una cache
  // intermedia puede servirle a una pestaña la respuesta que se calculo para
  // otra con otro origen.
  const cabeceras = /** @type {Record<string, string>} */ ({ vary: "Origin" });
  if (!origen) return cabeceras;
  cabeceras["access-control-allow-origin"] = origen;
  if (preflight) {
    // Se anuncian los metodos de ESA ruta y no una lista fija. Con una lista
    // fija hay dos formas de equivocarse y las dos son caras: de menos, el
    // navegador bloquea un `PATCH` que el servicio si acepta y el sintoma es
    // una pantalla que no guarda sin ningun error; de mas, se anuncia un
    // `DELETE` sobre una ruta que contesta 405, y quien lee el preflight cree
    // que existe una superficie de borrado que no existe — que es exactamente
    // lo que FR-049 no quiere que se lea sobre `/v1/audit`.
    cabeceras["access-control-allow-methods"] = [...new Set([...(metodos ?? ["GET", "HEAD"]), "OPTIONS"])].join(", ");
    cabeceras["access-control-allow-headers"] =
      `${CABECERA_TOKEN}, authorization, content-type, last-event-id, if-match`;
    cabeceras["access-control-max-age"] = "600";
  }
  return cabeceras;
}

/**
 * Revisa origen y token. Devuelve `null` si la peticion pasa, o el error que
 * corresponde. No responde: quien llama decide como, y asi esto se prueba sin
 * levantar un servidor.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {URL} url
 * @param {{token: string, origenes: readonly string[], exigeToken: boolean}} opts
 * @returns {{codigo: string, datos: Record<string, any>}|null}
 */
export function revisar(req, url, opts) {
  const origen = typeof req.headers.origin === "string" ? req.headers.origin : null;
  if (origen && !opts.origenes.includes(origen)) {
    return { codigo: "origen_no_permitido", datos: { origen, permitidos: [...opts.origenes] } };
  }
  if (!opts.exigeToken) return null;

  const traido = tokenDe(req, url);
  if (!traido) return { codigo: "falta_token", datos: {} };
  if (!mismoToken(traido, opts.token)) return { codigo: "token_invalido", datos: {} };
  return null;
}
