// T186/T187 — el modelo de flota: quien es cada agente y que se comprueba de el.
//
// TODO SE VALIDA AL GUARDAR, NO AL EJECUTAR, y es la decision que sostiene este
// archivo entero. Un error de configuracion descubierto a mitad de un run cuesta
// el run entero: worktrees creados, gates corridos, modelo pagado, y una
// revision que ya salio confirmando lo que el implementador escribio. La
// configuracion se escribe una vez y se ejecuta miles: el sitio barato de fallar
// es el primero, con el operador todavia mirando la pantalla donde la escribio.
//
// LA PERSISTENCIA VA INYECTADA. Este modulo no sabe donde se guardan los
// agentes: recibe un repositorio, igual que el nucleo y la boveda. Asi las
// reglas se prueban sin almacen, y el almacen puede cambiar sin tocarlas.

import { randomUUID } from "node:crypto";

import {
  flotaIncompleta,
  revisorComparteRuntime,
  rolDesconocido,
  runtimeDesconocido,
  runtimeSinHooksParaImplementador,
  techoDeGastoInaplicable,
} from "../errores.mjs";

/**
 * Los roles de la flota. Conjunto cerrado: las reglas se aplican POR rol, asi
 * que un rol inventado no choca con nada, no exige hooks y no cuenta para
 * activar — o sea, se salta todas las guardas sin avisar.
 *
 * @type {readonly string[]}
 */
export const ROLES = Object.freeze(["implementador", "revisor", "planificador", "verificador"]);

/** Los roles sin los cuales un proyecto no puede pasar a `ACTIVE`. */
const ROLES_OBLIGATORIOS = Object.freeze(["implementador", "revisor"]);

/**
 * Quien sostiene el test-primero (principio I) de un agente, dicho para que la
 * pantalla de flota lo pueda pintar.
 *
 *   - `por_hook`: el runtime corre el hook del paso RED DENTRO de su
 *     subproceso, y la escritura fuera de alcance se BLOQUEA antes de ocurrir.
 *   - `por_motor`: el runtime no tiene hooks; el motor mira el worktree
 *     DESPUES de cada fase y REVIERTE lo que la fase escribio fuera de su
 *     alcance, contando el intento (`packages/engine/src/alcance-de-fase.mjs`).
 *     El historial queda igual de limpio; lo que no hay es el bloqueo en
 *     caliente, y por eso se declara en vez de igualarlo.
 *   - `no_aplica`: el rol no escribe produccion (revisor, planificador,
 *     verificador).
 *   - `null`: implementador sin hooks en un camino donde el motor NO aplica la
 *     guarda posterior — nadie lo sostiene, y ese agente no se guarda.
 *
 * @param {string} rol
 * @param {any} caps las `capabilities()` del runtime
 * @param {{alcancePorElMotor?: boolean}} [opts]
 * @returns {"por_hook"|"por_motor"|"no_aplica"|null}
 */
export function modoTdd(rol, caps, { alcancePorElMotor = true } = {}) {
  if (rol !== "implementador") return "no_aplica";
  if (caps?.hooks === true) return "por_hook";
  return alcancePorElMotor ? "por_motor" : null;
}

/**
 * @typedef {object} Agent
 * @property {string} id
 * @property {string|null} project_id
 * @property {string} nombre
 * @property {string} rol
 * @property {string} runtime el `id` del adaptador
 * @property {string} modelo
 * @property {readonly string[]} skills
 * @property {readonly string[]} tools
 * @property {readonly string[]} mcps
 * @property {object} permisos
 * @property {object} presupuesto
 * @property {object} contexto
 * @property {string} creado
 * @property {"por_hook"|"por_motor"|"no_aplica"|null} [tdd] quien sostiene el principio I; lo pone `guardarAgente`
 */

/**
 * @param {any} datos
 * @returns {Agent}
 */
export function crearAgente({
  project_id,
  nombre,
  rol,
  runtime,
  modelo,
  skills = [],
  tools = [],
  mcps = [],
  permisos = {},
  presupuesto = {},
  contexto = {},
  id,
  ahora = Date.now(),
}) {
  if (!ROLES.includes(rol)) throw rolDesconocido(String(rol), ROLES);
  return Object.freeze({
    id: id ?? `agt_${randomUUID()}`,
    project_id: project_id ?? null,
    nombre: String(nombre ?? ""),
    rol,
    runtime: String(runtime ?? ""),
    modelo: String(modelo ?? ""),
    skills: Object.freeze([...skills]),
    tools: Object.freeze([...tools]),
    mcps: Object.freeze([...mcps]),
    permisos: Object.freeze({ ...permisos }),
    presupuesto: Object.freeze({ ...presupuesto }),
    contexto: Object.freeze({ ...contexto }),
    creado: new Date(ahora).toISOString(),
  });
}

/**
 * Todos los problemas de un conjunto de agentes, sin lanzar.
 *
 * DEVUELVE LA LISTA ENTERA porque la pantalla de flota los tiene que pintar
 * juntos: un formulario que rechaza de uno en uno obliga a seis viajes para
 * arreglar seis cosas, y a la tercera el operador deja de leer el motivo.
 *
 * EL ORDEN ES DELIBERADO y no alfabetico: primero lo que hace que el agente no
 * exista (runtime desconocido), despues lo que rompe la revision (FR-034),
 * despues lo que rompe el paso RED, y al final lo que solo desactiva un limite.
 * Quien lanza, lanza el primero, y el primero tiene que ser el que mas explica.
 *
 * EL IMPLEMENTADOR SIN HOOKS se acepta cuando quien lo va a correr aplica la
 * guarda posterior (`alcancePorElMotor`, cierto por defecto: es lo que hace el
 * motor con todo runtime sin hooks). Un camino que lo correria SIN esa guarda
 * lo declara en `false`, y ahi se rechaza como antes: sin hook y sin guarda,
 * el principio I dependeria de que el prompt se acuerde.
 *
 * @param {{agentes: readonly Agent[], adaptadores: any, alcancePorElMotor?: boolean}} datos
 * @returns {import("../errores.mjs").ErrorDeAdaptador[]}
 */
export function validarFlota({ agentes, adaptadores, alcancePorElMotor = true }) {
  /** @type {any[]} */
  const desconocidos = [];
  /** @type {any[]} */
  const revision = [];
  /** @type {any[]} */
  const sinHooks = [];
  /** @type {any[]} */
  const techos = [];

  for (const a of agentes) {
    if (!adaptadores.tiene(a.runtime)) {
      desconocidos.push(runtimeDesconocido(a.runtime, adaptadores.ids()));
      // Sin adaptador no hay capacidades que consultar: las reglas que dependen
      // de ellas no se pueden evaluar, y evaluarlas con un `null` produciria un
      // segundo error que confunde en vez de sumar.
      continue;
    }
    const caps = adaptadores.capacidades(a.runtime);

    if (modoTdd(a.rol, caps, { alcancePorElMotor }) === null) {
      sinHooks.push(runtimeSinHooksParaImplementador(a.runtime, a.nombre));
    }
    if (caps.cost !== true && a.presupuesto && a.presupuesto.usd != null) {
      techos.push(techoDeGastoInaplicable(a.runtime, a.nombre));
    }
  }

  // FR-034 — POR PROYECTO. Dos proyectos distintos pueden usar el mismo runtime
  // para implementar y revisar cada uno lo suyo; lo que no puede es coincidir
  // dentro del mismo, porque ahi es donde el revisor mira el codigo que escribio
  // el otro.
  const porProyecto = new Map();
  for (const a of agentes) {
    const clave = a.project_id ?? "";
    if (!porProyecto.has(clave)) porProyecto.set(clave, []);
    porProyecto.get(clave).push(a);
  }
  for (const [, delProyecto] of porProyecto) {
    const implementadores = delProyecto.filter((/** @type {Agent} */ a) => a.rol === "implementador");
    const revisores = delProyecto.filter((/** @type {Agent} */ a) => a.rol === "revisor");
    for (const rev of revisores) {
      for (const impl of implementadores) {
        if (rev.runtime === impl.runtime) revision.push(revisorComparteRuntime(rev.runtime, rev.nombre, impl.nombre));
      }
    }
  }

  return [...desconocidos, ...revision, ...sinHooks, ...techos];
}

/**
 * Guarda un agente si —y solo si— la flota que queda es valida.
 *
 * SE VALIDA EL CONJUNTO Y NO EL AGENTE SUELTO. La regla que importa es
 * relacional: un revisor no es invalido por si mismo, lo es junto al
 * implementador que ya estaba guardado. Validar solo lo que llega deja pasar la
 * mitad de los casos — justo la mitad que ocurre, porque nadie da de alta los
 * dos agentes en la misma peticion.
 *
 * LO GUARDADO DECLARA QUIEN SOSTIENE EL TDD (`tdd`, ver `modoTdd`): un
 * implementador `por_motor` no tiene la misma garantia que uno `por_hook`, y
 * quien lo mira en la pantalla de flota tiene que poder saberlo sin conocer las
 * capacidades de cada runtime.
 *
 * @param {{agente: Agent, repositorio: any, adaptadores: any, alcancePorElMotor?: boolean}} datos
 * @returns {Agent}
 */
export function guardarAgente({ agente, repositorio, adaptadores, alcancePorElMotor = true }) {
  const existentes = repositorio
    .agentes(agente.project_id)
    .filter((/** @type {Agent} */ a) => a.id !== agente.id);

  const problemas = validarFlota({ agentes: [...existentes, agente], adaptadores, alcancePorElMotor });
  if (problemas.length > 0) throw problemas[0];

  const guardado = Object.freeze({
    ...agente,
    tdd: modoTdd(agente.rol, adaptadores.capacidades(agente.runtime), { alcancePorElMotor }),
  });
  repositorio.guardarAgente(guardado);
  return guardado;
}

/**
 * El artefacto de flota que respalda la transicion a `ACTIVE`.
 *
 * DECLARA LAS DEGRADACIONES DE CADA RUNTIME, y no es decoracion: el motor tiene
 * que decir al arrancar el run que un techo de gasto no se puede aplicar, en vez
 * de aplicarlo y que no se dispare nunca. Un limite que se lee como puesto y no
 * lo esta es peor que no tenerlo.
 *
 * @param {{project_id: string, repositorio: any, adaptadores: any}} datos
 */
export function activarFlota({ project_id, repositorio, adaptadores }) {
  const agentes = repositorio.agentes(project_id);

  const faltan = ROLES_OBLIGATORIOS.filter((r) => !agentes.some((/** @type {Agent} */ a) => a.rol === r));
  if (faltan.length > 0) throw flotaIncompleta(project_id, faltan);

  const problemas = validarFlota({ agentes, adaptadores });
  if (problemas.length > 0) throw problemas[0];

  const runtimes = [...new Set(agentes.map((/** @type {Agent} */ a) => a.runtime))];
  /** @type {string[]} */
  const degradaciones = [];
  for (const id of runtimes) {
    const caps = adaptadores.capacidades(id);
    if (caps.cost !== true) {
      degradaciones.push(
        `el runtime \`${id}\` declara \`cost: false\`: no reporta gasto, asi que el techo de USD del hito no ` +
          "puede aplicarse a sus fases. Se acota por intentos y por tiempo, no por dinero.",
      );
    }
    if (caps.resume !== true) {
      degradaciones.push(
        `el runtime \`${id}\` declara \`resume: false\`: cada fase abre sesion nueva y no hereda el contexto de ` +
          "la anterior. Funciona, pero cuesta mas y el contexto se reconstruye cada vez.",
      );
    }
    if (caps.hooks !== true) {
      degradaciones.push(
        `el runtime \`${id}\` declara \`hooks: false\`: no puede correr las guardas dentro de su subproceso. ` +
          "Si implementa, el orden del TDD lo fuerza el motor DESPUES de cada fase —revierte lo escrito fuera de " +
          "alcance y cuenta el intento— en vez de bloquearlo antes: el historial queda igual, el bloqueo en " +
          "caliente no existe.",
      );
    }
  }

  // El artefacto NO se congela en profundidad: es una salida de un solo uso que
  // el servicio consume para transicionar el proyecto, y congelar sus listas
  // hace que ordenarlas para pintarlas lance. Lo que si es inmutable es lo que
  // vive en el repositorio.
  return {
    project_id,
    estado: "ACTIVE",
    agentes: [...agentes],
    runtimes,
    degradaciones,
  };
}
