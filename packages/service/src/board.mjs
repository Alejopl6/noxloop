// El board: un proyecto es su board, y el board general es el mismo con el
// filtro en «Todos» (spec 003, contrato §2).
//
// -----------------------------------------------------------------------------
// UN READ-MODEL, Y NADA MAS
// -----------------------------------------------------------------------------
//
// Una tarjeta es la union de un ticket del gestor y, si existe, el run del
// motor sobre ese ticket. No se guarda en ningun sitio: se deriva en cada
// pintada. Guardarla seria una tercera copia —despues de la del gestor y la del
// motor— que se queda atras de las dos.
//
// Y NO ESCRIBE (SC-007, principio VIII). Ni el home, ni el almacen, ni el
// repositorio del operador. Hay un test que mide el disco antes y despues de
// `GET /v1/board`, el mismo que protege el tablero de la spec 001. Por eso aqui
// se DIAGNOSTICA el proyecto (en memoria) y no se prepara el motor (que escribe
// la configuracion), y el remoto se lee de `.git/config` a mano en vez de
// preguntarle a `git`, que escribe el indice con solo consultarlo.
//
// LA UNICA EXCEPCION DECLARADA: un gestor real pide credencial, y sacarla de la
// boveda deja un evento de acceso en la auditoria antes de devolver el valor
// (principio IX: el registro es parte de la operacion). Es una escritura del
// almacen que el principio IX exige y el VIII tolera, porque la hace el
// servicio. La cache de 30 s la limita a una por proyecto y ventana.
//
// -----------------------------------------------------------------------------
// UN GESTOR CAIDO NO TUMBA EL BOARD (FR-013)
// -----------------------------------------------------------------------------
//
// Lo que viene de los runs en disco no depende del gestor. Si el gestor falla,
// esas tarjetas siguen, y la columna que depende de el dice su causa textual y
// la accion. Un board en blanco por un 401 es exactamente lo que SC-004 prohibe.

import { accionDelEstado, avanceDe, gastoDe, EN_VUELO, TE_NECESITAN } from "./estado-del-run.mjs";
import { exigirProyecto } from "./comun.mjs";
import { datosDelProyecto, diagnosticar, secretosDelGestor } from "./motor.mjs";
import { runsConProyecto } from "./runs.mjs";

/** Las columnas, en el orden en que una persona las lee (FR-001). */
export const COLUMNAS = Object.freeze([
  { id: "backlog", titulo: "Backlog" },
  { id: "todo", titulo: "Todo" },
  { id: "in_progress", titulo: "En curso" },
  { id: "in_review", titulo: "En revisión" },
]);

/** Cuantos tickets se piden al gestor por proyecto. El resto se DICE, no se corta en silencio. */
export const TICKETS_POR_PROYECTO = 100;

/** Los estados de run que dejan la tarjeta en En curso: en vuelo, en cola o detenido. */
const EN_CURSO = [
  "en_cola",
  "planificando",
  "corriendo",
  "plan_listo",
  "necesita_criterios",
  "necesita_permiso",
  "bloqueado",
  "fallido",
  "interrumpido",
];

/** De estado canonico del gestor a columna, cuando no hay run. */
const COLUMNA_DEL_GESTOR = Object.freeze({
  backlog: "backlog",
  todo: "todo",
  in_progress: "in_progress",
  blocked: "in_progress",
  in_review: "in_review",
  done: "in_review",
});

/** @param {string} nombre */
function iniciales(nombre) {
  const partes = String(nombre || "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "";
  const primera = partes[0][0] ?? "";
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] ?? "" : "";
  return (primera + ultima).toUpperCase();
}

/** El numero del PR, si la URL lo trae al final. */
function numeroDePr(/** @type {string} */ url) {
  const m = /(\d+)\/?$/.exec(String(url || ""));
  return m ? m[1] : null;
}

/**
 * El chip de una tarjeta. Bloqueado, fallido, en cola, sin repo... son CHIPS y
 * nunca columnas (FR-004): una columna por cada forma de estar detenido parte
 * el board en nueve y esconde lo unico que importa, que es que esta detenido.
 *
 * @param {any} run
 * @param {any} ticket
 * @param {any} parte
 */
function chipDe(run, ticket, parte) {
  if (run) {
    const e = run.estado;
    const detalle = run.detalle ?? null;
    if (e === "en_cola") {
      return { tipo: "en_cola", texto: `En cola · #${run.posicion ?? "?"}`, detalle: null, posicion: run.posicion ?? null };
    }
    if (e === "planificando") return { tipo: "fase", texto: "Planificando", detalle: null, posicion: null };
    if (e === "corriendo") {
      const a = run.avance;
      const texto = a && a.total ? `${a.fase ?? "En curso"} · ${a.hechas}/${a.total}` : "En curso";
      return { tipo: "fase", texto, detalle: null, posicion: null };
    }
    if (e === "pr_abierto") {
      const n = numeroDePr(run.pr);
      return { tipo: "pr_listo", texto: n ? `PR #${n} listo` : "PR listo", detalle: run.pr ?? null, posicion: null };
    }
    /** @type {Record<string, string>} */
    const TEXTO = {
      plan_listo: "Plan listo",
      necesita_criterios: "Necesita criterios",
      necesita_permiso: "Necesita permiso",
      bloqueado: "Bloqueado",
      fallido: "Falló",
      interrumpido: "Interrumpido",
    };
    if (TEXTO[e]) return { tipo: e, texto: TEXTO[e], detalle, posicion: null };
    return null;
  }
  if (!parte.tieneRepo) return { tipo: "sin_repo", texto: "Sin repo", detalle: parte.motivo ?? null, posicion: null };
  if (ticket?.canonicalState === "blocked") {
    return { tipo: "bloqueado", texto: "Bloqueado", detalle: "el gestor lo tiene marcado como bloqueado", posicion: null };
  }
  return null;
}

/**
 * Una tarjeta. `null` si no va en el board (un terminado sin `includeDone`).
 *
 * @param {any} ticket el `ListedItem` del gestor, o uno sintetizado desde el run
 * @param {any} run el run derivado, o `null`
 * @param {any} parte
 * @param {boolean} includeDone
 */
function tarjetaDe(ticket, run, parte, includeDone) {
  let columna;
  if (run && run.estado === "pr_abierto") columna = "in_review";
  else if (run && EN_CURSO.includes(run.estado)) columna = "in_progress";
  else {
    const canonico = ticket?.canonicalState ?? "todo";
    if (canonico === "done" && !includeDone) return null;
    columna = /** @type {any} */ (COLUMNA_DEL_GESTOR)[canonico] ?? "todo";
  }

  // La accion principal: UNA (FR-005). Todas las que lanzan el motor —Run,
  // aprobar, reintentar— se deshabilitan con el MISMO motivo si el proyecto no
  // se puede lanzar: el boton dice que falta en vez de fallar al pulsarlo.
  const tipo = run ? accionDelEstado(run.estado) : "run";
  const lanza = tipo === "run" || tipo === "approve" || tipo === "retry";
  const habilitada = !lanza || parte.lanzable;
  const accion = { tipo, habilitada, motivo: habilitada ? null : parte.motivo ?? "el proyecto no se puede lanzar" };

  const quien = ticket?.assignee;
  return {
    id: `${parte.proyecto.id}:${ticket.id}`,
    proyecto: { id: parte.proyecto.id, nombre: parte.proyecto.nombre, color: null },
    ticket: {
      id: String(ticket.id),
      key: ticket.key ?? null,
      titulo: ticket.title ?? null,
      url: ticket.url ?? null,
      prioridad: Number.isInteger(ticket.priority) ? ticket.priority : null,
      equipo: ticket.team ?? null,
      etiquetas: Array.isArray(ticket.labels) ? ticket.labels : [],
      asignado: quien
        ? { nombre: quien.name ?? quien.id ?? null, iniciales: iniciales(quien.name ?? quien.id ?? ""), avatarUrl: quien.avatarUrl ?? null }
        : null,
    },
    columna,
    chip: chipDe(run, ticket, parte),
    avance: run?.avance ?? null,
    accion,
    run: run ? { itemId: run.itemId, estado: run.estado, pr: run.pr ?? null, gasto: run.gasto ?? null } : null,
    tieneRepo: Boolean(parte.tieneRepo),
  };
}

/**
 * El board, PURO: lo que la ruta junto entra, el contrato §2 sale.
 *
 * @param {{
 *   partes: Array<{proyecto: any, gestor: string|null, listItems: boolean|null, tickets: any[], runs: any[],
 *                  nota: string|null, lanzable: boolean, tieneRepo: boolean, motivo: string|null}>,
 *   includeDone?: boolean,
 *   proyectos?: any[],
 *   avisos?: any[],
 * }} e
 */
export function construirBoard(e) {
  const includeDone = Boolean(e.includeDone);
  /** @type {any[]} */
  const tarjetas = [];
  /** @type {string[]} */
  const notas = [];

  for (const parte of e.partes) {
    if (parte.nota) {
      notas.push(e.partes.length > 1 ? `${parte.proyecto.nombre}: ${parte.nota}` : parte.nota);
    }
    const porItem = new Map(parte.runs.map((r) => [String(r.itemId), r]));
    const vistos = new Set();
    for (const t of parte.tickets) {
      const id = String(t.id);
      if (vistos.has(id)) continue;
      vistos.add(id);
      const tarjeta = tarjetaDe(t, porItem.get(id) ?? null, parte, includeDone);
      if (tarjeta) tarjetas.push(tarjeta);
    }
    // Los runs cuyo ticket el gestor no devolvio —porque se cayo, porque no
    // sabe listar, o porque el ticket ya no esta abierto— siguen en el board:
    // lo que hace el motor no depende de que el gestor conteste.
    for (const r of parte.runs) {
      const id = String(r.itemId);
      if (vistos.has(id)) continue;
      vistos.add(id);
      const sintetico = { id, key: r.key ?? null, title: r.titulo ?? null, url: r.url ?? null, canonicalState: "todo" };
      const tarjeta = tarjetaDe(sintetico, r, parte, includeDone);
      if (tarjeta) tarjetas.push(tarjeta);
    }
  }

  const nota = notas.length ? notas.join(" · ") : null;
  const columnas = COLUMNAS.map((c) => ({
    id: c.id,
    titulo: c.titulo,
    total: tarjetas.filter((t) => t.columna === c.id).length,
    // Backlog y Todo son las que salen del gestor: si esta incompleto, son
    // esas las que lo dicen.
    nota: c.id === "backlog" || c.id === "todo" ? nota : null,
  }));

  const conRun = tarjetas.filter((t) => t.run);
  const resumen = {
    enCurso: conRun.filter((t) => EN_VUELO.includes(t.run.estado)).length,
    teNecesitan: conRun.filter((t) => TE_NECESITAN.includes(t.run.estado)).length,
    enCola: conRun.filter((t) => t.run.estado === "en_cola").length,
  };

  return { columnas, tarjetas, resumen, proyectos: e.proyectos ?? [], avisos: e.avisos ?? [] };
}

// ---------------------------------------------------------------------------
// La ruta: juntar los datos
// ---------------------------------------------------------------------------

/** Un logger que no escribe: el proveedor recibe uno, y el board no deja rastro. */
const SILENCIO = Object.freeze({ info() {}, warn() {}, error() {}, debug() {} });

/**
 * Los tickets de un proyecto, con la cache de 30 s.
 *
 * NUNCA LANZA: lo que sale mal vuelve como `nota` (para la columna) y `aviso`
 * (para la barra), con la causa textual y la accion.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} proyecto
 * @param {any} diag lo que devolvio `diagnosticar`
 * @param {boolean} includeDone
 * @returns {Promise<{tickets: any[], nota: string|null, aviso: any|null}>}
 */
async function ticketsDe(p, proyecto, diag, includeDone) {
  const motor = p.estado.motor;
  const clave = `${proyecto.id}:${includeDone ? 1 : 0}`;
  const ahora = motor ? motor.reloj() : Date.now();
  const enCache = motor?.cacheDelBoard.get(clave);
  if (enCache && ahora - enCache.ts < motor.ttlDelBoardMs) return enCache.valor;

  const valor = await pedirTickets(p, proyecto, diag, includeDone);
  motor?.cacheDelBoard.set(clave, { ts: ahora, valor });
  return valor;
}

/**
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} proyecto
 * @param {any} diag
 * @param {boolean} includeDone
 */
async function pedirTickets(p, proyecto, diag, includeDone) {
  const gestor = diag.gestor;
  if (!gestor) {
    const hallado = diag.datos?.gestorHallado ?? "el proyecto no tiene gestor";
    return {
      tickets: [],
      nota: `Sin gestor de tickets: ${hallado}.`,
      aviso: {
        proyecto: proyecto.id,
        nivel: "aviso",
        causa: `El proyecto \`${proyecto.nombre}\` no tiene un gestor que el board pueda leer: ${hallado}.`,
        accion: "Conecta el gestor del proyecto en Settings del proyecto -> Conexiones.",
      },
    };
  }
  const mod = diag.modulo;
  if (!mod) {
    return {
      tickets: [],
      nota: `El proveedor \`${gestor.nombre}\` no esta disponible en esta instalacion.`,
      aviso: {
        proyecto: proyecto.id,
        nivel: "aviso",
        causa: `No se pudo cargar el proveedor \`${gestor.nombre}\` del motor, asi que el board no puede listar sus tickets.`,
        accion: "Reinstala la aplicacion o arranca el servicio desde el monorepo, donde viven los proveedores.",
      },
    };
  }

  const nombre = gestor.nombre;
  try {
    const env = await secretosDelGestor(p.dep, proyecto, gestor, mod.requiredEnv ?? [], "llamar_api");
    const ctx = {
      options: { ...(diag.opciones ?? gestor.opciones ?? {}), ...(gestor.stateMap ? { stateMap: gestor.stateMap } : {}) },
      identity: { assignee: null, mention: null },
      env,
      log: SILENCIO,
      fetch: globalThis.fetch,
    };
    const caps = typeof mod.capabilities === "function" ? mod.capabilities() : {};

    if (caps.listItems && typeof mod.listItems === "function") {
      const pagina = await mod.listItems({ limit: TICKETS_POR_PROYECTO, includeDone }, ctx);
      const tickets = Array.isArray(pagina?.items) ? pagina.items : [];
      const total = Number.isInteger(pagina?.total) ? pagina.total : null;
      let nota = null;
      if (total !== null && total > tickets.length) {
        nota = `Se muestran los primeros ${tickets.length} de ${total} tickets de \`${nombre}\`: hay ${total - tickets.length} mas en el gestor.`;
      } else if (pagina?.nextCursor) {
        nota = `Se muestran los primeros ${tickets.length} tickets de \`${nombre}\`: el gestor tiene mas y no dice cuantos.`;
      }
      return { tickets, nota, aviso: null };
    }

    // LA DEGRADACION DECLARADA (FR-011). Sin `listItems`, lo que el motor si
    // conoce: la bandeja del gestor (asignados y mencionados) y los runs. Y la
    // nota lo DICE, nombrando el proveedor y la capacidad: un board vacio sin
    // explicacion se lee como «no hay trabajo».
    /** @type {any[]} */
    let tickets = [];
    if ((caps.searchAssigned || caps.searchMentioned) && typeof mod.searchInbox === "function") {
      const bandeja = await mod.searchInbox(ctx);
      tickets = [...(bandeja?.assigned ?? []), ...(bandeja?.mentioned ?? [])]
        .filter(Boolean)
        .map((/** @type {any} */ t) => ({ ...t, canonicalState: t.canonicalState ?? "todo" }));
    }
    return {
      tickets,
      nota:
        `El gestor \`${nombre}\` no declara la capacidad \`listItems\`: se muestran los tickets que el motor ya ` +
        "conoce (asignados o mencionados en su bandeja, y los que tienen run).",
      aviso: null,
    };
  } catch (e) {
    const causa = e && e.causa ? e.causa : String(e?.message ?? e);
    return {
      tickets: [],
      nota: `El gestor \`${nombre}\` no contesto: ${causa}`,
      aviso: {
        proyecto: proyecto.id,
        nivel: "error",
        causa: `El gestor \`${nombre}\` del proyecto \`${proyecto.nombre}\` fallo al listar sus tickets: ${causa}`,
        accion:
          e && e.accion
            ? e.accion
            : "Revisa la conexion del gestor en Settings del proyecto -> Conexiones: reconectala o renueva su " +
              "credencial. Las tarjetas de los runs en disco se siguen mostrando mientras tanto.",
      },
    };
  }
}

/**
 * `GET /v1/board?project=<id>&includeDone=0|1`
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function board(p) {
  const pedido = p.url.searchParams.get("project");
  const includeDone = p.url.searchParams.get("includeDone") === "1";
  if (pedido) exigirProyecto(p.dep, pedido);

  const motor = p.estado.motor;
  const opcionesDelMotor = motor
    ? { raizDeProveedores: motor.raizDeProveedores, cargarGestor: motor.cargarGestor }
    : {};

  const proyectos = p.dep.almacen.base.consultar(
    "SELECT * FROM project WHERE workspace_id = ? ORDER BY nombre",
    [p.dep.workspace.id],
  );
  const { runs, avisos: avisosDeRuns } = runsConProyecto(p);

  /** @type {any[]} */
  const avisos = avisosDeRuns.map((a) => ({ proyecto: null, nivel: "aviso", causa: a.causa, accion: a.accion }));
  const partes = [];
  const lista = [];

  for (const proyecto of proyectos) {
    const activo = proyecto.estado === "ACTIVE";
    if (!activo) {
      // La lista lateral lo nombra con su estado —la interfaz ofrece terminar
      // de configurarlo— pero no pone tarjetas (escenario 5 de US1).
      const datos = datosDelProyecto(p.dep, proyecto, opcionesDelMotor);
      lista.push({
        id: proyecto.id,
        nombre: proyecto.nombre,
        estado: proyecto.estado,
        color: null,
        gestor: datos.gestor?.nombre ?? null,
        listItems: null,
      });
      if (pedido === proyecto.id) {
        avisos.push({
          proyecto: proyecto.id,
          nivel: "aviso",
          causa: `El proyecto \`${proyecto.nombre}\` esta en \`${proyecto.estado}\`: entra al board cuando llega a ACTIVE.`,
          accion: "Termina de configurarlo desde el asistente; el board del proyecto aparece al activarlo.",
        });
      }
      continue;
    }

    const diag = await diagnosticar(p.dep, proyecto, opcionesDelMotor);
    const caps = diag.modulo && typeof diag.modulo.capabilities === "function" ? diag.modulo.capabilities() : null;
    lista.push({
      id: proyecto.id,
      nombre: proyecto.nombre,
      estado: proyecto.estado,
      color: null,
      gestor: diag.gestor?.nombre ?? null,
      listItems: caps ? Boolean(caps.listItems && typeof diag.modulo.listItems === "function") : false,
    });
    if (pedido && pedido !== proyecto.id) continue;

    const { tickets, nota, aviso } = await ticketsDe(p, proyecto, diag, includeDone);
    if (aviso) avisos.push(aviso);

    partes.push({
      proyecto: { id: proyecto.id, nombre: proyecto.nombre },
      gestor: diag.gestor?.nombre ?? null,
      listItems: lista[lista.length - 1].listItems,
      tickets,
      runs: runs
        .filter((r) => r.proyecto && String(r.proyecto.id) === String(proyecto.id) && r.e)
        .map((r) => ({
          itemId: r.itemId,
          estado: /** @type {any} */ (r.e).estado,
          detalle: /** @type {any} */ (r.e).detalle,
          posicion: /** @type {any} */ (r.e).posicion,
          pr: r.run?.item?.pr ?? null,
          avance: avanceDe(r.run, /** @type {any} */ (r.e).estado),
          gasto: r.run ? gastoDe(r.run) : null,
          titulo: r.run?.item?.title ?? null,
          key: r.run?.item?.key ?? null,
          url: r.run?.item?.url ?? null,
        })),
      nota,
      lanzable: diag.lanzable,
      tieneRepo: diag.tieneRepo,
      motivo: diag.problema ? diag.problema.causa : null,
    });
  }

  return { cuerpo: construirBoard({ partes, includeDone, proyectos: lista, avisos }) };
}
