// Validacion del plan: el DAG de tareas que sale de entender un ticket.
//
// Tres de las reglas de aca NO se pueden expresar en JSON Schema, y son
// justamente las que importan: que el grafo no tenga ciclos, que todo
// `dependsOn` apunte a una tarea que existe, y que ninguna tarea trabaje sobre
// un repositorio fuera del alcance declarado.
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
  if (ciclo) problems.push(`hay un ciclo de dependencias: ${ciclo.join(" -> ")}`);

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
