// Las guardas que el motor le entrega a cada sesion que lanza.
//
// EL FALLO QUE ESTE MODULO CORRIGE. Los hooks llegan a una sesion por dos vias
// y ninguna mas: el plugin instalado, o la configuracion pasada en la propia
// invocacion. El motor no pasaba ninguna, asi que toda sesion que lanzaba en
// una maquina sin el plugin instalado corria SIN guardas: sin tdd-order-guard
// el paso RED se saltea, y sin no-prod-writes el limite del principio IV —la
// autonomia termina en el PR abierto— simplemente no existe. Es el peor de los
// dos mundos porque la sesion arranca igual y el recorrido parece normal.
//
// POR QUE POR CONFIGURACION Y NO POR PLUGIN. La via de la configuracion esta
// medida: `--settings` (CLI) y `options.settings` (SDK) cargan en la capa "flag
// settings" —la de mayor prioridad entre las controladas por el usuario— y con
// esa forma se verifico la interceptacion. La via del plugin sin instalar
// (`--plugin-dir` / `options.plugins`) existe en el help y en los tipos, pero no
// se corrio una sesion cargando el plugin por ahi ni se verifico que sus hooks
// intercepten. No se elige un mecanismo no medido para sostener el principio IV.
//
// POR QUE ESTE OBJETO NO ES EL DEL PLUGIN. Es el mismo bloque `hooks` de
// packages/plugin/hooks/hooks.json con dos diferencias obligatorias:
//
//   1. Rutas ABSOLUTAS resueltas aca. El plugin escribe
//      `${CLAUDE_PLUGIN_ROOT}/...`, que lo expande el cargador de plugins y
//      NADIE mas. Por esta via es texto literal: apunta a un archivo que no
//      existe, el hook no corre, y la sesion sigue sin guarda.
//   2. `command` + `args` en vez de la ruta metida dentro de `command`. Con
//      `args` el ejecutable se spawnea directo, sin shell, asi que una ruta con
//      `$`, comillas o backticks nunca llega a un parser de shell. Los
//      worktrees viven en rutas generadas y el titulo del ticket entra en el
//      nombre: la forma con shell rompe el dia que un titulo trae un `$`.
//
// POR QUE LA VALIDACION NO ES OPCIONAL. Esta medido que un bloque `hooks` que
// el motor no acepta se ignora EN SILENCIO: exit 0, stderr vacio, is_error
// false, y el `git merge` se ejecuta de verdad. En `-p/--print` esta escrito en
// el propio help ("Settings files that fail validation are silently ignored in
// this mode"). O sea: el motor no nos va a avisar. Comprobar en disco que cada
// ruta declarada existe es lo unico que convierte ese silencio en un error, y
// por eso quien no puede armar las guardas no lanza la sesion.
//
// LO QUE FALTA CONFIRMAR, y no se puede confirmar sin una sesion real:
//   - Que los hooks de tipo `command` de esta via corran tambien dentro de cada
//     subagente. La doc de hooks lo afirma para "hooks from settings files",
//     pero la cobertura de subagentes solo se midio con la forma de callbacks
//     en proceso (`options.hooks`). El principio IV exige justamente eso ("el
//     hook corre dentro de cada subproceso"), asi que es el primer agujero que
//     el test de interceptacion tiene que cerrar.
//   - Que una sesion RETOMADA (`resume`) vuelva a aplicar las guardas de la
//     invocacion que la retoma. El driver retoma entre fases RED -> GREEN ->
//     GATE -> REVIEW, y una guarda que existe en RED y desaparece en GATE es el
//     peor caso posible. No esta descartado.
//   - Que el binario que usa cada camino se comporte igual: el `claude` del PATH
//     y el que trae el SDK no son la misma version.
//
// Hasta que ese test —pedir un merge desde una sesion del motor y esperar el
// bloqueo, como lo redacta research.md— pase, el modo daemon no se publica.

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** El timeout va por hook: uno sin techo cuelga el turno entero. */
const TIMEOUT_PRE_TOOL = 10;
const TIMEOUT_STOP = 15;

const HOOKS_DIR = "src/hooks";

/** Las herramientas que escriben un archivo. Las cuatro, no tres. */
const ESCRITURAS = "Edit|Write|MultiEdit|NotebookEdit";

/** La raiz del paquete del motor, deducida de este archivo: src/ -> engine/. */
export function defaultEngineRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

const hook = (engineRoot, script, timeout) => ({
  type: "command",
  command: "node",
  args: [join(engineRoot, HOOKS_DIR, script)],
  timeout,
});

/**
 * El objeto de configuracion que hay que darle a una sesion para que corra con
 * las guardas puestas. Sirve igual para `options.settings` del SDK y para
 * `--settings` del CLI: es el mismo objeto.
 *
 * No toca el disco a proposito. Armar y comprobar son pasos distintos, y el
 * que comprueba tiene nombre propio (`validateHookSettings`) para que nadie
 * pase por aca creyendo que ya verifico algo.
 *
 * @param {string} [engineRoot] la raiz del paquete del motor
 */
export function buildHookSettings(engineRoot = defaultEngineRoot()) {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: ESCRITURAS,
          hooks: [
            hook(engineRoot, "tdd-order-guard.mjs", TIMEOUT_PRE_TOOL),
            hook(engineRoot, "task-scope-guard.mjs", TIMEOUT_PRE_TOOL),
          ],
        },
        {
          matcher: "Bash",
          hooks: [hook(engineRoot, "no-prod-writes.mjs", TIMEOUT_PRE_TOOL)],
        },
      ],
      Stop: [{ hooks: [hook(engineRoot, "state-checkpoint.mjs", TIMEOUT_STOP)] }],
      // El principio IV pide que la guarda corra tambien en los subprocesos que
      // nadie esta mirando. Un subagente que cierra sin dejar constancia deja un
      // worktree con cambios que quien retome no puede distinguir de "no empezo".
      SubagentStop: [{ hooks: [hook(engineRoot, "state-checkpoint.mjs", TIMEOUT_STOP)] }],
    },
  };
}

/**
 * Comprueba en disco que cada hook declarado EXISTE.
 *
 * Un objeto vacio o que no se entiende NO se da por bueno: aca la duda no se
 * resuelve permitiendo. La regla "ante la duda, permitir" es de los hooks
 * mismos —bloquear por un error propio deja a una persona sin poder trabajar—;
 * esta funcion decide algo distinto, si el motor lanza o no una sesion suya, y
 * una sesion sin guardas no se lanza.
 *
 * @param {object} settings
 * @returns {{ok: boolean, paths: string[], missing: string[]}}
 */
export function validateHookSettings(settings) {
  // LO QUE ESTA VALIDACION TIENE QUE COMPROBAR, y antes no comprobaba: que cada
  // guarda concreta este declarada, colgada del evento que le toca, y apuntando
  // a un archivo que existe.
  //
  // La version anterior juntaba strings que terminaran en `.mjs` y contaba. Una
  // revision adversarial la hizo decir ok:true con el hook de Bash apuntando a
  // un archivo inexistente, con el nombre del evento mal escrito, con
  // PreToolUse vacio, y con el matcher en minuscula. En los cuatro casos la
  // sesion habria arrancado SIN limite de autonomia y con una validacion
  // diciendo que todo estaba bien — que es peor que no validar, porque produce
  // confianza.
  const esperadas = [
    { guarda: "no-prod-writes", evento: "PreToolUse", matcher: "Bash" },
    { guarda: "tdd-order-guard", evento: "PreToolUse", matcher: ESCRITURAS },
    { guarda: "task-scope-guard", evento: "PreToolUse", matcher: ESCRITURAS },
    { guarda: "state-checkpoint", evento: "Stop", matcher: null },
  ];

  const eventos = settings && typeof settings === "object" ? settings.hooks : null;
  if (!eventos || typeof eventos !== "object") {
    return { ok: false, paths: [], missing: ["no hay un bloque `hooks` que validar"] };
  }

  const paths = [];
  const missing = [];

  for (const e of esperadas) {
    const entradas = Array.isArray(eventos[e.evento]) ? eventos[e.evento] : [];
    const candidatas = e.matcher === null ? entradas : entradas.filter((m) => m?.matcher === e.matcher);

    const encontrada = candidatas
      .flatMap((m) => m?.hooks || [])
      .flatMap((h) => (Array.isArray(h?.args) ? h.args : []))
      .find((a) => typeof a === "string" && a.endsWith(`${e.guarda}.mjs`));

    if (!encontrada) {
      missing.push(
        `la guarda ${e.guarda} no esta declarada en ${e.evento}` +
          (e.matcher ? ` con el matcher "${e.matcher}"` : ""),
      );
      continue;
    }
    paths.push(encontrada);
    if (!existsSync(encontrada)) {
      missing.push(`la guarda ${e.guarda} apunta a ${encontrada}, que no existe`);
    }
  }

  // Un evento declarado que el cargador no conoce es una guarda que no corre, y
  // se reporta: es exactamente el caso del nombre mal escrito.
  const CONOCIDOS = ["PreToolUse", "PostToolUse", "Stop", "SubagentStop", "SessionStart", "UserPromptSubmit"];
  for (const nombre of Object.keys(eventos)) {
    if (!CONOCIDOS.includes(nombre)) {
      missing.push(`"${nombre}" no es un evento de hook conocido: lo que cuelgue de ahi no corre`);
    }
  }

  return { ok: missing.length === 0, paths, missing };
}

/**
 * Escribe las guardas a un archivo y devuelve su ruta.
 *
 * `--settings` acepta la ruta o el JSON entero; los transportes del motor pasan
 * el JSON y no necesitan archivo. El archivo hace falta para las sesiones que
 * el motor NO arranca: reproducir a mano una fase con `claude --settings
 * <archivo>` sin instalar el plugin.
 *
 * Escritura atomica (temporal + rename) por lo mismo que el estado: un archivo
 * de configuracion leido a medias es una sesion con las guardas incompletas.
 *
 * @param {string} dir donde dejarlo — fuera de los repos de trabajo
 * @param {string} [engineRoot]
 * @returns {string} la ruta del archivo escrito
 */
export function writeHookSettings(dir, engineRoot = defaultEngineRoot()) {
  const settings = buildHookSettings(engineRoot);
  const v = validateHookSettings(settings);
  if (!v.ok) {
    throw new Error(
      `no se puede escribir la configuracion de hooks: ${v.missing.length ? `estos hooks declarados no existen en disco:\n  - ${v.missing.join("\n  - ")}` : "no se declaro ningun hook"}\n` +
        `Un hook declarado que apunta a un archivo inexistente no falla al arrancar: se ignora, y la sesion corre sin guarda.`,
    );
  }

  mkdirSync(dir, { recursive: true });
  const destino = join(dir, "hook-settings.json");
  const tmp = `${destino}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
  renameSync(tmp, destino);
  return destino;
}
