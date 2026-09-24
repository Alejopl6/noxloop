// Las estructuras de la capa de integracion. Ninguna tiene un campo para el
// valor de una credencial.
//
// POR QUE NO EXISTE EL CAMPO, EN VEZ DE EXISTIR Y NO USARSE. Un campo `valor`
// que hoy esta a `null` es una invitacion: la proxima persona que necesite el
// valor a mano en un punto del codigo lo rellena, porque el sitio ya estaba
// hecho. Si el campo no existe, agregarlo es una decision visible en el diff.
//
// EL MODO ES OBLIGATORIO Y SE VALIDA AQUI. Un proveedor sin `modo` no rompe al
// cargar: rompe cuando alguien lo conecta, y rompe por la rama equivocada
// —porque la mayoria es oauth2 y ese es el camino que se asume—. El sintoma es
// una pestana del navegador que se abre para un PAT y una conexion que espera
// para siempre una autorizacion que nadie va a dar.

import { fallar } from "./errores.mjs";

/** Los modos de autenticacion del contrato. `oauth2` es uno de cinco, no el caso general. */
export const MODOS_AUTH = ["oauth2", "api_key", "basic", "pat", "app"];

/**
 * Los modos en los que NO hay nada que autorizar en un navegador: el operador
 * pega un valor y la conexion queda lista. Es la lista que hace que `conectar`
 * no devuelva una URL donde no hay flujo.
 */
export const MODOS_SIN_AUTORIZACION = ["api_key", "basic", "pat"];

export const CLASES = ["tracker", "scm", "infra", "integracion"];

/** `pendiente` solo existe mientras hay un flujo de autorizacion en curso. */
export const ESTADOS = ["pendiente", "conectada", "revocada"];

/**
 * @typedef {object} CampoRequerido
 * @property {string} nombre
 * @property {string} etiqueta     lo que se dibuja al lado de la casilla
 * @property {boolean} secreto     si va al deposito de secretos o a la fila
 * @property {boolean} [requerido]
 * @property {string} [ayuda]
 */

/**
 * @typedef {object} ProveedorExterno
 * @property {string} slug
 * @property {string} nombre
 * @property {string} modo
 * @property {string} clase
 * @property {CampoRequerido[]} [campos]
 * @property {Record<string,string>} entorno  campo -> variable que se inyecta al subproceso
 * @property {object} [api]
 */

/** Congela en profundidad: lo que sale de aqui no se cambia por la espalda. */
export function congelar(valor) {
  if (valor === null || typeof valor !== "object") return valor;
  for (const v of Object.values(valor)) congelar(v);
  return Object.freeze(valor);
}

/**
 * @param {any} entrada
 * @returns {{ ok: boolean, problemas: string[] }}
 */
export function validarEntradaDeCatalogo(entrada) {
  const problemas = [];
  if (!entrada || typeof entrada !== "object") return { ok: false, problemas: ["la entrada no es un objeto"] };

  if (typeof entrada.slug !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(entrada.slug)) {
    problemas.push("slug: tiene que ser un identificador en minusculas");
  }
  if (typeof entrada.nombre !== "string" || !entrada.nombre) problemas.push("nombre: tiene que ser un string no vacio");
  if (!MODOS_AUTH.includes(entrada.modo)) {
    problemas.push(`modo: ${JSON.stringify(entrada.modo)} no es ninguno de ${MODOS_AUTH.join(", ")}`);
  }
  if (!CLASES.includes(entrada.clase)) {
    problemas.push(`clase: ${JSON.stringify(entrada.clase)} no es ninguna de ${CLASES.join(", ")}`);
  }

  // Un modo que no es oauth2 SIN campos es un formulario vacio: el operador
  // abre la pantalla de conectar y no hay donde pegar el PAT.
  if (entrada.modo !== "oauth2") {
    if (!Array.isArray(entrada.campos) || entrada.campos.length === 0) {
      problemas.push(`campos: el modo ${entrada.modo} no tiene flujo de autorizacion, asi que tiene que declarar que pedirle al operador`);
    } else {
      for (const campo of entrada.campos) {
        if (!campo || typeof campo.nombre !== "string" || !campo.nombre) problemas.push("campos: hay un campo sin nombre");
        else if (typeof campo.secreto !== "boolean") {
          problemas.push(`campos.${campo.nombre}: tiene que declarar \`secreto\` (de eso depende si va al deposito de secretos o a la fila)`);
        }
        // EL ALCANCE DE UN CAMPO SECRETO NO ES OPCIONAL, y esto costo una
        // conexion que no se podia crear. El deposito exige saber QUE permite
        // hacer la credencial que guarda —es lo unico que da sentido a la vista
        // inversa: "estos agentes la alcanzan" sin saber que significa
        // alcanzarla no es una respuesta— y lo rechaza si llega vacio. Sin esta
        // guarda, un catalogo al que le falta el alcance monta bien y falla
        // cuando el operador pega su primer token, con un error que nombra una
        // columna de una tabla y ningun proveedor.
        else if (campo.secreto === true && (typeof campo.alcance !== "string" || campo.alcance.trim().length === 0)) {
          problemas.push(
            `campos.${campo.nombre}: un campo secreto tiene que declarar \`alcance\` — que permite hacer la credencial que guarda`,
          );
        }
      }
      if (!entrada.campos.some((c) => c?.secreto === true)) {
        problemas.push("campos: ninguno es secreto, y entonces no hay credencial que guardar");
      }
    }
  }

  if (!entrada.entorno || typeof entrada.entorno !== "object" || Object.keys(entrada.entorno).length === 0) {
    problemas.push("entorno: hay que declarar con que nombre se inyecta cada valor al subproceso");
  } else if (Array.isArray(entrada.campos)) {
    for (const campo of entrada.campos) {
      if (campo?.nombre && !entrada.entorno[campo.nombre]) {
        problemas.push(`entorno: el campo ${campo.nombre} no declara su variable`);
      }
    }
  }

  return { ok: problemas.length === 0, problemas };
}

/**
 * @typedef {object} Conexion
 * @property {string} id
 * @property {string|null} project_id  `null` = del espacio de trabajo (la cuenta de codigo del operador)
 * @property {string} slug
 * @property {string} modo
 * @property {string} estado
 * @property {string} handle       con el que se sigue un flujo en curso
 * @property {string|null} etiqueta  para distinguir dos conexiones del mismo proveedor
 * @property {Record<string, any>} deposito  referencias opacas del adaptador; NUNCA valores
 * @property {string} creadaEn
 * @property {string|null} conectadaEn
 * @property {string|null} revocadaEn
 * @property {string|null} expira
 */

/**
 * @param {{ id: string, project_id: string|null, slug: string, modo: string, handle: string, estado?: string, etiqueta?: string|null, deposito?: Record<string, any>, expira?: string|null, ahora?: number }} datos
 * @returns {Conexion}
 */
export function crearConexion({
  id,
  project_id,
  slug,
  modo,
  handle,
  estado = "pendiente",
  etiqueta = null,
  deposito = {},
  expira = null,
  ahora = Date.now(),
}) {
  if (!ESTADOS.includes(estado)) {
    fallar(
      "estado_desconocido",
      `'${estado}' no es ninguno de los estados de una conexion (${ESTADOS.join(", ")})`,
      "usa uno de los estados del contrato: un estado inventado no se puede consultar en la pantalla",
    );
  }
  const cuando = new Date(ahora).toISOString();
  return congelar({
    id,
    // `null` explicito: la fila de una conexion del espacio de trabajo tiene el
    // campo y vale `null`, en vez de no tenerlo. Un campo ausente obliga a
    // quien la lee a distinguir «no hay proyecto» de «esta version de la fila
    // no lo guardaba», y las dos se ven igual.
    project_id: project_id ?? null,
    slug,
    modo,
    estado,
    handle,
    etiqueta,
    deposito,
    creadaEn: cuando,
    conectadaEn: estado === "conectada" ? cuando : null,
    revocadaEn: null,
    expira,
  });
}
