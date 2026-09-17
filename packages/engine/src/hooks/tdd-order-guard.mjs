#!/usr/bin/env node
// Bloquea escribir codigo de produccion antes de haber visto el test fallar.
//
// POR QUE ES UN HOOK Y NO UNA INSTRUCCION. Un prompt que pide TDD funciona en
// las dos primeras iteraciones y deja de funcionar en la tercera. Un hook no se
// cansa. Esta es la diferencia entre "el proyecto usa TDD" y "el proyecto no
// puede no usar TDD", y es el principio I de la constitucion.
//
// LO QUE NO VARIA POR TIER. Ninguno de los cuatro tiers saltea el rojo. Un tier
// barato es un tier con menos revision y menos modelo, no un tier sin test. No
// hay bandera que lo apague, y hay un test que lo verifica en los cuatro.

import { ALLOW, deny, tareaActiva, coincideRuta, leerEntrada, responder } from "./_shared.mjs";

const HERRAMIENTAS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];

/**
 * @param {object} input el payload de PreToolUse
 * @param {{home?: string}} [opts]
 * @returns {{allow: boolean, reason?: string}}
 */
export function decide(input, opts = {}) {
  const tool = input?.tool_name;
  if (!tool || !HERRAMIENTAS.includes(tool)) return ALLOW;

  const ruta = input?.tool_input?.file_path;
  if (!ruta) return ALLOW; // no se entiende: permitir

  const activa = tareaActiva(opts);
  if (!activa) return ALLOW; // noxloop no esta corriendo: no es asunto del hook

  const { task } = activa;

  // El test SIEMPRE se puede escribir. Es la salida del bloqueo, no una
  // excepcion: el camino para desbloquearse es escribir el test y verlo fallar.
  if (task.testFiles.some((f) => coincideRuta(ruta, f))) return ALLOW;

  const esObjetivo = task.targetFiles.some((f) => coincideRuta(ruta, f));
  if (!esObjetivo) return ALLOW; // fuera de la tarea: es asunto del guardian de alcance

  if (task.redVerified) return ALLOW;

  return deny(
    `noxloop: la tarea ${task.id} todavia no tiene rojo verificado, asi que no se puede escribir ` +
      `codigo de produccion (${ruta}).\n` +
      `La salida no es saltear esto: escribi el test en ${task.testFiles.join(", ") || "el archivo de test de la tarea"}, ` +
      `corrélo, VELO FALLAR, y recien entonces se marca redVerified — que solo se concede con una corrida real.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) responder(decide(leerEntrada()));
