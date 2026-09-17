// Que esta declarado, que falta, y que credencial no esta.
//
// POR QUE ES UN COMANDO Y NO UN README. Porque la barrera de adopcion no es
// entender el proyecto: es descubrir, de a un fallo por vez y a mitad de un
// recorrido, que faltaba una variable de entorno. `doctor` convierte esa serie
// de descubrimientos en una lista.
//
// LO QUE NO HACE: inventar valores por defecto. Un default razonable para una
// ruta de repositorio es como se trabaja en el repositorio equivocado.

import { execFileSync } from "node:child_process";
import { resolveAll } from "./repos.mjs";
import { validateProvider, CANONICAL_STATES } from "../../../providers/contract.mjs";

function tieneBinario(nombre) {
  try {
    execFileSync("which", [nombre], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function versionDeGit() {
  try {
    return execFileSync("git", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/**
 * @param {object} config ya cargado y validado
 * @param {{env?: Record<string,string>, search?: string[], loadProvider?: (m: string) => Promise<object>, sdkDisponible?: () => Promise<boolean>}} [opts]
 */
export async function doctor(config, opts = {}) {
  const env = opts.env || process.env;
  const problemas = [];
  const avisos = [];

  // --- entorno
  const entorno = {
    node: process.version,
    git: versionDeGit(),
    forgeCli: config.forge?.cli || "gh",
    forgeCliPresente: tieneBinario(config.forge?.cli || "gh"),
    sdkPresente: await sdkDisponible(opts.sdkDisponible),
  };
  if (!entorno.git) problemas.push("git no esta disponible en el PATH, y el motor no puede funcionar sin el");
  if (!entorno.forgeCliPresente) {
    problemas.push(`el CLI del forge (\`${entorno.forgeCli}\`) no esta en el PATH: sin el no se pueden abrir pull requests`);
  }
  if (!entorno.sdkPresente) {
    avisos.push("el Claude Agent SDK no esta instalado: el motor va a invocar el CLI, que arranca un contexto frio por fase");
  }

  // --- proveedor
  let proveedor = { name: config.provider.name, module: config.provider.module, ok: false };
  try {
    const cargar = opts.loadProvider || ((m) => import(m));
    const mod = await cargar(config.provider.module);
    const v = validateProvider(mod);
    proveedor = {
      ...proveedor,
      ok: v.ok,
      capabilities: v.ok ? mod.capabilities() : null,
      // Se normaliza a lista: un proveedor que exporte `requiredEnv` como
      // string hacia que doctor lo recorriera CARACTER POR CARACTER y reportara
      // un problema por cada letra — justo el comando cuyo valor es que la lista
      // de carencias sea legible.
      requiredEnv: Array.isArray(mod.requiredEnv) ? mod.requiredEnv : (mod.requiredEnv ? [String(mod.requiredEnv)] : []),
    };
    for (const p of v.problems) problemas.push(`proveedor ${config.provider.name}: ${p}`);
    if (mod.requiredEnv && !Array.isArray(mod.requiredEnv)) {
      avisos.push(`el proveedor ${config.provider.name} declara requiredEnv como ${typeof mod.requiredEnv} y no como lista; se interpreto como una sola variable`);
    }
    for (const varName of proveedor.requiredEnv) {
      if (!env[varName]) {
        problemas.push(`falta la variable de entorno ${varName}, que el proveedor ${config.provider.name} necesita`);
      }
    }
    if (v.ok) {
      const caps = mod.capabilities();
      if (!caps.searchAssigned && !caps.searchMentioned) {
        avisos.push(`el proveedor no soporta ninguna forma de disparo automatico: el modo daemon no va a arrancar`);
      }
      if (!caps.children) {
        avisos.push("el proveedor no sabe leer hijos: no se van a poder recorrer hitos, solo tickets sueltos");
      }
      if (!caps.dependencies) {
        avisos.push("el proveedor no soporta dependencias entre tickets: el orden de un hito se va a serializar y quedar declarado");
      }
    }
  } catch (e) {
    problemas.push(`no se pudo cargar el proveedor desde "${config.provider.module}": ${e.message}`);
  }

  // --- mapa de estados
  if (!config.provider.stateMap) {
    avisos.push("no hay stateMap declarado: el motor no va a mover el estado de ningun ticket");
  } else if (config.unmappedStates?.length) {
    avisos.push(
      `estados canonicos sin mapear (${config.unmappedStates.join(", ")}): el motor no los va a escribir. ` +
        `Que "done" no este mapeado es lo normal — noxloop no cierra tickets.`,
    );
  }
  if (config.provider.stateMap?.done) {
    avisos.push(
      'el stateMap declara "done", pero noxloop nunca lo escribe: cerrar un ticket dice que esta integrado, y la autonomia termina en el PR abierto.',
    );
  }

  // --- repositorios
  const repos = resolveAll(config, { search: opts.search });
  for (const r of repos) {
    if (!r.ok) problemas.push(`repositorio "${r.name}": ${r.problem}`);
    const declarado = config.repos[r.name];
    if (!declarado.fastGate) {
      avisos.push(`repositorio "${r.name}": sin \`fastGate\`, el rechequeo tras el rebase va a correr el gate completo`);
    }
    if (!declarado.gaps?.length) {
      avisos.push(
        `repositorio "${r.name}": \`gaps\` esta vacio. Si el gate de verdad cubre todo, dejalo; si no, declararlo es lo que evita que un verde parcial se lea como completo.`,
      );
    }
    if (!Object.keys(declarado.runners || {}).length) {
      avisos.push(`repositorio "${r.name}": sin \`runners\`, el bucle rojo/verde va a correr el gate completo en cada iteracion`);
    }
  }

  return {
    ready: problemas.length === 0,
    home: config.home,
    entorno,
    proveedor,
    repos,
    canonicalStates: CANONICAL_STATES,
    problemas,
    avisos,
  };
}

/**
 * Si el Agent SDK esta instalado.
 *
 * ACEPTA UN DETECTOR INYECTADO (T115), con el de produccion como default. El
 * SDK es una `optionalDependency`, asi que un `npm ci` normal lo instala y el
 * camino degradado —el que el README promete: "si falta, se invoca el CLI y se
 * dice"— casi nunca se recorria en los tests. Lo unico afirmable era una
 * bicondicional que no prueba ni el mensaje ni que sea aviso y no problema.
 *
 * Un detector que revienta cuenta como AUSENTE. `doctor` existe para decir que
 * falta: caerse al averiguarlo lo dejaria sin decir nada, que es peor que
 * reportar de menos.
 *
 * @param {(() => Promise<boolean>)} [detector]
 */
async function sdkDisponible(detector) {
  if (detector) {
    try {
      return Boolean(await detector());
    } catch {
      return false;
    }
  }
  try {
    const { createRequire } = await import("node:module");
    createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk");
    return true;
  } catch {
    return false;
  }
}
