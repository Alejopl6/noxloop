// El transcript de cada fase: lo que el agente dijo e hizo, en el home y
// REDACTADO antes de tocar disco (spec 004, FR-004).
//
// -----------------------------------------------------------------------------
// POR QUE EN EL HOME Y FUERA DEL ESTADO DEL RUN (principio III)
// -----------------------------------------------------------------------------
//
// `<home>/runs/<item>/transcripts/<tarea>-<fase>[-<lente>].jsonl`. En el home
// porque es lo que el operador abre cuando algo ya se rompio, y la conversacion
// del agente no puede ser la unica copia. Y NO dentro de `run-<item>.json`:
// `state.mjs` es el unico escritor del estado del run, y un transcript que
// crece cada medio segundo metido ahi convertiria cada linea del agente en una
// reescritura del estado —con su carrera contra las transiciones de las demas
// tareas en paralelo—. El transcript no es estado: nadie decide nada leyendolo.
//
// -----------------------------------------------------------------------------
// POR QUE UNA LINEA POR EVENTO, EN APPEND
// -----------------------------------------------------------------------------
//
// El servicio lo lee MIENTRAS se escribe (la interfaz lo muestra en vivo). Con
// temporal + rename habria que reescribir el archivo entero por cada evento;
// con `O_APPEND` cada `write` se posiciona al final de forma atomica, y un
// evento es UNA escritura de una linea acotada (`CONTENIDO_MAXIMO`): un lector
// ve lineas enteras o, como mucho, una ultima a medias sin salto de linea, que
// descarta. El resumen de tokens, que si se reescribe, va aparte y con
// temporal + rename, como el estado.
//
// -----------------------------------------------------------------------------
// REDACTADO ANTES DE PERSISTIR (principio IX)
// -----------------------------------------------------------------------------
//
// Con el redactor DE LA BOVEDA (`packages/vault/src/redactor.mjs`) y no con uno
// propio: busca por valor y marca con el nombre (`[redactado:NOMBRE]`), que es
// el fallo con nombre propio de un transcript —la credencial a mitad de una
// frase, sin `API_KEY=` delante—. Contra que valores: los de las variables
// SECRETAS del entorno de esta fase, que son exactamente las credenciales que
// el agente tuvo en la mano. Si no se puede redactar, NO SE ESCRIBE: la
// redaccion es previa a la escritura, y un transcript sin redactar es la fuga
// que esto existe para impedir.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { crearRedactor } from "../../vault/src/redactor.mjs";
import { SIN_MEDIR, resumenDeTokens, sumarResumenes } from "../../adapters/src/eventos.mjs";

/**
 * Un segmento de ruta que no puede escapar del directorio: sin barras, sin
 * puntos (`..`), sin `:` (el taskId de la planificacion es `plan:<item>`).
 *
 * @param {unknown} s
 */
const segmento = (s) => String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "_") || "_";

/**
 * @param {string} home
 * @param {{itemId: string, taskId: string, fase: string, lente?: string|null}} donde
 */
export function rutaDeTranscript(home, { itemId, taskId, fase, lente }) {
  const nombre = [segmento(taskId), segmento(fase), ...(lente ? [segmento(lente)] : [])].join("-");
  return join(home, "runs", segmento(itemId), "transcripts", `${nombre}.jsonl`);
}

/** Donde vive el resumen de tokens de un transcript. */
export const rutaDeTokens = (/** @type {string} */ ruta) => ruta.replace(/\.jsonl$/, ".tokens.json");

/**
 * El resumen de tokens de una fase: el del motor si ya cerro alguna vez, y si
 * no, el que sale de los eventos que hay.
 *
 * @param {string} ruta
 */
export function leerTokens(ruta) {
  const archivo = rutaDeTokens(ruta);
  if (existsSync(archivo)) {
    try {
      const { medido, entrada, salida, cacheLectura, cacheEscritura } = JSON.parse(readFileSync(archivo, "utf8"));
      return { medido: medido === true, entrada, salida, cacheLectura, cacheEscritura };
    } catch {
      /* un resumen ilegible no es un resumen: se recalcula de los eventos */
    }
  }
  if (!existsSync(ruta)) return { ...SIN_MEDIR };
  return resumenDeTokens(leerLineas(ruta));
}

/** @param {string} ruta */
function leerLineas(ruta) {
  /** @type {any[]} */
  const eventos = [];
  for (const linea of readFileSync(ruta, "utf8").split("\n")) {
    if (!linea.trim()) continue;
    try {
      eventos.push(JSON.parse(linea));
    } catch {
      /* una ultima linea a medias: se descarta, no se inventa */
    }
  }
  return eventos;
}

/**
 * El redactor de la boveda, cargado con las credenciales de ESTA fase.
 *
 * Se arma con un repositorio y un backend en memoria porque el motor corre
 * como subproceso y no abre la boveda del servicio: lo que tiene son los
 * valores que la boveda ya le entrego en el entorno, y esos son los unicos que
 * el agente pudo ver. Los nombres de `secretos` son los que el runtime declaro
 * como credenciales (`requiredEnv`); sin declaracion se miran todas las del
 * entorno menos las de la maquina, que no son secretas y cuyo valor (`HOME`) es
 * prefijo de cualquier ruta: redactarlas convertiria el transcript en ruido.
 *
 * @param {Record<string, string>} env
 * @param {string[]|undefined} secretos
 */
async function redactorDeFase(env, secretos) {
  const NO_SECRETAS = new Set(["PATH", "HOME", "SHELL", "LANG", "LC_ALL", "TMPDIR", "TZ", "USER", "LOGNAME", "CI"]);
  const nombres = Array.isArray(secretos)
    ? secretos.filter((n) => Object.hasOwn(env || {}, n))
    : Object.keys(env || {}).filter((n) => !NO_SECRETAS.has(n) && !n.startsWith("NOXLOOP_"));
  const valores = new Map(nombres.map((n) => [n, String(env[n])]));
  const redactor = crearRedactor({
    backend: { recuperar: async (/** @type {string} */ ref) => valores.get(ref) },
    repositorio: { credenciales: () => nombres.map((n) => ({ nombre: n, ref_boveda: n })) },
    auditoria: { registrar() {} },
  });
  await redactor.cargarHuellas();
  return redactor;
}

/**
 * @typedef {object} Transcript
 * @property {string} ruta
 * @property {(e: any) => void} alEvento
 * @property {(r: any) => void} cerrar
 */

/**
 * Abre el transcript de UNA invocacion de fase.
 *
 * Una fase que se reintenta escribe en el MISMO archivo: el transcript de GREEN
 * es todo lo que GREEN hizo, intento tras intento, y el resumen de tokens suma.
 *
 * @param {{
 *   home: string, itemId: string, taskId: string, fase: string, lente?: string|null,
 *   env?: Record<string, string>, secretos?: string[],
 *   redactar?: (texto: string) => string, runtime?: string|null,
 * }} opts `redactar` es una redaccion ADICIONAL (la del servicio, si la hay), nunca en lugar de la de la fase
 * @returns {Promise<Transcript>}
 */
export async function abrirTranscript(opts) {
  const ruta = rutaDeTranscript(opts.home, opts);
  let roto = false;
  /** @type {any} */
  let redactor = null;
  try {
    redactor = await redactorDeFase(opts.env || {}, opts.secretos);
  } catch {
    roto = true;
  }

  /** @type {any[]} */
  const deEstaInvocacion = [];
  let terminal = false;
  let huboError = false;

  /** @param {any} e */
  const escribir = (e) => {
    if (roto) return;
    let linea;
    try {
      let limpio = redactor.redactarObjeto(e);
      if (opts.redactar) {
        const extra = opts.redactar;
        limpio = JSON.parse(JSON.stringify(limpio), (_k, v) => (typeof v === "string" ? extra(v) : v));
      }
      linea = JSON.stringify(limpio) + "\n";
    } catch {
      // Sin poder redactar, se deja de escribir para el resto de la fase. Una
      // linea sin redactar no se arregla despues: ya estuvo en disco.
      roto = true;
      return;
    }
    try {
      mkdirSync(join(ruta, ".."), { recursive: true });
      appendFileSync(ruta, linea);
    } catch {
      /* un disco lleno no tumba la fase: ver `emisorDeEventos` */
    }
  };

  /** @param {any} e */
  const alEvento = (e) => {
    if (!e || typeof e !== "object") return;
    if (e.tipo === "resultado" || e.tipo === "error") terminal = true;
    if (e.tipo === "error") huboError = true;
    deEstaInvocacion.push(e);
    // QUE RUNTIME LO DIJO (spec 005, FR-007). Tras un hand-off, el GREEN de una
    // tarea lo escriben dos runtimes en el MISMO archivo —el transcript de una
    // fase es todo lo que esa fase hizo—, y sin esto no se sabria de quien es
    // cada linea. Lo estampa el motor, que es quien sabe que runtime lanzo; el
    // evento del adaptador no lo trae.
    escribir(opts.runtime ? { ...e, runtime: String(opts.runtime) } : e);
  };

  return {
    ruta,

    alEvento,

    /**
     * Cierra la invocacion con lo que devolvio el runtime.
     *
     * UN RUNTIME QUE NO EMITIO SU FINAL LO TIENE IGUAL. Una fase cancelada, un
     * stream cortado o un adaptador sin eventos no dejan `resultado` ni
     * `error`: se escribe aqui desde el `PhaseResult`, que es lo que el motor
     * sabe con certeza. Sin esto el transcript de una fase cancelada se leeria
     * como una fase que sigue corriendo.
     *
     * @param {any} r
     */
    cerrar(r) {
      if (!terminal || (r && r.ok === false && !huboError)) {
        const e = r && r.ok !== false
          ? { t: new Date().toISOString(), tipo: "resultado", contenido: String(r?.text ?? "") }
          : {
              t: new Date().toISOString(),
              tipo: "error",
              contenido: `${r?.subtype ? `${r.subtype}: ` : ""}${String(r?.text ?? "la fase termino sin resultado")}`,
            };
        alEvento(e);
      }
      if (roto) return;

      // EL RESUMEN SUMA INTENTOS. Lo gastado en el intento que fallo tambien se
      // gasto; y uno sin medir deja el total sin medir (ver `sumarResumenes`).
      const esta = resumenDeTokens(deEstaInvocacion);
      const archivo = rutaDeTokens(ruta);
      /** @type {any} */
      let previo = null;
      if (existsSync(archivo)) {
        try {
          previo = JSON.parse(readFileSync(archivo, "utf8"));
        } catch {
          previo = null;
        }
      }
      const total = previo ? sumarResumenes(previo, esta) : esta;
      try {
        const tmp = `${archivo}.tmp-${process.pid}`;
        writeFileSync(
          tmp,
          JSON.stringify({ ...total, invocaciones: (previo?.invocaciones ?? 0) + 1, fase: opts.fase, lente: opts.lente ?? null }) + "\n",
        );
        renameSync(tmp, archivo);
      } catch {
        /* sin resumen, el servicio lo recalcula de los eventos */
      }
    },
  };
}
