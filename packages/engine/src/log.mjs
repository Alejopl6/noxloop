// Bitacora del recorrido. Una linea = un hecho, con el recorrido y la fase
// adelante, porque con varias tareas en paralelo una bitacora sin contexto es
// ruido: no se puede saber de quien era el fallo.
//
// A stderr va lo que una persona lee mientras mira; al archivo va todo. A
// stderr y no a stdout porque stdout es del contrato del CLI: ahi va el JSON que
// consume una maquina, y mezclarlos rompe cualquier `| jq`.

import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

/**
 * @param {{home: string, quiet?: boolean, file?: string}} opts
 */
export function createLogger(opts) {
  const file = opts.file || join(opts.home, "noxloop.log");
  try {
    mkdirSync(dirname(file), { recursive: true });
  } catch { /* la bitacora es un extra: no puede tumbar el motor */ }

  function emitir(nivel, contexto, mensaje, datos) {
    const linea = {
      ts: new Date().toISOString(),
      nivel,
      ...contexto,
      msg: mensaje,
      ...(datos ? { datos } : {}),
    };
    try {
      appendFileSync(file, JSON.stringify(linea) + "\n");
    } catch { /* idem */ }
    if (!opts.quiet) {
      const prefijo = [contexto.run, contexto.task, contexto.phase].filter(Boolean).join("/");
      process.stderr.write(`${prefijo ? `[${prefijo}] ` : ""}${mensaje}\n`);
    }
  }

  function conContexto(contexto) {
    return {
      info: (m, d) => emitir("info", contexto, m, d),
      warn: (m, d) => emitir("warn", contexto, m, d),
      error: (m, d) => emitir("error", contexto, m, d),
      child: (extra) => conContexto({ ...contexto, ...extra }),
      file,
    };
  }

  return conContexto({});
}

/** Un logger que no escribe nada. Para los tests, y para `--dry-run`. */
export function nullLogger() {
  const noop = () => {};
  const l = { info: noop, warn: noop, error: noop, file: null, child: () => l };
  return l;
}
