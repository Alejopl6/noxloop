// El read-model del board de control: NOXLOOP_HOME -> una vista de kanban.
//
// POR QUE ES UN MODULO APARTE Y PURO. El board responde una pregunta que el
// motor no se hace nunca: "de todo lo que hay, que me necesita a MI". Eso es
// derivacion, no estado, y mezclarlo con state.mjs habria agregado campos que
// nadie escribe desde el driver. Aca se deriva de lo que ya esta en disco.
//
// POR QUE NO ESCRIBE. state.mjs es el unico escritor del estado de una tarea, y
// eso es lo que hace que las transiciones guardadas sirvan. Un board con
// permiso de escritura seria un segundo escritor: la carrera que se cerro con
// `conEstadoFresco` volveria por la puerta de atras. Hay un test que mide el
// disco antes y despues de construir el board.
//
// POR QUE NUNCA LANZA. Una persona abre el board cuando algo ya se rompio. Si
// un JSON corrupto lo tumba, desaparece justo cuando hace falta. Todo fallo de
// lectura baja a un aviso VISIBLE — que es distinto de tragarselo.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Las columnas, en el orden en que una persona las lee. */
export const COLUMNAS = [
  { id: "pending", titulo: "Por empezar" },
  { id: "running", titulo: "En curso" },
  { id: "pr_open", titulo: "Con PR abierto" },
  { id: "integrated", titulo: "Integrado" },
  { id: "blocked", titulo: "Bloqueado" },
];

/** Estados de tarea que cuentan como "algo esta pasando ahora". */
const EN_VUELO = ["in_progress", "red", "green", "gated", "reviewed", "queued"];

/** Media hora sin tocar un lock ya amerita mirarlo. */
const MAX_EDAD_LOCK_MS = 30 * 60 * 1000;

function leerJson(ruta) {
  return JSON.parse(readFileSync(ruta, "utf8"));
}

function listar(dir, patron) {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter((f) => patron.test(f));
  } catch {
    return [];
  }
}

/**
 * En que columna cae un item. Se DERIVA del estado de sus tareas en vez de
 * confiar en un campo, porque el campo puede quedar atras de la realidad y la
 * pregunta del board es precisamente cual es la realidad.
 */
export function columnaDeItem(run) {
  const it = run.item || {};
  if (it.pr) return "pr_open";

  const tareas = Array.isArray(run.tasks) ? run.tasks : [];
  if (!tareas.length) return "pending";

  if (tareas.every((t) => t.status === "integrated")) return "integrated";
  if (tareas.some((t) => EN_VUELO.includes(t.status))) return "running";

  // Bloqueado solo si NO queda nada por intentar. Una tarea bloqueada con otra
  // que todavia puede correr no es un item bloqueado: es uno en curso al que le
  // falta una parte, y mandarlo a "blocked" esconderia el trabajo que avanza.
  const hayBloqueada = tareas.some((t) => t.status === "blocked");
  const hayPorHacer = tareas.some((t) => t.status === "pending");
  if (hayBloqueada && !hayPorHacer) return "blocked";
  return "pending";
}

function motivoDeTarea(t) {
  const f = t.lastFailure;
  if (!f) return "se bloqueo sin registrar la causa";
  if (typeof f === "string") return f;
  return [f.loop && `[${f.loop}]`, f.message || f.reason].filter(Boolean).join(" ") || "se bloqueo sin registrar la causa";
}

function tarjetaDeRun(run, activasDelItem) {
  const it = run.item || {};
  const tareas = Array.isArray(run.tasks) ? run.tasks : [];

  const porEstado = {};
  for (const t of tareas) porEstado[t.status] = (porEstado[t.status] || 0) + 1;

  const integradas = porEstado.integrated || 0;

  return {
    itemId: it.id,
    titulo: it.title || it.id,
    provider: it.provider || null,
    url: it.url || null,
    hitoId: run.milestoneId || null,
    estado: columnaDeItem(run),
    // `avance` se mide SOLO sobre integradas. Contar "reviewed" como avance es
    // exactamente el verde inventado que el proyecto existe para no producir.
    avance: tareas.length ? Math.round((integradas / tareas.length) * 100) : 0,
    rama: it.branch || null,
    pr: it.pr || null,
    esperandoRespuesta: Boolean(it.esperandoRespuesta),
    pregunta: it.pregunta || null,
    tareas: {
      total: tareas.length,
      porEstado,
      activas: activasDelItem,
      bloqueadas: tareas.filter((t) => t.status === "blocked").map((t) => ({ id: t.id, titulo: t.title || t.id, motivo: motivoDeTarea(t) })),
    },
    gasto: { usd: (run.spent && run.spent.usd) || 0, calls: (run.spent && run.spent.calls) || 0 },
    creado: run.createdAt || null,
    actualizado: run.updatedAt || null,
    origen: "run",
  };
}

/**
 * @param {{home: string, ahora?: Date, maxEdadLockMs?: number}} opts
 * @returns {{columnas: Array, tarjetas: Array, omitidos: Array, necesitanRespuesta: Array, avisos: Array, totales: object}}
 */
export function construirBoard(opts) {
  const home = opts.home;
  const ahora = opts.ahora ? new Date(opts.ahora) : new Date();
  const maxEdadLock = opts.maxEdadLockMs || MAX_EDAD_LOCK_MS;
  const avisos = [];

  // ---- tareas activas (punteros por worktree)
  const activas = [];
  for (const f of listar(join(home, "active-tasks"), /\.json$/)) {
    try {
      activas.push(leerJson(join(home, "active-tasks", f)));
    } catch {
      avisos.push({ nivel: "warn", mensaje: `el puntero de tarea activa ${f} no se pudo leer` });
    }
  }

  // ---- recorridos
  const tarjetas = [];
  const vistos = new Set();
  for (const f of listar(join(home, "runs"), /^run-.+\.json$/)) {
    const id = f.replace(/^run-|\.json$/g, "");
    let run = null;
    try {
      run = leerJson(join(home, "runs", f));
    } catch (e) {
      avisos.push({ nivel: "error", itemId: id, mensaje: `el recorrido de ${id} esta corrupto y no se pudo leer: ${e.message}` });
      continue;
    }
    if (!run || !run.item || !run.item.id) {
      avisos.push({ nivel: "error", itemId: id, mensaje: `el recorrido de ${id} no tiene item: no se puede mostrar` });
      continue;
    }
    vistos.add(run.item.id);
    tarjetas.push(tarjetaDeRun(run, activas.filter((a) => a.itemId === run.item.id)));
  }

  // ---- hitos: los items APROBADOS que todavia no tienen recorrido tambien son
  // trabajo pendiente. Sin esto el board solo mostraria lo ya empezado, que es
  // justo la mitad que no sirve para decidir que sigue.
  for (const f of listar(join(home, "milestones"), /^milestone-.+\.json$/)) {
    let m = null;
    try {
      m = leerJson(join(home, "milestones", f));
    } catch (e) {
      avisos.push({ nivel: "error", mensaje: `el hito ${f} esta corrupto y no se pudo leer: ${e.message}` });
      continue;
    }
    const hitoId = (m.item && m.item.id) || f.replace(/^milestone-|\.json$/g, "");
    for (const it of m.items || []) {
      if (!it || !it.id || vistos.has(it.id)) continue;
      vistos.add(it.id);
      tarjetas.push({
        itemId: it.id,
        titulo: it.title || it.id,
        provider: (m.item && m.item.provider) || null,
        url: it.url || null,
        hitoId,
        estado: COLUMNAS.some((c) => c.id === it.status) ? it.status : "pending",
        avance: it.status === "integrated" ? 100 : 0,
        rama: it.branch || null,
        pr: it.pr || null,
        esperandoRespuesta: Boolean(it.esperandoRespuesta),
        pregunta: it.reason || null,
        tareas: { total: 0, porEstado: {}, activas: [], bloqueadas: [] },
        gasto: { usd: 0, calls: 0 },
        creado: null,
        actualizado: null,
        origen: "hito",
      });
    }
  }

  // ---- la bandeja: tickets que el motor RECHAZO.
  //
  // POR QUE SE LEE EL ARCHIVO A MANO en vez de usar `leerMemoria`. Esa funcion
  // se traga una memoria ilegible y devuelve vacia a proposito: el daemon no
  // puede dejar de arrancar por un archivo que es una ayuda. El board tiene el
  // deber opuesto — decir que no pudo leerla.
  const omitidos = [];
  const fMem = join(home, "inbox", "omitidos.json");
  if (existsSync(fMem)) {
    let mem = null;
    try {
      mem = leerJson(fMem);
    } catch (e) {
      avisos.push({ nivel: "warn", mensaje: `la memoria de la bandeja (inbox/omitidos.json) no se pudo leer: ${e.message}` });
    }
    for (const [id, entrada] of Object.entries((mem && mem.items) || {})) {
      // Con recorrido ya abierto el motivo viejo no describe la realidad: el
      // motor mismo llama a `olvidar` en ese caso, y mostrarlo seria contar dos
      // veces el mismo ticket.
      if (vistos.has(id)) continue;
      omitidos.push({
        itemId: id,
        motivo: String((entrada && entrada.motivo) || "").trim() || "omitido sin motivo registrado",
        clase: (entrada && entrada.clase) || "transitorio",
        desde: (entrada && entrada.desde) || null,
        ultimaVez: (entrada && entrada.ultimaVez) || null,
        veces: (entrada && entrada.veces) || null,
      });
    }
  }

  // ---- punteros activos que apuntan a la nada
  for (const a of activas) {
    if (a && a.itemId && !vistos.has(a.itemId)) {
      avisos.push({
        nivel: "warn",
        itemId: a.itemId,
        mensaje: `hay una tarea activa para ${a.itemId} pero no existe su recorrido: el puntero quedo huerfano${a.worktree ? ` (worktree ${a.worktree})` : ""}`,
      });
    }
  }

  // ---- locks viejos
  for (const f of listar(join(home, "locks"), /\.json$/)) {
    const nombre = f.replace(/\.json$/, "");
    let l = null;
    try {
      l = leerJson(join(home, "locks", f));
    } catch {
      avisos.push({ nivel: "warn", mensaje: `el lock ${nombre} no se pudo leer` });
      continue;
    }
    const desde = l && l.since ? Date.parse(l.since) : NaN;
    if (Number.isNaN(desde)) continue;
    const edad = ahora.getTime() - desde;
    if (edad > maxEdadLock) {
      const min = Math.round(edad / 60000);
      avisos.push({
        nivel: "warn",
        mensaje: `el lock ${nombre} lleva ${min} min tomado por ${l.host || "?"}/${l.pid || "?"}: puede ser huerfano`,
      });
    }
  }

  // ---- columnas
  const columnas = COLUMNAS.map((c) => ({ ...c, tarjetas: tarjetas.filter((t) => t.estado === c.id) }));

  const necesitanRespuesta = [
    ...tarjetas
      .filter((t) => t.esperandoRespuesta)
      .map((t) => ({
        itemId: t.itemId,
        titulo: t.titulo,
        // Esperar sin pregunta registrada es un fallo del motor, y el board lo
        // dice en vez de mostrar una tarjeta muda que nadie sabe como destrabar.
        pregunta: t.pregunta || "quedo esperando una respuesta pero no se registro la pregunta",
        desde: t.actualizado,
        origen: t.origen,
      })),
    // Un rechazo PERMANENTE es una pregunta a una persona: el motor ya decidio
    // que reintentarlo llega al mismo lugar. Un transitorio no va aca — se
    // reintenta solo, y meterlo pediria atencion para algo que se arregla sin
    // nadie.
    ...omitidos
      .filter((o) => o.clase === "permanente")
      .map((o) => ({ itemId: o.itemId, titulo: o.itemId, pregunta: o.motivo, desde: o.ultimaVez, origen: "bandeja" })),
    // DERIVADO: un recorrido que agoto todo sin integrar NADA necesita una
    // persona, y ningun campo del estado lo dice. Se deriva en vez de agregar
    // el campo porque un campo que nadie escribe es peor que no tenerlo: el
    // board mostraria cero y se veria igual que "todo en orden".
    //
    // Las tres exclusiones son deliberadas: con algo integrado hay trabajo que
    // sirve, con algo pendiente no agoto nada, y con el PR abierto ya esta en
    // manos de alguien.
    ...tarjetas
      .filter((t) => t.origen === "run" && t.estado === "blocked" && !(t.tareas.porEstado.integrated > 0))
      .map((t) => ({
        itemId: t.itemId,
        titulo: t.titulo,
        // Las causas van TEXTUALES y todas. Resumirlas a "fallo el gate" es el
        // mismo fallo que el motor prohibe en una tarea.
        pregunta:
          `agoto el presupuesto sin integrar nada. Lo que paso en cada tarea:\n` +
          t.tareas.bloqueadas.map((b) => `  - ${b.id}: ${b.motivo}`).join("\n"),
        desde: t.actualizado,
        origen: "derivado",
      })),
  ]
    // El campo explicito gana sobre la derivacion: si alguien registro LA
    // pregunta, pedir ademas la version derivada haria que una persona vea dos
    // tarjetas del mismo item y no sepa cual contestar.
    .filter((n, i, todas) => todas.findIndex((o) => o.itemId === n.itemId) === i);

  return {
    columnas,
    tarjetas,
    omitidos,
    necesitanRespuesta,
    avisos,
    totales: {
      items: tarjetas.length,
      porColumna: Object.fromEntries(columnas.map((c) => [c.id, c.tarjetas.length])),
      tareasActivas: activas.length,
      omitidos: omitidos.length,
      gastoUsd: Number(tarjetas.reduce((n, t) => n + t.gasto.usd, 0).toFixed(4)),
    },
  };
}
