// Un home, un escritor.
//
// POR QUE EXISTE. El principio VIII dice que el servicio es el unico escritor
// del almacen. Eso deja de ser cierto en cuanto hay dos servicios sobre el
// mismo home, y llegar ahi es facil: el operador abre la aplicacion de
// escritorio y ademas levanta el servicio a mano para entrar desde el movil.
// Los dos escriben, ninguno ve las escrituras del otro, y la corrupcion aparece
// tres pantallas despues sin forma de saber cual de los dos la puso ahi.
//
// POR QUE EL MECANISMO ES EL DEL MOTOR Y AUN ASI ESTA COPIADO AQUI. El motor ya
// pago el hallazgo y ese mecanismo se conserva entero; lo que no se puede es
// importarlo. Al escritorio, este paquete viaja como recurso suelto —solo
// `package.json`, `bin/` y `src/`— asi que un import a `packages/engine`
// resuelve en el repositorio y revienta en el binario instalado, que es el peor
// sitio donde descubrir una ruta rota. Hay un test que prohibe esos imports.
//
// POR QUE `link` Y NO `open` CON "wx". Las dos son creaciones exclusivas, pero
// `wx` deja el archivo visible VACIO entre el open y el write. Un segundo
// proceso que lea en esa rendija encuentra un JSON que no parsea, lo toma por
// huerfano, lo borra y se queda el lock. Esta medido en el motor: la version
// ingenua —mirar si existe y escribir despues— dejo que 16 de 25 arranques
// simultaneos se tomaran el mismo lock, y el arreglo con `wx` los bajo a 18 de
// 20: movio la ventana en vez de cerrarla. Con `link`, el contenido se escribe
// en un temporal y el nombre final se crea en una sola operacion atomica que
// FALLA si ya existe. (`rename` no sirve: sobreescribe en silencio.)
//
// POR QUE SE GUARDA UN TOKEN Y NO SOLO EL PID. Para que un `release()` tardio
// de un servicio anterior no le saque el lock al que lo tiene ahora. Es un
// fallo que solo aparece cuando el sistema ya funciona, y aparece como una
// carrera imposible de reproducir.

import { mkdirSync, readFileSync, unlinkSync, writeFileSync, linkSync, existsSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { vivo } from "./watchdog.mjs";

/** El recurso: un lock por home, no uno por cosa. */
export const RECURSO = "servicio-control";

/**
 * Una semana. Sin techo de antiguedad, el lock de un servicio muerto cuyo pid
 * reciclo el sistema queda en pie para siempre, culpando a un pid que ya es
 * cualquier otro programa.
 */
export const MAX_EDAD_MS = 7 * 24 * 3600 * 1000;

const archivo = (home) => join(home, "locks", `${RECURSO}.json`);

let contador = 0;

/**
 * @typedef {object} Tomado
 * @property {boolean} ok
 * @property {any} [duenio] lo que dice el lock existente, si no se pudo tomar
 * @property {string} [razon] por que no se pudo, en texto y nombrando el pid
 * @property {boolean} [recuperado] true si se recupero uno huerfano
 * @property {() => void} release
 */

/**
 * @param {string} home
 * @param {{maxEdadMs?: number}} [opts]
 * @returns {Tomado}
 */
export function tomarHome(home, opts = {}) {
  const f = archivo(home);
  mkdirSync(join(home, "locks"), { recursive: true });
  const token = `${process.pid}-${Date.now()}-${++contador}`;
  const maxEdad = opts.maxEdadMs ?? MAX_EDAD_MS;
  const nada = { release: () => {} };

  // PRIMERO SE INTENTA CREAR, Y DESPUES SE PREGUNTA. Al reves —mirar si existe
  // y escribir despues— hay una ventana entre las dos operaciones, y dos
  // servicios que arrancan juntos caen los dos adentro.
  if (crearExclusivo(f, datos(token))) return liberable(f, token);

  // No se pudo crear porque ya existe. Recien ahora se pregunta de quien es.
  // Se reintenta la lectura antes de declararlo ilegible: declarar huerfano lo
  // que no se pudo leer es exactamente como se duplica un servicio.
  let actual = null;
  for (let i = 0; i < 3 && !actual; i++) {
    try {
      actual = JSON.parse(readFileSync(f, "utf8"));
    } catch {
      actual = null;
    }
  }

  const edad = actual && actual.acquiredAt ? Date.now() - Date.parse(actual.acquiredAt) : Infinity;
  const viejisimo = !Number.isFinite(edad) || edad > maxEdad;

  if (actual && !viejisimo) {
    if (actual.host !== hostname()) {
      // NO se roba el lock de otra maquina. Con un home en un volumen montado
      // en dos sitios, robarlo significa dos servicios sobre el mismo almacen
      // sin que ninguno se entere. Desde aqui no hay forma de saber si ese
      // proceso vive, asi que se respeta y se recupera solo por antiguedad.
      return {
        ok: false,
        duenio: actual,
        razon:
          `lo tiene el pid ${actual.pid} en otra maquina (${actual.host}), y desde aqui no se puede ` +
          `saber si vive. Se recupera solo por antiguedad, a las ${Math.round(maxEdad / 3600000)}h`,
        ...nada,
      };
    }
    if (vivo(actual.pid)) {
      return { ok: false, duenio: actual, razon: `lo tiene el pid ${actual.pid}`, ...nada };
    }
  }

  // Huerfano —el servicio que lo tomo ya no existe, que es lo que deja un
  // SIGKILL o un apagado forzado— o tan viejo que da igual. Sin esta
  // recuperacion, un cierre sucio deja el home inservible hasta que alguien
  // borra un archivo a mano, y nadie sabe cual.
  try {
    unlinkSync(f);
  } catch {
    /* otro lo saco primero */
  }

  if (crearExclusivo(f, datos(token))) return { ...liberable(f, token), recuperado: true };

  // Otro servicio gano la recuperacion. Correcto: uno solo se lo lleva.
  let ganador = null;
  try {
    ganador = JSON.parse(readFileSync(f, "utf8"));
  } catch {
    /* ilegible */
  }
  return {
    ok: false,
    duenio: ganador,
    razon: ganador ? `lo recupero antes el pid ${ganador.pid}` : "otro servicio lo recupero primero",
    ...nada,
  };
}

/** Quien lo tiene, sin intentar tomarlo. Para diagnosticar sin efectos. */
export function quienLoTiene(home) {
  const f = archivo(home);
  if (!existsSync(f)) return null;
  try {
    const d = JSON.parse(readFileSync(f, "utf8"));
    return { ...d, vivo: d.host === hostname() && vivo(d.pid) };
  } catch {
    return { ilegible: true };
  }
}

function datos(token) {
  return {
    pid: process.pid,
    host: hostname(),
    token,
    resource: RECURSO,
    acquiredAt: new Date().toISOString(),
  };
}

/** @returns {boolean} true si lo creo; false si ya existia. */
function crearExclusivo(f, contenido) {
  const tmp = `${f}.tmp-${contenido.token}`;
  writeFileSync(tmp, JSON.stringify(contenido, null, 2) + "\n");
  try {
    linkSync(tmp, f);
    return true;
  } catch (e) {
    if (e.code === "EEXIST") return false;
    throw e;
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* el temporal ya no esta: da igual */
    }
  }
}

function liberable(f, token) {
  return {
    ok: true,
    release: () => {
      // Solo suelta SU lock. Un release de un duenio anterior no puede
      // desbloquear el home que otro tomo despues.
      try {
        const actual = JSON.parse(readFileSync(f, "utf8"));
        if (actual.token === token) unlinkSync(f);
      } catch {
        /* ya no esta, o es de otro: nada que hacer */
      }
    },
  };
}
