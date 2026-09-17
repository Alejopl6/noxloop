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
