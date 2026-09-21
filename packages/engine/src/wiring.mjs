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
// La capa de runtimes. El motor NO la conocia: `grep -rn adapters` sobre
// `packages/engine` devolvia una sola linea, y era la guarda de la
// constitucion. El registro existia y no lo consultaba nadie.
import { adaptarADriver, crearAdaptadorClaude, registroDeAdaptadores } from "../../adapters/src/index.mjs";
// El entorno de un subproceso se CONSTRUYE. Ver `entornoDeFase` mas abajo.
import { construirEntorno } from "../../vault/src/entorno.mjs";
import { repoRoot } from "./repos.mjs";
import { runGate, runSingleTest } from "./gate.mjs";
import { createPR } from "./forge.mjs";
import * as worktree from "./worktree.mjs";
import { createLogger } from "./log.mjs";
import { buildHookSettings, validateHookSettings } from "./session-settings.mjs";
import { validate } from "./schema.mjs";

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

  // LAS OPCIONES DEL PROVEEDOR, CONTRA EL ESQUEMA QUE EL PROVEEDOR DECLARA.
  //
  // EL FALLO QUE CIERRA (T114): en `config.schema.json`, `provider.options` es
  // `{"type":"object"}` sin `properties`, asi que nada de lo que un gestor
  // necesita ahi se comprobaba. Una opcion mal escrita —`organizacion` por
  // `organization`— pasaba la validacion entera y fallaba a mitad de un
  // recorrido, con el modelo ya pagado. Es la clase de fallo que D9 dice que
  // validar vino a matar.
  //
  // EL ESQUEMA LO TRAE EL PROVEEDOR porque el motor no sabe que necesita un
  // gestor. Si viviera en el esquema del motor, agregar un proveedor exigiria
  // tocar el motor, y el principio VI dice lo contrario.
  //
  // Se valida SOLO lo que escribio una persona: `stateMap` y `levelMap` los
  // agrega el motor mas abajo, y juzgarlos contra un esquema con
  // `additionalProperties: false` rechazaria una configuracion correcta.
  if (mod.optionsSchema != null) {
    if (typeof mod.optionsSchema !== "object" || Array.isArray(mod.optionsSchema)) {
      throw new Error(
        `el proveedor "${config.provider.name}" exporta un \`optionsSchema\` que no es un objeto ` +
        `(llego ${Array.isArray(mod.optionsSchema) ? "una lista" : typeof mod.optionsSchema}). ` +
        `Un esquema invalido no puede degradarse a "no valida nada": seria peor que no declararlo.`,
      );
    }
    const problemas = validate(mod.optionsSchema, config.provider.options || {});
    if (problemas.length) {
      throw new Error(
        `las opciones del proveedor "${config.provider.name}" no validan contra su propio esquema:\n  - ` +
        problemas.join("\n  - ") +
        `\n\nSe comprueba al cargar y no a mitad del recorrido a proposito: una opcion mal escrita que ` +
        `revienta en la fase GREEN ya gasto el modelo.`,
      );
    }
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
    // QUIEN ES NOXLOOP EN EL GESTOR, y va aparte de `options` a proposito: es
    // la misma pregunta para todo proveedor, no una opcion de uno.
    //
    // EL FALLO QUE CIERRA: `identity` estaba en el esquema, ADOPTING decia que
    // lo consumen `inbox` y `daemon`, y el motor no lo leia en ningun lugar.
    // Los proveedores usaban implicitamente el dueño del token, asi que
    // declarar otro responsable no hacia nada — y no avisaba. Se llena siempre,
    // con null explicito, para que un proveedor pueda distinguir "no declarado"
    // de "no me llego".
    identity: {
      assignee: config.identity?.assignee ?? null,
      mention: config.identity?.mention ?? null,
    },
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
 * Las variables de la MAQUINA que una fase necesita para poder arrancar algo.
 *
 * Estan nombradas una a una a proposito: es la diferencia entre un entorno
 * declarado y `{ ...process.env }`. Ninguna de las nueve es una credencial —
 * son las que hacen que un proceso pueda encontrar sus binarios, escribir en un
 * temporal y hablar el idioma de la maquina. Lo que si es credencial entra por
 * otro lado: lo declara el runtime en `requiredEnv`, y lo declara el, no el
 * motor, porque nombrar aqui la variable de un runtime concreto es la misma
 * ramificacion que el principio VI prohibe.
 *
 * @type {readonly string[]}
 */
export const VARIABLES_DE_LA_MAQUINA = Object.freeze([
  "PATH", "HOME", "SHELL", "LANG", "LC_ALL", "TMPDIR", "TZ", "USER", "LOGNAME",
]);

/**
 * El entorno con el que corre UNA fase.
 *
 * EL FALLO QUE CIERRA, y estaba medido. `runner.mjs` lanzaba la sesion con
 * `{ ...process.env, CI: "1", ... }`, asi que el subproceso del agente recibia
 * TODO lo que el motor tuviera cargado: la credencial del gestor de tickets, la
 * del forge, lo que hubiera en el shell del operador. El grant autorizaba una
 * cosa y el agente recibia quince — con lo que la capa de grants, que es el
 * diferencial del producto, quedaba decorativa. El contrato de adaptadores se
 * niega a invocar sin `env` por este motivo exacto, escrito ahi: "heredar el
 * del motor no es un modo degradado: es la fuga".
 *
 * SE CONSTRUYE POR FASE Y NO UNA VEZ AL ARRANCAR: un grant que caduca a mitad
 * del recorrido tiene que dejar de valer en la fase siguiente, y un entorno
 * capturado al principio seguiria valiendo hasta el final.
 *
 * PASA POR `construirEntorno` DE LA BOVEDA y no por un objeto a mano: ahi estan
 * la comprobacion de que cada nombre es un nombre de variable valido y la de
 * que cada valor es texto. Un valor que no sea texto no falla al construirlo,
 * falla al spawnear, con el modelo ya pagado.
 *
 * @param {any} config
 * @param {{env?: Record<string, string|undefined>, requeridas?: readonly string[]}} [opts]
 * @returns {Record<string, string>}
 */
export function entornoDeFase(config, opts = {}) {
  const disponibles = opts.env || process.env;
  /** @type {Record<string, string>} */
  const variables = {};

  for (const nombre of [...VARIABLES_DE_LA_MAQUINA, ...(opts.requeridas || [])]) {
    const valor = disponibles[nombre];
    // Una variable declarada y ausente NO se rellena con "": el subproceso
    // distingue "no esta" de "esta vacia", y un PATH vacio es peor que ninguno.
    if (typeof valor === "string" && valor !== "") variables[nombre] = valor;
  }

  variables.CI = "1";
  // El limite de autonomia no puede depender de que la tarea activa se
  // resuelva: adentro de una sesion del motor no hay persona a la que un
  // bloqueo de mas pueda dejar sin trabajar.
  variables.NOXLOOP_GUARD_ALWAYS = "1";
  // Sin esto los hooks miran `~/.noxloop`, donde no hay ninguna tarea activa:
  // o sea, sesion sin guarda y sin aviso. Es un fallo observado.
  if (config?.home) variables.NOXLOOP_HOME = String(config.home);

  return construirEntorno({ variables }).paraSpawn();
}

/**
 * El runtime que va a correr las fases, montado desde el registro.
 *
 * POR QUE SE MONTA AQUI Y NO EN EL DRIVER. Porque el binario, los hooks, el
 * home y el techo de tiempo son cosas del cableado, y porque el driver tiene
 * que poder ignorar por completo cual runtime corre: en cuanto el motor
 * pregunta "¿cual es?" aparece el `if` que el principio VI prohibe.
 *
 * LAS GUARDAS VAN CON EL ADAPTADOR, y si no se pueden armar no se monta nada.
 * Una sesion sin hooks se saltea el paso RED y el limite del principio IV, las
 * dos cosas en silencio — esta medido que un bloque `hooks` invalido se ignora
 * sin avisar. Fallar aqui convierte ese silencio en un error de arranque, que
 * es varias horas antes que a mitad de una fase.
 *
 * @param {any} config
 * @param {{home: string, log: any, engineRoot?: string, adaptadores?: any[], runtime?: string, env?: any}} opts
 */
function montarRuntime(config, opts) {
  const guardas = buildHookSettings(opts.engineRoot);
  const v = validateHookSettings(guardas);
  if (!v.ok) {
    throw new Error(
      `no se puede montar el runtime con las guardas puestas: ${v.missing?.length
        ? `estos hooks declarados no existen en disco:\n  - ${v.missing.join("\n  - ")}`
        : "no se declaro ningun hook"}\n` +
      "Una sesion sin guardas se saltea el paso RED y el limite del principio IV, y no avisa.",
    );
  }

  const adaptadores = opts.adaptadores || [
    // El adaptador de referencia. Es el que `wiring.mjs` ya elegia a su manera
    // —`via: sdkAvailable() ? "agent-sdk" : "cli"`—; la diferencia es que ahora
    // la degradacion la DECLARA el en `capabilities()` en vez de ocurrir.
    crearAdaptadorClaude({
      home: opts.home,
      hooks: guardas,
      timeoutMs: (config.limits?.phaseTimeoutMin ?? 30) * 60_000,
      // El home entra como directorio extra porque la fase de planificacion
      // escribe el plan AHI, fuera del worktree: sin esto la planificacion no
      // puede dejar su resultado y el motor lo lee como "no se pudo planificar".
      directoriosExtra: [opts.home],
      alProgreso: (e, peticion) => {
        if (e.tipo === "tool_use") opts.log.info(`${peticion.phase} ${peticion.taskId || ""}: ${e.detalle.nombre}`);
      },
    }),
  ];

  const registro = registroDeAdaptadores(adaptadores);
  const id = opts.runtime || adaptadores[0]?.id;
  const adaptador = registro.obtener(id);
  if (!adaptador) {
    throw new Error(
      `el runtime "${id}" no esta registrado. Los que hay: ${registro.ids().join(", ") || "ninguno"}. ` +
      "El id es lo que guarda `Agent.runtime`: si no resuelve, no hay nada que invoque al modelo.",
    );
  }

  return { registro, adaptador };
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

  const { registro, adaptador } = montarRuntime(config, {
    home, log, engineRoot: opts.engineRoot, adaptadores: opts.adaptadores, runtime: opts.runtime,
  });

  // EL ENTORNO VIAJA COMO FUNCION, no como objeto ya hecho. Es lo que hace que
  // se construya por fase: ver `entornoDeFase`.
  const entorno = () => entornoDeFase(config, { env: opts.env, requeridas: adaptador.requiredEnv });

  // CUALES DE ESAS VARIABLES SON SECRETAS, y viaja con la peticion porque el
  // mapa plano de `env` no lo dice. Son exactamente las que el runtime declaro
  // necesitar: las de la maquina no lo son —ver `VARIABLES_DE_LA_MAQUINA`— y
  // tratarlas como tales dejaba la guarda de argv dando positivo siempre, que
  // es la forma mas rapida de que alguien la apague.
  const secretos = [...(adaptador.requiredEnv || [])].filter((n) => Object.hasOwn(entorno(), n));

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
    // Por que via corrio ya no se deduce de si un paquete esta instalado: lo
    // dice el runtime que se monto.
    via: adaptador.id,
    runtime: adaptador.id,
    adaptador,
    registroDeRuntimes: registro,
    entorno,
    secretos,
    // LA COSTURA, y es una linea. `adaptarADriver` convierte un `AgentAdapter`
    // en la funcion que el driver ya inyectaba: el motor sigue llamando
    // `deps.runPhase(...)` y no sabe —ni tiene por que— cual runtime hay
    // detras.
    runPhase: adaptarADriver(adaptador, { entorno }),
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
