// El recorrido de un hito: lo que convierte UNA aprobacion en N historias
// cerradas.
//
// DOS FUNCIONES Y UNA FRONTERA ENTRE ELLAS. `prepararHito` lee el hito, resuelve
// el orden, declara las exclusiones y NO EJECUTA NADA; `correrHito` ejecuta lo
// que la primera mostro. La frontera es el unico punto de aprobacion humana de
// todo el hito, y por eso preparar no escribe estado: un "mostrame que harias"
// que deja archivos detras no se puede volver a mirar limpio, y el contrato del
// CLI lo verifica corriendo el dry-run contra un home vacio.
//
// EL ORDEN NO SE DEDUCE. Si el gestor declara dependencias entre items, el orden
// sale de ellas. Si declara que no las tiene —`capabilities().dependencies ===
// false`, que es el caso de un gestor de issues plano— el recorrido se SERIALIZA
// y queda dicho en el plan. Deducir un orden que el gestor no afirma es
// inventarse precedencias: funciona hasta el hito donde dos historias tocan el
// mismo archivo en el orden equivocado.
//
// LAS EXCLUSIONES SE DECIDEN ANTES DE ARRANCAR. Una historia que depende de algo
// que ningun driver puede resolver —un permiso, una decision de producto, un
// item que no es hijo de este hito— no mejora por entrar al recorrido: se
// bloquea a mitad, deja un worktree y una rama a medias, y arrastra a las que
// venian detras. `--skip` y `--only` se resuelven en `prepararHito`, con el
// arrastre transitivo incluido, y se declaran.
//
// LA RAMA DEL HITO VIVE EN UN SOLO REPOSITORIO, nace de la base declarada, y
// cada historia integra sobre ella. Es lo que hace que la historia N+1 arranque
// sobre trabajo ya integrado en vez de sobre la base pelada, y es la razon por
// la que los PRs de las historias apuntan a la rama del hito y no a la base:
// asi la revision humana recibe una sola rama y N PRs revisables por separado.
//
// EL TECHO DE GASTO ES POR HITO, NUNCA POR INVOCACION. Medido: en un hito de 71
// invocaciones con techo por invocacion de $8, trece aterrizaron entre $7,50 y
// $7,99, se registraron como exit 0, y el trabajo cortado volvio como reintento
// que costo mas que lo que el techo ahorro. Aca el techo se comprueba ENTRE
// historias y detiene el recorrido ordenadamente; ninguna historia se corta a
// mitad, y el techo no viaja hacia abajo en las dependencias de la corrida.
//
// BLOQUEADA E INALCANZABLE SON DOS COSAS DISTINTAS. Una fallo y tiene un
// diagnostico; la otra nunca pudo intentarse porque dependia de la primera. El
// reporte final solo sirve si las separa: la primera pide mirar su causa, la
// segunda pide destrabar otra cosa.
//
// POR QUE EL ESTADO DE LOS ITEMS DEL HITO SE ESCRIBE ACA Y NO EN state.mjs:
// state.mjs gobierna la maquina de estados de una TAREA, que es otra entidad con
// otras guardas. La disciplina es la misma —un solo escritor, con una tabla de
// aristas permitidas y una guarda por transicion— y vive en `aplicarTransicion`.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { findCycle, topoOrder } from "./plan.mjs";
import { readySet } from "./scheduler.mjs";
import { syncItemBranch } from "./merge-queue.mjs";
import { acquire } from "./lock.mjs";
import { loadRun } from "./state.mjs";
import { itemBranchName, slug } from "./wiring.mjs";
import { can } from "../../../providers/contract.mjs";

/** Los niveles que se recorren como hito. El nivel lo resuelve el proveedor con
 * su mapa de tipos, nunca se compara el nombre del tipo nativo. */
const NIVELES_DE_HITO = ["epic", "feature"];

/** Los niveles que un hito sabe ejecutar como historia. */
const NIVELES_EJECUTABLES = ["story", "task"];

export const ESTADOS_ITEM = [
  "pending",      // en el recorrido aprobado, sin empezar
  "planned",      // tiene plan aceptado
  "running",      // el driver la esta recorriendo
  "pr_open",      // dejo su PR abierto
  "integrated",   // y su rama entro a la rama del hito
  "blocked",      // fallo, o espera una respuesta
  "unreachable",  // nunca pudo intentarse: dependia de una bloqueada
];

/**
 * Las aristas permitidas. Todo lo que no este aca se rechaza, incluido
 * retroceder. Los dos retrocesos legitimos son: `running → planned`, que retoma
 * una historia que quedo en vuelo cuando mataron el proceso, y
 * `blocked|unreachable → pending`, que es lo que hace una nota humana al
 * destrabar.
 */
const ADELANTE = {
  pending: ["planned", "running", "blocked", "unreachable"],
  planned: ["running", "blocked", "unreachable"],
  running: ["pr_open", "planned", "blocked"],
  pr_open: ["integrated", "blocked"],
  integrated: [],
  blocked: ["pending", "planned"],
  // `unreachable → unreachable` esta permitido porque es un estado DERIVADO: se
  // recalcula en cada vuelta y su causa cambia cuando cambia quien la arrastra.
  // Rechazarlo haria que recalcular reviente el recorrido entero.
  unreachable: ["pending", "planned", "blocked", "unreachable"],
};

/** Como ve el scheduler a cada estado de item. Ver `comoTareas`. */
const PARA_SCHEDULER = {
  pending: "pending",
  planned: "pending",
  unreachable: "pending",   // se recalcula en cada vuelta: nunca se cachea
  running: "in_progress",
  pr_open: "blocked",       // ver comoTareas: sin integrar, no habilita a nadie
  integrated: "integrated",
  blocked: "blocked",
};

export class HitoError extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = "HitoError";
  }
}

// ------------------------------------------------------------------ disco

export function milestoneFile(home, id) {
  return join(home, "milestones", `milestone-${id}.json`);
}

/**
 * Escritura atomica: temporal + rename. Un corte a mitad no deja el recorrido
 * corrupto, que es justo el momento en que mas falta hace poder retomarlo.
 */
function escribirAtomico(file, datos) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(datos, null, 2) + "\n");
  renameSync(tmp, file);
}

/**
 * @param {string} itemId
 * @param {{home: string}} opts
 * @returns {object | null} null si no hay hito; LANZA si hay uno corrupto.
 */
export function leerHito(itemId, opts) {
  const file = milestoneFile(opts.home, itemId);
  if (!existsSync(file)) return null;
  const crudo = readFileSync(file, "utf8");
  try {
    return JSON.parse(crudo);
  } catch (e) {
    // Un recorrido corrupto se REPORTA. Devolver uno vacio seria peor que el
    // corte: el hito volveria a planificar historias que ya tienen trabajo.
    throw new HitoError(`el hito milestone-${itemId}.json esta corrupto y no se pudo parsear: ${e.message}`);
  }
}

function guardar(m, home) {
  m.updatedAt = new Date().toISOString();
  escribirAtomico(milestoneFile(home, m.item.id), m);
  return m;
}

/**
 * Aplica una mutacion sobre el estado FRESCO del disco, no sobre la copia que
 * trajo el llamador.
 *
 * ES EL MISMO FALLO QUE MATO state.mjs, un nivel mas arriba: con historias en
 * paralelo, cada una sostiene su propia referencia al hito entre `await`s, y sin
 * esto la ultima en guardar borra lo que escribio la otra. Es seguro sin locks
 * porque estas funciones son SINCRONAS: dentro de una funcion sincrona no hay
 * interleaving posible en Node.
 */
function conHitoFresco(itemId, home, fn) {
  const m = leerHito(itemId, { home });
  if (!m) throw new HitoError(`no hay recorrido para el hito ${itemId}`);
  const r = fn(m);      // la mutacion va PRIMERO: si una guarda lanza, no se escribe
  guardar(m, home);
  return r;
}

function itemDe(m, id) {
  const it = m.items.find((x) => x.id === id);
  if (!it) throw new HitoError(`la historia ${id} no esta en el recorrido del hito ${m.item.id}`);
  return it;
}

// ------------------------------------------------------- las transiciones

/**
 * El unico lugar del modulo que escribe el estado de un item del hito.
 *
 * @param {object} m el hito FRESCO
 * @param {string} id
 * @param {string} siguiente
 * @param {{reason?: string, pr?: string, branch?: string, esperandoRespuesta?: boolean, tareasBloqueadas?: string[], porque?: string[]}} [extra]
 */
function aplicarTransicion(m, id, siguiente, extra = {}) {
  const it = itemDe(m, id);
  if (!ESTADOS_ITEM.includes(siguiente)) throw new HitoError(`"${siguiente}" no es un estado de item conocido`);
  const actual = it.status;
  if (!(ADELANTE[actual] || []).includes(siguiente)) {
    throw new HitoError(`${id}: no se puede pasar de "${actual}" a "${siguiente}"`);
  }

  if (siguiente === "blocked" || siguiente === "unreachable") {
    // Una historia bloqueada con un diagnostico honesto vale mas que diez
    // vueltas que terminan en algo que nadie entiende. Sin causa no hay
    // diagnostico, y el reporte final no sirve para nada.
    const causa = String(extra.reason || "").trim();
    if (!causa) throw new HitoError(`${id}: dejar una historia en "${siguiente}" exige la causa real`);
    it.reason = causa;
  }

  if (siguiente === "pr_open") {
    // `pr_open` sin PR seria exactamente el verde inventado del principio II: el
    // estado diria que hay algo que revisar y no habria nada.
    if (!extra.pr) throw new HitoError(`${id}: marcar pr_open exige la URL del pull request`);
    it.pr = extra.pr;
  }

  if (siguiente === "integrated") {
    it.integratedAt = new Date().toISOString();
    it.reason = null;
  }

  if (siguiente === "pending" || siguiente === "planned") {
    it.esperandoRespuesta = false;
    if (actual === "blocked" || actual === "unreachable") it.reason = null;
  }

  if (extra.branch) it.branch = extra.branch;
  if (extra.esperandoRespuesta != null) it.esperandoRespuesta = Boolean(extra.esperandoRespuesta);
  if (extra.tareasBloqueadas) it.tareasBloqueadas = extra.tareasBloqueadas;
  if (extra.porque) it.porque = extra.porque;

  // La asignacion va por variable y despues de la tabla de arriba a proposito:
  // el estado de un item de hito no se escribe en ningun otro lugar del motor.
  it.status = siguiente;
  return it;
}

function transicionar(itemId, id, siguiente, opts) {
  return conHitoFresco(itemId, opts.home, (m) => aplicarTransicion(m, id, siguiente, opts));
}

function anotar(m, id, texto, de) {
  const t = String(texto || "").trim();
  if (!t) return null;
  const it = itemDe(m, id);
  it.notes = it.notes || [];
  it.notes.push({ de, texto: t, at: new Date().toISOString() });
  return it;
}

/**
 * Las notas son el canal de vuelta del hito, y no un adorno del reporte.
 *
 * Cuando la planificacion se detiene a preguntar, la pregunta entra como nota y
 * la historia queda bloqueada esperando respuesta. La respuesta entra por aca, y
 * eso —y solo eso— la reabre: `planItem` recibe las notas al replanificar, asi
 * que la respuesta llega a la fase que hizo la pregunta en vez de quedar en el
 * chat de alguien.
 *
 * @param {string} itemId el hito
 * @param {string} childId la historia
 * @param {string} texto
 * @param {{home: string, de?: string}} opts
 */
export function anotarEnHito(itemId, childId, texto, opts) {
  const t = String(texto || "").trim();
  if (!t) throw new HitoError(`una nota vacia no es una respuesta: ${childId} sigue esperando la suya`);
  const de = opts.de || "humano";
  return conHitoFresco(itemId, opts.home, (m) => {
    const it = anotar(m, childId, t, de);
    if (de !== "planificacion" && (it.status === "blocked" || it.status === "unreachable")) {
      aplicarTransicion(m, childId, "pending");
    }
    return { id: childId, status: it.status, notes: it.notes.length };
  });
}

// ------------------------------------------------------------ el recorrido

/** `Unificar el recorrido` -> `milestone/1-unificar-el-recorrido`. */
export function ramaDeHito(item) {
  return `milestone/${item.id}-${slug(item.title)}`;
}

function no(reason, problemas = []) {
  return { ok: false, reason, problemas, humano: [reason, ...problemas.map((p) => `  - ${p}`)] };
}

function repoDelHito(config, deps) {
  const declarados = Object.keys(config?.repos || {});
  if (deps.repo) {
    if (!declarados.includes(deps.repo)) {
      return { ok: false, reason: `el repositorio "${deps.repo}" no esta declarado en la configuracion` };
    }
    return { ok: true, repo: deps.repo };
  }
  if (declarados.length === 0) return { ok: false, reason: "no hay ningun repositorio declarado en la configuracion" };
  if (declarados.length === 1) return { ok: true, repo: declarados[0] };
  // Elegir uno por orden alfabetico seria elegirlo por casualidad, y la rama del
  // hito es donde se acumula TODO el trabajo: equivocarse de repositorio se
  // descubre cuando ya hay historias integradas en el lugar equivocado.
  return {
    ok: false,
    reason:
      `la rama del hito vive en UN repositorio y hay ${declarados.length} declarados ` +
      `(${declarados.join(", ")}): hay que decir cual con --repo`,
  };
}

/**
 * Lee el hito, resuelve el orden, declara las exclusiones y muestra el
 * recorrido. NO ejecuta nada y NO escribe nada.
 *
 * @param {string} itemId
 * @param {object} deps `provider`, `providerCtx`, `config`, `home`, y opcionalmente
 *   `skip`, `only`, `repo`, `branch`, `baseBranch`, `maxParallelItems`.
 */
export async function prepararHito(itemId, deps) {
  const { provider, providerCtx, config, home } = deps;

  const item = await provider.getItem(itemId, providerCtx);
  if (!item) return no(`el ticket ${itemId} no existe en el gestor ${provider.meta?.name || "?"}`);

  if (!NIVELES_DE_HITO.includes(item.level)) {
    return no(
      `${item.key || itemId} es de nivel "${item.level}", que no se recorre como hito ` +
        `(solo ${NIVELES_DE_HITO.join(" y ")}): una historia se planifica y se ejecuta`,
    );
  }

  const puedeHijos = can(provider, "children");
  if (!puedeHijos.available || typeof provider.children !== "function") {
    // Se dice ahora y no a mitad del recorrido: es la degradacion declarada de
    // `children` en el contrato del proveedor.
    return no(
      `${puedeHijos.reason || "el proveedor no expone children"}: sin leer los hijos no hay hito que recorrer ` +
        `(capabilities().children tiene que ser true)`,
    );
  }

  const elRepo = repoDelHito(config, deps);
  if (!elRepo.ok) return no(elRepo.reason);
  const repo = elRepo.repo;
  const baseBranch = deps.baseBranch || config.repos[repo].baseBranch;
  if (!baseBranch) return no(`el repositorio "${repo}" no declara baseBranch: la rama del hito nace de la base declarada`);
  const branch = deps.branch || ramaDeHito(item);

  const notas = [];
  const skipped = [];
  const hijosCrudos = (await provider.children(item.id, providerCtx)) || [];

  // ------------------------------------------------- exclusiones derivadas
  const hijos = [];
  for (const h of hijosCrudos) {
    if (!h || !h.id) continue;
    if (NIVELES_DE_HITO.includes(h.level)) {
      skipped.push({ id: h.id, why: `es de nivel "${h.level}": un hito anidado se recorre aparte, con su propia aprobacion` });
      continue;
    }
    if (!NIVELES_EJECUTABLES.includes(h.level)) {
      skipped.push({ id: h.id, why: `nivel "${h.level}": el hito no sabe ejecutar ese nivel` });
      continue;
    }
    if (h.canonicalState === "done") {
      skipped.push({ id: h.id, why: "el gestor la da por terminada: rehacerla seria trabajo sobre trabajo hecho" });
      continue;
    }
    hijos.push(h);
  }
  if (hijos.length === 0 && skipped.length === 0) {
    return no(`${item.key || itemId} no tiene hijos ejecutables: no hay recorrido que aprobar`);
  }

  // --------------------------------------------------------- dependencias
  const idsDeHijos = new Set(hijos.map((h) => h.id));
  const dependencias = {};
  const externas = [];
  const puedeDeps = can(provider, "dependencies");
  const soportaDeps = puedeDeps.available && typeof provider.dependencies === "function";

  if (soportaDeps) {
    for (const h of hijos) {
      const r = (await provider.dependencies(h.id, providerCtx)) || {};
      const preds = (r.predecessors || []).map(String);
      const internas = preds.filter((p) => idsDeHijos.has(p));
      for (const p of preds.filter((p) => !idsDeHijos.has(p))) externas.push({ id: h.id, dependeDe: p });
      if (internas.length) dependencias[h.id] = internas;
    }
    for (const e of externas) {
      // No se puede resolver en este recorrido, y tampoco se puede ignorar en
      // silencio: es exactamente el material con el que alguien decide un
      // `--skip` antes de arrancar.
      notas.push(
        `${e.id} declara depender de ${e.dependeDe}, que no es hijo de este hito: ` +
          `ningun driver puede resolver esa dependencia desde acá`,
      );
    }
  } else {
    // El gestor declara que no tiene dependencias entre items. Se SERIALIZA y se
    // dice; deducir un orden que el gestor no afirma es inventar precedencias.
    notas.push(
      `el gestor ${provider.meta?.name || "?"} declara capabilities().dependencies === false: ` +
        `el recorrido se serializa en el orden en que devolvio los hijos, y queda declarado. ` +
        `No se deduce un orden que el gestor no afirma`,
    );
  }

  // ------------------------------------------------ exclusiones explicitas
  const problemas = [];
  const pedidos = (lista) => [...new Set((lista || []).map(String))];
  const conocidos = new Set(hijosCrudos.map((h) => String(h?.id)));

  for (const id of pedidos(deps.skip)) {
    if (!conocidos.has(id)) {
      // Un id que no existe se dice ahora. Una bandera con un id mal escrito que
      // no hace nada es peor que un error: se corre igual la historia que se
      // queria dejar afuera.
      problemas.push(`--skip ${id}: ese id no es hijo de ${item.key || itemId}`);
      continue;
    }
    if (!skipped.some((s) => s.id === id)) skipped.push({ id, why: "excluida a mano con --skip" });
  }
  for (const id of pedidos(deps.only)) {
    if (!conocidos.has(id)) problemas.push(`--only ${id}: ese id no es hijo de ${item.key || itemId}`);
  }

  // Las exclusiones ya declaradas en un recorrido anterior siguen valiendo: la
  // razon por la que alguien excluyo una historia —depende de algo que ningun
  // driver puede resolver— no deja de ser cierta porque se relance sin la
  // bandera.
  for (const s of leerHito(itemId, { home })?.skipped || []) {
    if (!skipped.some((x) => x.id === s.id)) skipped.push(s);
  }

  // ------------------------------------------- el arrastre de lo excluido
  // Quien dependia de algo excluido tampoco entra, y se dice por que. Dejarlo
  // dentro solo consigue que se bloquee a mitad del recorrido.
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const h of hijos) {
      if (skipped.some((s) => s.id === h.id)) continue;
      const culpable = (dependencias[h.id] || []).find((d) => skipped.some((s) => s.id === d));
      if (culpable) {
        skipped.push({ id: h.id, why: `depende de ${culpable}, que quedó excluida: ningún driver puede resolver esa dependencia` });
        cambio = true;
      }
    }
  }

  const excluidos = new Set(skipped.map((s) => s.id));
  const dentro = hijos.filter((h) => !excluidos.has(h.id));
  const grafo = dentro.map((h) => ({
    id: h.id,
    dependsOn: (dependencias[h.id] || []).filter((d) => !excluidos.has(d)),
  }));

  const ciclo = findCycle(grafo);
  if (ciclo) {
    // Se nombra el ciclo. "El hito no se puede ordenar" obliga a revisar las
    // nueve historias a mano; "2 -> 3 -> 2" se arregla en el gestor en un minuto.
    problemas.push(`las dependencias del gestor tienen un ciclo: ${ciclo.join(" -> ")}`);
  }

  if (problemas.length) {
    return {
      ...no(`el recorrido de ${item.key || itemId} no se puede aprobar todavia`, problemas),
      problemas,
    };
  }

  const orden = soportaDeps ? topoOrder(grafo) : dentro.map((h) => h.id);
  const dependenciasDentro = Object.fromEntries(
    grafo.filter((g) => g.dependsOn.length).map((g) => [g.id, g.dependsOn]),
  );

  // Sin dependencias declaradas por el gestor, el ancho es 1: serializar es
  // correr de a una, y un ancho mayor sobre un orden que nadie afirma es el
  // paralelismo por optimismo que prohibe el principio V.
  const paralelismo = soportaDeps
    ? Math.max(1, deps.maxParallelItems ?? config.limits?.maxParallelItems ?? 2)
    : 1;

  const soloEstaCorrida = pedidos(deps.only);
  const fuera = soloEstaCorrida.length
    ? orden.filter((id) => !soloEstaCorrida.includes(id)).map((id) => ({ id, why: `fuera de --only: no entra en esta corrida` }))
    : [];

  const porId = new Map(dentro.map((h) => [h.id, h]));
  const recorrido = {
    ok: true,
    item: { id: item.id, key: item.key ?? null, title: item.title, level: item.level, url: item.url, provider: provider.meta?.name || "?" },
    repo,
    branch,
    baseBranch,
    orden,
    ordenSegun: soportaDeps ? "dependencias-del-gestor" : "serializado",
    dependencias: dependenciasDentro,
    dependenciasExternas: externas,
    paralelismo,
    maxCostUsd: deps.maxCostUsd ?? config.limits?.maxCostUsd ?? null,
    maxItems: deps.maxItems ?? null,
    items: orden.map((id) => ({ id, key: porId.get(id)?.key ?? null, title: porId.get(id)?.title || "" })),
    // Lo minimo del item canonico que el recorrido necesita: con el `raw` del
    // gestor adentro, la salida JSON del comando pasa a ser ilegible.
    hijos: orden.map((id) => {
      const h = porId.get(id);
      return { id: h.id, key: h.key ?? null, title: h.title, level: h.level, url: h.url };
    }),
    skipped,
    fuera,
    notas,
  };
  recorrido.humano = humanoDelRecorrido(recorrido);
  return recorrido;
}

function humanoDelRecorrido(r) {
  const l = [];
  l.push(`hito ${r.item.key || r.item.id} — ${r.item.title}  (${r.item.level})`);
  l.push(`rama: ${r.branch}  (nace de ${r.baseBranch}, en ${r.repo})`);
  l.push(`orden (${r.ordenSegun}): ${r.orden.join(" → ") || "—"}`);
  l.push(`paralelismo: hasta ${r.paralelismo} historia(s) a la vez`);
  if (r.maxCostUsd != null) l.push(`techo de gasto del hito: ${r.maxCostUsd} USD`);
  if (r.maxItems != null) l.push(`esta corrida arranca como maximo ${r.maxItems} historia(s)`);
  l.push("");
  for (const it of r.items) {
    const dep = (r.dependencias[it.id] || []).join(", ");
    l.push(`  ${it.id}  ${it.key || ""}  ${it.title}${dep ? `   ← ${dep}` : ""}`);
  }
  if (r.skipped.length) {
    l.push("", "excluidas antes de arrancar:");
    for (const s of r.skipped) l.push(`  ${s.id}: ${s.why}`);
  }
  if (r.fuera.length) {
    l.push("", "no entran en esta corrida (--only):");
    for (const s of r.fuera) l.push(`  ${s.id}`);
  }
  if (r.notas.length) {
    l.push("");
    for (const n of r.notas) l.push(`  · ${n}`);
  }
  l.push("", "Esto es el unico punto de aprobacion humana de todo el hito.");
  return l;
}

// ----------------------------------------------------------- la ejecucion

/**
 * Ejecuta el recorrido que `prepararHito` mostro.
 *
 * @param {string} itemId
 * @param {object} deps lo de `prepararHito`, mas `runItem`, `planItem`, `log`, y
 *   lo que esas dos necesiten (se les reenvia todo salvo lo que es del hito).
 */
export async function correrHito(itemId, deps) {
  const { home, log = muda() } = deps;
  const prep = await prepararHito(itemId, deps);
  if (!prep.ok) return prep;

  // Dos procesos sobre el mismo hito no producen el doble de trabajo: producen
  // dos veces la misma historia, dos PRs y una rama que ninguno escribio entera.
  mkdirSync(home, { recursive: true });
  const lock = acquire(`milestone-${itemId}`, { home });
  if (!lock.ok) {
    throw new HitoError(
      `otro proceso esta recorriendo el hito ${itemId} (pid ${lock.heldBy?.pid} en ${lock.heldBy?.host}). ` +
        `Dos recorridos del mismo hito no son el doble de trabajo: son dos veces el mismo`,
    );
  }

  try {
    let m = abrirRecorrido(prep, home);
    const hijos = new Map(prep.hijos.filter(Boolean).map((h) => [h.id, h]));
    const fuera = new Set(prep.fuera.map((f) => f.id));
    const techo = prep.maxCostUsd;
    const maxItems = prep.maxItems;
    const ancho = prep.paralelismo;
    const stallRounds = deps.config?.limits?.stallRounds ?? 2;

    await escribirEstadoEnGestor(itemId, "in_progress", deps);

    // La rama del hito se pone al dia con su base SOLO antes de la primera
    // integracion. Despues ya hay PRs de historias apuntando a ella, y
    // reescribirla exigiria un force push — que el principio IV no permite.
    if (!m.items.some((it) => it.status === "integrated")) {
      const { integrationPath } = deps.resolve(m.repo, { item: m.item, itemBranch: m.branch, baseBranch: m.baseBranch });
      const s = syncItemBranch(integrationPath, m.branch, m.baseBranch);
      if (!s.ok) {
        log.error(`la rama del hito no se pudo poner al dia: ${s.reason}`);
        return { ...reporteDeHito(itemId, { home }), ok: false, reason: s.reason };
      }
    }

    // Una historia que quedo "running" viene de un proceso que murio: nadie mas
    // la esta tocando, porque el lock es nuestro. Se devuelve a "planned" para
    // que la vuelta la retome — su recorrido en disco ya sabe donde iba.
    for (const it of m.items) {
      if (it.status === "running") {
        log.warn(`${it.id} quedo en vuelo de un recorrido interrumpido: se retoma`);
        transicionar(itemId, it.id, "planned", { home });
      }
    }

    // Y se reintenta la integracion de las que quedaron con el PR abierto sin
    // entrar. El caso real es uno: alguien resolvio el conflicto a mano en la
    // rama de la historia. Sin este reintento la unica salida seria rehacer la
    // historia entera —gastando otra vez lo que ya se gasto— y todo lo que
    // dependia de ella quedaria inalcanzable para siempre.
    for (const it of leerHito(itemId, { home }).items) {
      if (it.status !== "pr_open" || !it.branch) continue;
      const res = integrarEnHito(deps, leerHito(itemId, { home }), it.branch);
      if (res.ok) {
        transicionar(itemId, it.id, "integrated", { home });
        log.info(`${it.id} entro al hito en el reintento (${res.modo})`);
      } else {
        log.warn(`${it.id} sigue con el PR abierto sin integrar: ${String(res.reason).split("\n")[0]}`);
      }
    }

    let arrancadas = 0;
    let stoppedBy = null;
    let huellaPrevia = huella(leerHito(itemId, { home }));
    let quietas = 0;

    while (true) {
      m = leerHito(itemId, { home });
      const rs = readySet({ tasks: comoTareas(m) }, { maxParallelTasks: ancho });
      registrarInalcanzables(itemId, m, rs.unreachable, { home });
      if (rs.done) break;

      // EL TECHO SE COMPRUEBA ACA Y NO ADENTRO DE UNA HISTORIA. Entre historias
      // el recorrido se detiene ordenadamente: lo integrado queda integrado y lo
      // que no arranco queda pendiente, no bloqueado. Con ancho > 1 el corte
      // puede pasarse por lo que cueste el ultimo lote, y eso es preferible a
      // matar una historia a mitad: el reintento de una unidad cortada cuesta
      // mas que el excedente.
      if (techo != null && (leerHito(itemId, { home }).spent?.usd || 0) >= techo) {
        stoppedBy = "maxCostUsd";
        break;
      }
      if (maxItems != null && arrancadas >= maxItems) {
        stoppedBy = "maxItems";
        break;
      }

      let lote = rs.ready.filter((id) => !fuera.has(id));
      if (maxItems != null) lote = lote.slice(0, Math.max(0, maxItems - arrancadas));
      if (lote.length === 0) {
        stoppedBy = fuera.size ? "only" : "sinAvance";
        break;
      }

      arrancadas += lote.length;
      log.info(`hito ${itemId}: arrancando ${lote.length} historia(s): ${lote.join(", ")}`);
      // EL PUNTO DE PARALELISMO, y `allSettled` por la misma razon que el driver:
      // una historia que revienta no puede abortar a las demas, y su estado ya
      // quedo en disco antes de que esta promesa resuelva.
      await Promise.allSettled(lote.map((id) => pipelineDeHistoria(itemId, id, deps, hijos.get(id))));

      const ahora = huella(leerHito(itemId, { home }));
      if (ahora === huellaPrevia) {
        quietas += 1;
        log.warn(`el hito no avanzo (${quietas}/${stallRounds})`);
        if (quietas >= stallRounds) {
          stoppedBy = "sinAvance";
          break;
        }
      } else {
        quietas = 0;
        huellaPrevia = ahora;
      }
    }

    conHitoFresco(itemId, home, (fresco) => {
      fresco.stoppedBy = stoppedBy;
    });

    const reporte = reporteDeHito(itemId, { home });
    await cerrarEnGestor(itemId, reporte, deps);
    for (const l of reporte.humano) log.info(l);
    return reporte;
  } finally {
    lock.release();
  }
}

/**
 * Crea el recorrido en disco, o lo pone al dia con el recorrido aprobado sin
 * perder nada de lo que ya paso.
 *
 * Lo que NO hace es reordenar lo que ya corrio: una historia integrada queda
 * integrada, con su PR y sus notas.
 */
function abrirRecorrido(prep, home) {
  const existente = leerHito(prep.item.id, { home });
  const ahora = new Date().toISOString();

  const items = prep.orden.map((id) => {
    const previo = existente?.items?.find((x) => x.id === id);
    const base = prep.items.find((x) => x.id === id);
    return {
      id,
      key: base?.key ?? null,
      title: base?.title || "",
      status: previo?.status || "pending",
      pr: previo?.pr || null,
      reason: previo?.reason || null,
      notes: previo?.notes || [],
      branch: previo?.branch || null,
      esperandoRespuesta: previo?.esperandoRespuesta || false,
      tareasBloqueadas: previo?.tareasBloqueadas || [],
      integratedAt: previo?.integratedAt || null,
      porque: previo?.porque || [],
    };
  });

  const m = {
    schemaVersion: 1,
    item: prep.item,
    repo: prep.repo,
    branch: existente?.branch || prep.branch,
    baseBranch: existente?.baseBranch || prep.baseBranch,
    order: prep.orden,
    orderSource: prep.ordenSegun,
    dependencias: prep.dependencias,
    items,
    skipped: prep.skipped,
    spent: existente?.spent || { usd: 0, calls: 0 },
    stoppedBy: null,
    providerStateWritten: existente?.providerStateWritten || null,
    createdAt: existente?.createdAt || ahora,
    updatedAt: ahora,
  };
  return guardar(m, home);
}

/**
 * El hito visto por el scheduler, que es el unico lugar del motor que decide
 * paralelismo — y se reusa entero: el orden topologico, el recorte por ancho y
 * el calculo de inalcanzables ya estan probados contra la tabla del quickstart.
 *
 * `pr_open` se traduce a bloqueada A PROPOSITO. Una historia con su PR abierto
 * cuyo trabajo NO entro a la rama del hito no habilita a la siguiente: nadie
 * ramifica sobre trabajo no integrado. Quien dependia de ella queda
 * inalcanzable, y eso es justo lo que el reporte tiene que decir.
 */
function comoTareas(m) {
  return m.items.map((it) => ({
    id: it.id,
    dependsOn: m.dependencias?.[it.id] || [],
    dependencyKind: "hard",
    status: PARA_SCHEDULER[it.status] || "pending",
  }));
}

function registrarInalcanzables(itemId, m, inalcanzables, opts) {
  for (const id of inalcanzables || []) {
    const it = itemDe(m, id);
    if (!["pending", "planned", "unreachable"].includes(it.status)) continue;
    const porque = (m.dependencias?.[id] || []).filter((d) => {
      const dep = m.items.find((x) => x.id === d);
      return dep && ["blocked", "unreachable", "pr_open"].includes(dep.status);
    });
    const causa = `nunca pudo intentarse: depende de ${porque.join(", ") || "una historia que no se integro"}`;
    if (it.status === "unreachable" && it.reason === causa) continue;
    transicionar(itemId, id, "unreachable", { home: opts.home, reason: causa, porque });
  }
}

function huella(m) {
  return `${(m?.items || []).map((i) => `${i.id}:${i.status}`).join("|")}#${m?.spent?.usd ?? 0}`;
}

// -------------------------------------------------- una historia, entera

async function pipelineDeHistoria(hitoId, storyId, deps, hijo) {
  const { home, log = muda() } = deps;
  const bitacora = log.child ? log.child({ milestone: hitoId, item: storyId }) : log;
  const m = leerHito(hitoId, { home });
  const it = itemDe(m, storyId);

  // Retomar es gratis: una historia integrada no se vuelve a planificar ni a
  // ejecutar, y el presupuesto que consumio no se devuelve.
  if (it.status === "integrated") return;

  const rama = it.branch || itemBranchName(hijo || { id: storyId, title: it.title });
  const resolveDeHistoria = hacerResolveDeHistoria(deps, m, hijo, rama);
  const depsHistoria = depsParaHistoria(deps, {
    resolve: resolveDeHistoria,
    milestoneId: hitoId,
    log: bitacora,
  });

  // --------------------------------------------------------- planificar
  if (it.status !== "planned") {
    const workdir = resolveDeHistoria(m.repo).integrationPath;
    const p = await deps.planItem(storyId, {
      ...depsHistoria,
      workdir,
      milestoneId: hitoId,
      // Las notas viajan a la planificacion: si la vuelta anterior pregunto, la
      // respuesta esta acá y es lo que hace que replanificar no vuelva a
      // preguntar lo mismo.
      notes: it.notes || [],
    });

    if (!p?.ok) {
      const pregunta = String(p?.question || "").trim();
      const causa = pregunta || String(p?.reason || "").trim() || "la planificacion termino sin dejar plan";
      conHitoFresco(hitoId, home, (fresco) => {
        anotar(fresco, storyId, causa, "planificacion");
        aplicarTransicion(fresco, storyId, "blocked", { reason: causa, esperandoRespuesta: Boolean(pregunta) });
      });
      bitacora.warn(pregunta ? `${storyId} espera una respuesta: ${pregunta}` : `${storyId} no se pudo planificar: ${causa}`);
      return;
    }
    transicionar(hitoId, storyId, "planned", { home, branch: rama });
  }

  // ------------------------------------------------------------ ejecutar
  transicionar(hitoId, storyId, "running", { home, branch: rama });
  let r = null;
  try {
    r = await deps.runItem(storyId, depsHistoria);
  } catch (e) {
    const causa = `el recorrido de la historia reventó: ${e?.message || String(e)}`;
    sumarGasto(hitoId, costoDe(null, storyId, deps), { home });
    transicionar(hitoId, storyId, "blocked", { home, reason: causa });
    bitacora.error(causa);
    return;
  }

  // El gasto se registra SIEMPRE, salga bien o mal: una historia que fallo
  // igual gasto, y un techo que solo cuenta los exitos no es un techo.
  sumarGasto(hitoId, costoDe(r, storyId, deps), { home });

  if (!r?.pr) {
    const causa = String(r?.reason || "").trim() || "el recorrido de la historia no llego a abrir un pull request";
    transicionar(hitoId, storyId, "blocked", { home, reason: causa });
    bitacora.warn(`${storyId} bloqueada: ${causa}`);
    return;
  }

  transicionar(hitoId, storyId, "pr_open", { home, pr: r.pr, tareasBloqueadas: r.blocked || [] });

  // ----------------------------------------------- integrar en el hito
  const res = integrarEnHito(deps, leerHito(hitoId, { home }), rama);
  if (!res.ok) {
    conHitoFresco(hitoId, home, (fresco) => {
      anotar(fresco, storyId, res.reason, "integracion");
      itemDe(fresco, storyId).reason = res.reason;
    });
    bitacora.warn(`${storyId} quedo con el PR abierto sin integrar: ${res.reason}`);
    return;
  }
  transicionar(hitoId, storyId, "integrated", { home });
  bitacora.info(`${storyId} integrada en ${m.branch} (${res.modo})`);
}

/**
 * El `resolve` que ve el recorrido de una historia.
 *
 * DOS COSAS, Y LAS DOS SON EL PUNTO 3. La rama de la historia nace de la RAMA
 * DEL HITO —asi arranca sobre trabajo ya integrado— y la base que el driver usa
 * para el destino del PR es tambien la rama del hito: los PRs de las historias
 * apuntan ahi y no a la base declarada, que es lo que deja una sola rama para la
 * revision humana.
 *
 * Solo el repositorio del hito recibe ese cambio de base. Una historia que toque
 * otro repositorio nace de la base declarada de ESE repositorio, porque la rama
 * del hito vive en uno solo.
 */
function hacerResolveDeHistoria(deps, m, hijo, rama) {
  const item = hijo || { id: m.items.find((x) => x.branch === rama)?.id, title: "" };
  return (repo, opts = {}) =>
    deps.resolve(repo, {
      item,
      itemBranch: opts.itemBranch || rama,
      baseBranch: opts.baseBranch || (repo === m.repo ? m.branch : deps.config?.repos?.[repo]?.baseBranch),
    });
}

/**
 * Las dependencias que baja el hito a una historia.
 *
 * SE LE SACA EL TECHO A PROPOSITO, y es el punto 7 escrito como codigo: el techo
 * es del hito. Un techo que baja hasta la invocacion corta a mitad de una unidad
 * indivisible, se registra como exit 0, y el reintento cuesta mas que lo que el
 * techo ahorro.
 */
function depsParaHistoria(deps, extra) {
  const {
    runItem: _ri, planItem: _pi, maxCostUsd: _techo, maxItems: _mi, maxParallelItems: _mp,
    only: _o, skip: _s, repo: _r, branch: _b, baseBranch: _bb, resolve: _rs, log: _l,
    ...resto
  } = deps;
  return { ...resto, ...extra };
}

/**
 * Integra la rama de una historia en la rama del hito.
 *
 * POR QUE NO SE REBASA la rama de la historia, aunque la cola de integracion del
 * driver si rebase las ramas de tarea: a esta altura la historia ya tiene su PR
 * abierto, y reescribir una rama con un PR encima exige un force push. El
 * principio IV no lo permite, y con razon — ya se movio una rama de verdad por
 * una grafia que sorteo una lista de prohibidos.
 *
 * ASI QUE PRIMERO FAST-FORWARD, que por construccion no puede conflictuar, y si
 * la punta se movio debajo —dos historias en paralelo que salieron de la misma
 * punta— una mezcla normal sobre la rama del hito, que es NUESTRA rama y no una
 * protegida. Si eso conflictua, se aborta y la historia queda con su PR abierto
 * y el conflicto textual: la integracion pasa a ser de quien revisa.
 *
 * ES SINCRONA A PROPOSITO. Dos mezclas simultaneas sobre la misma rama son el
 * problema que la cola serial del driver existe para evitar; sin `await` en el
 * medio, dos historias en paralelo no pueden intercalarse acá.
 */
function integrarEnHito(deps, m, rama) {
  const { integrationPath } = deps.resolve(m.repo, { item: m.item, itemBranch: m.branch, baseBranch: m.baseBranch });

  const ff = git(integrationPath, ["merge", "--ff-only", rama], { permitirFallo: true });
  if (ff.ok) return { ok: true, modo: "fast-forward" };

  const mezcla = git(integrationPath, ["merge", "--no-edit", "-m", `merge(${rama}): historia integrada al hito ${m.item.id}`, rama], {
    permitirFallo: true,
  });
  if (mezcla.ok) return { ok: true, modo: "mezcla" };

  // Abortar NO es opcional: sin esto el worktree queda en medio de una mezcla y
  // cada intento posterior falla antes de empezar, con un error que no tiene
  // nada que ver con la causa real.
  git(integrationPath, ["merge", "--abort"], { permitirFallo: true });
  return {
    ok: false,
    reason: `la rama ${rama} no entro en ${m.branch}; el PR quedo abierto y la integracion es manual:\n${mezcla.out || ff.out}`,
  };
}

function git(cwd, args, { permitirFallo = false } = {}) {
  try {
    return {
      ok: true,
      out: execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(),
    };
  } catch (e) {
    const out = `${e.stdout || ""}${e.stderr || ""}`.trim();
    if (!permitirFallo) throw new HitoError(`git ${args.join(" ")} fallo en ${cwd}:\n${out}`);
    return { ok: false, out };
  }
}

// ------------------------------------------------------------- el gasto

/**
 * Lo que costo una historia.
 *
 * Se busca en tres lugares y en este orden: lo que informo la corrida, el costo
 * plano de la invocacion, y el estado en disco del recorrido de la historia. Un
 * gasto que no se registra no existe, y un techo que se queda en cero para
 * siempre no es un techo: por eso una corrida sin informacion de costo cuenta
 * igual como una invocacion.
 */
function costoDe(r, storyId, deps) {
  let enDisco = null;
  try {
    enDisco = deps.home ? loadRun(storyId, { home: deps.home }) : null;
  } catch {
    enDisco = null; // un recorrido corrupto no puede tumbar la contabilidad del hito
  }
  const usd = numero(r?.spent?.usd ?? r?.usd ?? enDisco?.spent?.usd ?? 0);
  const calls = numero(r?.spent?.calls ?? r?.calls ?? enDisco?.spent?.calls ?? 0);
  return { usd, calls: calls || 1 };
}

function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function sumarGasto(itemId, gasto, opts) {
  return conHitoFresco(itemId, opts.home, (m) => {
    m.spent = m.spent || { usd: 0, calls: 0 };
    m.spent.usd = Math.round((m.spent.usd + gasto.usd) * 1e6) / 1e6;
    m.spent.calls += gasto.calls;
    return m.spent;
  });
}

// ------------------------------------------------------------- el reporte

/**
 * El estado del hito, sin interpretacion y sin tocar el gestor: tiene que poder
 * correr con la red caida.
 *
 * @param {string} itemId
 * @param {{home: string}} opts
 */
export function reporteDeHito(itemId, opts) {
  const m = leerHito(itemId, opts);
  if (!m) return { ok: false, reason: `no hay recorrido para el hito ${itemId}`, humano: [`no hay recorrido para el hito ${itemId}`] };

  const de = (estado) => m.items.filter((it) => it.status === estado);
  const reporte = {
    ok: true,
    item: m.item,
    repo: m.repo,
    branch: m.branch,
    baseBranch: m.baseBranch,
    orden: m.order,
    ordenSegun: m.orderSource,
    dependencias: m.dependencias || {},
    integrated: de("integrated").map((it) => it.id),
    prOpen: de("pr_open").map((it) => ({ id: it.id, pr: it.pr, reason: it.reason })),
    running: de("running").map((it) => it.id),
    pending: [...de("pending"), ...de("planned")].map((it) => it.id),
    blocked: de("blocked").map((it) => ({ id: it.id, reason: it.reason, esperandoRespuesta: Boolean(it.esperandoRespuesta) })),
    unreachable: de("unreachable").map((it) => ({ id: it.id, porque: it.porque || [], reason: it.reason })),
    skipped: m.skipped || [],
    spent: m.spent || { usd: 0, calls: 0 },
    stoppedBy: m.stoppedBy || null,
    prs: m.items.filter((it) => it.pr).map((it) => ({ id: it.id, pr: it.pr })),
  };
  reporte.humano = humanoDelReporte(reporte);
  return reporte;
}

const MOTIVO_DE_CORTE = {
  maxCostUsd: "se alcanzo el techo de gasto del hito: el recorrido se detuvo entre historias, sin cortar ninguna a mitad",
  maxItems: "se alcanzo el tope de historias de esta corrida",
  only: "esta corrida estaba restringida con --only",
  sinAvance: "el recorrido dejo de avanzar: no quedaba ninguna historia que pudiera arrancar",
};

function humanoDelReporte(r) {
  const l = [];
  l.push(`hito ${r.item.key || r.item.id} — ${r.item.title}`);
  l.push(`rama: ${r.branch} (sobre ${r.baseBranch}, en ${r.repo})`);
  l.push(`gasto: ${r.spent.usd} USD en ${r.spent.calls} invocacion(es)`);
  l.push(`integradas (${r.integrated.length}): ${r.integrated.join(", ") || "ninguna"}`);
  if (r.prOpen.length) {
    l.push(`con PR abierto sin integrar (${r.prOpen.length}):`);
    for (const p of r.prOpen) l.push(`  ${p.id}: ${p.pr}${p.reason ? ` — ${String(p.reason).split("\n")[0]}` : ""}`);
  }
  if (r.blocked.length) {
    l.push(`bloqueadas (${r.blocked.length}), con su causa:`);
    for (const b of r.blocked) {
      l.push(`  ${b.id}: ${String(b.reason || "sin causa").split("\n")[0]}${b.esperandoRespuesta ? "  [espera respuesta]" : ""}`);
    }
  }
  if (r.unreachable.length) {
    // La distincion es el punto: una fallo y hay que mirar su causa; la otra
    // nunca pudo intentarse y hay que destrabar otra cosa.
    l.push(`inalcanzables (${r.unreachable.length}) — nunca pudieron intentarse:`);
    for (const u of r.unreachable) l.push(`  ${u.id}: depende de ${u.porque.join(", ") || "una historia que no se integro"}`);
  }
  if (r.pending.length) l.push(`pendientes (${r.pending.length}): ${r.pending.join(", ")}`);
  if (r.running.length) l.push(`en curso (${r.running.length}): ${r.running.join(", ")}`);
  if (r.skipped.length) {
    l.push(`excluidas (${r.skipped.length}), declaradas antes de arrancar:`);
    for (const s of r.skipped) l.push(`  ${s.id}: ${s.why}`);
  }
  if (r.stoppedBy) l.push("", MOTIVO_DE_CORTE[r.stoppedBy] || `el recorrido se detuvo: ${r.stoppedBy}`);
  if (r.blocked.some((b) => b.esperandoRespuesta)) {
    l.push("", "una historia espera una respuesta: entra por su nota, y la planificacion la lee al replanificar.");
  }
  l.push("", "Nada se mergeo a la base ni se desplego: eso sigue siendo tuyo.");
  return l;
}

// ------------------------------------------------------------- el gestor

/**
 * El orden del ciclo de vida. `blocked` no tiene rango: es una senial lateral.
 *
 * LA COMPARACION EXISTE POR UN FALLO CONCRETO: sin ella, relanzar un hito ya
 * terminado devuelve el ticket de "en revision" a "en curso", y el tablero
 * miente en la direccion mas confusa posible — parece que el trabajo volvio a
 * empezar.
 */
const RANGO_ESTADOS = { todo: 0, in_progress: 1, in_review: 2, done: 3 };

async function escribirEstadoEnGestor(itemId, estadoCanonico, deps) {
  const { provider, providerCtx, home, log = muda() } = deps;
  if (!provider || typeof provider.setState !== "function") return;
  if (!can(provider, "setState").available) return;

  const m = leerHito(itemId, { home });
  const escrito = m?.providerStateWritten;
  if (escrito === estadoCanonico) return;
  if (estadoCanonico !== "blocked" && escrito && escrito !== "blocked") {
    if ((RANGO_ESTADOS[estadoCanonico] ?? 0) <= (RANGO_ESTADOS[escrito] ?? -1)) return;
  }

  try {
    const r = await provider.setState(itemId, estadoCanonico, providerCtx);
    if (r?.written) {
      conHitoFresco(itemId, home, (fresco) => {
        fresco.providerStateWritten = estadoCanonico;
      });
    } else {
      log.info(`el gestor no tiene estado para "${estadoCanonico}": no se escribio nada`);
    }
  } catch (e) {
    log.warn(`no se pudo escribir el estado del hito en el gestor: ${e.message}`);
  }
}

/**
 * El estado final del ticket del hito.
 *
 * NUNCA `done`: cerrar el ticket diria que esta integrado en la base, y la
 * autonomia termina en el PR abierto. `in_review` solo cuando no queda nada por
 * recorrer — con historias pendientes el hito sigue en curso, y decir lo
 * contrario invita a revisar algo a medias.
 */
async function cerrarEnGestor(itemId, reporte, deps) {
  const quedaAlgo = reporte.pending.length || reporte.running.length;
  if (quedaAlgo) return;
  if (reporte.integrated.length === 0 && (reporte.blocked.length || reporte.unreachable.length)) {
    await escribirEstadoEnGestor(itemId, "blocked", deps);
    return;
  }
  if (reporte.integrated.length || reporte.prOpen.length) {
    await escribirEstadoEnGestor(itemId, "in_review", deps);
  }
}

function muda() {
  const l = { info() {}, warn() {}, error() {}, child() { return l; } };
  return l;
}
