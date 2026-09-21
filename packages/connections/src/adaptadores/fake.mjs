// T152 · el adaptador falso: sin red, sin credenciales y sin contenedores.
//
// PARA QUE SIRVE, APARTE DE PARA LAS PRUEBAS. Es la linea base que separa "el
// adaptador esta mal" de "el chequeo exige algo que solo cumple quien tiene
// red". Si la suite de contrato solo corriera contra adaptadores de verdad,
// cada fallo obligaria a averiguar cual de las dos cosas es.
//
// POR QUE SU CATALOGO TIENE LOS DOS CAMINOS. Un falso con un solo modo deja sin
// ejercitar justo el camino donde estaba el error: dos de los proveedores
// objetivo no usan OAuth, y un adaptador probado solo con oauth2 pasa verde y
// revienta con ellos. Los slugs son inventados a proposito —no imitan a nadie—
// porque lo que hay que ejercitar es el MODO, no el producto.

import { crearProveedorDeConexiones } from "../proveedor.mjs";
import { fallar } from "../errores.mjs";

/** @type {readonly any[]} */
export const CATALOGO_FALSO = Object.freeze([
  {
    slug: "falso-oauth2",
    nombre: "Falso con autorizacion",
    modo: "oauth2",
    clase: "tracker",
    entorno: { access_token: "FALSO_TOKEN" },
    api: { base: "https://falso.invalido/api", auth: { tipo: "bearer", campo: "access_token" } },
  },
  {
    slug: "falso-pat",
    nombre: "Falso con token personal",
    modo: "pat",
    clase: "scm",
    campos: [
      { nombre: "pat", etiqueta: "Token personal", secreto: true, requerido: true },
      { nombre: "usuario", etiqueta: "Cuenta", secreto: false, requerido: false },
    ],
    entorno: { pat: "FALSO_PAT", usuario: "FALSO_USUARIO" },
    api: { base: "https://falso.invalido/api", auth: { tipo: "basic", usuario: "", campo: "pat" } },
  },
  {
    slug: "falso-api-key",
    nombre: "Falso con clave de API",
    modo: "api_key",
    clase: "infra",
    campos: [{ nombre: "api_key", etiqueta: "Clave de API", secreto: true, requerido: true }],
    entorno: { api_key: "FALSO_API_KEY" },
    api: { base: "https://falso.invalido/api", auth: { tipo: "cabecera", cabecera: "X-Clave", campo: "api_key" } },
  },
]);

/**
 * @param {{
 *   catalogo?: readonly any[],
 *   repositorio?: any,
 *   reloj?: () => number,
 *   dormir?: (ms: number) => Promise<any>,
 *   puertoDeCallback?: number,
 *   sondearPuerto?: (p: number) => Promise<{libre: boolean, causa?: string}>,
 *   sondeosAntesDeAutorizar?: number,
 *   vigenciaPropuestaMs?: number,
 *   respuestas?: Record<string, {estado: number, cuerpo: any}>,
 *   depositoFilonDePrueba?: boolean,
 * }} [opciones]
 */
export function crearAdaptadorFalso(opciones = {}) {
  const {
    catalogo = CATALOGO_FALSO,
    sondeosAntesDeAutorizar = 1,
    vigenciaPropuestaMs,
    respuestas = {},
    depositoFilonDePrueba = false,
    sondearPuerto = async () => ({ libre: true, evidencia: "el adaptador falso no sondea nada" }),
    ...resto
  } = opciones;

  // El "deposito de secretos" del falso: un Map que vive lo que vive el
  // proceso. No toca el llavero ni el disco, que es justo lo que hace que estas
  // pruebas las pueda correr quien adopte el proyecto.
  /** @type {Map<string, Record<string,string>>} */
  const deposito = new Map();
  /** @type {Map<string, Record<string,string>>} */
  const enVuelo = new Map();
  const cuenta = { lecturas: 0, sondeos: 0 };
  const estado = { caida: /** @type {string|null} */ (null) };

  function exigirArriba(que) {
    if (estado.caida) {
      fallar(
        "adaptador_caido",
        `el adaptador falso no puede ${que}: ${estado.caida}`,
        "levanta el adaptador; las conexiones que ya existen siguen en el inventario",
      );
    }
  }

  const motor = {
    requisitos: () => [],
    salud: () => (estado.caida ? { arriba: false, causa: estado.caida } : { arriba: true }),

    async iniciar({ handle, entrada }) {
      exigirArriba("iniciar una autorizacion");
      enVuelo.set(handle, { access_token: `falso-token-de-${entrada.slug}-${handle}` });
      return {
        handle,
        url: `https://falso.invalido/autorizar?handle=${handle}`,
        expira: null,
      };
    },

    async guardar({ valores, conexionId, entrada }) {
      exigirArriba("guardar el valor");
      const secretos = /** @type {Record<string, string>} */ ({});
      const datos = /** @type {Record<string, string>} */ ({});
      for (const campo of entrada.campos ?? []) {
        if (valores[campo.nombre] === undefined) continue;
        if (campo.secreto) secretos[campo.nombre] = valores[campo.nombre];
        else datos[campo.nombre] = valores[campo.nombre];
      }
      deposito.set(conexionId, secretos);
      return {
        // `depositoFilonDePrueba` existe para ejercitar la guarda del nucleo:
        // un motor que mete el valor en el metadato opaco tiene que quedar
        // atrapado ANTES de que la fila llegue al inventario.
        deposito: depositoFilonDePrueba ? { clave: conexionId, datos, ...secretos } : { clave: conexionId, datos },
      };
    },

    async sondear(handle) {
      exigirArriba("sondear la autorizacion");
      cuenta.sondeos += 1;
      if (cuenta.sondeos <= sondeosAntesDeAutorizar) return null;
      const valores = enVuelo.get(handle);
      if (!valores) return null;
      return { deposito: { clave: handle, datos: {} }, etiqueta: "cuenta-falsa" };
    },

    async leer(conexion) {
      exigirArriba("leer el valor");
      cuenta.lecturas += 1;
      const clave = conexion.deposito?.clave;
      const secretos = deposito.get(clave) ?? enVuelo.get(clave);
      if (!secretos) {
        fallar(
          "valor_ausente",
          `el deposito del adaptador falso no tiene nada bajo la referencia de la conexion ${conexion.id}`,
          "vuelve a conectar el proveedor",
        );
      }
      return {
        valores: { ...secretos, ...(conexion.deposito?.datos ?? {}) },
        vigenciaPropuestaMs,
      };
    },

    async olvidar(conexion) {
      exigirArriba("borrar el valor");
      deposito.delete(conexion.deposito?.clave);
      enVuelo.delete(conexion.deposito?.clave);
    },

    async llamar({ ruta, metodo, entrada }) {
      exigirArriba("llamar a la API");
      const grabada = respuestas[`${metodo} ${ruta}`];
      // La respuesta no devuelve la cabecera con la que se autorizo: solo dice
      // que se aplico. Es el invariante que mide la prueba del centinela.
      return {
        estado: grabada?.estado ?? 200,
        cuerpo: grabada?.cuerpo ?? { proveedor: entrada.slug, ruta, autorizacion: "aplicada" },
        cabeceras: { "content-type": "application/json" },
      };
    },
  };

  const base = crearProveedorDeConexiones({ id: "fake", catalogo, motor, sondearPuerto, ...resto });

  return {
    ...base,
    /** Cuantas veces se fue a buscar un valor. Lo usa la prueba de que no hay cache. */
    lecturasDePrueba: () => cuenta.lecturas,
    /** Cuantos sondeos se hicieron. Lo usa la prueba de que el sondeo es el camino. */
    sondeosDePrueba: () => cuenta.sondeos,
    caerDePrueba: (causa = "el adaptador falso esta caido") => {
      estado.caida = causa;
    },
    levantarDePrueba: () => {
      estado.caida = null;
    },
  };
}

/**
 * Los fixtures con los que el falso corre la suite de contrato.
 *
 * Viven aqui —y no en un archivo aparte, como exige la otra capa de
 * proveedores— porque este modulo ES el doble de pruebas: no hay codigo de
 * produccion que pueda cargar datos de prueba sin querer.
 *
 * @returns {import("../contrato.mjs").FixturesDeConexiones}
 */
export function fixturesDeContrato() {
  const centinela = "centinela-de-contrato-8f41c2";
  return {
    projectId: "proyecto-de-contrato",
    slugSinOauth: "falso-pat",
    valores: { pat: centinela, usuario: "cuenta-de-contrato" },
    centinela,
    sinContenedores: true,
    llamada: { metodo: "GET", ruta: "/perfil" },
    montar(opciones = {}) {
      let ahora = 1_700_000_000_000;
      const proveedor = crearAdaptadorFalso({
        reloj: () => ahora,
        dormir: async (ms) => {
          ahora += ms;
        },
        sondearPuerto: opciones.puertoOcupado
          ? async () => ({ libre: false, causa: "EADDRINUSE: lo tiene otro proceso" })
          : undefined,
      });
      return {
        proveedor,
        avanzar: (ms) => {
          ahora += ms;
        },
        lecturas: () => proveedor.lecturasDePrueba(),
        caer: (causa) => proveedor.caerDePrueba(causa),
        levantar: () => proveedor.levantarDePrueba(),
      };
    },
  };
}
