// El diagnostico: por que un run no va a arrancar, ANTES de pulsar Run (spec
// 004, US1, FR-001..003).
//
// -----------------------------------------------------------------------------
// LO QUE MIRA
// -----------------------------------------------------------------------------
//
// La maquina: `git`, `claude`, `codex` y el `node` con el que corre el motor,
// con su version. Y cada proyecto: si su carpeta es un repositorio, si Claude
// Code confia en el, si tiene gate y si el runtime de cada rol de su flota
// tiene con que invocar al modelo. Cada problema sale con `causa` y `accion`
// (NFR-006) y con A QUIEN afecta: un `codex` ausente no tiene por que apagar
// las tareas que corren con Claude.
//
// -----------------------------------------------------------------------------
// SOLO LEE (FR-002)
// -----------------------------------------------------------------------------
//
// No escribe en `~/.claude.json` —es configuracion de otra herramienta: se lee
// y se dice como aceptarla, nunca se acepta por el operador—, ni en el repo, ni
// en el home. Por eso el repositorio se reconoce leyendo `.git` a mano y no con
// `git rev-parse` (hay comandos de git que escriben el indice con solo
// preguntarles), y los binarios solo reciben `--version`. Hay un test que mide
// el disco antes y despues.
//
// -----------------------------------------------------------------------------
// LA CONFIANZA DE CLAUDE CODE, Y POR QUE HAY TRES ESTADOS
// -----------------------------------------------------------------------------
//
// Se lee `projects[<ruta>].hasTrustDialogAccepted` de `~/.claude.json`. Es un
// formato INTERNO de Claude Code, observado el 2026-09-24 en la version
// 2.1.281, y por eso existe `desconocida` (principio X): archivo ausente,
// ilegible o con otra forma no es «pendiente» ni «aceptada», es «no se sabe» y
// se dice por que. Lo que se replica de esa version, leido de su binario:
//
//   - la clave es la ruta REAL (los enlaces resueltos): en macOS `/tmp` es
//     `/private/tmp`, y la entrada existe con esa forma;
//   - un worktree se juzga por su repositorio CANONICO: la confianza del repo
//     principal cubre sus worktrees;
//   - si la ruta no tiene entrada aceptada, se sube por los padres SOLO hasta
//     la raiz del repositorio. Un `~/proyectos` aceptado no cubre lo de dentro.
//
// POR QUE IMPORTA AUNQUE EL MOTOR CORRA CON `-p`. En modo no interactivo Claude
// Code no muestra el dialogo (no se cuelga), pero sin confianza IGNORA la
// configuracion del proyecto —`.claude/settings.json`, sus hooks y sus
// servidores MCP— y lo dice por stderr. El run corre, pero no con lo que el
// repositorio declara. La spec 004 decide que eso bloquea Run para las tareas
// de Claude; `nivel` es la palanca si un dia se decide que baste un aviso.
//
// Y LA RUTA DE LAS FASES NO ES LA DEL REPO. El motor corre cada fase en un
// worktree bajo `<home>/worktrees/<repo>/<item>-<tarea>` (driver del motor,
// `abrirTarea`), y la planificacion en `<home>/worktrees/<repo>/<rama>`. Cada
// worktree es nuevo, asi que nunca tendra entrada propia: lo que cuenta es la
// confianza del repositorio canonico, que es la que se juzga aqui. La ruta de
// las fases se devuelve igual, para que el operador sepa donde corre.

import { execFile } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { RUNTIMES_CON_SESION } from "../../adapters/src/autenticacion.mjs";
import { carpetasConocidas, pathAmpliado, resolverBinario } from "../../adapters/src/binarios.mjs";
import { exigirProyecto, slugDe } from "./comun.mjs";
import { ejecutorDelProyecto, flotaDelProyecto, resolverEjecutor } from "./ejecutor.mjs";
import { VARIABLES_DEL_ENTORNO_BASE } from "./lanzador.mjs";
import { ErrorDeServicio } from "./errores.mjs";
import { diagnosticar } from "./motor.mjs";
import { estadosDeRuntimes } from "./runtimes.mjs";

/** Cuanto se espera a un `--version`. Un binario que tarda mas esta roto o colgado. */
export const ESPERA_DE_VERSION_MS = 5_000;

/** La version minima de node que el motor declara en `engines`. */
export const NODE_MINIMO = 22;

/** Como se llama la accion de la confianza, para que la interfaz y el board digan lo mismo. */
const aceptarEn = (/** @type {string} */ ruta) => `abre \`claude\` una vez en ${ruta} y acepta el dialogo`;

/**
 * Los binarios que se miran, a quien afecta cada uno si falta, y como se
 * instala. `afecta: null` es «todo»: sin git no hay worktree, y sin node no
 * hay motor.
 */
const BINARIOS = Object.freeze([
  {
    nombre: "git",
    afecta: null,
    comoInstalar: "Instala git (`xcode-select --install` en macOS, o el instalador de tu sistema) y dejalo en el PATH del servicio.",
  },
  {
    nombre: "claude",
    afecta: "claude-agent-sdk",
    comoInstalar: "Instala Claude Code (`npm install -g @anthropic-ai/claude-code`) y dejalo en el PATH del servicio.",
  },
  {
    nombre: "codex",
    afecta: "codex",
    comoInstalar: "Instala Codex (`npm install -g @openai/codex`) y dejalo en el PATH del servicio.",
  },
  {
    nombre: "node",
    afecta: null,
    comoInstalar: `Instala Node ${NODE_MINIMO} o posterior (https://nodejs.org) y reinicia la aplicacion.`,
  },
]);

/**
 * @typedef {{code: number|null, stdout: string, stderr: string, agotado?: boolean, ruta?: string}} SalidaDeVersion
 * @typedef {(argv: string[], o: {env: Record<string, string>, timeoutMs: number}) => Promise<SalidaDeVersion>} EjecutorDeVersion
 *
 * @typedef {object} Problema
 * @property {string} codigo
 * @property {"bloqueante"|"aviso"} nivel
 * @property {string|null} afecta el runtime al que afecta, o `null` si a todo
 * @property {string} causa
 * @property {string} accion
 * @property {string} motivo la frase corta que el board pone en el boton
 * @property {string} [binario]
 */

/**
 * El ejecutor de produccion: el binario con `--version`, sin shell, con el
 * entorno que se le da y un tope. Lanza con `code: "ENOENT"` si no esta; si
 * no contesta a tiempo devuelve `agotado`.
 *
 * EL BINARIO SE BUSCA COMO LO BUSCA LA FASE: en el PATH del servicio y despues
 * en las carpetas donde lo dejan los instaladores (`binarios.mjs`). Una app de
 * macOS abierta desde el Dock recibe `/usr/bin:/bin:/usr/sbin:/sbin`; si aqui
 * se preguntara solo con ese PATH, el diagnostico diria «falta `claude`» con
 * Claude Code instalado en `~/.local/bin`, y el motor —que si lo encuentra—
 * contradiria a la pantalla. Devuelve la `ruta` que uso.
 *
 * @type {EjecutorDeVersion}
 */
export function ejecutorDeVersion(argv, { env, timeoutMs }) {
  const ruta = resolverBinario(argv[0], { env }) ?? argv[0];
  // Con el PATH ampliado, como la fase: un `claude` de npm es un script de node.
  const conPath = { ...env, PATH: pathAmpliado(env) };
  return new Promise((resolver, rechazar) => {
    const hijo = execFile(ruta, argv.slice(1), { env: conPath, timeout: timeoutMs, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error && /** @type {any} */ (error).code === "ENOENT") return rechazar(error);
      if (error && /** @type {any} */ (error).killed) return resolver({ code: null, stdout: "", stderr: "", agotado: true, ruta });
      const code = error ? (typeof (/** @type {any} */ (error).code) === "number" ? /** @type {any} */ (error).code : 1) : 0;
      resolver({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), ruta });
    });
    // `execFile` deja el stdin del hijo como un pipe abierto: un binario que lo
    // lee (Codex lee el prompt de stdin si no lo recibe) esperaria hasta el tope.
    // Nadie le va a escribir nada: se cierra.
    hijo.stdin?.end();
  });
}

/** El primer `x.y.z` de una salida, o `null`. */
const versionDe = (/** @type {string} */ texto) => /(\d+\.\d+(?:\.\d+)?)/.exec(texto)?.[1] ?? null;

/**
 * La maquina: la version de cada binario, y los problemas.
 *
 * @param {{ejecutar?: EjecutorDeVersion, nodo?: string, env?: Record<string, string>, timeoutMs?: number}} [o]
 */
export async function diagnosticoDeMaquina(o = {}) {
  const ejecutar = o.ejecutar ?? ejecutorDeVersion;
  const env = o.env ?? {};
  const timeoutMs = o.timeoutMs ?? ESPERA_DE_VERSION_MS;
  /** @type {Problema[]} */
  const problemas = [];

  // En paralelo: son cuatro procesos cortos, y en serie se sumarian.
  const binarios = await Promise.all(
    BINARIOS.map(async (b) => {
      const comando = b.nombre === "node" ? o.nodo ?? process.execPath : b.nombre;
      try {
        const s = await ejecutar([comando, "--version"], { env, timeoutMs });
        const version = versionDe(`${s.stdout}\n${s.stderr}`);
        if (s.agotado || s.code !== 0 || !version) {
          const causa = s.agotado
            ? `\`${b.nombre} --version\` no contesto en ${Math.round(timeoutMs / 1000)} s: el binario esta colgado o roto.`
            : `\`${b.nombre} --version\` ${s.code !== 0 ? `salio con ${s.code}` : "no imprimio una version"}.`;
          return { nombre: b.nombre, estado: "fallo", version: null, causa, accion: `Comprueba \`${b.nombre} --version\` en una terminal; si falla, reinstalalo. ${b.comoInstalar}` };
        }
        return { nombre: b.nombre, estado: "presente", version, ...(typeof s.ruta === "string" ? { ruta: s.ruta } : {}) };
      } catch (e) {
        const ausente = /** @type {any} */ (e)?.code === "ENOENT";
        return {
          nombre: b.nombre,
          estado: ausente ? "ausente" : "fallo",
          version: null,
          // El mensaje del error puede traer rutas; se dice el codigo.
          causa: ausente
            ? `\`${b.nombre}\` no esta en el PATH del servicio${env.PATH ? "" : " (el entorno del servicio no trae PATH)"} ` +
              `ni en las carpetas donde lo dejan los instaladores (${carpetasConocidas("~").join(", ")}).`
            : `\`${b.nombre} --version\` no se pudo lanzar (${/** @type {any} */ (e)?.code || "sin codigo"}).`,
          accion: b.comoInstalar,
        };
      }
    }),
  );

  for (const b of binarios) {
    const def = /** @type {any} */ (BINARIOS.find((x) => x.nombre === b.nombre));
    if (b.estado !== "presente") {
      problemas.push({
        codigo: b.estado === "ausente" ? "binario_ausente" : "binario_roto",
        nivel: "bloqueante",
        afecta: def.afecta,
        binario: b.nombre,
        causa: /** @type {string} */ (b.causa),
        accion: /** @type {string} */ (b.accion),
        motivo: `${b.estado === "ausente" ? `Falta \`${b.nombre}\`` : `\`${b.nombre}\` no contesta`} en esta maquina: ${def.comoInstalar}`,
      });
    }
  }
  const node = binarios.find((b) => b.nombre === "node");
  if (node?.version && Number(node.version.split(".")[0]) < NODE_MINIMO) {
    problemas.push({
      codigo: "node_antiguo",
      nivel: "bloqueante",
      afecta: null,
      binario: "node",
      causa: `El motor corre con Node ${node.version} y exige ${NODE_MINIMO} o posterior.`,
      accion: `Instala Node ${NODE_MINIMO} o posterior (https://nodejs.org) y reinicia la aplicacion.`,
      motivo: `Node ${node.version} es anterior a ${NODE_MINIMO}: actualizalo y reinicia la aplicacion.`,
    });
  }
  return { binarios, problemas };
}

// ---------------------------------------------------------------------------
// El repositorio y la confianza
// ---------------------------------------------------------------------------

/**
 * La raiz git de una ruta real y su repositorio canonico, LEIDOS del disco:
 * sube hasta encontrar `.git`; si es un archivo (`gitdir: ...`), la ruta es un
 * worktree y su canonico es el repo que lo contiene.
 *
 * @param {string} real
 * @returns {{raiz: string, canonica: string}|null}
 */
export function raizDelRepositorio(real) {
  let dir = real;
  for (;;) {
    const punto = join(dir, ".git");
    if (existsSync(punto)) {
      let canonica = dir;
      try {
        if (statSync(punto).isFile()) {
          const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(punto, "utf8"));
          const gitdir = m ? (isAbsolute(m[1]) ? m[1] : resolve(dir, m[1])) : null;
          // `<principal>/.git/worktrees/<nombre>`: el canonico es `<principal>`.
          if (gitdir && basename(dirname(gitdir)) === "worktrees" && basename(dirname(dirname(gitdir))) === ".git") {
            canonica = realDe(dirname(dirname(dirname(gitdir)))) ?? canonica;
          }
        }
      } catch {
        /* un `.git` ilegible sigue siendo un repo; el canonico es el mismo */
      }
      return { raiz: dir, canonica };
    }
    const padre = dirname(dir);
    if (padre === dir) return null;
    dir = padre;
  }
}

/** @param {string} ruta */
function realDe(ruta) {
  try {
    return realpathSync(ruta);
  } catch {
    return null;
  }
}

/**
 * La confianza de Claude Code sobre una ruta, LEIDA. Nunca lanza.
 *
 * La evidencia nombra la clave y el booleano, y nada mas del archivo: el
 * `~/.claude.json` trae datos de la cuenta que no tienen por que salir de aqui.
 *
 * @param {{archivo: string, ruta: string}} e
 * @returns {{estado: "aceptada"|"pendiente"|"desconocida", archivo: string, clave: string|null, evidencia: string, causa?: string, accion?: string}}
 */
export function leerConfianza({ archivo, ruta }) {
  const real = realDe(ruta);
  const repo = real ? raizDelRepositorio(real) : null;
  const clave = repo ? repo.canonica : real;
  const aceptar = `Si la aceptaste en otra maquina o con otro usuario, ${aceptarEn(clave ?? ruta)} con el usuario del servicio.`;
  const desconocida = (/** @type {string} */ causa, /** @type {string} */ accion) => ({
    estado: /** @type {const} */ ("desconocida"),
    archivo,
    clave,
    evidencia: causa,
    causa,
    accion,
  });

  if (!real) {
    return desconocida(`La carpeta \`${ruta}\` no existe o no se puede leer: no hay ruta que buscar en ${archivo}.`, "Corrige la ruta del proyecto en Settings del proyecto → General.");
  }

  let texto;
  try {
    texto = readFileSync(archivo, "utf8");
  } catch (e) {
    const ausente = /** @type {any} */ (e)?.code === "ENOENT";
    return desconocida(
      ausente
        ? `No existe ${archivo}: Claude Code no se ha abierto nunca con este usuario, o guarda su configuracion en otro sitio (\`CLAUDE_CONFIG_DIR\`).`
        : `${archivo} no se puede leer (${/** @type {any} */ (e)?.code || "sin codigo"}).`,
      `${aceptarEn(clave ?? real)}; despues pulsa «Volver a comprobar».`,
    );
  }
  /** @type {any} */
  let j;
  try {
    j = JSON.parse(texto);
  } catch {
    return desconocida(`${archivo} no es JSON valido: no se puede saber que confianza guarda.`, `Abre \`claude\` una vez para que lo reescriba; ${aceptar}`);
  }
  const proyectos = j && typeof j === "object" ? j.projects : undefined;
  if (!proyectos || typeof proyectos !== "object" || Array.isArray(proyectos)) {
    return desconocida(
      `${archivo} no tiene \`projects\` con la forma conocida (un mapa de ruta a configuracion): puede ser otra version de Claude Code.`,
      `${aceptarEn(clave ?? real)} y pulsa «Volver a comprobar»; si sigue desconocida, noxloop no sabe leer esta version.`,
    );
  }

  const valor = (/** @type {string} */ k) =>
    Object.hasOwn(proyectos, k) && proyectos[k] && typeof proyectos[k] === "object" ? proyectos[k].hasTrustDialogAccepted : undefined;

  // Las claves que Claude Code consultaria, en su orden: el canonico, y de la
  // ruta real hacia arriba hasta la raiz del repo (sin pasarla).
  const candidatas = [/** @type {string} */ (clave)];
  if (repo) {
    for (let d = real; ; d = dirname(d)) {
      if (!candidatas.includes(d)) candidatas.push(d);
      if (d === repo.raiz || dirname(d) === d) break;
    }
  }
  const aceptadaEn = candidatas.find((k) => valor(k) === true);
  if (aceptadaEn) {
    return {
      estado: "aceptada",
      archivo,
      clave: aceptadaEn,
      evidencia: `${archivo} → projects["${aceptadaEn}"].hasTrustDialogAccepted = true`,
    };
  }
  const v = valor(/** @type {string} */ (clave));
  return {
    estado: "pendiente",
    archivo,
    clave,
    evidencia:
      v === undefined
        ? `${archivo} → no hay entrada para "${clave}" en \`projects\` (con \`hasTrustDialogAccepted\`): Claude Code no se ha abierto nunca ahi.`
        : `${archivo} → projects["${clave}"].hasTrustDialogAccepted = ${JSON.stringify(v)}`,
    causa:
      `Claude Code no ha aceptado la confianza de ${clave}. El motor lo lanza sin terminal (\`-p\`): no pregunta, pero ` +
      "ignora la configuracion del proyecto —`.claude/settings.json`, sus hooks y servidores MCP— y el run corre sin ella.",
    accion: `${aceptarEn(/** @type {string} */ (clave))}; despues pulsa «Volver a comprobar».`,
  };
}

// ---------------------------------------------------------------------------
// Un proyecto
// ---------------------------------------------------------------------------

/**
 * @param {import("./rutas.mjs").Peticion} p
 */
function archivoDeClaude(p) {
  const home = p.estado.motor?.homeDeClaude ?? process.env.CLAUDE_CONFIG_DIR ?? homedir();
  return join(home, ".claude.json");
}

/**
 * El diagnostico de UN proyecto. No lanza: lo que falla es un problema.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} proyecto
 */
async function diagnosticoDeProyecto(p, proyecto) {
  /** @type {Problema[]} */
  const problemas = [];
  const ruta = String(proyecto.ruta_local ?? "");
  const real = ruta ? realDe(ruta) : null;
  const repo = real ? raizDelRepositorio(real) : null;

  const repositorio = repo
    ? { estado: "ok", ruta, rutaReal: real, detalle: `${repo.raiz} es un repositorio git${repo.canonica !== repo.raiz ? ` (worktree de ${repo.canonica})` : ""}.` }
    : { estado: "problema", ruta, rutaReal: real, detalle: real ? `${real} no esta dentro de ningun repositorio git.` : `La carpeta ${ruta} no existe.` };
  if (!repo) {
    problemas.push({
      codigo: real ? "no_es_repositorio" : "carpeta_inexistente",
      nivel: "bloqueante",
      afecta: null,
      causa: `${repositorio.detalle} El motor trabaja en worktrees del repositorio: sin el, ninguna tarea arranca.`,
      accion: real
        ? `Inicializa el repositorio (\`git init\` en ${real}) o corrige la ruta en Settings del proyecto → General.`
        : "Corrige la ruta del proyecto en Settings del proyecto → General.",
      motivo: real ? `${real} no es un repositorio git.` : `La carpeta ${ruta} no existe.`,
    });
  }

  const leida = leerConfianza({ archivo: archivoDeClaude(p), ruta });
  const clave = slugDe(proyecto.slug || proyecto.nombre || basename(ruta));
  const rutaDeFase = join(p.estado.home, "worktrees", clave);
  const confianza = {
    ...leida,
    rutaDeFase,
    notaDeFase:
      `Las fases corren en worktrees bajo ${rutaDeFase}/, uno nuevo por tarea: nunca tienen entrada propia en ` +
      `${leida.archivo}. Claude Code juzga un worktree por su repositorio canonico${leida.clave ? ` (${leida.clave})` : ""}, asi que esa es la confianza que cuenta.`,
  };
  if (repo && leida.estado === "pendiente") {
    // AVISO Y NO BLOQUEO. Medido en `claude` 2.1.281: con `-p`, que es como el
    // motor lanza cada fase, Claude Code se da por confiado y no muestra el
    // dialogo; el run no falla ni se cuelga. Lo que pierde es la configuracion
    // propia del repo (`.claude/settings.json`, sus hooks y sus MCP), que
    // descarta con un aviso por stderr. Los hooks de noxloop viajan por
    // `--settings` y siguen aplicando.
    problemas.push({
      codigo: "confianza_pendiente",
      nivel: "aviso",
      afecta: "claude-agent-sdk",
      causa:
        `${/** @type {string} */ (leida.causa)} Sin confianza, Claude Code ignora la configuracion propia del ` +
        "repositorio (`.claude/settings.json`, sus hooks y sus MCP) en cada fase; los hooks de noxloop siguen, " +
        "porque llegan por `--settings`.",
      accion: /** @type {string} */ (leida.accion),
      motivo: `Claude Code no confia todavia en ${leida.clave}: ${aceptarEn(/** @type {string} */ (leida.clave))}.`,
    });
  } else if (leida.estado === "desconocida") {
    problemas.push({
      codigo: "confianza_desconocida",
      nivel: "aviso",
      afecta: "claude-agent-sdk",
      causa: /** @type {string} */ (leida.causa),
      accion: /** @type {string} */ (leida.accion),
      motivo: `No se sabe si Claude Code confia en ${ruta}.`,
    });
  }

  // El gate y lo demas que impide componer la configuracion: lo mismo que el
  // board y `POST /runs` dicen, con el mismo codigo.
  const motor = p.estado.motor;
  const diag = await diagnosticar(
    p.dep,
    proyecto,
    motor ? { raizDeProveedores: motor.raizDeProveedores, cargarGestor: motor.cargarGestor } : {},
  ).catch((e) => ({ gate: null, problema: { codigo: "fallo_interno", causa: String(e?.message ?? e), accion: "Mira la salida del servicio." }, datos: null }));
  const gate = diag.gate
    ? { declarado: true, comando: diag.gate.comando, de: diag.gate.de }
    : { declarado: false, comando: null, de: /** @type {any} */ (diag).datos?.gateHallado ?? null };
  // EL GATE SE DICE APARTE. `componerConfig` para en el primer problema, y un
  // proyecto sin remoto escondia que ademas no tiene gate: el operador arreglaba
  // uno y se encontraba el otro en la siguiente vuelta.
  if (!gate.declarado) {
    const e = new ErrorDeServicio("sin_gate", {
      nombre: proyecto.nombre,
      id: proyecto.id,
      hallado: gate.de ?? "no se encontro el runner de tests del proyecto",
    });
    problemas.push({ codigo: "sin_gate", nivel: "bloqueante", afecta: null, causa: e.causa, accion: e.accion, motivo: e.causa });
  }
  const repetido = diag.problema?.codigo === "sin_gate" || (!repo && diag.problema?.codigo === "sin_repo");
  if (diag.problema && !repetido) {
    problemas.push({
      codigo: diag.problema.codigo,
      nivel: "bloqueante",
      afecta: null,
      causa: diag.problema.causa,
      accion: diag.problema.accion,
      motivo: diag.problema.causa,
    });
  }

  // El runtime de cada rol. El implementador sale de la cascada (sin tarea:
  // el del proyecto o el general); revisor y planificador, de la flota.
  const flota = flotaDelProyecto(p.dep, proyecto.id);
  const roles = [
    { rol: "implementador", runtime: resolverEjecutor(null, ejecutorDelProyecto(p.dep, proyecto.id)).runtime, agente: null },
    ...(flota.revisor ? [{ rol: "revisor", runtime: flota.revisor.runtime, agente: flota.revisor.nombre }] : []),
    ...(flota.planificador ? [{ rol: "planificador", runtime: flota.planificador.runtime, agente: flota.planificador.nombre }] : []),
  ];
  const estados = await estadosDeRuntimes(p, roles.map((r) => r.runtime));
  const runtimes = roles.map((r) => {
    const e = estados.get(r.runtime) ?? {};
    return {
      rol: r.rol,
      runtime: r.runtime,
      agente: r.agente,
      conectado: typeof e.conectado === "boolean" ? e.conectado : null,
      detalle: e.detalle ?? (RUNTIMES_CON_SESION.includes(r.runtime) ? null : `noxloop no sabe preguntar si \`${r.runtime}\` tiene sesion.`),
      // «Sesion vencida» y no «sin sesion»: el binario dice que hay, y una fase
      // demostro que no la aceptan. Ver `runtimes.mjs`.
      ...(e.sesionVencida ? { sesionVencida: e.sesionVencida } : {}),
      ...(e.causa ? { causa: e.causa } : {}),
      ...(e.accion ? { accion: e.accion } : {}),
    };
  });
  for (const r of runtimes) {
    if (r.conectado !== false) continue;
    // El implementador afecta a las tareas que corren con ese runtime; el
    // revisor y el planificador, a todas las del proyecto: todas pasan por el.
    const vencida = Boolean(/** @type {any} */ (r).sesionVencida);
    problemas.push({
      // El mismo codigo: el board ya sabe que este problema lo pinta el estado
      // del runtime, y uno nuevo lo pintaria dos veces.
      codigo: "runtime_desconectado",
      nivel: "bloqueante",
      afecta: r.rol === "implementador" ? r.runtime : null,
      causa: vencida
        ? `El ${r.rol} (${r.runtime}) tiene la sesion vencida: ${r.causa ?? r.detalle}`
        : `El ${r.rol} (${r.runtime}) no tiene con que invocar al modelo: ${r.causa ?? r.detalle ?? "sin sesion ni API key"}`,
      accion: r.accion ?? "Conecta el runtime en Settings → Modelos.",
      motivo: vencida
        ? `Sesion vencida: el ${r.rol} usa ${r.runtime} y su credencial fue rechazada. ${r.accion ?? "Vuelve a iniciar sesion en Settings → Modelos."}`
        : `Conecta un modelo en Settings → Modelos: el ${r.rol} usa ${r.runtime} y no tiene sesion ni API key.`,
    });
  }

  const estado = problemas.some((x) => x.nivel === "bloqueante") ? "bloqueado" : problemas.length ? "aviso" : "ok";
  return {
    id: proyecto.id,
    nombre: proyecto.nombre,
    estadoDelProyecto: proyecto.estado,
    estado,
    repositorio,
    confianza,
    gate,
    runtimes,
    problemas,
  };
}

// ---------------------------------------------------------------------------
// La cache y la ruta
// ---------------------------------------------------------------------------

/**
 * Una entrada de la cache del diagnostico, o calcularla. La cache vive en el
 * motor (una por servicio) con el TTL del board: el board la consulta en cada
 * pintada y lanzar cuatro binarios cada vez no cabe en SC-004 de la 003.
 *
 * @template T
 * @param {import("./rutas.mjs").Peticion} p
 * @param {string} clave
 * @param {boolean} fresco
 * @param {() => Promise<T>} calcular
 * @returns {Promise<T>}
 */
async function enCache(p, clave, fresco, calcular) {
  const motor = p.estado.motor;
  if (!motor) return calcular();
  if (!motor.cacheDelDiagnostico) motor.cacheDelDiagnostico = new Map();
  const ahora = motor.reloj ? motor.reloj() : Date.now();
  const ttl = motor.ttlDelBoardMs ?? 30_000;
  const guardado = motor.cacheDelDiagnostico.get(clave);
  if (!fresco && guardado && ahora - guardado.ts < ttl) return guardado.valor;
  const valor = await calcular();
  motor.cacheDelDiagnostico.set(clave, { ts: ahora, valor });
  return valor;
}

/**
 * El entorno de los `--version`: el de la maquina filtrado por nombre, el
 * mismo que recibe el motor. Si se preguntara con todo `process.env`, un
 * binario que solo esta en el PATH de la terminal del operador saldria
 * «presente» y el motor —que no lo ve— moriria al buscarlo.
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
function entornoDeLaMaquina(p) {
  return (
    p.estado.motor?.entornoBase ??
    Object.fromEntries(VARIABLES_DEL_ENTORNO_BASE.filter((k) => typeof process.env[k] === "string").map((k) => [k, String(process.env[k])]))
  );
}

/**
 * @param {import("./rutas.mjs").Peticion} p
 * @param {boolean} fresco
 */
function maquinaDe(p, fresco) {
  const motor = p.estado.motor;
  return enCache(p, "maquina", fresco, () =>
    diagnosticoDeMaquina({ ejecutar: motor?.ejecutarDiagnostico, nodo: motor?.nodo, env: entornoDeLaMaquina(p) }),
  );
}

/**
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} proyecto
 * @param {boolean} fresco
 */
function proyectoDe(p, proyecto, fresco) {
  return enCache(p, `proyecto:${proyecto.id}`, fresco, () => diagnosticoDeProyecto(p, proyecto));
}

/**
 * Lo que el board necesita: por proyecto, los problemas BLOQUEANTES de la
 * maquina y del proyecto, con a quien afecta cada uno. Cacheado.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any[]} proyectos
 * @returns {Promise<Map<string, Problema[]>>}
 */
export async function bloqueosParaElBoard(p, proyectos) {
  const salida = new Map();
  if (!proyectos.length) return salida;
  const maquina = await maquinaDe(p, false);
  // Los binarios de los runtimes NO bloquean desde aqui: el board ya pregunta
  // por la sesion de cada runtime y, sin binario, deshabilita con «Conecta un
  // modelo». Dos motivos para lo mismo harian dudar de cual es el de verdad.
  const deMaquina = maquina.problemas.filter((x) => x.nivel === "bloqueante" && x.afecta === null);
  for (const proyecto of proyectos) {
    const d = await proyectoDe(p, proyecto, false);
    salida.set(
      String(proyecto.id),
      [...deMaquina, ...d.problemas.filter((x) => x.nivel === "bloqueante" && x.codigo !== "runtime_desconectado")],
    );
  }
  return salida;
}

/**
 * El primer problema que impide lanzar con este runtime, o `null`.
 *
 * @param {Problema[]|undefined} problemas
 * @param {string} runtime
 */
export function bloqueoPara(problemas, runtime) {
  return (problemas ?? []).find((x) => x.nivel === "bloqueante" && (x.afecta === null || x.afecta === runtime)) ?? null;
}

/**
 * `GET /v1/diagnostics[?project=<id>][&fresh=1]`
 *
 * `fresh=1` es «Volver a comprobar»: salta la cache, y como lo que cambio
 * puede habilitar o apagar Run, avisa al board para que se repinte.
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function diagnostico(p) {
  const pedido = p.url.searchParams.get("project");
  const fresco = p.url.searchParams.get("fresh") === "1";
  const proyectos = pedido
    ? [exigirProyecto(p.dep, pedido)]
    : p.dep.almacen.base.consultar("SELECT * FROM project WHERE workspace_id = ? ORDER BY nombre", [p.dep.workspace.id]);

  if (fresco) p.estado.motor?.cacheDeRuntimes?.clear?.();
  const maquina = await maquinaDe(p, fresco);
  const porProyecto = [];
  for (const proyecto of proyectos) porProyecto.push(await proyectoDe(p, proyecto, fresco));
  if (fresco) p.estado.bus?.emitir?.("board.invalidado", { projectId: pedido ?? null });

  return {
    cuerpo: {
      generado: new Date(p.estado.motor?.reloj ? p.estado.motor.reloj() : Date.now()).toISOString(),
      maquina,
      proyectos: porProyecto,
    },
  };
}
