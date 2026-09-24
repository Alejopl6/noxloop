// Lanzar el subproceso de un runtime: entorno exacto, nada por argv, cancelable.
//
// ES LA MISMA PIEZA QUE `packages/vault/src/entorno.mjs` PONE DEL LADO DE LA
// BOVEDA, y esta duplicada a proposito: este paquete viaja solo al sidecar y no
// puede importar la boveda. Lo que la boveda construye (`paraSpawn()`) llega
// aqui como `req.env` y se entrega TAL CUAL.
//
// EL FALLO QUE EVITA EL ENTORNO EXACTO. `{ ...process.env, ...req.env }` es la
// linea que cualquiera escribe sin pensarla, y con ella el subproceso del
// runtime recibe todo lo que hubiera ahi: las credenciales que otra tarea
// inyecto, las variables de la maquina de CI, el socket del agente SSH del
// operador. El grant autorizo una credencial y el subproceso recibio quince.
//
// Y NADA POR LA LINEA DE COMANDOS. `ps ax -o command` muestra los argumentos de
// cualquier proceso a cualquier proceso del mismo usuario. Un secreto en argv es
// un secreto publico para el resto de la maquina, y el grant que lo autorizo
// deja de significar nada. Un comando armado con plantillas mete el valor en
// argv sin que nadie lo haya decidido, y quien lo escribio no tenia forma de
// verlo: por eso se comprueba, no se recuerda.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/**
 * @typedef {object} Lanzamiento
 * @property {string} comando
 * @property {string[]} argv
 * @property {Record<string,string>} env
 * @property {string} cwd
 * @property {number|null} pid
 * @property {boolean} cancelado
 * @property {number|null} code
 * @property {string} stdout
 * @property {string} stderr
 */

/** Un valor demasiado corto coincide con cualquier cosa y convierte la guarda en ruido. */
const LARGO_MINIMO_DE_SECRETO = 4;

/**
 * El nombre de la variable cuyo valor se colo en los argumentos, o null.
 *
 * Devuelve el NOMBRE, nunca el valor: un mensaje de error que cita el secreto lo
 * escribe en el log que estaba intentando proteger.
 *
 * QUE VARIABLES SE MIRAN, y por que hizo falta decirlo. Mientras `env` solo
 * llevaba credenciales, mirarlas todas era correcto. Desde que el motor
 * construye el entorno completo, ahi viajan tambien las variables de la
 * maquina —`HOME`, `TMPDIR`, `PATH`—, y el valor de `HOME` es prefijo de casi
 * cualquier ruta absoluta de la maquina: con la ruta del script del runtime o
 * un `--add-dir` del home, esta guarda daba positivo SIEMPRE y ninguna fase se
 * podia lanzar. Un falso positivo en una guarda es peor que no tenerla: entrena
 * a apagarla.
 *
 * La boveda ya hace esta distincion —`variables` publicas y `secretos`, y
 * `buscarSecretoEn` solo mira las segundas: "los nombres si se pueden decir"—
 * y se perdia al cruzar la costura, donde `env` es un mapa plano. `nombres` es
 * esa distincion, viajando.
 *
 * SIN DECLARACION SE MIRAN TODAS. Ante la duda, denegar (principio IX): quien
 * no dice cuales de sus variables son secretas no consigue que dejen de
 * mirarse.
 *
 * @param {Record<string,string>} env
 * @param {string[]} textos
 * @param {readonly string[]} [nombres] los que son secretos; sin esto, todos
 * @returns {string|null}
 */
export function secretoEnArgv(env, textos, nombres) {
  const aMirar = nombres ? Object.entries(env || {}).filter(([n]) => nombres.includes(n)) : Object.entries(env || {});
  for (const [nombre, valor] of aMirar) {
    if (typeof valor !== "string" || valor.length < LARGO_MINIMO_DE_SECRETO) continue;
    if (textos.some((t) => typeof t === "string" && t.includes(valor))) return nombre;
  }
  return null;
}

/**
 * Lanza el subproceso de una fase.
 *
 * NO INTERPRETA NADA de lo que sale: devuelve el codigo de salida y los dos
 * flujos. Quien traduce eso a un `PhaseResult` es el adaptador, y quien decide
 * si la fase paso es el gate.
 *
 * @param {{
 *   comando: string, args: string[], env: Record<string,string>, cwd: string,
 *   secretos?: readonly string[],
 *   signal?: AbortSignal, timeoutMs?: number, alLanzar?: (l: any) => void
 * }} plan
 * @returns {Promise<Lanzamiento>}
 */
export async function lanzar(plan) {
  const { comando, args, env, cwd, secretos, signal, timeoutMs, alLanzar } = plan;

  const colado = secretoEnArgv(env, [comando, ...args], secretos);
  if (colado) {
    // Se NIEGA a lanzar en vez de avisar y seguir: si se lanza, el secreto ya
    // estuvo en la tabla de procesos, y un instante es todo lo que hace falta.
    const e = new Error(
      `el valor de ${colado} aparece en los argumentos del proceso que se iba a lanzar. Pasalo por el entorno: ` +
        `el subproceso ya recibe ${colado}, y los argumentos los ve cualquier proceso de la maquina`,
    );
    /** @type {any} */ (e).codigo = "secreto_en_argv";
    throw e;
  }

  return await new Promise((resolver, rechazar) => {
    const hijo = spawn(comando, args, {
      // EXACTAMENTE lo declarado. Sin `...process.env` delante, sin un `PATH`
      // de cortesia detras: si el runtime necesita PATH, el grant lo declara.
      env,
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    /** @type {Lanzamiento} */
    const registro = {
      comando, argv: [...args], env: { ...env }, cwd,
      pid: hijo.pid ?? null, cancelado: false, code: null, stdout: "", stderr: "",
    };
    if (alLanzar) alLanzar(registro);

    let terminado = false;
    /** @type {any} */
    let reloj = null;

    const matar = (motivo) => {
      if (terminado) return;
      registro.cancelado = true;
      registro.stderr += `\n[${motivo}]`;
      // SIGTERM primero y SIGKILL despues: un runtime que atrapa SIGTERM para
      // cerrar su sesion limpiamente tiene que poder hacerlo, pero no
      // indefinidamente — un subproceso que ignora la señal queda huerfano
      // consumiendo el modelo despues de que el motor lo dio por cancelado.
      try { hijo.kill("SIGTERM"); } catch { /* ya murio */ }
      setTimeout(() => {
        if (!terminado) {
          try { hijo.kill("SIGKILL"); } catch { /* ya murio */ }
        }
      }, 2000).unref?.();
    };

    if (signal) {
      if (signal.aborted) matar("cancelada antes de arrancar");
      else signal.addEventListener("abort", () => matar("cancelada"), { once: true });
    }
    if (timeoutMs && timeoutMs > 0) {
      reloj = setTimeout(() => matar(`sin terminar tras ${timeoutMs} ms`), timeoutMs);
      reloj.unref?.();
    }

    hijo.stdout.on("data", (t) => { registro.stdout += t; });
    hijo.stderr.on("data", (t) => { registro.stderr += t; });
    hijo.on("error", (e) => {
      terminado = true;
      if (reloj) clearTimeout(reloj);
      rechazar(e);
    });
    hijo.on("close", (code) => {
      terminado = true;
      if (reloj) clearTimeout(reloj);
      registro.code = code;
      resolver(registro);
    });
  });
}

/**
 * Lo que el subproceso recibio DE VERDAD, no lo que el adaptador quiso mandar.
 *
 * La diferencia es la prueba entera: el entorno se lee del hijo, no del plan del
 * padre. Un adaptador que armara bien el plan y despues lo mezclara con el
 * entorno del proceso al lanzar pasaria una comprobacion hecha sobre el plan, y
 * la fuga seguiria ahi.
 *
 * @param {any} ultimo lo que registro `alLanzar`
 * @param {string|null} visto la ruta donde el hijo dejo constancia, si la hay
 */
export function leerLanzamiento(ultimo, visto) {
  if (!ultimo) return null;
  /** @type {any} */
  let delHijo = null;
  if (visto && existsSync(visto)) {
    try {
      delHijo = JSON.parse(readFileSync(visto, "utf8"));
    } catch { /* el hijo no llego a escribir: se reporta lo del padre */ }
  }
  return {
    // SI SE PIDIO CONSTANCIA DEL HIJO Y NO LA HAY, SE DICE. Caer en silencio a
    // lo que registro el padre convierte `env-exacto` y `cwd-respetado` en
    // pruebas vacias: comprobarian el plan que el adaptador quiso mandar, que
    // es justo lo que no hay que creerse. Medido: con el script mal armado el
    // hijo no llego a arrancar y las dos pruebas seguian en verde.
    constanciaDelHijo: Boolean(delHijo),
    fase: ultimo.fase,
    resume: ultimo.resume ?? null,
    model: ultimo.model ?? null,
    effort: ultimo.effort ?? null,
    comando: ultimo.registro.comando,
    argv: ultimo.registro.argv,
    // EL PID DEL PADRE MANDA sobre el que reporto el hijo: el archivo de
    // constancia es de la fase ANTERIOR hasta que el hijo nuevo lo reescribe, y
    // la prueba de cancelacion mira el pid antes de que eso ocurra. Con el del
    // hijo, comprobaria que murio un proceso que ya estaba muerto.
    pid: ultimo.registro.pid ?? delHijo?.pid,
    cwd: delHijo?.cwd ?? ultimo.registro.cwd,
    env: delHijo?.env ?? ultimo.registro.env,
    registro: ultimo.registro,
  };
}
