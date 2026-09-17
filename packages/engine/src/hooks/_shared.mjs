// Lo comun a los cuatro hooks.
//
// EL PRINCIPIO QUE MANDA ACA: ante la duda, PERMITIR. Estos hooks corren en
// cada operacion de la sesion, tambien cuando noxloop no esta activo. Un hook
// que bloquea por un error propio deja a una persona sin poder trabajar, que es
// peor que el problema que evitaba. Por eso todo lo que no se entiende se
// permite, y por eso `decide()` nunca lanza.

import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { activeTaskFull } from "../state.mjs";

export const ALLOW = { allow: true };

export function deny(reason) {
  return { allow: false, reason };
}

export function resolveHome(opts = {}) {
  return opts.home || process.env.NOXLOOP_HOME || join(homedir(), ".noxloop");
}

/**
 * La tarea activa que corresponde a ESTA operacion, o null. Nunca lanza: un
 * estado ilegible permite.
 *
 * La pista —el cwd de la sesion y la ruta del archivo— es lo que permite
 * resolver cual de varias tareas paralelas le toca a este hook. Sin pista y con
 * varias activas devuelve null, y el hook permite.
 *
 * @param {{home?: string, cwd?: string}} opts
 * @param {object} [input] el payload del hook, de donde se saca la pista
 */
export function tareaActiva(opts, input) {
  try {
    return activeTaskFull({
      home: resolveHome(opts),
      cwd: input?.cwd || opts?.cwd,
      filePath: input?.tool_input?.file_path,
    });
  } catch {
    return null;
  }
}

/**
 * Un archivo declarado matchea si la ruta que llega termina con el, en un
 * limite de segmento. Hace falta porque el hook recibe rutas absolutas del
 * worktree y las tareas declaran rutas relativas al repositorio.
 */
export function coincideRuta(rutaLlegada, declarada) {
  if (!rutaLlegada || !declarada) return false;
  const a = rutaLlegada.replaceAll("\\", "/");
  const b = declarada.replaceAll("\\", "/").replace(/^\.\//, "");
  return a === b || a.endsWith(`/${b}`);
}

/** Lee el JSON que Claude Code manda por stdin. Para el modo CLI del hook. */
export function leerEntrada() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Imprime la decision en el formato que espera Claude Code y termina.
 *
 * Exit 0 permite; exit 2 bloquea y el motivo por stderr es lo que el modelo
 * lee. Se usa el codigo y no solo el JSON para que el bloqueo funcione igual en
 * una sesion headless, donde no hay nadie que conceda un permiso.
 */
export function responder(decision) {
  if (decision.allow === false) {
    process.stderr.write(`${decision.reason}\n`);
    process.exit(2);
  }
  if (decision.notify && decision.message) {
    process.stderr.write(`${decision.message}\n`);
  }
  process.exit(0);
}
