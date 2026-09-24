// Lo que este servicio sabe hacer, y —sobre todo— lo que todavia no.
//
// ESTE ENDPOINT ES EL PRINCIPIO X APLICADO AL PROPIO SERVICIO. La tentacion en
// una fase temprana es devolver la forma final con valores plausibles para que
// la interfaz se pueda escribir contra ella: `boveda: "keychain"` porque va a
// ser eso. Eso es exactamente el contexto inventado que el principio prohibe —
// y aqui el precio es peor que una pantalla mal dibujada: la interfaz muestra
// un llavero del sistema que nadie ejercio, el operador guarda una credencial
// creyendo que va ahi, y el hueco se descubre cuando ya hay secretos adentro.
//
// Por eso cada capacidad viaja con su origen: `detectado` trae la ruta que lo
// respalda, `vacio` trae la constancia de que se busco y no habia.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

/** Version de la forma de esta respuesta. */
export const ESQUEMA = 1;

/**
 * Donde esta el motor, si esta. Se prueban las dos formas en las que puede
 * aparecer: instalado como dependencia, o al lado dentro del repositorio.
 *
 * @returns {string|null} ruta del manifiesto, que es la evidencia
 */
function manifiestoDelMotor() {
  const candidatos = [];
  try {
    candidatos.push(createRequire(import.meta.url).resolve("@noxloop/engine/package.json"));
  } catch {
    // No esta instalado como paquete: se prueba la otra forma.
  }
  candidatos.push(new URL("../../engine/package.json", import.meta.url).pathname);
  return candidatos.find((c) => existsSync(c)) ?? null;
}

/**
 * @returns {Record<string, any>}
 */
export function capacidades() {
  const manifiesto = manifiestoDelMotor();
  /** @type {any} */
  let motor = {
    valor: { presente: false, version: null },
    origen: "vacio",
    motivo:
      "no se encontro el manifiesto del motor ni como dependencia instalada ni junto a este paquete; " +
      "sin motor, este servicio solo sirve las etapas de establecimiento",
  };
  if (manifiesto) {
    let version = null;
    try {
      version = JSON.parse(readFileSync(manifiesto, "utf8")).version ?? null;
    } catch {
      // Un manifiesto ilegible es presencia sin version, no ausencia de motor.
    }
    motor = { valor: { presente: true, version }, origen: "detectado", evidencia: manifiesto };
  }

  return {
    esquema: ESQUEMA,

    runtimes: {
      valor: [],
      origen: "vacio",
      motivo:
        "este servicio todavia no ejecuta ningun runtime de agente: la deteccion llega con la flota " +
        "(etapa 07), y declarar una lista sin haberla probado es prometer runtimes que nadie arranco",
    },

    boveda: {
      valor: null,
      origen: "vacio",
      motivo:
        "no hay backend de secretos conectado todavia; el llavero del sistema y su respaldo cifrado " +
        "llegan con las credenciales, y hasta entonces este servicio no guarda ningun secreto",
    },

    conexiones: {
      valor: null,
      origen: "vacio",
      motivo:
        "no hay proveedor de conexiones configurado todavia; el catalogo y sus modos llegan con la " +
        "etapa de conexiones, y un proveedor declarado de mas manda al operador a un flujo que no existe",
    },

    motor,
  };
}
