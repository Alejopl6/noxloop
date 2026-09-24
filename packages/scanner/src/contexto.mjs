// Lo unico que un detector ve del proyecto.
//
// POR QUE EXISTE ESTA CAPA EN VEZ DE DARLE `fs` AL DETECTOR. Por tres fallos
// concretos, los tres medidos en este contrato:
//
// 1. LA PROMESA. Un detector con `fs` en la mano puede escribir, y la promesa
//    del scanner —que no toca el proyecto de nadie— pasaria a depender de que
//    seis autores distintos se acuerden. Aqui solo hay funciones de lectura, y
//    la guarda del paquete prohibe importar las de escritura.
//
// 2. NFR-001. Seis detectores leyendo `package.json` por su cuenta son seis
//    lecturas del mismo archivo, y sobre diez mil archivos la diferencia no es
//    de porcentajes. Lo que se lee se cachea una vez.
//
// 3. LOS BINARIOS SE CUENTAN, NO SE LEEN. Una imagen de dos megas convertida a
//    utf8 y recorrida linea a linea buscando secretos es como un scanner tarda
//    tres minutos sobre un repositorio con assets. La decision de no leerla se
//    toma una vez, aqui, y ningun detector puede saltarsela sin querer.

import { readFileSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";

/** Por encima de esto se lee solo la cabecera: un lockfile de 4 MB no aporta mas en la linea 90.000. */
const UMBRAL_ARCHIVO_ENORME = 512 * 1024;
const CABECERA = 64 * 1024;

/** Extensiones que se cuentan y no se leen. La lista es de formas, no de herramientas. */
const BINARIAS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".ico", ".icns", ".tiff",
  ".pdf", ".zip", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".jar", ".war",
  ".mp3", ".mp4", ".mov", ".avi", ".mkv", ".wav", ".ogg", ".flac", ".webm",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".wasm", ".node", ".class", ".pyc", ".o", ".a",
  ".db", ".sqlite", ".sqlite3", ".mdb", ".pack", ".idx", ".psd", ".ai", ".sketch",
]);

/**
 * @typedef {import("./inventario.mjs").ArchivoVisto} ArchivoVisto
 */

/**
 * @param {string} absoluta
 * @returns {boolean} si hay un byte nulo en la cabecera, no es texto
 */
function pareceBinario(absoluta) {
  let fd = -1;
  try {
    fd = openSync(absoluta, "r"); // solo lectura, siempre
    const buffer = Buffer.alloc(4096);
    const leidos = readSync(fd, buffer, 0, 4096, 0);
    return buffer.subarray(0, leidos).includes(0);
  } catch {
    return true; // si no se puede mirar, se trata como binario: no se lee
  } finally {
    if (fd !== -1) {
      try {
        closeSync(fd);
      } catch {
        // cerrar un descriptor ya cerrado no cambia nada del arbol
      }
    }
  }
}

/**
 * @param {string} raiz
 * @param {import("./inventario.mjs").Inventario} inventario
 * @param {{ señales?: AbortSignal }} [opts]
 */
export function crearContexto(raiz, inventario, opts = {}) {
  const rutas = new Set(inventario.archivos.map((a) => a.ruta));
  const directorios = new Set(inventario.directorios);
  /** @type {Map<string, ArchivoVisto>} */
  const porRuta = new Map(inventario.archivos.map((a) => [a.ruta, a]));
  /** @type {Map<string, string[]>} */
  const porNombre = new Map();
  /** @type {Map<string, string[]>} */
  const porExtension = new Map();

  for (const archivo of inventario.archivos) {
    const nombre = archivo.nombre.toLowerCase();
    if (!porNombre.has(nombre)) porNombre.set(nombre, []);
    /** @type {string[]} */ (porNombre.get(nombre)).push(archivo.ruta);
    if (!porExtension.has(archivo.ext)) porExtension.set(archivo.ext, []);
    /** @type {string[]} */ (porExtension.get(archivo.ext)).push(archivo.ruta);
  }

  /** @type {Map<string, string|null>} */
  const cacheTexto = new Map();
  /** @type {Map<string, any>} */
  const cacheJson = new Map();

  /**
   * El contenido de un archivo de texto, o `null` si es binario, si no existe
   * o si no se puede leer. Nunca lanza: un archivo ilegible es un hueco, y un
   * hueco no puede tumbar el recorrido entero.
   *
   * @param {string} ruta
   * @returns {string|null}
   */
  function leer(ruta) {
    if (cacheTexto.has(ruta)) return /** @type {string|null} */ (cacheTexto.get(ruta));
    const archivo = porRuta.get(ruta);
    let texto = null;
    if (archivo && !BINARIAS.has(archivo.ext)) {
      const absoluta = join(raiz, ruta);
      if (archivo.tamano === 0) {
        texto = "";
      } else if (!pareceBinario(absoluta)) {
        try {
          if (archivo.tamano > UMBRAL_ARCHIVO_ENORME) {
            // Solo la cabecera. Lo que define a un manifiesto esta arriba, y
            // recorrer entero un bundle de 30 MB es como se pierde el minuto.
            const fd = openSync(absoluta, "r");
            try {
              const buffer = Buffer.alloc(CABECERA);
              const leidos = readSync(fd, buffer, 0, CABECERA, 0);
              texto = buffer.subarray(0, leidos).toString("utf8");
            } finally {
              closeSync(fd);
            }
          } else {
            texto = readFileSync(absoluta, "utf8");
          }
        } catch {
          texto = null;
        }
      }
    }
    cacheTexto.set(ruta, texto);
    return texto;
  }

  /**
   * @param {string} ruta
   * @returns {string[]}
   */
  function lineas(ruta) {
    const texto = leer(ruta);
    return texto === null ? [] : texto.split(/\r?\n/);
  }

  /**
   * La primera linea que casa, con su numero: es la evidencia que el principio
   * X exige. Un hallazgo que cita un archivo sin decir la linea obliga a
   * buscarla a mano, y en un manifiesto de cuatrocientas lineas eso es lo mismo
   * que no citarla.
   *
   * @param {string} ruta
   * @param {RegExp} re
   * @returns {{ruta: string, linea: number, extracto: string}|null}
   */
  function buscar(ruta, re) {
    const todas = lineas(ruta);
    for (let i = 0; i < todas.length; i++) {
      if (re.test(todas[i])) return { ruta, linea: i + 1, extracto: todas[i].trim() };
    }
    return null;
  }

  /**
   * @param {string} ruta
   * @param {RegExp} re
   * @param {number} [limite]
   * @returns {Array<{ruta: string, linea: number, extracto: string, captura: RegExpMatchArray}>}
   */
  function buscarTodas(ruta, re, limite = 200) {
    const salida = [];
    const todas = lineas(ruta);
    for (let i = 0; i < todas.length && salida.length < limite; i++) {
      const m = todas[i].match(re);
      if (m) salida.push({ ruta, linea: i + 1, extracto: todas[i].trim(), captura: m });
    }
    return salida;
  }

  /**
   * @param {string} ruta
   * @returns {any}
   */
  function json(ruta) {
    if (cacheJson.has(ruta)) return cacheJson.get(ruta);
    let valor = null;
    const texto = leer(ruta);
    if (texto !== null) {
      try {
        valor = JSON.parse(texto);
      } catch {
        // Un manifiesto mal formado es un hueco, no una excepcion: el resto del
        // recorrido sigue valiendo.
        valor = null;
      }
    }
    cacheJson.set(ruta, valor);
    return valor;
  }

  /**
   * La linea donde se declara una clave de un JSON. Sin esto la evidencia de un
   * manifiesto es "package.json" a secas, que no se puede abrir en el sitio.
   *
   * @param {string} ruta
   * @param {string} clave
   * @returns {number|undefined}
   */
  function lineaDeClave(ruta, clave) {
    const escapada = clave.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = buscar(ruta, new RegExp(`^\\s*"${escapada}"\\s*:`));
    return m ? m.linea : undefined;
  }

  return {
    raiz,
    señales: opts.señales,
    archivos: inventario.archivos,
    directorios: inventario.directorios,
    enlaces: inventario.enlaces,
    ilegibles: inventario.ilegibles,
    excluidos: inventario.excluidos,

    /** @param {string} ruta */
    tiene: (ruta) => rutas.has(ruta),
    /** @param {string} ruta */
    tieneDirectorio: (ruta) => directorios.has(ruta),
    // Se devuelve una copia a proposito: un detector que empuje sobre la lista
    // que le dan corromperia el indice para los detectores de las fases
    // siguientes, y el sintoma aparecera en un detector que no toco nada.
    /** @param {string} nombre */
    porNombre: (nombre) => [...(porNombre.get(nombre.toLowerCase()) ?? [])],
    /** @param {string} ext */
    porExtension: (ext) => [...(porExtension.get(ext.toLowerCase()) ?? [])],
    /** @param {string} prefijo */
    bajo: (prefijo) => inventario.archivos.filter((a) => a.ruta.startsWith(prefijo)).map((a) => a.ruta),
    /** @param {RegExp} re */
    rutasComo: (re) => inventario.archivos.filter((a) => re.test(a.ruta)).map((a) => a.ruta),
    /** @param {string} ruta */
    esBinario: (ruta) => {
      const archivo = porRuta.get(ruta);
      if (!archivo) return false;
      return BINARIAS.has(archivo.ext) || leer(ruta) === null;
    },

    leer,
    lineas,
    buscar,
    buscarTodas,
    json,
    lineaDeClave,
  };
}

/** @typedef {ReturnType<typeof crearContexto>} Contexto */
