// T184 — el segundo runtime. Su funcion no es existir: es probar que el
// contrato aisla.
//
// POR QUE EXACTAMENTE DOS, Y NO UNO NI VEINTE. Uno no valida nada: con un solo
// adaptador la abstraccion es una capa de indireccion sin prueba, y la regla de
// revisor-distinto-del-implementador no se puede cumplir. Veinte es la
// competencia que la definicion de producto declara perdida de antemano. Dos
// runtimes bien aislados valen mas que veinte a medias.
//
// LO QUE ESTE ARCHIVO DEMUESTRA. Este runtime no se parece al primero: no
// retoma sesiones, no reporta coste, no corre hooks y habla otro protocolo de
// salida (un evento por linea en vez de un objeto). Si el contrato estuviera
// escrito a la medida del primero, aqui habria hecho falta un `if` en el motor.
// No hizo falta ninguno.
//
// TAMBIEN PUEDE IMPLEMENTAR, y eso cambio. Con `hooks: false` el paso RED no lo
// bloquea un hook dentro del subproceso: lo fuerza el MOTOR despues de cada
// fase, mirando el worktree y revirtiendo lo que la fase escribio fuera de su
// alcance (`packages/engine/src/alcance-de-fase.mjs`). Y con `comandos: false`
// el motor le manda el texto del encargo en vez de `/noxloop-task ...`, que
// este runtime no sabe expandir (`packages/engine/src/comandos-sin-plugin.mjs`).
//
// SU DEGRADACION MAS CARA ES `cost: false`. El techo de gasto de un hito no se
// le puede aplicar. Eso no se arregla devolviendo ceros: se declara, y el motor
// lo dice al arrancar el run en vez de aplicar un limite que no puede
// dispararse.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
import { emisorDeEventos, eventosDeLineaCodex, jsonDeLinea } from "../eventos.mjs";
import { leerResultadoJsonl } from "../salida.mjs";

/**
 * La credencial del modelo que este runtime puede recibir de la boveda.
 *
 * NO ESTABA DECLARADA, y el efecto era que la key de OpenAI guardada en Settings
 * → Modelos nunca llegaba a la fase de codex: el entorno se construye por
 * nombre, y un nombre que nadie declara no viaja. Es secreta: entra en la
 * guarda de argv.
 *
 * @type {readonly string[]}
 */
export const VARIABLES_DEL_RUNTIME = Object.freeze(["OPENAI_API_KEY"]);

/**
 * Las variables NO secretas sin las que la sesion local de Codex no se
 * encuentra.
 *
 * `codex login` deja la sesion en `$CODEX_HOME/auth.json`, `~/.codex` por
 * defecto. Si el operador movio CODEX_HOME y la variable no viaja, la fase
 * busca en `~/.codex`, no encuentra nada, y falla con "no autenticado" con el
 * operador logueado. `HOME`/`USER`/`PATH` las necesita para lo mismo y para
 * encontrarse a si mismo; se declaran aqui aunque el motor ya las pase como
 * variables de la maquina, porque esa lista es del motor y lo que este runtime
 * necesita lo dice el (principio VI).
 *
 * Ninguna es una credencial: dicen DONDE esta la sesion, no cual es. Por eso
 * van aparte de `requiredEnv` y no entran en la guarda de argv, donde `HOME`
 * —prefijo de casi cualquier ruta— daria positivo siempre.
 *
 * @type {readonly string[]}
 */
export const VARIABLES_DE_SESION = Object.freeze(["HOME", "USER", "LOGNAME", "PATH", "TMPDIR", "CODEX_HOME"]);

/**
 * @param {{
 *   home?: string|null,
 *   comando?: string,
 *   argsPrefijo?: string[],
 *   timeoutMs?: number,
 *   alLanzar?: (l: any) => void,
 *   ejecutarAutenticacion?: import("../autenticacion.mjs").Ejecutor,
 *   entornoDisponible?: Record<string, string|undefined>,
 *   directoriosDelPlan?: string[],
 * }} [opts]
 * @returns {import("../contrato.mjs").AgentAdapter}
 */
export function crearAdaptadorCodex(opts = {}) {
  const {
    // SIN `comando` se busca `codex` en cada fase (PATH de la fase, carpetas de
    // los instaladores y `~/.codex/bin`): desde una app de macOS el nombre a
    // secas da ENOENT. Ver `binarios.mjs`.
    comando: comandoDeclarado = null,
    argsPrefijo = [],
    timeoutMs = 30 * 60_000,
    alLanzar,
    ejecutarAutenticacion,
    // De donde se toman los valores de lo declarado, para el preflight. Se
    // filtra por nombre, nunca se pasa entero. Ver el adaptador de Claude.
    entornoDisponible = {},
    // Donde la fase PLAN tiene que poder escribir, ademas de su worktree. Ver
    // el sandbox en `runPhase`.
    directoriosDelPlan = [],
  } = opts;

  /** La ruta ABSOLUTA del binario para una fase con este entorno. */
  const binarioPara = (/** @type {Record<string, string>} */ env) =>
    comandoDeclarado ?? resolverBinario("codex", { env }) ?? "codex";

  /** El ejecutor del preflight, apuntado al binario que este adaptador usa de verdad. */
  const ejecutar = ejecutarAutenticacion
    ?? ((/** @type {string[]} */ argv, /** @type {any} */ o) => ejecutorDeProceso([binarioPara(o?.env ?? {}), ...argsPrefijo, ...argv.slice(1)], o));

  return {
    id: "codex",

    requiredEnv: [...VARIABLES_DEL_RUNTIME],

    sessionEnv: [...VARIABLES_DE_SESION],

    capabilities() {
      return {
        // NO retoma. Podria intentarse, pero declararlo en true obligaria a
        // sostenerlo, y lo que el contrato pide es la verdad: con esto en false
        // el motor abre sesion nueva cada fase y lo dice, en vez de creer que
        // hay contexto acumulado que no hay.
        resume: false,
        // No reporta gasto en USD. Ver la cabecera.
        cost: false,
        // El nivel de razonamiento si viaja, por configuracion del comando.
        effort: true,
        // No hay mecanismo de hooks en su subproceso. Lo que el hook del paso
        // RED hace ANTES, con este runtime lo hace el motor DESPUES de la fase:
        // lee el worktree, revierte lo ajeno y cuenta el intento.
        hooks: false,
        models: "desconocido",
        // No carga el plugin: `/noxloop-task ...` le llegaria como texto sin
        // significado. Declararlo es lo que hace que el motor le mande el
        // encargo expandido.
        comandos: false,
      };
    },

    async preflight() {
      // `codex login status` contesta las dos preguntas a la vez: si el binario
      // esta (ENOENT si no) y si tiene con que invocar al modelo. Y se pregunta
      // con el MISMO entorno que tendra la fase: con mas variables, el doctor
      // diria "hay sesion" y la fase no la encontraria.
      const env = entornoDeclarado(entornoDisponible, [...VARIABLES_DE_SESION, ...VARIABLES_DEL_RUNTIME]);
      const autenticacion = await estadoDeAutenticacion("codex", { ejecutar, env });
      if (autenticacion.conectado) return { ok: true, autenticacion };

      if (!autenticacion.binarioPresente) {
        return {
          ok: false,
          causa:
            `${autenticacion.causa} Las fases del rol que la flota le asigno a este runtime no pueden correr; si ` +
            "es el revisor, moverlas al implementador dejaria la revision sobre el mismo runtime que escribio el " +
            "codigo, que es justo lo que FR-034 prohibe.",
          accion:
            `${autenticacion.accion} O asigna al revisor otro runtime distinto del del implementador desde ` +
            "Flota -> Agentes.",
          autenticacion,
        };
      }
      return { ok: false, causa: autenticacion.causa, accion: autenticacion.accion, autenticacion };
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

      if (peticion.resume) {
        // Se pidio retomar y este runtime no sabe. NO se finge: se abre sesion
        // nueva y se dice, que es la regla 1 del contrato.
        degradaciones.push(
          `se pidio retomar la sesion "${peticion.resume}" y este runtime declara \`resume: false\`: se abre ` +
            "sesion nueva. El contexto de la fase anterior no viaja",
        );
      }

      const args = [
        ...argsPrefijo,
        "exec",
        "--json",
        "--skip-git-repo-check",
      ];
      if (peticion.model) args.push("-m", peticion.model);
      if (peticion.effort) args.push("-c", `model_reasoning_effort=${peticion.effort}`);
      // EL SANDBOX, POR FASE. `codex exec` arranca en solo lectura: como
      // implementador no podria escribir ni el test. Las fases que escriben
      // piden el worktree escribible; la revision se queda en solo lectura, que
      // es lo que una revision tiene que ser. Lo que la fase escriba fuera de
      // su alcance DENTRO del worktree lo revierte el motor despues.
      //
      // Verificado contra `codex exec --help` (codex-cli 0.137.0): `-s,
      // --sandbox <read-only|workspace-write|danger-full-access>`.
      args.push("--sandbox", esRevision(peticion.phase) ? "read-only" : "workspace-write");
      // EL PLAN SE ESCRIBE FUERA DEL WORKTREE (`<home>/plans/`), y el sandbox
      // solo deja escribir en el directorio de trabajo: Codex como planificador
      // terminaba la fase sin poder dejar el plan. `--add-dir` ("additional
      // directories that should be writable alongside the primary workspace",
      // misma ayuda) lo abre, y SOLO en PLAN: sin hooks que acoten lo que
      // escribe, darle mas en una fase que implementa le dejaria tocar lo que
      // la guarda posterior del motor —que mira el worktree de la tarea— no ve.
      if (peticion.phase === "PLAN") {
        for (const d of directoriosDelPlan) args.push("--add-dir", d);
      }
      // LAS INSTRUCCIONES DE FASE DESATENDIDA (ver `PROMPT_DESATENDIDO`), como
      // instrucciones de desarrollador y NO antepuestas al encargo: el contrato
      // exige que el prompt llegue integro (`capacidades-honestas`). `codex exec
      // --help` (0.137.0) no tiene `--append-system-prompt`; su equivalente es
      // la clave `developer_instructions`, verificada contra el binario sin
      // gastar cuota: con `--strict-config`, `-c clave_que_no_existe=...` falla
      // con "unknown configuration field" y `-c developer_instructions=...` pasa.
      // El valor va como cadena TOML (JSON.stringify la produce valida): si no
      // parseara, codex lo tomaria literal con las comillas dentro.
      args.push("-c", `developer_instructions=${JSON.stringify(PROMPT_DESATENDIDO)}`);
      args.push(peticion.prompt);

      // EL TRANSCRIPT, LINEA A LINEA: `codex exec --json` ya habla un evento
      // por linea, asi que se traduce mientras el proceso corre y no al final.
      const emitir = emisorDeEventos(opcionesDeFase.alEvento);
      const estadoDelTranscript = { ultimoMensaje: "" };

      try {
        const l = await lanzar({
          alLinea: opcionesDeFase.alEvento
            ? (linea) => {
                for (const e of eventosDeLineaCodex(jsonDeLinea(linea), estadoDelTranscript)) emitir(e);
              }
            : undefined,
          comando: binarioPara(peticion.env),
          args,
          env: peticion.env,
          // Cuales de esas variables son secretas. Sin esto se miran todas, y el
          // valor de HOME es prefijo de casi cualquier ruta de la maquina: la
          // guarda daba positivo siempre y ninguna fase se lanzaba.
          secretos: peticion.secretos,
          cwd: peticion.cwd,
          signal: opcionesDeFase.signal,
          timeoutMs,
          alLanzar: (x) => {
            if (alLanzar) {
              alLanzar({
                registro: x,
                fase: peticion.phase,
                // SIEMPRE null: no se retoma nada. Registrar aqui lo que pidio
                // el llamante haria pasar la prueba `sin-resume-sesion-nueva`
                // sobre una capacidad que no existe.
                resume: null,
                model: peticion.model,
                effort: peticion.effort ?? null,
              });
            }
          },
        });
        return { ...traducir(l), degradaciones };
      } catch (e) {
        return {
          ...resultadoDeFase({ ok: false, subtype: /** @type {any} */ (e).codigo || "lanzamiento_fallo", text: e.message }),
          degradaciones,
        };
      }
    },
  };
}

/**
 * @param {import("../proceso.mjs").Lanzamiento} l
 */
function traducir(l) {
  // LA SESION VENCIDA, reconocida por su error: lo que el runtime dijo como
  // error (`turn.failed`, `error`) y su stderr, nunca los mensajes del agente.
  // Es el caso medido: `codex login status` decia "Logged in using ChatGPT" y
  // la fase murio con "Your access token could not be refreshed".
  return conSesionReconocida("codex", traducirSinSesion(l), `${erroresDelStream(l.stdout)}\n${l.stderr || ""}`, errorDeSesion);
}

/** Los mensajes de error del stream de `codex exec --json`, y nada mas. */
function erroresDelStream(/** @type {string} */ stdout) {
  /** @type {string[]} */
  const errores = [];
  for (const linea of String(stdout || "").split("\n")) {
    const t = linea.trim();
    if (!t.startsWith("{")) continue;
    try {
      const ev = JSON.parse(t);
      if (ev?.type !== "error" && ev?.type !== "turn.failed") continue;
      for (const m of [ev.message, ev.error?.message]) if (typeof m === "string") errores.push(m);
    } catch {
      /* ruido entre eventos */
    }
  }
  return errores.join("\n");
}

/** @param {import("../proceso.mjs").Lanzamiento} l */
function traducirSinSesion(l) {
  if (l.cancelado) {
    return resultadoDeFase({ ok: false, subtype: "cancelada", text: `la fase se cancelo${l.stderr ? `: ${l.stderr.trim()}` : ""}` });
  }
  const crudo = leerResultadoJsonl(l.stdout);
  if (!crudo) {
    return resultadoDeFase({
      ok: false,
      subtype: "stream_incompleto",
      text: `el runtime salio con ${l.code} sin dejar un resultado legible.\n${l.stderr.trim() || l.stdout.trim()}`,
    });
  }
  return resultadoDeFase({
    // Codigo de salida. Lo que el modelo haya escrito en su mensaje final no
    // entra en la cuenta: quien decide si la fase paso es el gate.
    ok: l.code === 0 && !crudo.isError,
    // Se devuelve el hilo si lo hubo, pero con `resume: false` declarado nadie
    // lo va a usar para retomar. Devolverlo igual deja la traza para el log.
    sessionId: crudo.sessionId,
    // `null` y NUNCA `0`: el protocolo no trae coste.
    usd: null,
    text: crudo.texto,
    budgetExhausted: false,
    subtype: crudo.subtype,
  });
}

/**
 * Las fixtures con las que este adaptador corre la suite de contrato.
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
    const lineas = [
      JSON.stringify({ type: "thread.started", thread_id: g.sessionId ?? "hilo-codex-1" }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: g.texto ?? "hecho" } }),
      exito
        ? JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 20 } })
        : JSON.stringify({ type: "turn.failed", error: { message: "el turno fallo" } }),
    ];
    writeFileSync(
      guion,
      JSON.stringify({ colgar: Boolean(g.colgar), code: exito ? 0 : 1, salida: lineas.join("\n") + "\n" }),
    );
  };
  escribirGuion({ texto: "hecho", exito: true });

  /** @type {any} */
  let ultimo = null;
  const comun = {
    home,
    comando: process.execPath,
    argsPrefijo: [GUIONADO, guion, visto, "-", "--"],
    alLanzar: (/** @type {any} */ l) => { ultimo = l; },
  };

  // La sesion se guiona como iniciada: la suite mide el contrato, no el login
  // del operador. `sinRuntime` pregunta de verdad a un binario que no existe.
  const conSesion = async () => ({ code: 0, stdout: "Logged in using ChatGPT\n", stderr: "" });

  return {
    id: "codex",
    adaptador: crearAdaptadorCodex({ ...comun, ejecutarAutenticacion: conSesion }),
    sinRuntime: crearAdaptadorCodex({ ...comun, comando: join(dir, "no-existe-el-binario"), argsPrefijo: [] }),
    home,
    cwd,
    vecino,
    secreto: { nombre: "CODEX_CENTINELA", valor: "valor-centinela-de-la-boveda-9137" },

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

    /** Declara `hooks: false`: no hay nada que demostrar, y la suite lo salta. */
    evidenciaDeHooks() {
      return false;
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
        effort: "alto",
        prompt: "# /noxloop-task — una fase, una tarea\n\nFase: GREEN. El encargo, expandido por el motor.",
        tier: "normal",
        env: { CODEX_CENTINELA: "valor-centinela-de-la-boveda-9137" },
        ...over,
      };
    },

    cerrar() {},
  };
}
