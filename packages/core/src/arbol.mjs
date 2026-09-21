// El puerto del arbol del proyecto: la unica via por la que el nucleo toca el
// repositorio de alguien.
//
// POR QUE ES UN PUERTO Y NO `node:fs` SUELTO POR AHI. Por dos razones que no se
// parecen. La primera es de prueba: las pruebas del bootstrap necesitan un arbol
// que cambie a mitad de camino para comprobar que `aplicar` no escribe sobre un
// diff viejo, y eso con `fs` directo es un baile de directorios temporales en
// cada caso. La segunda es la que importa: con un solo punto de escritura hay un
// solo sitio donde comprobar que la ruta no sale del proyecto, y un solo sitio
// donde la escritura es atomica. Con `fs` repartido, la comprobacion se le
// olvida a alguien exactamente una vez.
//
// LA ESCRITURA ES ATOMICA (temporal + rename) porque NFR-003 lo exige y porque
// el archivo que se escribe aqui es la constitution del proyecto: un corte de
// corriente a mitad de un `writeFileSync` deja al proyecto con medio documento
// de reglas, y el runtime lo lee igual.

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve, sep } from "node:path";

import { rutaFueraDelProyecto } from "./errores.mjs";

/**
 * @typedef {object} Arbol
 * @property {() => string} raiz
 * @property {(ruta: string) => boolean} existe
 * @property {(ruta: string) => string|null} leer
 * @property {(ruta: string, contenido: string) => void} escribir
 */

/**
 * Normaliza una ruta del proyecto y se niega a salir de el.
 *
 * @param {string} ruta
 * @param {string} raiz
 * @returns {string}
 */
export function rutaSegura(ruta, raiz) {
  const cruda = String(ruta ?? "");
  if (cruda.length === 0) throw rutaFueraDelProyecto(cruda, raiz);
  // Se rechaza lo absoluto antes de normalizar: `/etc/passwd` normaliza a si
  // mismo y pasaria una comprobacion de `..` sin problema.
  if (cruda.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(cruda)) throw rutaFueraDelProyecto(cruda, raiz);
  const partes = cruda.split(/[\\/]+/).filter((p) => p.length > 0 && p !== ".");
  if (partes.some((p) => p === "..")) throw rutaFueraDelProyecto(cruda, raiz);
  if (partes.length === 0) throw rutaFueraDelProyecto(cruda, raiz);
  return partes.join("/");
}

/**
 * El arbol de verdad, sobre el disco.
 *
 * @param {string} raizCruda
 * @returns {Arbol}
 */
export function arbolDeDisco(raizCruda) {
  const raiz = resolve(raizCruda);

  /** @param {string} ruta */
  const absoluta = (ruta) => join(raiz, rutaSegura(ruta, raiz));

  return {
    raiz: () => raiz,

    existe(ruta) {
      const p = absoluta(ruta);
      return existsSync(p) && statSync(p).isFile();
    },

    leer(ruta) {
      const p = absoluta(ruta);
      if (!existsSync(p) || !statSync(p).isFile()) return null;
      return readFileSync(p, "utf8");
    },

    escribir(ruta, contenido) {
      const destino = absoluta(ruta);
      mkdirSync(dirname(destino), { recursive: true });
      // El temporal vive en el MISMO directorio que el destino: un rename entre
      // sistemas de archivos distintos no es atomico, y `/tmp` esta en otro en
      // la mitad de las instalaciones.
      const temporal = `${destino}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
      try {
        writeFileSync(temporal, contenido, "utf8");
        renameSync(temporal, destino);
      } catch (e) {
        if (existsSync(temporal)) unlinkSync(temporal);
        throw e;
      }
    },
  };
}

/**
 * El arbol de las pruebas. Mismas reglas, sin disco.
 *
 * @param {Record<string, string>} [inicial]
 * @returns {Arbol & {archivos: () => Record<string, string>}}
 */
export function arbolEnMemoria(inicial = {}) {
  const raiz = `memoria:${sep}`;
  /** @type {Map<string, string>} */
  const archivos = new Map();
  for (const [ruta, contenido] of Object.entries(inicial)) archivos.set(rutaSegura(ruta, raiz), contenido);

  return {
    raiz: () => raiz,
    existe: (ruta) => archivos.has(rutaSegura(ruta, raiz)),
    leer: (ruta) => archivos.get(rutaSegura(ruta, raiz)) ?? null,
    escribir(ruta, contenido) {
      archivos.set(rutaSegura(ruta, raiz), contenido);
    },
    archivos: () => Object.fromEntries([...archivos.entries()].sort()),
  };
}
