// Invocar al modelo: una fase = una sesion.
//
// LA INVERSION DE CONTROL. Antes el modelo manejaba y llamaba al harness. Aca
// el harness maneja y llama al modelo: cada fase recibe un contexto acotado
// —una tarea, un worktree— y quien decide si avanzar es el motor mirando
// codigos de salida y estado en disco, nunca la prosa que vuelve.
//
// EL DESPERDICIO QUE ESTE MODULO EXISTE PARA CORREGIR. En el harness anterior,
// cada fase arrancaba un proceso y un contexto frios: 133 invocaciones, 14,5
// min y $5,59 de media. El adaptador ya soportaba retomar la sesion y ninguno
// de sus puntos de invocacion lo usaba, asi que cada fase reconstruia desde
// cero el prompt de sistema, las skills, los agentes y el esquema de
// herramientas. Con 14 minutos entre invocaciones el cache de prompt nunca
// llega a servir. Aca `resume` es parte de la firma y el driver lo pasa.
//
// SESION NUEVA ENTRE TAREAS, RETOMADA ENTRE FASES. La distincion es
// deliberada: retomar dentro de la tarea reusa el contexto que sirve, y abrir
// sesion nueva entre tareas evita la degradacion por compactacion que se
// observo al cerrar 14 tareas en un solo contexto — las cuatro ultimas abrieron
// PR con los contadores en cero.
//
// LO QUE NO HACE. No decide nada: no reintenta, no baja el modelo, no parte la
// tarea. Devuelve un hecho y el motor decide.

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const PAQUETE = "@anthropic-ai/claude-agent-sdk";

let motivoNoDisponible = null;

/**
 * Sincrona a proposito, aunque la carga real sea asincrona: el motor elige el
 * camino con un `if`, y una funcion que devolviera una Promise siempre seria
 * truthy si alguien olvida el `await`. Ese olvido no falla — elige el SDK y
 * explota adentro.
 */
export function sdkAvailable() {
  try {
    createRequire(import.meta.url).resolve(PAQUETE);
    return true;
  } catch (e) {
    motivoNoDisponible = e?.message || String(e);
    return false;
  }
}

export function sdkUnavailableReason() {
  return motivoNoDisponible;
}

/**
 * Traduce UN mensaje del stream a eventos para la bitacora.
 *
 * Vive aparte de la reduccion para que el bucle no tenga que entender el
 * formato, y para poder probarla sin correr una sesion.
 *
 * @returns {Array<{tipo: string, detalle?: object}>}
 */
export function progressEvents(mensaje) {
  if (!mensaje || typeof mensaje !== "object") return [];
  const eventos = [];

  if (mensaje.type === "system" && mensaje.subtype === "init") {
    eventos.push({
      tipo: "init",
      detalle: { sessionId: mensaje.session_id ?? null, model: mensaje.model ?? null },
    });
  }

  if (mensaje.type === "assistant") {
    for (const bloque of mensaje.message?.content || []) {
      if (bloque?.type === "tool_use") {
        eventos.push({ tipo: "tool_use", detalle: { nombre: bloque.name, id: bloque.id, entrada: bloque.input } });
      }
    }
  }

  if (mensaje.type === "result") {
    eventos.push({
      tipo: "result",
      detalle: { subtype: mensaje.subtype ?? null, isError: mensaje.is_error === true, usd: mensaje.total_cost_usd ?? null },
    });
  }

  return eventos;
}

/**
 * Consume el stream de una sesion y lo reduce a un hecho.
 *
 * @param {AsyncIterable<object>} mensajes
 * @param {{onProgress?: (e: object) => void}} [opts]
 */
export async function reduceMessages(mensajes, opts = {}) {
  const t0 = Date.now();
  let sessionId = null;
  let texto = "";
  let parcial = "";
  let final = null;

  for await (const m of mensajes) {
    for (const e of progressEvents(m)) {
      if (e.tipo === "init" && e.detalle.sessionId) {
        // El id del init MANDA, tambien cuando se pidio retomar: con una
        // bifurcacion viene uno nuevo, y quedarse con el viejo perderia la
        // bifurcacion entera.
        sessionId = e.detalle.sessionId;
      }
      if (opts.onProgress && e.tipo !== "result") opts.onProgress(e);
    }

    // El texto parcial sale SOLO del stream_event. Con los mensajes completos
    // llegan las dos formas y el mismo parrafo se acumularia dos veces.
    if (m?.type === "stream_event" && m.event?.delta?.type === "text_delta") {
      parcial += m.event.delta.text || "";
    }
    if (m?.type === "result") {
      final = m;
      if (m.session_id) sessionId = m.session_id;
      texto = m.result || "";
    }
  }

  const segundos = Math.round((Date.now() - t0) / 1000);

  if (!final) {
    // Un stream que termina sin `result` NO se da por bueno. Es el caso de un
    // proceso matado o una conexion cortada, y darlo por exitoso seria
    // exactamente el verde inventado.
    return {
      ok: false, sessionId, budgetExhausted: false, isError: true, subtype: "stream_incompleto",
      turns: 0, usd: null, segundos, text: texto || parcial || "el stream termino sin resultado", via: null,
    };
  }

  const subtype = typeof final.subtype === "string" ? final.subtype : null;
  const budgetExhausted = typeof subtype === "string" && subtype.toLowerCase().includes("budget");
  const isError = final.is_error === true;

  return {
    ok: !isError && !budgetExhausted,
    sessionId,
    budgetExhausted,
    isError,
    subtype,
    turns: final.num_turns ?? 0,
    usd: final.total_cost_usd ?? null,
    segundos,
    text: texto || parcial || "",
    via: null,
  };
}

/**
 * Las herramientas que una fase puede usar sin que nadie apruebe nada.
 *
 * HACE FALTA porque auto-aceptar ediciones de archivo no alcanza: las
 * herramientas MCP siguen pidiendo permiso, y en una sesion headless no hay
 * quien lo conceda — el primer intento del harness anterior murio en 73s
 * pidiendo permiso para leer un work item.
 *
 * POR QUE ES SEGURO Y NO SE APAGAN LOS PERMISOS ENTEROS: los hooks son una capa
 * distinta y corren igual. El limite de autonomia nunca vino del prompt de
 * permisos — viene de los hooks — y una lista explicita es preferible, porque
 * lo que no este en ella sigue requiriendo aprobacion.
 */
export const DEFAULT_ALLOWED_TOOLS = [
  "Bash", "Read", "Write", "Edit", "MultiEdit", "Grep", "Glob", "Task", "Skill", "TodoWrite", "WebFetch",
];

/**
 * @param {{
 *   prompt: string, cwd: string, model?: string, effort?: string,
 *   allowedTools?: string[], maxTurns?: number, resume?: string, fork?: boolean,
 *   addDirs?: string[], timeoutMs?: number, onProgress?: (e: object) => void, log?: object,
 *   maxCostUsd?: number
 * }} opts
 * @param {{transport?: Function, via?: string}} [inject] el transporte se
 *   inyecta para poder probar la reduccion y el enrutado sin una sesion real.
 */
export async function runPhase(opts, inject = {}) {
  const via = inject.via || (inject.transport ? "inyectado" : sdkAvailable() ? "agent-sdk" : "cli");
  const transporte = inject.transport || (via === "agent-sdk" ? transporteSdk : transporteCli);

  // `fork` sin `resume` no significa nada: bifurcar de ninguna sesion es abrir
  // una nueva, y mandarlo confunde la lectura de la bitacora.
  const parametros = {
    prompt: opts.prompt,
    cwd: opts.cwd,
    model: opts.model || null,
    effort: opts.effort || null,
    allowedTools: opts.allowedTools || DEFAULT_ALLOWED_TOOLS,
    maxTurns: opts.maxTurns ?? null,
    resume: opts.resume || null,
    fork: Boolean(opts.resume && opts.fork),
    addDirs: opts.addDirs || [],
    timeoutMs: opts.timeoutMs ?? 30 * 60_000,
  };
  // `maxCostUsd` se acepta en la firma y NO se propaga a proposito: el techo es
  // por hito. Que llegue hasta aca y muera aca es lo que hace que un llamador
  // que lo pase no crea que funciono.

  try {
    const mensajes = await transporte(parametros);
    const r = await reduceMessages(mensajes, { onProgress: opts.onProgress });
    return { ...r, via };
  } catch (e) {
    return {
      ok: false, sessionId: null, budgetExhausted: false, isError: true, subtype: "transporte_fallo",
      turns: 0, usd: null, segundos: 0, text: e?.message || String(e), via,
    };
  }
}

// ------------------------------------------------------------ transportes

async function transporteSdk(p) {
  const { query } = await import(PAQUETE);
  const options = {
    cwd: p.cwd,
    permissionMode: "acceptEdits",
    allowedTools: p.allowedTools,
    includePartialMessages: true,
  };
  if (p.model) options.model = p.model;
  // No todos los modelos soportan `effort`; el que no, lo degrada en silencio.
  if (p.effort) options.effort = p.effort;
  if (p.maxTurns != null) options.maxTurns = p.maxTurns;
  if (p.resume) options.resume = p.resume;
  if (p.resume && p.fork) options.forkSession = true;
  if (p.addDirs.length) options.additionalDirectories = p.addDirs;

  return query({ prompt: p.prompt, options });
}

/**
 * El camino degradado. Existe para que alguien que clona el repositorio pueda
 * correr algo antes de instalar nada — y lo DICE, porque no es equivalente:
 * cada fase arranca un proceso y un contexto frios, y no hay sesion que
 * retomar.
 */
async function transporteCli(p) {
  const args = [
    "-p", p.prompt,
    "--output-format", "json",
    "--permission-mode", "acceptEdits",
    "--allowedTools", p.allowedTools.join(" "),
  ];
  if (p.model) args.push("--model", p.model);
  if (p.resume) args.push("--resume", p.resume);
  for (const d of p.addDirs) args.push("--add-dir", d);

  const r = spawnSync("claude", args, {
    cwd: p.cwd,
    encoding: "utf8",
    timeout: p.timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: "1" },
  });

  let parseado = null;
  try {
    parseado = JSON.parse(r.stdout || "null");
  } catch { /* salida no-JSON: se reporta como stream incompleto */ }

  const mensajes = [];
  if (parseado) {
    mensajes.push({ type: "system", subtype: "init", session_id: parseado.session_id ?? null, model: p.model });
    mensajes.push({
      type: "result",
      subtype: parseado.subtype ?? (r.status === 0 ? "success" : "error"),
      is_error: parseado.is_error === true || r.status !== 0,
      session_id: parseado.session_id ?? null,
      num_turns: parseado.num_turns ?? 0,
      total_cost_usd: parseado.total_cost_usd ?? null,
      result: parseado.result ?? "",
    });
  }
  return (async function* () { for (const m of mensajes) yield m; })();
}
