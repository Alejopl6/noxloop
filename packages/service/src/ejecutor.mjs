// Quien ejecuta una tarea y como termina (spec 003, FR-031 y FR-032).
//
// -----------------------------------------------------------------------------
// LA CASCADA: tarea -> proyecto -> general
// -----------------------------------------------------------------------------
//
// El ejecutor se RESUELVE al pintar y al lanzar; no se copia a la tarea. Si se
// copiara, cambiar el implementador de la flota del proyecto no cambiaria las
// tareas ya creadas, y el operador veria en el board un runtime que ya no es el
// del proyecto sin saber de donde salio.
//
//   1. La tarea local, si declara `ejecutor`.
//   2. El proyecto: el runtime de su agente IMPLEMENTADOR en la flota. El
//      agente de la flota no es un «agente» en el sentido de FR-031 (un
//      subagente con nombre): es la configuracion del runtime, asi que de aqui
//      sale el runtime y `agente: null`.
//   3. El general: el runtime de referencia del motor.
//
// El escalon «repo» de FR-031 NO existe todavia, y se dice: un proyecto tiene
// hoy un solo repositorio y nada en el almacen guarda un ejecutor por repo. El
// dia que lo haya, entra entre 1 y 2.
//
// -----------------------------------------------------------------------------
// LO QUE EL MOTOR NO SABE HACER SE DECLARA (principio X)
// -----------------------------------------------------------------------------
//
// El motor monta como implementador SOLO runtimes con hooks: el paso RED lo
// fuerza un hook (principio I), y el adaptador de Codex declara `hooks: false`.
// El termino `changes` y `commit` tampoco: el recorrido del motor acaba siempre
// en el PR abierto. Las dos cosas se guardan en la tarea —son la eleccion del
// operador— y se niegan AL LANZAR con el hueco escrito, y el board deshabilita
// Run con el mismo motivo. Lo que no se hace es lanzar igual con otra cosa.

import { ErrorDeServicio } from "./errores.mjs";

/** El runtime de referencia: el que el motor monta cuando nadie eligio otro. */
export const RUNTIME_GENERAL = "claude-agent-sdk";

/** Los runtimes que el servicio sabe nombrar (los de `packages/adapters` con sesion). */
export const RUNTIMES_CONOCIDOS = Object.freeze(["claude-agent-sdk", "codex"]);

/**
 * Los que el motor puede montar como implementador, con el porque de los que
 * no. Es una tabla de CAPACIDADES del motor, no de marcas: cuando el adaptador
 * de Codex tenga hooks, sale de aqui.
 *
 * @type {Readonly<Record<string, string|null>>}
 */
export const MONTABLE_POR_EL_MOTOR = Object.freeze({
  "claude-agent-sdk": null,
  codex:
    "su adaptador declara `hooks: false`, y sin el hook que fuerza el paso RED el test primero dependeria de que el " +
    "prompt se acuerde (principio I). El motor no lo monta como implementador.",
});

/** Los terminos que el motor sabe cumplir hoy. */
export const TERMINOS_DEL_MOTOR = Object.freeze(["pr"]);

/**
 * El ejecutor del proyecto: el runtime de su implementador, o `null`.
 *
 * @param {any} dep
 * @param {string} projectId
 */
export function ejecutorDelProyecto(dep, projectId) {
  const agente = dep.almacen.base.consultarUno(
    "SELECT runtime FROM agent WHERE project_id = ? AND rol = 'implementador' ORDER BY nombre LIMIT 1",
    [projectId],
  );
  return agente && agente.runtime ? { runtime: String(agente.runtime), agente: null } : null;
}

/**
 * La cascada entera, con de donde salio cada cosa.
 *
 * @param {{runtime: string, agente?: string|null}|null} deLaTarea
 * @param {{runtime: string, agente: null}|null} delProyecto
 * @returns {{runtime: string, agente: string|null, de: "la tarea"|"el proyecto"|"el general"}}
 */
export function resolverEjecutor(deLaTarea, delProyecto) {
  if (deLaTarea && typeof deLaTarea.runtime === "string" && deLaTarea.runtime) {
    return { runtime: deLaTarea.runtime, agente: deLaTarea.agente ?? null, de: "la tarea" };
  }
  if (delProyecto) return { runtime: delProyecto.runtime, agente: null, de: "el proyecto" };
  return { runtime: RUNTIME_GENERAL, agente: null, de: "el general" };
}

/**
 * Lo que impide lanzar con este ejecutor y este termino, como el error que lo
 * dice. `null` si se puede.
 *
 * @param {{ejecutor: {runtime: string, de: string}, termino: string, clave: string}} e
 * @returns {ErrorDeServicio|null}
 */
export function problemaDeEjecucion(e) {
  if (!TERMINOS_DEL_MOTOR.includes(e.termino)) {
    return new ErrorDeServicio("termino_sin_soporte", { clave: e.clave, termino: e.termino });
  }
  const porque = Object.hasOwn(MONTABLE_POR_EL_MOTOR, e.ejecutor.runtime)
    ? MONTABLE_POR_EL_MOTOR[e.ejecutor.runtime]
    : "el motor no tiene registrado ningun adaptador con ese id.";
  if (porque) {
    return new ErrorDeServicio("ejecutor_sin_soporte", {
      runtime: e.ejecutor.runtime,
      de: `desde ${e.ejecutor.de}`,
      porque,
      soportados: Object.keys(MONTABLE_POR_EL_MOTOR).filter((k) => MONTABLE_POR_EL_MOTOR[k] === null),
    });
  }
  return null;
}
