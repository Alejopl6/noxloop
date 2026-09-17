// Carga y validacion de la configuracion del proyecto.
//
// Este archivo es la frontera del principio VII: todo nombre propio —
// organizaciones, repositorios, hosts, comandos, ramas — entra por aca y no
// existe en ninguna otra parte del motor. Hay un test que lo verifica buscando
// nombres propios en el fuente.
//
// EL FALLO QUE EVITA VALIDAR. La version anterior de este harness no validaba:
// produjo una configuracion que MENTIA — un campo de carencias vacio que el
// reporte del PR leia como "este gate no tiene huecos" — y el fallo aparecio a
// mitad de un recorrido, en el lugar donde menos se puede diagnosticar.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { validate, applyDefaults } from "./schema.mjs";

const CANONICAL_STATES = ["todo", "in_progress", "blocked", "in_review", "done"];

export class ConfigError extends Error {
  /** @param {string[]} problems */
  constructor(problems, file) {
    super(`la configuracion de ${file} tiene ${problems.length} problema(s):\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigError";
    this.problems = problems;
    this.file = file;
  }
}

/**
 * Resuelve `${VAR}` y `${VAR:-default}`.
 *
 * Una variable sin valor Y sin default LANZA, en vez de resolverse a vacio. Un
 * gate que corre con la cadena de conexion vacia falla con un error que no se
 * lee como lo que es — se lee como tests roto.
 */
export function expandVars(str, env) {
  if (typeof str !== "string") return str;
  return str.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, nombre, porDefecto) => {
    const valor = env[nombre];
    if (valor !== undefined && valor !== "") return valor;
    if (porDefecto !== undefined) return porDefecto;
    throw new Error(`la variable ${nombre} no esta definida y no tiene valor por defecto`);
  });
}

function expandirProfundo(valor, env, problemas, ruta) {
  if (typeof valor === "string") {
    try {
      return expandVars(valor, env);
    } catch (e) {
      problemas.push(`${ruta}: ${e.message}`);
      return valor;
    }
  }
  if (Array.isArray(valor)) return valor.map((v, i) => expandirProfundo(v, env, problemas, `${ruta}[${i}]`));
  if (valor && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor).map(([k, v]) => [k, expandirProfundo(v, env, problemas, `${ruta}.${k}`)]),
    );
  }
  return valor;
}

function cargarEsquema() {
  return JSON.parse(readFileSync(new URL("../schemas/config.schema.json", import.meta.url), "utf8"));
}

/**
 * @param {string} file ruta al noxloop.config.json
 * @param {{env?: Record<string,string>}} [opts]
 */
export function loadConfig(file, opts = {}) {
  const env = opts.env || process.env;
  let crudo;
  try {
    crudo = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new ConfigError([`no se pudo leer ni parsear: ${e.message}`], file);
  }

  const esquema = cargarEsquema();
  const problemas = validate(esquema, crudo);
  if (problemas.length) throw new ConfigError(problemas, file);

  const cfg = applyDefaults(esquema, crudo);

  // Las variables se expanden DESPUES de validar la forma: un error de forma es
  // mas util que un error de variable sobre una forma que ya estaba mal.
  const problemasEnv = [];
  cfg.repos = expandirProfundo(cfg.repos, env, problemasEnv, "$.repos");
  if (cfg.provider.options) {
    cfg.provider.options = expandirProfundo(cfg.provider.options, env, problemasEnv, "$.provider.options");
  }
  if (problemasEnv.length) throw new ConfigError(problemasEnv, file);

  const raiz = dirname(resolve(file));
  cfg.configFile = resolve(file);
  cfg.configDir = raiz;
  cfg.home = resolveHome(cfg, env);

  // `path: null` explicito y no ausente: es la diferencia entre "no declarado,
  // que doctor lo resuelva" y "undefined" propagandose a un join().
  for (const [nombre, repo] of Object.entries(cfg.repos)) {
    repo.name = nombre;
    repo.path = repo.path ? expandirRuta(repo.path, raiz) : null;
    repo.gaps = repo.gaps || [];
    repo.env = repo.env || {};
    repo.runners = repo.runners || {};
  }

  cfg.provider.module = expandirRuta(cfg.provider.module, raiz);

  // Los estados canonicos que este proyecto NO tiene. Se reportan para que la
  // ausencia sea un hecho declarado y no una escritura que falla en silencio.
  const mapa = cfg.provider.stateMap;
  cfg.unmappedStates = mapa
    ? CANONICAL_STATES.filter((s) => mapa[s] === null || mapa[s] === undefined)
    : [...CANONICAL_STATES];

  return cfg;
}

function expandirRuta(p, raiz) {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  if (isAbsolute(p)) return p;
  if (p.startsWith("./") || p.startsWith("../") || p.includes("/")) return resolve(raiz, p);
  return p;
}

/** `NOXLOOP_HOME` gana sobre el archivo; el archivo gana sobre `~/.noxloop`. */
export function resolveHome(cfg, env = process.env) {
  if (env.NOXLOOP_HOME) return env.NOXLOOP_HOME;
  if (cfg && cfg.home) return expandirRuta(cfg.home, cfg.configDir || process.cwd());
  return join(homedir(), ".noxloop");
}
