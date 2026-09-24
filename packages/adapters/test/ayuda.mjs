// Ayudas de las pruebas de este paquete. No contiene pruebas.
//
// Vive aqui y no en `src/` porque nada de esto viaja al sidecar: son utilidades
// para medir disco y armar directorios temporales, y meterlas en la superficie
// publica seria ofrecer como API lo que solo sirve para probar.

import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Un directorio temporal que se borra al terminar la prueba. */
export function directorioTemporal(t) {
  // `realpathSync` NO es cosmetico: en macOS `/var` es un enlace a `/private/var`
  // y `process.cwd()` del subproceso devuelve la ruta resuelta. Sin esto, la
  // prueba `cwd-respetado` comparara dos grafias del mismo directorio y fallara
  // por un motivo que no tiene nada que ver con lo que mide.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "noxloop-adapters-")));
  if (t && typeof t.after === "function") {
    t.after(() => rmSync(dir, { recursive: true, force: true }));
  }
  return dir;
}

/**
 * La huella de un arbol de directorios: ruta, tamaño y contenido.
 *
 * SE MIDE EL CONTENIDO Y NO SOLO LA FECHA. Una escritura del mismo tamaño en el
 * mismo segundo —reescribir un archivo de run con otro estado— no mueve ni el
 * tamaño ni el `mtime` con resolucion de segundo, y la prueba pasaria mientras
 * el adaptador escribe estado en cada fase.
 *
 * @param {string} dir
 * @returns {Record<string, string>}
 */
export function huellaDeDisco(dir) {
  /** @type {Record<string, string>} */
  const huella = {};
  const recorrer = (actual, prefijo) => {
    let entradas;
    try {
      entradas = readdirSync(actual);
    } catch {
      return; // no existe: se anota como arbol vacio
    }
    for (const e of entradas.sort()) {
      const p = join(actual, e);
      const rel = prefijo ? `${prefijo}/${e}` : e;
      const st = statSync(p);
      if (st.isDirectory()) recorrer(p, rel);
      else huella[rel] = readFileSync(p, "utf8");
    }
  };
  recorrer(dir, "");
  return huella;
}

/** @param {string} dir */
export function crear(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Si un proceso sigue vivo. `kill(pid, 0)` no manda señal: solo pregunta. */
export function sigueVivo(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Espera a que `condicion()` sea verdadera, o se rinde. */
export async function hasta(condicion, { ms = 5000, paso = 10 } = {}) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (condicion()) return true;
    await new Promise((r) => setTimeout(r, paso));
  }
  return false;
}

/**
 * Devuelve el error que `fn` lanzo.
 *
 * `assert.throws` NO devuelve el error —devuelve undefined— y una prueba que
 * escribe `const e = assert.throws(...)` y despues mira `e.codigo` revienta con
 * un TypeError que se lee como si el error no se hubiera lanzado.
 */
export function capturar(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("no lanzo nada, y se esperaba un error");
}
