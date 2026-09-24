// Las tareas propias: el gestor local por HTTP (spec 003, US7, FR-030..032).
//
// -----------------------------------------------------------------------------
// EL SERVICIO ES EL UNICO ESCRITOR, TAMBIEN CUANDO QUIEN ESCRIBE ES EL MOTOR
// -----------------------------------------------------------------------------
//
// Hay tres clientes de estas rutas y los tres pasan por aqui:
//
//   - la interfaz, que crea y edita tareas (principio VIII: pide, no escribe);
//   - el board, que las lista EN PROCESO a traves de `puertoDeTareas` —la
//     interfaz que el proveedor `providers/local` recibe en `ctx.tareas`—;
//   - el motor, que corre como subproceso y mueve el estado de la tarea y deja
//     el enlace al PR como comentario. No puede tocar el almacen (seria un
//     segundo escritor con otro pid), asi que el proveedor local le habla a
//     ESTAS rutas con el token de sesion que el lanzador le puso en el entorno.
//
// Por eso las validaciones viven aqui y no en la interfaz: son las mismas para
// los tres, y la del motor es la que nadie esta mirando.
//
// -----------------------------------------------------------------------------
// LOS ERRORES NO REPITEN VALORES
// -----------------------------------------------------------------------------
//
// Un cuerpo invalido se explica nombrando el CAMPO y lo que se esperaba, nunca
// devolviendo lo que llego: la prueba del centinela manda el valor de una
// credencial en cada campo de cada ruta, y un «llego X» lo publicaria.

import { coleccion, exigirProyecto, noEsta } from "./comun.mjs";
import { ErrorDeServicio } from "./errores.mjs";
import { leerRun } from "./lanzador.mjs";
import { ENUMS } from "../../store/src/index.mjs";

/** Los estados que una tarea puede tener (el canonico del contrato mas `backlog`). */
const ESTADOS = ENUMS["local_task.estado"];
/** Como puede terminar (FR-032). Ninguno mergea. */
const TERMINOS = ENUMS["local_task.termino"];

/** Tope de una pagina de `GET /v1/projects/:id/tasks`: el mismo que `listItems`. */
const PAGINA_MAXIMA = 500;

/**
 * La tarea como sale por el cable y como la recibe el proveedor local. Una
 * sola forma para los tres clientes: si el board y el motor leyeran formas
 * distintas, la primera diferencia seria un campo que uno ve y el otro no.
 *
 * @param {any} f la fila del almacen
 */
export function tareaDeFila(f) {
  if (!f) return null;
  return {
    id: String(f.id),
    projectId: String(f.project_id),
    key: String(f.clave),
    numero: Number(f.numero),
    repo: f.repo ?? null,
    titulo: String(f.titulo),
    plan: String(f.plan ?? ""),
    criterios: Array.isArray(f.criterios) ? f.criterios : [],
    prioridad: Number.isInteger(f.prioridad) ? f.prioridad : null,
    etiquetas: Array.isArray(f.etiquetas) ? f.etiquetas : [],
    ejecutor: f.ejecutor ?? null,
    termino: String(f.termino),
    estado: String(f.estado),
    creado: String(f.creado),
    actualizado: String(f.actualizado),
  };
}

/**
 * La interfaz que el proveedor local recibe en `ctx.tareas` cuando corre DENTRO
 * del servicio. Los mismos cuatro verbos que el proveedor usa por HTTP desde el
 * motor, sobre el mismo almacen. El board solo usa `listar` y `obtener`; los
 * otros dos estan para que el contrato sea el mismo en los dos caminos.
 *
 * @param {any} dep
 */
export function puertoDeTareas(dep) {
  const t = dep.almacen.tareas;
  return {
    async obtener(/** @type {string} */ id) {
      return tareaDeFila(t.porId(id));
    },
    async listar(/** @type {string} */ projectId, /** @type {{limit: number, desde: number, includeDone: boolean}} */ q) {
      const { filas, total } = t.listar(projectId, { incluirTerminadas: q.includeDone, limite: q.limit, desde: q.desde });
      return { items: filas.map(tareaDeFila), total };
    },
    async cambiarEstado(/** @type {string} */ id, /** @type {string} */ estado) {
      return tareaDeFila(t.cambiarEstado(id, estado));
    },
    async comentar(/** @type {string} */ id, /** @type {string} */ texto) {
      return t.comentar(id, texto);
    },
  };
}

// ---------------------------------------------------------------------------
// Validacion
// ---------------------------------------------------------------------------

/** @param {string} campo @param {string} esperado */
const invalido = (campo, esperado) =>
  new ErrorDeServicio("cuerpo_invalido", { detalle: `\`${campo}\` ${esperado}`, campos: [campo] });

const esListaDeTexto = (/** @type {any} */ v) => Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Lo que la peticion trae, validado campo por campo. `parcial` para `PATCH`.
 *
 * @param {any} cuerpo
 * @param {{parcial: boolean}} opts
 */
function validar(cuerpo, opts) {
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) {
    throw new ErrorDeServicio("cuerpo_invalido", { detalle: "el cuerpo tiene que ser un objeto JSON con los campos de la tarea" });
  }
  /** @type {Record<string, any>} */
  const datos = {};
  const esta = (/** @type {string} */ k) => Object.hasOwn(cuerpo, k) && cuerpo[k] !== undefined;

  if (!opts.parcial || esta("titulo")) {
    if (typeof cuerpo.titulo !== "string" || !cuerpo.titulo.trim()) {
      throw invalido("titulo", "es obligatorio y tiene que ser texto: una tarea sin titulo no se puede ver en el board");
    }
    datos.titulo = cuerpo.titulo;
  }
  if (esta("plan")) {
    if (typeof cuerpo.plan !== "string") throw invalido("plan", "tiene que ser texto (markdown)");
    datos.plan = cuerpo.plan;
  }
  if (esta("criterios")) {
    if (!esListaDeTexto(cuerpo.criterios)) throw invalido("criterios", "tiene que ser una lista de textos, uno por criterio verificable");
    datos.criterios = cuerpo.criterios.map((/** @type {string} */ c) => c.trim()).filter(Boolean);
  }
  if (esta("prioridad")) {
    const v = cuerpo.prioridad;
    if (v !== null && !(Number.isInteger(v) && v >= 0 && v <= 4)) {
      throw invalido("prioridad", "tiene que ser un entero de 0 (urgente) a 4 (baja), o null si no tiene");
    }
    datos.prioridad = v;
  }
  if (esta("etiquetas")) {
    if (!esListaDeTexto(cuerpo.etiquetas)) throw invalido("etiquetas", "tiene que ser una lista de textos");
    datos.etiquetas = cuerpo.etiquetas;
  }
  if (esta("repo")) {
    if (cuerpo.repo !== null && typeof cuerpo.repo !== "string") throw invalido("repo", "tiene que ser texto o null (el repositorio del proyecto)");
    datos.repo = typeof cuerpo.repo === "string" && cuerpo.repo.trim() ? cuerpo.repo.trim() : null;
  }
  if (esta("ejecutor")) {
    const e = cuerpo.ejecutor;
    if (e !== null) {
      const ok =
        e && typeof e === "object" && !Array.isArray(e) && typeof e.runtime === "string" && e.runtime.trim() &&
        (e.agente === undefined || e.agente === null || typeof e.agente === "string");
      if (!ok) throw invalido("ejecutor", "tiene que ser `{runtime, agente?}` con `runtime` de texto, o null para heredar del proyecto");
    }
    datos.ejecutor = e ? { runtime: e.runtime.trim(), agente: typeof e.agente === "string" && e.agente.trim() ? e.agente.trim() : null } : null;
  }
  if (esta("termino")) {
    if (!TERMINOS.includes(cuerpo.termino)) {
      throw new ErrorDeServicio("cuerpo_invalido", {
        detalle: `\`termino\` tiene que ser uno de ${TERMINOS.join(", ")}: ninguno mergea (principio IV)`,
        campos: ["termino"],
        opciones: [...TERMINOS],
      });
    }
    datos.termino = cuerpo.termino;
  }
  if (esta("estado")) {
    if (!ESTADOS.includes(cuerpo.estado)) {
      throw new ErrorDeServicio("cuerpo_invalido", {
        detalle: `\`estado\` tiene que ser uno de ${ESTADOS.join(", ")}`,
        campos: ["estado"],
        opciones: [...ESTADOS],
      });
    }
    datos.estado = cuerpo.estado;
  }
  if (!opts.parcial && esta("prefijo")) {
    if (typeof cuerpo.prefijo !== "string" || !/^[A-Z][A-Z0-9]{0,9}$/.test(cuerpo.prefijo)) {
      throw invalido("prefijo", "tiene que ser de 1 a 10 mayusculas o digitos, empezando por letra (`PAY`, `CORE2`)");
    }
    datos.prefijo = cuerpo.prefijo;
  }
  return datos;
}

/**
 * Lo que cambia algo que el board lee: se tira su cache y se avisa. Sin esto
 * la tarea nueva aparece en el board hasta 30 s despues, y el operador pulsa
 * «Nueva tarea» otra vez creyendo que no se guardo.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {string} projectId
 */
function invalidarBoard(p, projectId) {
  const cache = p.estado.motor?.cacheDelBoard;
  if (cache) for (const clave of [...cache.keys()]) if (clave.startsWith(`${projectId}:`)) cache.delete(clave);
  p.estado.bus?.emitir?.("board.invalidado", { projectId }, { project_id: projectId });
}

/** @param {any} dep @param {string} id */
function exigirTarea(dep, id) {
  const fila = dep.almacen.tareas.porId(id);
  if (!fila) throw noEsta("tarea", id, "`GET /v1/projects/:id/tasks`");
  return fila;
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

/**
 * `GET|POST /v1/projects/:id/tasks`
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function tareasDelProyecto(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);

  if (p.metodo === "GET") {
    const limite = Math.min(PAGINA_MAXIMA, Math.max(1, Number.parseInt(p.url.searchParams.get("limit") ?? "", 10) || 100));
    const desde = Math.max(0, Number.parseInt(p.url.searchParams.get("desde") ?? "", 10) || 0);
    const incluirTerminadas = p.url.searchParams.get("includeDone") === "1";
    const { filas, total } = p.dep.almacen.tareas.listar(proyecto.id, { incluirTerminadas, limite, desde });
    const siguiente = desde + filas.length < total ? String(desde + filas.length) : null;
    return {
      cuerpo: coleccion(filas.map(tareaDeFila), { cursor: siguiente }, {
        total,
        prefijo: p.dep.almacen.tareas.prefijoDelProyecto(proyecto.id),
      }),
    };
  }

  const datos = validar(await p.cuerpo(), { parcial: false });
  const fila = p.dep.almacen.tareas.crear({ ...datos, project_id: proyecto.id });
  invalidarBoard(p, proyecto.id);
  return { codigo: 201, cuerpo: { tarea: tareaDeFila(fila) } };
}

/**
 * `GET|PATCH|DELETE /v1/tasks/:id`
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function unaTarea(p) {
  const fila = exigirTarea(p.dep, p.parametros.id);

  if (p.metodo === "GET") {
    const comentarios = p.dep.almacen.tareas
      .comentarios(fila.id)
      .map((/** @type {any} */ c) => ({ id: String(c.id), texto: String(c.texto), creado: String(c.creado) }));
    return { cuerpo: { tarea: tareaDeFila(fila), comentarios } };
  }

  if (p.metodo === "DELETE") {
    // SOLO SI NO TIENE RUN, ni en disco ni en la memoria del lanzador (uno en
    // cola todavia no escribio archivo, y borrar su tarea lo dejaria pidiendo
    // un ticket que no existe cuando le toque).
    const enMemoria = p.estado.motor?.lanzador?.derivado?.(String(fila.id)) ?? null;
    const enDisco = leerRun(p.estado.home, String(fila.id));
    if (enMemoria || enDisco) {
      throw new ErrorDeServicio("tarea_con_run", { clave: fila.clave, estado: enMemoria?.estado ?? "en disco" });
    }
    p.dep.almacen.tareas.borrar(fila.id);
    invalidarBoard(p, String(fila.project_id));
    return { cuerpo: { borrada: String(fila.id), key: String(fila.clave) } };
  }

  const datos = validar(await p.cuerpo(), { parcial: true });
  const cambiada = p.dep.almacen.tareas.actualizar(fila.id, datos);
  invalidarBoard(p, String(fila.project_id));
  return { cuerpo: { tarea: tareaDeFila(cambiada) } };
}

/**
 * `POST /v1/tasks/:id/comments` — lo que el motor deja dicho sobre la tarea
 * (el enlace al PR: el gestor local no declara `linkUrl`, y el motor degrada a
 * comentario).
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function comentariosDeTarea(p) {
  const fila = exigirTarea(p.dep, p.parametros.id);
  const cuerpo = await p.cuerpo();
  if (!cuerpo || typeof cuerpo.texto !== "string" || !cuerpo.texto.trim()) {
    throw invalido("texto", "es obligatorio y tiene que ser texto");
  }
  const c = p.dep.almacen.tareas.comentar(fila.id, cuerpo.texto);
  return { codigo: 201, cuerpo: { comentario: { id: c.id, creado: c.creado } } };
}
