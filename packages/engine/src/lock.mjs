// Instancia unica por recurso.
//
// POR QUE HACE FALTA. Con paralelismo, dos procesos sobre el mismo recorrido no
// producen el doble de trabajo: producen dos veces la misma tarea, dos PRs y un
// estado que ninguno de los dos escribio entero.
//
// POR QUE EL LOCK GUARDA UN TOKEN Y NO SOLO UN PID. Para que un `release()`
// tardio de un proceso viejo no le saque el lock al que lo tiene ahora. Es un
// fallo de los que solo aparecen cuando el sistema ya funciona, y entonces
// aparece como una carrera imposible de reproducir.

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, renameSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

const dir = (home) => join(home, "locks");
const file = (home, nombre) => join(dir(home), `${nombre}.json`);

function vivo(pid) {
  if (typeof pid !== "number" || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM significa que existe pero es de otro usuario: esta vivo.
    return e.code === "EPERM";
  }
}

let contador = 0;

/**
 * @param {string} nombre recurso a bloquear, p. ej. `run-42` o `milestone-218`
 * @param {{home: string}} opts
 * @returns {{ok: boolean, heldBy?: object, recovered?: boolean, release: () => void}}
 */
export function acquire(nombre, opts) {
  mkdirSync(dir(opts.home), { recursive: true });
  const f = file(opts.home, nombre);
  const token = `${process.pid}-${Date.now()}-${++contador}`;
  const noop = { release: () => {} };

  if (existsSync(f)) {
    let actual = null;
    try {
      actual = JSON.parse(readFileSync(f, "utf8"));
    } catch {
      actual = null; // un lock ilegible se trata como huerfano
    }
    if (actual && vivo(actual.pid) && actual.host === hostname()) {
      return { ok: false, heldBy: actual, ...noop };
    }
    // Huerfano: el proceso que lo tomo ya no existe. Recuperarlo es lo que
    // evita que un corte de luz deje un recorrido bloqueado para siempre.
    unlinkSync(f);
    return { ...tomar(f, token, nombre, opts), recovered: true };
  }

  return tomar(f, token, nombre, opts);
}

function tomar(f, token, nombre, opts) {
  const datos = {
    pid: process.pid,
    host: hostname(),
    token,
    resource: nombre,
    acquiredAt: new Date().toISOString(),
  };
  const tmp = `${f}.tmp-${token}`;
  writeFileSync(tmp, JSON.stringify(datos, null, 2) + "\n");
  renameSync(tmp, f);

  return {
    ok: true,
    release: () => {
      // Solo libera SU lock. Un release de un duenio anterior no puede
      // desbloquear el recurso que otro tomo despues.
      try {
        const actual = JSON.parse(readFileSync(f, "utf8"));
        if (actual.token === token) unlinkSync(f);
      } catch { /* ya no esta, o es de otro: nada que hacer */ }
    },
  };
}

/** Quien tiene el lock, sin intentar tomarlo. Para `status`. */
export function inspect(nombre, opts) {
  const f = file(opts.home, nombre);
  if (!existsSync(f)) return null;
  try {
    const datos = JSON.parse(readFileSync(f, "utf8"));
    return { ...datos, alive: vivo(datos.pid) };
  } catch {
    return { unreadable: true };
  }
}
