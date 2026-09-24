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
import { bloqueoPara, bloqueosParaElBoard } from "./diagnostico.mjs";
import { ejecutorDelProyecto, flotaDelProyecto, problemaDeEjecucion, resolverEjecutor } from "./ejecutor.mjs";
import { contextoDelGestor } from "./gestor.mjs";
import { datosDelProyecto, diagnosticar, secretosDelGestor } from "./motor.mjs";
import { estadosDeRuntimes } from "./runtimes.mjs";
import { ordenarTarjetas, ordenesDe } from "./orden.mjs";
import { runsConProyecto } from "./runs.mjs";
import { puertoDeTareas } from "./tareas.mjs";

/**
 * Las columnas, en el orden en que una persona las lee (FR-001, REVISADO el
 * 2026-09-24 sobre el referente Nodal). Backlog va primero porque la interfaz
 * la pinta plegada a la izquierda.
 *
 * POR QUE BLOQUEADO PASO DE CHIP A COLUMNA. La primera version decia «una
 * columna por cada forma de estar detenido parte el board en nueve». Sigue
 * siendo verdad para las nueve; no para UNA: lo que el motor ya no puede
 * avanzar sin el operador (bloqueado o fallido) es la pregunta que el operador
 * se hace al abrir el board, y enterrarlo en En curso con un chip ambar lo
 * mezclaba con lo que si esta corriendo. Los demas detenidos (en cola, plan
 * listo, permiso, criterios, interrumpido) siguen siendo chips en En curso.
 *
 * Y HECHO SALE SIEMPRE, con los ultimos cerrados: sin ella el operador no ve
 * que lo que lanzo ayer termino. Acotada (`HECHOS_POR_DEFECTO`) para que un
 * proyecto con quinientos tickets cerrados no entierre el resto.
 */
export const COLUMNAS = Object.freeze([
  { id: "backlog", titulo: "Backlog" },
  { id: "todo", titulo: "Todo" },
  { id: "in_progress", titulo: "En curso" },
  { id: "in_review", titulo: "En revisión" },
  { id: "blocked", titulo: "Bloqueado" },
  { id: "done", titulo: "Hecho" },
]);

/** Cuantos cerrados muestra Hecho sin `includeDone`: los mas recientes. */
export const HECHOS_POR_DEFECTO = 20;

/** El motivo del boton cuando el runtime del ejecutor no tiene con que invocar al modelo. */
export const MOTIVO_SIN_MODELO = "Conecta un modelo en Settings → Modelos";

/** Cuantos tickets se piden al gestor por proyecto. El resto se DICE, no se corta en silencio. */
export const TICKETS_POR_PROYECTO = 100;

/** Los estados de run que dejan la tarjeta en En curso: en vuelo, en cola o detenido esperando algo. */
const EN_CURSO = ["en_cola", "planificando", "corriendo", "plan_listo", "necesita_criterios", "necesita_permiso", "interrumpido"];

/** Los que la mandan a Bloqueado: el motor ya no la avanza sin el operador. */
const EN_BLOQUEADO = ["bloqueado", "fallido"];

/** De estado canonico del gestor a columna, cuando no hay run. */
const COLUMNA_DEL_GESTOR = Object.freeze({
  backlog: "backlog",
  todo: "todo",
  in_progress: "in_progress",
  blocked: "blocked",
  in_review: "in_review",
  done: "done",
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
 * El chip de una issue «movida» (spec 005, FR-004): tiene run en este proyecto
 * y ya no cumple sus reglas. `destino` es donde vive hoy en el gestor, o null
 * si el gestor no lo dice (y entonces no se inventa).
 *
 * @param {{destino: string|null, detalle: string}} movida
 */
function chipDeMovida(movida) {
  return {
    tipo: "movida",
    texto: movida.destino ? `Movida · ${movida.destino}` : "Movida",
    detalle: movida.detalle,
    posicion: null,
    destino: movida.destino,
  };
}

/**
 * La decision del operador que VALE para esta movida, o `null` (spec 005, US1
 * esc. 4). Una decision se tomo para un destino: si la issue se fue despues a
 * OTRO sitio, lo que se decidio ya no dice nada de esta movida y el chip vuelve
 * a preguntar. Sin destino guardado (el gestor no lo dijo al decidir), vale
 * para cualquiera: no hay con que compararla.
 *
 * @param {{decision: string, destino: string|null}|undefined|null} decision
 * @param {{destino: string|null}} movida
 */
function decisionQueVale(decision, movida) {
  if (!decision) return null;
  if (decision.destino !== null && decision.destino !== undefined && decision.destino !== movida.destino) return null;
  return decision;
}

/**
 * Quien ejecuta un ticket y como termina, resuelto en cascada (FR-031/032).
 * Solo una tarea LOCAL declara los suyos (en `raw`, que es de su proveedor);
 * un ticket de un gestor externo hereda del proyecto y termina en PR.
 *
 * @param {any} ticket
 * @param {any} parte
 */
export function ejecucionDeTarjeta(ticket, parte) {
  const propia = parte.gestor === "local" ? ticket?.raw ?? null : null;
  const ejecutor = resolverEjecutor(propia?.ejecutor ?? null, parte.ejecutorDelProyecto ?? null);
  const termino = typeof propia?.termino === "string" ? propia.termino : "pr";
  return { ejecutor, termino, clave: String(ticket?.key ?? ticket?.id ?? "") };
}

/**
 * Una tarjeta.
 *
 * @param {any} ticket el `ListedItem` del gestor, o uno sintetizado desde el run
 * @param {any} run el run derivado, o `null`
 * @param {any} parte
 * @param {Map<string, any>} runtimes el estado de cada runtime, si se sabe
 * @param {{destino: string|null, detalle: string}|null} [movida] si la issue salio de las reglas (spec 005, FR-004)
 */
function tarjetaDe(ticket, run, parte, runtimes, movida = null) {
  let columna;
  if (run && run.estado === "pr_abierto") columna = "in_review";
  else if (run && EN_BLOQUEADO.includes(run.estado)) columna = "blocked";
  else if (run && EN_CURSO.includes(run.estado)) columna = "in_progress";
  else {
    const canonico = ticket?.canonicalState ?? "todo";
    columna = /** @type {any} */ (COLUMNA_DEL_GESTOR)[canonico] ?? "todo";
  }

  // La accion principal: UNA (FR-005). Todas las que lanzan el motor —Run,
  // aprobar, reintentar— se deshabilitan con el MISMO motivo que la ruta daria
  // al pulsarlas: el boton dice que falta en vez de fallar. En orden: el
  // proyecto (sin repo, sin gate...), el ejecutor o el termino que el motor no
  // sabe cumplir, el runtime sin sesion ni key, y lo bloqueante del
  // diagnostico (spec 004, FR-003) que afecta a ESTE runtime: git ausente
  // apaga todo, la confianza de Claude Code solo lo que corre con Claude.
  const ejecucion = ejecucionDeTarjeta(ticket, parte);
  const tipo = run ? accionDelEstado(run.estado) : "run";
  const lanza = tipo === "run" || tipo === "approve" || tipo === "retry";
  let motivo = null;
  if (lanza) {
    if (!parte.lanzable) motivo = parte.motivo ?? "el proyecto no se puede lanzar";
    else {
      // Con el revisor de la flota: si el ejecutor de la tarea es su runtime,
      // Run se deshabilita con el motivo exacto con el que el lanzamiento lo
      // rechazaria (spec 005, FR-008) — la regla es `choqueConElRevisor`.
      const problema = problemaDeEjecucion({ ...ejecucion, revisor: parte.revisor ?? null });
      if (problema) motivo = problema.causa;
      else if (runtimes?.get(ejecucion.ejecutor.runtime)?.conectado === false) {
        const e = runtimes.get(ejecucion.ejecutor.runtime);
        motivo = `${MOTIVO_SIN_MODELO}: ${e.detalle ?? `${ejecucion.ejecutor.runtime} no tiene sesion ni API key`}.`;
      } else {
        const bloqueo = bloqueoPara(parte.bloqueos, ejecucion.ejecutor.runtime);
        if (bloqueo) motivo = bloqueo.motivo;
      }
    }
  }
  const accion = { tipo, habilitada: motivo === null, motivo };

  const quien = ticket?.assignee;
  return {
    id: `${parte.proyecto.id}:${ticket.id}`,
    proyecto: { id: parte.proyecto.id, nombre: parte.proyecto.nombre, color: null },
    // De donde viene el ticket: el nombre del proveedor (`local` para las
    // tareas propias, que la interfaz pinta con el chip «Local»).
    origen: parte.gestor ?? null,
    ejecutor: { runtime: ejecucion.ejecutor.runtime, agente: ejecucion.ejecutor.agente },
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
    // «Movida» (spec 005, FR-004) gana al chip del run: la columna y
    // `run.estado` siguen diciendo en que va el run, y lo que el operador NO
    // sabe es que la issue ya no es de este proyecto.
    chip: movida ? chipDeMovida(movida) : chipDe(run, ticket, parte),
    ...(movida ? { movida: { destino: movida.destino, detalle: movida.detalle } } : {}),
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
 *                  nota: string|null, lanzable: boolean, tieneRepo: boolean, motivo: string|null,
 *                  ejecutorDelProyecto?: {runtime: string, agente: null}|null,
 *                  revisor?: {runtime: string, nombre: string}|null,
 *                  movidas?: Map<string, {destino: string|null, detalle: string}>,
 *                  decisiones?: Map<string, {decision: "seguir"|"soltar", destino: string|null}>,
 *                  bloqueos?: import("./diagnostico.mjs").Problema[]}>,
 *   includeDone?: boolean,
 *   proyectos?: any[],
 *   avisos?: any[],
 *   runtimes?: Map<string, any>,
 * }} e
 */
export function construirBoard(e) {
  const includeDone = Boolean(e.includeDone);
  const runtimes = e.runtimes ?? new Map();
  /** @type {any[]} */
  let tarjetas = [];
  /** La fecha de cada tarjeta cerrada, para quedarse con las ultimas. */
  const cerradaEn = new Map();
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
      const tarjeta = tarjetaDe(t, porItem.get(id) ?? null, parte, runtimes);
      if (tarjeta.columna === "done") cerradaEn.set(tarjeta.id, String(t.updatedAt ?? ""));
      tarjetas.push(tarjeta);
    }
    // Los runs cuyo ticket el gestor no devolvio —porque se cayo, porque no
    // sabe listar, o porque el ticket ya no esta abierto— siguen en el board:
    // lo que hace el motor no depende de que el gestor conteste.
    for (const r of parte.runs) {
      const id = String(r.itemId);
      if (vistos.has(id)) continue;
      vistos.add(id);
      const sintetico = { id, key: r.key ?? null, title: r.titulo ?? null, url: r.url ?? null, canonicalState: "todo" };
      // «Movida» y lo que el operador decidio sobre ella (spec 005, US1 esc.
      // 4). `seguir`: la tarjeta se queda, con el chip de su run —sigue siendo
      // de este proyecto aunque ya no cumpla sus reglas—. `soltar`: deja de
      // pintarse AQUI; el run en disco no se toca (es del motor, y el board no
      // escribe), asi que sigue en `/v1/runs` y en la cola si estaba en ella.
      // Una decision solo se mira en una movida: una issue que vuelve a cumplir
      // las reglas entra por el bucle de arriba, y lo decidido no pinta nada.
      const movida = parte.movidas?.get(id) ?? null;
      const decision = movida ? decisionQueVale(parte.decisiones?.get(id), movida) : null;
      if (decision?.decision === "soltar") continue;
      tarjetas.push(tarjetaDe(sintetico, r, parte, runtimes, decision ? null : movida));
    }
  }

  // HECHO, ACOTADA: sin `includeDone`, los ultimos cerrados por fecha, y la
  // columna DICE cuantos hay de verdad. Cortar en silencio se lee como «no
  // hay mas», que es justo lo que SC-004 prohibe.
  let notaDeHechos = null;
  if (!includeDone) {
    const hechas = tarjetas
      .filter((t) => t.columna === "done")
      .sort((a, b) => String(cerradaEn.get(b.id) ?? "").localeCompare(String(cerradaEn.get(a.id) ?? "")));
    if (hechas.length > HECHOS_POR_DEFECTO) {
      const fuera = new Set(hechas.slice(HECHOS_POR_DEFECTO).map((t) => t.id));
      tarjetas = tarjetas.filter((t) => !fuera.has(t.id));
      notaDeHechos =
        `Se muestran los ${HECHOS_POR_DEFECTO} de ${hechas.length} cerrados mas recientes; ` +
        "«incluir terminados» (`includeDone=1`) los trae todos.";
    }
  }

  const nota = notas.length ? notas.join(" · ") : null;
  const columnas = COLUMNAS.map((c) => ({
    id: c.id,
    titulo: c.titulo,
    total: tarjetas.filter((t) => t.columna === c.id).length,
    // Backlog y Todo son las que salen del gestor: si esta incompleto, son
    // esas las que lo dicen. Hecho dice su propio corte.
    nota: c.id === "backlog" || c.id === "todo" ? nota : c.id === "done" ? notaDeHechos : null,
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
 * @returns {Promise<{tickets: any[], nota: string|null, aviso: any|null, completo?: boolean, movidas?: Map<string, any>}>}
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
      // EL GESTOR LOCAL, DENTRO DEL SERVICIO: recibe el almacen a traves de
      // la interfaz de tareas. Es la misma que usa por HTTP desde el motor, y
      // aqui no hace falta el viaje: el board ya corre en el unico escritor.
      ...(gestor.origen === "local" ? { tareas: puertoDeTareas(p.dep) } : {}),
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
      } else if (tickets.length === 0) {
        nota = notaDeReglas(ctx.options?.reglas, nombre);
      }
      // `completo`: el listado trae TODO lo que las reglas dejan pasar. Solo
      // entonces la ausencia de un ticket con run significa algo (FR-004).
      const completo = !pagina?.nextCursor && !(total !== null && total > tickets.length);
      return { tickets, nota, aviso: null, completo };
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
 * La nota de una regla de ruteo que no deja pasar nada (spec 005, FR-001,
 * borde), o null si el proyecto no declara reglas.
 *
 * LAS REGLAS SE NOMBRAN. «No hay tickets» y «tus reglas no dejan pasar ninguno»
 * piden cosas distintas —esperar trabajo o corregir un nombre de proyecto—, y
 * un board vacio sin explicacion se lee como lo primero. `reglas` es la opcion
 * que el proveedor declara en su `optionsSchema`; el servicio solo la lee para
 * poder decirla.
 *
 * @param {any} reglas
 * @param {string} nombre el proveedor
 */
function notaDeReglas(reglas, nombre) {
  if (!reglas || typeof reglas !== "object") return null;
  const partes = [];
  if (typeof reglas.proyecto === "string" && reglas.proyecto.trim()) partes.push(`proyecto «${reglas.proyecto.trim()}»`);
  const etiquetas = Array.isArray(reglas.etiquetas) ? reglas.etiquetas.filter((/** @type {any} */ e) => typeof e === "string" && e.trim()) : [];
  if (etiquetas.length) partes.push(`etiquetas ${etiquetas.map((/** @type {string} */ e) => `«${e}»`).join(" o ")}`);
  if (!partes.length) return null;
  return (
    `Las reglas de ruteo de este proyecto (${partes.join(" y ")}) no dejan pasar ningun ticket de \`${nombre}\`. ` +
    "Revisalas en Settings del proyecto → Gestor: un nombre de proyecto o de etiqueta tiene que coincidir exacto con el del gestor."
  );
}

/** Cuantas issues «movidas» se consultan al gestor por proyecto y pintada, como mucho. */
export const MOVIDAS_POR_PINTADA = 10;

/**
 * Las issues con run que ya no devuelve el listado del proyecto, consultadas
 * una por una con `getItem` (spec 005, FR-004). Devuelve `id → {destino,
 * detalle}` solo para las que siguen abiertas en el gestor.
 *
 * SIN ROMPER LA CACHE. Lo consultado se guarda DENTRO de la entrada de cache
 * del listado (`valor.movidas`): vence con ella a los 30 s y la invalida el
 * mismo `PATCH /tracker` que cambia las reglas. Asi una pintada no cuesta un
 * viaje por tarjeta, y cambiar las reglas no deja «movidas» viejas.
 *
 * SOLO CON EL LISTADO COMPLETO. Si el gestor corto la pagina, la issue puede
 * estar en la siguiente: afirmar que se movio seria inventarlo.
 *
 * NUNCA LANZA: una consulta que falla deja la tarjeta como estaba.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} proyecto
 * @param {any} diag
 * @param {any} valor la entrada del listado (cacheada)
 * @param {Array<{itemId: string, key?: string|null}>} candidatos
 * @returns {Promise<Map<string, {destino: string|null, detalle: string}>>}
 */
async function movidasDe(p, proyecto, diag, valor, candidatos) {
  /** @type {Map<string, {destino: string|null, detalle: string}|null>} */
  const sabidas = valor.movidas instanceof Map ? valor.movidas : new Map();
  valor.movidas = sabidas;
  const mod = diag.modulo;
  const faltan = candidatos.filter((c) => !sabidas.has(String(c.itemId))).slice(0, MOVIDAS_POR_PINTADA);
  if (faltan.length && valor.completo && mod && typeof mod.getItem === "function" && diag.gestor?.origen !== "local") {
    try {
      const ctx = await contextoDelGestor(p, proyecto, diag);
      for (const c of faltan) {
        const id = String(c.itemId);
        try {
          const item = await mod.getItem(id, ctx);
          // Borrada (null) o sin columna (cancelada, duplicada): no es una
          // movida, es una issue que ya no es trabajo.
          if (!item || !item.canonicalState) {
            sabidas.set(id, null);
            continue;
          }
          const destino = typeof item.project?.name === "string" && item.project.name ? item.project.name : null;
          const clave = item.key ?? c.key ?? id;
          sabidas.set(id, {
            destino,
            detalle:
              `${clave} ya no cumple las reglas de este proyecto` +
              (destino ? `: ahora esta en el proyecto «${destino}» de \`${diag.gestor.nombre}\`.` : ", y el gestor no dice adonde fue.") +
              " El run sigue aqui hasta su PR. Decide en la tarjeta: «Seguir aqui» la deja en este board sin este " +
              "aviso; «Soltarla» la quita de el (ni Linear ni el run se tocan). Para que vuelva a cumplirlas, " +
              "ajusta las reglas en Settings del proyecto → Gestor.",
          });
        } catch {
          sabidas.set(id, null);
        }
      }
    } catch {
      /* sin credencial no hay consulta: las tarjetas quedan como estaban */
    }
  }
  /** @type {Map<string, {destino: string|null, detalle: string}>} */
  const movidas = new Map();
  for (const c of candidatos) {
    const m = sabidas.get(String(c.itemId));
    if (m) movidas.set(String(c.itemId), m);
  }
  return movidas;
}

/**
 * `GET /v1/board?project=<id>&includeDone=0|1`
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function board(p) {
  const pedido = p.url.searchParams.get("project");
  const includeDone = p.url.searchParams.get("includeDone") === "1";
  // Al gestor se le piden SIEMPRE los cerrados: Hecho sale siempre (con los
  // ultimos, ver `construirBoard`). Lo que cambia con `includeDone` es cuantos
  // se muestran, no que se pidan. Una sola entrada de cache por proyecto.
  const pedirCerrados = true;
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

    const valorDelListado = await ticketsDe(p, proyecto, diag, pedirCerrados);
    const { tickets, nota, aviso } = valorDelListado;
    if (aviso) avisos.push(aviso);

    const runsDelProyecto = runs
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
      }));
    // Los runs cuyo ticket el listado (con las reglas) ya no trae: candidatos a
    // «movida» (spec 005, FR-004).
    const listados = new Set(tickets.map((/** @type {any} */ t) => String(t.id)));
    const fuera = runsDelProyecto.filter((r) => !listados.has(String(r.itemId)));
    const movidas = fuera.length ? await movidasDe(p, proyecto, diag, valorDelListado, fuera) : new Map();

    partes.push({
      proyecto: { id: proyecto.id, nombre: proyecto.nombre },
      gestor: diag.gestor?.nombre ?? null,
      listItems: lista[lista.length - 1].listItems,
      tickets,
      runs: runsDelProyecto,
      movidas,
      // Lo que el operador decidio sobre sus movidas (spec 005, US1 esc. 4).
      // Solo se LEE: pintar no escribe (SC-007), y por eso una decision que ya
      // no aplica no se borra aqui (la olvida quien escribe: ver `movidas.mjs`).
      decisiones: p.dep.almacen.movidas.delProyecto(String(proyecto.id)),
      nota,
      lanzable: diag.lanzable,
      tieneRepo: diag.tieneRepo,
      motivo: diag.problema ? diag.problema.causa : null,
      ejecutorDelProyecto: ejecutorDelProyecto(p.dep, proyecto.id),
      revisor: flotaDelProyecto(p.dep, proyecto.id).revisor,
    });
  }

  // El estado de los runtimes que las tarjetas van a usar, UNA pregunta por
  // runtime (con la cache del board): sin sesion ni key, Run se deshabilita
  // con el motivo en vez de lanzar un motor que muere en la primera fase.
  const usados = new Set();
  for (const parte of partes) {
    for (const t of parte.tickets) usados.add(ejecucionDeTarjeta(t, parte).ejecutor.runtime);
    usados.add(resolverEjecutor(null, parte.ejecutorDelProyecto).runtime);
  }
  const runtimes = await estadosDeRuntimes(p, [...usados]);

  // Lo bloqueante del diagnostico, por proyecto, con su cache: sin ella cada
  // pintada lanzaria `git --version` y compañia.
  const bloqueos = await bloqueosParaElBoard(
    p,
    partes.map((parte) => proyectos.find((x) => String(x.id) === String(parte.proyecto.id))).filter(Boolean),
  );
  for (const parte of partes) /** @type {any} */ (parte).bloqueos = bloqueos.get(String(parte.proyecto.id)) ?? [];

  const cuerpo = construirBoard({ partes, includeDone, proyectos: lista, avisos, runtimes });
  // El orden a mano de cada columna (spec 005, FR-005), del almacen: lo
  // ordenado primero, lo demas en el orden del gestor. Solo lee.
  cuerpo.tarjetas = ordenarTarjetas(cuerpo.tarjetas, ordenesDe(p.dep, partes.map((x) => String(x.proyecto.id))));
  return { cuerpo };
}
