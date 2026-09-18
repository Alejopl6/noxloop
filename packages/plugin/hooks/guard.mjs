#!/usr/bin/env node
// La entrada que invoca `hooks.json`. Un solo archivo para los cuatro guards:
// recibe el nombre por argumento, resuelve el motor y delega.
//
// POR QUE NO USA `_shared.mjs` DEL MOTOR para responder. Porque el caso que
// existe para manejar es justamente que el motor NO se pueda cargar. El
// protocolo de salida —exit 0 permite, exit 2 bloquea, el motivo por stderr—
// se implementa aca, sin depender del otro lado.

import { resolverGuard, resolverHome, decidirPuente } from "./shim.mjs";

const nombre = process.argv[2];
if (!nombre) {
  process.stderr.write("uso: guard.mjs <nombre-del-guard>\n");
  process.exit(2);
}

// La raiz del plugin se deriva de la ubicacion de este archivo y no de
// CLAUDE_PLUGIN_ROOT: si la variable no estuviera, derivar sigue funcionando.
const pluginRoot = new URL("..", import.meta.url).pathname;

async function leerStdin() {
  if (process.stdin.isTTY) return {};
  const trozos = [];
  for await (const t of process.stdin) trozos.push(t);
  const crudo = Buffer.concat(trozos).toString("utf8").trim();
  if (!crudo) return {};
  try {
    return JSON.parse(crudo);
  } catch {
    // Una entrada que no se entiende no se usa para decidir nada: se deja que
    // el puente resuelva con lo que sabe del disco.
    return {};
  }
}

const input = await leerStdin();
const home = resolverHome(process.env);
const resolucion = resolverGuard(nombre, { env: process.env, pluginRoot });

let d;
try {
  d = await decidirPuente(input, { nombre, resolucion, home });
} catch (e) {
  // Un fallo inesperado del propio puente tampoco se degrada a permitir cuando
  // hay trabajo autonomo en curso. Se dice qué pasó y se bloquea.
  process.stderr.write(`BLOQUEADO: el puente del guard ${nombre} fallo: ${e?.message || e}\n`);
  process.exit(2);
}

// Este bloque es un ESPEJO de `responder()` en el motor, y tiene que seguir
// siendo identico: solo `allow === false` bloquea. Con `if (d.allow)` a secas,
// un hook `Stop` —que devuelve `{notify: false}` y no `allow`— habria frenado
// cada fin de turno. Lo cacho un test que carga los cuatro guards de verdad, no
// solo el primero. Hay otro test que compara las dos implementaciones caso por
// caso para que no se separen.
if (d.allow === false) {
  process.stderr.write(`${d.reason}\n`);
  process.exit(2);
}
if (d.notify && d.message) process.stderr.write(`${d.message}\n`);
process.exit(0);
