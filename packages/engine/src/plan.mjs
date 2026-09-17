// Validacion del plan: el DAG de tareas que sale de entender un ticket.
//
// Cuatro de las reglas de aca NO se pueden expresar en JSON Schema, y son
// justamente las que importan: que el grafo no tenga ciclos, que todo
// `dependsOn` apunte a una tarea que existe, que ninguna tarea trabaje sobre
// un repositorio fuera del alcance declarado, y que dos tareas que pueden
// correr A LA VEZ no declaren el mismo archivo.
//
// Un ciclo se reporta NOMBRANDO el ciclo. "Plan invalido" obliga a leer las
// veinte tareas a mano; "T001 -> T002 -> T003 -> T001" se arregla en un minuto.

import { readFileSync } from "node:fs";
import { validate } from "./schema.mjs";

function cargarEsquema() {
  return JSON.parse(readFileSync(new URL("../schemas/plan.schema.json", import.meta.url), "utf8"));
}

/**
 * @param {object} plan
 * @param {{repos: string[]}} ctx repositorios declarados en la configuracion
 * @returns {{ok: boolean, problems: string[]}}
 */
export function validatePlan(plan, ctx) {
  const problems = validate(cargarEsquema(), plan);
  const declarados = new Set(ctx.repos || []);

  if (problems.length) return { ok: false, problems };

  const tasks = plan.tasks;
  const ids = new Set();
  for (const t of tasks) {
    if (ids.has(t.id)) problems.push(`tarea duplicada: ${t.id}`);
    ids.add(t.id);
  }

  for (const repo of plan.repoScope) {
    if (!declarados.has(repo)) {
      problems.push(`el repoScope incluye "${repo}", que no esta declarado en la configuracion`);
    }
  }

  const enAlcance = new Set(plan.repoScope);
  for (const t of tasks) {
    if (!enAlcance.has(t.repo)) {
      problems.push(`${t.id}: trabaja sobre "${t.repo}", que no esta en el repoScope del plan`);
    }
    for (const dep of t.dependsOn) {
      if (!ids.has(dep)) problems.push(`${t.id}: depende de "${dep}", que no existe en este plan`);
      if (dep === t.id) problems.push(`${t.id}: depende de si misma`);
    }
    if (t.testFiles.length === 0 && !t.noTestsBecause) {
      problems.push(`${t.id}: sin testFiles y sin noTestsBecause — el guardian de orden la va a atascar hasta agotar su presupuesto`);
    }
  }

  const ciclo = findCycle(tasks);
  if (ciclo) {
    problems.push(`hay un ciclo de dependencias: ${ciclo.join(" -> ")}`);
    // Sin esto, la alcanzabilidad de abajo giraria para siempre. Y de todos
    // modos un plan con ciclo no se puede ejecutar: el resto del diagnostico
    // no aporta nada.
    return { ok: false, problems };
  }

  for (const p of solapamientos(tasks)) problems.push(p);

  return { ok: problems.length === 0, problems };
}

/**
 * Devuelve el camino del ciclo, o null.
 * @param {Array<{id: string, dependsOn: string[]}>} tasks
 * @returns {string[] | null}
 */
export function findCycle(tasks) {
  const porId = new Map(tasks.map((t) => [t.id, t]));
  const estado = new Map();
  const pila = [];

  function visitar(id) {
    if (estado.get(id) === "hecho") return null;
    if (estado.get(id) === "en-curso") {
      const desde = pila.indexOf(id);
      return [...pila.slice(desde), id];
    }
    estado.set(id, "en-curso");
    pila.push(id);
    for (const dep of porId.get(id)?.dependsOn || []) {
      if (!porId.has(dep)) continue;
      const c = visitar(dep);
      if (c) return c;
    }
    pila.pop();
    estado.set(id, "hecho");
    return null;
  }

  for (const t of tasks) {
    const c = visitar(t.id);
    if (c) return c;
  }
  return null;
}

/**
 * Orden topologico estable: a igualdad de dependencias, el orden del plan.
 * Estable a proposito — un orden que cambia entre corridas hace que dos
 * recorridos del mismo plan no se puedan comparar.
 * @param {Array<{id: string, dependsOn: string[]}>} tasks
 * @returns {string[]}
 */
export function topoOrder(tasks) {
  const porId = new Map(tasks.map((t) => [t.id, t]));
  const visto = new Set();
  const salida = [];

  function visitar(id, enCamino = new Set()) {
    if (visto.has(id) || enCamino.has(id)) return;
    enCamino.add(id);
    for (const dep of porId.get(id)?.dependsOn || []) {
      if (porId.has(dep)) visitar(dep, enCamino);
    }
    enCamino.delete(id);
    if (!visto.has(id)) {
      visto.add(id);
      salida.push(id);
    }
  }

  for (const t of tasks) visitar(t.id);
  return salida;
}

/** Una ruta declarada de dos formas distintas es el mismo archivo. */
function normalizar(ruta) {
  return String(ruta).replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

/**
 * Quien puede correr a la vez que quien.
 *
 * Dos tareas NO son concurrentes si hay un camino de dependencias entre ellas
 * en cualquier direccion: el scheduler no lanza una hasta que la otra integro.
 * Se calcula el cierre transitivo porque una arista directa y un camino
 * t1 -> t2 -> t3 ordenan igual, y mirar solo `dependsOn` habria dejado pasar el
 * caso transitivo — que es el que aparece en planes de verdad.
 *
 * @param {Array<{id: string, dependsOn: string[]}>} tasks grafo YA sin ciclos
 * @returns {Map<string, Set<string>>} id -> todo lo que lo precede, directo o no
 */
function precedencias(tasks) {
  const porId = new Map(tasks.map((t) => [t.id, t]));
  /** @type {Map<string, Set<string>>} */
  const cache = new Map();

  const de = (id) => {
    const hecho = cache.get(id);
    if (hecho) return hecho;
    const acc = new Set();
    cache.set(id, acc); // se registra antes de recorrer: sin ciclos no se lee a medias
    for (const dep of porId.get(id)?.dependsOn || []) {
      if (!porId.has(dep)) continue; // ya se reporto como dependencia inexistente
      acc.add(dep);
      for (const x of de(dep)) acc.add(x);
    }
    return acc;
  };

  return new Map(tasks.map((t) => [t.id, de(t.id)]));
}

/**
 * Archivos que dos tareas concurrentes se pelean.
 *
 * EL FALLO QUE CIERRA. `targetFiles` era obligatorio en el esquema y este
 * archivo no lo mencionaba: dos tareas sin arista entre ellas podian declarar
 * el mismo archivo. El scheduler las lanza en paralelo —es lo que el DAG
 * autoriza— cada una en su worktree, y el choque recien aparece al rebasar en
 * la cola, como conflicto. Es el modo de fallo que el DAG existe para evitar.
 *
 * Se reporta POR ARCHIVO y con todas las tareas que lo declaran: tres problemas
 * distintos para el mismo archivo obligan a arreglar lo mismo tres veces.
 *
 * El repositorio entra en la clave porque `src/index.ts` en dos repositorios
 * son dos archivos, en dos worktrees, y prohibirlo seria sobre-bloqueo.
 *
 * @param {Array<{id: string, repo: string, dependsOn: string[], targetFiles: string[]}>} tasks
 * @returns {string[]}
 */
function solapamientos(tasks) {
  const antes = precedencias(tasks);
  /** @type {Map<string, string[]>} */
  const porArchivo = new Map();
  for (const t of tasks) {
    for (const f of t.targetFiles || []) {
      const clave = `${t.repo}::${normalizar(f)}`;
      const ya = porArchivo.get(clave);
      if (ya) ya.push(t.id);
      else porArchivo.set(clave, [t.id]);
    }
  }

  const problemas = [];
  for (const [clave, ids] of porArchivo) {
    if (ids.length < 2) continue;

    // Solo molesta si ALGUN par puede correr a la vez. Una cadena entera
    // tocando el mismo archivo es legitima y frecuente.
    const concurrentes = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = [ids[i], ids[j]];
        if (!antes.get(a)?.has(b) && !antes.get(b)?.has(a)) concurrentes.push([a, b]);
      }
    }
    if (!concurrentes.length) continue;

    const [repo, archivo] = clave.split("::");
    const pares = concurrentes.map(([a, b]) => `${a} y ${b}`).join("; ");
    problemas.push(
      `${[...new Set(concurrentes.flat())].sort().join(", ")}: declaran el mismo targetFile ` +
      `"${archivo}" en ${repo} y pueden correr a la vez (${pares}). ` +
      `Dos tareas concurrentes sobre un archivo chocan al rebasar en la cola de integracion: ` +
      `poneles una dependencia entre ellas, o partí el archivo.`,
    );
  }
  return problemas;
}
