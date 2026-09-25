// Si un runtime tiene con que invocar al modelo, preguntado ANTES de la primera
// fase.
//
// POR QUE EXISTE. El preflight solo preguntaba si el binario respondia a
// `--version`. Un `claude` instalado sin sesion, o un `codex` sin `codex login`,
// pasaban el doctor en verde y morian en la primera fase con "no autenticado":
// con la tarea repartida, el worktree creado y el operador mirando otra cosa.
// El operador tiene tres formas legitimas de darle credencial a un runtime —su
// suscripcion de Claude, su cuenta de ChatGPT o una API key guardada en la
// boveda— y este modulo dice cual hay, o que ninguna y que hacer.
//
// COMO PREGUNTA. Con el propio binario, que es quien sabe donde guarda su
// sesion: `claude auth status` (JSON) y `codex login status` (texto). No se lee
// el llavero de macOS ni `~/.codex/auth.json` a mano: seria duplicar un formato
// que no es nuestro y, peor, tener el secreto en memoria de este proceso para
// contestar una pregunta que solo necesita un si o un no.
//
// LO QUE NUNCA DEVUELVE (principio IX). La salida de esos comandos trae datos
// de la cuenta —email, organizacion— y `codex` imprime un trozo de la key
// enmascarada. Enmascarado sigue siendo un pedazo del secreto. Por eso el
// resultado se arma SOLO con campos elegidos (booleans, el metodo, textos
// fijos); la salida cruda no se copia a ningun sitio, ni siquiera cuando no se
// entiende. Los NOMBRES de las variables si se pueden decir.
//
// EL EJECUTOR SE INYECTA. Es lo que permite probar cada respuesta posible sin
// los binarios reales, y lo que permite al adaptador apuntarlo a su propio
// `comando` (la ruta de un binario instalado fuera del PATH, o un guion en las
// pruebas de contrato).

import { join } from "node:path";

import { carpetasConocidas, pathAmpliado, resolverBinario } from "./binarios.mjs";
import { lanzar } from "./proceso.mjs";

/**
 * @typedef {"suscripcion_claude"|"cuenta_chatgpt"|"api_key"} MetodoDeAutenticacion
 *
 * @typedef {object} EstadoDeAutenticacion
 * @property {string} runtime
 * @property {boolean} conectado
 * @property {MetodoDeAutenticacion|null} metodo
 * @property {boolean} binarioPresente si el binario del runtime contesto; separa "instalalo" de "inicia sesion"
 * @property {string} detalle lo que se sabe, en una frase; nunca un valor de la cuenta
 * @property {string} [causa] por que no esta conectado
 * @property {string} [accion] que hacer para que lo este
 * @property {{comando: string[], abreNavegador: boolean}} comoIniciarSesion el comando que abre el login
 *   del propio runtime; la interfaz lo ofrece como boton
 *
 * @typedef {(argv: string[], opciones: {env: Record<string, string>, secretos?: string[]}) =>
 *   Promise<{code: number|null, stdout: string, stderr: string}>} Ejecutor
 */

/**
 * Lo que cada runtime necesita para contestar la pregunta, y para dejar de
 * necesitarla.
 *
 * `variablesDeKey` va en orden: la primera presente es la que se nombra en el
 * detalle. Son las mismas que el adaptador declara en `requiredEnv`, y por eso
 * una key guardada en la boveda que llega a la fase tambien llega aqui.
 */
const RUNTIMES = Object.freeze({
  "claude-agent-sdk": {
    nombre: "Claude Code",
    binario: "claude",
    estado: ["claude", "auth", "status"],
    login: ["claude", "auth", "login"],
    variablesDeKey: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
    keyEnSettings: "ANTHROPIC_API_KEY",
    interpretar: interpretarClaude,
  },
  codex: {
    nombre: "Codex",
    binario: "codex",
    estado: ["codex", "login", "status"],
    login: ["codex", "login"],
    variablesDeKey: ["OPENAI_API_KEY"],
    keyEnSettings: "OPENAI_API_KEY",
    interpretar: interpretarCodex,
  },
});

/** Los runtimes que tienen una sesion que detectar. `fake` no: no invoca ningun modelo. */
export const RUNTIMES_CON_SESION = Object.freeze(Object.keys(RUNTIMES));

/**
 * El entorno de una pregunta: SOLO los nombres dados, tomados de `disponible`.
 *
 * Es la misma regla que el entorno de una fase, aplicada al preflight: se
 * construye por nombre, nunca se copia entero. Si el preflight preguntara con
 * todo lo que tiene el proceso del servicio, diria "hay sesion" en casos en que
 * la fase —que recibe solo lo declarado— no la encontraria.
 *
 * @param {Record<string, string|undefined>} disponible
 * @param {readonly string[]} nombres
 * @returns {Record<string, string>}
 */
export function entornoDeclarado(disponible, nombres) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const n of nombres) {
    const v = disponible?.[n];
    // Declarada y vacia NO se rellena con "": un PATH vacio es peor que ninguno.
    if (typeof v === "string" && v !== "") env[n] = v;
  }
  return env;
}

/**
 * El ejecutor de produccion: el binario de verdad, con el entorno que se le da
 * y ni una variable mas.
 *
 * El entorno lo decide quien llama —el adaptador le pasa lo que el runtime
 * declara—, igual que en una fase. `lanzar` es el mismo que lanza las fases:
 * entorno exacto y la guarda de argv puesta.
 *
 * @type {Ejecutor}
 */
export async function ejecutorDeProceso(argv, { env, secretos }) {
  const [nombre, ...args] = argv;
  // LA RUTA ABSOLUTA, no el nombre: desde una app de macOS el PATH del entorno
  // no trae `/opt/homebrew/bin` ni `~/.local/bin`, y `claude` a secas daba
  // ENOENT con Claude Code instalado. Si no se encuentra en ninguna parte se
  // lanza el nombre tal cual, para que el ENOENT diga lo que falta.
  const comando = resolverBinario(nombre, { env }) ?? nombre;
  const l = await lanzar({
    comando,
    args,
    // Y EL PATH AMPLIADO, el mismo que recibe la fase: un `claude` instalado con
    // npm es un script `#!/usr/bin/env node`, y con el PATH de una app de macOS
    // no encuentra `node`. El PATH no es secreto; lo demas del entorno, intacto.
    env: { ...env, PATH: pathAmpliado(env) },
    // CUALES SON SECRETAS, y hace falta decirlo desde que el binario va por su
    // ruta absoluta: `/Users/<usuario>/.local/bin/claude` contiene el valor de
    // `HOME` y el de `USER`, y mirando todas la guarda se negaba a preguntar.
    // Sin declaracion se siguen mirando todas (denegar por defecto).
    ...(secretos ? { secretos } : {}),
    cwd: ".",
    // `claude auth status` tarda un segundo; un minuto colgado es un binario
    // roto, y el doctor no puede quedarse esperandolo.
    timeoutMs: 15_000,
  });
  if (l.cancelado) {
    return { code: null, stdout: "", stderr: "no contesto a tiempo" };
  }
  return { code: l.code, stdout: l.stdout, stderr: l.stderr };
}

/**
 * Si el runtime tiene con que invocar al modelo, y por que via.
 *
 * ORDEN DE LA RESPUESTA:
 *   1. Se pregunta al binario. Si no esta, no hay nada que conectar: una key
 *      sin el runtime que la usa no invoca nada. (El caso de Claude con el SDK
 *      instalado y sin CLI lo resuelve el adaptador, que es quien sabe si el
 *      SDK esta.)
 *   2. Si hay una API key declarada en `env`, manda: es la credencial que la
 *      boveda entrega y la que el runtime usa primero.
 *   3. Si no, la sesion local del runtime.
 *
 * @param {string} runtime el `id` del adaptador
 * @param {{ejecutar?: Ejecutor, env?: Record<string, string|undefined>}} [opciones]
 * @returns {Promise<EstadoDeAutenticacion>}
 */
export async function estadoDeAutenticacion(runtime, opciones = {}) {
  const r = Object.hasOwn(RUNTIMES, runtime) ? RUNTIMES[/** @type {keyof typeof RUNTIMES} */ (runtime)] : null;
  if (!r) {
    // Es un error de quien llama, no un estado: contestar "desconectado" haria
    // que la interfaz ofreciera un login que no existe.
    throw new Error(
      `el runtime "${runtime}" no tiene sesion que detectar. Los que la tienen: ${RUNTIMES_CON_SESION.join(", ")}.`,
    );
  }
  const { ejecutar = ejecutorDeProceso } = opciones;
  /** @type {Record<string, string>} */
  const env = {};
  for (const [k, v] of Object.entries(opciones.env || {})) if (typeof v === "string") env[k] = v;

  const base = { runtime, comoIniciarSesion: { comando: [...r.login], abreNavegador: true } };
  const iniciar = `\`${r.login.join(" ")}\` (abre el navegador para iniciar sesion)`;
  const pegarKey = `pega la API key en Settings → Modelos (se guarda en la boveda como ${r.keyEnSettings})`;

  // Las unicas secretas de este entorno son las keys del runtime: lo demas
  // (HOME, USER, PATH...) dice donde esta la sesion, no cual es.
  const secretos = r.variablesDeKey.filter((n) => Object.hasOwn(env, n));

  let salida;
  try {
    salida = await ejecutar([...r.estado], { env, secretos });
  } catch (e) {
    const ausente = e?.code === "ENOENT";
    return {
      ...base,
      conectado: false,
      metodo: null,
      binarioPresente: !ausente,
      detalle: ausente ? `el binario \`${r.binario}\` no esta instalado` : `no se pudo ejecutar \`${r.estado.join(" ")}\``,
      causa: ausente
        ? `el binario \`${r.binario}\` no se encontro ni en el PATH del entorno declarado${env.PATH ? "" : " (ese entorno no trae PATH)"} ` +
          `ni en las carpetas donde lo dejan los instaladores (${carpetasConocidas("~").join(", ")}). ` +
          `Sin el, ${r.nombre} no puede invocar nada, tenga sesion o key.`
        // El mensaje del error puede traer rutas, nunca la salida del runtime:
        // se dice el codigo, no el texto.
        : `\`${r.estado.join(" ")}\` fallo al lanzarse (${e?.code || "sin codigo"}).`,
      accion: `Instala \`${r.binario}\` y dejalo en el PATH de la maquina del servicio; despues, ${iniciar}, o ${pegarKey}.`,
    };
  }

  const key = r.variablesDeKey.find((n) => typeof env[n] === "string" && env[n] !== "");
  if (key) {
    return { ...base, conectado: true, metodo: "api_key", binarioPresente: true, detalle: `${r.nombre} usara la API key declarada en ${key}` };
  }

  const leido = r.interpretar(salida);
  if (leido.conectado) {
    return { ...base, conectado: true, metodo: leido.metodo, binarioPresente: true, detalle: leido.detalle };
  }
  return {
    ...base,
    conectado: false,
    metodo: null,
    binarioPresente: true,
    detalle: leido.detalle,
    causa: leido.causa || `${r.nombre} no tiene sesion iniciada y no hay API key declarada: la primera fase fallaria con "no autenticado".`,
    accion: `Corre ${iniciar}, o ${pegarKey}.`,
  };
}

/**
 * `claude auth status` imprime JSON: `{loggedIn, authMethod, ...datos de la cuenta}`.
 * Se leen DOS campos y nada mas.
 *
 * @param {{code: number|null, stdout: string, stderr: string}} s
 * @returns {{conectado: boolean, metodo: MetodoDeAutenticacion|null, detalle: string, causa?: string}}
 */
function interpretarClaude(s) {
  /** @type {any} */
  let j = null;
  try {
    j = JSON.parse(String(s.stdout || "").trim());
  } catch { /* se trata abajo */ }
  if (!j || typeof j !== "object" || typeof j.loggedIn !== "boolean") {
    return {
      conectado: false,
      metodo: null,
      detalle: "`claude auth status` no devolvio el JSON esperado",
      // La salida no se repite: no se sabe que trae.
      causa: `\`claude auth status\` contesto${s.code != null ? ` con ${s.code}` : ""} algo que no es el JSON con \`loggedIn\`: ` +
        "puede ser una version de Claude Code anterior a ese comando. No se puede afirmar que haya sesion.",
    };
  }
  if (!j.loggedIn) {
    return { conectado: false, metodo: null, detalle: "Claude Code no tiene sesion iniciada" };
  }
  const metodoCrudo = typeof j.authMethod === "string" ? j.authMethod : "";
  if (metodoCrudo === "claude.ai") {
    return { conectado: true, metodo: "suscripcion_claude", detalle: "Claude Code tiene sesion iniciada con una suscripcion de claude.ai" };
  }
  if (/key|console/i.test(metodoCrudo)) {
    return { conectado: true, metodo: "api_key", detalle: "Claude Code tiene sesion iniciada con una API key" };
  }
  // Un metodo que no conocemos (Bedrock, Vertex, uno nuevo). Hay sesion, y se
  // dice que no se sabe de que tipo en vez de inventarlo. `authMethod` es una
  // etiqueta del CLI, no un dato de la cuenta: se puede nombrar, recortada.
  return {
    conectado: true,
    metodo: null,
    detalle: `Claude Code tiene sesion iniciada por un metodo que noxloop no clasifica (${metodoCrudo.slice(0, 40) || "sin nombre"})`,
  };
}

/**
 * `codex login status` imprime una linea de texto, a veces por stderr:
 *   "Logged in using ChatGPT"
 *   "Logged in using an API key - sk-proj-***abcd"   <- trae un trozo de la key
 *   "Not logged in"
 *
 * @param {{code: number|null, stdout: string, stderr: string}} s
 * @returns {{conectado: boolean, metodo: MetodoDeAutenticacion|null, detalle: string, causa?: string}}
 */
function interpretarCodex(s) {
  const texto = `${s.stdout || ""}\n${s.stderr || ""}`;
  if (/not logged in/i.test(texto)) {
    return { conectado: false, metodo: null, detalle: "Codex no tiene sesion iniciada" };
  }
  if (/logged in using chatgpt/i.test(texto)) {
    return { conectado: true, metodo: "cuenta_chatgpt", detalle: "Codex tiene sesion iniciada con una cuenta de ChatGPT" };
  }
  if (/logged in using an? api key/i.test(texto)) {
    // El texto sigue con la key enmascarada: no se copia nada de el.
    return { conectado: true, metodo: "api_key", detalle: "Codex tiene sesion iniciada con una API key" };
  }
  return {
    conectado: false,
    metodo: null,
    detalle: "`codex login status` contesto algo que no se reconoce",
    causa: `\`codex login status\` contesto${s.code != null ? ` con ${s.code}` : ""} un texto que no dice ni "Logged in" ni ` +
      '"Not logged in": puede ser otra version de Codex. No se puede afirmar que haya sesion.',
  };
}

// ---------------------------------------------------------------------------
// La sesion vencida, reconocida por el error de la fase
// ---------------------------------------------------------------------------

/**
 * Los textos con los que un runtime dice que su credencial ya no vale.
 *
 * POR QUE HACE FALTA, SI YA HAY PREFLIGHT. Medido con Codex: `codex login
 * status` contesto "Logged in using ChatGPT" con el token vencido —el token
 * esta guardado, y eso es lo unico que mira—, y la fase fallo con "Your access
 * token could not be refreshed. Please log out and sign in again.". El
 * preflight no puede verlo; el error de la fase si. Sin reconocerlo, el
 * operador ve «la fase fallo» y un texto en ingles al final de un transcript,
 * y el board sigue diciendo «conectado».
 *
 * CADA SEÑAL ES DEL RUNTIME, NO DEL MODELO. Se mira solo cuando la fase ya
 * fallo, y solo lo que el runtime dijo de su error (el `result` de un
 * `is_error`, el `turn.failed`, su stderr): un agente que escribe "401" en su
 * prosa de una fase que termino bien no es una sesion vencida.
 *
 * Un `401` suelto no basta: "401 tests" es un numero cualquiera. Tiene que ir
 * pegado a lo que significa (unauthorized, status, http).
 *
 * @type {ReadonlyArray<{patron: RegExp, que: string}>}
 */
const SENALES_DE_SESION = Object.freeze([
  { patron: /access token could not be refreshed/i, que: "el token de acceso no se pudo renovar" },
  { patron: /log ?out and sign in again/i, que: "el runtime pide cerrar sesion y volver a entrar" },
  { patron: /refresh token (?:has )?(?:expired|was revoked|is invalid)|invalid_grant/i, que: "el token de renovacion ya no vale" },
  { patron: /\bnot logged in\b|please run \/login|\blogin required\b/i, que: "no hay sesion iniciada" },
  { patron: /oauth token (?:has )?expired|\btoken (?:has )?expired\b|\bexpired token\b/i, que: "el token vencio" },
  { patron: /invalid[ _-]?api[ _-]?key|incorrect api key|invalid x-api-key|api key (?:is )?(?:invalid|not valid)/i, que: "la API key no es valida" },
  { patron: /authentication_error|authentication failed|invalid (?:bearer |access )?token/i, que: "la credencial fue rechazada" },
  {
    patron: /\b401\b[^\n]{0,40}\bunauthori[sz]ed\b|\bunauthori[sz]ed\b[^\n]{0,40}\b401\b|\b(?:status|http|code)\b[^\n]{0,12}\b401\b/i,
    que: "el servidor contesto 401",
  },
]);

/**
 * Si el error de una fase dice que la credencial del runtime no vale, y que
 * hacer. `null` si no lo dice.
 *
 * LO QUE DEVUELVE ES TEXTO FIJO. Ni un trozo de lo que el runtime escribio: un
 * error de autenticacion es justo el sitio donde un runtime repite el token que
 * le rechazaron.
 *
 * @param {string} runtime el `id` del adaptador
 * @param {string} texto lo que el runtime dijo de su error
 * @returns {{senal: string, causa: string, accion: string, comoIniciarSesion: string[]}|null}
 */
export function errorDeSesion(runtime, texto) {
  const r = Object.hasOwn(RUNTIMES, runtime) ? RUNTIMES[/** @type {keyof typeof RUNTIMES} */ (runtime)] : null;
  if (!r || typeof texto !== "string" || !texto) return null;
  const hallada = SENALES_DE_SESION.find((s) => s.patron.test(texto));
  if (!hallada) return null;
  const login = r.login.join(" ");
  return {
    senal: hallada.que,
    causa:
      `${r.nombre} rechazo su credencial al correr la fase (${hallada.que}): la sesion vencio o la API key ya no ` +
      `vale. \`${r.estado.join(" ")}\` puede seguir diciendo que hay sesion —mira que el token este guardado, no ` +
      "que lo acepten—, asi que el preflight no lo ve.",
    accion:
      `Corre \`${login}\` (abre el navegador para volver a iniciar sesion) y reintenta el run; si usas API key, ` +
      `pega una nueva en Settings → Modelos (${r.keyEnSettings}).`,
    comoIniciarSesion: [...r.login],
  };
}

/**
 * Donde el motor deja la ultima señal de sesion de un runtime, para que el
 * servicio la lea.
 *
 * POR QUE UN ARCHIVO. La fase corre en el subproceso del motor y el board lo
 * pinta el servicio: son dos procesos, y el unico sitio que comparten es el
 * home. El archivo lleva la HORA y dice «vencida» o «ok»; el servicio se queda
 * con la mas reciente de lo que sabe, en memoria. Vive aqui porque es el unico
 * modulo que importan los dos lados.
 *
 * @param {string} home
 * @param {string} runtime
 */
export function rutaDeSesionVencida(home, runtime) {
  return join(home, "runtimes", `sesion-${runtime}.json`);
}

/**
 * El archivo donde el runtime guarda su sesion local, si la guarda en un
 * archivo; `null` si no (Claude Code en macOS la guarda en el llavero).
 *
 * PARA QUE SIRVE. Una sesion marcada como vencida por el error de una fase se
 * limpia cuando hay prueba de que el operador volvio a entrar. Si lo hizo desde
 * su terminal (`codex login`) y no desde la app, la unica huella es este
 * archivo reescrito DESPUES del fallo. Solo se mira su fecha: el contenido es
 * la credencial y no se lee.
 *
 * @param {string} runtime
 * @param {Record<string, string|undefined>} env
 * @returns {string|null}
 */
export function archivoDeSesion(runtime, env) {
  const home = env?.HOME;
  if (runtime === "codex") {
    const dir = env?.CODEX_HOME || (home ? join(home, ".codex") : null);
    return dir ? join(dir, "auth.json") : null;
  }
  if (runtime === "claude-agent-sdk") {
    // En Linux Claude Code guarda las credenciales aqui; en macOS van al
    // llavero y este archivo no existe, que es un «no se sabe», no un «no».
    const dir = env?.CLAUDE_CONFIG_DIR || (home ? join(home, ".claude") : null);
    return dir ? join(dir, ".credentials.json") : null;
  }
  return null;
}
