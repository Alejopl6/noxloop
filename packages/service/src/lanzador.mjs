// El lanzador: el motor como subproceso del servicio, con UNA cola global
// (spec 005, FR-006) y el tope de cada proyecto ademas.
//
// -----------------------------------------------------------------------------
// POR QUE UN SUBPROCESO Y NO UNA LLAMADA
// -----------------------------------------------------------------------------
//
// El motor es el unico escritor del estado del run (principio VIII). Si
// corriera dentro de este proceso, el servicio y el motor compartirian pid,
// memoria y excepciones: una tarea que tumba el motor tumbaria el servicio y
// con el todas las ventanas, y el lock del run lo tendria el mismo proceso que
// lee los runs para el board. Como subproceso, el motor es EXACTAMENTE lo que
// corre por la CLI —mismo binario, mismos hooks, misma configuracion leida de
// un archivo—, y lo que el board muestra es lo que el motor escribio.
//
// -----------------------------------------------------------------------------
// EL ENTORNO SE CONSTRUYE, Y EL SECRETO NO VA POR ARGV (principio IX)
// -----------------------------------------------------------------------------
//
// El subproceso recibe el entorno DECLARADO —`PATH`, `HOME`, `NOXLOOP_HOME` y
// la credencial del gestor— y nada mas. Heredar el del servicio le daria al
// motor todas las variables de la maquina del operador; el grant autorizo una
// credencial, no quince. Se arma con `construirEntorno` y se lanza con
// `prepararLanzamiento` de la boveda, que se NIEGA si el valor de un secreto
// aparece en los argumentos: `ps` los muestra a cualquier proceso del usuario.
//
// Y la credencial se pide a la boveda EN CADA PASO (`preparar`), no una vez al
// pulsar Run: entre el plan y la aprobacion pueden pasar horas, y en esas horas
// alguien pudo revocar el grant. Ninguna credencial sin grant verificado en el
// instante del uso.
//
// -----------------------------------------------------------------------------
// LA COLA VIVE EN MEMORIA, A PROPOSITO
// -----------------------------------------------------------------------------
//
// Un run en cola que sobreviviera a un reinicio arrancaria solo, horas despues,
// sin que nadie lo pidiera de nuevo. Los runs dependen del servicio que los
// lanzo (supuesto de la spec): al detenerse se matan los subprocesos, y lo que
// quedo a medias es un archivo en disco que se retoma con Retry —desde el
// disco, conservando lo integrado y los intentos consumidos (principio III)—.
// El LIMITE si se guarda (en el almacen, `ajustes.mjs`): es una preferencia
// del operador, no trabajo pendiente.
//
// -----------------------------------------------------------------------------
// POR QUE LA COLA ES GLOBAL Y NO POR PROYECTO (spec 005, FR-006)
// -----------------------------------------------------------------------------
//
// Lo que se agota no es del proyecto: es la CPU del portatil, la cuota del
// modelo y la atencion del operador. Con una cola por proyecto, cinco
// proyectos con tope 2 son diez agentes a la vez, y el limite que el operador
// cree haber puesto no limita nada. Asi que hay UNA fila de espera, con un
// limite global (`limite()`, leido en cada decision para que cambiarlo en
// Settings valga sin reiniciar), y el tope de cada proyecto
// (`maxParallelItems`) se respeta ademas.
//
// Un pedido cuyo proyecto esta en su tope NO bloquea a los de detras: se salta
// y conserva su puesto. Si bloqueara, un proyecto con tope 1 y tres tickets en
// cola pararia la maquina entera con huecos libres — justo lo contrario de lo
// que el operador pidio al subir el limite.

import { spawn as spawnDeNode } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { construirEntorno, prepararLanzamiento } from "../../vault/src/index.mjs";
import { pathAmpliado } from "../../adapters/src/binarios.mjs";
import { EN_VUELO, avanceDe, estadoDelRun } from "./estado-del-run.mjs";

/** El binario del motor, por defecto el del monorepo. */
export const BIN_DEL_MOTOR = new URL("../../engine/bin/noxloop.mjs", import.meta.url).pathname;

/**
 * Las variables NO SECRETAS que el motor recibe del entorno del servicio, por
 * nombre. Es lo minimo para que git, npm y el runtime del agente funcionen:
 * `PATH` para encontrar los binarios, `HOME`/`USER`/`LOGNAME` para su
 * configuracion y la sesion iniciada del agente (que vive en el directorio del
 * usuario y en el llavero), `TMPDIR` para sus temporales, y los directorios de
 * configuracion de los dos runtimes. Ninguna credencial: esas salen de la
 * boveda, con grant (`secretos`). Declarado, no heredado entero.
 */
export const VARIABLES_DEL_ENTORNO_BASE = Object.freeze([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "LANG",
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
]);

/** Runs simultaneos en toda la maquina cuando el operador no dijo otra cosa. */
export const LIMITE_GLOBAL_POR_DEFECTO = 3;

/** Cuanto de la salida de un subproceso se guarda para explicar un fallo. */
const SALIDA_MAXIMA = 64 * 1024;

/**
 * El archivo de estado de un run, o `null`. Solo lee.
 *
 * @param {string} home
 * @param {string} itemId
 */
export function leerRun(home, itemId) {
  const ruta = join(home, "runs", `run-${itemId}.json`);
  if (!existsSync(ruta)) return null;
  try {
    return JSON.parse(readFileSync(ruta, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Si hay un motor VIVO con el lock de ese run —lanzado por este servicio o
 * por la CLI en otra terminal—. Lee el lock; no lo toca.
 *
 * @param {string} home
 * @param {string} itemId
 */
export function lockVivo(home, itemId) {
  try {
    const datos = JSON.parse(readFileSync(join(home, "locks", `run-${itemId}.json`), "utf8"));
    if (typeof datos.pid !== "number" || datos.pid <= 0) return false;
    process.kill(datos.pid, 0);
    return true;
  } catch (e) {
    return Boolean(e && e.code === "EPERM");
  }
}

/**
 * Lo que un paso del motor dejo en stdout. La CLI escribe el resultado como UN
 * JSON en stdout y todo lo demas en stderr: es su contrato de salida.
 *
 * @param {string} texto
 */
function resultadoDe(texto) {
  try {
    return JSON.parse(texto);
  } catch {
    const i = texto.indexOf("{");
    const j = texto.lastIndexOf("}");
    if (i >= 0 && j > i) {
      try {
        return JSON.parse(texto.slice(i, j + 1));
      } catch {
        /* sin JSON legible no hay resultado; se explica con stderr */
      }
    }
    return null;
  }
}

/**
 * @param {{
 *   home: string,
 *   spawn?: (comando: string, args: string[], opciones: any) => any,
 *   binDelMotor?: string,
 *   nodo?: string,
 *   entornoBase?: Record<string, string>,
 *   emitir?: (tipo: string, datos: any, extra?: {project_id?: string|null}) => any,
 *   intervaloMs?: number,
 *   limite?: () => number,
 * }} opts
 */
export function crearLanzador(opts) {
  const home = opts.home;
  const spawn = opts.spawn ?? spawnDeNode;
  const bin = opts.binDelMotor ?? BIN_DEL_MOTOR;
  const nodo = opts.nodo ?? process.execPath;
  const emitir = opts.emitir ?? (() => {});
  const entornoRecibido = opts.entornoBase ?? Object.fromEntries(
    VARIABLES_DEL_ENTORNO_BASE.filter((k) => typeof process.env[k] === "string").map((k) => [k, String(process.env[k])]),
  );
  // EL PATH AMPLIADO, tambien para el proceso del motor. Desde la app
  // instalada el servicio hereda el PATH minimo de una app GUI de macOS, y el
  // gate (`npm test`) y `gh` corren en el proceso del motor, no en una fase:
  // sin esto no encontraria ninguno de los dos. Es una lista de carpetas, no
  // un secreto.
  const entornoBase = { ...entornoRecibido, PATH: pathAmpliado(entornoRecibido) };
  const intervaloMs = opts.intervaloMs ?? 1500;
  /**
   * El limite global, preguntado en CADA decision y no copiado al arrancar:
   * el operador lo cambia en Settings y tiene que valer en el siguiente hueco.
   * Un valor roto (no entero, menor que 1) cae al defecto en vez de parar la
   * maquina entera con un limite 0.
   */
  const limite = () => {
    const n = opts.limite ? Number(opts.limite()) : LIMITE_GLOBAL_POR_DEFECTO;
    return Number.isInteger(n) && n >= 1 ? n : LIMITE_GLOBAL_POR_DEFECTO;
  };

  /**
   * Lo que el servicio sabe de cada run que lanzo, por item.
   * @type {Map<string, any>}
   */
  const vivos = new Map();
  /** LA fila de espera, de todos los proyectos, en el orden en que arrancan. @type {string[]} */
  const cola = [];
  /** La ultima firma emitida de cada run en vuelo, para no repetir eventos. */
  const firmas = new Map();
  let deteniendo = false;
  /** @type {any} */
  let sondeo = null;

  /** Los que ocupan hueco: en vuelo, o arrancando (preparando la credencial). */
  const ocupan = (/** @type {any} */ v) => EN_VUELO.includes(v.estado);
  const activos = (/** @type {string|null} */ p = null) =>
    [...vivos.values()].filter((v) => ocupan(v) && (p === null || v.projectId === p)).length;

  const posiciones = () => {
    cola.forEach((id, i) => {
      const v = vivos.get(id);
      if (v) v.posicion = i + 1;
    });
  };

  /**
   * La cola global (spec 005, FR-006): el limite, lo que corre y lo que espera
   * con su puesto. Es lo que contesta `GET /v1/queue`.
   */
  function vistaDeCola() {
    return {
      limite: limite(),
      corriendo: [...vivos.values()]
        .filter(ocupan)
        .map((v) => ({ itemId: v.itemId, projectId: v.projectId, estado: v.estado })),
      esperando: cola
        .map((id) => vivos.get(id))
        .filter(Boolean)
        .map((v) => ({ itemId: v.itemId, projectId: v.projectId, posicion: v.posicion })),
    };
  }

  /** Si `v` puede arrancar YA: hay hueco global y su proyecto no esta en su tope. */
  const cabe = (/** @type {any} */ v) => activos() < limite() && activos(v.projectId) < v.maxParalelo;

  /** @param {any} v */
  function avisar(v) {
    emitir("run.cambio", { projectId: v.projectId, itemId: v.itemId, estado: v.estado }, { project_id: v.projectId });
    emitir("board.invalidado", { projectId: v.projectId }, { project_id: v.projectId });
  }

  /** @param {any} v @param {string} estado @param {string|null} [detalle] */
  function pasar(v, estado, detalle = null) {
    v.estado = estado;
    v.detalle = detalle;
    if (estado !== "en_cola") v.posicion = null;
    avisar(v);
  }

  /**
   * Lo que se dice de un run, derivado de lo que se sabe en memoria y lo que
   * hay en disco. Es lo que contestan las rutas.
   *
   * @param {string} itemId
   */
  function derivado(itemId) {
    const e = estadoDelRun(leerRun(home, itemId), vivos.get(itemId) ?? null, { lockVivo: lockVivo(home, itemId) });
    return e ? { itemId, estado: e.estado, posicion: e.posicion } : null;
  }

  /**
   * Arranca, en orden de la fila, todo lo que quepa. Se llama cada vez que se
   * libera un hueco, se sube el limite o se reordena. El que no cabe por el
   * tope de SU proyecto se salta y conserva su puesto (ver la cabecera).
   *
   * Los que siguen esperando y cambiaron de puesto se avisan: la interfaz
   * pinta «#2 en cola» y tiene que enterarse de que ahora es «#1».
   */
  function liberar() {
    if (deteniendo) return;
    const antes = new Map(cola.map((id, i) => [id, i + 1]));
    for (let i = 0; i < cola.length && activos() < limite(); ) {
      const v = vivos.get(/** @type {string} */ (cola[i]));
      if (!v) {
        cola.splice(i, 1);
        continue;
      }
      if (!cabe(v)) {
        i++;
        continue;
      }
      cola.splice(i, 1);
      // `arrancar` pasa a planificando/corriendo SINCRONICAMENTE, antes de su
      // primer `await`: el siguiente `activos()` de este bucle ya lo cuenta.
      void arrancar(v);
    }
    posiciones();
    for (const id of cola) {
      const v = vivos.get(id);
      if (v && antes.get(id) !== v.posicion) avisar(v);
    }
  }

  /** @param {any} v */
  async function arrancar(v) {
    const paso = v.pasos[0];
    pasar(v, paso === "plan" ? "planificando" : "corriendo");
    vigilar();

    let preparado;
    try {
      preparado = v.preparado ?? (await v.preparar());
      v.preparado = null; // la primera vez se usa lo que el llamador ya preparo; despues se vuelve a pedir
    } catch (e) {
      pasar(v, "fallido", e && e.causa ? `${e.causa} ${e.accion ?? ""}`.trim() : String(e?.message ?? e));
      liberar();
      return;
    }

    let entorno;
    let lanzamiento;
    try {
      entorno = construirEntorno({
        // `preparado.variables` son las NO secretas que el paso declara (la
        // direccion del servicio para el gestor local). Van ANTES de
        // `NOXLOOP_HOME` para que ningun paso pueda mover el home del motor.
        variables: { ...entornoBase, ...(preparado.variables ?? {}), NOXLOOP_HOME: home },
        secretos: preparado.secretos ?? {},
      });
      const args = [bin, paso, v.itemId, "--config", preparado.rutaConfig];
      // `--project` solo en `plan`: es el paso que CREA el run. `run` y
      // `resume` leen el que ya existe, con su proyecto escrito.
      if (paso === "plan") args.push("--project", v.projectId);
      // Lo que el paso declara de mas: hoy el hand-off (`--task`, `--runtime`
      // de `resume`, spec 005). Son argumentos NO secretos; si alguno llevara
      // el valor de un secreto, `prepararLanzamiento` se niega a lanzar.
      if (Array.isArray(preparado.argumentos)) args.push(...preparado.argumentos.map(String));
      lanzamiento = prepararLanzamiento({ comando: nodo, args, entorno, cwd: home });
    } catch (e) {
      pasar(v, "fallido", e && e.causa ? `${e.causa} ${e.accion ?? ""}`.trim() : String(e?.message ?? e));
      liberar();
      return;
    }

    let stdout = "";
    let stderr = "";
    let hijo;
    try {
      hijo = spawn(lanzamiento.comando, lanzamiento.args, {
        env: lanzamiento.env,
        cwd: lanzamiento.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      pasar(v, "fallido", `no se pudo arrancar el motor: ${e.message}`);
      liberar();
      return;
    }
    v.hijo = hijo;
    hijo.stdout?.on("data", (/** @type {any} */ t) => {
      if (stdout.length < SALIDA_MAXIMA) stdout += t;
    });
    hijo.stderr?.on("data", (/** @type {any} */ t) => {
      if (stderr.length < SALIDA_MAXIMA) stderr += t;
    });
    hijo.on("error", (/** @type {any} */ e) => {
      stderr += `\n${e.message}`;
    });
    hijo.on("close", (/** @type {number|null} */ codigo) => {
      v.hijo = null;
      terminar(v, paso, codigo, stdout, stderr, entorno);
    });
  }

  /**
   * @param {any} v
   * @param {string} paso
   * @param {number|null} codigo
   * @param {string} stdout
   * @param {string} stderr
   * @param {any} entorno
   */
  function terminar(v, paso, codigo, stdout, stderr, entorno) {
    if (deteniendo || v.estado === "interrumpido") return;
    const r = resultadoDe(stdout);

    /**
     * La causa de un fallo, SIN el valor de ningun secreto. El motor no
     * deberia imprimirlo nunca, pero el stderr de un subproceso es texto que
     * nadie reviso, y un 401 que repite el token es un clasico. Si aparece, se
     * guarda el NOMBRE de la variable y no la causa entera: recortar el valor a
     * mano deja trozos, y un trozo es una fuga.
     */
    const explicar = (/** @type {string} */ texto) => {
      const t = String(texto || "").trim().slice(-2000);
      const colado = entorno.buscarSecretoEn([t]);
      if (colado) {
        return (
          `el paso \`${paso}\` del motor fallo y su salida contenia el valor de ${colado}; se omite la salida ` +
          "entera para no guardarlo. Mira la auditoria y rota la credencial si hace falta."
        );
      }
      return t || `el paso \`${paso}\` del motor termino con codigo ${codigo} sin decir por que`;
    };

    if (paso === "plan") {
      if (codigo === 0 && r && r.ok !== false) {
        v.pasos.shift();
        if (v.pasos.length) return void arrancar(v);
        pasar(v, "plan_listo");
        return liberar();
      }
      if (r && r.question) pasar(v, "necesita_criterios", explicar(String(r.question)));
      else pasar(v, "fallido", explicar(causaDe(r, stderr)));
      return liberar();
    }

    // `run` y `resume`.
    // El final bueno: el PR abierto, o —con el termino `commit`— la rama lista.
    if (codigo === 0 && r && (r.pr || r.rama)) pasar(v, "terminado", null);
    else if (r && Array.isArray(r.blocked) && r.blocked.length) pasar(v, "terminado", explicar((r.humano || []).join("\n")));
    else pasar(v, codigo === 0 ? "terminado" : "fallido", codigo === 0 ? null : explicar(causaDe(r, stderr)));
    liberar();
  }

  /**
   * Mientras hay motores corriendo, se mira su archivo de estado para avisar
   * del cambio de fase. Solo lee, y solo si hay algo en vuelo.
   */
  function vigilar() {
    if (sondeo || !intervaloMs) return;
    sondeo = setInterval(() => {
      const enVuelo = [...vivos.values()].filter((v) => EN_VUELO.includes(v.estado));
      if (!enVuelo.length) {
        clearInterval(sondeo);
        sondeo = null;
        return;
      }
      for (const v of enVuelo) {
        const run = leerRun(home, v.itemId);
        const avance = avanceDe(run, v.estado);
        const firma = JSON.stringify(avance);
        if (firmas.get(v.itemId) !== firma) {
          firmas.set(v.itemId, firma);
          avisar(v);
        }
      }
    }, intervaloMs);
    if (typeof sondeo.unref === "function") sondeo.unref();
  }

  /**
   * Encola o arranca. Devuelve lo que contesta la ruta.
   *
   * @param {{projectId: string, itemId: string, maxParalelo: number, pasos: string[], preparado?: any, preparar: () => Promise<any>}} pedido
   */
  function encolar(pedido) {
    const v = /** @type {any} */ ({
      projectId: pedido.projectId,
      itemId: pedido.itemId,
      maxParalelo: Math.max(1, pedido.maxParalelo || 1),
      pasos: [...pedido.pasos],
      preparado: pedido.preparado ?? null,
      preparar: pedido.preparar,
      estado: "nuevo",
      detalle: null,
      posicion: null,
      hijo: null,
    });
    vivos.set(v.itemId, v);
    // Se encola si no cabe, o si YA hay alguien de su proyecto esperando: sin
    // lo segundo, un recien llegado adelantaria al que lleva un rato en la fila
    // por el mero hecho de que acaba de liberarse un hueco en el mismo tick.
    const esperaAlguienDelProyecto = cola.some((id) => vivos.get(id)?.projectId === v.projectId);
    if (!cabe(v) || esperaAlguienDelProyecto) {
      cola.push(v.itemId);
      posiciones();
      pasar(v, "en_cola");
      v.posicion = cola.indexOf(v.itemId) + 1;
      return { codigo: 202, run: { itemId: v.itemId, estado: "en_cola", posicion: v.posicion } };
    }
    void arrancar(v);
    return { codigo: 202, run: { itemId: v.itemId, estado: v.estado, posicion: null } };
  }

  return {
    /**
     * Run sobre un ticket. IDEMPOTENTE (FR-016): si el servicio ya lo tiene, o
     * el disco ya tiene su run, devuelve ese con `200` y no lanza nada.
     *
     * @param {{projectId: string, itemId: string, autonomia: string, maxParalelo: number, preparado?: any, preparar: () => Promise<any>}} pedido
     */
    async lanzar(pedido) {
      const existente = derivado(pedido.itemId);
      if (existente) return { codigo: 200, run: existente };
      const pasos = pedido.autonomia === "L2" ? ["plan", "run"] : ["plan"];
      return encolar({ ...pedido, pasos });
    },

    /** Aprobar un plan: lanza `run`. Quien llama ya comprobo que esta en `plan_listo`. */
    async aprobar(/** @type {any} */ pedido) {
      return encolar({ ...pedido, pasos: ["run"] });
    },

    /**
     * Reintentar. Con run en disco se RETOMA (`resume`): lo integrado y los
     * intentos consumidos se conservan (principio III). Sin run —el plan nunca
     * llego a escribirse— se vuelve a planificar.
     */
    async reintentar(/** @type {any} */ pedido) {
      const hayRun = leerRun(home, pedido.itemId) !== null;
      const pasos = hayRun ? ["resume"] : pedido.autonomia === "L2" ? ["plan", "run"] : ["plan"];
      return encolar({ ...pedido, pasos });
    },

    /** Lo que el servicio sabe de un item, tal cual (sin mirar el disco). */
    estado(/** @type {string} */ itemId) {
      const v = vivos.get(itemId);
      return v ? { itemId, projectId: v.projectId, estado: v.estado, detalle: v.detalle, posicion: v.posicion } : null;
    },

    /** Todo lo que el servicio sabe, para el board y `/v1/runs`. */
    estados() {
      return [...vivos.values()].map((v) => ({
        itemId: v.itemId,
        projectId: v.projectId,
        estado: v.estado,
        detalle: v.detalle,
        posicion: v.posicion,
      }));
    },

    derivado,

    /**
     * La cola global (spec 005, FR-006): el limite, lo que corre y lo que
     * espera con su puesto. Es lo que contesta `GET /v1/queue`.
     */
    cola: vistaDeCola,

    /**
     * Reordena lo que espera: los ids dados van primero, en ese orden; lo que
     * no se nombra conserva su orden relativo DETRAS. Un id que no espera (ya
     * arranco, o nunca existio) se ignora sin fallar: entre que la interfaz
     * pinto la cola y el operador solto la fila, ese run pudo arrancar, y
     * rechazar el reordenamiento entero por eso castiga al operador por una
     * carrera que no ve.
     *
     * @param {string[]} orden
     */
    reordenar(orden) {
      const pedidos = [...new Set(orden.map(String))].filter((id) => cola.includes(id));
      const resto = cola.filter((id) => !pedidos.includes(id));
      const antes = new Map(cola.map((id, i) => [id, i + 1]));
      cola.splice(0, cola.length, ...pedidos, ...resto);
      posiciones();
      for (const id of cola) {
        const v = vivos.get(id);
        if (v && antes.get(id) !== v.posicion) avisar(v);
      }
      return vistaDeCola();
    },

    /** Vuelve a mirar la fila: tras cambiar el limite, para que subirlo valga ya. */
    revisar() {
      liberar();
      return vistaDeCola();
    },

    /** Mata los subprocesos: un run no sobrevive al servicio que lo lanzo. */
    async detener() {
      deteniendo = true;
      if (sondeo) clearInterval(sondeo);
      sondeo = null;
      const esperas = [];
      for (const v of vivos.values()) {
        if (v.hijo) {
          const hijo = v.hijo;
          esperas.push(
            new Promise((r) => {
              hijo.once("close", () => r(null));
              setTimeout(() => r(null), 2000).unref?.();
            }),
          );
          try {
            hijo.kill("SIGTERM");
          } catch {
            /* un proceso que ya murio no impide detener el resto */
          }
        }
        if (EN_VUELO.includes(v.estado) || v.estado === "en_cola") {
          v.estado = "interrumpido";
          v.detalle = "el servicio se detuvo con el run en curso; se retoma desde el disco con Retry";
        }
      }
      cola.length = 0;
      await Promise.all(esperas);
    },
  };
}

/**
 * La causa de un fallo del motor, entera.
 *
 * `reason` resume («el plan no valida») y `problems` dice cual: tirar lo
 * segundo dejaba al operador con un resumen y ningun lugar donde mirar.
 *
 * @param {any} r el JSON que imprimio el motor, si imprimio alguno
 * @param {string} stderr
 */
function causaDe(r, stderr) {
  if (!r?.reason) return stderr;
  const problemas = Array.isArray(r.problems) ? r.problems.filter(Boolean) : [];
  return problemas.length ? `${r.reason}: ${problemas.join("; ")}` : String(r.reason);
}
