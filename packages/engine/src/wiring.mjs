// El cableado: convierte una configuracion en las dependencias que el driver y
// el planificador esperan.
//
// POR QUE EXISTE COMO MODULO APARTE. El driver recibe TODO inyectado —el
// proveedor, el gate, el forge, la resolucion de repositorios— porque asi se
// prueba sin red, sin credenciales y sin modelo. Ese diseño necesita un lugar
// donde armar las piezas de verdad, y no puede ser el CLI: un CLI con la logica
// de cableado adentro no se puede probar.

import { join } from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { validateProvider } from "../../../providers/contract.mjs";
import { repoRoot } from "./repos.mjs";
import { runGate, runSingleTest } from "./gate.mjs";
import { runPhase, sdkAvailable, DEFAULT_ALLOWED_TOOLS } from "./runner.mjs";
import { createPR } from "./forge.mjs";
import * as worktree from "./worktree.mjs";
import { createLogger } from "./log.mjs";

/**
 * Carga el proveedor declarado y lo valida ANTES de usarlo.
 *
 * Una capacidad declarada en `true` sin su funcion no falla al cargar: falla a
 * mitad de un recorrido, como una capacidad que no esta. Validar aca convierte
 * ese fallo tardio en un error de arranque.
 */
export async function loadProvider(config, opts = {}) {
  const env = opts.env || process.env;
  const mod = await import(config.provider.module);
  const v = validateProvider(mod);
  if (!v.ok) {
    throw new Error(
      `el proveedor "${config.provider.name}" no cumple el contrato:\n  - ${v.problems.join("\n  - ")}`,
    );
  }

  for (const nombre of mod.requiredEnv || []) {
    if (!env[nombre]) {
      throw new Error(`falta la variable de entorno ${nombre}, que el proveedor "${config.provider.name}" necesita`);
    }
  }

  const ctx = {
    // El proveedor NO lee la configuracion ni el entorno por su cuenta: recibe
    // lo que necesita. Es lo que lo hace probable sin red ni credenciales.
    options: { ...(config.provider.options || {}), stateMap: config.provider.stateMap, levelMap: config.provider.levelMap },
    env: Object.fromEntries((mod.requiredEnv || []).map((k) => [k, env[k]])),
    log: opts.log || createLogger({ home: config.home, quiet: true }),
    fetch: fetchConReintentos,
  };

  return { mod, ctx };
}

/**
 * Cliente HTTP con reintentos y respeto del limite de tasa.
 *
 * Vive en el ctx y no en cada proveedor a proposito: el manejo de 429 y de
 * `Retry-After` es identico en todos, y repetirlo por proveedor es como uno
 * termina sin el.
 */
async function fetchConReintentos(url, init = {}, opts = {}) {
  const intentos = opts.retries ?? 3;
  for (let i = 0; i < intentos; i++) {
    const r = await fetch(url, init);
    if (r.status !== 429 && r.status < 500) return r;
    if (i === intentos - 1) return r;
    const retryAfter = Number(r.headers.get("retry-after"));
    const esperaMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(30_000, 500 * 2 ** i);
    await new Promise((res) => setTimeout(res, esperaMs));
  }
  throw new Error(`no se pudo completar la peticion a ${url}`);
}

/** `Modulo Paula - explicacion larga` -> `modulo-paula`. Sin acentos: una rama
 * llamada `feature/76-m-dulo` no la lee nadie. */
export function slug(titulo, maximo = 28) {
  return String(titulo || "")
    .split(/[·:–—|]/)[0]
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .split("-")
    .reduce((acc, w) => (acc && (acc + "-" + w).length > maximo ? acc : acc ? acc + "-" + w : w), "");
}

export function itemBranchName(item) {
  return `feature/${item.id}-${slug(item.title)}`;
}

/**
 * Resuelve, por repositorio, donde esta el checkout, donde vive la rama del
 * item, y sobre que base nace.
 *
 * La rama del item necesita su PROPIO worktree: el checkout principal puede
 * tener trabajo de una persona, y la cola de integracion tiene que poder hacer
 * fast-forward sobre esa rama sin pelearse con nadie.
 */
export function makeResolve(config, opts) {
  const { home, item } = opts;
  const cache = new Map();

  /**
   * @param {string} repo
   * @param {{item?: object, itemBranch?: string, baseBranch?: string}} [over]
   *   El recorrido de un hito pasa rama y base EXPLICITAS: la rama del hito, y
   *   una rama por historia que nace de ella.
   */
  return (repo, over = {}) => {
    const declarado = config.repos?.[repo];
    if (!declarado) throw new Error(`el repositorio "${repo}" no esta declarado en la configuracion`);

    const elItem = over.item || item;
    const baseBranch = over.baseBranch || opts.baseBranch || declarado.baseBranch;
    const itemBranch = over.itemBranch || opts.itemBranch || itemBranchName(elItem);

    // LA CLAVE DEL CACHE INCLUYE LA RAMA, y el fallo que evita lo destapo el
    // recorrido de un hito: ahi se resuelven VARIAS ramas del mismo repositorio
    // —la del hito y una por historia—, y un cache indexado solo por
    // repositorio devolvia la primera para todas. La segunda historia habria
    // trabajado en el worktree de la primera, y su gate habria medido el codigo
    // ajeno.
    const clave = `${repo}::${itemBranch}`;
    if (cache.has(clave)) return cache.get(clave);

    const repoPath = repoRoot(repo, config, { search: opts.search });
    // El nombre del worktree sale de la rama y no del id del item, por lo mismo.
    const integrationPath = join(home, "worktrees", repo, slug(itemBranch, 60) || `item-${elItem.id}`);

    if (!existsSync(integrationPath)) {
      worktree.add(repoPath, { branch: itemBranch, base: baseBranch, dest: integrationPath });
    }

    const resuelto = { repoPath, integrationPath, itemBranch, baseBranch };
    cache.set(clave, resuelto);
    return resuelto;
  };
}

/**
 * Las dependencias completas del driver.
 *
 * `runPhase` se envuelve para que el driver no tenga que saber como se construye
 * el prompt de una fase ni que herramientas se permiten.
 */
export async function buildDeps(item, config, opts = {}) {
  const home = config.home;
  const log = opts.log || createLogger({ home });
  const inyectado = opts.provider || opts.inject?.provider;
  const { mod: provider, ctx: providerCtx } = inyectado
    ? { mod: inyectado, ctx: opts.providerCtx || opts.inject?.providerCtx || {} }
    : await loadProvider(config, { log });

  const resolve = makeResolve(config, {
    home, item, search: opts.search, itemBranch: opts.itemBranch, baseBranch: opts.baseBranch,
  });

  // LAS INYECCIONES VAN AL FINAL, y existen para una sola cosa: que el camino
  // completo se pueda probar sin red, sin credenciales y sin modelo. Lo que se
  // reemplaza es unicamente lo que no puede existir offline —el modelo y el
  // forge—; todo lo demas corre de verdad, porque si se inyectara tambien el
  // test dejaria de probar el cableado.
  const overrides = opts.inject || {};

  return {
    home,
    config,
    log,
    provider,
    providerCtx,
    resolve,
    runGate,
    runSingleTest,
    createPR,
    dryRun: Boolean(opts.dryRun),
    maxParallelTasks: config.limits?.maxParallelTasks ?? 4,
    via: sdkAvailable() ? "agent-sdk" : "cli",
    runPhase: (fase) =>
      runPhase({
        prompt: fase.prompt,
        cwd: fase.cwd,
        home,
        model: fase.model,
        effort: fase.effort,
        resume: fase.resume,
        allowedTools: DEFAULT_ALLOWED_TOOLS,
        timeoutMs: (config.limits?.phaseTimeoutMin ?? 30) * 60_000,
        addDirs: [home],
        onProgress: (e) => {
          if (e.tipo === "tool_use") {
            log.info(`${fase.phase} ${fase.taskId || ""}: ${e.detalle.nombre}`);
          }
        },
      }),
    ...overrides,
  };
}

/** El worktree donde corre la planificacion: la spec vive donde el trabajo que describe. */
export function planWorkdir(config, item, repo) {
  const resolve = makeResolve(config, { home: config.home, item });
  return resolve(repo).integrationPath;
}

/**
 * Los binarios que una tarea de este repositorio puede correr.
 *
 * Sale de lo que el repositorio DECLARA necesitar —su gate y sus runners— y no
 * de una constante del motor. Es la mitad que faltaba de la guarda invertida:
 * sin esto, el hook tendria que adivinar, y adivinar es como una lista de
 * permitidos se vuelve una lista de prohibidos otra vez.
 *
 * Los prefijos ejecutores no entran ni aunque el repositorio los declare: `env`
 * o `bash -c` delante de un comando permitido devuelve el agujero entero.
 *
 * @param {object | null} repo la entrada de `repos` en la configuracion
 * @returns {string[]}
 */
export function comandosPermitidos(repo) {
  if (!repo || typeof repo !== "object") return [];
  const NUNCA = new Set(["env", "sudo", "command", "eval", "exec", "bash", "sh", "zsh", "xargs", "time", "nohup", "ssh"]);

  const plantillas = [repo.gate, repo.fastGate, ...Object.values(repo.runners || {})].filter(Boolean);
  const binarios = new Set();
  for (const plantilla of plantillas) {
    // Un gate es una tuberia de shell escrita por una persona: se parte en
    // segmentos y se toma el primer token de cada uno.
    for (const segmento of String(plantilla).split(/&&|\|\||;|\|/)) {
      const t = segmento.trim().split(/\s+/).filter(Boolean)[0];
      if (!t) continue;
      const cmd = t.replace(/^.*\//, "").replace(/["']/g, "");
      if (!NUNCA.has(cmd)) binarios.add(cmd);
    }
  }
  return [...binarios];
}

/** Los repos que el proyecto declara, para acotar el alcance de un plan. */
export function reposDeclarados(config) {
  return Object.keys(config.repos || {});
}

/** Version de git, para doctor y para el reporte de un recorrido. */
export function gitVersion() {
  try {
    return execFileSync("git", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}
