// El ejecutor de verificacion: el UNICO productor de veredictos del motor.
//
// POR QUE ES UN MODULO Y NO UNA LINEA EN EL DRIVER. Porque el criterio de exito
// de una tarea es un exit code, y un agente que puede *decir* que algo paso
// termina diciendolo. Aca el veredicto es un objeto con el comando textual, el
// codigo de salida y la duracion: se persiste dentro de la tarea y sobrevive a
// la sesion que lo produjo.
//
// POR QUE EL COMANDO ES POR REPOSITORIO. Porque no hay uno uniforme, y asumirlo
// es como un orquestador falla en cinco de ocho repositorios: uno tiene lint de
// arquitectura, otro no tiene chequeo de tipos, otro no tiene tests. El
// comando, su env y lo que NO cubre se declaran por repositorio.

import { spawnSync } from "node:child_process";

const TIMEOUT_DEFECTO = 900_000;
const SALIDA_MAXIMA = 20_000;

function repoDe(nombre, config) {
  const repo = config.repos?.[nombre];
  if (!repo) {
    throw new Error(`el repositorio "${nombre}" no esta declarado en la configuracion`);
  }
  if (!repo.gate) {
    // Un repositorio sin comando de verificacion no produce un verde vacio:
    // produce un error de configuracion, que es lo que realmente es.
    throw new Error(`el repositorio "${nombre}" no declara un comando \`gate\``);
  }
  return repo;
}

function truncar(texto, maximo) {
  if (texto.length <= maximo) return texto;
  const cortado = texto.slice(-maximo);
  return `[...salida truncada: ${texto.length - maximo} caracteres omitidos del principio...]\n${cortado}`;
}

function ejecutar(comando, cwd, repo, opts) {
  const maxOutput = opts.maxOutput || SALIDA_MAXIMA;
  const t0 = Date.now();
  const r = spawnSync(comando, {
    cwd,
    shell: true,
    encoding: "utf8",
    timeout: repo.timeoutMs || opts.timeoutMs || TIMEOUT_DEFECTO,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(repo.env || {}), CI: "1" },
  });
  // spawnSync no tipa `code` en su error, pero es lo unico que distingue un
  // timeout de un fallo de spawn — y confundirlos haria que un gate cortado se
  // lea como un gate que no pudo arrancar.
  const errorDeSpawn = /** @type {NodeJS.ErrnoException | undefined} */ (r.error);
  const timedOut = errorDeSpawn?.code === "ETIMEDOUT" || r.signal === "SIGTERM";
  const salida = `${r.stdout || ""}${r.stderr || ""}`;

  return {
    command: comando,
    // Un timeout no tiene exit code: dejarlo en null y no en 0 es la diferencia
    // entre "se corto" y "paso".
    exitCode: timedOut ? null : r.status,
    ok: !timedOut && r.status === 0,
    timedOut,
    durationMs: Date.now() - t0,
    output: truncar(salida, maxOutput),
    gaps: repo.gaps || [],
    ranAt: new Date().toISOString(),
  };
}

/**
 * @param {string} nombre clave del repositorio en la configuracion
 * @param {string} cwd donde correr (normalmente el worktree de la tarea)
 * @param {object} config
 * @param {{kind?: "full"|"fast", maxOutput?: number, timeoutMs?: number}} [opts]
 */
export function runGate(nombre, cwd, config, opts = {}) {
  const repo = repoDe(nombre, config);
  // Sin `fastGate` declarado, el rapido cae al COMPLETO. Nunca se inventa una
  // version corta: un gate mas corto que el declarado no es el gate del repo.
  const comando = opts.kind === "fast" ? repo.fastGate || repo.gate : repo.gate;
  return ejecutar(comando, cwd, repo, opts);
}

/**
 * Parte una plantilla de runner en argv, respetando comillas.
 *
 * Hace falta porque {file} NO puede pasar por un shell: la ruta la escribe el
 * planificador, que es un modelo. Ejecutado antes de este arreglo: un plan que
 * `validatePlan` daba por bueno, con testFiles = "x.test.mjs; echo ... > f",
 * hacia que el motor ejecutara lo que el modelo quisiera. Es el unico camino en
 * el que el motor hacia algo arbitrario por su cuenta, sin pasar por ningun
 * hook — porque no pasa por la tool Bash.
 *
 * El `gate` del repositorio SI sigue corriendo con shell, y la diferencia es de
 * procedencia, no de comodidad: ese comando lo escribe una persona en la
 * configuracion; esta ruta la escribe un modelo.
 */
function aArgv(plantilla, file) {
  const partes = [];
  let actual = "";
  let comilla = null;
  for (const c of plantilla) {
    if (comilla) {
      if (c === comilla) comilla = null;
      else actual += c;
    } else if (c === '"' || c === "'") {
      comilla = c;
    } else if (/\s/.test(c)) {
      if (actual) partes.push(actual);
      actual = "";
    } else {
      actual += c;
    }
  }
  if (actual) partes.push(actual);

  // {file} se sustituye como UN elemento del argv, entero, sin volver a partir.
  return partes.flatMap((p) => (p.includes("{file}") ? [p.replaceAll("{file}", file)] : [p]));
}

/**
 * Corre UN test suelto, para el bucle RED/GREEN, donde correr el gate completo
 * en cada iteracion seria inviable.
 *
 * @param {{runner?: string, maxOutput?: number}} [opts]
 */
export function runSingleTest(nombre, cwd, file, config, opts = {}) {
  const repo = repoDe(nombre, config);
  const runners = repo.runners || {};
  const clave = opts.runner || Object.keys(runners)[0];
  const plantilla = runners[clave];
  if (!plantilla) {
    throw new Error(
      `el repositorio "${nombre}" no declara un runner para correr un test suelto (repos.${nombre}.runners)`,
    );
  }
  const argv = aArgv(plantilla, file);
  return ejecutarArgv(argv, cwd, repo, opts);
}

/** Como `ejecutar`, pero con argv y sin shell. */
function ejecutarArgv(argv, cwd, repo, opts) {
  const maxOutput = opts.maxOutput || SALIDA_MAXIMA;
  const t0 = Date.now();
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd,
    shell: false,
    encoding: "utf8",
    timeout: repo.timeoutMs || opts.timeoutMs || TIMEOUT_DEFECTO,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(repo.env || {}), CI: "1" },
  });
  const errorDeSpawn = /** @type {NodeJS.ErrnoException | undefined} */ (r.error);
  const timedOut = errorDeSpawn?.code === "ETIMEDOUT" || r.signal === "SIGTERM";
  const salida = `${r.stdout || ""}${r.stderr || ""}`;
  return {
    command: argv.join(" "),
    exitCode: timedOut ? null : r.status,
    ok: !timedOut && r.status === 0,
    timedOut,
    durationMs: Date.now() - t0,
    output: truncar(salida, maxOutput),
    gaps: repo.gaps || [],
    ranAt: new Date().toISOString(),
  };
}

/**
 * Corre el gate sobre la base, para saber de QUIEN es el fallo.
 *
 * La distincion decide si el siguiente intento sirve: un gate que ya estaba
 * roto antes de esta tarea no la bloquea a ella, y bloquearla por un fallo
 * ajeno es como se pierde una tarea que estaba bien.
 */
export function blameGate(nombre, cwdTarea, cwdBase, config, opts = {}) {
  const tarea = runGate(nombre, cwdTarea, config, opts);
  if (tarea.ok) return { culprit: "none", task: tarea, base: null };
  const base = runGate(nombre, cwdBase, config, opts);
  return {
    culprit: base.ok ? "task" : "base",
    task: tarea,
    base,
  };
}

// ------------------------------------------------ de quien es el fallo

/**
 * Señales de que el fallo es del ENTORNO y no de nadie que pueda arreglarlo
 * reintentando: falta una herramienta, no hay red, no hay permisos, no hay
 * disco.
 *
 * Cada patron esta anclado a la forma en que la herramienta lo dice, no a una
 * palabra suelta. `Cannot find module` a secas seria el ejemplo de lo que NO
 * hacer: un import roto del codigo propio dice exactamente eso, y clasificarlo
 * como entorno mandaria a bloquear una tarea que el modelo podia arreglar. Por
 * eso el patron exige que el modulo NO sea una ruta relativa.
 */
/** @type {Array<[RegExp, string]>} */
const SENIALES_DE_ENTORNO = [
  [/\bcommand not found\b/i, "un comando que no esta en el PATH"],
  [/\bcould not determine executable to run\b/i, "el gestor de paquetes no encontro el ejecutable"],
  [/^\s*(?:sh|bash|zsh):.*\bnot found\b/im, "el shell no encontro el comando"],
  [/Cannot find module ['"](?!\.)[^'"]+['"]/i, "falta una dependencia instalada"],
  [/\bENOTFOUND\b|\bEAI_AGAIN\b/, "no se pudo resolver un nombre de host"],
  [/\bECONNREFUSED\b|\bECONNRESET\b|\bETIMEDOUT\b/, "no se pudo conectar"],
  [/\bEACCES\b|\bEPERM\b/, "permisos"],
  [/\bENOSPC\b/, "no queda espacio en disco"],
  [/npm ERR!\s+network/i, "la red del gestor de paquetes"],
];

/**
 * Si el fallo es del entorno, mirando SOLO la salida y el codigo.
 *
 * Se decide sin correr nada a proposito: si falta `npm`, correr el gate sobre
 * la base tampoco va a funcionar, y seria pagar una segunda corrida para
 * aprender lo que la primera ya dijo.
 *
 * @param {{exitCode?: number|null, output?: string, timedOut?: boolean}} r
 * @returns {{es: boolean, senial?: string}}
 */
export function esFalloDeEntorno(r) {
  // Un timeout NO es entorno: lo mas comun es un test que cuelga, que es
  // codigo, y mandarlo a "no lo arregla ningun reintento" perderia la tarea.
  if (r?.timedOut) return { es: false };

  // 127 es, por convencion de POSIX, "comando no encontrado".
  if (r?.exitCode === 127) return { es: true, senial: "exit 127: comando no encontrado" };

  const texto = String(r?.output || "");
  for (const [re, senial] of SENIALES_DE_ENTORNO) {
    if (re.test(texto)) return { es: true, senial };
  }
  return { es: false };
}

/**
 * De quien es el fallo: del entorno, de la base, o del codigo de esta tarea.
 *
 * POR QUE LAS TRES CLASES Y NO DOS. `blameGate` ya distinguia base de tarea, y
 * nadie lo llamaba. Le faltaba la tercera, que es la que mas cuesta cuando se
 * clasifica mal: un fallo de entorno consume los tres intentos del bucle y
 * paga tres invocaciones del modelo para llegar al mismo lugar.
 *
 * NO SE ADIVINA. Si la base no se puede correr, la clase es "indeterminada" y
 * no "codigo": asumir que es de la tarea cuando no se sabe le hace cargar un
 * fallo ajeno, que es justo el modo de fallo que esto viene a cerrar.
 *
 * @param {{ok: boolean, exitCode?: number|null, output?: string, timedOut?: boolean}} resultado el gate en el worktree de la tarea
 * @param {(() => {ok: boolean, exitCode?: number|null, output?: string})|null} correrEnLaBase
 * @returns {{clase: "ninguna"|"entorno"|"base"|"codigo"|"indeterminada", porque?: string, base?: object}}
 */
export function claseDeFallo(resultado, correrEnLaBase) {
  if (resultado?.ok) return { clase: "ninguna" };

  const entorno = esFalloDeEntorno(resultado);
  if (entorno.es) {
    return {
      clase: "entorno",
      porque: `${entorno.senial}. Ningun reintento lo arregla: hay que arreglar el entorno donde corre el gate.`,
    };
  }

  if (typeof correrEnLaBase !== "function") {
    return { clase: "indeterminada", porque: "no se pudo comparar contra la base: no hay con que correrla" };
  }

  let base;
  try {
    base = correrEnLaBase();
  } catch (e) {
    return { clase: "indeterminada", porque: `no se pudo correr el gate sobre la base: ${e?.message || e}` };
  }

  if (base?.ok) return { clase: "codigo", base, porque: "el gate pasa sobre la base, asi que lo rompio esta tarea" };
  return {
    clase: "base",
    base,
    porque: "el gate ya fallaba sobre la base, antes de esta tarea: el fallo no es suyo",
  };
}

// ------------------------------------------------ convergencia

/**
 * Lo que cambia entre dos corridas del MISMO fallo y no dice nada sobre el.
 *
 * Sin esto, comparar la salida cruda diria "son distintos" siempre —cada
 * intento corre en otro worktree y tarda otra cosa— y el corte por no
 * convergencia no se dispararia nunca: otro limite que se lee como puesto y no
 * lo esta.
 *
 * Lo que NO se normaliza es igual de importante: los conteos de tests
 * ("3 failed, 10 passed") se dejan tal cual, porque pasar de tres a uno es la
 * señal de avance mas comun y borrarla haria cortar trabajo que estaba
 * llegando.
 *
 * @type {Array<[RegExp, string]>}
 */
const RUIDO = [
  [/\x1b\[[0-9;]*m/g, ""],                                  // colores de terminal
  [/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b/g, "<fecha>"],          // marcas de tiempo ISO
  [/\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g, "<hora>"],
  [/\(\s*\d+(?:\.\d+)?\s*(?:ms|s|m)\s*\)/gi, "(<dur>)"],    // duraciones entre parentesis
  [/\b\d+(?:\.\d+)?\s?(?:ms|µs)\b/gi, "<dur>"],
  [/\b[0-9a-f]{7,40}\b/gi, "<sha>"],                        // shas y hashes
  [/(?:\/[\w.@+-]+)*\/(?:var\/folders|tmp|T)\/[\w.@+-]+/g, "<tmp>"],  // directorios temporales
  [/\/(?:Users|home)\/[\w.-]+/g, "<home>"],                 // rutas de la persona
  [/\bpid[: ]+\d+\b/gi, "pid <n>"],
  [/\r/g, ""],
];

/**
 * La huella de un fallo: lo que lo identifica, sin lo que cambia solo.
 *
 * @param {string|null|undefined} texto
 * @returns {string|null} null si no hay con que comparar
 */
export function huellaDeFallo(texto) {
  if (typeof texto !== "string") return null;
  let t = texto;
  for (const [re, con] of RUIDO) t = t.replace(re, con);
  t = t.split("\n").map((l) => l.trim()).filter(Boolean).join("\n").trim();
  if (!t) return null;
  // La salida de un gate puede ser enorme; lo que identifica al fallo esta al
  // principio y al final. El medio es contexto que se repite.
  const CORTE = 4000;
  return t.length <= CORTE ? t : `${t.slice(0, CORTE / 2)}\n...\n${t.slice(-CORTE / 2)}`;
}

/**
 * Si el intento no convergio: produjo exactamente el mismo fallo que el anterior.
 *
 * DOS VECES ALCANZA. El modelo ya vio ese fallo textual y cambio algo; que
 * salga identico dice que lo que cambio no toca la causa. Un tercer intento
 * cuesta lo mismo y termina igual.
 *
 * NO SABER NO ES CONVERGER NI DEJAR DE HACERLO: sin huella nueva no se corta.
 *
 * @param {string|null} anterior
 * @param {string|null} actual
 * @returns {{corta: boolean, porque?: string}}
 */
export function noConverge(anterior, actual) {
  if (!anterior || !actual) return { corta: false };
  if (anterior !== actual) return { corta: false };
  return {
    corta: true,
    porque:
      "el intento produjo el mismo fallo, textualmente, que el anterior: lo que se cambio no toca la causa, " +
      "y otra vuelta va a costar lo mismo y terminar igual",
  };
}
