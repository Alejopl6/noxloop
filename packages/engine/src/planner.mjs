// De un ticket a un plan ejecutable.
//
// ES EL UNICO PUNTO DEL FLUJO DONDE TODAVIA HAY UNA PERSONA MIRANDO, y por eso
// tiene dos reglas que no se negocian:
//
//   1. LO AMBIGUO SE PREGUNTA, NO SE RELLENA. Una suposicion de esta fase se
//      convierte en codigo, PR y tickets hijos antes de que nadie la revise.
//   2. UN CRITERIO QUE NO SE PUEDE CONVERTIR EN UN TEST QUE FALLE no es un
//      criterio. Sin criterio no hay test, sin test no hay tarea ejecutable, y
//      el loop entero se apoya en eso. Se bloquea, no se inventa.
//
// EL DIAGNOSTICO NO SE ADIVINA. Una version anterior de este harness, cuando la
// planificacion no dejaba plan, reportaba "lo mas probable: el ticket no tiene
// criterios de aceptacion". En el primer recorrido real esa suposicion fue
// FALSA —los criterios estaban perfectos y lo que faltaba era un permiso— y
// mando a revisar el lugar equivocado. Aca se reporta lo que se observo.

import { readFileSync, existsSync } from "node:fs";
import { recorteQueAvisa } from "./prompt.mjs";
import { join } from "node:path";
import { validatePlan } from "./plan.mjs";
import { createRun, loadRun, setTaskFields } from "./state.mjs";
import { entornoDeFase } from "./wiring.mjs";
import { validateItem, can } from "../../../providers/contract.mjs";

/**
 * Donde la fase de planificacion deja su resultado.
 *
 * FUERA DEL REPOSITORIO DE TRABAJO, y no es un detalle: un archivo de handoff
 * dentro del arbol de trabajo de alguien termina commiteado por accidente o
 * ensuciando su `git status`. El principio III vale tambien para los artefactos
 * intermedios, no solo para el estado del recorrido. La guarda de constitucion
 * atrapo exactamente esto.
 */
export function planFile(home, itemId) {
  return join(home, "plans", `plan-${itemId}.json`);
}

/**
 * @param {string} itemId
 * @param {object} deps
 * @returns {Promise<{ok: boolean, tasks?: number, repos?: string[], reason?: string, question?: string, problems?: string[], notes?: string[], alreadyPlanned?: boolean}>}
 */
export async function planItem(itemId, deps) {
  const { home, config, provider, providerCtx, log = muda() } = deps;
  const notes = [];

  const existente = loadRun(itemId, { home });
  if (existente) {
    // Idempotente: relanzar la planificacion no puede duplicar un recorrido ni
    // los tickets hijos que ya se crearon.
    return {
      ok: true,
      alreadyPlanned: true,
      tasks: existente.tasks.length,
      notes: [`ya habia un recorrido para ${itemId} con ${existente.tasks.length} tarea(s); no se replanifico`],
    };
  }

  const item = await provider.getItem(itemId, providerCtx);
  if (!item) {
    return { ok: false, reason: `el ticket ${itemId} no existe en el gestor ${provider.meta?.name || "?"}` };
  }

  const v = validateItem(item);
  if (!v.ok) {
    return { ok: false, reason: `el proveedor devolvio un ticket que no valida`, problems: v.problems };
  }

  // Se verifica ANTES de invocar al modelo: gastar una invocacion en algo que no
  // se puede planificar es gasto puro, y el resultado seria un plan inventado.
  const criterios = (item.acceptance || []).filter((c) => String(c || "").trim());
  if (criterios.length === 0) {
    return {
      ok: false,
      reason: `el ticket ${item.key || itemId} no tiene criterios de aceptacion verificables`,
      question:
        `¿Cual es el criterio de aceptacion de "${item.title}", redactado como algo que se pueda observar? ` +
        `Sin un criterio que se pueda convertir en un test que falle, no hay tarea ejecutable: ` +
        `no es un detalle que se complete sobre la marcha.`,
    };
  }

  const archivo = planFile(home, itemId);

  const r = await deps.runPhase({
    phase: "PLAN",
    // AQUI NO HAY TAREA TODAVIA: las tareas nacen del plan que esta invocacion
    // produce. El contrato de adaptadores exige `taskId` porque es lo que
    // identifica la invocacion, no porque exija que sea una tarea — asi que lo
    // honesto es identificar lo que de verdad se esta planificando.
    //
    // POR QUE `plan:<item>` Y NO ALGO CON FORMA DE TAREA. `plan.schema.json`
    // obliga a que el id de una tarea sea `^T[0-9]{3,}$`, y el prefijo `plan:`
    // no puede colisionar con ninguno: una bitacora, una sesion retomada o un
    // worktree que dijeran `T001` en la planificacion serian indistinguibles de
    // los de una tarea real que todavia no existe. Y lleva el item porque dos
    // planificaciones concurrentes son dos invocaciones distintas.
    taskId: `plan:${itemId}`,
    task: null,
    item,
    cwd: deps.workdir,
    // Se abre sesion NUEVA. Explicito y no por omision: el contrato distingue
    // "no retomar" de "no se dijo", y por omision el adaptador tendria que
    // adivinar cual de las dos era.
    resume: null,
    prompt: `/noxloop-plan ${itemId} --out ${archivo}`,
    model: deps.model || null,
    effort: deps.effort || "high",
    // El entorno EXPLICITO, por el mismo motivo que en el driver: heredar el
    // del motor propagaria al agente toda credencial cargada en el proceso
    // padre, tenga grant o no. Ver `entornoDeFase`.
    env: typeof deps.entorno === "function" ? deps.entorno() : entornoDeFase(deps.config || {}),
    // Cuales de esas variables son secretas; sin declaracion se miran todas.
    ...(deps.secretos ? { secretos: deps.secretos } : {}),
  });

  if (r?.budgetExhausted) {
    return {
      ok: false,
      reason: `la planificacion se corto por presupuesto (${r.subtype || "budget"}) antes de terminar; no es que el ticket no se pueda planificar`,
    };
  }

  if (!existsSync(archivo)) {
    return {
      ok: false,
      reason:
        `la fase de planificacion termino sin dejar el plan en ${archivo}. ` +
        // El texto que sigue es el DIAGNOSTICO de por que no se pudo
        // planificar. Recortarlo en silencio deja a una persona leyendo media
        // causa sin saber que era media.
        `Lo que dijo: ${recorteQueAvisa(String(r?.text || "(nada)"), 500)}`,
    };
  }

  let plan;
  try {
    plan = JSON.parse(readFileSync(archivo, "utf8"));
  } catch (e) {
    return { ok: false, reason: `${archivo} no es JSON valido: ${e.message}` };
  }

  // El item del plan lo fija el motor, no el modelo: es la unica forma de que el
  // recorrido quede indexado por el ticket de verdad.
  plan.item = {
    id: item.id, key: item.key ?? null, title: item.title,
    level: item.level, url: item.url, provider: provider.meta?.name || config.provider?.name || "?",
    acceptance: criterios, boardFields: item.boardFields ?? null,
  };

  const vp = validatePlan(plan, { repos: Object.keys(config.repos || {}) });
  if (!vp.ok) {
    return { ok: false, reason: "el plan no valida", problems: vp.problems };
  }

  const run = createRun(plan, { home, milestoneId: deps.milestoneId });
  log.info(`plan aceptado: ${run.tasks.length} tarea(s) sobre ${plan.repoScope.join(", ")}`);

  // ------------------------------------------- materializar en el tablero
  if (deps.materialize) {
    const puede = can(provider, "createChild");
    if (!puede.available) {
      // Degradacion declarada: las tareas viven en el recorrido y el PR las
      // enumera, para que el tablero no quede mudo.
      notes.push(
        `el gestor no soporta createChild (${puede.reason}): las tareas viven solo en el recorrido, y el PR las enumera`,
      );
    } else {
      for (const t of run.tasks) {
        if (t.providerItemId) continue;
        try {
          const hijo = await provider.createChild(item.id, {
            id: t.id, title: t.title, acceptance: t.acceptance, repo: t.repo,
            // Los campos de tablero se heredan del padre: una hija sin
            // iteracion cae en la raiz del proyecto y no aparece en ningun
            // taskboard.
            boardFields: item.boardFields ?? null,
          }, providerCtx);
          if (hijo?.id) setTaskFields(run, t.id, { providerItemId: hijo.id }, { home });
        } catch (e) {
          notes.push(`no se pudo crear el ticket hijo de ${t.id}: ${e.message}`);
        }
      }
    }
  }

  return { ok: true, tasks: run.tasks.length, repos: plan.repoScope, notes, problems: [] };
}

function muda() {
  const l = { info() {}, warn() {}, error() {}, child() { return l; } };
  return l;
}
