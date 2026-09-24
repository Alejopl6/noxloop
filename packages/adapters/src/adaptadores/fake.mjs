// T182 — el adaptador `fake`: sin red, sin credenciales y sin modelo.
//
// POR QUE ES EL PRIMERO Y NO EL ULTIMO. Porque es el que hace cierta la frase
// que justifica toda la inyeccion de dependencias del motor: "que el recorrido
// completo se pueda probar sin red, sin credenciales y sin modelo". Y porque el
// paso 1 de añadir un adaptador es copiar este: lo que este archivo haga bien o
// mal se replica en el siguiente.
//
// LANZA UN PROCESO DE VERDAD, y no es capricho. Un `fake` que devolviera un
// objeto sin salir del proceso pasaria las once pruebas del contrato sin probar
// las cinco que importan: entorno exacto, cwd, nada por argv, cancelacion sin
// huerfanos y hooks corriendo DENTRO. Lo unico que no hay aqui es el modelo.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizarPeticion, resultadoDeFase, validarPeticion } from "../contrato.mjs";
import { lanzar, leerLanzamiento } from "../proceso.mjs";
import { esCorteDePresupuesto, leerResultadoJson } from "../salida.mjs";

const GUIONADO = fileURLToPath(new URL("../proceso-guionado.mjs", import.meta.url));

/**
 * @param {{
 *   home?: string|null,
 *   hooks?: string[][],
 *   guion?: string|null,
 *   visto?: string|null,
 *   nodo?: string,
 *   timeoutMs?: number,
 *   alLanzar?: (l: any) => void,
 * }} [opts]
 * @returns {import("../contrato.mjs").AgentAdapter}
 */
export function crearAdaptadorFake(opts = {}) {
  const { hooks = [], guion = null, visto = null, timeoutMs = 60_000, alLanzar } = opts;
  // `process.execPath` y no `"node"`: resolver por PATH exigiria un PATH en el
  // entorno del subproceso, y el entorno lo decide el grant. Un adaptador que
  // necesita una variable para arrancar la esta pidiendo por la espalda.
  const nodo = opts.nodo || process.execPath;
  const conHooks = Array.isArray(hooks) && hooks.length > 0;

  return {
    id: "fake",

    capabilities() {
      return {
        // Retoma de verdad: el runtime guionado devuelve la sesion que se le
        // pidio. Declararla en `true` sin hacerlo seria fingir la capacidad.
        resume: true,
        // NO reporta gasto, porque no hay gasto. Declararlo en `false` es lo
        // que hace que el motor diga al arrancar que el techo de USD no se
        // puede aplicar, en vez de sumar ceros creyendo que lo aplica.
        cost: false,
        effort: false,
        // La verdad, calculada: sin hooks declarados no se finge la capacidad.
        // Un adaptador con `hooks: false` no es elegible como implementador, y
        // eso lo comprueba el modelo de flota AL GUARDAR.
        hooks: conHooks,
        models: ["fake"],
        // No carga ningun plugin: recibe el encargo expandido, como Codex. Es
        // lo que permite probar sin modelo el camino de un runtime sin plugin.
        comandos: false,
      };
    },

    async preflight() {
      if (!existsSync(GUIONADO)) {
        return {
          ok: false,
          causa: `no se encuentra el runtime guionado en \`${GUIONADO}\`: el paquete de adaptadores viajo incompleto`,
          accion: "reinstala la aplicacion; `src/` tiene que viajar entero, no solo el punto de entrada",
        };
      }
      if (!existsSync(nodo)) {
        return {
          ok: false,
          causa: `no se encuentra el interprete en \`${nodo}\`, asi que ni el camino sin modelo puede correr`,
          accion: "comprueba la instalacion de Node de la maquina, o pasa la ruta del interprete al crear el adaptador",
        };
      }
      return { ok: true };
    },

    async runPhase(req, opcionesDeFase = {}) {
      const { peticion, degradaciones } = normalizarPeticion(req);

      const v = validarPeticion(peticion);
      if (!v.ok) return conDegradaciones(rechazo(v.problems), degradaciones);

      const args = [
        // EL SCRIPT PRIMERO. Faltaba, y el sintoma no decia lo que pasaba:
        // `node guion.json ...` salia con codigo 0 y sin escribir nada, asi que
        // el adaptador reportaba `stream_incompleto` y las pruebas que solo
        // miraban el entorno pasaban leyendo lo que habia registrado el PADRE.
        GUIONADO,
        guion || "-",
        visto || "-",
        conHooks ? JSON.stringify(hooks) : "-",
        "--",
        "--phase", peticion.phase,
        "--task", peticion.taskId,
        "--model", String(peticion.model || "fake"),
        "--prompt", peticion.prompt,
      ];
      if (peticion.resume) args.push("--resume", peticion.resume);

      try {
        const l = await lanzar({
          comando: nodo,
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
              alLanzar({ registro: x, fase: peticion.phase, resume: peticion.resume, model: peticion.model, effort: null });
            }
          },
        });
        return conDegradaciones(traducir(l), degradaciones);
      } catch (e) {
        return conDegradaciones(
          resultadoDeFase({ ok: false, subtype: /** @type {any} */ (e).codigo || "lanzamiento_fallo", text: e.message }),
          degradaciones,
        );
      }
    },
  };
}

/**
 * Las degradaciones viajan CON el resultado y no en un log aparte.
 *
 * Un aviso que solo existe en el log se pierde en la primera ventana que no lo
 * mira, y la regla 1 del contrato pide degradar visible: quien recibe el
 * resultado tiene que poder ver que se cambio de lo que pidio.
 *
 * @param {any} resultado
 * @param {string[]} degradaciones
 */
function conDegradaciones(resultado, degradaciones) {
  return { ...resultado, degradaciones };
}

/** @param {string[]} problemas */
export function rechazo(problemas) {
  return resultadoDeFase({
    ok: false,
    subtype: problemas.some((x) => x.startsWith("env:")) ? "entorno_ausente" : "peticion_invalida",
    text: `no se invoca el runtime:\n  - ${problemas.join("\n  - ")}`,
  });
}

/**
 * De lo que el proceso dejo, al hecho que el motor consume.
 *
 * @param {import("../proceso.mjs").Lanzamiento} l
 */
function traducir(l) {
  if (l.cancelado) {
    return resultadoDeFase({
      ok: false,
      subtype: "cancelada",
      text: `la fase se cancelo${l.stderr ? `: ${l.stderr.trim()}` : ""}`,
    });
  }

  const crudo = leerResultadoJson(l.stdout);
  if (!crudo) {
    // Sin resultado NO es aprobado: una fase cortada no produce veredicto.
    return resultadoDeFase({
      ok: false,
      subtype: "stream_incompleto",
      text: `el runtime salio con ${l.code} sin dejar un resultado legible.\n${l.stderr.trim() || l.stdout.trim()}`,
    });
  }

  const budgetExhausted = esCorteDePresupuesto(crudo.subtype);
  return resultadoDeFase({
    // EL VEREDICTO SALE DEL CODIGO DE SALIDA Y DEL CAMPO `is_error`, nunca del
    // texto. Da igual lo bien que el runtime diga que fue todo.
    ok: l.code === 0 && !crudo.isError && !budgetExhausted,
    sessionId: crudo.sessionId,
    usd: crudo.usd,
    text: crudo.texto,
    budgetExhausted,
    subtype: crudo.subtype,
  });
}

/**
 * Las fixtures con las que este adaptador corre la suite de contrato.
 *
 * VIVEN EN EL MISMO ARCHIVO QUE EL ADAPTADOR a proposito: el paso 1 de añadir un
 * adaptador es copiar este, y si las fixtures vivieran aparte se copiaria un
 * adaptador sin forma de correr la suite — que es el paso 4.
 *
 * @param {{dir: string}} opts
 */
export function fixturesDeContrato({ dir }) {
  const home = join(dir, "home");
  const cwd = join(dir, "worktree");
  const vecino = join(dir, "vecino");
  for (const d of [home, cwd, vecino]) mkdirSync(d, { recursive: true });
  writeFileSync(join(vecino, "de-otra-tarea.txt"), "no se toca");

  const guion = join(dir, "guion.json");
  const visto = join(dir, "visto.json");
  const marcaDeHook = join(dir, "el-hook-corrio");
  writeFileSync(guion, JSON.stringify({ texto: "hecho", exito: true }));

  /** @type {any} */
  let ultimo = null;
  const hooks = [[process.execPath, "-e", `require("fs").writeFileSync(${JSON.stringify(marcaDeHook)}, "1")`]];
  const comun = { home, guion, visto, hooks, alLanzar: (/** @type {any} */ l) => { ultimo = l; } };

  return {
    id: "fake",
    adaptador: crearAdaptadorFake(comun),
    /** Un adaptador cuyo runtime no se puede resolver, para `preflight-diagnostica`. */
    sinRuntime: crearAdaptadorFake({ ...comun, nodo: join(dir, "no-existe-el-interprete") }),
    home,
    cwd,
    vecino,
    secreto: { nombre: "TOKEN_CENTINELA", valor: "valor-centinela-de-la-boveda-9137" },

    guionar(/** @type {any} */ g) {
      ultimo = null;
      // Se BORRA la constancia del hijo anterior. Sin esto, una fase cuyo
      // subproceso no llega a arrancar leeria el archivo de la fase de antes y
      // `env-exacto`, `cwd-respetado` y `cancelable` seguirian en verde sobre un
      // proceso que ya no existe.
      rmSync(visto, { force: true });
      writeFileSync(guion, JSON.stringify(g));
    },

    ultimoLanzamiento() {
      return leerLanzamiento(ultimo, visto);
    },

    evidenciaDeHooks() {
      return existsSync(marcaDeHook);
    },

    peticion(/** @type {any} */ over = {}) {
      return {
        phase: "GREEN",
        taskId: "T-1",
        task: { id: "T-1" },
        item: { id: "IT-1" },
        cwd,
        resume: null,
        model: "fake",
        // Expandido: este runtime declara `comandos: false`, y el motor no le
        // manda el nombre de un comando que no sabe expandir.
        prompt: "# /noxloop-task — una fase, una tarea\n\nFase: GREEN. El encargo, expandido por el motor.",
        tier: "normal",
        env: { TOKEN_CENTINELA: "valor-centinela-de-la-boveda-9137" },
        ...over,
      };
    },

    cerrar() {},
  };
}
