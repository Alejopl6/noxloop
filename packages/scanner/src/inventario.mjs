// El recorrido del arbol. La fase `inventario`, y la unica parte del scanner
// que toca el sistema de archivos sin que se lo pida un detector.
//
// TRES DECISIONES, Y EL FALLO QUE CADA UNA EVITA.
//
// 1. NO SE SIGUEN LOS ENLACES SIMBOLICOS. Un enlace a `/` o un ciclo entre dos
//    directorios convierte el recorrido en infinito, y en un `node_modules`
//    enlazado convierte diez mil archivos en diez millones. Los enlaces se
//    anotan y se declaran: omitirlos en silencio seria un hueco sin constancia,
//    que es lo que el principio X prohibe.
//
// 2. LO ILEGIBLE SE DECLARA ILEGIBLE. Un directorio con permisos de otro
//    usuario dentro del arbol se salta — pero se dice. El modo de fallo caro no
//    es reventar: es devolver un snapshot `completo` al que le falta una parte
//    del proyecto, porque eso no se nota nunca.
//
// 3. UN SOLO RECORRIDO PARA TODOS LOS DETECTORES. La forma facil es que cada
//    detector recorra lo que necesita; con seis detectores eso son seis
//    recorridos sobre diez mil archivos, y NFR-001 da sesenta segundos para
//    todo.

import { readdirSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

import { compilar, decide, excluidoPorDefecto } from "./ignorados.mjs";

/** Cada cuantas entradas se avisa del progreso. Una barra quieta se lee como colgado. */
const PASO_DE_PROGRESO = 250;

/**
 * @typedef {object} ArchivoVisto
 * @property {string} ruta relativa a la raiz, siempre con `/`
 * @property {string} nombre
 * @property {string} ext en minuscula, con el punto
 * @property {number} tamano
 */

/**
 * @typedef {object} Inventario
 * @property {ArchivoVisto[]} archivos
 * @property {string[]} directorios
 * @property {Array<{ruta: string, destino: string}>} enlaces
 * @property {Array<{ruta: string, causa: string}>} ilegibles
 * @property {{por_defecto: number, por_gitignore: number}} excluidos
 * @property {boolean} cancelado
 */

/**
 * @param {string} raiz
 * @param {{ señales?: AbortSignal, alProgresar?: (vistos: number) => void }} [opts]
 * @returns {Inventario}
 */
export function recorrer(raiz, opts = {}) {
  /** @type {Inventario} */
  const inventario = {
    archivos: [],
    directorios: [],
    enlaces: [],
    ilegibles: [],
    excluidos: { por_defecto: 0, por_gitignore: 0 },
    cancelado: false,
  };

  /** @type {Array<{absoluta: string, relativa: string, grupos: import("./ignorados.mjs").Grupo[]}>} */
  const pendientes = [{ absoluta: raiz, relativa: "", grupos: [] }];
  let vistos = 0;

  while (pendientes.length > 0) {
    if (opts.señales?.aborted) {
      inventario.cancelado = true;
      return inventario;
    }
    const actual = /** @type {any} */ (pendientes.pop());

    /** @type {import("node:fs").Dirent[]} */
    let entradas;
    try {
      entradas = readdirSync(actual.absoluta, { withFileTypes: true });
    } catch (e) {
      inventario.ilegibles.push({ ruta: actual.relativa || ".", causa: e && e.code ? e.code : String(e) });
      continue;
    }

    // El `.gitignore` de este directorio manda sobre los de arriba, y se lee
    // antes de decidir sobre las demas entradas.
    let grupos = actual.grupos;
    if (entradas.some((e) => e.name === ".gitignore" && e.isFile())) {
      try {
        const texto = readFileSync(join(actual.absoluta, ".gitignore"), "utf8");
        const ruta = actual.relativa ? `${actual.relativa}/.gitignore` : ".gitignore";
        grupos = [...grupos, { base: actual.relativa, reglas: compilar(texto, ruta) }];
      } catch {
        // Un `.gitignore` ilegible no puede excluir nada; se sigue sin el.
      }
    }

    for (const entrada of entradas) {
      const relativa = actual.relativa ? `${actual.relativa}/${entrada.name}` : entrada.name;
      const absoluta = join(actual.absoluta, entrada.name);

      if (entrada.isSymbolicLink()) {
        let destino = "";
        try {
          destino = readlinkSync(absoluta);
        } catch {
          // Un enlace roto sigue siendo un enlace: se declara igual, sin destino.
        }
        inventario.enlaces.push({ ruta: relativa, destino });
        continue;
      }

      const esDirectorio = entrada.isDirectory();
      if (!esDirectorio && !entrada.isFile()) continue; // sockets, fifos: no son el proyecto

      if (esDirectorio && excluidoPorDefecto(entrada.name)) {
        inventario.excluidos.por_defecto += 1;
        continue;
      }
      if (decide(grupos, relativa, esDirectorio)) {
        inventario.excluidos.por_gitignore += 1;
        continue;
      }

      if (esDirectorio) {
        inventario.directorios.push(relativa);
        pendientes.push({ absoluta, relativa, grupos });
        continue;
      }

      let tamano = 0;
      try {
        tamano = lstatSync(absoluta).size;
      } catch (e) {
        inventario.ilegibles.push({ ruta: relativa, causa: e && e.code ? e.code : String(e) });
        continue;
      }
      const punto = entrada.name.lastIndexOf(".");
      inventario.archivos.push({
        ruta: relativa,
        nombre: entrada.name,
        ext: punto > 0 ? entrada.name.slice(punto).toLowerCase() : "",
        tamano,
      });

      vistos += 1;
      if (vistos % PASO_DE_PROGRESO === 0) opts.alProgresar?.(vistos);
    }
  }

  return inventario;
}
