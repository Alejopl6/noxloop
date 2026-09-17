#!/usr/bin/env node
// Bloquea escribir un archivo que la tarea no declaro.
//
// EL FALLO QUE EVITA. Que el PR de una tarea de tres archivos termine con
// cuarenta, sin que nadie lo note hasta la revision. Ampliar el alcance NO esta
// prohibido — lo que no puede pasar es que ocurra en silencio: se declara con su
// motivo y queda en el PR.

import { ALLOW, deny, tareaActiva, coincideRuta, leerEntrada, responder } from "./_shared.mjs";

const HERRAMIENTAS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];

// Se bloquean SIEMPRE, incluso si la tarea los declaro. Son archivos donde una
// edicion a mano produce un dano que el gate no detecta: una migracion editada
// rompe el historial de esquema de todos los demas, y un lockfile a mano
// produce un arbol de dependencias que nadie puede reproducir.
const NUNCA = [
  { re: /(^|\/)migrations?\//i, que: "una migracion" },
  { re: /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|Cargo\.lock|go\.sum)$/i, que: "un lockfile" },
  { re: /(^|\/)(dist|build|out|\.next)\//i, que: "un artefacto generado" },
  { re: /\.generated\.[a-z]+$/i, que: "un archivo generado" },
];

export function decide(input, opts = {}) {
  const tool = input?.tool_name;
  if (!tool || !HERRAMIENTAS.includes(tool)) return ALLOW;

  const ruta = input?.tool_input?.file_path;
  if (!ruta) return ALLOW;

  const activa = tareaActiva(opts, input);
  if (!activa) return ALLOW;
  const { task } = activa;

  for (const n of NUNCA) {
    if (n.re.test(ruta)) {
      return deny(
        `noxloop: ${ruta} es ${n.que} y no se edita a mano, ni declarandolo. ` +
          `Usa la herramienta del proyecto que lo genera.`,
      );
    }
  }

  const declarado = [...task.targetFiles, ...task.testFiles].some((f) => coincideRuta(ruta, f));
  if (declarado) return ALLOW;

  return deny(
    `noxloop: ${ruta} no esta declarado en la tarea ${task.id}.\n` +
      `Declarados: ${[...task.targetFiles, ...task.testFiles].join(", ")}.\n` +
      `Si de verdad hace falta, declaralo con su motivo — queda registrado y se reporta en el PR:\n` +
      `  noxloop add-target ${task.id} ${ruta} "<por que>"`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) responder(decide(leerEntrada()));
