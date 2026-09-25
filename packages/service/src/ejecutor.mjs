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
// El motor monta como implementador los runtimes que tiene REGISTRADOS. Con
// hooks, el paso RED lo bloquea un hook dentro del subproceso (principio I);
// sin hooks —Codex— lo fuerza el motor despues de cada fase, revirtiendo lo que
// la fase escribio fuera de su alcance (`packages/engine/src/alcance-de-fase.mjs`),
// y le manda el encargo expandido en vez de un comando de plugin que no sabe
// leer (`packages/engine/src/comandos-sin-plugin.mjs`). Un runtime que el motor
// no registra sigue sin poder lanzarse.
//
// El termino: el motor cumple `pr` (el PR abierto) y `commit` (la rama del
// ticket commiteada en el repositorio del operador, sin empujar nada). El
// termino `changes` —parar antes de commitear— todavia no: el recorrido
// commitea el test y la implementacion por separado, que es la evidencia del
// orden TDD. Se guarda en la tarea —es la eleccion del operador— y se niega AL
// LANZAR con el hueco escrito, y el board deshabilita Run con el mismo motivo.
// Lo que no se hace es lanzar igual con otra cosa.
//
// Y `pr` sin remoto tampoco: no hay contra que abrirlo. Se dice con
// `sin_repo`, que ofrece terminar en `commit`.

import { ErrorDeServicio } from "./errores.mjs";

/** El runtime de referencia: el que el motor monta cuando nadie eligio otro. */
export const RUNTIME_GENERAL = "claude-agent-sdk";

/** Los runtimes que el servicio sabe nombrar (los de `packages/adapters` con sesion). */
export const RUNTIMES_CONOCIDOS = Object.freeze(["claude-agent-sdk", "codex"]);

/**
 * Los que el motor puede montar como implementador (`null`), con el porque de
 * los que no. Es una tabla de lo que el motor REGISTRA en `wiring.mjs`, no de
 * marcas.
 *
 * Codex estuvo aqui con su porque —«declara `hooks: false`»— hasta que el motor
 * empezo a forzar el orden del TDD despues de la fase en los runtimes sin
 * hooks. El rojo lo sigue concediendo el motor corriendo el test (principio
 * II); lo que cambio es quien impide que la produccion llegue antes: el hook,
 * bloqueando, o el motor, revirtiendo y contando el intento.
 *
 * @type {Readonly<Record<string, string|null>>}
 */
export const MONTABLE_POR_EL_MOTOR = Object.freeze({
  "claude-agent-sdk": null,
  codex: null,
});

/** Los terminos que el motor sabe cumplir hoy (`termino` en su configuracion). */
export const TERMINOS_DEL_MOTOR = Object.freeze(["pr", "commit"]);

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
 * Los runtimes de los roles que NO son el implementador, de la flota del
 * proyecto: el revisor y el planificador, con el nombre del agente para poder
 * decir quien choca con quien.
 *
 * El implementador no esta aqui a proposito: su runtime lo decide la cascada
 * (`resolverEjecutor`), porque una tarea puede elegir el suyo. El revisor no se
 * elige por tarea: es el de la flota, y es contra el que se mide FR-034.
 *
 * @param {any} dep
 * @param {string} projectId
 * @returns {{revisor: {runtime: string, nombre: string}|null, planificador: {runtime: string, nombre: string}|null}}
 */
export function flotaDelProyecto(dep, projectId) {
  const deRol = (/** @type {string} */ rol) => {
    const a = dep.almacen.base.consultarUno(
      "SELECT runtime, nombre FROM agent WHERE project_id = ? AND rol = ? ORDER BY nombre LIMIT 1",
      [projectId, rol],
    );
    return a && a.runtime ? { runtime: String(a.runtime), nombre: String(a.nombre) } : null;
  };
  return { revisor: deRol("revisor"), planificador: deRol("planificador") };
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
 * FR-034 sobre el ejecutor YA RESUELTO: el implementador de ESTA tarea contra el
 * revisor de la flota. `null` si no chocan.
 *
 * UNA regla, en un solo sitio, y la usan los tres que la necesitan: el
 * lanzamiento al componer la configuracion (`componerConfig`), el board al
 * deshabilitar Run (via `problemaDeEjecucion`), y el hand-off al elegir a quien
 * pasar la tarea. Tres copias de la comparacion son tres ocasiones de que el
 * boton diga «adelante» a un Run que la ruta rechaza.
 *
 * La flota ya impide guardar un revisor igual al IMPLEMENTADOR de la flota; lo
 * que no puede impedir es que la cascada (una tarea local que elige su runtime,
 * un hand-off) llegue al del revisor por otro camino.
 *
 * @param {{runtime: string, de?: string}|null|undefined} ejecutor
 * @param {{runtime: string, nombre: string}|null|undefined} revisor el de `flotaDelProyecto`
 * @returns {ErrorDeServicio|null}
 */
export function choqueConElRevisor(ejecutor, revisor) {
  if (!ejecutor?.runtime || !revisor || revisor.runtime !== ejecutor.runtime) return null;
  return new ErrorDeServicio("revisor_comparte_runtime", {
    revisor: revisor.nombre,
    implementador: `el ejecutor de la tarea (resuelto desde ${ejecutor.de ?? "la cascada"})`,
    runtime: ejecutor.runtime,
  });
}

/**
 * Lo que impide lanzar con este ejecutor y este termino, como el error que lo
 * dice. `null` si se puede.
 *
 * `revisor`, si se da, es el de la flota: el choque con el se comprueba con
 * `choqueConElRevisor`, la misma regla que el lanzamiento.
 *
 * `sinRemoto`, si se da, es el proyecto cuando NO tiene remoto: entonces `pr`
 * no se puede cumplir y se dice con `sin_repo`, que ofrece `commit`.
 *
 * @param {{ejecutor: {runtime: string, de: string}, termino: string, clave: string,
 *          revisor?: {runtime: string, nombre: string}|null,
 *          sinRemoto?: {id: string, nombre: string, ruta_local: string}|null}} e
 * @returns {ErrorDeServicio|null}
 */
export function problemaDeEjecucion(e) {
  if (!TERMINOS_DEL_MOTOR.includes(e.termino)) {
    return new ErrorDeServicio("termino_sin_soporte", { clave: e.clave, termino: e.termino });
  }
  if (e.termino === "pr" && e.sinRemoto) {
    return new ErrorDeServicio("sin_repo", {
      nombre: e.sinRemoto.nombre,
      ruta: e.sinRemoto.ruta_local,
      id: e.sinRemoto.id,
      clave: e.clave,
    });
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
  return choqueConElRevisor(e.ejecutor, e.revisor);
}
