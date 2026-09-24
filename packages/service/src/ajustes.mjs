// Los ajustes del servicio (spec 005, FR-006): hoy, cuantos runs a la vez.
//
// POR QUE EN EL ALMACEN Y NO EN UN ARCHIVO DE CONFIGURACION. Lo cambia el
// operador desde la interfaz, y la interfaz no escribe nada (principio VIII):
// pide, y el servicio —unico escritor del almacen— lo guarda. Sobrevive a
// reiniciar la app, que es lo que se espera de un ajuste.
//
// POR QUE UN TOPE ARRIBA. Un limite de 500 no es una preferencia, es un typo:
// quinientos agentes a la vez se comen la maquina y la cuota del modelo antes
// de que nadie note el cero de mas. El tope es generoso para un portatil y se
// sube aqui si alguien lo necesita de verdad.

import { LIMITE_GLOBAL_POR_DEFECTO } from "./lanzador.mjs";
import { ErrorDeServicio } from "./errores.mjs";

export const RUNS_SIMULTANEOS_MAXIMO = 16;

/**
 * El limite global vigente: lo guardado, o el defecto.
 *
 * @param {any} dep
 */
export function runsSimultaneos(dep) {
  const guardado = dep.almacen.ajustes.leer("runsSimultaneos");
  return Number.isInteger(guardado) && guardado >= 1 ? guardado : LIMITE_GLOBAL_POR_DEFECTO;
}

/**
 * `GET|PATCH /v1/settings`
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function ajustes(p) {
  if (p.metodo === "PATCH") {
    const cuerpo = await p.cuerpo();
    if (cuerpo && cuerpo.runsSimultaneos !== undefined) {
      const n = cuerpo.runsSimultaneos;
      if (!Number.isInteger(n) || n < 1 || n > RUNS_SIMULTANEOS_MAXIMO) {
        throw new ErrorDeServicio("cuerpo_invalido", {
          detalle: `\`runsSimultaneos\` tiene que ser un entero entre 1 y ${RUNS_SIMULTANEOS_MAXIMO}; llego ${JSON.stringify(n)}`,
          campos: ["runsSimultaneos"],
        });
      }
      p.dep.almacen.ajustes.guardar("runsSimultaneos", n);
      // Subirlo tiene que valer YA: lo que esperaba y ahora cabe, arranca. Y
      // bajarlo no mata nada: los que corren terminan, y simplemente no
      // arranca nadie mas hasta que se baje de la linea.
      // `revisar` avisa con `run.cambio` de cada run que arranque por esto.
      p.estado.motor?.lanzador.revisar();
    }
  }
  return { cuerpo: { runsSimultaneos: runsSimultaneos(p.dep) } };
}
