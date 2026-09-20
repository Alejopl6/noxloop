// El formato unico de error del servicio de control.
//
// POR QUE UN CATALOGO Y NO UN `throw new Error` EN CADA SITIO. NFR-006 exige
// que todo error nombre la causa completa y la accion siguiente. Un mensaje
// escrito en el lugar donde se detecta el fallo sale con lo que sabia quien lo
// escribio ese dia, y la mitad de las veces sale como "no autorizado": tecnica-
// mente cierto, y deja al operador reinstalando la aplicacion. Con el catalogo
// separado hay UN sitio donde mirar que errores existen, y un test que los
// recorre todos y falla si alguno no dice que hacer despues.
//
// `causa` es texto completo, no un resumen. `accion` nombra una operacion o una
// pantalla concreta — nunca "reintenta".

/** Version del sobre de error. Un cambio de forma sube la version de la API. */
export const CABECERAS_JSON = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
});

/**
 * @typedef {object} EntradaDeCatalogo
 * @property {number} estado codigo HTTP que le corresponde
 * @property {(datos: any) => string} causa
 * @property {(datos: any) => string} accion
 */

/** @type {Record<string, EntradaDeCatalogo>} */
export const CATALOGO = {
  falta_token: {
    estado: 401,
    causa: () =>
      "La peticion no trae el token de sesion. Este servicio lo exige en todas las rutas menos " +
      "`/v1/health`, porque cualquier pagina abierta en el navegador puede hacer peticiones a 127.0.0.1.",
    accion: () =>
      "Manda el token en la cabecera `x-noxloop-token` o como `Authorization: Bearer <token>`. " +
      "El escritorio lo entrega al abrir la ventana; fuera de el esta en `<home>/servicio/sesion.json`.",
  },

  token_invalido: {
    estado: 401,
    causa: () =>
      "El token de sesion que trae la peticion no es el de este servicio. Un token de una sesion " +
      "anterior deja de valer en cuanto el servicio se reinicia: se genera uno nuevo en cada arranque.",
    accion: () =>
      "Vuelve a pedir el token de la sesion en curso —el escritorio lo hace solo al reabrir la ventana— " +
      "o leelo de `<home>/servicio/sesion.json`.",
  },

  origen_no_permitido: {
    estado: 403,
    causa: (d) =>
      `El origen \`${d.origen}\` no esta en la allowlist de este servicio (${(d.permitidos || []).join(", ")}). ` +
      "La lista existe porque el token viaja en una cabecera que una pagina cualquiera podria copiar si " +
      "alguna vez se filtra, y un origen que no esta declarado no recibe ni la cabecera de CORS.",
    accion: (d) =>
      `Si \`${d.origen}\` es tuyo, declaralo al arrancar el servicio con \`--origen ${d.origen}\`. ` +
      "Si no lo es, no hay nada que hacer: la peticion no era tuya.",
  },

  ruta_desconocida: {
    estado: 404,
    causa: (d) =>
      `Este servicio no expone \`${d.metodo} ${d.ruta}\`. Las rutas de la version 1 estan en el ` +
      "contrato de la API de control, y una ruta que no existe suele ser una version de la interfaz " +
      "mas nueva que el servicio que tiene delante.",
    accion: () =>
      "Comprueba `/v1/health` para ver la version del servicio: si no es la que la interfaz espera, " +
      "cierra la aplicacion y vuelve a abrirla para que levante el servicio que le corresponde.",
  },

  metodo_no_permitido: {
    estado: 405,
    causa: (d) =>
      `\`${d.ruta}\` no acepta \`${d.metodo}\`; acepta ${(d.permitidos || []).join(", ")}. ` +
      "El servicio es el unico escritor del almacen, asi que cada ruta declara exactamente con que " +
      "metodos se la puede tocar en vez de aceptar cualquiera y decidir despues.",
    accion: (d) => `Repite la peticion con ${(d.permitidos || []).join(" o ")} sobre \`${d.ruta}\`.`,
  },

  home_bloqueado: {
    estado: 409,
    causa: (d) =>
      `Ya hay un servicio de control sobre \`${d.home}\`: ${d.razon}. Dos servicios sobre el mismo home ` +
      "son dos escritores del mismo almacen, y eso rompe el principio VIII sin que nadie lo note hasta " +
      "que el estado esta corrupto.",
    accion: (d) =>
      d.pid
        ? `Usa la ventana que ya esta abierta, o termina el proceso ${d.pid} si quedo huerfano ` +
          `(\`kill ${d.pid}\`) y vuelve a arrancar.`
        : "Cierra la aplicacion que ya esta usando ese home, o arranca este servicio con otro `--home`.",
  },

  fallo_interno: {
    estado: 500,
    causa: (d) =>
      `El servicio no pudo completar la peticion por un fallo suyo: ${d.detalle || "sin detalle"}. ` +
      "No es un error de lo que pediste: es un camino que este servicio no previo.",
    accion: () =>
      "Mira la salida de error del servicio, que trae la traza completa, y abre el fallo con esa traza. " +
      "Mientras tanto, `/v1/health` dice si el servicio sigue en pie.",
  },
};

/**
 * Un error que ya sabe decir su causa y su accion. Se usa igual en el arranque
 * —donde no hay respuesta HTTP que devolver— que dentro de una peticion.
 */
export class ErrorDeServicio extends Error {
  /**
   * @param {string} codigo clave del CATALOGO
   * @param {Record<string, any>} [datos] lo que las plantillas necesitan
   */
  constructor(codigo, datos = {}) {
    const cuerpo = problema(codigo, datos);
    super(cuerpo.error.causa);
    this.name = "ErrorDeServicio";
    this.codigo = cuerpo.error.codigo;
    this.causa = cuerpo.error.causa;
    this.accion = cuerpo.error.accion;
    this.estado = (CATALOGO[codigo] || CATALOGO.fallo_interno).estado;
    this.datos = datos;
    this.cuerpo = cuerpo;
  }
}

/**
 * El sobre que sale por el cable. Nada mas que `error` arriba: un segundo campo
 * al lado parte a los clientes en dos, los que lo leen y los que no.
 *
 * @param {string} codigo
 * @param {Record<string, any>} [datos]
 * @returns {{error: {codigo: string, causa: string, accion: string, objeto?: any}}}
 */
export function problema(codigo, datos = {}) {
  const entrada = CATALOGO[codigo];
  if (!entrada) {
    // Un codigo que no esta en el catalogo es un fallo del servicio, no del
    // cliente: se dice asi en vez de devolver un sobre a medias.
    return problema("fallo_interno", { detalle: `codigo de error no declarado: ${codigo}` });
  }
  const error = /** @type {any} */ ({
    codigo,
    causa: entrada.causa(datos),
    accion: entrada.accion(datos),
  });
  if (datos.objeto) error.objeto = datos.objeto;
  return { error };
}

/**
 * Cualquier excepcion convertida al unico formato. Lo que entra por aqui es lo
 * que nadie previo, y sale igual de accionable que lo previsto.
 *
 * @param {any} e
 */
export function deExcepcion(e) {
  if (e instanceof ErrorDeServicio) return e.cuerpo;
  return problema("fallo_interno", { detalle: e && e.message ? e.message : String(e) });
}

/** El estado HTTP que le toca a un sobre ya construido. */
export function estadoDe(cuerpo) {
  const entrada = CATALOGO[cuerpo?.error?.codigo];
  return entrada ? entrada.estado : 500;
}
