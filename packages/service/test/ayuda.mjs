// Lo que comparten los tests del servicio. No tiene tests propios a proposito:
// un helper que ademas afirma cosas obliga a leer dos archivos para entender
// por que fallo uno.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { arrancar } from "../src/servidor.mjs";

export const TOKEN = "token-de-prueba";
export const ORIGEN = "tauri://localhost";

export const homeTemporal = (prefijo = "noxloop-svc-") => mkdtempSync(join(tmpdir(), prefijo));

/**
 * Levanta un servicio y garantiza apagarlo, pase lo que pase. Un servicio que
 * queda escuchando despues de un test que fallo se lleva por delante los
 * siguientes, y el fallo aparece en el test equivocado.
 *
 * @param {Record<string, any>} opts
 * @param {(svc: any) => Promise<any>} fn
 */
export async function conServicio(opts, fn) {
  const svc = await arrancar({ home: homeTemporal(), token: TOKEN, ...opts });
  try {
    return await fn(svc);
  } finally {
    await svc.detener();
  }
}

/**
 * Una peticion como la hace la interfaz: con token y con un origen permitido.
 *
 * @param {{url: string}} svc
 * @param {string} ruta
 * @param {RequestInit} [init]
 */
export function pedir(svc, ruta, init = {}) {
  return fetch(`${svc.url}${ruta}`, {
    ...init,
    headers: { "x-noxloop-token": TOKEN, origin: ORIGEN, .../** @type {any} */ (init.headers || {}) },
  });
}

/** Un bloque SSE crudo convertido en algo que se puede afirmar. */
function parsearBloque(bloque) {
  if (!bloque.trim()) return null;
  if (bloque.startsWith(":")) return { comentario: bloque.slice(1).trim() };
  const frame = /** @type {any} */ ({});
  for (const linea of bloque.split("\n")) {
    const corte = linea.indexOf(":");
    if (corte === -1) continue;
    const campo = linea.slice(0, corte);
    const valor = linea.slice(corte + 1).replace(/^ /, "");
    if (campo === "id") frame.id = valor;
    else if (campo === "event") frame.tipo = valor;
    else if (campo === "data") frame.datos = JSON.parse(valor);
  }
  return frame.tipo ? frame : null;
}

/**
 * Lee el stream hasta que `condicion` se cumple o se acaba el tiempo. Devuelve
 * lo leido igual si se acaba: un test que se cuelga esperando un evento que no
 * llega no dice cual falta.
 *
 * @param {Response} respuesta
 * @param {(frames: any[]) => boolean} condicion
 * @param {number} [ms]
 */
export async function leerFrames(respuesta, condicion, ms = 4000) {
  const lector = /** @type {any} */ (respuesta.body).getReader();
  const dec = new TextDecoder();
  const frames = /** @type {any[]} */ ([]);
  let buffer = "";
  const limite = setTimeout(() => { lector.cancel().catch(() => {}); }, ms);
  try {
    while (!condicion(frames)) {
      const { value, done } = await lector.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      let corte;
      while ((corte = buffer.indexOf("\n\n")) !== -1) {
        const frame = parsearBloque(buffer.slice(0, corte));
        buffer = buffer.slice(corte + 2);
        if (frame) frames.push(frame);
      }
    }
  } finally {
    clearTimeout(limite);
    await lector.cancel().catch(() => {});
  }
  return frames;
}

/** Cuantos frames de evento (no comentarios) hay. */
export const eventos = (frames) => frames.filter((f) => f.tipo);
