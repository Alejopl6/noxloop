// Leer lo que un runtime dejo en stdout, y NADA MAS.
//
// LO QUE ESTE MODULO NO HACE, Y ES EL PUNTO. No decide si la fase paso. Lee los
// campos que el runtime declara —sesion, coste, subtipo, texto— y los devuelve.
// Quien decide si una fase paso es el gate, por exit code. Un adaptador que
// interpretara la prosa para devolver `ok: true` reintroduciria el verde
// inventado por la puerta de atras: el fallo que el principio II nombra, que es
// peor que un rojo porque un rojo se arregla y un verde falso se mergea.
//
// UN STREAM QUE TERMINA SIN RESULTADO NO SE DA POR BUENO. Es el caso de un
// proceso matado o una conexion cortada, y darlo por exitoso es exactamente el
// verde inventado. Se devuelve `null` y el adaptador lo trata como fase sin
// veredicto.

import { tokensDeUsoClaude } from "./eventos.mjs";

/**
 * @typedef {object} ResultadoCrudo
 * @property {string|null} sessionId
 * @property {boolean} isError
 * @property {string|null} subtype
 * @property {number|null} usd
 * @property {string} texto
 * @property {import("./contrato.mjs").TokensDeInvocacion} [tokens] solo si el runtime los reporto
 */

/**
 * La forma que emite `--output-format json`: un solo objeto.
 *
 * @param {string} stdout
 * @returns {ResultadoCrudo|null}
 */
export function leerResultadoJson(stdout) {
  let parseado;
  try {
    parseado = JSON.parse(String(stdout || "").trim() || "null");
  } catch {
    return null;
  }
  if (!parseado || typeof parseado !== "object") return null;

  return deObjetoDeResultado(parseado);
}

/** @param {any} parseado @returns {ResultadoCrudo} */
function deObjetoDeResultado(parseado) {
  const subtype = typeof parseado.subtype === "string" ? parseado.subtype : null;
  const tokens = tokensDeUsoClaude(parseado.usage);
  return {
    sessionId: typeof parseado.session_id === "string" ? parseado.session_id : null,
    isError: parseado.is_error === true,
    subtype,
    usd: typeof parseado.total_cost_usd === "number" ? parseado.total_cost_usd : null,
    texto: typeof parseado.result === "string" ? parseado.result : "",
    ...(tokens ? { tokens } : {}),
  };
}

/**
 * La forma `stream-json`: un mensaje por linea y el resultado en el ULTIMO con
 * `type: "result"`. Acepta tambien el objeto suelto de `--output-format json`,
 * que es un stream de una sola linea sin `type`.
 *
 * Como en `leerResultadoJsonl`, las lineas que no parsean se ignoran y la
 * AUSENCIA del resultado devuelve null: un stream cortado no es un exito.
 *
 * @param {string} stdout
 * @returns {ResultadoCrudo|null}
 */
export function leerResultadoStreamJson(stdout) {
  // El objeto suelto solo cuenta si ES un resultado: una sola linea con un
  // mensaje del asistente no es el final de nada.
  const unaLinea = String(stdout || "").trim();
  if (!unaLinea.includes("\n")) {
    try {
      const p = JSON.parse(unaLinea || "null");
      if (p && typeof p === "object" && (p.type === undefined || p.type === "result")) return deObjetoDeResultado(p);
    } catch {
      /* no es un objeto suelto: se lee como stream */
    }
  }
  let ultimo = null;
  for (const linea of String(stdout || "").split("\n")) {
    const t = linea.trim();
    if (!t.startsWith("{")) continue;
    try {
      const ev = JSON.parse(t);
      if (ev && typeof ev === "object" && ev.type === "result") ultimo = ev;
    } catch {
      /* ruido entre eventos: ver la cabecera */
    }
  }
  return ultimo ? deObjetoDeResultado(ultimo) : null;
}

/**
 * La forma que emiten los runtimes que sacan un evento por linea.
 *
 * SE IGNORAN LAS LINEAS QUE NO PARSEAN en vez de abortar: un runtime que mezcla
 * una advertencia en texto plano con su stream de eventos es comun, y tirar todo
 * el resultado por una linea de ruido convierte una fase util en una fase
 * perdida. Lo que no se puede ignorar es la AUSENCIA del evento final, y eso si
 * devuelve null.
 *
 * @param {string} stdout
 * @returns {ResultadoCrudo|null}
 */
export function leerResultadoJsonl(stdout) {
  /** @type {string[]} */
  const mensajes = [];
  let sessionId = null;
  let cerrado = false;
  let isError = false;
  let subtype = null;

  for (const linea of String(stdout || "").split("\n")) {
    const t = linea.trim();
    if (!t) continue;
    /** @type {any} */
    let ev;
    try {
      ev = JSON.parse(t);
    } catch {
      continue;
    }
    if (!ev || typeof ev !== "object") continue;

    if (typeof ev.session_id === "string") sessionId = ev.session_id;
    if (ev.type === "thread.started" && typeof ev.thread_id === "string") sessionId = ev.thread_id;
    if (ev.type === "item.completed" && ev.item?.type === "agent_message" && typeof ev.item.text === "string") {
      mensajes.push(ev.item.text);
    }
    if (ev.type === "turn.completed") cerrado = true;
    if (ev.type === "turn.failed" || ev.type === "error") {
      cerrado = true;
      isError = true;
      subtype = typeof ev.error?.message === "string" ? "turn.failed" : "error";
      if (typeof ev.error?.message === "string") mensajes.push(ev.error.message);
    }
  }

  if (!cerrado && mensajes.length === 0) return null;
  return {
    sessionId,
    isError,
    subtype,
    // Sin campo de coste en el protocolo: null, no cero. El adaptador que lo
    // consume declara `cost: false` y el techo de USD se desactiva diciendolo.
    usd: null,
    texto: mensajes.join("\n\n"),
  };
}

/**
 * Si el subtipo que devolvio el runtime dice que se quedo sin presupuesto.
 *
 * El driver YA sabe tratar eso como un corte de presupuesto y no como un fallo
 * del codigo — que es lo correcto: la tarea no esta mal, se quedo sin plata.
 *
 * @param {string|null} subtype
 */
export function esCorteDePresupuesto(subtype) {
  return typeof subtype === "string" && subtype.toLowerCase().includes("budget");
}
