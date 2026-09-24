// De lo que dice cada runtime a los cinco tipos del transcript.
//
// POR QUE VIVE EN LOS ADAPTADORES Y NO EN EL MOTOR. El adaptador ya lee la
// salida de su runtime para sacar el resultado —mensajes del SDK de Claude, un
// evento JSON por linea en Codex, el guion del falso—. Si la traduccion
// viviera en el motor, el motor tendria que saber que runtime corrio para
// saber como leerla: el `if` que el principio VI prohibe. Aqui cada adaptador
// traduce lo suyo y el motor recibe siempre la misma forma.
//
// LO QUE NO SE GUARDA, Y POR QUE. El razonamiento interno (`thinking`,
// `reasoning`) no es lo que el agente dijo ni lo que hizo: es lo que el
// runtime decide mostrar o no, y cambia de un modelo a otro. Los parciales del
// stream (`stream_event`) llegan despues completos en su mensaje: guardar los
// dos duplicaria cada palabra y partiria un secreto en dos trozos que el
// redactor no reconoceria.
//
// LO QUE ESTE MODULO NO HACE: no redacta ni escribe. Redactar es del motor,
// contra la boveda y ANTES de tocar disco (principio IX); escribir tambien. Un
// adaptador que escribiera el transcript seria un escritor mas en el home, y la
// suite de contrato lo mide (`no-escribe-estado`).

import { TIPOS_DE_EVENTO } from "./contrato.mjs";

/**
 * El tope de `contenido` por evento.
 *
 * Una herramienta que devuelve un archivo generado de 5 MB lo meteria entero
 * en una linea del transcript, y la ventana que la pinta se congela. Ademas
 * mantiene cada linea por debajo de lo que una escritura con `O_APPEND` deja
 * junta (ver `packages/engine/src/transcript.mjs`).
 */
export const CONTENIDO_MAXIMO = 16 * 1024;

/**
 * Recorta DICIENDOLO. Un recorte silencioso hace pensar que eso fue todo lo que
 * salio, que es una afirmacion distinta y falsa.
 *
 * @param {string} texto
 */
function acotar(texto) {
  if (texto.length <= CONTENIDO_MAXIMO) return texto;
  return `${texto.slice(0, CONTENIDO_MAXIMO)}\n… [recortado: ${texto.length - CONTENIDO_MAXIMO} caracteres mas]`;
}

/**
 * Convierte el callback de quien llama en uno que NO PUEDE TUMBAR LA FASE.
 *
 * Un transcript es un registro de lo que paso, no parte de lo que pasa: si el
 * disco se llena o el callback tiene un error, la fase sigue y su veredicto
 * sigue saliendo del codigo de salida. Una fase que falla porque no se pudo
 * guardar su transcript es un fallo inventado.
 *
 * Ademas estampa `t`, acota el contenido y descarta lo que no tiene un tipo de
 * los cinco: el contrato se cumple aqui una vez, no en cada adaptador.
 *
 * @param {((e: import("./contrato.mjs").EventoDeTranscript) => void) | undefined} alEvento
 * @returns {(e: {tipo: string, contenido?: any, herramienta?: string, tokens?: any}) => void}
 */
export function emisorDeEventos(alEvento) {
  if (typeof alEvento !== "function") return () => {};
  return (e) => {
    if (!e || !TIPOS_DE_EVENTO.includes(e.tipo)) return;
    /** @type {any} */
    const evento = {
      t: new Date().toISOString(),
      tipo: e.tipo,
      contenido: acotar(typeof e.contenido === "string" ? e.contenido : e.contenido == null ? "" : String(e.contenido)),
    };
    if (typeof e.herramienta === "string" && e.herramienta) evento.herramienta = e.herramienta;
    if (e.tokens) evento.tokens = e.tokens;
    try {
      alEvento(evento);
    } catch {
      /* ver arriba: un transcript roto no decide el veredicto de la fase */
    }
  };
}

/** @param {any} n */
const numero = (n) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);

/**
 * Los tokens del `usage` de Claude (SDK y CLI hablan la misma forma).
 *
 * Sin `usage`, o sin entrada ni salida, `undefined`: no hay tokens medidos, y
 * devolver ceros los fingiria. Lo que falta de la cache va en `null`.
 *
 * @param {any} usage
 * @returns {import("./contrato.mjs").TokensDeInvocacion | undefined}
 */
export function tokensDeUsoClaude(usage) {
  if (!usage || typeof usage !== "object") return undefined;
  const entrada = numero(usage.input_tokens);
  const salida = numero(usage.output_tokens);
  if (entrada === null || salida === null) return undefined;
  return {
    entrada,
    salida,
    cacheLectura: numero(usage.cache_read_input_tokens),
    cacheEscritura: numero(usage.cache_creation_input_tokens),
  };
}

/**
 * Los tokens del `usage` de `turn.completed` de Codex. No reporta escritura de
 * cache: `null`, no cero.
 *
 * @param {any} usage
 * @returns {import("./contrato.mjs").TokensDeInvocacion | undefined}
 */
export function tokensDeUsoCodex(usage) {
  if (!usage || typeof usage !== "object") return undefined;
  const entrada = numero(usage.input_tokens);
  const salida = numero(usage.output_tokens);
  if (entrada === null || salida === null) return undefined;
  return { entrada, salida, cacheLectura: numero(usage.cached_input_tokens), cacheEscritura: null };
}

/**
 * La entrada de una herramienta, en una linea legible. JSON y no un resumen
 * elegido a mano: cual campo importa depende de la herramienta, y elegir aqui
 * seria interpretar.
 *
 * @param {any} entrada
 */
function comoTexto(entrada) {
  if (typeof entrada === "string") return entrada;
  try {
    return JSON.stringify(entrada ?? {});
  } catch {
    return String(entrada);
  }
}

/**
 * El contenido de un `tool_result`: texto, o una lista de bloques de los que
 * solo el texto se guarda (una imagen en base64 no es transcript, es peso).
 *
 * @param {any} contenido
 */
function textoDeResultado(contenido) {
  if (typeof contenido === "string") return contenido;
  if (Array.isArray(contenido)) {
    return contenido
      .map((b) => (b?.type === "text" && typeof b.text === "string" ? b.text : b?.type ? `[${b.type}]` : ""))
      .filter(Boolean)
      .join("\n");
  }
  return comoTexto(contenido);
}

/**
 * Un mensaje de Claude —del SDK en proceso o una linea de `stream-json`, que
 * tienen la misma forma— a eventos del transcript.
 *
 * `herramientas` es el estado de UNA fase: el id de cada `tool_use` visto, con
 * su nombre. El `tool_result` solo trae el id, y un resultado sin nombre obliga
 * al operador a casar ids a ojo.
 *
 * @param {any} m
 * @param {Map<string, string>} herramientas
 * @returns {Array<{tipo: string, contenido: string, herramienta?: string, tokens?: any}>}
 */
export function eventosDeMensajeClaude(m, herramientas) {
  if (!m || typeof m !== "object") return [];
  /** @type {Array<{tipo: string, contenido: string, herramienta?: string, tokens?: any}>} */
  const salida = [];

  if (m.type === "assistant") {
    for (const b of m.message?.content || []) {
      if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) {
        salida.push({ tipo: "texto", contenido: b.text });
      } else if (b?.type === "tool_use") {
        const nombre = typeof b.name === "string" ? b.name : "herramienta";
        if (typeof b.id === "string") herramientas.set(b.id, nombre);
        salida.push({ tipo: "herramienta", herramienta: nombre, contenido: comoTexto(b.input) });
      }
    }
  } else if (m.type === "user") {
    const contenido = m.message?.content;
    for (const b of Array.isArray(contenido) ? contenido : []) {
      if (b?.type !== "tool_result") continue;
      const nombre = herramientas.get(b.tool_use_id) ?? "herramienta";
      const texto = textoDeResultado(b.content);
      salida.push({
        tipo: "resultado_herramienta",
        herramienta: nombre,
        contenido: b.is_error === true ? `[error] ${texto}` : texto,
      });
    }
  } else if (m.type === "result") {
    const tokens = tokensDeUsoClaude(m.usage);
    const texto = typeof m.result === "string" ? m.result : "";
    const error = m.is_error === true;
    salida.push({
      tipo: error ? "error" : "resultado",
      // Un error sin texto dice al menos su subtipo: «fallo» a secas no se
      // puede diagnosticar.
      contenido: error && !texto ? `el runtime termino con error (${m.subtype ?? "sin subtipo"})` : texto,
      ...(tokens ? { tokens } : {}),
    });
  }
  return salida;
}

/**
 * Una linea de `codex exec --json` a eventos del transcript.
 *
 * `estado.ultimoMensaje` guarda el ultimo `agent_message`: `turn.completed` no
 * trae texto, y el resultado de la fase es lo ultimo que el agente dijo.
 *
 * @param {any} ev
 * @param {{ultimoMensaje: string}} estado
 * @returns {Array<{tipo: string, contenido: string, herramienta?: string, tokens?: any}>}
 */
export function eventosDeLineaCodex(ev, estado) {
  if (!ev || typeof ev !== "object") return [];
  if (ev.type === "item.completed") {
    const it = ev.item || {};
    switch (it.type) {
      case "agent_message":
        if (typeof it.text !== "string" || !it.text.trim()) return [];
        estado.ultimoMensaje = it.text;
        return [{ tipo: "texto", contenido: it.text }];
      case "command_execution":
        return [
          { tipo: "herramienta", herramienta: "shell", contenido: String(it.command ?? "") },
          {
            tipo: "resultado_herramienta",
            herramienta: "shell",
            contenido:
              `${typeof it.aggregated_output === "string" ? it.aggregated_output : ""}` +
              (it.exit_code != null ? `${it.aggregated_output ? "\n" : ""}[salio con ${it.exit_code}]` : ""),
          },
        ];
      case "file_change":
        return [
          {
            tipo: "herramienta",
            herramienta: "edicion",
            contenido: (Array.isArray(it.changes) ? it.changes : [])
              .map((/** @type {any} */ c) => `${c?.kind ?? "cambio"} ${c?.path ?? ""}`.trim())
              .join("\n"),
          },
        ];
      case "mcp_tool_call": {
        const nombre = [it.server, it.tool].filter(Boolean).join(".") || "mcp";
        const eventos = [{ tipo: "herramienta", herramienta: nombre, contenido: comoTexto(it.arguments) }];
        if (it.result !== undefined || it.error !== undefined) {
          eventos.push({
            tipo: "resultado_herramienta",
            herramienta: nombre,
            contenido: it.error ? `[error] ${comoTexto(it.error)}` : textoDeResultado(it.result?.content ?? it.result),
          });
        }
        return eventos;
      }
      case "web_search":
        return [{ tipo: "herramienta", herramienta: "busqueda", contenido: String(it.query ?? "") }];
      case "error":
        return [{ tipo: "error", contenido: String(it.message ?? "error del runtime") }];
      default:
        // `reasoning`, `todo_list`: no son lo que el agente dijo ni lo que hizo.
        return [];
    }
  }
  if (ev.type === "turn.completed") {
    const tokens = tokensDeUsoCodex(ev.usage);
    return [{ tipo: "resultado", contenido: estado.ultimoMensaje || "", ...(tokens ? { tokens } : {}) }];
  }
  if (ev.type === "turn.failed" || ev.type === "error") {
    const mensaje = typeof ev.error?.message === "string" ? ev.error.message : typeof ev.message === "string" ? ev.message : "el turno fallo";
    return [{ tipo: "error", contenido: mensaje }];
  }
  return [];
}

/**
 * Un parser de lineas JSON que ignora las que no parsean.
 *
 * Un runtime que mezcla una advertencia en texto plano con su stream es comun;
 * tirar el transcript entero por una linea de ruido seria perder lo demas.
 *
 * @param {string} linea
 */
export function jsonDeLinea(linea) {
  const t = String(linea || "").trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/**
 * @typedef {object} ResumenDeTokens
 * @property {boolean} medido
 * @property {number|null} entrada
 * @property {number|null} salida
 * @property {number|null} cacheLectura
 * @property {number|null} cacheEscritura
 */

/** «Sin medir»: todo en null. Un objeto con ceros diria otra cosa. */
export const SIN_MEDIR = Object.freeze({ medido: false, entrada: null, salida: null, cacheLectura: null, cacheEscritura: null });

/**
 * La suma de dos cantidades que pueden faltar: si faltan las dos, falta la
 * suma. Un `null + null = 0` convertiria «el runtime no lo da» en «fue cero».
 *
 * @param {number|null|undefined} a
 * @param {number|null|undefined} b
 */
const sumar = (a, b) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));

/**
 * Los tokens de UNA invocacion a partir de sus eventos: la suma de los que
 * traen `tokens`. Si ninguno los trae, «sin medir» — no cero.
 *
 * Vive aqui, junto a los normalizadores, porque la usan el motor (al cerrar
 * cada fase) y el servicio (mientras la fase corre y el resumen del motor
 * todavia no esta), y ninguno de los dos puede importar al otro.
 *
 * @param {Array<{tokens?: any}>} eventos
 * @returns {ResumenDeTokens}
 */
export function resumenDeTokens(eventos) {
  const con = (eventos || []).filter((e) => e && e.tokens && typeof e.tokens === "object");
  if (!con.length) return { ...SIN_MEDIR };
  return con.reduce(
    (acc, e) => ({
      medido: true,
      entrada: sumar(acc.entrada, e.tokens.entrada),
      salida: sumar(acc.salida, e.tokens.salida),
      cacheLectura: sumar(acc.cacheLectura, e.tokens.cacheLectura),
      cacheEscritura: sumar(acc.cacheEscritura, e.tokens.cacheEscritura),
    }),
    /** @type {ResumenDeTokens} */ ({ ...SIN_MEDIR, medido: true }),
  );
}

/**
 * Suma dos resumenes (dos intentos de la misma fase, o las fases de una tarea).
 *
 * UNO SIN MEDIR HACE SIN MEDIR AL TOTAL. Un total con una parte que no se
 * conto se lee como el gasto entero y es menos: la misma regla que `sinMedir`
 * en `/v1/usage`. Se prefiere decir «sin medir» a dar un numero que miente por
 * defecto.
 *
 * @param {ResumenDeTokens} a
 * @param {ResumenDeTokens} b
 * @returns {ResumenDeTokens}
 */
export function sumarResumenes(a, b) {
  if (!a?.medido || !b?.medido) return { ...SIN_MEDIR };
  return {
    medido: true,
    entrada: sumar(a.entrada, b.entrada),
    salida: sumar(a.salida, b.salida),
    cacheLectura: sumar(a.cacheLectura, b.cacheLectura),
    cacheEscritura: sumar(a.cacheEscritura, b.cacheEscritura),
  };
}
