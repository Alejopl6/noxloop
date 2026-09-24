// El encargo de una fase para un runtime que NO carga el plugin.
//
// EL FALLO QUE CIERRA. El motor manda cada fase como `/noxloop-task <item>
// <tarea> --phase X [--lens L | --sintesis]` y cada planificacion como
// `/noxloop-plan <item> --out <ruta>`. Son comandos del plugin de Claude Code:
// ese runtime los expande al texto de `packages/plugin/commands/<cmd>.md`. Un
// runtime sin plugin —Codex— recibia la cadena tal cual, sin nada que le dijera
// que fase era, que en RED no se toca produccion, ni con que marcador se
// declara un bloqueo. El producto se decia agnostico del runtime y el encargo
// solo lo entendia uno.
//
// LA FUENTE ES UNA SOLA. El texto que recibe un runtime sin plugin se LEE del
// mismo archivo que expande el plugin, no se copia aqui: dos copias del encargo
// se separan en la primera edicion, y entonces cada runtime hace una tarea
// distinta con el mismo nombre.
//
// SE DECIDE POR CAPACIDAD, NO POR NOMBRE. La costura pregunta
// `capabilities().comandos`; nunca "¿es codex?". Es el principio VI trasladado
// de gestores a runtimes: si soportar un runtime exige un `if` con su nombre,
// la interfaz esta mal.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Donde viven los comandos del plugin, relativo a este archivo. */
export const RAIZ_DE_COMANDOS = fileURLToPath(new URL("../../plugin/commands/", import.meta.url));

/** Solo comandos del motor, y con un nombre que no puede salirse del directorio. */
const COMANDO = /^\/(noxloop-[a-z][a-z-]*)(?:[ \t]+(.*))?$/;

/**
 * Convierte un prompt del motor en el texto que un runtime sin plugin puede
 * seguir.
 *
 * Un prompt que no empieza por `/noxloop-` no se toca: no es un comando, y
 * reescribirlo seria inventar un encargo.
 *
 * @param {string} prompt
 * @param {{task?: any, hooks?: boolean, raiz?: string}} [opts]
 * @returns {{ok: true, prompt: string, expandido: boolean} | {ok: false, causa: string}}
 */
export function expandirComando(prompt, opts = {}) {
  const texto = String(prompt ?? "");
  if (!texto.startsWith("/noxloop-")) return { ok: true, prompt: texto, expandido: false };

  const corte = texto.indexOf("\n");
  const primera = (corte < 0 ? texto : texto.slice(0, corte)).trim();
  const resto = corte < 0 ? "" : texto.slice(corte + 1).trim();

  const m = COMANDO.exec(primera);
  if (!m) return { ok: false, causa: `\`${primera}\` no tiene la forma de un comando del motor` };
  const [, nombre, crudos = ""] = m;
  const argumentos = crudos.trim();

  const archivo = join(opts.raiz || RAIZ_DE_COMANDOS, `${nombre}.md`);
  if (!existsSync(archivo)) {
    // NO se manda el comando crudo "a ver si lo entiende": eso es exactamente
    // el fallo que este modulo existe para cerrar. Se dice que falta.
    return {
      ok: false,
      causa:
        `el motor pidio \`/${nombre}\` y no hay texto de ese comando en \`${archivo}\`. Un runtime sin plugin ` +
        "recibiria el nombre del comando sin su significado, asi que la fase no se invoca.",
    };
  }

  const cuerpo = readFileSync(archivo, "utf8")
    // El frontmatter es para el cargador de comandos del plugin (descripcion,
    // pista de argumentos), no para quien ejecuta el encargo.
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
    // Funcion y no cadena: un `$` en los argumentos (una ruta rara) seria un
    // patron de reemplazo, y el texto final diria otra cosa.
    .replaceAll("$ARGUMENTS", () => argumentos)
    .trim();

  const partes = [
    `# El encargo de esta fase\n\n` +
      `Tu runtime no carga el plugin de noxloop, asi que el motor te manda el TEXTO del comando \`/${nombre}\` en ` +
      "vez de su nombre. Lo que sigue despues de la linea es exactamente lo que ese comando dice, con los " +
      "argumentos ya puestos. Lo de este encabezado lo agrega el motor para decirte en claro lo que el plugin " +
      "habria resuelto por ti.",
    encargoConcreto(nombre, argumentos),
  ];
  const datos = datosDeLaTarea(opts.task);
  if (datos) partes.push(datos);
  if (opts.hooks !== true) partes.push(GUARDA_POSTERIOR);
  partes.push(`---\n\n${cuerpo}`);
  if (resto) partes.push(`---\n\n## Lo que el motor agrega a esta invocacion\n\n${resto}`);

  return { ok: true, prompt: partes.join("\n\n"), expandido: true };
}

/**
 * Los flags, dichos en claro. Un runtime sin plugin no sabe que `--phase` es la
 * fase ni que `--sintesis` cambia el papel entero de la invocacion.
 *
 * @param {string} nombre
 * @param {string} argumentos
 */
function encargoConcreto(nombre, argumentos) {
  const tokens = argumentos.split(/\s+/).filter(Boolean);
  const valor = (/** @type {string} */ flag) => {
    const i = tokens.indexOf(flag);
    return i >= 0 && i + 1 < tokens.length ? tokens[i + 1] : null;
  };
  const posicionales = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].startsWith("--")) {
      if (["--phase", "--lens", "--out"].includes(tokens[i])) i++;
      continue;
    }
    posicionales.push(tokens[i]);
  }

  const lineas = [`## Tu encargo concreto`, "", `- Argumentos: \`${argumentos || "(ninguno)"}\``];
  if (posicionales[0]) lineas.push(`- Item: \`${posicionales[0]}\``);

  if (nombre === "noxloop-task") {
    if (posicionales[1]) lineas.push(`- Tarea: \`${posicionales[1]}\``);
    const fase = valor("--phase");
    if (fase) lineas.push(`- Fase: ${fase} — sigue la seccion «Fase ${fase}» del texto y no hagas el trabajo de otra fase.`);
    const lente = valor("--lens");
    if (lente) {
      lineas.push(
        `- Lente: ${lente} — sigue la sub-seccion «Con \`--lens <lente>\`» mirando SOLO esa lente, sin veredicto ` +
          "final: el unico veredicto lo da la sintesis.",
      );
    }
    if (tokens.includes("--sintesis")) {
      lineas.push(
        "- Sintesis: sigue la sub-seccion «Con `--sintesis`». Recibes los informes de las lentes al final y decides " +
          "tu, una vez.",
      );
    }
  }

  const out = valor("--out");
  if (out) lineas.push(`- Salida (\`--out\`): escribe el plan en \`${out}\`. Si no queda ahi, el motor lo lee como que no hubo plan.`);

  return lineas.join("\n");
}

/**
 * Lo que `noxloop status` devolveria de la tarea, puesto en el encargo.
 *
 * El texto del comando empieza por "corre `noxloop status`". Un runtime en
 * sandbox, o en una maquina donde el binario no esta en su PATH, no puede; con
 * esto no depende de poder.
 *
 * @param {any} t
 */
function datosDeLaTarea(t) {
  if (!t || typeof t !== "object") return null;
  const lista = (/** @type {any} */ xs) => (Array.isArray(xs) && xs.length ? xs.map((x) => `\`${x}\``).join(", ") : "(ninguno)");
  const lineas = [
    "## La tarea, segun el estado del motor",
    "",
    "Si `noxloop status` no esta disponible en tu entorno, esto es lo que devolveria para esta tarea:",
    "",
  ];
  if (t.repo) lineas.push(`- Repositorio: \`${t.repo}\``);
  if (t.title) lineas.push(`- Titulo: ${t.title}`);
  if (t.acceptance) lineas.push(`- Criterio de aceptacion: ${t.acceptance}`);
  lineas.push(`- testFiles: ${lista(t.testFiles)}`);
  lineas.push(`- targetFiles: ${lista(t.targetFiles)}`);
  if (t.tier) lineas.push(`- Tier: ${t.tier}`);
  return lineas.join("\n");
}

/**
 * Lo que cambia en un runtime sin hooks, dicho al modelo.
 *
 * El texto del plugin dice "el hook lo bloquea". Aqui no hay hook: lo que hay es
 * la guarda posterior del motor (`alcance-de-fase.mjs`). Decirlo evita que el
 * modelo crea que puede probar a escribir y que el hook lo parara.
 */
const GUARDA_POSTERIOR =
  "## Las guardas, en este runtime\n\n" +
  "Aqui no corren los hooks del plugin. Donde el texto dice que un hook bloquea algo, en este runtime el motor " +
  "lo verifica DESPUES de la fase, sobre el worktree: lo que escribas fuera de lo permitido —en RED, solo los " +
  "testFiles; en GREEN, los targetFiles, los testFiles y lo ampliado con `noxloop add-target`— se revierte, la " +
  "fase cuenta como fallida y consume un intento. Si la fase mueve una rama protegida, la tarea se bloquea.";

/**
 * La costura: envuelve el `runPhase` del driver para que un runtime sin
 * comandos reciba el encargo expandido.
 *
 * `comandos: true` deja pasar el comando: su plugin lo expande, y reescribirlo
 * aqui seria hacer dos veces lo mismo con dos textos posibles. Cualquier otra
 * cosa —`false`, o no declararlo— expande: mandar el texto a quien entendia el
 * comando cuesta tokens; mandar el comando a quien no lo entiende cuesta la
 * fase.
 *
 * Un comando que no se puede expandir NO se manda: la fase falla con la causa,
 * sin invocar al runtime (ni gastar el modelo).
 *
 * @param {(fase: any, llamada?: any) => Promise<any>} runPhase
 * @param {any | (() => any)} capacidades el objeto de `capabilities()`, o como pedirlo
 * @param {{raiz?: string}} [opts]
 * @returns {(fase: any, llamada?: any) => Promise<any>}
 */
export function conComandosExpandidos(runPhase, capacidades, opts = {}) {
  // `llamada` (el segundo argumento: hoy, `alEvento` del transcript) pasa tal
  // cual: expandir el encargo no cambia a quien se le cuenta lo que pasa.
  return async (fase, llamada) => {
    const caps = (typeof capacidades === "function" ? capacidades() : capacidades) || {};
    if (caps.comandos === true || typeof fase?.prompt !== "string") return runPhase(fase, llamada);

    const e = expandirComando(fase.prompt, { task: fase.task, hooks: caps.hooks === true, raiz: opts.raiz });
    if (!e.ok) {
      return {
        ok: false,
        sessionId: null,
        usd: null,
        text: e.causa,
        budgetExhausted: false,
        subtype: "comando_sin_expansion",
      };
    }
    return runPhase(e.expandido ? { ...fase, prompt: e.prompt } : fase, llamada);
  };
}
