// Ayudas de las pruebas del nucleo.
//
// POR QUE LOS HALLAZGOS SE CONSTRUYEN AQUI A MANO Y NO SE IMPORTA EL SCANNER.
// Porque el nucleo no importa nada fuera de `packages/core/` —hay una prueba
// que lo prohibe— y porque lo que el nucleo consume no es el scanner: es la
// FORMA de un hallazgo. Si manana el scanner cambia por dentro y la forma
// sigue igual, estas pruebas tienen que seguir pasando; si la forma cambia,
// tienen que caerse aqui y no en produccion.
//
// La forma se copia del contrato del scanner, no de su implementacion:
// `{ categoria, clave, valor, origen, evidencia, confianza, motivo? }`, y la
// regla que importa —un hueco declarado lleva `motivo`— es la que distingue
// "aqui no habia nada" de "aqui hay esto".

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Un hallazgo con sustancia: el detector encontro algo y trae la ruta.
 *
 * @param {string} clave
 * @param {unknown} valor
 * @param {{categoria?: string, origen?: 'detectado'|'inferido', confianza?: 'alta'|'media'|'baja', evidencia?: any[]}} [opts]
 */
export function hallazgo(clave, valor, opts = {}) {
  return {
    categoria: opts.categoria ?? clave.split(".")[0],
    clave,
    valor,
    origen: opts.origen ?? "detectado",
    evidencia: opts.evidencia ?? [{ ruta: "package.json", linea: 1 }],
    confianza: opts.confianza ?? (opts.origen === "inferido" ? "media" : "alta"),
  };
}

/**
 * Un hueco declarado, tal cual lo emite `vacio()` del scanner: origen
 * `detectado` —porque es un hecho comprobado— con `motivo` y con la evidencia
 * de DONDE se busco.
 *
 * @param {string} clave
 * @param {string} motivo
 * @param {unknown} [valor]
 */
export function hueco(clave, motivo, valor = null) {
  return {
    categoria: clave.split(".")[0],
    clave,
    valor,
    origen: "detectado",
    evidencia: [{ ruta: "." }],
    confianza: "alta",
    motivo,
  };
}

/**
 * @param {any[]} hallazgos
 * @param {object} [extra]
 */
export function snapshotDe(hallazgos, extra = {}) {
  return {
    id: "snap_prueba",
    project_id: null,
    ruta: "/proyecto",
    commit: "0".repeat(40),
    commit_motivo: "",
    creado: "2026-09-20T00:00:00.000Z",
    estado: "completo",
    duracion_ms: 1,
    archivos: [],
    hallazgos,
    descartados: [],
    detectores_caidos: [],
    ...extra,
  };
}

/**
 * Un directorio temporal propio de la prueba. Escribir en el repositorio de un
 * proyecto real desde una prueba es exactamente lo que el producto promete no
 * hacer sin aprobacion.
 *
 * @param {import("node:test").TestContext} t
 * @param {string} [prefijo]
 * @returns {string}
 */
export function directorioDePrueba(t, prefijo = "noxloop-core-") {
  const dir = mkdtempSync(join(tmpdir(), prefijo));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** El motivo minimo aceptable, para no repetir parrafos en cada prueba. */
export const MOTIVO_LARGO =
  "se busco en las rutas donde vive y no hay ninguna, asi que el apartado queda declarado como hueco";

/**
 * Devuelve el error que `fn` lanzo.
 *
 * `assert.throws` NO devuelve el error —devuelve undefined— y una prueba que
 * escribe `const e = assert.throws(...)` y despues mira `e.codigo` revienta con
 * un TypeError que se lee como si el error no se hubiera lanzado, cuando lo que
 * pasa es lo contrario.
 *
 * @param {() => any} fn
 */
export function capturar(fn) {
  try {
    fn();
  } catch (e) {
    return /** @type {any} */ (e);
  }
  throw new Error("no lanzo nada, y se esperaba un error");
}
