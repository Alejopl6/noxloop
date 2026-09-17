// Resolucion de repositorios locales, con verificacion.
//
// EL FALLO QUE EVITA. Ya paso: un directorio que dejo de corresponder al
// repositorio que su nombre decia, y el orquestador trabajo en el equivocado
// sin que nada avisara. Construir la ruta a mano es barato y el fallo es
// silencioso, que es la peor combinacion posible.
//
// Por eso `repoRoot` no devuelve una ruta sin antes comparar el remote.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Normaliza las formas equivalentes de un mismo remote:
 *   git@host:org/repo.git  ==  https://host/org/repo.git  ==  https://host/org/repo
 * @returns {string} `host/org/repo` en minusculas
 */
function normalizar(remote) {
  if (!remote) return "";
  let s = remote.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  s = s.replace(/^ssh:\/\//, "").replace(/^https?:\/\//, "").replace(/^git:\/\//, "");
  s = s.replace(/^[^@/]+@/, "");   // usuario@
  s = s.replace(":", "/");          // host:org/repo -> host/org/repo
  return s.toLowerCase();
}

/**
 * @param {string} path
 * @param {string} esperado
 * @returns {{ok: boolean, actual: string | null, reason?: string}}
 */
export function verifyRemote(path, esperado) {
  if (!existsSync(path)) return { ok: false, actual: null, reason: `${path} no existe` };
  let actual;
  try {
    actual = execFileSync("git", ["-C", path, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return { ok: false, actual: null, reason: `${path} no es un repositorio git, o no tiene remote origin` };
  }
  const ok = normalizar(actual) === normalizar(esperado);
  return {
    ok,
    actual,
    ...(ok ? {} : { reason: `el remote de ${path} es ${actual}, no ${esperado}` }),
  };
}

/**
 * La ruta del checkout de un repositorio declarado, verificada.
 * @param {string} nombre
 * @param {object} config
 * @param {{search?: string[]}} [opts] donde buscar si no hay `path` declarado
 */
export function repoRoot(nombre, config, opts = {}) {
  const repo = config.repos?.[nombre];
  if (!repo) throw new Error(`el repositorio "${nombre}" no esta declarado en la configuracion`);

  const candidatos = repo.path
    ? [repo.path]
    : (opts.search || []).map((base) => join(base, nombre));

  if (candidatos.length === 0) {
    throw new Error(
      `el repositorio "${nombre}" no declara \`path\` y no hay donde buscarlo: declaralo o pasa --search`,
    );
  }

  const fallos = [];
  for (const c of candidatos) {
    const v = verifyRemote(c, repo.remote);
    if (v.ok) return c;
    fallos.push(v.reason);
  }
  throw new Error(`no se encontro un checkout valido de "${nombre}":\n  - ${fallos.join("\n  - ")}`);
}

/** Todos los repositorios declarados, con su estado de resolucion. Para doctor. */
export function resolveAll(config, opts = {}) {
  return Object.keys(config.repos || {}).map((nombre) => {
    try {
      return { name: nombre, ok: true, path: repoRoot(nombre, config, opts) };
    } catch (e) {
      return { name: nombre, ok: false, path: null, problem: e.message };
    }
  });
}
