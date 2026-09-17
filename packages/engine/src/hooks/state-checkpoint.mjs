#!/usr/bin/env node
// Al terminar el turno con una tarea en curso y trabajo sin registrar, obliga a
// dejar constancia de en que quedo.
//
// POR QUE. El estado en disco es lo que hace retomable un recorrido, y su punto
// ciego es el final del turno: la tarea avanzo, el worktree tiene cambios, y
// nada de eso esta en el archivo. Quien retome manana no puede distinguir "no
// empezo" de "quedo a medias".
//
// AVISA UNA VEZ POR CICLO. Un aviso en bucle se vuelve ruido y se ignora, que
// es lo mismo que no avisar.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tareaActiva, resolveHome, leerEntrada, responder } from "./_shared.mjs";

const marcador = (home) => join(home, "checkpoint-notified");

function hayTrabajoSinCommitear(cwd) {
  try {
    const salida = execFileSync("git", ["-C", cwd, "status", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return salida.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * @param {object} input
 * @param {{home?: string, dirty?: boolean}} [opts] `dirty` se inyecta en los
 *   tests; en la CLI se mide con git.
 * @returns {{notify: boolean, message?: string}}
 */
export function decide(input, opts = {}) {
  const home = resolveHome(opts);
  const activa = tareaActiva(opts);
  if (!activa) return { notify: false };

  const { run, task } = activa;
  const sucio = opts.dirty !== undefined
    ? opts.dirty
    : task.worktree
      ? hayTrabajoSinCommitear(task.worktree)
      : false;
  if (!sucio) return { notify: false };

  const puntero = `${run.item.id}/${task.id}/${task.status}`;
  try {
    if (existsSync(marcador(home)) && readFileSync(marcador(home), "utf8").trim() === puntero) {
      return { notify: false };
    }
    mkdirSync(home, { recursive: true });
    writeFileSync(marcador(home), puntero);
  } catch {
    // No poder escribir el marcador no justifica callar el aviso, pero si
    // avisar dos veces. Se avisa.
  }

  return {
    notify: true,
    message:
      `noxloop: la tarea ${task.id} esta en "${task.status}" y su worktree tiene cambios sin commitear.\n` +
      `Antes de terminar, deja registro de en que quedo: o se completa el paso, o se anota por que quedo a medias, o se bloquea con la causa.\n` +
      `  noxloop status ${run.item.id}`,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) responder(decide(leerEntrada()));
