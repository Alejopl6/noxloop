// El bucle de un item: de un plan a un pull request.
//
// QUIEN MANEJA. El motor, no el modelo. Cada fase recibe un contexto acotado y
// devuelve un hecho; quien decide si avanzar es este archivo, mirando codigos
// de salida y estado en disco. Nunca la prosa que vuelve de la sesion.
//
// LA MAQUINA DE ESTADOS ES EL BUCLE. No hay una secuencia de pasos: hay un
// `switch` sobre el estado actual de la tarea, que se re-lee del disco en cada
// vuelta. Es lo que hace que retomar un recorrido interrumpido sea gratis — el
// driver no tiene ningun "donde iba" en memoria — y lo que hace que dos tareas
// en paralelo no puedan confundirse.
//
// EL PARALELISMO ENTRA EN UN SOLO PUNTO: el `Promise.all` sobre el conjunto que
// devuelve el scheduler. Todo lo que lo hace seguro —el DAG, la cola de
// integracion, el lock, el puntero de tarea activa por worktree— esta probado
// aparte y antes.

import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  loadRun, saveRun, transition, bump, setTaskFields, setItemFields,
  setActiveTask, clearActiveTask, clearLastFailure, addSpend, BUDGETS_DEFAULT,
} from "./state.mjs";
import { readySet } from "./scheduler.mjs";
import { drain, syncItemBranch } from "./merge-queue.mjs";
import { acquire } from "./lock.mjs";
import * as worktreeMod from "./worktree.mjs";
import { commitPaths, mensajeDeFase } from "./vcs.mjs";
import { comandosPermitidos } from "./wiring.mjs";

const TIER_POR_DEFECTO = { model: null, effort: "high", gate: "full", review: true, fanout: false };

/** Tope de vueltas de la maquina de estados por tarea. Sin esto, un estado que
 * no avanza y no consume presupuesto seria un bucle infinito silencioso. */
const MAX_VUELTAS_POR_TAREA = 40;

function politicaDeTier(config, tier) {
  return { ...TIER_POR_DEFECTO, ...(config.tiers?.[tier] || {}) };
}

/**
 * @param {string} itemId
 * @param {object} deps
 */
export async function runItem(itemId, deps) {
  const { home, config, log = consolaMuda() } = deps;
  const budgets = { ...BUDGETS_DEFAULT, ...(config.budgets || {}) };

  let run = loadRun(itemId, { home });
  if (!run) {
    // NO se replanifica solo. Un recorrido que arma su propio plan puede cambiar
    // el alcance sin que nadie lo apruebe, y la aprobacion humana del plan es el
    // unico punto de control que tiene todo el flujo.
    throw new Error(`no hay recorrido para el item ${itemId}: corre \`noxloop plan ${itemId}\` primero`);
  }

  if (deps.dryRun) {
    return {
      item: itemId,
      dryRun: true,
      pr: null,
      plan: run.tasks.map((t) => ({
        task: t.id, repo: t.repo, tier: t.tier, status: t.status,
        haria: pasosDe(t, politicaDeTier(config, t.tier)),
      })),
    };
  }

  const lock = acquire(`run-${itemId}`, { home });
  if (!lock.ok) {
    throw new Error(
      `otro proceso esta recorriendo el item ${itemId} (pid ${lock.heldBy?.pid} en ${lock.heldBy?.host}). ` +
        `Dos recorridos sobre el mismo item no producen el doble de trabajo: producen dos veces la misma tarea.`,
    );
  }

  try {
    const { itemBranch, baseBranch, integrationPath } = deps.resolve(run.tasks[0].repo);
    setItemFields(run, { branch: itemBranch, baseBranch, prTarget: baseBranch }, { home });

    // LA RAMA DEL ITEM SE PONE AL DIA ANTES DE EMPEZAR, y no al final.
    //
    // Arrancar sobre una base vieja significa que cada tarea va a rebasar contra
    // algo que ya cambio, y el conflicto aparece AL INTEGRAR en vez de al
    // empezar — que es exactamente lo que la cola existe para evitar. Pasaba de
    // verdad cuando el worktree del item venia de un recorrido anterior: la
    // funcion existia en la cola y solo la usaba el recorrido de un hito, asi
    // que un `noxloop run` nunca la llamaba.
    const alDia = syncItemBranch(integrationPath, itemBranch, baseBranch);
    if (!alDia.ok) {
      // No se fuerza. Que la rama del item conflictue con su base es una
      // decision humana, y decirlo ahora cuesta un mensaje; descubrirlo al
      // integrar cuesta el recorrido.
      log.warn(`la rama del item no se pudo poner al dia: ${alDia.reason}`);
    } else {
      log.info(`rama del item al dia con ${alDia.base}`);
    }

    await escribirEstadoEnGestor(run, "in_progress", deps);

    // ------------------------------------------------- el bucle principal
    let huellaPrevia = huella(run);
    let quietas = 0;
    const stallRounds = config.limits?.stallRounds ?? 2;

    while (true) {
      run = loadRun(itemId, { home });
      const rs = readySet(run, { maxParallelTasks: config.limits?.maxParallelTasks ?? deps.maxParallelTasks ?? 4 });
      if (rs.done) break;

      if (rs.ready.length) {
        log.info(`lanzando ${rs.ready.length} tarea(s) en paralelo: ${rs.ready.join(", ")}`);
        // EL PUNTO DE PARALELISMO. `allSettled` y no `all`: una tarea que falla
        // no puede abortar a las demas, y el estado de cada una ya quedo en
        // disco antes de que esta promesa resuelva.
        const resueltas = await Promise.allSettled(rs.ready.map((id) => pipelineDeTarea(itemId, id, deps, budgets)));

        // PERO SE REPORTA. `allSettled` se traga el error, y un pipeline que
        // lanza deja su tarea parada sin que nada lo diga: el recorrido da dos
        // vueltas sin avanzar y corta por estancado, culpando al estado en vez
        // de al error. Paso de verdad, y costo una hora de buscar en el lugar
        // equivocado.
        resueltas.forEach((res, i) => {
          if (res.status === "rejected") {
            const causa = res.reason?.stack || res.reason?.message || String(res.reason);
            log.error(`la tarea ${rs.ready[i]} lanzo y quedo parada: ${causa}`);
          }
        });
      }

      // La cola corre despues de cada vuelta, no al final: es lo que libera las
      // dependencias duras de las tareas siguientes.
      run = loadRun(itemId, { home });
      if (run.tasks.some((t) => t.status === "queued")) {
        const r = await drain(run, {
          home, config, log,
          runGate: deps.runGate,
          resolve: deps.resolve,
        });
        if (r.integrated.length) log.info(`integradas: ${r.integrated.join(", ")}`);
      }

      run = loadRun(itemId, { home });
      const ahora = huella(run);
      if (ahora === huellaPrevia) {
        quietas++;
        log.warn(`el estado no avanzo (${quietas}/${stallRounds})`);
        if (quietas >= stallRounds) {
          log.error("el estado dejo de avanzar; corto el recorrido");
          break;
        }
      } else {
        quietas = 0;
        huellaPrevia = ahora;
      }
    }

    // --------------------------------- auditoria de revisiones que faltan
    run = await auditarRevisiones(itemId, deps, budgets);

    // ------------------------------------------------------------ el PR
    const integradas = run.tasks.filter((t) => t.status === "integrated").map((t) => t.id);
    const bloqueadas = run.tasks.filter((t) => t.status === "blocked").map((t) => t.id);

    if (integradas.length === 0) {
      await escribirEstadoEnGestor(run, "blocked", deps);
      return {
        item: itemId, pr: null, integrated: [], blocked: bloqueadas,
        reason: `ninguna de las ${run.tasks.length} tareas llego a terminar`,
      };
    }

    const gaps = Object.fromEntries(
      [...new Set(run.tasks.map((t) => t.repo))].map((r) => [r, config.repos?.[r]?.gaps || []]),
    );
    const destino = deps.resolve(run.tasks[0].repo);
    const pr = await deps.createPR(run, {
      cwd: destino.integrationPath, base: run.item.prTarget || destino.baseBranch, gaps,
      cli: config.forge?.cli, refs: deps.prRefs || [],
    });

    if (pr?.url) {
      setItemFields(run, { pr: pr.url }, { home });
      await anotarEnGestor(run, pr, deps);
      // `in_review` es opcional: hay plantillas de proceso donde no existe, y el
      // motor no escribe un estado que el proyecto no tiene.
      await escribirEstadoEnGestor(run, "in_review", deps);
    }

    return {
      item: itemId,
      pr: pr?.url || null,
      integrated: integradas,
      blocked: bloqueadas,
      prAlreadyExisted: Boolean(pr?.alreadyExisted),
      // LA CAUSA REAL, TEXTUAL. Antes se tiraba: `createPR` devuelve el stderr
      // del forge y este resumen retornaba `pr: null` sin motivo, asi que el
      // reporte decia "sin PR: no se llego a abrir" y la causa —que la rama no
      // esta empujada, que faltan permisos, que ya hay un PR— se perdia. Es el
      // mismo fallo que el motor prohibe en una tarea: nunca resumir un error a
      // "falla el build".
      ...(pr?.url ? {} : { reason: pr?.error || "el forge no devolvio una URL ni un error" }),
      // El hito lo consume para su techo de gasto.
      spent: loadRun(itemId, { home })?.spent || { usd: 0, calls: 0 },
    };
  } finally {
    for (const t of (loadRun(itemId, { home })?.tasks || [])) {
      if (t.worktree) clearActiveTask({ home, worktree: t.worktree });
    }
    lock.release();
  }
}

// ------------------------------------------------------ una tarea, entera

async function pipelineDeTarea(itemId, taskId, deps, budgets) {
  const { home, config, log = consolaMuda() } = deps;
  const bitacora = log.child ? log.child({ run: itemId, task: taskId }) : log;
  const politica = politicaDeTier(config, tareaDe(loadRun(itemId, { home }), taskId).tier);

  for (let vuelta = 0; vuelta < MAX_VUELTAS_POR_TAREA; vuelta++) {
    // El estado se re-lee del disco en CADA vuelta. Es lo que hace que el
    // driver no tenga un "donde iba" que pueda quedar desincronizado.
    let run = loadRun(itemId, { home });
    const t = tareaDe(run, taskId);
    if (["integrated", "blocked", "queued"].includes(t.status)) return;

    switch (t.status) {
      case "pending": {
        await abrirTarea(run, taskId, deps);
        break;
      }

      case "in_progress": {
        const r = await fase("RED", run, taskId, politica, deps);
        if (await cortoPorPresupuesto(r, itemId, taskId, deps)) return;
        run = loadRun(itemId, { home });
        const ev = verificarRojo(run, taskId, deps);
        if (ev.rojo) {
          transition(run, taskId, "red", { home, redVerified: ev.evidencia });
          bitacora.info(`rojo verificado: ${ev.evidencia.command} salio ${ev.evidencia.exitCode}`);
          // El commit del test va SOLO, y antes del de la implementacion. Es lo
          // que hace verificable el orden en el historial del PR sin leer el
          // motor — y un commit unico por tarea borraria esa evidencia.
          const c = commitPaths(t.worktree, t.testFiles, mensajeDeFase("RED", t, run.item));
          if (c.committed) bitacora.info(`commit del test: ${c.sha.slice(0, 7)}`);
        } else {
          const b = bump(run, taskId, "red", { home, budgets });
          bitacora.warn(`no hay rojo (${ev.motivo}) — intento ${b.count}/${b.budget}`);
          if (b.exhausted) {
            transition(run, taskId, "blocked", { home, failure: `no se llego a un rojo verificado: ${ev.motivo}` });
            return;
          }
        }
        break;
      }

      case "red": {
        const r = await fase("GREEN", run, taskId, politica, deps);
        if (await cortoPorPresupuesto(r, itemId, taskId, deps)) return;
        run = loadRun(itemId, { home });
        const ev = correrElTest(run, taskId, deps);
        if (ev.ok) {
          transition(run, taskId, "green", { home });
          bitacora.info("el test pasa");
        } else {
          const b = bump(run, taskId, "green", { home, budgets });
          bitacora.warn(`el test sigue rojo — intento ${b.count}/${b.budget}`);
          if (b.exhausted) {
            transition(run, taskId, "blocked", { home, failure: `el test no llego a pasar:\n${ev.output}` });
            return;
          }
        }
        break;
      }

      case "green": {
        // Una tarea que volvio a green con un fallo pendiente —un hallazgo del
        // revisor, o un conflicto al rebasar— necesita que alguien lo arregle
        // ANTES de volver a correr el gate. Sin esto el gate pasa, la tarea
        // vuelve a revision, y choca con el mismo hallazgo sin haber cambiado
        // una linea: un bucle que solo lo corta el tope de vueltas.
        if (t.lastFailure) {
          const b = bump(run, taskId, "green", { home, budgets });
          bitacora.info(`hay un fallo pendiente que atender — intento ${b.count}/${b.budget}`);
          if (b.exhausted) {
            transition(loadRun(itemId, { home }), taskId, "blocked", {
              home, failure: `no se pudo resolver lo pendiente:\n${t.lastFailure}`,
            });
            return;
          }
          const fix = await fase("GREEN", run, taskId, politica, deps, {
            extra: `Hay que resolver esto antes de seguir:\n${t.lastFailure}`,
          });
          if (await cortoPorPresupuesto(fix, itemId, taskId, deps)) return;
          clearLastFailure(loadRun(itemId, { home }), taskId, { home });
          break;
        }

        const g = deps.runGate(t.repo, t.worktree, config, { kind: politica.gate });
        run = loadRun(itemId, { home });
        if (g.ok) {
          transition(run, taskId, "gated", { home, evidence: g });
          bitacora.info(`gate verde${g.gaps?.length ? ` (con huecos declarados: ${g.gaps.join(", ")})` : ""}`);
          // Con el gate verde, y no antes: entre GREEN y el gate puede haber
          // varios intentos de arreglo, y commitear cada uno llenaria el PR de
          // pasos intermedios que no aportan.
          const ci = commitPaths(t.worktree, t.targetFiles, mensajeDeFase("GREEN", t, run.item));
          if (ci.committed) bitacora.info(`commit de la implementacion: ${ci.sha.slice(0, 7)}`);
        } else {
          const b = bump(run, taskId, "gate", { home, budgets });
          bitacora.warn(`gate rojo (exit ${g.exitCode}) — intento ${b.count}/${b.budget}`);
          if (b.exhausted) {
            transition(run, taskId, "blocked", {
              home,
              failure: `el gate no paso (exit ${g.exitCode}${g.timedOut ? ", TIMEOUT" : ""}):\n${g.output}`,
            });
            return;
          }
          // No se reintenta el gate a secas: se le devuelve el fallo al modelo
          // para que lo arregle. Volver a correr lo mismo daria lo mismo.
          const fix = await fase("GREEN", run, taskId, politica, deps, { extra: `El gate fallo:\n${g.output}` });
          if (await cortoPorPresupuesto(fix, itemId, taskId, deps)) return;
        }
        break;
      }

      case "gated": {
        if (politica.fanout && politica.review) {
          const r = await revisionEnAbanico(run, taskId, politica, deps);
          run = loadRun(itemId, { home });
          const b = bump(run, taskId, "review", { home, budgets });
          if (await cortoPorPresupuesto(r, itemId, taskId, deps)) return;

          if (r.findings === "blocking") {
            if (b.exhausted) {
              transition(run, taskId, "blocked", {
                home, failure: `el abanico sigue encontrando hallazgos bloqueantes despues de ${b.count} vueltas`,
              });
              return;
            }
            transition(run, taskId, "green", { home, failure: `hallazgo bloqueante de la sintesis: ${r.text || "sin detalle"}` });
            bitacora.warn("el abanico encontro algo bloqueante: vuelve a green");
          } else if (r.findings === null) {
            // No saber NO es aprobar. Una sintesis que no produjo veredicto es
            // una revision que no ocurrio.
            const b2 = bump(run, taskId, "review", { home, budgets });
            if (b2.exhausted) {
              transition(run, taskId, "blocked", { home, failure: `la sintesis del abanico no produjo veredicto: ${r.text || "(nada)"}` });
              return;
            }
            bitacora.warn("la sintesis no produjo veredicto; se reintenta");
          } else {
            transition(run, taskId, "reviewed", { home });
          }
          break;
        }

        if (!politica.review) {
          // Renuncia EXPLICITA y declarada en configuracion. Queda registrada en
          // la tarea y se reporta en el PR.
          transition(run, taskId, "reviewed", { home });
          run = loadRun(itemId, { home });
          transition(run, taskId, "queued", {
            home,
            reviewWaived: `el tier "${t.tier}" declara review: false en la configuracion`,
          });
          break;
        }
        const r = await fase("REVIEW", run, taskId, politica, deps);
        run = loadRun(itemId, { home });
        // El contador se consume SIEMPRE, haya hallazgos o no: es la constancia
        // de que la revision ocurrio.
        const b = bump(run, taskId, "review", { home, budgets });
        if (await cortoPorPresupuesto(r, itemId, taskId, deps)) return;

        if (r.findings === "blocking") {
          if (b.exhausted) {
            transition(run, taskId, "blocked", {
              home, failure: `la revision sigue encontrando hallazgos bloqueantes despues de ${b.count} vueltas`,
            });
            return;
          }
          transition(run, taskId, "green", { home, failure: `hallazgo bloqueante del revisor: ${r.text || "sin detalle"}` });
          bitacora.warn("hallazgo bloqueante: vuelve a green");
        } else {
          transition(run, taskId, "reviewed", { home });
        }
        break;
      }

      case "reviewed": {
        transition(run, taskId, "queued", { home });
        bitacora.info("encolada para integracion");
        return;
      }

      default:
        return;
    }
  }

  const run = loadRun(itemId, { home });
  transition(run, taskId, "blocked", {
    home, failure: `la tarea dio ${MAX_VUELTAS_POR_TAREA} vueltas sin llegar a un estado terminal`,
  });
}

// ---------------------------------------------------------------- piezas

async function abrirTarea(run, taskId, deps) {
  const { home, config } = deps;
  const t = tareaDe(run, taskId);
  const { repoPath, itemBranch } = deps.resolve(t.repo);

  if (!t.worktree) {
    const añadir = deps.addWorktree || worktreeMod.add;
    const rama = `task/${run.item.id}-${taskId}`;
    const dest = join(home, "worktrees", t.repo, `${run.item.id}-${taskId}`);
    const wt = await añadir(repoPath, { branch: rama, base: itemBranch, dest, fetch: false });
    setTaskFields(run, taskId, { worktree: wt.path, branch: wt.branch }, { home });
  }

  const actualizada = tareaDe(loadRun(run.item.id, { home }), taskId);
  // El puntero es POR WORKTREE: con varias tareas en vuelo, es lo que permite a
  // los hooks saber cual les toca.
  // La lista de permitidos viaja con el puntero porque el hook corre como
  // proceso aparte y no tiene acceso a la configuracion.
  setActiveTask(run.item.id, taskId, {
    home,
    worktree: actualizada.worktree,
    allowedCommands: comandosPermitidos(config.repos?.[t.repo]),
  });
  transition(loadRun(run.item.id, { home }), taskId, "in_progress", { home });
}

/**
 * Las cuatro lentes del abanico. Corren a la vez, asi que el orden importa poco.
 *
 * Son LENTES y no agentes con nombre a proposito: un agente externo que puede no
 * estar instalado convierte el abanico en una dependencia silenciosa — si falta,
 * la revision se degrada y nadie se entera.
 */
const LENTES = ["correccion", "seguridad", "estilo", "alcance"];

/**
 * La revision de una tarea grande, repartida en cuatro miradas.
 *
 * POR QUE EXISTE, con la aritmetica delante. Una sola pasada con cuatro
 * criterios en la cabeza pierde el hallazgo que quedo tapado por los otros
 * tres. Cuatro pasadas con un criterio cada una no lo pierden, y el reloj pasa
 * de una latencia de invocacion a **max(las cuatro) + la sintesis**: dos, no
 * cinco. Cuesta cinco invocaciones y tarda dos.
 *
 * SOLO EN TIER `large`. En los otros tres es gasto sin retorno, y ese es el
 * gasto del que este proyecto viene: hay un antecedente medido de un hito que le
 * dio el pipeline completo a 59 tareas.
 *
 * ESTABA DECLARADO Y NO LO LEIA NADIE. `fanout` vivia en la politica de tiers y
 * en la configuracion de ejemplo —`large` lo tiene en `true`— y ningun camino
 * del motor lo consultaba: la revision de una tarea grande era una sola
 * invocacion, con la configuracion afirmando lo contrario.
 *
 * POR QUE NO SE USA LA TOOL `Workflow` PARA ESTO, y esta medido: el mismo
 * fan-out de cuatro por esa via tardo 55,6s contra 18,1s con `query()`
 * concurrentes, y costo 2,5 veces mas. No es serializacion —los cuatro
 * arrancaban dentro de 4 ms— sino la latencia por subagente y su prompt de
 * sistema de ~27k tokens. Para el reloj, varias `query()` concurrentes es el
 * camino.
 */
async function revisionEnAbanico(run, taskId, politica, deps) {
  const t = tareaDe(run, taskId);
  const log = deps.log || consolaMuda();

  // CADA LENTE ABRE SU PROPIA SESION, sin retomar la de la tarea ni la de otra
  // lente. La independencia es el punto: una lente que ve los hallazgos de otra
  // deja de ser una mirada independiente, y el abanico se vuelve una sola
  // pasada larga con mas pasos.
  const informes = await Promise.all(
    LENTES.map((lente) =>
      deps.runPhase({
        phase: "REVIEW",
        lens: lente,
        taskId,
        task: t,
        item: run.item,
        cwd: t.worktree,
        resume: null,
        model: politica.model,
        effort: politica.effort,
        tier: t.tier,
        prompt: `/noxloop-task ${run.item.id} ${taskId} --phase REVIEW --lens ${lente}`,
      }).then((r) => ({ lente, r: r || { ok: false, text: "la lente no devolvio nada", findings: null } })),
    ),
  );

  const cortada = informes.find((x) => x.r.budgetExhausted);
  if (cortada) return cortada.r;

  for (const { lente, r } of informes) {
    log.info(`lente ${lente}: ${r.findings || "sin veredicto"}`);
  }

  // UN SOLO JUEZ, con los cuatro informes delante. Cuatro veredictos sin
  // jerarquia producen hallazgos contradictorios y nadie con autoridad para
  // resolverlos — y el motor lee UN marcador, asi que cual gana dependeria de
  // cual texto se leyo primero.
  const resumen = informes
    .map(({ lente, r }) => `### lente: ${lente}\nveredicto: ${r.findings || "sin veredicto"}\n\n${String(r.text || "").slice(0, 4000)}`)
    .join("\n\n");

  return deps.runPhase({
    phase: "REVIEW-SINTESIS",
    taskId,
    task: t,
    item: run.item,
    cwd: t.worktree,
    resume: null,
    model: politica.model,
    effort: politica.effort,
    tier: t.tier,
    prompt:
      `/noxloop-task ${run.item.id} ${taskId} --phase REVIEW --sintesis\n\n` +
      `Cuatro lentes miraron este diff por separado. Decidi vos, con los cuatro ` +
      `informes delante, y escribi el marcador solo si de verdad corresponde.\n\n${resumen}`,
  });
}

async function fase(nombre, run, taskId, politica, deps, opts = {}) {
  const t = tareaDe(run, taskId);
  const r = await deps.runPhase({
    phase: nombre,
    taskId,
    task: t,
    item: run.item,
    cwd: t.worktree,
    // Sesion NUEVA en la primera fase de la tarea, RETOMADA en las siguientes.
    // Retomar reusa el contexto que sirve; abrir nueva entre tareas evita la
    // degradacion por compactacion.
    resume: t.sessionId || null,
    model: politica.model,
    effort: politica.effort,
    prompt: promptDeFase(nombre, run, t, opts.extra),
    tier: t.tier,
  });
  if (r?.sessionId && r.sessionId !== t.sessionId) {
    setTaskFields(loadRun(run.item.id, { home: deps.home }), taskId, { sessionId: r.sessionId }, { home: deps.home });
  }

  // TODA invocacion se anota, con costo o sin el. El techo de gasto de un hito
  // lee esto para decidir si se detiene, y hasta ahora nadie lo escribia: el
  // techo existia en la configuracion y en el codigo que lo consulta, y no podia
  // dispararse nunca. Un limite que se lee como puesto y no lo esta es peor que
  // no tenerlo.
  try {
    addSpend(loadRun(run.item.id, { home: deps.home }), { usd: r?.usd ?? null, calls: 1 }, { home: deps.home });
  } catch (e) {
    (deps.log || consolaMuda()).warn(`no se pudo anotar el gasto de la fase: ${e.message}`);
  }

  return r || { ok: false, budgetExhausted: false, text: "la fase no devolvio nada" };
}

function promptDeFase(nombre, run, t, extra) {
  const base = `/noxloop-task ${run.item.id} ${t.id} --phase ${nombre}`;
  return extra ? `${base}\n\n${extra}` : base;
}

async function cortoPorPresupuesto(r, itemId, taskId, deps) {
  if (!r?.budgetExhausted) return false;
  // Un corte por presupuesto NO es que la tarea este mal: es que la invocacion
  // se quedo sin plata a mitad. Tratarlo como fallo del codigo manda a revisar
  // el lugar equivocado.
  transition(loadRun(itemId, { home: deps.home }), taskId, "blocked", {
    home: deps.home,
    failure: `la invocacion se corto por presupuesto (${r.subtype || "budget"}) a mitad de la fase, sin terminarla`,
  });
  return true;
}

/**
 * El rojo se verifica CORRIENDO el test. Y antes se verifica que el archivo
 * exista: un import que falla porque el modulo no esta tambien sale con codigo
 * distinto de cero, y aceptarlo seria conceder el rojo a una tarea donde nadie
 * escribio un test.
 */
function verificarRojo(run, taskId, deps) {
  const t = tareaDe(run, taskId);
  if (!t.testFiles?.length) {
    return { rojo: false, motivo: `la tarea no declara testFiles${t.noTestsBecause ? ` (${t.noTestsBecause})` : ""}` };
  }
  for (const f of t.testFiles) {
    if (!existsSync(join(t.worktree, f))) {
      return { rojo: false, motivo: `el archivo de test ${f} no existe todavia` };
    }
  }
  const ev = correrElTest(run, taskId, deps);
  if (ev.ok) {
    return { rojo: false, motivo: "el test pasa sin el cambio, asi que no prueba nada" };
  }
  return { rojo: true, evidencia: ev };
}

function correrElTest(run, taskId, deps) {
  const t = tareaDe(run, taskId);
  return deps.runSingleTest(t.repo, t.worktree, t.testFiles[0], deps.config, {});
}

/**
 * Antes del PR, mira el contador de revision de cada tarea que va a entrar.
 *
 * Es defensivo a proposito: la guarda de estado ya impide encolar sin revision,
 * asi que lo que esto atrapa es un archivo de estado editado a mano o escrito
 * por otra version del motor. El driver no confia en que el contador este bien
 * — lo mira, porque es estado en disco.
 */
async function auditarRevisiones(itemId, deps, budgets) {
  const { home, config, log = consolaMuda() } = deps;
  let run = loadRun(itemId, { home });

  for (const t of run.tasks) {
    const entra = ["queued", "integrated"].includes(t.status);
    if (!entra || (t.attempts?.review ?? 0) > 0 || t.reviewWaived) continue;
    if (!t.worktree) continue;

    const politica = politicaDeTier(config, t.tier);
    for (let intento = 1; intento <= 2; intento++) {
      log.warn(`${t.id} entra al PR con el contador de revision en cero — pidiendola (${intento}/2)`);
      const r = await fase("REVIEW", run, t.id, politica, deps);
      run = loadRun(itemId, { home });
      bump(run, t.id, "review", { home, budgets });
      if (r?.findings === "blocking") {
        log.warn(`${t.id}: la revision encontro algo bloqueante, pero ya estaba integrada; queda declarado en el PR`);
      }
      run = loadRun(itemId, { home });
      if ((tareaDe(run, t.id).attempts.review ?? 0) > 0) break;
    }
  }
  return loadRun(itemId, { home });
}

// ------------------------------------------------------------- el gestor

/**
 * El orden del ciclo de vida. `blocked` no tiene rango: es una senial lateral
 * que puede ocurrir desde cualquier punto, y de la que se puede volver.
 */
const RANGO_ESTADOS = { todo: 0, in_progress: 1, in_review: 2, done: 3 };

async function escribirEstadoEnGestor(run, estadoCanonico, deps) {
  const { provider, providerCtx, home, log = consolaMuda() } = deps;
  if (!provider || typeof provider.setState !== "function") return;
  if (!provider.capabilities?.().setState) return;

  // NUNCA HACIA ATRAS, Y NUNCA DOS VECES. `providerStateWritten` es la marca de
  // agua: relanzar un recorrido ya terminado no puede devolver el ticket de
  // "en revision" a "en curso". Sin esta comparacion, un relanzamiento hace
  // exactamente eso — y el tablero pasa a mentir en la direccion mas confusa
  // posible, porque parece que el trabajo volvio a empezar.
  const escrito = run.item.providerStateWritten;
  if (estadoCanonico !== "blocked" && escrito && escrito !== "blocked") {
    const rangoActual = RANGO_ESTADOS[escrito] ?? -1;
    const rangoNuevo = RANGO_ESTADOS[estadoCanonico] ?? 0;
    if (rangoNuevo <= rangoActual) return;
  }
  if (escrito === estadoCanonico) return;
  try {
    const r = await provider.setState(run.item.id, estadoCanonico, providerCtx);
    if (r?.written) setItemFields(run, { providerStateWritten: estadoCanonico }, { home });
    else log.info(`el gestor no tiene estado para "${estadoCanonico}": no se escribio nada`);
  } catch (e) {
    log.warn(`no se pudo escribir el estado en el gestor: ${e.message}`);
  }
}

async function anotarEnGestor(run, pr, deps) {
  const { provider, providerCtx, log = consolaMuda() } = deps;
  if (!provider) return;
  const caps = provider.capabilities?.() || {};
  try {
    if (caps.linkUrl && typeof provider.linkUrl === "function") {
      await provider.linkUrl(run.item.id, pr.url, "Pull request", providerCtx);
    } else if (caps.comment && typeof provider.comment === "function") {
      // Degradacion declarada: sin `linkUrl`, el PR va como comentario.
      await provider.comment(run.item.id, `Pull request abierto por noxloop: ${pr.url}`, providerCtx);
    }
  } catch (e) {
    log.warn(`no se pudo anotar el PR en el ticket: ${e.message}`);
  }
}

// ------------------------------------------------------------- utilidades

function tareaDe(run, taskId) {
  const t = run.tasks.find((x) => x.id === taskId);
  if (!t) throw new Error(`la tarea ${taskId} no existe en el recorrido del item ${run.item.id}`);
  return t;
}

/** Huella del estado. Si dos vueltas dan la misma, el recorrido no avanza. */
function huella(run) {
  return run.tasks
    .map((t) => `${t.id}:${t.status}:${t.redVerified}:${Object.values(t.attempts || {}).join("")}`)
    .join("|");
}

function pasosDe(t, politica) {
  const pasos = ["abrir worktree", "RED (test primero)", "GREEN", `GATE (${politica.gate})`];
  if (politica.review) pasos.push("REVIEW");
  else pasos.push(`REVIEW omitida: el tier "${t.tier}" la declara en false`);
  pasos.push("cola de integracion");
  return pasos;
}

function consolaMuda() {
  const l = { info() {}, warn() {}, error() {}, child() { return l; } };
  return l;
}
