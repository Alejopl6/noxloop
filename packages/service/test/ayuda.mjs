// Lo que comparten los tests del servicio. No tiene tests propios a proposito:
// un helper que ademas afirma cosas obliga a leer dos archivos para entender
// por que fallo uno.

import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import { arrancar } from "../src/servidor.mjs";

export const TOKEN = "token-de-prueba";
export const ORIGEN = "tauri://localhost";

/**
 * La frase de paso de la boveda en las pruebas.
 *
 * Va explicita y no por entorno: el servicio se NIEGA a inventar una —una frase
 * guardada junto al archivo que cifra no protege de nadie— asi que una prueba
 * que quiera ejercer credenciales tiene que dar la suya, igual que el operador.
 */
export const FRASE = "una frase de paso solo para las pruebas";

export const homeTemporal = (prefijo = "noxloop-svc-") => mkdtempSync(join(tmpdir(), prefijo));

/** Una carpeta vacia de usar y tirar. */
export const carpetaDePrueba = () => mkdtempSync(join(tmpdir(), "noxloop-carpeta-"));

/**
 * Un repositorio git de verdad.
 *
 * POR QUE `git init` Y NO UN `.git` FABRICADO A MANO. Porque lo que el servicio
 * comprueba es lo que hay en el disco, y un `.git` de mentira probaria que la
 * comprobacion pasa sobre un directorio con ese nombre — no que pasa sobre un
 * repositorio. El dia que la comprobacion se afine, el test tiene que seguir
 * siendo verdad.
 */
export function repoDePrueba() {
  const ruta = carpetaDePrueba();
  execFileSync("git", ["init", "--quiet", ruta], { stdio: "ignore" });
  writeFileSync(join(ruta, "README.md"), "# un proyecto del operador\n");
  return ruta;
}

/**
 * Un repositorio con MUCHOS archivos.
 *
 * POR QUE HACE FALTA. La prueba de cancelacion es una carrera de verdad: el
 * `DELETE` tiene que llegar mientras el recorrido todavia corre. Sobre un
 * repositorio de tres archivos, el escaneo termina antes que el viaje de ida y
 * vuelta de la peticion y el test falla —o peor, pasa a veces—. Con unos miles
 * de archivos la fase de inventario dura lo suficiente para que la carrera
 * tenga un ganador estable, y lo que se prueba sigue siendo lo mismo.
 *
 * @param {number} [cuantos]
 */
export function repoGrandeDePrueba(cuantos = 4000) {
  const ruta = repoDePrueba();
  const dir = join(ruta, "muchos");
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < cuantos; i++) writeFileSync(join(dir, `archivo-${i}.txt`), `contenido ${i}\n`);
  return ruta;
}

/**
 * Huella del arbol COMPLETO, incluido lo que git ignora.
 *
 * Inodo, mtime, tamaño y modo: un archivo reescrito con el mismo contenido
 * cambia mtime, y uno reemplazado por temporal + rename cambia el inodo. `atime`
 * queda fuera a proposito — leer un archivo lo mueve, y leer es exactamente lo
 * que estas rutas tienen permitido hacer.
 *
 * @param {string} raiz
 * @returns {Map<string, string>}
 */
export function huellaDelArbol(raiz) {
  /** @type {Map<string, string>} */
  const huella = new Map();
  /** @param {string} dir */
  const recorrer = (dir) => {
    for (const nombre of readdirSync(dir).sort()) {
      const p = join(dir, nombre);
      const st = lstatSync(p);
      huella.set(
        relative(raiz, p).split(sep).join("/"),
        `${st.ino}:${st.mtimeMs}:${st.size}:${st.mode}:${st.isDirectory() ? "d" : "f"}`,
      );
      if (st.isDirectory() && !st.isSymbolicLink()) recorrer(p);
    }
  };
  recorrer(raiz);
  return huella;
}

/** La diferencia entre dos huellas, en texto, para que el fallo diga QUE se toco. */
export function diferencias(antes, despues) {
  const cambios = [];
  for (const [ruta, valor] of despues) {
    if (!antes.has(ruta)) cambios.push(`creado: ${ruta}`);
    else if (antes.get(ruta) !== valor) cambios.push(`modificado: ${ruta} (${antes.get(ruta)} -> ${valor})`);
  }
  for (const ruta of antes.keys()) if (!despues.has(ruta)) cambios.push(`borrado: ${ruta}`);
  return cambios;
}

/**
 * Levanta un servicio y garantiza apagarlo, pase lo que pase. Un servicio que
 * queda escuchando despues de un test que fallo se lleva por delante los
 * siguientes, y el fallo aparece en el test equivocado.
 *
 * @param {Record<string, any>} opts
 * @param {(svc: any) => Promise<any>} fn
 */
export async function conServicio(opts, fn) {
  // EL HOME DE CLAUDE, VACIO POR DEFECTO (spec 004). El board consulta el
  // diagnostico, que lee `~/.claude.json`: sin esto, cada test leeria el del
  // operador y un repo temporal saldria «confianza pendiente» en una maquina y
  // «desconocida» en el CI. Vacio es `desconocida`, que no bloquea nada.
  const motor = { homeDeClaude: mkdtempSync(join(tmpdir(), "noxloop-claude-vacio-")), ...(opts.motor ?? {}) };
  const svc = await arrancar({ home: homeTemporal(), token: TOKEN, ...opts, motor });
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
