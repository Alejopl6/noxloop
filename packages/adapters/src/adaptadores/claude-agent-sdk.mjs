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

import { normalizarPeticion, resultadoDeFase, validarPeticion } from "../contrato.mjs";
import { lanzar, leerLanzamiento } from "../proceso.mjs";
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
 *   herramientas?: readonly string[],
 *   sdk?: ((opts: any) => AsyncIterable<any>)|null,
 *   resolverSdk?: () => {disponible: boolean, motivo: string|null},
 *   timeoutMs?: number,
 *   alLanzar?: (l: any) => void,
 * }} [opts]
 * @returns {import("../contrato.mjs").AgentAdapter}
 */
export function crearAdaptadorClaude(opts = {}) {
  const {
    comando = "claude",
    argsPrefijo = [],
    hooks = null,
    herramientas = HERRAMIENTAS_POR_DEFECTO,
    sdk = null,
    resolverSdk = sdkDisponible,
    timeoutMs = 30 * 60_000,
    alLanzar,
  } = opts;

  /** El camino que se va a usar. Se resuelve una vez: no cambia a mitad de un run. */
  const conSdk = Boolean(sdk) || resolverSdk().disponible;
  const via = conSdk ? "agent-sdk" : "cli";

  return {
    id: "claude-agent-sdk",

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
      };
    },

    async preflight() {
      if (conSdk) return { ok: true, via };
      const motivo = resolverSdk().motivo;
      // El CLI puede no estar tampoco. Se comprueba AQUI, en el doctor, y no a
      // mitad de un run: un ENOENT en la fase GREEN llega con la tarea
      // repartida, el worktree creado y el operador mirando otra cosa.
      const r = await probarBinario(comando, argsPrefijo);
      if (!r.ok) {
        return {
          ok: false,
          causa:
            `ni el SDK \`${PAQUETE}\` esta instalado (${motivo}) ni el binario \`${comando}\` responde ` +
            `(${r.motivo}). Sin ninguno de los dos, este runtime no puede invocar nada.`,
          accion:
            `Instala \`${PAQUETE}\` en la maquina del servicio, o deja \`${comando}\` en el PATH del entorno ` +
            "que la boveda entrega a las fases. Si lo que quieres es probar el recorrido sin modelo, apunta el " +
            "agente al runtime `fake`.",
        };
      }
      return {
        ok: true,
        via,
        degradacion:
          `el SDK \`${PAQUETE}\` no esta instalado (${motivo}), asi que las fases van por el CLI: cada una ` +
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

      const salida = conSdk && sdk
        ? await porSdk({ sdk, peticion, hooks, herramientas, alLanzar })
        : await porCli({ comando, argsPrefijo, peticion, hooks, herramientas, timeoutMs, alLanzar, signal: opcionesDeFase.signal });

      return { ...salida, degradaciones };
    },
  };
}

/** @param {any} p */
async function porCli(p) {
  const { peticion } = p;
  const args = [
    ...p.argsPrefijo,
    "-p", peticion.prompt,
    "--output-format", "json",
    "--permission-mode", "acceptEdits",
    "--allowedTools", [...p.herramientas].join(" "),
  ];
  // `--settings` acepta el JSON entero: no hay archivo que crear, ni limpiar, ni
  // que quede colgado en un worktree si el proceso muere a mitad.
  if (p.hooks) args.push("--settings", JSON.stringify(p.hooks));
  if (peticion.model) args.push("--model", peticion.model);
  if (peticion.resume) args.push("--resume", peticion.resume);

  try {
    const l = await lanzar({
      comando: p.comando,
      args,
      env: peticion.env,
      cwd: peticion.cwd,
      signal: p.signal,
      timeoutMs: p.timeoutMs,
      alLanzar: (x) => {
        if (p.alLanzar) {
          p.alLanzar({ registro: x, fase: peticion.phase, resume: peticion.resume, model: peticion.model, effort: null });
        }
      },
    });
    return traducirCli(l);
  } catch (e) {
    return resultadoDeFase({
      ok: false,
      subtype: /** @type {any} */ (e).codigo || "lanzamiento_fallo",
      text: e.message,
    });
  }
}

/** @param {import("../proceso.mjs").Lanzamiento} l */
function traducirCli(l) {
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
  const options = {
    cwd: peticion.cwd,
    // EXACTAMENTE `req.env`. Es el mismo invariante que del lado del CLI, y es
    // el mas facil de perder aqui: el SDK corre en proceso y la tentacion de
    // "heredar lo que ya hay" no necesita ni escribir una linea de mas.
    env: peticion.env,
    permissionMode: "acceptEdits",
    allowedTools: [...p.herramientas],
    includePartialMessages: true,
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
  try {
    for await (const m of p.sdk({ prompt: peticion.prompt, options })) {
      if (m?.type === "system" && m.subtype === "init" && m.session_id) sessionId = m.session_id;
      if (m?.type === "result") {
        final = m;
        if (m.session_id) sessionId = m.session_id;
        texto = typeof m.result === "string" ? m.result : "";
      }
    }
  } catch (e) {
    return resultadoDeFase({ ok: false, sessionId, subtype: "transporte_fallo", text: e?.message || String(e) });
  }

  if (!final) {
    // Un stream que termina sin `result` no se da por bueno: es el caso de un
    // proceso matado o una conexion cortada.
    return resultadoDeFase({ ok: false, sessionId, subtype: "stream_incompleto", text: texto || "el stream termino sin resultado" });
  }

  const subtype = typeof final.subtype === "string" ? final.subtype : null;
  const budgetExhausted = esCorteDePresupuesto(subtype);
  return resultadoDeFase({
    ok: final.is_error !== true && !budgetExhausted,
    sessionId,
    usd: typeof final.total_cost_usd === "number" ? final.total_cost_usd : null,
    text: texto,
    budgetExhausted,
    subtype,
  });
}

/**
 * Si el binario responde. Se le pide la version, que es la pregunta mas barata
 * que existe y no arranca ninguna sesion.
 *
 * @param {string} comando
 * @param {string[]} argsPrefijo
 */
async function probarBinario(comando, argsPrefijo) {
  try {
    const l = await lanzar({
      comando,
      args: [...argsPrefijo, "--version"],
      // El preflight corre en el doctor, no dentro de una fase: no hay grant
      // que respetar porque no hay nada que el binario pueda alcanzar con un
      // entorno vacio salvo decir su version.
      env: {},
      cwd: ".",
      timeoutMs: 10_000,
    });
    return l.code === 0 ? { ok: true, motivo: null } : { ok: false, motivo: `salio con ${l.code}` };
  } catch (e) {
    return { ok: false, motivo: e?.message || String(e) };
  }
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

  return {
    id: "claude-agent-sdk",
    adaptador: crearAdaptadorClaude(comun),
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
