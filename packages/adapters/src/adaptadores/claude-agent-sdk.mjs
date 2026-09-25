// T183 — el adaptador de referencia: formaliza lo que v1 ya hace.
//
// NO INVENTA NADA. El motor de v1 ya elegia entre el SDK y el CLI segun la
// disponibilidad del paquete (`via: sdkAvailable() ? "agent-sdk" : "cli"`), ya
// retomaba sesiones y ya entregaba los hooks por `--settings`. Lo que faltaba
// era que esa eleccion fuera parte de un contrato y que la degradacion se
// DECLARARA en vez de ocurrir.
//
// EL SDK PUEDE NO ESTAR. Es `optionalDependencies` del motor, y la constitucion
// lo dice: "el SDK del modelo es la unica dependencia de runtime, y si falta, el
// motor degrada al CLI en vez de morir". Por eso se resuelve de forma perezosa y
// dentro de un `try`: un `import` estatico convertiria el paquete de adaptadores
// en incargable en una maquina que no lo tiene, que es justo el caso que este
// adaptador existe para cubrir.
//
// LA DEGRADACION NO ES EQUIVALENTE, Y SE DICE. Por el camino del CLI cada fase
// arranca un proceso y un contexto frios, y `--effort` no viaja: el argv del
// camino degradado de v1 no lo pasa. Un adaptador que siguiera declarando
// `effort: true` ahi estaria prometiendo un nivel de esfuerzo que el runtime
// degrada en silencio, y nadie sabria por que las fases salen peor.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ejecutorDeProceso, entornoDeclarado, errorDeSesion, estadoDeAutenticacion } from "../autenticacion.mjs";
import { resolverBinario } from "../binarios.mjs";
import {
  PROMPT_DESATENDIDO,
  conSesionReconocida,
  esRevision,
  normalizarPeticion,
  resultadoDeFase,
  validarPeticion,
} from "../contrato.mjs";
import { lanzar, leerLanzamiento } from "../proceso.mjs";
import { emisorDeEventos, eventosDeMensajeClaude } from "../eventos.mjs";
import { esCorteDePresupuesto, leerResultadoJson } from "../salida.mjs";

const PAQUETE = "@anthropic-ai/claude-agent-sdk";

/**
 * Las herramientas que una fase puede usar sin que nadie apruebe nada.
 *
 * HACE FALTA porque auto-aceptar ediciones de archivo no alcanza: las
 * herramientas MCP siguen pidiendo permiso, y en una sesion sin persona delante
 * no hay quien lo conceda. Es una lista explicita a proposito: lo que no este en
 * ella sigue requiriendo aprobacion, y los hooks son una capa distinta que corre
 * igual.
 */
export const HERRAMIENTAS_POR_DEFECTO = Object.freeze([
  "Bash", "Read", "Write", "Edit", "MultiEdit", "Grep", "Glob", "Task", "Skill", "TodoWrite", "WebFetch",
]);

/**
 * Lo que una REVISION puede hacer sin preguntar: leer, y mirar el diff.
 *
 * POR QUE UNA LISTA CERRADA Y `dontAsk`. La revision corria con la lista del
 * implementador y `acceptEdits`: podia escribir, y cualquier herramienta fuera
 * de la lista se quedaba esperando un permiso que nadie iba a conceder —con
 * `-p` eso no cuelga, pero la fase se pierde pidiendolo—. El referente (Nodal)
 * lanza su revisor con `--permission-mode dontAsk` y una lista cerrada: lo
 * permitido corre, lo demas se NIEGA sin preguntar, y el revisor sigue con lo
 * que tiene. Verificado contra lo instalado: `claude --help` (2.1.281) lista
 * `dontAsk` entre las opciones de `--permission-mode`, y el SDK (0.3.274) lo
 * declara en `PermissionMode`: "Don't prompt for permissions, deny if not
 * pre-approved".
 *
 * NUNCA `bypassPermissions` ni `--dangerously-skip-permissions`: la revision es
 * la fase que menos permisos necesita, y saltarse la capa de permisos para que
 * no pregunte seria resolver el problema al reves.
 *
 * El gate del repositorio se suma por fase (`comandosPermitidos`): el revisor
 * tiene que poder correr los tests para no afirmar que pasan sin verlos.
 */
export const HERRAMIENTAS_DE_REVISION = Object.freeze([
  "Read", "Grep", "Glob",
  "Bash(git diff:*)", "Bash(git status:*)", "Bash(git log:*)", "Bash(git show:*)",
]);

/** Lo que una revision no puede usar aunque otra capa de configuracion lo permita. */
export const PROHIBIDAS_EN_REVISION = Object.freeze(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/**
 * Prefijos que no entran en la lista aunque el gate los traiga: `bash -c` o
 * `env` delante de un comando permitido devuelven el agujero entero. Es la
 * misma lista que `comandosPermitidos` del motor.
 */
const NUNCA_EN_REVISION = new Set(["env", "sudo", "command", "eval", "exec", "bash", "sh", "zsh", "xargs", "time", "nohup", "ssh"]);

/**
 * La lista cerrada de una revision: las de lectura, `git` de consulta y cada
 * segmento del gate como prefijo de `Bash`.
 *
 * Un gate es una tuberia escrita por una persona (`npm test && npm run
 * typecheck`): Claude Code juzga cada subcomando por separado, asi que se parte
 * igual. Un segmento con parentesis no se puede escribir como regla `Bash(...)`
 * sin romperla, y se descarta en vez de adivinar.
 *
 * @param {readonly string[]} [comandos]
 * @returns {string[]}
 */
export function herramientasDeRevision(comandos = []) {
  const reglas = new Set(HERRAMIENTAS_DE_REVISION);
  for (const comando of comandos) {
    for (const trozo of String(comando).split(/&&|\|\||;|\|/)) {
      const segmento = trozo.trim().replace(/\s+/g, " ");
      if (!segmento || /[()]/.test(segmento)) continue;
      const primero = segmento.split(" ")[0].replace(/^.*\//, "");
      if (NUNCA_EN_REVISION.has(primero)) continue;
      reglas.add(`Bash(${segmento}:*)`);
    }
  }
  return [...reglas];
}

/**
 * Las variables que ESTE runtime necesita recibir, si la maquina las tiene.
 *
 * VIVEN AQUI Y NO EN EL CABLEADO DEL MOTOR a proposito. El entorno de una fase
 * se construye: lo que no esta declarado no viaja. Si el motor nombrara estas
 * variables, soportar el runtime siguiente exigiria volver a tocar el motor —
 * que es exactamente lo que el principio VI prohibe. El runtime declara lo
 * suyo; el cableado solo pregunta.
 *
 * NO SON EL CAMINO DE UN SECRETO CUALQUIERA. Son las credenciales del modelo,
 * sin las cuales este adaptador no puede invocar nada; lo que un agente pueda
 * alcanzar aparte de eso sigue saliendo del grant y de ningun otro sitio.
 *
 * @type {string[]}
 */
export const VARIABLES_DEL_RUNTIME = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
];

/**
 * Las variables NO secretas sin las que la sesion local de Claude Code no se
 * encuentra.
 *
 * EL RIESGO QUE CIERRA. El entorno de una fase se construye por nombre y lo que
 * no esta declarado no viaja (principio IX). Si de esa lista falta lo que el
 * runtime necesita para encontrar SU sesion, la fase arranca y muere con "no
 * autenticado" aunque el operador tenga `claude` logueado en la misma maquina.
 * Medido en macOS: `env -i HOME=... PATH=... claude auth status` contesta
 * `loggedIn: false`; con `USER` añadido, `loggedIn: true`. La sesion vive en el
 * llavero ("Claude Code-credentials") y se busca POR USUARIO.
 *
 * POR QUE LAS DECLARA EL RUNTIME Y NO SOLO EL MOTOR. El motor ya pasa `HOME`,
 * `USER`, `PATH`... como variables de la maquina, pero esa lista es del motor y
 * puede cambiar por motivos que no tienen nada que ver con Claude. Lo que este
 * runtime necesita para autenticarse lo dice el, igual que sus credenciales
 * (principio VI): `CLAUDE_CONFIG_DIR` no lo sabria nombrar nadie mas.
 *
 * NO SON SECRETOS, y por eso van aparte de `requiredEnv`: la guarda de argv mira
 * las secretas, y `HOME` es prefijo de casi cualquier ruta absoluta — tratarla
 * como secreta dejaria la guarda dando positivo siempre. Ninguna de estas
 * contiene una credencial: dicen DONDE esta la sesion, no cual es.
 *
 * @type {readonly string[]}
 */
export const VARIABLES_DE_SESION = Object.freeze([
  "HOME",
  "USER",
  "LOGNAME",
  "PATH",
  "TMPDIR",
  "CLAUDE_CONFIG_DIR",
]);

/** @returns {{disponible: boolean, motivo: string|null}} */
export function sdkDisponible() {
  try {
    createRequire(import.meta.url).resolve(PAQUETE);
    return { disponible: true, motivo: null };
  } catch (e) {
    return { disponible: false, motivo: e?.message || String(e) };
  }
}

/**
 * @param {{
 *   home?: string|null,
 *   comando?: string,
 *   argsPrefijo?: string[],
 *   hooks?: object|null,
 *   pluginCargado?: boolean,
 *   herramientas?: readonly string[],
 *   sdk?: ((opts: any) => AsyncIterable<any>)|null,
 *   resolverSdk?: () => {disponible: boolean, motivo: string|null},
 *   directoriosExtra?: string[],
 *   timeoutMs?: number,
 *   alLanzar?: (l: any) => void,
 *   alProgreso?: (e: {tipo: string, detalle?: any}, peticion: any) => void,
 *   ejecutarAutenticacion?: import("../autenticacion.mjs").Ejecutor,
 *   entornoDisponible?: Record<string, string|undefined>,
 * }} [opts]
 * @returns {import("../contrato.mjs").AgentAdapter}
 */
export function crearAdaptadorClaude(opts = {}) {
  const {
    // SIN `comando` se busca `claude` en cada fase, con el PATH de esa fase y
    // las carpetas donde lo dejan los instaladores: desde una app de macOS el
    // nombre a secas da ENOENT. Ver `binarios.mjs`.
    comando: comandoDeclarado = null,
    argsPrefijo = [],
    hooks = null,
    // Si el plugin de noxloop viaja cargado con este runtime. Por defecto no:
    // el motor no lo carga, y la mayoria de las maquinas no lo tienen.
    pluginCargado = false,
    herramientas = HERRAMIENTAS_POR_DEFECTO,
    sdk = null,
    resolverSdk = sdkDisponible,
    directoriosExtra = [],
    timeoutMs = 30 * 60_000,
    alLanzar,
    alProgreso,
    ejecutarAutenticacion,
    // DE DONDE se toman los valores de lo que este runtime declara, para el
    // preflight. Nunca se pasa entero: se filtra por nombre. Sin el, el
    // preflight corre con un entorno vacio, sin PATH, y no encuentra el binario.
    entornoDisponible = {},
  } = opts;

  /** El nombre con el que se dice en los mensajes: la ruta si se declaro, `claude` si no. */
  const comando = comandoDeclarado ?? "claude";
  /** La ruta ABSOLUTA del binario para una fase con este entorno. */
  const binarioPara = (/** @type {Record<string, string>} */ env) =>
    comandoDeclarado ?? resolverBinario("claude", { env }) ?? "claude";

  /** El ejecutor del preflight, apuntado al binario que este adaptador usa de verdad. */
  const ejecutar = ejecutarAutenticacion
    ?? ((/** @type {string[]} */ argv, /** @type {any} */ o) => ejecutorDeProceso([binarioPara(o?.env ?? {}), ...argsPrefijo, ...argv.slice(1)], o));

  /** El camino que se va a usar. Se resuelve una vez: no cambia a mitad de un run. */
  const conSdk = Boolean(sdk) || resolverSdk().disponible;
  const via = conSdk ? "agent-sdk" : "cli";

  /**
   * El transporte del SDK, resuelto PEREZOSAMENTE y una sola vez.
   *
   * EL FALLO QUE CIERRA. `runPhase` elegia `conSdk && sdk ? porSdk : porCli`, y
   * `sdk` solo existia si alguien lo inyectaba. O sea: en una maquina con el
   * paquete instalado, el adaptador declaraba `effort: true` y `via:
   * "agent-sdk"` y despues corria por el CLI — donde el nivel de esfuerzo no
   * viaja y cada fase arranca un proceso y un contexto frios. La degradacion
   * mas cara del producto, ocurriendo en silencio dentro del archivo que
   * existe para declararla.
   *
   * El import va dinamico y dentro de un `try` porque el paquete es
   * `optionalDependencies` y puede no estar: uno estatico volveria incargable
   * este modulo en la maquina que no lo tiene, que es el caso que el adaptador
   * existe para cubrir.
   */
  /** @type {((o: any) => AsyncIterable<any>)|null|undefined} */
  let transporte = sdk;
  async function resolverTransporte() {
    if (transporte !== undefined && transporte !== null) return transporte;
    try {
      const mod = await import(PAQUETE);
      transporte = mod.query;
    } catch {
      transporte = null;
    }
    return transporte;
  }

  return {
    id: "claude-agent-sdk",

    requiredEnv: [...VARIABLES_DEL_RUNTIME],

    sessionEnv: [...VARIABLES_DE_SESION],

    capabilities() {
      return {
        resume: true,
        cost: true,
        // Por el camino degradado el nivel de esfuerzo NO viaja. Declararlo en
        // false es la unica forma honesta: el motor deja de prometerlo.
        effort: conSdk,
        // Sin ajustes de hooks entregados no se puede afirmar que corran, y
        // afirmarlo abre el paso RED sin que nadie lo mire. Un adaptador sin
        // hooks no es elegible como implementador.
        hooks: Boolean(hooks),
        // No enumera modelos: los que acepta cambian sin que este paquete se
        // entere. Una lista corta inventada haria que la pantalla ofreciera
        // solo esos, que es peor que decir que no se sabe.
        models: "desconocido",
        // Entiende `/noxloop-task ...` solo si el plugin de noxloop esta
        // CARGADO. Medido en un run real: sin el plugin, Claude no reconocio
        // `/noxloop-plan` y paso la fase explorando el home para adivinar que
        // se le pedia. Por defecto el motor le manda la fase entera.
        comandos: Boolean(pluginCargado),
      };
    },

    async preflight() {
      // EL MISMO ENTORNO QUE TENDRA LA FASE, no uno inventado para el doctor:
      // si aqui se preguntara con mas variables de las que la fase recibe, el
      // preflight diria "hay sesion" y la fase no la encontraria.
      const env = entornoDeclarado(entornoDisponible, [...VARIABLES_DE_SESION, ...VARIABLES_DEL_RUNTIME]);
      const autenticacion = await estadoDeAutenticacion("claude-agent-sdk", { ejecutar, env });

      if (!autenticacion.binarioPresente) {
        if (!conSdk) {
          // Ni SDK ni CLI. Se comprueba AQUI, en el doctor, y no a mitad de un
          // run: un ENOENT en la fase GREEN llega con la tarea repartida, el
          // worktree creado y el operador mirando otra cosa.
          const motivo = resolverSdk().motivo;
          return {
            ok: false,
            causa:
              `ni el SDK \`${PAQUETE}\` esta instalado (${motivo}) ni el binario \`${comando}\` responde. ` +
              "Sin ninguno de los dos, este runtime no puede invocar nada.",
            accion:
              `Instala \`${PAQUETE}\` en la maquina del servicio, o deja \`${comando}\` en el PATH del entorno ` +
              "que la boveda entrega a las fases. Si lo que quieres es probar el recorrido sin modelo, apunta el " +
              "agente al runtime `fake`.",
            autenticacion,
          };
        }
        // Con el SDK y sin el CLI, las fases corren igual (el SDK trae el suyo),
        // pero no hay binario al que preguntarle por la sesion. Con key, la hay;
        // sin key NO SE AFIRMA nada: se deja pasar y se dice que no se verifico.
        if (autenticacion.metodo === "api_key" || tieneKey(env)) return { ok: true, via, autenticacion };
        return {
          ok: true,
          via,
          autenticacion,
          advertencia:
            `no se pudo verificar la sesion de Claude: el SDK esta, pero \`${comando}\` no, y es el que contesta ` +
            "`auth status`. Si la primera fase falla con \"no autenticado\", corre `claude auth login` o pega la " +
            "API key en Settings → Modelos.",
        };
      }

      if (!autenticacion.conectado) {
        return { ok: false, causa: autenticacion.causa, accion: autenticacion.accion, autenticacion };
      }

      if (conSdk) return { ok: true, via, autenticacion };
      return {
        ok: true,
        via,
        autenticacion,
        degradacion:
          `el SDK \`${PAQUETE}\` no esta instalado (${resolverSdk().motivo}), asi que las fases van por el CLI: cada una ` +
          "arranca un proceso y un contexto frios, y el nivel de esfuerzo no viaja. Funciona, pero no es " +
          "equivalente — y se dice aqui para que nadie lo descubra por el coste.",
      };
    },

    async runPhase(req, opcionesDeFase = {}) {
      const { peticion, degradaciones } = normalizarPeticion(req);
      const v = validarPeticion(peticion);
      if (!v.ok) {
        return {
          ...resultadoDeFase({
            ok: false,
            subtype: v.problems.some((x) => x.startsWith("env:")) ? "entorno_ausente" : "peticion_invalida",
            text: `no se invoca el runtime:\n  - ${v.problems.join("\n  - ")}`,
          }),
          degradaciones,
        };
      }

      if (!conSdk && peticion.effort) {
        degradaciones.push(
          `el nivel de esfuerzo "${peticion.effort}" no viaja por el camino del CLI y se ignora: el adaptador ` +
            "declara `effort: false` mientras el SDK no este instalado",
        );
      }

      const query = conSdk ? await resolverTransporte() : null;
      if (conSdk && !query) {
        // Se resolvio como instalado y no se pudo cargar. Se dice: el camino
        // que se va a usar no es el que las capacidades prometieron.
        degradaciones.push(
          `el paquete \`${PAQUETE}\` resolvio como instalado pero no se pudo cargar, asi que la fase va por el ` +
            "CLI: cada una arranca un proceso y un contexto frios, y el nivel de esfuerzo no viaja",
        );
      }

      // El transcript de la fase, si quien llama lo pidio. Normalizado aqui:
      // el motor no sabe —ni tiene por que— que esto es Claude.
      const emitir = emisorDeEventos(opcionesDeFase.alEvento);
      const salida = query
        ? await porSdk({ sdk: query, peticion, hooks, herramientas, directoriosExtra, alLanzar, alProgreso, emitir })
        : await porCli({ comando: binarioPara(peticion.env), argsPrefijo, peticion, hooks, herramientas, directoriosExtra, timeoutMs, alLanzar, signal: opcionesDeFase.signal, emitir });

      return { ...salida, degradaciones };
    },
  };
}

/** @param {any} p */
async function porCli(p) {
  const { peticion } = p;
  const revision = esRevision(peticion.phase);
  const args = [
    ...p.argsPrefijo,
    "-p", peticion.prompt,
    "--output-format", "json",
    // Ver `PROMPT_DESATENDIDO`: se AÑADE al prompt de sistema de Claude Code,
    // no lo reemplaza.
    "--append-system-prompt", PROMPT_DESATENDIDO,
    ...(revision
      ? [
          // Ver `HERRAMIENTAS_DE_REVISION`. Separadas por coma, que es como las
          // pasa el propio SDK al CLI: una regla `Bash(git diff:*)` lleva un
          // espacio dentro.
          "--permission-mode", "dontAsk",
          "--allowedTools", herramientasDeRevision(peticion.comandosPermitidos).join(","),
          "--disallowedTools", PROHIBIDAS_EN_REVISION.join(","),
        ]
      : ["--permission-mode", "acceptEdits", "--allowedTools", [...p.herramientas].join(" ")]),
  ];
  // `--settings` acepta el JSON entero: no hay archivo que crear, ni limpiar, ni
  // que quede colgado en un worktree si el proceso muere a mitad.
  if (p.hooks) args.push("--settings", JSON.stringify(p.hooks));
  if (peticion.model) args.push("--model", peticion.model);
  if (peticion.resume) args.push("--resume", peticion.resume);
  // Los directorios que la fase puede alcanzar ademas de su worktree. Sin
  // esto, la fase de planificacion no puede escribir el plan —que vive en el
  // home, fuera del arbol de trabajo a proposito— y el motor lo lee como que
  // no se pudo planificar.
  for (const d of p.directoriosExtra || []) args.push("--add-dir", d);

  try {
    const l = await lanzar({
      comando: p.comando,
      args,
      env: peticion.env,
      // Cuales de esas variables son secretas. Sin esto se miran todas, y el
      // valor de `HOME` es prefijo de casi cualquier ruta absoluta de la
      // maquina: con un `--add-dir` del home en argv la guarda daba positivo
      // siempre y ninguna fase se podia lanzar.
      secretos: peticion.secretos,
      cwd: peticion.cwd,
      signal: p.signal,
      timeoutMs: p.timeoutMs,
      alLanzar: (x) => {
        if (p.alLanzar) {
          p.alLanzar({ registro: x, fase: peticion.phase, resume: peticion.resume, model: peticion.model, effort: null });
        }
      },
    });
    return traducirCli(l, p.emitir);
  } catch (e) {
    return resultadoDeFase({
      ok: false,
      subtype: /** @type {any} */ (e).codigo || "lanzamiento_fallo",
      text: e.message,
    });
  }
}

/**
 * @param {import("../proceso.mjs").Lanzamiento} l
 * @param {(e: any) => void} [emitir]
 */
function traducirCli(l, emitir = () => {}) {
  const r = traducirCliSinSesion(l, emitir);
  // LA SESION VENCIDA, reconocida por su error. Se mira lo que el runtime dijo
  // DE SU ERROR —el `result` de un `is_error`, o su stderr—, y solo si la fase
  // fallo: la prosa de una fase que termino bien no cuenta.
  const crudo = leerResultadoJson(l.stdout);
  const delError = [crudo?.isError ? crudo.texto : "", l.stderr, crudo ? "" : l.stdout].filter(Boolean).join("\n");
  return conSesionReconocida("claude-agent-sdk", r, delError, errorDeSesion);
}

/**
 * @param {import("../proceso.mjs").Lanzamiento} l
 * @param {(e: any) => void} emitir
 */
function traducirCliSinSesion(l, emitir) {
  if (l.cancelado) {
    return resultadoDeFase({ ok: false, subtype: "cancelada", text: `la fase se cancelo${l.stderr ? `: ${l.stderr.trim()}` : ""}` });
  }
  const crudo = leerResultadoJson(l.stdout);
  if (!crudo) {
    return resultadoDeFase({
      ok: false,
      subtype: "stream_incompleto",
      text: `el runtime salio con ${l.code} sin dejar un resultado legible.\n${l.stderr.trim() || l.stdout.trim()}`,
    });
  }
  // POR EL CLI SOLO HAY RESULTADO, y se dice asi: `--output-format json` es
  // un objeto al final, sin los mensajes de en medio. El transcript de este
  // camino tiene una linea —el resultado, con sus tokens si los hubo—, que es
  // menos que el del SDK pero no inventa nada.
  emitir({
    tipo: crudo.isError ? "error" : "resultado",
    contenido: crudo.isError && !crudo.texto ? `el runtime termino con error (${crudo.subtype ?? "sin subtipo"})` : crudo.texto,
    ...(crudo.tokens ? { tokens: crudo.tokens } : {}),
  });
  const budgetExhausted = esCorteDePresupuesto(crudo.subtype);
  return resultadoDeFase({
    // Codigo de salida y `is_error`. El texto que devolvio el modelo no entra
    // en esta cuenta, por mucho que diga que fue todo bien.
    ok: l.code === 0 && !crudo.isError && !budgetExhausted,
    sessionId: crudo.sessionId,
    usd: crudo.usd,
    text: crudo.texto,
    budgetExhausted,
    subtype: crudo.subtype,
  });
}

/**
 * El camino del SDK: una sesion en proceso, reducida a un hecho.
 *
 * @param {any} p
 */
async function porSdk(p) {
  const { peticion } = p;
  const revision = esRevision(peticion.phase);
  const options = {
    cwd: peticion.cwd,
    // EXACTAMENTE `req.env`. Es el mismo invariante que del lado del CLI, y es
    // el mas facil de perder aqui: el SDK corre en proceso y la tentacion de
    // "heredar lo que ya hay" no necesita ni escribir una linea de mas.
    env: peticion.env,
    // Ver `HERRAMIENTAS_DE_REVISION`: la revision niega sin preguntar lo que no
    // este en su lista cerrada.
    permissionMode: revision ? "dontAsk" : "acceptEdits",
    allowedTools: revision ? herramientasDeRevision(peticion.comandosPermitidos) : [...p.herramientas],
    ...(revision ? { disallowedTools: [...PROHIBIDAS_EN_REVISION] } : {}),
    // El prompt de Claude Code, con lo de `PROMPT_DESATENDIDO` AÑADIDO al final.
    systemPrompt: { type: "preset", preset: "claude_code", append: PROMPT_DESATENDIDO },
    includePartialMessages: true,
    // Ver el mismo campo del lado del CLI: sin el home, la planificacion no
    // tiene donde dejar el plan.
    ...(p.directoriosExtra?.length ? { additionalDirectories: [...p.directoriosExtra] } : {}),
    ...(p.hooks ? { settings: JSON.stringify(p.hooks) } : {}),
    ...(peticion.model ? { model: peticion.model } : {}),
    ...(peticion.effort ? { effort: peticion.effort } : {}),
    ...(peticion.resume ? { resume: peticion.resume } : {}),
  };

  if (p.alLanzar) {
    p.alLanzar({
      registro: { comando: PAQUETE, argv: [], env: { ...peticion.env }, cwd: peticion.cwd, pid: null, cancelado: false, code: null, stdout: "", stderr: "" },
      fase: peticion.phase,
      resume: peticion.resume,
      model: peticion.model,
      effort: peticion.effort ?? null,
    });
  }

  let sessionId = null;
  let final = null;
  let texto = "";
  const nombresDeHerramientas = new Map();
  const emitir = p.emitir || (() => {});
  try {
    for await (const m of p.sdk({ prompt: peticion.prompt, options })) {
      if (m?.type === "system" && m.subtype === "init" && m.session_id) sessionId = m.session_id;
      // EL TRANSCRIPT, MENSAJE A MENSAJE: el mismo stream que ya se recorre
      // para el resultado, traducido a los cinco tipos del contrato.
      for (const e of eventosDeMensajeClaude(m, nombresDeHerramientas)) emitir(e);
      // EL PROGRESO SE EMITE MIENTRAS PASA. Una fase puede durar minutos: sin
      // esto, quien mira la bitacora ve una linea al empezar y nada hasta que
      // termina, y no puede distinguir una fase trabajando de una colgada.
      if (p.alProgreso && m?.type === "assistant") {
        for (const bloque of m.message?.content || []) {
          if (bloque?.type === "tool_use") {
            p.alProgreso({ tipo: "tool_use", detalle: { nombre: bloque.name, id: bloque.id, entrada: bloque.input } }, peticion);
          }
        }
      }
      if (m?.type === "result") {
        final = m;
        if (m.session_id) sessionId = m.session_id;
        texto = typeof m.result === "string" ? m.result : "";
      }
    }
  } catch (e) {
    const mensaje = e?.message || String(e);
    return conSesionReconocida(
      "claude-agent-sdk",
      resultadoDeFase({ ok: false, sessionId, subtype: "transporte_fallo", text: mensaje }),
      mensaje,
      errorDeSesion,
    );
  }

  if (!final) {
    // Un stream que termina sin `result` no se da por bueno: es el caso de un
    // proceso matado o una conexion cortada.
    return resultadoDeFase({ ok: false, sessionId, subtype: "stream_incompleto", text: texto || "el stream termino sin resultado" });
  }

  const subtype = typeof final.subtype === "string" ? final.subtype : null;
  const budgetExhausted = esCorteDePresupuesto(subtype);
  const r = resultadoDeFase({
    ok: final.is_error !== true && !budgetExhausted,
    sessionId,
    usd: typeof final.total_cost_usd === "number" ? final.total_cost_usd : null,
    text: texto,
    budgetExhausted,
    subtype,
  });
  // Solo el `result` de un `is_error` es el error del runtime; ver `traducirCli`.
  return conSesionReconocida("claude-agent-sdk", r, final.is_error === true ? texto : "", errorDeSesion);
}

/** Si en el entorno declarado viaja una credencial del modelo. El valor no se mira, solo que este. */
function tieneKey(/** @type {Record<string, string>} */ env) {
  return ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"].some((n) => typeof env[n] === "string" && env[n] !== "");
}

/**
 * Las fixtures con las que este adaptador corre la suite de contrato.
 *
 * CORREN POR EL CAMINO DEL CLI, y es deliberado: es el camino degradado, el que
 * corre en una maquina sin el SDK instalado, y el que nadie mira. El camino del
 * SDK tiene sus propias pruebas con el transporte inyectado.
 *
 * @param {{dir: string}} opts
 */
export function fixturesDeContrato({ dir }) {
  const GUIONADO = fileURLToPath(new URL("../proceso-guionado.mjs", import.meta.url));

  const home = join(dir, "home");
  const cwd = join(dir, "worktree");
  const vecino = join(dir, "vecino");
  for (const d of [home, cwd, vecino]) mkdirSync(d, { recursive: true });
  writeFileSync(join(vecino, "de-otra-tarea.txt"), "no se toca");

  const guion = join(dir, "guion.json");
  const visto = join(dir, "visto.json");
  const escribirGuion = (/** @type {any} */ g) => {
    const exito = g.exito !== false;
    writeFileSync(
      guion,
      JSON.stringify({
        colgar: Boolean(g.colgar),
        code: exito ? 0 : 1,
        salida: JSON.stringify({
          session_id: g.sessionId ?? (g.resumeEcho ? g.resumeEcho : "ses-claude-1"),
          subtype: g.subtype ?? (exito ? "success" : "error"),
          is_error: !exito,
          num_turns: 1,
          total_cost_usd: g.usd === undefined ? 0.042 : g.usd,
          result: g.texto ?? "hecho",
        }),
      }),
    );
  };
  escribirGuion({ texto: "hecho", exito: true });

  /** @type {any} */
  let ultimo = null;
  const hooks = { hooks: { PreToolUse: [{ matcher: "Edit|Write|MultiEdit", hooks: [{ type: "command", command: "noxloop-hook tdd" }] }] } };
  const comun = {
    home,
    comando: process.execPath,
    argsPrefijo: [GUIONADO, guion, visto, "-", "--"],
    hooks,
    // El SDK se declara AUSENTE para forzar el camino del CLI, que es el que
    // estas fixtures ejercitan. No se mira si esta instalado: la suite tiene que
    // dar lo mismo en una maquina con SDK y en una sin el.
    resolverSdk: () => ({ disponible: false, motivo: "las fixtures corren el camino degradado a proposito" }),
    alLanzar: (/** @type {any} */ l) => { ultimo = l; },
  };

  // La sesion se guiona como iniciada: la suite no mide el login del operador,
  // mide el contrato. `sinRuntime` NO la lleva: pregunta de verdad a un binario
  // que no existe, que es el caso que `preflight-diagnostica` tiene que ver.
  const conSesion = async () => ({ code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }), stderr: "" });

  return {
    id: "claude-agent-sdk",
    adaptador: crearAdaptadorClaude({ ...comun, ejecutarAutenticacion: conSesion }),
    sinRuntime: crearAdaptadorClaude({ ...comun, comando: join(dir, "no-existe-el-binario"), argsPrefijo: [] }),
    home,
    cwd,
    vecino,
    secreto: { nombre: "ANTHROPIC_CENTINELA", valor: "valor-centinela-de-la-boveda-9137" },

    guionar(/** @type {any} */ g) {
      ultimo = null;
      // Se BORRA la constancia del hijo anterior. Sin esto, una fase cuyo
      // subproceso no llega a arrancar leeria el archivo de la fase de antes y
      // `env-exacto`, `cwd-respetado` y `cancelable` seguirian en verde sobre un
      // proceso que ya no existe.
      rmSync(visto, { force: true });
      escribirGuion(g);
    },

    ultimoLanzamiento() {
      return leerLanzamiento(ultimo, visto);
    },

    /**
     * La prueba de que los hooks viajan: el runtime los recibe por `--settings`
     * y los corre en su propio subproceso. Se comprueba que la declaracion sale
     * en el argv, que es hasta donde llega la responsabilidad del adaptador.
     */
    evidenciaDeHooks() {
      const l = leerLanzamiento(ultimo, visto);
      if (!l) return false;
      const i = l.argv.indexOf("--settings");
      if (i < 0) return false;
      try {
        return Object.keys(JSON.parse(l.argv[i + 1]).hooks || {}).length > 0;
      } catch {
        return false;
      }
    },

    peticion(/** @type {any} */ over = {}) {
      return {
        phase: "GREEN",
        taskId: "T-1",
        task: { id: "T-1" },
        item: { id: "IT-1" },
        cwd,
        resume: null,
        model: "un-modelo",
        prompt: "/noxloop-task IT-1 T-1 --phase GREEN",
        tier: "normal",
        env: { ANTHROPIC_CENTINELA: "valor-centinela-de-la-boveda-9137" },
        ...over,
      };
    },

    cerrar() {},
  };
}
