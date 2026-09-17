// El bucle: lo que hace que asignar un ticket sea todo lo que hay que hacer.
//
// La bandeja (`inbox.mjs`) dice QUE hay que despachar. Este modulo es el que
// vuelve a preguntar, decide cuanto se puede lanzar a la vez y sobrevive a que
// cualquiera de las dos puntas se caiga.
//
// POR QUE ES CONSULTA PERIODICA Y NO WEBHOOKS (D8 de research.md). Un webhook
// obliga a un endpoint publico, a reintentos y a verificacion de firmas: es
// infraestructura que quien adopta esto puede no tener, y el requisito se
// satisface sin ella.
//
// POR QUE `despachar`, `dormir` Y `ahora` SE INYECTAN. Las tres son la unica
// forma de probar un bucle temporal. Con el intervalo real, tres vueltas
// cuestan seis minutos y el retroceso ante un gestor caido cuesta media hora:
// un bucle asi no se prueba, se mira. Y `despachar` inyectado es lo que permite
// probar el limite de concurrencia y el ticket que falla sin invocar el modelo
// ni una vez. Ademas deja el cableado al CLI —quien resuelve nivel y delega— del
// otro lado del limite, que es donde ya vive (`comandos.mjs`).
//
// ESTE MODULO NO SABE QUE ES UN RECORRIDO. Recibe una funcion que despacha un
// item y solo mira dos cosas: si lanzo, y cuantos recorridos quedaron abiertos
// en disco.

import { listRuns, loadRun } from "./state.mjs";
import { revisarBandeja, recordarOmision, estadoDeRecorrido, BandejaError } from "./inbox.mjs";
import { acquire, inspect } from "./lock.mjs";
import { nullLogger } from "./log.mjs";

/** El recurso del lock. No lleva el id de ningun item: el daemon no es de uno. */
const RECURSO = "daemon";

/** Los defaults del schema de configuracion, repetidos aca por una razon. */
//
// El schema declara `pollIntervalSec: 120` y `maxParallelItems: 2` como default,
// pero un default de JSON Schema solo se aplica si la configuracion paso por el
// validador. El daemon tambien se invoca con una configuracion armada a mano
// —los tests, un hook, un llamador nuevo— y ahi `limits` puede no existir. Un
// intervalo que cae en `undefined` convierte `dormir(NaN)` en un bucle cerrado
// contra la API del gestor: el fallo mas caro que este modulo puede producir, y
// el mas silencioso, porque desde afuera parece que anda rapido.
const INTERVALO_POR_DEFECTO_SEG = 120;
const CONCURRENCIA_POR_DEFECTO = 2;

/**
 * El techo del retroceso, en multiplos del intervalo.
 *
 * Existe para que un gestor que volvio se note en un tiempo acotado. Sin techo,
 * ocho fallos seguidos con el intervalo por defecto dan mas de cuatro horas de
 * espera, y el daemon queda dormido mucho despues de que el gestor se recupero
 * — que es el mismo silencio que el retroceso venia a evitar, corrido de lugar.
 */
const RETROCESO_MAXIMO = 8;

/**
 * El fallo del daemon se LANZA con su codigo, igual que en la bandeja, y por la
 * misma razon: no puede existir una forma de la salida que signifique "fallo".
 *
 * La excepcion deliberada es el lock tomado, que se DEVUELVE (`ok: false`). Un
 * lock tomado no es un error: es la respuesta correcta a "ya hay un daemon". El
 * segundo tiene que informar quien lo tiene y terminar con exit != 0, no
 * imprimir un stack.
 */
export class DaemonError extends Error {
  /**
   * @param {string} codigo
   * @param {string} mensaje
   * @param {Error} [causa]
   */
  constructor(codigo, mensaje, causa) {
    super(mensaje);
    this.name = "DaemonError";
    this.codigo = codigo;
    /** @type {Error | undefined} */
    this.causa = causa;
  }
}

/**
 * Un fallo de la bandeja que NO tiene sentido reintentar: no es el gestor
 * caido, es una configuracion que no puede funcionar nunca.
 *
 * Reintentar un arranque imposible cada dos minutos para siempre es la version
 * silenciosa del mismo error, y la peor, porque parece que funciona: el proceso
 * esta vivo, la bitacora tiene lineas, y no hay ni un recorrido.
 */
const ARRANQUE_IMPOSIBLE = ["sin_disparo", "proveedor_incompleto", "sin_home", "respuesta_invalida"];

/**
 * Un limite de la configuracion, o el default.
 *
 * POR QUE NO ALCANZA `??`. `??` solo atrapa `null` y `undefined`: un `0`, un
 * `-1`, un `NaN` o el string `"120"` que salio de una variable de entorno pasan
 * derecho. Cada uno tiene su fallo y ninguno se ve desde afuera:
 * `pollIntervalSec: 0` convierte la consulta periodica en un bucle cerrado
 * contra la API del gestor —parece que anda rapido—, y `maxParallelItems: 0`
 * produce un daemon que consulta y no despacha nunca, que es indistinguible de
 * una bandeja vacia. El schema declara minimo 30 y minimo 1: un valor que no
 * llega a numero positivo es configuracion invalida, no una forma de pausar
 * nada, y se dice.
 */
function limite(config, nombre, porDefecto, log) {
  const crudo = config?.limits?.[nombre];
  if (typeof crudo === "number" && Number.isFinite(crudo) && crudo > 0) return crudo;
  if (crudo !== undefined) {
    log?.warn(
      // `JSON.stringify(NaN)` es "null", y un NaN reportado como null manda a
      // mirar el lugar equivocado de la configuracion.
      `limits.${nombre} es ${typeof crudo === "number" ? String(crudo) : JSON.stringify(crudo)}, que no es un numero positivo: se usa el `
      + `default del schema (${porDefecto}). Un valor invalido aca no frena nada a medias — apaga el daemon en silencio.`,
    );
  }
  return porDefecto;
}

const intervaloMs = (config, log) => limite(config, "pollIntervalSec", INTERVALO_POR_DEFECTO_SEG, log) * 1000;

const concurrencia = (config, log) => limite(config, "maxParallelItems", CONCURRENCIA_POR_DEFECTO, log);

/**
 * Cuantos recorridos hay abiertos ahora mismo, leyendo el disco.
 *
 * POR QUE SE CUENTA DEL DISCO Y NO DE LO QUE DESPACHO ESTE PROCESO. El estado
 * vive en disco justamente para que un daemon reiniciado no crea que empieza de
 * cero: con un contador en memoria, reiniciarlo con dos recorridos abiertos
 * lanza dos mas y duplica el paralelismo real sin pasarse del limite declarado.
 *
 * POR QUE EL CORRUPTO NO CUENTA. No hay nada corriendo detras de un JSON
 * ilegible. Contarlo ocuparia un lugar para siempre, y con
 * `maxParallelItems: 1` un solo archivo roto dejaria al daemon sin despachar
 * nunca mas. Que ese ticket no se vuelva a despachar es trabajo de la bandeja,
 * que ya lo hace y lo dice.
 *
 * @param {{home: string}} opts
 * @returns {string[]} los items con recorrido abierto
 */
export function recorridosEnCurso(opts) {
  return listRuns(opts)
    .filter((run) => estadoDeRecorrido(run) === "en_curso")
    .map((run) => String(run?.item?.id ?? ""));
}

/**
 * Una sola iteracion: leer la bandeja, despachar lo que entre en el cupo,
 * registrar lo que falle.
 *
 * Es lo que de verdad se prueba. `correrDaemon` no agrega mas que el lock, la
 * espera y la condicion de salida.
 *
 * NO TOMA EL LOCK. El lock es del bucle entero, no de la vuelta: tomarlo y
 * soltarlo en cada vuelta deja una ventana de dos minutos —el intervalo— en la
 * que un segundo daemon entra sin que nadie lo note. Quien llame a `unaVuelta`
 * suelta tiene que tenerlo.
 *
 * @param {any} config configuracion validada; de aca salen `home` y `limits`
 * @param {{provider: any, providerCtx: any, home?: string, log?: any,
 *   despachar: (item: any, extra: any) => Promise<any>, latidoMs?: number}} deps
 */
export async function unaVuelta(config, deps) {
  const home = deps.home || config?.home;
  const log = deps.log || nullLogger();
  const despachar = exigirDespachador(deps);

  const bandeja = await revisarBandeja(config, { ...deps, home, log });

  // EL CUPO. `maxParallelItems` es un limite de recorridos VIVOS, no de
  // despachos por vuelta: cada recorrido son varios worktrees, varias sesiones
  // del modelo y su lugar en la cola de integracion. Contar solo por vuelta
  // dejaria que diez vueltas con un despacho cada una tengan diez recorridos
  // abiertos a la vez, que es exactamente lo que el limite existe para impedir.
  const limite = concurrencia(config, log);
  const enCurso = recorridosEnCurso({ home }).length;
  const cupo = Math.max(0, limite - enCurso);

  const aDespachar = bandeja.nuevos.slice(0, cupo);
  const aplazados = bandeja.nuevos.slice(cupo);

  if (aplazados.length) {
    // UN APLAZADO NO SE RECUERDA COMO OMITIDO. La memoria de la bandeja corta
    // el reintento mientras el ticket no cambie, y un ticket aplazado tiene que
    // entrar en la vuelta siguiente sin que nadie lo toque. Recordarlo aca lo
    // dejaria afuera hasta que alguien le editara el titulo.
    //
    // SE NOMBRAN LOS PRIMEROS Y SE CUENTA EL RESTO. Una bandeja grande es
    // normal el primer dia que alguien conecta el daemon a un tablero que ya
    // existia: con mil tickets aplazados esta linea medía 5944 caracteres, y
    // sale una vez por vuelta —720 veces por dia—. Un aviso que no se puede
    // leer es lo mismo que no avisar, y encima tapa lo demas.
    const nombrados = aplazados.slice(0, 10).map((i) => String(i.id));
    const resto = aplazados.length - nombrados.length;
    log.info(
      `${aplazados.length} ticket(s) esperan cupo (${enCurso} recorrido(s) en curso, limite ${limite}): `
      + `${nombrados.join(", ")}${resto > 0 ? ` y ${resto} mas` : ""}`,
    );
  }

  /** @type {string[]} */ const despachados = [];
  /** @type {Array<{item: any, porque: string}>} */ const fallados = [];

  // Los despachos de una vuelta arrancan JUNTOS y se esperan todos. Es lo que
  // hace que el cupo sea un limite de concurrencia real y no de a uno por vez,
  // y es tambien lo que sostiene el apagado limpio: cuando esta linea vuelve,
  // no quedo ningun despacho en vuelo del que nadie sepa.
  //
  // EL CALLBACK ES `async` A PROPOSITO. Un `despachar` que lanza de forma
  // SINCRONA —un TypeError del cableado, una firma que cambio— propaga el throw
  // hacia afuera del `map`, y con el se va la vuelta entera: el bucle lo lee
  // como "la consulta a la bandeja fallo", duplica la espera, no despacha
  // ninguno de los otros tickets de la vuelta, no registra al que fallo, y
  // culpa al gestor de un error del motor. Un callback `async` convierte ese
  // throw en un rechazo, que es lo que `allSettled` sabe atrapar.
  const pendientes = new Map(aDespachar.map((item) => [String(item.id), Date.now()]));
  const latido = arrancarLatido(pendientes, deps.latidoMs ?? intervaloMs(config), log);

  let resultados;
  try {
    resultados = await Promise.allSettled(
      aDespachar.map(async (item) => {
        try {
          return await despachar(item, { config, home, log });
        } finally {
          pendientes.delete(String(item.id));
        }
      }),
    );
  } finally {
    latido();
  }

  for (const [i, r] of resultados.entries()) {
    const item = aDespachar[i];
    if (r.status === "fulfilled" && !esRechazo(r.value)) {
      despachados.push(String(item.id));
      avisarSiNoDejoRecorrido(item, home, log);
      continue;
    }

    // UN TICKET QUE FALLA NO DETIENE EL BUCLE, Y TAMPOCO SE REINTENTA PARA
    // SIEMPRE. Son dos fallos opuestos y los dos se han visto: sin captura, un
    // solo ticket con criterios ilegibles apaga la bandeja para todos los
    // demas; sin registro, ese mismo ticket se relanza cada dos minutos y paga
    // el modelo en cada vuelta por el mismo rechazo.
    //
    // UN `ok: false` ES UN FALLO, aunque no haya lanzado. Es la convencion del
    // cableado —`comandos.mjs` devuelve `{ok: false, humano: [...]}` para "el
    // ticket no existe" y para "este nivel no se puede recorrer"— y contarlo
    // como exito es la peor de las dos mitades: el ticket no queda registrado
    // en ninguna parte y se relanza en cada vuelta, 720 veces por dia, pagando
    // cada vez lo que cueste llegar hasta el mismo rechazo.
    //
    // El motivo se deja en la memoria de la BANDEJA y no en una lista de este
    // proceso: un daemon reiniciado tiene que seguir sabiendolo, y el criterio
    // para volver a intentarlo —que el contenido del ticket cambie— ya esta
    // resuelto ahi, con la huella.
    const porque = r.status === "rejected"
      ? `el despacho fallo: ${r.reason?.message || r.reason}`
      : `el despacho no se completo: ${motivoDeRechazo(r.value)}`;
    log.error(`${item.id}: ${porque}`);
    try {
      recordarOmision(item, porque, { home });
    } catch (e) {
      // Que la memoria no se pueda escribir es peor servicio, no un motivo para
      // tumbar el daemon: el peor caso es reintentar este ticket en la vuelta
      // siguiente.
      log.warn(`no se pudo recordar la omision de ${item.id} (${e.message}): se va a reintentar`);
    }
    fallados.push({ item, porque });
  }

  return { bandeja, despachados, fallados, aplazados, enCurso, cupo };
}

/**
 * El bucle.
 *
 * @param {any} config
 * @param {{provider: any, providerCtx: any, home?: string, log?: any,
 *   despachar: (item: any, extra: any) => Promise<any>,
 *   dormir?: (ms: number, opts?: any) => Promise<void>,
 *   ahora?: () => number,
 *   signal?: AbortSignal,
 *   maxVueltas?: number}} deps
 */
export async function correrDaemon(config, deps) {
  const home = deps.home || config?.home;
  const log = deps.log || nullLogger();
  const dormir = deps.dormir || dormirPorDefecto;
  const ahora = deps.ahora || Date.now;
  const signal = deps.signal;
  const maxVueltas = deps.maxVueltas ?? Infinity;

  // Antes del lock: un daemon sin despachador no puede hacer nada, y tomar el
  // lock para despues fallar deja al siguiente esperando por nada.
  exigirDespachador(deps);

  // INSTANCIA UNICA. Dos daemons sobre la misma configuracion no producen el
  // doble de trabajo: producen dos veces el MISMO recorrido —dos ramas, dos PR
  // y dos veces el costo del modelo— porque los dos leen la misma bandeja al
  // mismo tiempo y ninguno de los dos ve el despacho del otro hasta que ya hay
  // estado en disco.
  //
  // EL SEGUNDO NO ESPERA SU TURNO. Un daemon que espera es un proceso mas que
  // nadie sabe que existe, y cuando el primero termina arrancan los dos. El
  // contrato del CLI ya lo dice para todo subcomando que escribe: informa quien
  // tiene el lock y termina con exit != 0.
  const lock = acquire(RECURSO, { home });
  if (!lock.ok) return lockTomado(lock.heldBy, log);
  if (lock.recovered) {
    log.warn(`habia un lock de daemon huerfano (su proceso ya no existe): se recupero`);
  }

  // Y SE RELEE EL ARCHIVO PARA CONFIRMAR QUE EL LOCK ES NUESTRO.
  //
  // EL FALLO QUE EVITA ESTA MEDIDO, y es el peor que puede tener este modulo:
  // dos daemons despachando el mismo ticket. `acquire` decide con un
  // `existsSync` y escribe DESPUES, asi que dos daemons que arrancan al mismo
  // tiempo ven los dos que no hay lock y los dos se lo toman. Con dos procesos
  // de verdad sobre el mismo home, **16 de 25 arranques simultaneos
  // despacharon el mismo ticket dos veces**, y los dos informaron ok.
  //
  // ESTO NO CIERRA LA VENTANA, Y ESTA MEDIDO CUANTO NO LA CIERRA: el mismo
  // experimento paso de 16 de 25 a **3 de 25**. La relectura deja sin lock al
  // que perdio el rename —ve el pid del otro y se va, que es lo que pide el
  // contrato del CLI— pero los dos pueden confirmar si el segundo rename cae
  // despues de la confirmacion del primero.
  //
  // EL ARREGLO DE FONDO NO ESTA ACA: es crear el archivo con O_EXCL (un
  // `writeFileSync` con `flag: "wx"`, que falla si ya existe) en `lock.mjs`,
  // que es donde vive el mecanismo. Amontonar esperas y reconfirmaciones en
  // este modulo produciria exactamente el verde inventado que prohibe el
  // principio II: un test que afirma que no hay carrera, sobre un mecanismo que
  // todavia la tiene. Queda declarado como hueco, no como resuelto.
  const mio = confirmarLockPropio(home);
  if (!mio.ok) {
    // `release()` compara el token antes de borrar, asi que llamarlo cuando ya
    // perdimos el lock no le saca nada al que lo tiene.
    lock.release();
    return lockTomado(mio.heldBy, log);
  }

  const intervalo = intervaloMs(config, log);
  /** @type {string[]} */ const despachados = [];
  /** @type {Array<{item: any, porque: string}>} */ const fallados = [];
  /** Las degradaciones ya dichas, para el resumen final. */
  const dichas = new Set();
  // La bitacora que ve la VUELTA, con los avisos repetidos filtrados.
  //
  // POR QUE EL FILTRO ES DEL BUCLE Y NO DE LA BANDEJA. La bandeja es una
  // pasada: decir "este gestor no sabe buscar menciones" esta bien una vez, y
  // `noxloop inbox` corre una sola vez. El que repite la misma pasada cada dos
  // minutos es este bucle, y un aviso que aparece 720 veces al dia no es un
  // aviso: es ruido en el que se pierde el que si importaba. El filtro toca
  // solo `warn` —lo que se repite igual vuelta a vuelta— y no `error`.
  const logDeVuelta = unaVezPorAviso(log);
  let vueltas = 0;
  let fallosDeConsulta = 0;
  let seguidos = 0;
  let terminadoPor = "vueltas";
  const arrancoEn = ahora();

  try {
    while (vueltas < maxVueltas) {
      if (signal?.aborted) {
        terminadoPor = "senial";
        break;
      }

      vueltas++;
      let espera = intervalo;

      try {
        const v = await unaVuelta(config, { ...deps, home, log: logDeVuelta });
        seguidos = 0;

        for (const d of v.bandeja.degradaciones) {
          if (!dichas.has(d)) dichas.add(d);
        }
        for (const id of v.despachados) despachados.push(id);
        for (const f of v.fallados) fallados.push(f);
      } catch (e) {
        if (e instanceof BandejaError && ARRANQUE_IMPOSIBLE.includes(e.codigo)) {
          // No se reintenta lo que no puede funcionar. Se lanza con la causa
          // entera para que el CLI salga con exit != 0 y alguien lo arregle.
          throw new DaemonError(
            "arranque_imposible",
            `el daemon no puede arrancar: ${e.message}`,
            e,
          );
        }

        // EL GESTOR CAIDO NO MATA AL DAEMON, PERO SE LE PREGUNTA MENOS. Un
        // gestor que devuelve 429 y un daemon que vuelve a preguntar cada dos
        // minutos exactos es un daemon que sostiene el limite de tasa que lo
        // esta frenando. Cada fallo seguido duplica la espera; el primer exito
        // la devuelve al intervalo de la configuracion.
        fallosDeConsulta++;
        seguidos++;
        log.error(`la consulta a la bandeja fallo (${seguidos} seguida/s): ${e.message}`);
        espera = intervalo * Math.min(2 ** seguidos, RETROCESO_MAXIMO);
        log.warn(`se espera ${Math.round(espera / 1000)}s antes de volver a preguntar, en vez de insistir cada ${Math.round(intervalo / 1000)}s`);
      }

      // La senial se mira DESPUES de la vuelta y antes de dormir. Antes de la
      // vuelta no alcanza: la senial llega, casi siempre, mientras un despacho
      // esta corriendo — y ese despacho ya se esperó entero arriba, asi que no
      // queda nada a medias sin registro.
      if (signal?.aborted) {
        terminadoPor = "senial";
        break;
      }
      if (vueltas >= maxVueltas) break;

      // No se duerme despues de la ultima vuelta. Dormir para despues salir
      // hace que un apagado tarde el intervalo entero, y un supervisor que
      // espera diez segundos lo mata a mitad de camino.
      await dormir(espera, { signal });
    }
  } finally {
    // EL LOCK SE LIBERA SIEMPRE, incluido el camino del error. Un lock que
    // queda tirado no bloquea para siempre —`acquire` recupera el huerfano
    // cuando el proceso ya no existe—, pero obliga a la vuelta siguiente a
    // explicar un aviso que no significa nada.
    lock.release();
  }

  const mensaje = terminadoPor === "senial"
    ? `daemon terminado por senial despues de ${vueltas} vuelta(s): ${despachados.length} despacho(s), ${fallados.length} fallo(s)`
    : `daemon terminado despues de ${vueltas} vuelta(s): ${despachados.length} despacho(s), ${fallados.length} fallo(s)`;
  log.info(mensaje);

  return {
    ok: true,
    vueltas,
    despachados,
    fallados,
    degradaciones: [...dichas],
    fallosDeConsulta,
    terminadoPor,
    duracionMs: ahora() - arrancoEn,
    humano: [mensaje],
  };
}

/**
 * Si el lock que hay en disco es de ESTE proceso.
 *
 * Usa solo la lectura publica de `lock.mjs`: `acquire` no devuelve su token, y
 * el pid alcanza para lo que se esta preguntando —dos daemons son dos
 * procesos—. Un archivo ilegible o que ya no esta tampoco es nuestro: el
 * daemon no arranca y lo dice, que es mejor que arrancar un segundo sobre la
 * misma bandeja.
 *
 * @param {string} home
 */
export function confirmarLockPropio(home) {
  const actual = inspect(RECURSO, { home });
  if (actual && !actual.unreadable && actual.pid === process.pid) return { ok: true, heldBy: actual };
  return { ok: false, heldBy: actual };
}

/** La respuesta a "ya hay un daemon": se DEVUELVE, no se lanza. Un lock tomado no es un error. */
function lockTomado(heldBy, log) {
  const quien = heldBy || {};
  const mensaje = heldBy
    ? `ya hay un daemon corriendo sobre este home: pid ${quien.pid} en ${quien.host} desde ${quien.acquiredAt}`
    : `el lock del daemon no esta donde deberia estar: alguien lo borro entre que se tomo y que se confirmo`;
  log.warn(mensaje);
  return {
    ok: false,
    codigo: "lock_tomado",
    heldBy: heldBy || null,
    vueltas: 0,
    despachados: [],
    fallados: [],
    degradaciones: [],
    fallosDeConsulta: 0,
    humano: [
      mensaje,
      `Un segundo daemon sobre la misma bandeja despacharia los mismos tickets dos veces.`,
      `Si ese proceso ya no existe, el lock se recupera solo en el arranque siguiente.`,
    ],
  };
}

/**
 * Un resultado que dice que el despacho NO ocurrio, sin haber lanzado.
 *
 * Se mira solo `ok === false`, y nunca la ausencia de `ok`: un despachador que
 * devuelve `undefined` o un objeto sin esa clave despacho igual, y exigirle una
 * forma seria inventar un contrato que este modulo no necesita.
 */
const esRechazo = (v) => !!v && typeof v === "object" && v.ok === false;

/**
 * Un despacho que volvio bien y no dejo recorrido en disco.
 *
 * EL FALLO QUE EVITA: la bandeja deduplica mirando el recorrido en disco, asi
 * que un despacho que no lo deja vuelve a entrar en cada vuelta —720 veces por
 * dia con el intervalo por defecto— y desde afuera parece que el daemon
 * trabaja. No es hipotetico: hoy el cableado devuelve `ok: true` con "todavia
 * no implementado" para el nivel de hito.
 *
 * POR QUE SE AVISA Y NO SE OMITE. Un despachador puede tener razones legitimas
 * para no dejar estado, y pararle el ticket hasta que alguien lo edite seria
 * peor que repetirlo. Lo que faltaba era decirlo.
 *
 * Un recorrido corrupto cuenta como recorrido: hay trabajo en disco aunque no
 * se pueda leer, y eso ya lo reporta la bandeja.
 */
function avisarSiNoDejoRecorrido(item, home, log) {
  let hay = true;
  try {
    hay = !!loadRun(String(item.id), { home });
  } catch {
    hay = true;
  }
  if (hay) return;
  log.warn(
    `el despacho de ${item.id} volvio sin dejar recorrido en disco: la bandeja deduplica por el recorrido, `
    + `asi que este ticket va a volver a despacharse en la vuelta siguiente`,
  );
}

/** El motivo que dio el despachador, sin resumirlo a "no se pudo". */
function motivoDeRechazo(v) {
  const humano = Array.isArray(v?.humano) ? v.humano.filter(Boolean).join(" ") : "";
  return String(v?.reason || humano || "el despachador devolvio ok:false sin decir por que").trim();
}

/**
 * El latido: mientras haya despachos en vuelo, decir que siguen en vuelo.
 *
 * EL FALLO QUE EVITA. El bucle espera los despachos de la vuelta ENTEROS —es lo
 * que sostiene el apagado limpio—, asi que un despacho colgado (una llamada al
 * modelo sin timeout, un `git` esperando una credencial que nadie va a
 * escribir) congela el daemon para siempre: no hay consulta, no hay despacho, y
 * no hay una sola linea. Desde afuera es identico a una bandeja vacia, que es
 * el modo de fallo que este modulo entero existe para matar.
 *
 * NO SE MATA EL DESPACHO, Y ES DELIBERADO. No se puede cancelar lo que ya lanzo
 * worktrees y sesiones del modelo, y abandonarlo sin esperarlo produce justo el
 * despacho en vuelo que nadie sabe que existe. Lo que se arregla aca es el
 * silencio: con el intervalo por defecto sale una linea cada dos minutos —la
 * misma frecuencia que tendria la consulta si no estuviera bloqueada—, diciendo
 * que ticket no vuelve y desde cuando.
 *
 * @returns {() => void} para apagarlo
 */
function arrancarLatido(pendientes, cadaMs, log) {
  if (!pendientes.size || !(cadaMs > 0)) return () => {};
  const t = setInterval(() => {
    if (!pendientes.size) return;
    const ahora = Date.now();
    const detalle = [...pendientes.entries()]
      .map(([id, desde]) => `${id} (${((ahora - desde) / 1000).toFixed(1)}s)`)
      .join(", ");
    log.info(
      `el despacho de ${detalle} sigue corriendo: la vuelta espera los despachos enteros antes de volver a `
      + `consultar la bandeja`,
    );
  }, cadaMs);
  // Sin `unref` un latido olvidado mantiene el proceso vivo despues de que el
  // daemon termino, y el CLI no cierra.
  t.unref?.();
  return () => clearInterval(t);
}

/**
 * Un daemon sin despachador es un bucle que lee la bandeja y no hace nada, y
 * desde afuera se ve igual que un bucle que no encuentra trabajo: vivo,
 * consultando, y sin un solo recorrido. Se dice al arrancar.
 */
function exigirDespachador(deps) {
  if (typeof deps?.despachar !== "function") {
    throw new DaemonError(
      "sin_despachador",
      "el daemon necesita `deps.despachar`: sin el, el bucle consulta la bandeja y no despacha nada, "
      + "que desde afuera es indistinguible de una bandeja vacia",
    );
  }
  return deps.despachar;
}

/**
 * El mismo `log`, pero cada aviso identico se dice una sola vez.
 *
 * Solo `warn`: un `error` que vuelve a pasar es un hecho nuevo aunque el texto
 * coincida, y `info` ya lleva datos que cambian en cada vuelta.
 */
function unaVezPorAviso(log) {
  const dichos = new Set();
  const propio = {
    info: (m, d) => log.info(m, d),
    error: (m, d) => log.error(m, d),
    warn: (m, d) => {
      const clave = String(m);
      if (dichos.has(clave)) return;
      dichos.add(clave);
      log.warn(m, d);
    },
    child: () => propio,
    file: log.file,
  };
  return propio;
}

/**
 * La espera por defecto, interrumpible por la senial.
 *
 * POR QUE MIRA LA SENIAL. Con un intervalo de dos minutos, un `setTimeout`
 * pelado hace que el daemon tarde hasta dos minutos en enterarse de un SIGTERM.
 * Un supervisor que espera diez segundos y despues manda SIGKILL lo mata
 * dormido, y ahi si queda un despacho a medias — el fallo que el apagado limpio
 * existe para evitar, producido por la propia espera.
 *
 * @param {number} ms
 * @param {{signal?: AbortSignal}} [opts]
 */
function dormirPorDefecto(ms, opts) {
  const signal = opts?.signal;
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(undefined);
    /** @type {any} */ let t;
    const fin = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", fin);
      resolve(undefined);
    };
    t = setTimeout(fin, ms);
    signal?.addEventListener("abort", fin, { once: true });
  });
}
