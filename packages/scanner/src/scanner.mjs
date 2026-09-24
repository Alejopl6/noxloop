// El nucleo del scanner: recorre, reparte el trabajo entre los detectores y
// hace cumplir las tres reglas del hallazgo.
//
// LO QUE ESTE ARCHIVO NO SABE, A PROPOSITO. No sabe que es `package.json`, ni
// que existe YAML, ni cuantos ecosistemas hay. Sabe que hay fases y que cada
// detector declara la suya. Es el principio VI aplicado a la lectura: si
// soportar un ecosistema nuevo exigiera tocar esto, la interfaz estaria mal, y
// lo que se arregla es la interfaz.
//
// POR QUE LA VALIDACION VIVE AQUI Y NO EN CADA DETECTOR. Porque los detectores
// son el punto de extension y manana hay uno mas escrito por alguien que no
// leyo el contrato. Un hallazgo `detectado` sin evidencia no sale de aqui, y el
// rechazo se anota con nombre y motivo: filtrar en silencio es la otra forma de
// inventar contexto, solo que hacia el autor del detector.

import { statSync, existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

import { FASES } from "./fases.mjs";
import { recorrer } from "./inventario.mjs";
import { crearContexto } from "./contexto.mjs";
import { evidenciaDe, motivoDeRechazo } from "./hallazgo.mjs";
import { redactarProfundo } from "./redaccion.mjs";
import { DETECTORES } from "./detectores/index.mjs";
import { noEsDirectorio, rutaInaccesible } from "./errores.mjs";

/**
 * El commit exacto del analisis, leido del disco.
 *
 * POR QUE NO SE LLAMA A `git`. Porque el contrato prohibe ejecutar cualquier
 * cosa sobre el proyecto, y "cualquier cosa" incluye a git: un `git` invocado
 * sobre un arbol ajeno puede tocar `.git/index` refrescando el cache de stat, y
 * entonces la promesa del scanner depende de la version de git que tenga
 * delante. Leer dos archivos de texto no depende de nada.
 *
 * @param {string} raiz
 * @returns {{commit: string|null, motivo: string}}
 */
function commitDe(raiz) {
  const cabeza = join(raiz, ".git", "HEAD");
  if (!existsSync(cabeza)) {
    return {
      commit: null,
      motivo:
        "no hay `.git/HEAD` bajo esta ruta: el directorio no esta versionado con git, o es un worktree cuyo " +
        "directorio de git vive en otro sitio. El snapshot vale igual, pero no se puede anclar a un commit.",
    };
  }
  try {
    const contenido = readFileSync(cabeza, "utf8").trim();
    if (!contenido.startsWith("ref:")) return { commit: contenido, motivo: "" };
    const referencia = contenido.slice(4).trim();
    const suelta = join(raiz, ".git", referencia);
    if (existsSync(suelta)) return { commit: readFileSync(suelta, "utf8").trim(), motivo: "" };
    const empaquetadas = join(raiz, ".git", "packed-refs");
    if (existsSync(empaquetadas)) {
      for (const linea of readFileSync(empaquetadas, "utf8").split(/\r?\n/)) {
        const [sha, nombre] = linea.split(" ");
        if (nombre === referencia) return { commit: sha, motivo: "" };
      }
    }
    return {
      commit: null,
      motivo:
        `\`.git/HEAD\` apunta a \`${referencia}\`, que no existe ni suelta ni en \`packed-refs\`. Es lo que ` +
        "deja un repositorio recien inicializado sin ningun commit todavia.",
    };
  } catch (e) {
    return { commit: null, motivo: `no se pudo leer \`.git/HEAD\`: ${e && e.message ? e.message : String(e)}` };
  }
}

/**
 * @typedef {object} Detector
 * @property {string} nombre
 * @property {import("./fases.mjs").Fase} fase
 * @property {(ctx: import("./contexto.mjs").Contexto) => any[]} detectar
 */

/**
 * @param {{
 *   ruta: string,
 *   señales?: AbortSignal,
 *   alProgresar?: (p: {fase: string, archivos_vistos: number, total_estimado: number}) => void,
 *   alHallar?: (h: any) => void,
 *   detectores?: Detector[],
 * }} opts
 * @returns {Promise<any>}
 */
export async function escanear(opts) {
  const { señales, alProgresar, alHallar } = opts;
  const detectores = opts.detectores ?? DETECTORES;
  const raiz = resolve(opts.ruta);

  let estadisticas;
  try {
    estadisticas = statSync(raiz);
  } catch (e) {
    throw rutaInaccesible(raiz, e && e.code ? e.code : String(e));
  }
  if (!estadisticas.isDirectory()) throw noEsDirectorio(raiz);

  const t0 = Date.now();
  const base = {
    id: randomUUID(),
    // El almacen asigna el proyecto; el scanner lee un arbol y no sabe de cual
    // es. Declararlo `null` es mas honesto que inventar una correspondencia.
    project_id: null,
    ruta: raiz,
    creado: new Date().toISOString(),
  };

  /** @type {any[]} */
  const hallazgos = [];
  /** @type {Array<{detector: string, clave: string, motivo: string}>} */
  const descartados = [];
  /** @type {Array<{detector: string, fase: string, causa: string}>} */
  const caidos = [];

  let vistos = 0;
  let total = 0;
  /** @param {string} fase */
  const progresar = (fase) => alProgresar?.({ fase, archivos_vistos: vistos, total_estimado: total });

  /**
   * @param {string} fase
   * @param {string} porQue
   */
  const cancelado = (fase, porQue) => ({
    ...base,
    commit: null,
    commit_motivo: "",
    estado: "cancelado",
    fase_cancelada: fase,
    motivo_cancelacion:
      `El recorrido se cancelo durante la fase \`${fase}\`: ${porQue}. Los hallazgos parciales no viajan en ` +
      "el snapshot a proposito: no hay forma de saber cuales faltaban, y una lista a medias se acaba usando " +
      "como si fuera entera.",
    duracion_ms: Date.now() - t0,
    archivos: [],
    enlaces: [],
    ilegibles: [],
    excluidos: { por_defecto: 0, por_gitignore: 0 },
    hallazgos: [],
    descartados: [],
    detectores_caidos: [],
  });

  // ---- Fase 1: inventario -------------------------------------------------
  progresar("inventario");
  if (señales?.aborted) return cancelado("inventario", "la señal ya venia abortada");

  const inventario = recorrer(raiz, {
    señales,
    alProgresar: (n) => {
      vistos = n;
      total = n; // durante el inventario el total todavia no se conoce
      progresar("inventario");
    },
  });
  if (inventario.cancelado || señales?.aborted) {
    return cancelado("inventario", "se pidio parar mientras se listaba el arbol");
  }

  total = inventario.archivos.length;
  vistos = total;

  const contexto = crearContexto(raiz, inventario, { señales });

  /** @param {any} hallazgo @param {string} detector */
  const emitir = (hallazgo, detector) => {
    const motivo = motivoDeRechazo(hallazgo);
    if (motivo) {
      descartados.push({ detector, clave: hallazgo?.clave ?? "(sin clave)", motivo });
      return;
    }
    const limpio = {
      ...hallazgo,
      // Principio IX: la redaccion ocurre ANTES de persistir, no despues. Este
      // es el unico punto por el que pasa todo lo que sale del scanner, y por
      // eso es el unico sitio donde puede garantizarse.
      valor: redactarProfundo(hallazgo.valor),
      // Un hallazgo de secreto no lleva extracto NUNCA: el detector ya lo sabe,
      // y esta linea es la que lo sigue garantizando el dia que alguien edite
      // el detector sin acordarse.
      evidencia: evidenciaDe(hallazgo.evidencia, { sinExtracto: hallazgo.clave.startsWith("riesgos.secreto") }),
    };
    hallazgos.push(limpio);
    // Los hallazgos salen segun aparecen para que la lista crezca mientras
    // corre: un recorrido de un minuto sin nada en pantalla se lee como colgado.
    alHallar?.(limpio);
  };

  // ---- Fases 2..N: los detectores ----------------------------------------
  for (const fase of FASES.slice(1)) {
    progresar(fase);
    if (señales?.aborted) return cancelado(fase, "se pidio parar antes de empezar la fase");

    for (const detector of detectores.filter((d) => d.fase === fase)) {
      try {
        const salida = (await detector.detectar(contexto)) ?? [];
        for (const hallazgo of salida) emitir(hallazgo, detector.nombre);
      } catch (e) {
        // Un ecosistema raro rompe a un detector, y el operador no se puede
        // quedar sin snapshot entero por un manifiesto mal formado que ni le
        // importaba. El detector caido se declara: un hueco en silencio es
        // indistinguible de "aqui no habia nada".
        caidos.push({ detector: detector.nombre, fase, causa: e && e.message ? e.message : String(e) });
      }
      if (señales?.aborted) return cancelado(fase, "se pidio parar mientras corrian los detectores de la fase");
    }
  }

  const { commit, motivo } = commitDe(raiz);

  return {
    ...base,
    commit,
    commit_motivo: motivo,
    estado: "completo",
    fase_cancelada: null,
    motivo_cancelacion: "",
    duracion_ms: Date.now() - t0,
    archivos: inventario.archivos,
    enlaces: inventario.enlaces,
    ilegibles: inventario.ilegibles,
    excluidos: inventario.excluidos,
    hallazgos,
    descartados,
    detectores_caidos: caidos,
  };
}
