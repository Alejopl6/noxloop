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
 * @typedef {(argv: string[], opciones: {env: Record<string, string>}) =>
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
export async function ejecutorDeProceso(argv, { env }) {
  const [comando, ...args] = argv;
  const l = await lanzar({
    comando,
    args,
    env,
    // Ninguna variable del entorno viaja por argv aqui, asi que mirarlas
    // todas no da falsos positivos: se deja la guarda en su modo mas estricto.
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

  let salida;
  try {
    salida = await ejecutar([...r.estado], { env });
  } catch (e) {
    const ausente = e?.code === "ENOENT";
    return {
      ...base,
      conectado: false,
      metodo: null,
      binarioPresente: !ausente,
      detalle: ausente ? `el binario \`${r.binario}\` no esta instalado` : `no se pudo ejecutar \`${r.estado.join(" ")}\``,
      causa: ausente
        ? `el binario \`${r.binario}\` no se encontro en el PATH del entorno declarado${env.PATH ? "" : " (ese entorno no trae PATH)"}. ` +
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
