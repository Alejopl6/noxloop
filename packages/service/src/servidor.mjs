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

import { crearBus } from "./eventos.mjs";
import { RAICES_POR_DEFECTO } from "./carpetas.mjs";
import { CABECERAS_JSON, ErrorDeServicio, describir, problema } from "./errores.mjs";
import { RECURSO, tomarHome } from "./lock.mjs";
import { ORIGENES_POR_DEFECTO, cabecerasCors, revisar } from "./puerta.mjs";
import { TABLA } from "./tabla.mjs";
import { emparejar } from "./rutas.mjs";
import { abrirDependencias, VARIABLE_DE_FRASE } from "./dependencias.mjs";
import { vigilarAlPadre } from "./watchdog.mjs";
import { BIN_DEL_MOTOR, crearLanzador } from "./lanzador.mjs";
import { MAX_PARALELO_POR_DEFECTO, RAIZ_DE_PROVEEDORES, cargarGestor } from "./motor.mjs";

/** Version de la forma de las respuestas. Un cambio incompatible la sube. */
export { ESQUEMA } from "./esquema-de-respuesta.mjs";

/** El recurso que se bloquea: un home, un escritor. */
export const RECURSO_DEL_LOCK = RECURSO;

/** Cuanto cuerpo se acepta. Mas que esto no es una peticion, es un intento de tumbar el proceso. */
const CUERPO_MAXIMO = 4 * 1024 * 1024;

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
 * Lee el cuerpo UNA vez y lo devuelve como JSON.
 *
 * POR QUE CON UN TOPE. Sin el, una peticion con un cuerpo infinito se come la
 * memoria del proceso y el servicio se cae para todas las ventanas. El tope se
 * comprueba mientras llega, no al final: comprobarlo despues significa que ya
 * se acumulo.
 *
 * @param {import("node:http").IncomingMessage} req
 */
function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const trozos = [];
    let total = 0;
    req.on("data", (t) => {
      total += t.length;
      if (total > CUERPO_MAXIMO) {
        reject(
          new ErrorDeServicio("cuerpo_invalido", {
            detalle: `supera los ${Math.round(CUERPO_MAXIMO / 1024)} KB que este servicio acepta`,
          }),
        );
        req.destroy();
        return;
      }
      trozos.push(t);
    });
    req.on("error", reject);
    req.on("end", () => {
      const texto = Buffer.concat(trozos).toString("utf8").trim();
      if (!texto) return resolve({});
      try {
        const valor = JSON.parse(texto);
        if (valor === null || typeof valor !== "object" || Array.isArray(valor)) {
          // Un cuerpo que es un numero o una lista no se puede leer por campos,
          // y el `undefined` que saldria de cada lectura se persiste como un
          // hueco sin que nadie lo vea.
          return reject(
            new ErrorDeServicio("cuerpo_invalido", { detalle: "el cuerpo es JSON pero no es un objeto con campos" }),
          );
        }
        resolve(valor);
      } catch (e) {
        reject(new ErrorDeServicio("cuerpo_invalido", { detalle: `no es JSON valido (${e.message})` }));
      }
    });
  });
}

/**
 * @param {{home: string, token: string, arranque: string, origenes: readonly string[], raicesDeExploracion: readonly string[], bus: any, dep: any, motor?: any}} estado
 */
export function crearServidor(estado) {
  return createServer((req, res) => {
    const origen = typeof req.headers.origin === "string" ? req.headers.origin : null;
    // Un camino que nadie previo sale con el mismo formato que el resto: un
    // 500 vacio deja al operador sin causa y sin accion, que es justo lo que
    // NFR-006 prohibe.
    const caer = (e) => {
      if (res.writableEnded) return;
      if (!res.headersSent) {
        const { cuerpo, estado: codigo } = describir(e);
        const cors = estado.origenes.includes(origen ?? "") ? cabecerasCors(origen) : cabecerasCors(null);
        // Tambien los errores. El principio IX nombra los mensajes de error
        // explicitamente entre los sitios donde el valor no puede estar, y el
        // camino real es corto: la credencial viaja en una URL y el 404 la
        // repite dentro de su causa porque nombrar la ruta es lo que hace util
        // a ese 404.
        json(res, codigo, estado.dep.redactarSalida(cuerpo), cors);
      } else {
        res.end();
      }
    };
    try {
      Promise.resolve(manejar(estado, req, res)).catch(caer);
    } catch (e) {
      caer(e);
    }
  });
}

async function manejar(estado, req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const ruta = url.pathname.replace(/\/+$/, "") || "/";
  const metodo = (req.method || "GET").toUpperCase();
  const origen = typeof req.headers.origin === "string" ? req.headers.origin : null;
  const permitido = origen !== null && estado.origenes.includes(origen);
  const cors = cabecerasCors(permitido ? origen : null);

  const fallar = (codigo, datos) => {
    const cuerpo = problema(codigo, datos);
    const { estado: http } = describir(new ErrorDeServicio(codigo, datos));
    json(res, http, estado.dep.redactarSalida(cuerpo), cors);
  };

  const encontrada = emparejar(TABLA, ruta);
  const declarada = encontrada ? encontrada.entrada : null;

  // El preflight se contesta antes que nada y sin token: el navegador no le
  // pone credenciales a un OPTIONS, asi que exigirselas rompe toda peticion
  // con cabecera propia desde el navegador.
  if (metodo === "OPTIONS") {
    if (origen && !permitido) return fallar("origen_no_permitido", { origen, permitidos: [...estado.origenes] });
    res.writeHead(204, cabecerasCors(permitido ? origen : null, true, declarada ? declarada.metodos : null));
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

  /** @type {any} */
  let cuerpoLeido;
  const cuerpo = async () => {
    if (cuerpoLeido === undefined) cuerpoLeido = await leerCuerpo(req);
    return cuerpoLeido;
  };

  const peticion = {
    estado,
    dep: estado.dep,
    // `encontrada` no puede ser null aqui: si lo fuera, el `if (!declarada)` de
    // arriba ya habria contestado el 404. Se dice para el typecheck, que no
    // puede seguir esa cadena.
    parametros: /** @type {any} */ (encontrada).parametros,
    url,
    metodo,
    cuerpo,
    req,
    res,
    cors,
  };

  const crudo = await declarada.manejar(peticion);

  // LA ULTIMA PUERTA (NFR-004). Todo lo que sale pasa por el redactor de la
  // boveda, aqui y no en cada manejador: una garantia que dice "ninguna
  // respuesta de ningun endpoint" no se sostiene revisando cuarenta
  // manejadores, se sostiene si hay un unico punto por el que todos pasan.
  const salida = crudo === undefined ? crudo : { ...crudo, cuerpo: estado.dep.redactarSalida(crudo.cuerpo) };
  // Una ruta `crudo` —el canal de eventos— ya escribio por su cuenta. Volver a
  // escribirle encima es un `ERR_HTTP_HEADERS_SENT` que se lleva la conexion.
  if (declarada.crudo || salida === undefined) return;

  // `HEAD` lleva las mismas cabeceras que el `GET` y ningun cuerpo: es lo que
  // hace que un cliente pueda preguntar "¿esto existe?" sin descargarlo.
  if (metodo === "HEAD") {
    const texto = JSON.stringify(salida.cuerpo ?? {});
    res.writeHead(salida.codigo ?? 200, {
      ...CABECERAS_JSON,
      "x-frame-options": "DENY",
      "content-length": Buffer.byteLength(texto),
      ...cors,
      ...(salida.cabeceras ?? {}),
    });
    return res.end();
  }

  return json(res, salida.codigo ?? 200, salida.cuerpo ?? {}, { ...cors, ...(salida.cabeceras ?? {}) });
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
 *   origenes?: readonly string[], raicesDeExploracion?: readonly string[],
 *   parentPid?: number, watchdogMs?: number,
 *   capacidadEventos?: number, latidoMs?: number,
 *   alQuedarHuerfano?: () => void,
 *   frase?: string|null, backendDeSecretos?: any, proveedorDeConexiones?: any,
 *   adaptadores?: any, fabricaDeModelo?: ((conf: {clave: string, modelo?: string}) => any)|null,
 *   reloj?: () => number,
 *   motor?: {
 *     spawn?: (comando: string, args: string[], opciones: any) => any, binDelMotor?: string, nodo?: string,
 *     entornoBase?: Record<string, string>, intervaloMs?: number, raizDeProveedores?: string,
 *     cargarGestor?: (nombre: string) => Promise<any>, maxParalelo?: number, ttlDelBoardMs?: number,
 *     reloj?: () => number,
 *     ejecutarAutenticacion?: (argv: string[], o: {env: Record<string, string>}) => Promise<{code: number|null, stdout: string, stderr: string}>,
 *     lanzarLogin?: (argv: string[], env: Record<string, string>) => void,
 *   },
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

  // DESDE DONDE SE PUEDE EXPLORAR EL DISCO. Va aqui —junto a la allowlist de
  // origenes— porque es lo mismo: una lista de lo que este proceso acepta, con
  // un valor por defecto acotado y configurable. `carpetas.mjs` razona por que
  // el defecto es el home del operador y nunca `/`.
  const raicesDeExploracion =
    opts.raicesDeExploracion && opts.raicesDeExploracion.length
      ? [...opts.raicesDeExploracion]
      : RAICES_POR_DEFECTO();

  // El almacen se abre DESPUES del lock y no antes: abrirlo antes significa
  // que dos procesos tocan el mismo archivo de base de datos durante el
  // instante en que el segundo descubre que no le toca arrancar.
  let dep;
  try {
    dep = await abrirDependencias({
      home,
      frase: opts.frase ?? process.env[VARIABLE_DE_FRASE] ?? null,
      backendDeSecretos: opts.backendDeSecretos,
      proveedorDeConexiones: opts.proveedorDeConexiones,
      adaptadores: opts.adaptadores,
      fabricaDeModelo: opts.fabricaDeModelo,
      reloj: opts.reloj,
    });
  } catch (e) {
    lock.release();
    throw e;
  }

  // El canal de eventos pasa por el mismo redactor que las respuestas. Es la
  // tercera salida de este servicio —respuesta, error y evento— y NFR-004 no
  // distingue entre ellas: un evento con el valor adentro llega a todas las
  // ventanas abiertas a la vez, que es peor que una respuesta a quien la pidio.
  const canal = {
    ...bus,
    emitir: (tipo, datos, extra) => bus.emitir(tipo, dep.redactarSalida(datos ?? {}), extra),
  };

  // EL MOTOR, MONTADO SOBRE EL MISMO HOME (spec 003). El lanzador arranca la
  // CLI del motor como subproceso y lleva la cola de cada proyecto en memoria;
  // lo demas es lo que las rutas del board necesitan para componer la
  // configuracion y leer los tickets del gestor. Todo inyectable: los tests
  // cambian el `spawn` y el cargador del proveedor, nunca la politica.
  const m = opts.motor ?? {};
  const raizDeProveedores = m.raizDeProveedores ?? RAIZ_DE_PROVEEDORES;
  const motor = {
    lanzador: crearLanzador({
      home,
      spawn: m.spawn,
      binDelMotor: m.binDelMotor,
      nodo: m.nodo,
      entornoBase: m.entornoBase,
      intervaloMs: m.intervaloMs,
      emitir: canal.emitir,
    }),
    binDelMotor: m.binDelMotor ?? BIN_DEL_MOTOR,
    raizDeProveedores,
    cargarGestor: m.cargarGestor ?? ((/** @type {string} */ n) => cargarGestor(n, raizDeProveedores)),
    maxParalelo: m.maxParalelo ?? MAX_PARALELO_POR_DEFECTO,
    // El board cachea lo que el gestor contesta, por proyecto: SC-004 pide el
    // board en menos de dos segundos con diez proyectos, y diez viajes al
    // gestor en cada pintada no caben ahi.
    ttlDelBoardMs: m.ttlDelBoardMs ?? 30_000,
    cacheDelBoard: new Map(),
    reloj: m.reloj ?? (() => Date.now()),
    // Settings -> Modelos (`runtimes.mjs`). Inyectables: la pregunta de verdad
    // lanza `claude auth status`, y el login abre el navegador del operador.
    // Un test que no los inyecta pregunta a los binarios reales de la maquina.
    ejecutarAutenticacion: m.ejecutarAutenticacion,
    lanzarLogin: m.lanzarLogin,
    entornoBase: m.entornoBase,
    cacheDeRuntimes: new Map(),
    // La direccion en la que escucha ESTE servicio. Se rellena al escuchar:
    // el gestor local la necesita dentro del motor para pedirle las tareas al
    // unico escritor del almacen en vez de abrirlo por su cuenta.
    /** @type {string|null} */
    url: null,
  };

  const srv = crearServidor({ home, token, arranque: arranqueISO, origenes, raicesDeExploracion, bus: canal, dep, motor });

  try {
    await new Promise((resolve, reject) => {
      srv.once("error", reject);
      srv.listen(opts.port ?? 0, "127.0.0.1", () => resolve(null));
    });
  } catch (e) {
    dep.cerrar();
    lock.release();
    throw e;
  }

  const direccion = /** @type {any} */ (srv.address());
  const url = `http://127.0.0.1:${direccion.port}`;
  motor.url = url;
  const sesion = escribirSesion(home, { url, token, pid: process.pid, arranque: arranqueISO });

  let cerrando = null;

  /** Apagado limpio: avisar, cortar, soltar. En ese orden. */
  const detener = () => {
    if (cerrando) return cerrando;
    cerrando = (async () => {
      if (perro) perro.detener();

      // Los runs dependen del servicio que los lanzo: se matan ANTES de cerrar
      // la base, y lo que quedo a medias se retoma desde el disco con Retry.
      await motor.lanzador.detener();

      // Los escaneos EN VUELO se matan ANTES que nada. Cada uno corre en su
      // hilo y termina escribiendo el snapshot en el almacen: si el almacen se
      // cierra primero, el hilo escribe sobre una base cerrada y el fallo sale
      // como un `uncaughtException` con "database is not open" —fuera de toda
      // peticion, sin causa que lo relacione con nada— y se lleva el proceso.
      for (const [, escaneo] of dep.escaneos) {
        try {
          await escaneo.hilo.terminate();
        } catch {
          /* un hilo que ya murio no impide apagar el resto */
        }
      }
      dep.escaneos.clear();

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
      // El almacen se cierra ANTES de soltar el lock: al reves hay un instante
      // en el que otro servicio ya puede tomar el home y este todavia tiene la
      // base abierta — o sea, dos escritores, que es lo que el lock existe para
      // impedir.
      try {
        dep.cerrar();
      } catch {
        /* una base que no cierra no puede impedir que el proceso termine */
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
    raicesDeExploracion,
    sesion,
    srv,
    bus,
    dep,
    motor,
    emitir: (tipo, datos, extra) => bus.emitir(tipo, datos, extra),
    ultimoId: () => bus.ultimoId(),
    detener,
  };
}
