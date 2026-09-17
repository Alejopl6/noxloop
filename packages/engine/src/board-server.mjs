// El servidor del board: sirve el read-model y una pagina que lo dibuja.
//
// POR QUE NO HAY FRAMEWORK NI DEPENDENCIAS. El motor no tiene dependencias de
// runtime a proposito — se instala y corre. Meter un servidor web con arbol de
// paquetes por un tablero de lectura habria cambiado eso para siempre. node:http
// y una pagina autocontenida alcanzan, y la pagina no pide nada a la red: el
// board se mira justo cuando el gestor de tickets esta caido.
//
// POR QUE SOLO GET Y SOLO LOOPBACK. Ver board.mjs: este proceso no es el
// escritor del estado y no puede volverse uno, y lo que muestra es trabajo
// interno de quien lo corre. Las dos cosas tienen test.

import { createServer } from "node:http";
import { construirBoard } from "./board.mjs";
import { PAGINA } from "./board-page.mjs";

/** Cada cuanto se relee el disco para los clientes conectados. */
const LATIDO_MS = 2000;

function json(res, codigo, cuerpo) {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(codigo, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    // El board no se embebe en ningun lado: si alguna pagina lo mete en un
    // iframe, lo que se filtra es el trabajo interno de quien lo corre.
    "x-frame-options": "DENY",
    "content-length": Buffer.byteLength(texto),
  });
  res.end(texto);
}

/**
 * @param {{home: string, maxEdadLockMs?: number}} opts
 * @returns {import("node:http").Server}
 */
export function crearServidor(opts) {
  const board = () => {
    try {
      return construirBoard({ home: opts.home, maxEdadLockMs: opts.maxEdadLockMs });
    } catch (e) {
      // construirBoard no deberia lanzar nunca. Si igual lo hace, el board
      // reporta el fallo en su propio formato en vez de devolver un 500 vacio:
      // un tablero que no se puede abrir no dice nada, uno que dice "no pude
      // leer el estado" manda a mirar el disco.
      return {
        columnas: [], tarjetas: [], omitidos: [], necesitanRespuesta: [],
        avisos: [{ nivel: "error", mensaje: `no se pudo construir el board: ${e.message}` }],
        totales: { items: 0, porColumna: {}, tareasActivas: 0, omitidos: 0, gastoUsd: 0 },
      };
    }
  };

  const srv = createServer((req, res) => {
    // Todo lo que no sea GET muere en la puerta. Ver el encabezado del archivo.
    if (req.method !== "GET" && req.method !== "HEAD") {
      return json(res, 405, { error: "el board es de solo lectura: solo GET" });
    }

    // `new URL` normaliza `..` antes de que se pueda usar para salir de las
    // rutas conocidas, y de todos modos aca no se sirve ningun archivo del
    // disco: la pagina esta compilada dentro del modulo.
    let ruta = "/";
    try {
      ruta = new URL(req.url || "/", "http://127.0.0.1").pathname;
    } catch {
      return json(res, 400, { error: "url invalida" });
    }

    if (ruta === "/api/board") return json(res, 200, board());

    if (ruta === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });

      let ultimo = null;
      const empujar = () => {
        const b = board();
        const texto = JSON.stringify(b);
        // Solo se manda si cambio algo. Sin esto, un board abierto en una
        // pestaña reescribiria la pantalla dos veces por segundo para siempre.
        if (texto === ultimo) {
          res.write(": latido\n\n"); // comentario SSE: mantiene la conexion viva
          return;
        }
        ultimo = texto;
        res.write(`data: ${texto}\n\n`);
      };

      empujar(); // el primero va sin esperar un cambio
      const t = setInterval(empujar, LATIDO_MS);
      // `unref` para que un board abierto no impida que el proceso termine.
      if (typeof t.unref === "function") t.unref();
      const cerrar = () => clearInterval(t);
      req.on("close", cerrar);
      req.on("error", cerrar);
      return;
    }

    if (ruta === "/") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-frame-options": "DENY",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
      });
      return res.end(PAGINA);
    }

    return json(res, 404, { error: `no existe ${ruta}` });
  });

  return srv;
}

/**
 * Levanta el board y resuelve con la URL. Solo loopback, siempre.
 *
 * @param {{home: string, port?: number, maxEdadLockMs?: number}} opts
 */
export function levantarBoard(opts) {
  const srv = crearServidor(opts);
  return new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(opts.port == null ? 7777 : opts.port, "127.0.0.1", () => {
      const a = /** @type {any} */ (srv.address());
      resolve({ srv, url: `http://127.0.0.1:${a.port}` });
    });
  });
}

/**
 * De donde sale el `home` que el board va a leer.
 *
 * POR QUE NO USA `loadConfig` DIRECTO. El board es un lector de un directorio:
 * no necesita proveedor ni repos. Exigirle una configuracion valida rompia el
 * escenario para el que existe — mirar que quedo cuando el gestor esta caido, o
 * desde otra maquina sin los checkouts. La precedencia es la MISMA del motor
 * (`NOXLOOP_HOME` gana sobre el archivo), mas `--home` arriba de todo para no
 * necesitar archivo en absoluto.
 *
 * @param {{home?: string}} flags
 * @param {Record<string, string|undefined>} env
 * @param {() => {home: string}} cargarConfig se invoca SOLO si hace falta
 * @returns {{home: string|null, de: string, problema?: string}}
 */
export function resolverHomeDelBoard(flags, env, cargarConfig) {
  if (flags && flags.home) return { home: String(flags.home), de: "--home" };
  if (env && env.NOXLOOP_HOME) return { home: env.NOXLOOP_HOME, de: "NOXLOOP_HOME" };
  try {
    const cfg = cargarConfig();
    return { home: cfg.home, de: "la configuracion" };
  } catch (e) {
    // La causa real, textual. Un "no pude arrancar" sin el motivo manda a
    // adivinar, y encima el board se puede abrir igual: hay que decir como.
    return {
      home: null,
      de: "ninguna",
      problema:
        `no pude leer la configuracion (${e.message}) y el board necesita saber que directorio mirar. ` +
        `Pasa \`--home <ruta>\` o exporta NOXLOOP_HOME.`,
    };
  }
}
