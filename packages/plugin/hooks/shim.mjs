// El puente entre el plugin instalado y los hooks del motor.
//
// EL FALLO QUE CIERRA, y fue el peor del proyecto. `hooks.json` invocaba
// `${CLAUDE_PLUGIN_ROOT}/../engine/src/hooks/*.mjs`, pero el marketplace
// publica `./packages/plugin`: una vez instalado, `../engine` no existe. Los
// cuatro hooks fallaban al arrancar con codigo 1 —que NO es 2— asi que no
// bloqueaban nada. El adoptante leia en el README que el TDD y el limite de
// autonomia son hooks y no prompts, y no tenia ninguno de los dos, en silencio.
//
// LA INVERSION QUE IMPORTA, y es el corazon de este archivo. Que falte la
// guarda no puede significar "permitir": eso es exactamente el verde inventado
// del principio II, aplicado a los hooks. Con un recorrido activo, no poder
// cargar el guard BLOQUEA. Sin recorrido activo permite, igual que antes:
// alguien que instalo el plugin solo para los comandos no puede quedarse sin
// poder escribir codigo.
//
// POR QUE LA DETECCION DE RECORRIDO ACTIVO USA `fs` PELADO. Es lo unico que
// tiene que funcionar cuando el motor no se puede cargar. Depender del motor
// para saber si el motor esta corriendo seria circular.

import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const GUARDS = ["tdd-order-guard", "task-scope-guard", "no-prod-writes", "state-checkpoint"];

/**
 * Donde esta el guard del motor, y por que via se encontro.
 *
 * El orden es deliberado: la variable explicita primero (es la salida para un
 * layout que no anticipamos), despues el repositorio, despues un motor
 * vendorizado dentro del plugin. Una via que apunta a algo que no existe NO se
 * usa en silencio: se sigue buscando.
 *
 * @param {string} nombre
 * @param {{env?: Record<string,string|undefined>, pluginRoot: string, existe?: (p: string) => boolean}} opts
 * @returns {{ruta: string|null, de?: string, candidatas: string[]}}
 */
export function resolverGuard(nombre, opts) {
  const env = opts.env || {};
  const existe = opts.existe || existsSync;
  const raiz = opts.pluginRoot;

  /** @type {Array<[string, string]>} */
  const vias = [];
  if (env.NOXLOOP_ENGINE) vias.push([join(env.NOXLOOP_ENGINE, "src", "hooks", `${nombre}.mjs`), "NOXLOOP_ENGINE"]);
  vias.push([join(dirname(raiz), "engine", "src", "hooks", `${nombre}.mjs`), "el layout del repositorio"]);
  vias.push([join(raiz, "engine", "src", "hooks", `${nombre}.mjs`), "el motor vendorizado en el plugin"]);
  vias.push([join(raiz, "node_modules", "@noxloop", "engine", "src", "hooks", `${nombre}.mjs`), "node_modules del plugin"]);

  for (const [ruta, de] of vias) {
    if (existe(ruta)) return { ruta, de, candidatas: vias.map(([r]) => r) };
  }
  return { ruta: null, candidatas: vias.map(([r]) => r) };
}

/** El home del estado, con la MISMA precedencia que usa el motor. */
export function resolverHome(env = process.env) {
  return env.NOXLOOP_HOME || join(homedir(), ".noxloop");
}

/**
 * Si hay un recorrido corriendo ahora. Con `fs` y nada mas: ver el encabezado.
 *
 * @param {{home: string}} opts
 */
export function hayTareaActiva(opts) {
  const dir = join(opts.home, "active-tasks");
  try {
    if (!existsSync(dir)) return false;
    return readdirSync(dir).some((f) => f.endsWith(".json"));
  } catch {
    // No poder leer el directorio no es "no hay tarea". Pero tampoco se puede
    // afirmar que hay una: se devuelve false y el bloqueo lo decide quien
    // sepa mas. Es el unico lugar del puente que se apoya en el otro lado.
    return false;
  }
}

/**
 * La decision del puente.
 *
 * @param {object} input el payload de PreToolUse/Stop
 * @param {{nombre: string, resolucion: {ruta: string|null, de?: string, candidatas?: string[]}, home: string}} ctx
 * @returns {Promise<{allow: boolean, reason?: string}>}
 */
export async function decidirPuente(input, ctx) {
  const { nombre, resolucion, home } = ctx;

  if (resolucion.ruta) {
    try {
      const mod = await import(resolucion.ruta);
      if (typeof mod.decide !== "function") {
        return bloquearSiCorre(home, nombre, resolucion, `el archivo existe pero no exporta \`decide\``);
      }
      // Se devuelve TAL CUAL. Los guards de PreToolUse hablan en `{allow,
      // reason}` y los de Stop en `{notify, message}`: normalizar aca haria que
      // el puente decida, y el puente no decide nada cuando el guard esta.
      return mod.decide(input, { home });
    } catch (e) {
      // Cargar mal el guard es NO TENER guard. No se degrada a permitir.
      return bloquearSiCorre(home, nombre, resolucion, `no pude cargar el guard: ${e.message}`);
    }
  }

  return bloquearSiCorre(home, nombre, resolucion, "no encontre el motor");
}

/**
 * Sin guard, la decision depende de una sola cosa: si hay trabajo autonomo en
 * curso. Sin recorrido, el hook no es asunto de nadie. Con recorrido, la
 * ausencia del guard es la falla y hay que pararla.
 */
function bloquearSiCorre(home, nombre, resolucion, que) {
  if (!hayTareaActiva({ home })) return { allow: true };

  const rutas = (resolucion.candidatas || []).map((c) => `    ${c}`).join("\n");
  return {
    allow: false,
    reason:
      `BLOQUEADO: hay un recorrido activo de noxloop y no puedo aplicar la guarda \`${nombre}\` (${que}).\n\n` +
      `Sin esa guarda no hay nada que sostenga el TDD ni el limite de autonomia, ` +
      `y permitir seria peor que parar: el recorrido seguiria y el estado diria que cumplio.\n\n` +
      (rutas ? `Busque el motor en:\n${rutas}\n\n` : "") +
      `Para arreglarlo: exporta NOXLOOP_ENGINE apuntando al paquete del motor ` +
      `(el directorio que contiene \`src/hooks/\`), o instala el plugin desde el repositorio completo ` +
      `en vez de solo \`packages/plugin\`. Para parar el recorrido: \`noxloop status\` y ` +
      `borra el puntero de ${join(home, "active-tasks")}.`,
  };
}

export { GUARDS };
