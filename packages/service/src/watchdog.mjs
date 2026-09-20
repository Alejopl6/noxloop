// El watchdog del proceso padre.
//
// POR QUE EXISTE SI EL ESCRITORIO YA MATA EL SIDECAR AL SALIR. Porque ese
// cierre solo corre si el shell llega a correrlo. Con SIGKILL, con un cuelgue
// del compositor o con un apagado forzado, el shell desaparece sin ejecutar
// nada y este proceso queda vivo: escuchando, con el lock del home tomado y con
// un token de sesion valido. El sintoma que produce no se parece a la causa —
// la proxima vez que el operador abre la aplicacion, el servicio nuevo se niega
// a arrancar porque el home sigue bloqueado por un proceso del que ya nadie se
// acuerda.
//
// POR QUE `process.kill(pid, 0)` Y NO UN PING POR EL CANAL. Un canal puede
// quedarse abierto contra un padre zombi. La senial 0 no manda nada: le
// pregunta al sistema operativo, que es el unico que sabe la verdad.

/** Cada cuanto se pregunta. Dos segundos: barato y sin espera perceptible. */
export const INTERVALO_POR_DEFECTO_MS = 2000;

/**
 * @param {number} pid
 * @returns {boolean}
 */
export function vivo(pid) {
  if (typeof pid !== "number" || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM significa que el proceso existe pero es de otro usuario: esta vivo.
    return e.code === "EPERM";
  }
}

/**
 * @param {{pid: number, intervaloMs?: number, vive?: (pid: number) => boolean, alMorir: () => void}} opts
 * @returns {{detener: () => void}}
 */
export function vigilarAlPadre(opts) {
  const vive = opts.vive ?? vivo;
  let disparado = false;

  const t = setInterval(() => {
    if (disparado || vive(opts.pid)) return;
    // Se desarma ANTES de avisar. Avisar N veces apaga el servicio N veces, y
    // el cierre se pisa a si mismo: el lock se suelta dos veces y la segunda
    // puede quitarselo a quien ya lo tomo.
    disparado = true;
    clearInterval(t);
    opts.alMorir();
  }, opts.intervaloMs ?? INTERVALO_POR_DEFECTO_MS);

  // `unref` para que el watchdog no sea lo que mantiene vivo al proceso: lo
  // mantiene vivo el servidor, y cuando el servidor cierra esto no debe
  // impedir que Node termine.
  if (typeof t.unref === "function") t.unref();

  return { detener: () => clearInterval(t) };
}
