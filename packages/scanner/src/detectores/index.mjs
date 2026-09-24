// El registro de detectores. Es toda la extension que el scanner necesita.
//
// UN DETECTOR NUEVO ES UN ARCHIVO Y UNA LINEA DE AQUI. Declara su nombre, su
// fase y su funcion `detectar(ctx)`, y no sabe nada del nucleo: ni del
// recorrido, ni de la cancelacion, ni de como se serializa un snapshot. Es el
// principio VI escrito para la lectura en vez de para los gestores de tickets —
// si soportar un ecosistema exigiera tocar el scanner, la interfaz estaria mal
// y lo que se arregla es la interfaz, no se ramifica el nucleo con un `if`.
//
// EL ORDEN DE ESTA LISTA NO ES EL ORDEN DE EJECUCION. Lo fija la fase que cada
// uno declara, en `fases.mjs`. Que el orden no dependa de esta lista es a
// proposito: un detector que dependiera de haber corrido despues de otro
// convertiria el orden del array en parte del contrato sin que nadie lo
// escribiera, y el sintoma aparece al reordenar un import.

import stack from "./stack.mjs";
import arquitectura from "./arquitectura.mjs";
import testing from "./testing.mjs";
import ci from "./ci.mjs";
import agentes from "./agentes.mjs";
import guidelines from "./guidelines.mjs";
import riesgos from "./riesgos.mjs";

/** @type {readonly import("../scanner.mjs").Detector[]} */
export const DETECTORES = Object.freeze([stack, arquitectura, testing, ci, agentes, guidelines, riesgos]);
