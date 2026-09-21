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
// No hizo falta ninguno — y por eso este adaptador es el REVISOR: hooks en
// false lo deja fuera del rol de implementador, que es exactamente donde tiene
// que estar.
//
// SU DEGRADACION MAS CARA ES `cost: false`. El techo de gasto de un hito no se
// le puede aplicar. Eso no se arregla devolviendo ceros: se declara, y el motor
// lo dice al arrancar el run en vez de aplicar un limite que no puede
// dispararse.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizarPeticion, resultadoDeFase, validarPeticion } from "../contrato.mjs";
import { lanzar, leerLanzamiento } from "../proceso.mjs";
import { leerResultadoJsonl } from "../salida.mjs";

/**
 * @param {{
 *   home?: string|null,
 *   comando?: string,
 *   argsPrefijo?: string[],
 *   timeoutMs?: number,
 *   alLanzar?: (l: any) => void,
 * }} [opts]
 * @returns {import("../contrato.mjs").AgentAdapter}
 */
export function crearAdaptadorCodex(opts = {}) {
  const { comando = "codex", argsPrefijo = [], timeoutMs = 30 * 60_000, alLanzar } = opts;

  return {
    id: "codex",

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
        // No hay mecanismo de hooks en su subproceso. Es la degradacion que lo
        // deja fuera del rol de implementador, y es correcta: sin el hook del
        // paso RED, el principio I depende de que el prompt se acuerde.
        hooks: false,
        models: "desconocido",
      };
    },

    async preflight() {
      try {
        const l = await lanzar({
          comando,
          args: [...argsPrefijo, "--version"],
          env: {},
          cwd: ".",
          timeoutMs: 10_000,
        });
        if (l.code !== 0) {
          return {
            ok: false,
            causa: `el binario \`${comando}\` respondio con ${l.code} al pedirle la version: ${(l.stderr || "").trim()}`,
            accion: `Comprueba la instalacion de \`${comando}\` y que este en el PATH del entorno que la boveda entrega a las fases.`,
          };
        }
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          causa:
            `no se pudo ejecutar \`${comando}\` (${e?.message || e}). Este runtime es el REVISOR de la flota: ` +
            "sin el, la revision correria sobre el mismo runtime que implemento, que es justo lo que FR-034 " +
            "prohibe.",
          accion:
            `Instala \`${comando}\` y deja su ruta en el PATH, o asigna al revisor otro runtime distinto del ` +
            "del implementador desde Flota -> Agentes.",
        };
      }
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
      args.push(peticion.prompt);

      try {
        const l = await lanzar({
          comando,
          args,
          env: peticion.env,
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

/** @param {import("../proceso.mjs").Lanzamiento} l */
function traducir(l) {
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

  return {
    id: "codex",
    adaptador: crearAdaptadorCodex(comun),
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
        prompt: "/noxloop-task IT-1 T-1 --phase GREEN",
        tier: "normal",
        env: { CODEX_CENTINELA: "valor-centinela-de-la-boveda-9137" },
        ...over,
      };
    },

    cerrar() {},
  };
}
