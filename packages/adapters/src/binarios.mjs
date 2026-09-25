// Encontrar el binario de un runtime, y el PATH con el que corre una fase.
//
// EL FALLO QUE CIERRA. Una app de macOS abierta desde Finder o el Dock NO
// hereda el PATH de la terminal: launchd le da `/usr/bin:/bin:/usr/sbin:/sbin`
// y nada mas. `claude` vive en `~/.local/bin` o en `/opt/homebrew/bin`, `codex`
// en `/opt/homebrew/bin`, y `node`, `gh` y `npm` tambien. Desde la terminal el
// primer run real funciono; desde la app instalada, el mismo run moria con
// ENOENT al lanzar la primera fase, o el agente arrancaba y no encontraba ni
// `node` para correr el test. El referente (Nodal, `runs/claude_bin.rs`) lo
// resuelve igual: buscar en el PATH recibido y despues en las carpetas donde
// los instaladores dejan estos binarios.
//
// NO ES HEREDAR EL ENTORNO (principio IX). Lo que se suma al PATH son rutas de
// carpetas conocidas, ninguna credencial: el PATH no es secreto, y ampliarlo no
// le da al agente nada que el operador no tenga ya instalado en su maquina.
//
// SIN SHELL. No se pregunta a `zsh -lc 'echo $PATH'`: arrancar el shell de login
// del operador ejecuta su `.zshrc` entero —con lo que traiga— para contestar
// una pregunta que se contesta mirando seis carpetas.

import { accessSync, constants, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";

/**
 * @typedef {(ruta: string) => boolean} Existe
 */

/**
 * Las carpetas donde los instaladores dejan estos binarios, en el orden en que
 * se prueban DESPUES del PATH recibido.
 *
 * `~/.local/bin` va primero porque es donde el instalador nativo de Claude Code
 * deja `claude`, y `~/.claude/local` la instalacion local antigua; despues
 * Homebrew (Apple Silicon e Intel) y las del sistema.
 *
 * @param {string} home
 * @returns {string[]}
 */
export function carpetasConocidas(home) {
  return [
    join(home, ".local", "bin"),
    join(home, ".claude", "local"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
}

/**
 * Las que solo cuentan para UN binario. `~/.codex/bin` es donde el instalador
 * de Codex puede dejarlo; no se suma para los demas, y solo si existe.
 *
 * @type {Readonly<Record<string, (home: string) => string[]>>}
 */
const CARPETAS_PROPIAS = Object.freeze({
  codex: (/** @type {string} */ home) => [join(home, ".codex", "bin")],
});

/** @param {Record<string, string|undefined>} env */
function homeDe(env) {
  return typeof env?.HOME === "string" && env.HOME ? env.HOME : homedir();
}

/** Un archivo (no un directorio) con permiso de ejecucion. */
export function esEjecutable(/** @type {string} */ ruta) {
  try {
    if (!statSync(ruta).isFile()) return false;
    accessSync(ruta, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** @param {Record<string, string|undefined>} env */
function carpetasDelPath(env) {
  return String(env?.PATH ?? "").split(delimiter).filter(Boolean);
}

/**
 * La ruta ABSOLUTA del primer ejecutable con ese nombre, o `null`.
 *
 * Primero el PATH recibido —si el operador tiene dos `claude`, manda el que su
 * PATH elige, como en su terminal—; despues las carpetas conocidas. Un nombre
 * que ya es una ruta (absoluta o con `/`) no se busca: se devuelve si es
 * ejecutable.
 *
 * @param {string} nombre
 * @param {{env?: Record<string, string|undefined>, existe?: Existe}} [opts]
 * @returns {string|null}
 */
export function resolverBinario(nombre, opts = {}) {
  const env = opts.env ?? {};
  const existe = opts.existe ?? esEjecutable;
  if (!nombre) return null;
  if (isAbsolute(nombre) || nombre.includes("/")) return existe(nombre) ? nombre : null;

  const home = homeDe(env);
  const propias = CARPETAS_PROPIAS[/** @type {keyof typeof CARPETAS_PROPIAS} */ (nombre)]?.(home) ?? [];
  for (const dir of [...carpetasDelPath(env), ...carpetasConocidas(home), ...propias]) {
    // Una entrada relativa del PATH depende del directorio desde el que se
    // lance, y el de una fase es el worktree del agente: no se sigue.
    if (!isAbsolute(dir)) continue;
    const ruta = join(dir, nombre);
    if (existe(ruta)) return ruta;
  }
  return null;
}

/**
 * El PATH recibido, mas las carpetas conocidas que no traia, sin duplicados y
 * conservando el orden del recibido (lo del operador manda).
 *
 * `~/.codex/bin` se suma solo si existe: es de un binario y no de todos.
 *
 * @param {Record<string, string|undefined>} env
 * @param {{existeCarpeta?: (ruta: string) => boolean}} [opts]
 * @returns {string}
 */
export function pathAmpliado(env, opts = {}) {
  const existeCarpeta = opts.existeCarpeta ?? existsSync;
  const home = homeDe(env);
  const opcionales = Object.values(CARPETAS_PROPIAS).flatMap((f) => f(home)).filter((d) => existeCarpeta(d));
  const vistas = new Set();
  /** @type {string[]} */
  const salida = [];
  for (const d of [...carpetasDelPath(env), ...carpetasConocidas(home), ...opcionales]) {
    if (vistas.has(d)) continue;
    vistas.add(d);
    salida.push(d);
  }
  return salida.join(delimiter);
}
