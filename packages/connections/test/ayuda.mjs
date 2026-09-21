// Piezas compartidas por las pruebas del paquete.
//
// EL CENTINELA. Cada prueba que mete un secreto por la interfaz lo mete con un
// valor unico e irrepetible, y despues lo busca en todo lo que sale. Un valor
// como "secreto" o "token-1" aparece por casualidad en cualquier texto y una
// prueba que lo busque pasa sin medir nada.

import { randomUUID } from "node:crypto";
import { createServer } from "node:net";

/** @param {string} nombre */
export function centinela(nombre) {
  return `centinela-${nombre}-${randomUUID()}`;
}

/**
 * Busca el centinela en cualquier cosa serializable. Devuelve el trozo que lo
 * contiene, o null.
 *
 * @param {unknown} cosa
 * @param {string} valor
 * @returns {string|null}
 */
export function trozoDelCentinela(cosa, valor) {
  const texto = typeof cosa === "string" ? cosa : JSON.stringify(cosa ?? null);
  if (!texto) return null;
  const i = texto.indexOf(valor);
  return i === -1 ? null : texto.slice(Math.max(0, i - 40), i + valor.length + 40);
}

/**
 * Ocupa un puerto de verdad y devuelve el numero y como soltarlo. Sin red hacia
 * fuera: escucha en el loopback, que es lo mismo que hace el callback.
 *
 * @returns {Promise<{ puerto: number, soltar: () => Promise<void> }>}
 */
export function puertoOcupadoDeVerdad() {
  return new Promise((resolver, rechazar) => {
    const servidor = createServer();
    servidor.on("error", rechazar);
    servidor.listen(0, "127.0.0.1", () => {
      const direccion = /** @type {any} */ (servidor.address());
      resolver({
        puerto: direccion.port,
        soltar: () => new Promise((listo) => servidor.close(() => listo(undefined))),
      });
    });
  });
}

/**
 * Un puerto que nadie escucha: se abre uno efimero y se cierra enseguida. No es
 * infalible —alguien podria tomarlo en el medio— pero en una prueba local es
 * suficiente y no inventa un numero fijo que en la maquina de otro este en uso.
 *
 * @returns {Promise<number>}
 */
export async function puertoLibre() {
  const { puerto, soltar } = await puertoOcupadoDeVerdad();
  await soltar();
  return puerto;
}

/** Un reloj que solo se mueve cuando la prueba lo mueve. */
export function relojDePrueba(inicio = 1_700_000_000_000) {
  let ahora = inicio;
  return {
    reloj: () => ahora,
    avanzar: (ms) => {
      ahora += ms;
    },
  };
}
