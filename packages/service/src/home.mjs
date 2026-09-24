// De donde sale el home que este servicio va a escribir.
//
// LA PRECEDENCIA ES LA MISMA DEL MOTOR —`--home` arriba, despues `NOXLOOP_HOME`
// y por ultimo `~/.noxloop`— para que el servicio y la CLI miren el mismo
// directorio sin que nadie tenga que acordarse de sincronizarlos. Dos homes
// distintos entre la interfaz y la CLI no dan un error: dan dos bandejas, y el
// operador resuelve en una lo que sigue pendiente en la otra.
//
// POR QUE NO SE EXIGE UN ARCHIVO DE CONFIGURACION. El board de v1 ya pago esa
// leccion: pedia una configuracion completa —proveedor, al menos un repo— para
// levantar un lector que no usa ninguna de las dos cosas, y el escenario para
// el que existia era el unico que no podia abrirlo. Este servicio es lo que
// arranca cuando todavia no hay ningun proyecto dado de alta.

import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * @param {{home?: string|boolean}} flags
 * @param {Record<string, string|undefined>} env
 * @returns {{home: string, de: string}}
 */
export function resolverHome(flags, env) {
  if (flags && typeof flags.home === "string" && flags.home) {
    return { home: resolve(flags.home), de: "--home" };
  }
  if (env && env.NOXLOOP_HOME) return { home: resolve(env.NOXLOOP_HOME), de: "NOXLOOP_HOME" };
  return { home: join(homedir(), ".noxloop"), de: "el valor por defecto" };
}
