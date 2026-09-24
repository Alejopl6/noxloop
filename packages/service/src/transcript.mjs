// `GET /v1/runs/:itemId/tasks/:taskId/transcript` — lo que el agente fue
// diciendo y haciendo en cada fase, y el evento `run.transcript` cuando crece
// (spec 004, US2, FR-005).
//
// -----------------------------------------------------------------------------
// SOLO LECTURA (principio VIII)
// -----------------------------------------------------------------------------
//
// El transcript lo escribe el MOTOR (`packages/engine/src/transcript.mjs`),
// redactado antes de tocar disco. Este modulo lee archivos y los proyecta: no
// crea directorios, no repara lineas, no reescribe el resumen de tokens. Y no
// importa el motor —por lo mismo que `runs.mjs`: el import de algo que escribe
// invita a llamarlo—; lo que comparte con el son los NOMBRES de archivo, y una
// prueba escribe con el motor y lee con esto para que no se separen.
//
// -----------------------------------------------------------------------------
// PAGINADO, Y LO CORTADO SE DICE
// -----------------------------------------------------------------------------
//
// Una fase larga deja miles de lineas. Se devuelve un tramo —`desde` (linea,
// base 0) y `limite`— y cada fase dice `siguiente` (desde donde pedir lo que
// sigue) y `cortado` (si ya hay mas de lo que se devolvio). La interfaz pide
// con `desde=siguiente` cuando llega `run.transcript`, y solo recibe lo nuevo.
//
// -----------------------------------------------------------------------------
// EL EVENTO SE SACA SONDEANDO EL DISCO, COMO EL LANZADOR
// -----------------------------------------------------------------------------
//
// El motor es otro proceso y no le habla al servicio. Igual que el lanzador
// mira el archivo del run para avisar del cambio de fase, aqui se mira el
// tamaño de cada transcript cada segundo y se emite `run.transcript` cuando
// crece: SC-002 pide menos de tres segundos desde que el agente dice algo
// hasta que se ve, y un segundo de sondeo mas un viaje del canal caben. Solo
// se sondea mientras hay algo que mirar: se arma al lanzar un run o al abrir
// un transcript, y se apaga solo tras un rato sin crecer y sin runs en vuelo.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { noEsta } from "./comun.mjs";
import { ErrorDeServicio } from "./errores.mjs";
import { leerRun } from "./lanzador.mjs";
import { EN_VUELO } from "./estado-del-run.mjs";
import { SIN_MEDIR, resumenDeTokens, sumarResumenes } from "../../adapters/src/eventos.mjs";

/** Lo que se devuelve por fase si no se pide otra cosa. */
export const LIMITE_POR_DEFECTO = 200;
/** Lo maximo que se devuelve por fase en una peticion: una ventana no pinta mas. */
export const LIMITE_MAXIMO = 1000;

/**
 * El mismo saneado que usa el motor para nombrar el archivo. Duplicado a
 * proposito (ver la cabecera); `transcript.test.mjs` del servicio escribe con
 * el motor y lee con esto, y se separarian ahi.
 *
 * @param {unknown} s
 */
const segmento = (s) => String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "_") || "_";

/** @param {string} home @param {string} itemId */
const directorioDe = (home, itemId) => join(home, "runs", segmento(itemId), "transcripts");

/**
 * Fase y lente a partir del resto del nombre (`GREEN`, `REVIEW-seguridad`,
 * `REVIEW-SINTESIS`). Las fases van en MAYUSCULAS y las lentes en minusculas:
 * es lo que distingue `REVIEW-SINTESIS` (una fase) de `REVIEW-seguridad` (una
 * lente de REVIEW) sin un separador mas.
 *
 * @param {string} resto
 */
function faseYLente(resto) {
  const m = /^(.+)-([a-z0-9_]+)$/.exec(resto);
  return m ? { fase: m[1], lente: m[2] } : { fase: resto, lente: null };
}

/**
 * Las lineas COMPLETAS de un archivo. La ultima sin salto de linea es una
 * escritura a medias del motor: se ignora ahora y se lee en la siguiente
 * peticion, entera. Una linea que no parsea tambien se salta, pero CUENTA: si
 * no contara, `siguiente` se correria y la interfaz pediria dos veces lo mismo.
 *
 * @param {string} ruta
 */
function lineasDe(ruta) {
  const texto = readFileSync(ruta, "utf8");
  const partes = texto.split("\n");
  partes.pop(); // lo que hay despues del ultimo salto: nada, o una linea a medias
  return partes.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  });
}

/**
 * El resumen de tokens de una fase: el del motor (que suma intentos) si ya
 * cerro alguna vez; si no, el de los eventos que hay.
 *
 * @param {string} ruta
 * @param {any[]} eventos
 */
function tokensDe(ruta, eventos) {
  const archivo = ruta.replace(/\.jsonl$/, ".tokens.json");
  if (existsSync(archivo)) {
    try {
      const t = JSON.parse(readFileSync(archivo, "utf8"));
      return {
        medido: t.medido === true,
        entrada: t.entrada ?? null,
        salida: t.salida ?? null,
        cacheLectura: t.cacheLectura ?? null,
        cacheEscritura: t.cacheEscritura ?? null,
      };
    } catch {
      /* ilegible: se recalcula de los eventos */
    }
  }
  return resumenDeTokens(eventos.filter(Boolean));
}

/**
 * Un parametro entero no negativo de la query, o el 400 que dice como va.
 *
 * @param {URL} url
 * @param {string} nombre
 * @param {number} porDefecto
 */
function entero(url, nombre, porDefecto) {
  const crudo = url.searchParams.get(nombre);
  if (crudo === null || crudo === "") return porDefecto;
  if (!/^\d+$/.test(crudo)) {
    throw new ErrorDeServicio("parametro_invalido", {
      parametro: nombre,
      valor: crudo,
      opciones: ["un entero mayor o igual que 0"],
    });
  }
  return Number(crudo);
}

/**
 * Los archivos de transcript de una tarea, con su fase y su lente.
 *
 * @param {string} home
 * @param {string} itemId
 * @param {string} taskId
 */
export function archivosDeTarea(home, itemId, taskId) {
  const dir = directorioDe(home, itemId);
  if (!existsSync(dir)) return [];
  const prefijo = `${segmento(taskId)}-`;
  return readdirSync(dir)
    .filter((n) => n.startsWith(prefijo) && n.endsWith(".jsonl"))
    .map((n) => ({ ruta: join(dir, n), ...faseYLente(n.slice(prefijo.length, -".jsonl".length)) }));
}

/**
 * El transcript de una tarea, por fases, paginado. Solo lee.
 *
 * @param {string} home
 * @param {string} itemId
 * @param {string} taskId
 * @param {{fase?: string|null, lente?: string|null, desde?: number, limite?: number}} [opts]
 */
export function leerTranscript(home, itemId, taskId, opts = {}) {
  const desde = opts.desde ?? 0;
  const limite = Math.min(Math.max(1, opts.limite ?? LIMITE_POR_DEFECTO), LIMITE_MAXIMO);

  const fases = archivosDeTarea(home, itemId, taskId)
    .filter((a) => !opts.fase || a.fase === opts.fase)
    .filter((a) => !opts.lente || a.lente === opts.lente)
    .map((a) => {
      let lineas;
      try {
        lineas = lineasDe(a.ruta);
      } catch {
        // Un archivo que desaparece entre listar y leer (o sin permisos) no
        // tumba la respuesta: se dice que esa fase no se pudo leer.
        lineas = [];
      }
      const tramo = lineas.slice(desde, desde + limite);
      const siguiente = Math.min(lineas.length, desde + tramo.length);
      return {
        fase: a.fase,
        ...(a.lente ? { lente: a.lente } : {}),
        eventos: tramo.filter(Boolean),
        tokens: tokensDe(a.ruta, lineas),
        total: lineas.length,
        desde,
        siguiente,
        cortado: siguiente < lineas.length,
        // El instante del primer evento: ordena las fases como ocurrieron.
        empezo: lineas.find(Boolean)?.t ?? null,
      };
    })
    .sort((x, y) => String(x.empezo ?? "").localeCompare(String(y.empezo ?? "")));

  const total = fases.length ? fases.map((f) => f.tokens).reduce((a, b) => sumarResumenes(a, b)) : { ...SIN_MEDIR };
  return { fases, total };
}

/**
 * `GET /v1/runs/:id/tasks/:taskId/transcript?fase=&lente=&desde=&limite=`
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function transcriptDeTarea(p) {
  const itemId = p.parametros.id;
  const taskId = p.parametros.taskId;
  const run = leerRun(p.estado.home, itemId);
  if (!run) throw noEsta("run", itemId, "`GET /v1/runs`");
  // La planificacion no es una tarea del plan —las tareas nacen de ella— y su
  // transcript se pide por su nombre, `plan:<item>`.
  const esPlan = taskId === `plan:${itemId}`;
  const tarea = (Array.isArray(run.tasks) ? run.tasks : []).find((/** @type {any} */ t) => t && t.id === taskId);
  if (!tarea && !esPlan) throw noEsta("tarea", taskId, `\`GET /v1/runs/${itemId}\``, `el run ${itemId}`);

  const desde = entero(p.url, "desde", 0);
  const limite = entero(p.url, "limite", LIMITE_POR_DEFECTO);
  const { fases, total } = leerTranscript(p.estado.home, itemId, taskId, {
    fase: p.url.searchParams.get("fase") || null,
    lente: p.url.searchParams.get("lente") || null,
    desde,
    limite,
  });

  // Se arma el sondeo: quien lee un transcript es quien quiere verlo crecer.
  vigilarTranscripts(p.estado);

  return {
    cuerpo: {
      itemId: String(itemId),
      tareaId: String(taskId),
      fases: fases.map(({ empezo: _empezo, ...f }) => f),
      total,
      limite: Math.min(Math.max(1, limite), LIMITE_MAXIMO),
    },
  };
}

// ---------------------------------------------------------------------------
// El sondeo: `run.transcript` cuando un archivo crece
// ---------------------------------------------------------------------------

/** Un sondeo por servidor: dos ventanas abiertas no duplican el trabajo. */
const sondeos = new WeakMap();

/**
 * La tarea y la fase de un archivo, casando su nombre con las tareas del run.
 * Solo el run sabe el taskId sin sanear; si no casa, no se emite (un evento
 * con una tarea inventada mandaria a la interfaz a pedir algo que no existe).
 *
 * @param {any} run
 * @param {string} itemId
 * @param {string} nombre
 */
function deQuienEs(run, itemId, nombre) {
  const candidatos = [
    ...(Array.isArray(run?.tasks) ? run.tasks.map((/** @type {any} */ t) => String(t?.id ?? "")) : []),
    `plan:${itemId}`,
  ].filter(Boolean);
  // El prefijo mas largo primero: `T001` no puede quedarse lo de `T0011`.
  for (const taskId of candidatos.sort((a, b) => b.length - a.length)) {
    const prefijo = `${segmento(taskId)}-`;
    if (nombre.startsWith(prefijo)) return { taskId, ...faseYLente(nombre.slice(prefijo.length, -".jsonl".length)) };
  }
  return null;
}

/**
 * Arma (o mantiene) el sondeo de transcripts de un servidor.
 *
 * NO EMITE LO QUE YA HABIA al armarse: la primera vuelta solo toma nota de los
 * tamaños. Emitir entonces diria «crecio» de todo lo que ya estaba, y cada
 * ventana que abre un transcript haria releer a todas las demas.
 *
 * @param {any} estado el del servidor: `home`, `bus`, `motor`
 * @param {{intervaloMs?: number, inactividadMs?: number}} [opts]
 */
export function vigilarTranscripts(estado, opts = {}) {
  if (!estado || !estado.home || !estado.bus || typeof estado.bus.emitir !== "function") return null;
  const vigente = sondeos.get(estado);
  if (vigente) {
    vigente.ultimoMovimiento = Date.now();
    return vigente;
  }
  const intervaloMs = opts.intervaloMs ?? 1000;
  const inactividadMs = opts.inactividadMs ?? 10 * 60_000;

  const s = {
    /** @type {Map<string, number>} */
    tamanos: new Map(),
    ultimoMovimiento: Date.now(),
    primera: true,
    /** @type {any} */
    reloj: null,
    detener() {
      if (s.reloj) clearInterval(s.reloj);
      sondeos.delete(estado);
    },
  };

  const vuelta = () => {
    // Un servidor que ya no esta (su home se borro) no deja un sondeo huerfano.
    if (!existsSync(estado.home)) return s.detener();
    const runs = join(estado.home, "runs");
    let items = [];
    try {
      items = existsSync(runs) ? readdirSync(runs, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
    } catch {
      items = [];
    }
    for (const dirDelItem of items) {
      const dir = join(runs, dirDelItem, "transcripts");
      if (!existsSync(dir)) continue;
      /** @type {any} */
      let run;
      let nombres = [];
      try {
        nombres = readdirSync(dir).filter((n) => n.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const nombre of nombres) {
        const ruta = join(dir, nombre);
        let tamano;
        try {
          tamano = statSync(ruta).size;
        } catch {
          continue;
        }
        const antes = s.tamanos.get(ruta);
        s.tamanos.set(ruta, tamano);
        if (s.primera || antes === tamano) continue;
        s.ultimoMovimiento = Date.now();
        // El run se lee al primer cambio de la vuelta y no antes: casi todas
        // las vueltas no cambian nada, y leerlo en cada una es trabajo tirado.
        // `dirDelItem` es el id saneado; el run se busca por el mismo nombre.
        if (run === undefined) run = leerRun(estado.home, dirDelItem);
        const itemId = String(run?.item?.id ?? dirDelItem);
        const quien = deQuienEs(run, itemId, nombre);
        if (!quien) continue;
        const projectId = run?.projectId ?? run?.project_id ?? null;
        try {
          estado.bus.emitir(
            "run.transcript",
            { projectId, itemId, taskId: quien.taskId, fase: quien.fase, ...(quien.lente ? { lente: quien.lente } : {}) },
            { project_id: projectId },
          );
        } catch {
          /* un canal caido no apaga el sondeo */
        }
      }
    }
    s.primera = false;

    const enVuelo = estado.motor?.lanzador?.estados?.().some((/** @type {any} */ v) => EN_VUELO.includes(v.estado)) ?? false;
    if (!enVuelo && Date.now() - s.ultimoMovimiento > inactividadMs) s.detener();
  };

  sondeos.set(estado, s);
  vuelta();
  s.reloj = setInterval(vuelta, intervaloMs);
  if (typeof s.reloj.unref === "function") s.reloj.unref();
  return s;
}
