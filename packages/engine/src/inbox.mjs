// La bandeja: la mitad que convierte a noxloop en algo que se usa asignando un
// ticket en vez de escribiendo un comando.
//
// POR QUE ES CONSULTA PERIODICA Y NO WEBHOOKS (D8 de research.md). Un webhook
// obliga a un endpoint publico, a manejar reintentos y a verificar firmas: es
// infraestructura que quien adopta esto puede no tener, y FR-002 se satisface
// sin ella. La costura queda declarada en la interfaz del proveedor
// (`searchInbox`), sin implementar.
//
// POR QUE UNA SOLA CONSULTA POR PASADA. Las dos seniales —asignacion y
// mencion— son dos cortes de la MISMA respuesta del gestor. Pedirlas por
// separado duplica los viajes a la API para lo mismo, y con un intervalo de dos
// minutos eso es el doble de presion contra el limite de tasa, todo el dia.
//
// ESTE MODULO NO DESPACHA NADA. Devuelve que hay que despachar y quien se
// omite, con el motivo. Decidir y ejecutar es del llamador — es lo que permite
// que `noxloop inbox` (una pasada, sin ejecutar nada) y `noxloop daemon` (el
// bucle) compartan exactamente la misma lectura de la realidad.

import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { loadRun, listRuns } from "./state.mjs";
import { nullLogger } from "./log.mjs";

/**
 * El fallo de la bandeja se LANZA con su codigo, y nunca se devuelve como una
 * bandeja vacia.
 *
 * EL FALLO QUE EVITA, y es el peor de este modulo: una bandeja vacia por error
 * se lee igual que "no hay trabajo". Un daemon que recibe `{nuevos: []}` porque
 * el gestor devolvio 429 duerme el intervalo, vuelve a fallar, y se queda
 * dormido para siempre sin una sola linea que diga por que. Con un throw, el
 * llamador no puede confundir las dos cosas ni por descuido: no existe la forma
 * de la salida que signifique "fallo".
 */
export class BandejaError extends Error {
  /**
   * @param {string} codigo
   * @param {string} mensaje
   * @param {Error} [causa]
   */
  constructor(codigo, mensaje, causa) {
    super(mensaje);
    this.name = "BandejaError";
    this.codigo = codigo;
    /** @type {Error | undefined} */
    this.causa = causa;
  }
}

/** Los niveles que solo se pueden recorrer leyendo los hijos del ticket. */
const NIVELES_DE_HITO = ["epic", "feature"];
const NIVELES_CONOCIDOS = ["epic", "feature", "story", "task"];

// ------------------------------------------------------------- la memoria

// POR QUE LA MEMORIA VIVE EN EL HOME DEL MOTOR Y NO EN UN REPOSITORIO. Un
// ticket puede abarcar varios repos, y el daemon corre sin ninguno abierto: no
// hay un repositorio que sea "el" lugar. Ademas es estado del motor, no del
// codigo de nadie — dentro de un repo aparece como basura en el arbol de
// trabajo de una persona.

const memoriaFile = (home) => join(home, "inbox", "omitidos.json");

const VACIA = () => ({ schemaVersion: 1, items: /** @type {Record<string, any>} */ ({}) });

/**
 * Cuanto sobrevive una omision que dejo de aparecer en la bandeja.
 *
 * POR QUE TIENE QUE HABER UN TECHO. Sin poda, la memoria solo crece: un ticket
 * que se omitio una vez y despues se cerro deja su entrada para siempre, y el
 * archivo se lee ENTERO en cada vuelta —720 veces por dia con el intervalo por
 * defecto—. Se midio el costo del otro extremo, que es el que duele: con una
 * escritura por omision, mil omisiones en una pasada tardaron 1525ms, porque
 * cada una serializa la memoria completa; con una sola escritura al final de la
 * pasada, 11.9ms. La poda ataca el tamanio; la escritura unica, la cuadratica.
 *
 * POR QUE PODAR ES SEGURO. Solo cae la entrada de un ticket que NO aparecio en
 * la bandeja en todo ese tiempo, y un ticket que no aparece no se puede
 * despachar. El que sigue asignado se re-confirma en cada pasada —`ultimaVez`
 * avanza— y no envejece nunca.
 */
const MEMORIA_MAX_DIAS = 30;

/**
 * Escritura atomica: temporal + rename. Lo mismo que hace `state.mjs`, por la
 * misma razon — un corte a mitad no puede dejar la memoria en un JSON partido,
 * que es justo el momento en que el daemon vuelve a arrancar y la necesita.
 */
function escribirAtomico(file, datos) {
  mkdirSync(join(file, ".."), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(datos, null, 2) + "\n");
  renameSync(tmp, file);
}

/** @param {{home: string}} opts */
export function leerMemoria(opts) {
  const f = memoriaFile(opts.home);
  if (!existsSync(f)) return VACIA();
  try {
    const datos = JSON.parse(readFileSync(f, "utf8"));
    return { schemaVersion: 1, items: datos?.items && typeof datos.items === "object" ? datos.items : {} };
  } catch {
    // Una memoria ilegible se trata como vacia: el peor caso es volver a
    // reportar una omision que ya se habia reportado. Lanzar aca dejaria al
    // daemon sin arrancar por un archivo que es una ayuda, no una fuente de
    // verdad.
    return VACIA();
  }
}

/** Si esta entrada sigue valiendo, o ya es de un ticket que nadie ve hace un mes. */
function vigente(entrada, ahoraMs) {
  const t = Date.parse(entrada?.ultimaVez || entrada?.desde || "");
  // Sin fecha legible no se tira nada: la memoria es una ayuda, y perder una
  // omision cuesta un despacho de mas. Inventar que esta vieja cuesta lo mismo
  // y encima es una decision tomada sobre un dato que no se pudo leer.
  if (!Number.isFinite(t)) return true;
  return ahoraMs - t < MEMORIA_MAX_DIAS * 86_400_000;
}

/** Cuantas entradas ya no valen. Cero es lo normal. */
function cuantasVencidas(items, ahoraMs = Date.now()) {
  return Object.values(items).filter((e) => !vigente(e, ahoraMs)).length;
}

/**
 * Guarda la memoria: poda lo vencido y escribe UNA vez.
 *
 * Un archivo sin entradas se borra en vez de quedar como un `{}`: asi
 * `leerMemoria` no paga una lectura por vuelta para no encontrar nada, y el
 * home no acumula archivos que solo dicen que no hay nada.
 */
function guardarMemoria(memoria, opts) {
  const ahoraMs = Date.now();
  /** @type {Record<string, any>} */
  const items = {};
  for (const [clave, entrada] of Object.entries(memoria.items)) {
    if (vigente(entrada, ahoraMs)) items[clave] = entrada;
  }
  const f = memoriaFile(opts.home);
  if (Object.keys(items).length === 0) {
    try {
      unlinkSync(f);
    } catch { /* no estaba: nada que borrar */ }
    return { schemaVersion: 1, items };
  }
  escribirAtomico(f, { schemaVersion: 1, items });
  return { schemaVersion: 1, items };
}

/**
 * La entrada que corresponde a una omision, sin tocar el disco.
 *
 * Se separo del `recordarOmision` que escribe porque una pasada omite N
 * tickets: con la escritura adentro, N omisiones son N serializaciones de la
 * memoria entera —1525ms medidos con mil— y el costo crece con el cuadrado.
 */
/**
 * DOS CLASES DE OMISION, y confundirlas es el hueco que esto cierra.
 *
 *   `permanente`  el planificador rechazo el ticket: no tiene criterios de
 *                 aceptacion verificables. Reintentar sin que el ticket cambie
 *                 es pagar el modelo para llegar al mismo rechazo, cada dos
 *                 minutos, para siempre.
 *   `transitorio` el gestor contesto 502, la red no estaba, el disco estaba
 *                 lleno. El ticket esta bien; lo que fallo fue el mundo, y
 *                 reintentar es exactamente lo que hay que hacer.
 *
 * Antes las dos se trataban igual, y un 502 a mitad de un despacho dejaba el
 * ticket parado hasta que alguien le cambiara el titulo.
 */
const ESPERA_BASE_MS = 5 * 60_000;

/**
 * Techo de la espera. Sin techo, al octavo reintento la espera son semanas y el
 * ticket queda parado sin que nadie lo haya decidido. Con techo, el daemon
 * sigue mirandolo cada tanto y el operador ve el motivo en cada vuelta.
 */
const ESPERA_MAXIMA_MS = 6 * 3600_000;

function esperaDe(vueltas, esperaMs) {
  if (esperaMs) return Math.min(esperaMs, ESPERA_MAXIMA_MS);
  // Crece con los reintentos: martillar al gestor cada dos minutos mientras
  // esta caido es parte del problema, no del arreglo.
  return Math.min(ESPERA_BASE_MS * 2 ** Math.max(0, vueltas - 1), ESPERA_MAXIMA_MS);
}

function entradaDeOmision(previo, huella, motivo, ahora, opciones = {}) {
  const mismo = previo && previo.huella === huella;
  // Sin clase explicita se CONSERVA la del previo. Reponerla a "permanente"
  // convertia el refresco de cada vuelta en un cambio de clase silencioso: la
  // entrada perdia su `reintentarDespues` y un fallo transitorio se volvia un
  // rechazo definitivo en la primera pasada que lo mirara.
  const clase = opciones.clase
    ? (opciones.clase === "transitorio" ? "transitorio" : "permanente")
    : (mismo && previo.clase === "transitorio" ? "transitorio" : "permanente");
  const vueltas = mismo ? (previo.vueltas || 1) + 1 : 1;

  const base = mismo
    ? { ...previo, porque: motivo, ultimaVez: ahora, vueltas }
    : { huella, porque: motivo, desde: ahora, ultimaVez: ahora, vueltas };

  if (clase !== "transitorio") {
    const { reintentarDespues, ...sinEspera } = base;
    return { ...sinEspera, clase: "permanente" };
  }

  // Si ya hay una espera corriendo y este es el mismo ticket, se conserva: cada
  // pasada de la bandeja "vuelve a ver" la omision, y recalcular la espera en
  // cada vista la correria para adelante para siempre — el ticket nunca se
  // reintentaria.
  if (mismo && !opciones.clase && previo.reintentarDespues) {
    return { ...base, clase: "transitorio", esperaMs: previo.esperaMs, reintentarDespues: previo.reintentarDespues };
  }

  const espera = esperaDe(vueltas, opciones.esperaMs);
  return {
    ...base,
    clase: "transitorio",
    esperaMs: espera,
    reintentarDespues: new Date(Date.parse(ahora) + espera).toISOString(),
  };
}

/**
 * La huella de un ticket: QUE tiene que cambiar para que valga la pena volver a
 * mirarlo.
 *
 * POR QUE NO ES EL RELOJ DEL GESTOR. `updatedAt` se mueve con cualquier cosa
 * —un comentario, un cambio de iteracion, alguien que lo arrastra en el
 * tablero— asi que usarlo como huella devuelve al bucle que esta memoria
 * existe para cortar: se omite el ticket, alguien comenta "y esto?", el reloj
 * avanza, y el daemon lo vuelve a intentar y a fallar por lo mismo. Al revos
 * tambien falla: hay gestores que no exponen un reloj por item, y entonces la
 * huella no distinguiria nada.
 *
 * Lo que entra es lo que el recorrido lee para decidir: titulo, descripcion,
 * criterios, nivel, estado canonico, padre, etiquetas y responsable. Agregarle
 * los criterios de aceptacion que le faltaban cambia la huella, y el ticket
 * vuelve a entrar solo. `raw` queda AFUERA a proposito: es el payload nativo
 * entero, con relojes y contadores adentro.
 *
 * @param {any} item
 * @returns {string}
 */
export function huellaDeItem(item) {
  const partes = {
    id: String(item?.id ?? ""),
    level: item?.level ?? null,
    title: item?.title ?? "",
    body: item?.body ?? "",
    acceptance: Array.isArray(item?.acceptance) ? item.acceptance.map(String) : [],
    canonicalState: item?.canonicalState ?? null,
    parentId: item?.parentId ?? null,
    labels: Array.isArray(item?.labels) ? [...item.labels].map(String).sort() : [],
    assignee: item?.assignee ?? null,
  };
  return createHash("sha1").update(JSON.stringify(partes)).digest("hex").slice(0, 16);
}

/**
 * Registra —o vuelve a confirmar— que un ticket se omitio, con su motivo.
 *
 * Lo llama la bandeja para lo que ella misma omite, y lo llama el despachador
 * para lo que se cae despues: un plan que el planificador rechaza por falta de
 * criterios observables tambien tiene que quedar recordado, o el daemon lo
 * vuelve a lanzar en la vuelta siguiente y paga el modelo de nuevo por el
 * mismo rechazo.
 *
 * `vueltas` cuenta cuantas pasadas lo vieron igual. Es lo que permite
 * reportarlo la primera vez y callarlo despues sin dejar de saberlo.
 *
 * @param {any} item
 * @param {string} porque
 * @param {{home: string, clase?: "permanente"|"transitorio", esperaMs?: number, ahora?: () => number}} opts
 */
export function recordarOmision(item, porque, opts) {
  const motivo = String(porque || "").trim();
  // Un motivo vacio convierte la memoria en un "no, porque no": la proxima
  // persona que mire no sabe si arreglar el ticket o el motor.
  if (!motivo) throw new BandejaError("sin_motivo", `omitir ${item?.id} exige decir por que`);

  const clave = String(item.id);
  const memoria = leerMemoria(opts);
  const ahora = new Date(opts.ahora ? opts.ahora() : Date.now()).toISOString();
  const entrada = entradaDeOmision(
    memoria.items[clave],
    huellaDeItem(item),
    motivo,
    ahora,
    { clase: opts.clase, esperaMs: opts.esperaMs },
  );

  memoria.items[clave] = entrada;
  guardarMemoria(memoria, opts);
  return entrada;
}

/**
 * Olvida lo recordado de un ticket, para que pueda volver a entrar.
 *
 * Se llama en los dos casos en que el motivo viejo ya no describe la realidad:
 * el ticket cambio, o alguien lo despacho a mano y ahora tiene recorrido.
 *
 * @param {string} itemId
 * @param {{home: string}} opts
 */
export function olvidar(itemId, opts) {
  const memoria = leerMemoria(opts);
  const clave = String(itemId);
  if (!(clave in memoria.items)) return false;
  delete memoria.items[clave];
  guardarMemoria(memoria, opts);
  return true;
}

// ------------------------------------------------------ lo que ya esta en curso

/**
 * El estado de un recorrido, en una palabra, para poder decir por que un ticket
 * de la bandeja no se vuelve a despachar.
 *
 * SE EXPORTA PARA QUE EL DAEMON CUENTE EL CUPO CON ESTA MISMA DEFINICION. Con
 * dos definiciones de "en curso" —una aca y otra en `daemon.mjs`— el desacuerdo
 * no se ve desde afuera: la bandeja reporta el recorrido como en curso, el
 * daemon cuenta su lugar como libre, y despacha por encima de
 * `limits.maxParallelItems` sin que nada lo delate.
 *
 * @param {any} run
 */
export function estadoDeRecorrido(run) {
  // Asi marca `listRuns` al recorrido que no pudo parsear. Es una cuarta
  // respuesta y no un "en curso": hay trabajo en disco, pero no hay nada
  // corriendo.
  if (run?.corrupto) return "corrupto";
  const estados = (run?.tasks || []).map((/** @type {any} */ t) => t.status);
  if (estados.length && estados.every((/** @type {string} */ s) => s === "integrated")) return "integrado";
  if (estados.length && estados.includes("blocked")
      && estados.every((/** @type {string} */ s) => s === "blocked" || s === "integrated")) return "bloqueado";
  return "en_curso";
}

/**
 * Indice de los tickets que YA son una tarea de algun recorrido.
 *
 * EL FALLO QUE EVITA, y es propio de este motor y no de ningun gestor:
 * `createChild` materializa las tareas del plan como tickets hijos, y esos
 * hijos heredan campos de tablero —responsable incluido—. En la vuelta
 * siguiente el daemon los ve en la bandeja como trabajo asignado y arranca un
 * recorrido por cada tarea del recorrido que ya esta corriendo: una rama y un
 * PR por tarea, sobre trabajo que ya tiene los suyos. Deduplicar por el id del
 * ticket de nivel superior no alcanza, porque el id del hijo es otro.
 *
 * Se arma con `listRuns` —una sola lectura del directorio— y no con un
 * `loadRun` por ticket: aca no se sabe a que recorrido pertenece cada uno, que
 * es justamente lo que se esta buscando.
 *
 * @param {{home: string}} opts
 */
function indiceDeTareas(opts) {
  /** @type {Map<string, {recorrido: string, tarea: string, run: any}>} */
  const porTicket = new Map();
  for (const run of listRuns(opts)) {
    for (const t of run?.tasks || []) {
      if (!t?.providerItemId) continue;
      porTicket.set(String(t.providerItemId), { recorrido: String(run?.item?.id ?? ""), tarea: t.id, run });
    }
  }
  return porTicket;
}

// ---------------------------------------------------------------- la pasada

/**
 * Una pasada de la bandeja. Consulta al gestor UNA vez y devuelve lo que hay
 * que despachar, lo que ya esta en curso y lo que se omite con su motivo.
 *
 * @param {any} config la configuracion validada (de aca sale `home`)
 * @param {{provider: any, providerCtx: any, home?: string, log?: any, ahora?: () => number}} deps
 * @returns {Promise<{nuevos: any[], vistos: any[], omitidos: Array<{item: any, porque: string}>, degradaciones: string[]}>}
 */
export async function revisarBandeja(config, deps) {
  const home = deps.home || config?.home;
  if (!home) throw new BandejaError("sin_home", "la bandeja necesita el home del motor: el estado vive en disco, fuera de los repos");
  const log = deps.log || nullLogger();
  const { provider, providerCtx } = deps;
  const gestor = provider?.meta?.name || "desconocido";
  const caps = provider.capabilities();

  /** @type {string[]} */
  const degradaciones = [];

  // LAS DOS BUSQUEDAS EN FALSE NO ES UNA DEGRADACION: ES UN ARRANQUE IMPOSIBLE.
  // Con las dos apagadas no hay nada que pueda disparar un recorrido, y la
  // unica salida honesta es decirlo ahora. Devolver una bandeja vacia cada dos
  // minutos es la version silenciosa del mismo error, y la peor: parece que
  // funciona.
  if (!caps.searchAssigned && !caps.searchMentioned) {
    throw new BandejaError(
      "sin_disparo",
      `el gestor "${gestor}" declara searchAssigned y searchMentioned en false: no tiene ninguna forma de detectar trabajo nuevo, `
      + `asi que el modo daemon no arranca. Se dice al validar, y no con una bandeja vacia en cada vuelta.`,
    );
  }
  if (typeof provider.searchInbox !== "function") {
    throw new BandejaError(
      "proveedor_incompleto",
      `el gestor "${gestor}" declara una busqueda de bandeja en true pero no exporta searchInbox`,
    );
  }

  // Con una sola de las dos, la bandeja funciona con esa. La degradacion se
  // DECLARA: un disparo que no existe y nadie nombro se vive como "noxloop no
  // me contesta cuando lo menciono".
  if (!caps.searchMentioned) {
    const d = `el gestor "${gestor}" no sabe buscar menciones (searchMentioned en false): el disparo por mencion queda desactivado y la bandeja anda solo con las asignaciones`;
    degradaciones.push(d);
    log.warn(d);
  }
  if (!caps.searchAssigned) {
    const d = `el gestor "${gestor}" no sabe buscar asignaciones (searchAssigned en false): el disparo por asignacion queda desactivado y la bandeja anda solo con las menciones`;
    degradaciones.push(d);
    log.warn(d);
  }

  let crudo;
  try {
    crudo = await provider.searchInbox(providerCtx);
  } catch (e) {
    const mensaje = `no se pudo consultar la bandeja del gestor "${gestor}": ${e.message}`;
    log.error(mensaje);
    // La causa real viaja entera. Resumirla a "no se pudo" es lo que convierte
    // un limite de tasa en una hora de mirar el codigo del proveedor.
    throw new BandejaError("consulta_fallida", mensaje, e);
  }

  // LA FORMA DE LA RESPUESTA SE VERIFICA, y una forma equivocada es un FALLO.
  //
  // EL FALLO QUE EVITA es el mismo que el 429 leido como "no hay trabajo",
  // entrando por otra puerta: un `searchInbox` que devuelve `undefined`, una
  // lista pelada o las claves con otro nombre deja `crudo?.assigned` en
  // undefined, y con un `Array.isArray(...) ? ... : []` eso se lee como una
  // bandeja vacia. El daemon duerme el intervalo, vuelve a leer vacio, y se
  // queda callado para siempre: proceso vivo, bitacora con lineas, cero
  // recorridos. Es un error de codigo del proveedor y se dice como tal.
  //
  // Solo se exige la mitad DECLARADA: un gestor con `searchMentioned` en false
  // no tiene por que devolver la clave, y exigirsela seria rechazar a un
  // proveedor honesto que declara poco — lo contrario de lo que pide la tabla
  // de degradacion.
  const SENIALES = [["assigned", caps.searchAssigned], ["mentioned", caps.searchMentioned]];
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) {
    throw new BandejaError(
      "respuesta_invalida",
      `el gestor "${gestor}" devolvio ${Array.isArray(crudo) ? "una lista" : JSON.stringify(crudo) ?? typeof crudo} `
      + `desde searchInbox, y el contrato dice {assigned, mentioned}. Una respuesta con otra forma se leeria como `
      + `"no hay trabajo" en cada vuelta, para siempre.`,
    );
  }
  for (const [senial, declarada] of SENIALES) {
    if (declarada && !Array.isArray(crudo[senial])) {
      throw new BandejaError(
        "respuesta_invalida",
        `el gestor "${gestor}" declara search${senial === "assigned" ? "Assigned" : "Mentioned"} en true pero su `
        + `searchInbox no devolvio una lista en "${senial}" (vino ${typeof crudo[senial]}). Sin eso, ese disparo `
        + `nunca dispararia nada y no habria una sola linea que lo dijera.`,
      );
    }
  }

  // DEDUPLICACION POR TICKET (FR-002). Un ticket asignado Y mencionado produce
  // UN recorrido: dos recorridos sobre el mismo ticket son dos ramas, dos PR y
  // dos veces el costo del modelo para el mismo trabajo.
  //
  // La clave es el id CANONICO como string, no el crudo: si el gestor manda el
  // mismo id como numero en una senial y como string en la otra, un Map con el
  // crudo las cuenta como dos tickets distintos y la deduplicacion no ocurre.
  //
  // Y EL ITEM SE LLEVA ESE MISMO ID CANONICO. Deduplicar por una clave y
  // despachar con otra deja al motor buscando `run-7.json` para un recorrido
  // que se escribio como `run- 7.json`: la bandeja cree que hay uno y el disco
  // tiene otro. Lo que se despacha y lo que se guarda tienen que ser el mismo
  // string.
  /** @type {Map<string, {item: any, disparos: string[]}>} */
  const porTicket = new Map();
  for (const [senial, lista] of [["assigned", crudo.assigned], ["mentioned", crudo.mentioned]]) {
    for (const item of Array.isArray(lista) ? lista : []) {
      const clave = String(item?.id ?? "").trim();
      // Un id vacio o en blanco NO es un id. Pasa el chequeo de null y llega
      // hasta el despacho, donde el estado del recorrido seria `run-.json` —un
      // nombre que `listRuns` no reconoce, porque su patron exige al menos un
      // caracter—: el recorrido existiria en disco y la bandeja no lo
      // encontraria nunca, asi que el ticket se despacharia otra vez en cada
      // vuelta. Una senial sin ticket detras, en cambio, es normal: el
      // proveedor devuelve null cuando el ticket ya no existe, y eso es una
      // respuesta, no un fallo.
      if (!item || !clave) {
        log.warn(`el gestor "${gestor}" devolvio una senial de ${senial} sin ticket detras (id: ${JSON.stringify(item?.id)}); se ignora`);
        continue;
      }
      const ya = porTicket.get(clave);
      if (ya) {
        if (!ya.disparos.includes(String(senial))) ya.disparos.push(String(senial));
        continue;
      }
      porTicket.set(clave, {
        item: item.id === clave ? item : { ...item, id: clave },
        disparos: [String(senial)],
      });
    }
  }

  const tareasAjenas = indiceDeTareas({ home });
  const memoria = leerMemoria({ home });

  // LA MEMORIA SE ESCRIBE UNA VEZ POR PASADA, al final, y no una vez por
  // ticket. Con una escritura por omision la memoria entera se serializa en
  // cada una: mil tickets omitidos tardaron 1525ms medidos, y el costo crece
  // con el cuadrado porque cada escritura incluye lo que escribieron las
  // anteriores. `sucia` es lo que evita reescribir el archivo en las pasadas
  // —la mayoria— en que no cambio nada.
  let sucia = false;

  /** @type {any[]} */ const nuevos = [];
  /** @type {any[]} */ const vistos = [];
  /** @type {any[]} */ const omitidos = [];

  for (const { item, disparos } of porTicket.values()) {
    const clave = String(item.id);

    // 1. Su propio recorrido. Un ticket con recorrido NO se vuelve a despachar:
    //    `run` no replanifica, y despachar de nuevo pisaria el avance.
    let run = null;
    let corrupto = false;
    try {
      run = loadRun(clave, { home });
    } catch (e) {
      // Un recorrido corrupto significa que HAY trabajo en disco, aunque no se
      // pueda leer. Tratarlo como inexistente seria replanificar encima, que es
      // peor que el corte que lo dejo asi.
      corrupto = true;
      log.warn(`el recorrido de ${clave} no se puede leer (${e.message}); no se despacha`);
    }
    if (corrupto || run) {
      const estado = corrupto ? "corrupto" : estadoDeRecorrido(run);
      vistos.push({
        item,
        disparos,
        estado,
        recorrido: clave,
        porque: corrupto
          ? `ya tiene un recorrido en disco, y su archivo esta corrupto: hay que mirarlo a mano`
          : `ya tiene recorrido (${estado}); noxloop status ${clave} lo cuenta`,
        tareas: corrupto ? null : resumenDeTareas(run),
      });
      if (memoria.items[clave]) {
        delete memoria.items[clave];
        sucia = true;
      }
      continue;
    }

    // 2. Ya es una tarea de otro recorrido: el motor mismo lo creo.
    const ajena = tareasAjenas.get(clave);
    if (ajena) {
      vistos.push({
        item,
        disparos,
        estado: estadoDeRecorrido(ajena.run),
        recorrido: ajena.recorrido,
        porque: `es la tarea ${ajena.tarea} del recorrido ${ajena.recorrido}: lo despacha ese recorrido, no la bandeja`,
        tareas: resumenDeTareas(ajena.run),
      });
      if (memoria.items[clave]) {
        delete memoria.items[clave];
        sucia = true;
      }
      continue;
    }

    // 3. Un nivel que el gestor no puede recorrer. Se dice AL DESPACHAR y no a
    //    mitad del recorrido, que es donde aparecia: el hito arrancaba, pedia
    //    los hijos, y moria con un NotSupportedError sin haber hecho nada.
    const motivo = motivoDeNivel(item, caps, gestor);
    if (motivo) {
      omitidos.push(recordarYReportar(item, motivo, memoria, log, disparos));
      sucia = true;
      continue;
    }

    // 4. La memoria de lo ya omitido. Mientras el ticket siga IGUAL al que se
    //    omitio, no se reintenta: es lo que evita que el daemon vuelva a
    //    lanzar cada dos minutos un ticket que ya rechazo, pagando el modelo
    //    cada vez.
    const recordado = memoria.items[clave];
    const ahoraMs = deps.ahora ? deps.ahora() : Date.now();

    if (recordado && recordado.huella === huellaDeItem(item)) {
      // Un TRANSITORIO cuya espera ya paso vuelve a entrar sin que el ticket
      // haya cambiado: lo que fallo fue el mundo, no el ticket, y el mundo se
      // arregla solo mas seguido que un criterio de aceptacion.
      const vencio =
        recordado.clase === "transitorio" &&
        recordado.reintentarDespues &&
        ahoraMs >= Date.parse(recordado.reintentarDespues);

      if (!vencio) {
        const detalle = recordado.clase === "transitorio"
          ? `${recordado.porque} (fallo transitorio; se reintenta despues de ${recordado.reintentarDespues})`
          : recordado.porque;
        omitidos.push(recordarYReportar(item, detalle, memoria, log, disparos));
        sucia = true;
        continue;
      }
      log.info(`${clave} vuelve a entrar: su espera por "${recordado.porque}" ya paso`);
      delete memoria.items[clave];
      sucia = true;
      nuevos.push({ ...item, disparos });
      continue;
    }
    if (recordado) {
      // Cambio desde que se omitio —los criterios que le faltaban, por
      // ejemplo—: vuelve a entrar, y el motivo viejo se olvida para que su
      // cuenta de vueltas arranque de cero si vuelve a caer.
      log.info(`${clave} cambio desde que se omitio ("${recordado.porque}"): vuelve a entrar`);
      delete memoria.items[clave];
      sucia = true;
    }

    nuevos.push({ ...item, disparos });
  }

  // Tambien se escribe si solo hay que podar: una memoria que dejo de cambiar
  // no tiene por que quedar creciendo hasta la proxima omision.
  if (sucia || cuantasVencidas(memoria.items)) guardarMemoria(memoria, { home });

  return { nuevos, vistos, omitidos, degradaciones };
}

/** @param {any} run */
function resumenDeTareas(run) {
  const estados = (run?.tasks || []).map((/** @type {any} */ t) => t.status);
  return {
    total: estados.length,
    integradas: estados.filter((/** @type {string} */ s) => s === "integrated").length,
    bloqueadas: estados.filter((/** @type {string} */ s) => s === "blocked").length,
  };
}

/**
 * Deja el motivo en la memoria EN MEMORIA y devuelve la entrada de `omitidos`.
 *
 * No escribe: la pasada escribe una sola vez al final. Es la misma cuenta que
 * `recordarOmision` —la unica diferencia es quien toca el disco— y por eso las
 * dos salen de `entradaDeOmision`: con la cuenta duplicada, `vueltas` avanzaria
 * distinto segun quien omitiera, y "la primera vez es noticia" dejaria de ser
 * cierto para la mitad de los casos.
 *
 * `yaSabido` es lo unico que el llamador necesita para no volverse ruido: la
 * primera vuelta lo reporta, las siguientes lo saben sin decirlo.
 */
function recordarYReportar(item, porque, memoria, log, disparos) {
  const motivo = String(porque || "").trim();
  if (!motivo) throw new BandejaError("sin_motivo", `omitir ${item?.id} exige decir por que`);

  const clave = String(item.id);
  const entrada = entradaDeOmision(
    memoria.items[clave],
    huellaDeItem(item),
    motivo,
    new Date().toISOString(),
  );
  memoria.items[clave] = entrada;
  const yaSabido = (entrada.vueltas || 1) > 1;
  if (!yaSabido) log.warn(`${item.id} se omite: ${entrada.porque}`);
  return {
    item,
    disparos,
    porque: entrada.porque,
    yaSabido,
    vueltas: entrada.vueltas,
    desde: entrada.desde,
    huella: entrada.huella,
  };
}

/**
 * El motivo por el que este nivel no se puede recorrer con este gestor, o null.
 *
 * EL NIVEL NO SE COMPARA POR EL NOMBRE DEL TIPO: lo resuelve el proveedor con
 * su mapa, y aca ya llega canonico. Un despachador que compare contra "User
 * Story" funciona en una plantilla y no hace nada en otra, sin error y sin
 * aviso.
 *
 * @param {any} item
 * @param {any} caps
 * @param {string} gestor
 */
function motivoDeNivel(item, caps, gestor) {
  if (!NIVELES_CONOCIDOS.includes(item.level)) {
    return `el gestor "${gestor}" resolvio el nivel "${item.level}", que el motor no conoce (${NIVELES_CONOCIDOS.join(", ")})`;
  }
  if (NIVELES_DE_HITO.includes(item.level) && !caps.children) {
    return `es de nivel "${item.level}" y eso se recorre como hito, pero el gestor "${gestor}" no sabe leer hijos `
      + `(capabilities().children en false): sin los hijos no hay hito que recorrer`;
  }
  return null;
}
