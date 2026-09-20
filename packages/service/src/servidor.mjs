// El servicio de control: lo unico con lo que habla la interfaz.
//
// POR QUE 127.0.0.1 Y NUNCA 0.0.0.0. Esto enumera proyectos, bandeja, y manana
// el inventario de credenciales. Escuchar en 0.0.0.0 publica todo eso en la red
// local sin que nadie lo pida — en una wifi compartida, para cualquiera. La
// direccion no se toma de la configuracion a proposito: no hay bandera que la
// cambie, porque una bandera que la cambia termina activada en el tutorial de
// alguien.
//
// POR QUE EL PUERTO ES EFIMERO POR DEFECTO. Un puerto fijo choca con el de otra
// cosa y el fallo aparece como "la aplicacion no abre". Con `listen(0)` el
// sistema da uno libre y el shell aprende cual leyendo la linea de listo.
//
// POR QUE ESTE PROCESO NO ESCRIBE NADA FUERA DE SU HOME. Principio VIII: la
// interfaz lee y el servicio escribe, pero escribe en un solo sitio. Hay un
// test que mide el arbol de alrededor antes y despues.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { capacidades } from "./capacidades.mjs";
import { crearBus } from "./eventos.mjs";
import { CABECERAS_JSON, ErrorDeServicio, deExcepcion, estadoDe, problema } from "./errores.mjs";
import { RECURSO, tomarHome } from "./lock.mjs";
import { ORIGENES_POR_DEFECTO, cabecerasCors, revisar } from "./puerta.mjs";
import { VERSION } from "./version.mjs";
import { vigilarAlPadre } from "./watchdog.mjs";

/** Version de la forma de las respuestas. Un cambio incompatible la sube. */
export const ESQUEMA = 1;

/** El recurso que se bloquea: un home, un escritor. */
export const RECURSO_DEL_LOCK = RECURSO;

/**
 * Las rutas de la fase A, con lo que acepta cada una. Se declaran en una tabla
 * porque el 405 y el 404 tienen que poder decir QUE se acepta, y eso no se
 * puede reconstruir desde una cadena de `if`.
 *
 * @type {Record<string, {metodos: string[], publica?: boolean}>}
 */
const RUTAS = {
  // `/v1/health` es lo primero que pide la interfaz y lo unico publico: si
  // exigiera token, una interfaz sin token no podria ni diagnosticar por que no
  // tiene token, y el operador se queda con una pantalla en blanco.
  "/v1/health": { metodos: ["GET", "HEAD"], publica: true },
  "/v1/capabilities": { metodos: ["GET", "HEAD"] },
  "/v1/events": { metodos: ["GET"] },
};

function json(res, codigo, cuerpo, extra = {}) {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(codigo, {
    ...CABECERAS_JSON,
    // Nada de esto se embebe en ninguna parte: si alguna pagina lo mete en un
    // iframe, lo que se filtra es el trabajo interno de quien lo corre.
    "x-frame-options": "DENY",
    "content-length": Buffer.byteLength(texto),
    ...extra,
  });
  res.end(texto);
}

/**
 * @param {{home: string, token: string, arranque: string, origenes: readonly string[], bus: any}} estado
 */
export function crearServidor(estado) {
  return createServer((req, res) => {
    let origen = null;
    try {
      origen = typeof req.headers.origin === "string" ? req.headers.origin : null;
      manejar(estado, req, res);
    } catch (e) {
      // Un camino que nadie previo sale con el mismo formato que el resto: un
      // 500 vacio deja al operador sin causa y sin accion, que es justo lo que
      // NFR-006 prohibe.
      if (!res.headersSent) {
        const cuerpo = deExcepcion(e);
        const cors = estado.origenes.includes(origen ?? "") ? cabecerasCors(origen) : cabecerasCors(null);
        json(res, estadoDe(cuerpo), cuerpo, cors);
      } else {
        res.end();
      }
    }
  });
}

function manejar(estado, req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const ruta = url.pathname.replace(/\/+$/, "") || "/";
  const metodo = (req.method || "GET").toUpperCase();
  const origen = typeof req.headers.origin === "string" ? req.headers.origin : null;
  const permitido = origen !== null && estado.origenes.includes(origen);
  const cors = cabecerasCors(permitido ? origen : null);

  const fallar = (codigo, datos) => {
    const cuerpo = problema(codigo, datos);
    json(res, estadoDe(cuerpo), cuerpo, cors);
  };

  const declarada = RUTAS[ruta];

  // El preflight se contesta antes que nada y sin token: el navegador no le
  // pone credenciales a un OPTIONS, asi que exigirselas rompe toda peticion
  // con cabecera propia desde el navegador.
  if (metodo === "OPTIONS") {
    if (origen && !permitido) return fallar("origen_no_permitido", { origen, permitidos: [...estado.origenes] });
    res.writeHead(204, cabecerasCors(permitido ? origen : null, true));
    return res.end();
  }

  const rechazo = revisar(req, url, {
    token: estado.token,
    origenes: estado.origenes,
    // Una ruta que no existe tambien exige token: sin eso, cualquier pagina
    // puede enumerar que rutas tiene este servicio y deducir su version.
    exigeToken: !(declarada && declarada.publica),
  });
  if (rechazo) return fallar(rechazo.codigo, rechazo.datos);

  if (!declarada) return fallar("ruta_desconocida", { metodo, ruta });
  if (!declarada.metodos.includes(metodo)) {
    return fallar("metodo_no_permitido", { metodo, ruta, permitidos: declarada.metodos });
  }

  if (ruta === "/v1/health") {
    return json(res, 200, {
      version: VERSION,
      esquema: ESQUEMA,
      home: estado.home,
      // El principio VIII no es una promesa del diseño si la interfaz no lo
      // puede comprobar al conectarse: sin esto, una ventana no distingue el
      // servicio de control de cualquier otra cosa escuchando en ese puerto.
      escritorUnico: true,
      arranque: estado.arranque,
    }, cors);
  }

  if (ruta === "/v1/capabilities") return json(res, 200, capacidades(), cors);

  if (ruta === "/v1/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      // Sin esto, un proxy que vaya en medio acumula el stream en un buffer y
      // la interfaz no recibe nada hasta que hay varios kilobytes.
      "x-accel-buffering": "no",
      ...cors,
    });
    // `Last-Event-ID` lo manda EventSource solo al reconectar. El parametro de
    // query es para el cliente que reconecta a mano despues de un cierre.
    const desde = req.headers["last-event-id"] ?? url.searchParams.get("ultimo_evento");
    estado.bus.suscribir(res, /** @type {any} */ (desde));
    return;
  }

  // Inalcanzable mientras RUTAS y este bloque digan lo mismo. Si se separan,
  // el fallo sale con causa en vez de colgar la peticion para siempre.
  return fallar("ruta_desconocida", { metodo, ruta });
}

/** Escritura atomica y solo para el duenio. El token esta adentro. */
function escribirSesion(home, datos) {
  const dir = join(home, "servicio");
  mkdirSync(dir, { recursive: true });
  const destino = join(dir, "sesion.json");
  const tmp = `${destino}.tmp-${process.pid}`;
  // `mode` va en la CREACION, no en un chmod posterior: entre el open y el
  // chmod el archivo con el token existe legible para todo el sistema, y un
  // instante alcanza.
  writeFileSync(tmp, JSON.stringify(datos, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, destino);
  return destino;
}

/**
 * Levanta el servicio entero: lock, servidor, canal de eventos y watchdog.
 *
 * @param {{
 *   home: string, token?: string, port?: number,
 *   origenes?: readonly string[], parentPid?: number, watchdogMs?: number,
 *   capacidadEventos?: number, latidoMs?: number,
 *   alQuedarHuerfano?: () => void,
 * }} opts
 */
export async function arrancar(opts) {
  mkdirSync(opts.home, { recursive: true });
  // `realpath` porque en macOS `/var` es un enlace a `/private/var`: sin
  // resolverlo, dos clientes que comparan el home del servicio con el suyo
  // creen estar en directorios distintos estando en el mismo.
  const home = realpathSync(opts.home);

  const lock = tomarHome(home);
  if (!lock.ok) {
    throw new ErrorDeServicio("home_bloqueado", {
      home,
      pid: lock.duenio ? lock.duenio.pid : null,
      razon: lock.razon,
    });
  }

  // Sin `--token` se genera uno. La alternativa —quedar abierto cuando no lo
  // pasan— convierte un olvido en un servicio sin puerta, y el olvido no se ve.
  const token = opts.token || randomBytes(32).toString("hex");
  const bus = crearBus({ capacidad: opts.capacidadEventos, latidoMs: opts.latidoMs });
  const arranqueISO = new Date().toISOString();
  const origenes = opts.origenes && opts.origenes.length ? [...opts.origenes] : [...ORIGENES_POR_DEFECTO];

  const srv = crearServidor({ home, token, arranque: arranqueISO, origenes, bus });

  try {
    await new Promise((resolve, reject) => {
      srv.once("error", reject);
      srv.listen(opts.port ?? 0, "127.0.0.1", () => resolve(null));
    });
  } catch (e) {
    lock.release();
    throw e;
  }

  const direccion = /** @type {any} */ (srv.address());
  const url = `http://127.0.0.1:${direccion.port}`;
  const sesion = escribirSesion(home, { url, token, pid: process.pid, arranque: arranqueISO });

  let cerrando = null;

  /** Apagado limpio: avisar, cortar, soltar. En ese orden. */
  const detener = () => {
    if (cerrando) return cerrando;
    cerrando = (async () => {
      if (perro) perro.detener();
      bus.cerrarTodo();
      await new Promise((resolve) => {
        srv.close(() => resolve(null));
        // Las conexiones keep-alive ociosas mantienen el `close` esperando
        // para siempre, y el proceso no termina aunque ya no atienda a nadie.
        /** @type {any} */ (srv).closeIdleConnections?.();
        const t = setTimeout(() => /** @type {any} */ (srv).closeAllConnections?.(), 200);
        if (typeof t.unref === "function") t.unref();
      });
      try {
        rmSync(sesion, { force: true });
      } catch {
        /* si no se puede borrar, el lock que se suelta abajo ya dice la verdad */
      }
      lock.release();
    })();
    return cerrando;
  };

  const perro = opts.parentPid
    ? vigilarAlPadre({
        pid: opts.parentPid,
        intervaloMs: opts.watchdogMs,
        alMorir: () => {
          // Quedarse huerfano no es un error de este proceso: su padre se fue.
          // Salir con 1 llenaria de fallos falsos los informes de caidas del
          // escritorio, que es como se deja de mirar los informes de caidas.
          const salir = opts.alQuedarHuerfano ?? (() => process.exit(0));
          Promise.resolve(detener()).then(salir, salir);
        },
      })
    : null;

  return {
    url,
    puerto: direccion.port,
    direccion,
    token,
    home,
    arranque: arranqueISO,
    origenes,
    sesion,
    srv,
    bus,
    emitir: (tipo, datos, extra) => bus.emitir(tipo, datos, extra),
    ultimoId: () => bus.ultimoId(),
    detener,
  };
}
