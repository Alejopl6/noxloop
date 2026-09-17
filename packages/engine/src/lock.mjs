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

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, linkSync } from "node:fs";
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

/** Una semana. Un lock mas viejo que esto no lo tiene nadie trabajando. */
const MAX_EDAD_MS = 7 * 24 * 3600 * 1000;

/**
 * @param {string} nombre recurso a bloquear, p. ej. `run-42` o `milestone-218`
 * @param {{home: string, maxEdadMs?: number}} opts
 * @returns {{ok: boolean, heldBy?: object, reason?: string, recovered?: boolean, release: () => void}}
 */
export function acquire(nombre, opts) {
  mkdirSync(dir(opts.home), { recursive: true });
  const f = file(opts.home, nombre);
  const token = `${process.pid}-${Date.now()}-${++contador}`;
  const maxEdad = opts.maxEdadMs ?? MAX_EDAD_MS;
  const noop = { release: () => {} };

  // PRIMERO SE INTENTA CREAR, Y DESPUES SE PREGUNTA. Al reves —mirar si existe y
  // escribir despues— hay una ventana entre las dos operaciones, y dos procesos
  // que arrancan juntos caen los dos adentro. Medido con dos procesos reales:
  // **16 de 25 arranques simultaneos se tomaron el mismo lock**, y recorrieron la
  // misma bandeja.
  //
  // `wx` es la unica forma de cerrar esa ventana: el sistema operativo garantiza
  // que la creacion exclusiva es atomica, asi que exactamente uno gana. Un
  // temporal + rename NO sirve aca: el rename sobreescribe, que es justo lo que
  // no queremos.
  const creado = crearExclusivo(f, datosDe(nombre, token));
  if (creado) return liberable(f, token);

  // No se pudo crear porque ya existe. Recien ahora se pregunta de quien es.
  // Se reintenta la lectura antes de declararlo ilegible. Con `link` un lock a
  // medio escribir no puede existir, pero un disco raro o una version vieja del
  // motor si pueden dejar uno — y declarar huerfano lo que no se pudo leer es
  // como se duplica un daemon.
  let actual = null;
  for (let i = 0; i < 3 && !actual; i++) {
    try {
      actual = JSON.parse(readFileSync(f, "utf8"));
    } catch {
      actual = null;
    }
  }

  const edad = actual?.acquiredAt ? Date.now() - Date.parse(actual.acquiredAt) : Infinity;
  const demasiadoViejo = !Number.isFinite(edad) || edad > maxEdad;

  if (actual && !demasiadoViejo) {
    if (actual.host !== hostname()) {
      // NO se roba el lock de otra maquina. Antes se lo quedaba, y con un
      // NOXLOOP_HOME compartido —un volumen montado en dos maquinas— eso
      // significa dos daemons sobre la misma bandeja sin que ninguno se entere.
      // Desde aca no hay forma de saber si ese proceso vive, asi que se respeta.
      return {
        ok: false,
        heldBy: actual,
        reason:
          `lo tiene el pid ${actual.pid} en otra maquina (${actual.host}), y desde aca no se puede ` +
          `saber si vive. Se recupera solo por antiguedad, a los ${Math.round(maxEdad / 3600000)}h.`,
        ...noop,
      };
    }
    if (vivo(actual.pid)) {
      return { ok: false, heldBy: actual, reason: `lo tiene el pid ${actual.pid}`, ...noop };
    }
  }

  // Huerfano —el proceso que lo tomo ya no existe— o tan viejo que da igual. El
  // techo de antiguedad importa por si solo: `process.kill(pid, 0)` dice "vivo"
  // cuando el sistema reasigno ese pid a cualquier otro programa, y sin el techo
  // el lock de un daemon muerto cuyo pid se reciclo queda en pie para siempre,
  // culpando a un pid que no es un daemon.
  try {
    unlinkSync(f);
  } catch { /* otro lo saco primero */ }

  const reintento = crearExclusivo(f, datosDe(nombre, token));
  if (reintento) return { ...liberable(f, token), recovered: true };

  // Otro proceso gano la recuperacion. Correcto: uno solo se lo lleva.
  let ganador = null;
  try {
    ganador = JSON.parse(readFileSync(f, "utf8"));
  } catch { /* ilegible */ }
  return { ok: false, heldBy: ganador, reason: "otro proceso recupero el lock primero", ...noop };
}

function datosDe(nombre, token) {
  return {
    pid: process.pid,
    host: hostname(),
    token,
    resource: nombre,
    acquiredAt: new Date().toISOString(),
  };
}

/**
 * Crea el lock de forma que aparezca YA ESCRITO, o no aparezca.
 *
 * POR QUE `link` Y NO `open` CON "wx". `wx` tambien es una creacion exclusiva,
 * pero deja el archivo visible VACIO entre el `open` y el `write`. Un segundo
 * proceso que lea en esa rendija encuentra un JSON que no parsea, lo trata como
 * un lock huerfano, lo borra y se lo queda. Medido: el arreglo con `wx` bajo los
 * duplicados de 25/25 a 18/20 — movio la ventana en vez de cerrarla.
 *
 * Con `link` el contenido se escribe primero en un temporal y despues se le da
 * el nombre final en una sola operacion atomica que FALLA si el nombre ya
 * existe. No hay instante en el que el lock exista a medias.
 *
 * (`rename` no sirve: sobreescribe en silencio, que es exactamente lo contrario
 * de lo que hace falta aca.)
 *
 * @returns {boolean} true si lo creo; false si ya existia.
 */
function crearExclusivo(f, datos) {
  const tmp = `${f}.tmp-${datos.token}`;
  writeFileSync(tmp, JSON.stringify(datos, null, 2) + "\n");
  try {
    linkSync(tmp, f);
    return true;
  } catch (e) {
    if (e.code === "EEXIST") return false;
    throw e;
  } finally {
    try {
      unlinkSync(tmp);
    } catch { /* el temporal ya no esta: da igual */ }
  }
}

function liberable(f, token) {
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
