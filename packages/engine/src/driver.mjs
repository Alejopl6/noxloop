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
import { execFileSync } from "node:child_process";
import {
  loadRun, saveRun, transition, bump, setTaskFields, setItemFields,
  setActiveTask, clearActiveTask, clearLastFailure, addSpend, retomarEnRojo, BUDGETS_DEFAULT,
} from "./state.mjs";
import { readySet } from "./scheduler.mjs";
import { drain, syncItemBranch } from "./merge-queue.mjs";
import { acquire } from "./lock.mjs";
import * as worktreeMod from "./worktree.mjs";
import { commitPaths, mensajeDeFase } from "./vcs.mjs";
// De quien es el fallo del gate: ver `claseDeFallo` en gate.mjs.
import { claseDeFallo, huellaDeFallo, noConverge } from "./gate.mjs";
// El texto ajeno entra al prompt marcado como dato: ver prompt.mjs.
import { comoDato, recorteQueAvisa } from "./prompt.mjs";
import { comandosPermitidos, entornoDeFase } from "./wiring.mjs";
// El marcador con el que el revisor declara un bloqueo: ver `conVeredicto`.
import { veredictoDeRevision } from "./runner.mjs";
// El orden del TDD en un runtime sin hooks, forzado despues de la fase.
import { fotoDeRamas, permitidosEnFase, verificarAlcance } from "./alcance-de-fase.mjs";

const TIER_POR_DEFECTO = { model: null, effort: "high", gate: "full", review: true, fanout: false };

/**
 * La peticion de fase COMPLETA, la unica forma que un runtime puede ejecutar.
 *
 * EL FALLO QUE CIERRA. Los tres call sites de este archivo construian la
 * peticion SIN `env`, y `validarPeticion` del contrato de adaptadores la
 * rechazaba por eso — con el motivo escrito ahi: "heredar el del motor no es un
 * modo degradado: es la fuga". Mientras faltara, el adaptador `fake` no podia
 * ser invocado por el motor: el recorrido de punta a punta tenia que interponer
 * una funcion que rellenaba el campo, o sea que probaba una costura que no
 * cerraba.
 *
 * EL DRIVER NO SABE QUE VARIABLES SON. Pide el entorno a quien lo cableo y lo
 * pone en la peticion; cuales viajan lo deciden el cableado y el runtime. Que
 * el motor lo DECLARE en vez de dejar que el subproceso lo herede es todo el
 * punto: un campo que el llamante no escribe es un campo que alguien rellena
 * por abajo.
 *
 * @param {any} deps
 * @param {any} campos
 */
function peticionDeFase(deps, campos) {
  return {
    ...campos,
    env: typeof deps.entorno === "function" ? deps.entorno(campos) : entornoDeFase(deps.config || {}),
    // CUALES DE ESAS VARIABLES SON SECRETAS. Si no se sabe, el campo NO se
    // manda: la ausencia significa "miralas todas" (denegar por defecto), y
    // mandar una lista vacia seria afirmar que ninguna lo es.
    ...(deps.secretos ? { secretos: deps.secretos } : {}),
  };
}

/**
 * El veredicto de una revision, derivado AQUI cuando el runtime no lo trae.
 *
 * EL CABLE QUE ESTO EVITA CORTAR, y casi se corta al enchufar los adaptadores.
 * El driver decide con `r.findings === "blocking"`, y ese campo lo producia
 * `reduceMessages` de `runner.mjs` — que era quien invocaba al modelo. Un
 * `PhaseResult` del contrato de adaptadores NO lo lleva, asi que en cuanto el
 * cableado monto el runtime por contrato la comparacion habria vuelto a ser
 * siempre falsa: la revision deja de poder bloquear nada y nadie se entera. Es
 * exactamente el fallo que `veredicto-y-fanout.test.mjs` existe para que no
 * vuelva, y los tests no lo habrian visto porque sus dobles rellenan el campo
 * a mano.
 *
 * SE DERIVA EN EL MOTOR Y NO EN CADA ADAPTADOR. El marcador es el protocolo
 * del motor con su propio revisor —lo exige `reviewer.md`, que es del motor—,
 * no una capacidad de un runtime. Pedirselo a cada adaptador seria duplicarlo
 * en todos y darle a cada uno la oportunidad de interpretarlo distinto, que es
 * la regla 3 del contrato al reves.
 *
 * SE RESPETA EL QUE YA VIENE. `null` es un veredicto ("no se sabe") distinto de
 * no haberlo declarado, asi que se mira si el campo ESTA, no si tiene valor.
 *
 * @param {any} r
 */
function conVeredicto(r) {
  if (!r || typeof r !== "object") return r;
  return Object.hasOwn(r, "findings") ? r : { ...r, findings: veredictoDeRevision(r.text) };
}

/** Tope de vueltas de la maquina de estados por tarea. Sin esto, un estado que
 * no avanza y no consume presupuesto seria un bucle infinito silencioso. */
const MAX_VUELTAS_POR_TAREA = 40;

function politicaDeTier(config, tier) {
  return { ...TIER_POR_DEFECTO, ...(config.tiers?.[tier] || {}) };
}

/**
 * Si una fase es de revision. Cubre `REVIEW` y `REVIEW-SINTESIS`.
 *
 * Se compara por prefijo y no por igualdad para que una fase de revision nueva
 * —otra lente, otra sintesis— herede la regla sin que nadie se acuerde de
 * anadirla a una lista. Una lista de nombres exactos es justo lo que dejo el
 * agujero que esto cierra.
 *
 * @param {string} nombre
 */
export function esRevision(nombre) {
  return /^REVIEW(\b|[-_])/i.test(String(nombre));
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
    // DONDE TERMINA, decidido una vez y escrito en el estado: el servicio y el
    // board leen del archivo si esperar un PR o una rama. Con `commit` no hay
    // PR al que apuntar, y un `prTarget` escrito diria que lo habra.
    const termino = terminoDe(config);
    setItemFields(
      run,
      { branch: itemBranch, baseBranch, prTarget: termino === "pr" ? baseBranch : null, termino },
      { home },
    );

    // LA RAMA DEL ITEM SE PONE AL DIA ANTES DE EMPEZAR, y no al final.
    //
    // Arrancar sobre una base vieja significa que cada tarea va a rebasar contra
    // algo que ya cambio, y el conflicto aparece AL INTEGRAR en vez de al
    // empezar — que es exactamente lo que la cola existe para evitar. Pasaba de
    // verdad cuando el worktree del item venia de un recorrido anterior: la
    // funcion existia en la cola y solo la usaba el recorrido de un hito, asi
    // que un `noxloop run` nunca la llamaba.
    // Con `commit`, contra la base LOCAL y sin fetch: el recorrido no habla
    // con ningun remoto, lo haya o no.
    const alDia = syncItemBranch(integrationPath, itemBranch, baseBranch, { local: termino === "commit" });
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

    // --------------------------------------------- o la rama, sin PR
    //
    // EL TERMINO `commit`. Todo lo anterior —worktrees, TDD, gate, revision,
    // cola de integracion— es identico; lo que cambia es el ultimo paso. El
    // trabajo YA esta commiteado en la rama del item, y esa rama ya esta en el
    // repositorio del operador (los worktrees comparten refs): no hay nada que
    // empujar ni que abrir. Queda del lado seguro del principio IV con mas
    // margen que un PR — nada sale de la maquina y la base no se toca.
    if (termino === "commit") {
      return await entregarEnRama(run, integradas, bloqueadas, deps);
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

/**
 * Donde termina el recorrido. Lo que no sea `commit` es `pr`: el PR es el
 * termino por defecto del esquema y el unico que existio hasta ahora, asi que
 * una configuracion sin el campo sigue haciendo lo que hacia.
 *
 * @param {any} config
 * @returns {"pr"|"commit"}
 */
export function terminoDe(config) {
  return config?.termino === "commit" ? "commit" : "pr";
}

/**
 * Los commits de la rama del item que no estan en la base, del mas viejo al
 * mas nuevo: el orden en que se leen (el test antes que la implementacion).
 *
 * @param {string} cwd
 * @param {string} base
 * @param {string} rama
 * @returns {Array<{sha: string, asunto: string}>}
 */
function commitsDeLaRama(cwd, base, rama) {
  const salida = execFileSync("git", ["-C", cwd, "log", "--reverse", "--format=%H%x09%s", `${base}..${rama}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!salida) return [];
  return salida.split("\n").map((linea) => {
    const i = linea.indexOf("\t");
    return { sha: linea.slice(0, i), asunto: linea.slice(i + 1) };
  });
}

/**
 * El final del termino `commit`: la rama del item, lista, dicha en el estado,
 * en el gestor y en el resultado.
 *
 * NO LLAMA A `createPR`, NI HACE FETCH NI PUSH. Es lo que distingue este
 * termino, y el test de punta a punta lo mide con un `createPR` que cuenta sus
 * llamadas y un repositorio sin remoto.
 *
 * NUNCA DOS VECES EL MISMO COMENTARIO. Como `anotarEnGestor` con un PR que ya
 * existia: un relanzamiento que encuentra la rama con la MISMA punta no vuelve
 * a comentar. Si la punta cambio —se integro algo mas—, si: es otra entrega.
 *
 * @param {any} run
 * @param {string[]} integradas
 * @param {string[]} bloqueadas
 * @param {any} deps
 */
async function entregarEnRama(run, integradas, bloqueadas, deps) {
  const { home, log = consolaMuda() } = deps;
  const destino = deps.resolve(run.tasks[0].repo);
  const rama = destino.itemBranch;
  const base = destino.baseBranch;
  const commits = commitsDeLaRama(destino.integrationPath, base, rama);
  const head = execFileSync("git", ["-C", destino.integrationPath, "rev-parse", rama], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

  const previa = run.item.ramaLista;
  const ramaLista = { rama, base, head, commits };
  setItemFields(run, { ramaLista }, { home });

  if (previa?.head !== head) await anotarRamaEnGestor(run, ramaLista, deps);
  else log.info("la rama ya estaba entregada con esta misma punta: no se repite el comentario");
  await escribirEstadoEnGestor(run, "in_review", deps);

  return {
    item: run.item.id,
    termino: "commit",
    pr: null,
    rama,
    base,
    commits,
    integrated: integradas,
    blocked: bloqueadas,
    spent: loadRun(run.item.id, { home })?.spent || { usd: 0, calls: 0 },
  };
}

/**
 * El comentario de cierre del termino `commit`: la rama primero —es lo que se
 * busca—, como mirarla, y lo integrado y lo bloqueado por id con su causa, igual
 * que el del PR. Sin adjunto: no hay URL que adjuntar.
 *
 * @param {any} run
 * @param {{rama: string, base: string, commits: Array<{sha: string, asunto: string}>}} r
 * @param {any} deps
 */
async function anotarRamaEnGestor(run, r, deps) {
  const { provider, providerCtx, log = consolaMuda() } = deps;
  if (!provider) return;
  const caps = provider.capabilities?.() || {};
  if (!(caps.comment && typeof provider.comment === "function")) {
    log.info("el gestor no declara `comment`: la rama queda sin comentario de cierre");
    return;
  }
  const integradas = run.tasks.filter((/** @type {any} */ t) => t.status === "integrated");
  const bloqueadas = run.tasks.filter((/** @type {any} */ t) => t.status === "blocked");
  const lineas = [
    `noxloop dejo el trabajo commiteado en la rama \`${r.rama}\` de tu repositorio local ` +
      `(${r.commits.length} commit${r.commits.length === 1 ? "" : "s"} sobre \`${r.base}\`).`,
    `Miralo con: git log ${r.base}..${r.rama}`,
  ];
  if (integradas.length) lineas.push(`Integradas: ${integradas.map((/** @type {any} */ t) => t.id).join(", ")}.`);
  if (bloqueadas.length) {
    lineas.push(
      `Bloqueadas: ${bloqueadas.map((/** @type {any} */ t) => (t.lastFailure ? `${t.id} (${t.lastFailure})` : t.id)).join("; ")}.`,
    );
  }
  lineas.push(`Nada se empujo ni se mergeo: \`${r.base}\` sigue donde estaba.`);
  try {
    await provider.comment(run.item.id, lineas.join("\n"), providerCtx);
  } catch (e) {
    log.warn(`no se pudo dejar el comentario de cierre en el ticket: ${e.message}`);
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
        // Una fase RED que escribio fuera de sus tests NO llega a la
        // verificacion del rojo: lo que escribio ya se revirtio, y la fase
        // cuenta como fallida. Ver `alcance-de-fase.mjs`.
        const alcanceRojo = atenderAlcance(r, itemId, taskId, "red", deps, budgets, bitacora);
        if (alcanceRojo === "corta") return;
        if (alcanceRojo === "sigue") break;
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
        // EL FALLO PENDIENTE DE UN HAND-OFF. Una tarea que llega a `red` con
        // `lastFailure` puesto la reabrio un hand-off (spec 005, FR-007): el
        // agente anterior no supo pasar el test, y lo que fallo es exactamente
        // lo que el nuevo necesita leer antes de escribir. En el camino normal
        // `red` no trae fallo pendiente y esto no cambia nada.
        const pendiente = t.lastFailure || null;
        const r = await fase("GREEN", run, taskId, politica, deps, pendiente
          ? { extra: `Otro agente no llego a pasar el test. Lo que quedo pendiente:\n${comoDato(pendiente, "el fallo pendiente")}` }
          : {});
        if (await cortoPorPresupuesto(r, itemId, taskId, deps)) return;
        const alcanceVerde = atenderAlcance(r, itemId, taskId, "green", deps, budgets, bitacora);
        if (alcanceVerde === "corta") return;
        if (alcanceVerde === "sigue") break;
        run = loadRun(itemId, { home });
        const ev = correrElTest(run, taskId, deps);
        if (ev.ok) {
          // Se consume ANTES de pasar a green: en green un `lastFailure` es la
          // senia de un hallazgo por atender, y el test ya paso.
          if (pendiente) clearLastFailure(loadRun(itemId, { home }), taskId, { home });
          transition(loadRun(itemId, { home }), taskId, "green", { home });
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
            extra: `Hay que resolver esto antes de seguir:\n${comoDato(t.lastFailure, "el fallo pendiente")}`,
          });
          if (await cortoPorPresupuesto(fix, itemId, taskId, deps)) return;
          // El intento ya se conto arriba: aqui solo se decide si se corta. Y
          // el fallo pendiente NO se limpia: el arreglo escribio donde no debia,
          // asi que lo pendiente sigue pendiente.
          const alcanceFix = atenderAlcance(fix, itemId, taskId, null, deps, budgets, bitacora);
          if (alcanceFix === "corta") return;
          if (alcanceFix === "sigue") break;
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
          // DE QUIEN ES EL FALLO. Los tres se arreglan distinto y antes los tres
          // consumian los mismos tres intentos del bucle:
          //
          //   - ENTORNO: falta una herramienta, no hay red. Ningun reintento lo
          //     arregla, y se pagaban tres invocaciones del modelo para llegar
          //     al mismo lugar, con un diagnostico final que decia "el gate no
          //     paso" cuando lo que pasa es que la maquina no puede correrlo.
          //   - BASE: ya estaba roto antes de esta tarea. Gastarle el
          //     presupuesto es como se pierde una tarea que estaba bien, y si el
          //     modelo "lo arregla" mete en su diff un cambio que no es suyo.
          //   - CODIGO: el unico donde reintentar sirve.
          //
          // La base es el worktree de integracion del item: es exactamente
          // sobre lo que la tarea ramifico, asi que responde la pregunta que
          // importa —"¿ya estaba roto antes de mi?"— y no una parecida.
          const destinoBase = deps.resolve(t.repo);
          const clase = claseDeFallo(g, destinoBase?.integrationPath
            ? () => deps.runGate(t.repo, destinoBase.integrationPath, config, { kind: politica.gate })
            : null);

          if (clase.clase === "entorno") {
            transition(run, taskId, "blocked", {
              home,
              failure:
                `el gate no pudo correr por un problema del ENTORNO, no del codigo: ${clase.porque}\n\n` +
                `Salida del gate (exit ${g.exitCode}):\n${g.output}`,
            });
            bitacora.error(`gate: fallo de entorno — ${clase.porque}`);
            return;
          }

          if (clase.clase === "base") {
            transition(run, taskId, "blocked", {
              home,
              failure:
                `el gate ya fallaba sobre la BASE, antes de esta tarea: el fallo no es suyo, y arreglarlo desde ` +
                `aca meteria en su diff un cambio que no le corresponde.\n\n` +
                `Sobre la base (exit ${clase.base?.exitCode}):\n${clase.base?.output}\n\n` +
                `Sobre la tarea (exit ${g.exitCode}):\n${g.output}`,
            });
            bitacora.error("gate: el fallo ya estaba en la base — se bloquea sin gastarle el presupuesto a la tarea");
            return;
          }

          // NO CONVERGE: el mismo fallo, textualmente, que el intento anterior.
          //
          // El presupuesto acota cuantas veces se intenta; no distingue "cada
          // vez estuvo mas cerca" de "dos veces lo mismo". Si el modelo leyo el
          // fallo, cambio algo, y el fallo salio identico, lo que cambio no toca
          // la causa: el intento que queda cuesta lo mismo y termina igual. Y el
          // diagnostico mejora — "agoto sus tres intentos" manda a mirar el
          // presupuesto, "produjo el mismo fallo dos veces" manda a mirar el fallo.
          const huella = huellaDeFallo(g.output);
          const nc = noConverge(t.gateFingerprint || null, huella);
          if (nc.corta) {
            transition(run, taskId, "blocked", {
              home,
              failure: `el gate no converge: ${nc.porque}.\n\nEl fallo, las dos veces (exit ${g.exitCode}):\n${g.output}`,
            });
            bitacora.error("gate: dos intentos, el mismo fallo — se corta sin gastar el que queda");
            return;
          }
          setTaskFields(loadRun(itemId, { home }), taskId, { gateFingerprint: huella }, { home });

          const b = bump(run, taskId, "gate", { home, budgets });
          const deQuien = clase.clase === "indeterminada" ? " (no se pudo comparar contra la base)" : "";
          bitacora.warn(`gate rojo (exit ${g.exitCode})${deQuien} — intento ${b.count}/${b.budget}`);
          if (b.exhausted) {
            transition(run, taskId, "blocked", {
              home,
              failure: `el gate no paso (exit ${g.exitCode}${g.timedOut ? ", TIMEOUT" : ""})${clase.clase === "indeterminada" ? `; ${clase.porque}` : ""}:\n${g.output}`,
            });
            return;
          }
          // No se reintenta el gate a secas: se le devuelve el fallo al modelo
          // para que lo arregle. Volver a correr lo mismo daria lo mismo.
          // La salida del gate la escribio una herramienta que repite lo que
          // escribio otra persona: entra marcada como dato.
          const fix = await fase("GREEN", run, taskId, politica, deps, {
            extra: `El gate fallo:\n${comoDato(g.output, "salida del gate")}`,
          });
          if (await cortoPorPresupuesto(fix, itemId, taskId, deps)) return;
          // Contado ya en el presupuesto del gate; solo la rama movida corta.
          if (atenderAlcance(fix, itemId, taskId, null, deps, budgets, bitacora) === "corta") return;
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

  // UNA TAREA REABIERTA POR UN HAND-OFF con el rojo ya verificado sigue en
  // GREEN: el test ya fallo contra el codigo de antes, y repetir RED seria
  // pedirle al nuevo agente que rehaga el trabajo del anterior. Pasa por aqui
  // —y no directo a `red`— para que el puntero de arriba quede escrito.
  if (tareaDe(loadRun(run.item.id, { home }), taskId).retomarEn === "red") {
    retomarEnRojo(loadRun(run.item.id, { home }), taskId, { home });
  }
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
      deps.runPhase(peticionDeFase(deps, {
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
      })).then((r) => ({ lente, r: conVeredicto(r) || { ok: false, text: "la lente no devolvio nada", findings: null } })),
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
  // Cada informe es texto que produjo OTRA invocacion mirando un diff que
  // escribio alguien mas. Que la sintesis lo lea como dato y no como
  // instruccion es la diferencia entre juzgar los informes y obedecerlos.
  const resumen = informes
    .map(({ lente, r }) => `### lente: ${lente}\nveredicto: ${r.findings || "sin veredicto"}\n\n` +
      // Recorte que AVISA: un slice pelado dejaba a la sintesis juzgando con
      // menos de lo que hubo, sin que nada lo dijera.
      comoDato(recorteQueAvisa(String(r.text || ""), 4000), `informe de la lente ${lente}`))
    .join("\n\n");

  return conVeredicto(await deps.runPhase(peticionDeFase(deps, {
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
  })));
}

export async function fase(nombre, run, taskId, politica, deps, opts = {}) {
  const t = tareaDe(run, taskId);

  // LA GUARDA POSTERIOR, solo si el cableado la encendio: la enciende para un
  // runtime que declara `hooks: false`, porque ahi no hay hook que bloquee la
  // escritura antes. Es un dato que trae `deps`, no una pregunta por el nombre
  // del runtime (principio VI). Ver `alcance-de-fase.mjs`.
  // Por tarea si el cableado lo sabe: tras un hand-off, quien escribe ESTA
  // tarea puede no ser el implementador del recorrido.
  const sinHooks = typeof deps.alcancePorElMotorDe === "function" ? deps.alcancePorElMotorDe(t) : deps.alcancePorElMotor;
  const necesitaGuarda = sinHooks === true && permitidosEnFase(nombre, t) !== null;
  // SIN WORKTREE NO HAY DONDE MIRAR, y entonces la fase NO se invoca. Correrla
  // igual seria dejar a un runtime sin hooks escribir en RED sin nada que
  // sostenga el principio I: ni el hook, que no tiene, ni esta guarda, que no
  // tendria arbol que comparar. Se falla cerrado, antes de pagar el modelo.
  if (necesitaGuarda && !t.worktree) {
    return {
      ok: false,
      budgetExhausted: false,
      findings: null,
      subtype: "sin_guarda_de_alcance",
      text:
        `la fase ${nombre} de ${taskId} no se invoca: el implementador no tiene hooks, asi que el orden del TDD lo ` +
        "fuerza el motor despues de la fase sobre el worktree de la tarea, y la tarea no tiene worktree. Sin " +
        "worktree no hay guarda que lo sostenga.",
    };
  }
  const guarda = necesitaGuarda;
  const ramas = guarda ? ramasProtegidas(run, t, deps) : [];
  const ramasAntes = guarda ? fotoDeRamas(t.worktree, ramas) : null;

  // EL TECHO SE VERIFICA ANTES DE INVOCAR. Despues ya se pago.
  //
  // `limits.callsPerItem` estaba en el esquema y en los dos ejemplos (60 y 40)
  // y nadie lo hacia cumplir: los presupuestos por bucle acotan cada bucle, no
  // la suma del item, asi que un recorrido que entraba en reintentos gastaba sin
  // tope. Se devuelve `budgetExhausted` porque el driver YA sabe tratar eso
  // como un corte de presupuesto y no como un fallo del codigo — que es lo
  // correcto: la tarea no esta mal, se quedo sin plata.
  const techo = techoDeLlamadas(deps.config);
  const fresco = deps.home ? loadRun(run.item.id, { home: deps.home }) || run : run;
  if (excedeLlamadas(fresco, techo)) {
    return {
      ok: false,
      budgetExhausted: true,
      subtype: "callsPerItem",
      text:
        `el recorrido ${run.item.id} ya hizo ${fresco.spent?.calls} invocaciones y el techo ` +
        `\`limits.callsPerItem\` es ${techo}: no se invoca mas. ` +
        `Si el trabajo lo justifica, subi ese limite; si no, hay un bucle de reintentos que hay que mirar.`,
    };
  }

  const r = await deps.runPhase(peticionDeFase(deps, {
    phase: nombre,
    taskId,
    task: t,
    item: run.item,
    cwd: t.worktree,
    // Sesion NUEVA en la primera fase de la tarea, RETOMADA en las siguientes.
    // Retomar reusa el contexto que sirve; abrir nueva entre tareas evita la
    // degradacion por compactacion.
    //
    // PERO NUNCA EN UNA REVISION, y esto era un agujero. Si el revisor retoma
    // la sesion del implementador hereda su razonamiento entero, y la revision
    // deja de romper para confirmar: el modelo que acaba de defender una
    // solucion no la ataca en el turno siguiente. Es el riesgo que la
    // definicion de producto nombra explicitamente para esta etapa, y el que
    // hace que la metrica sea "proporcion de hallazgos que resultaron reales".
    //
    // El motor ya lo hacia bien por un lado: el camino de abanico
    // (`revisionEnAbanico`) construye su peticion con `resume: null` a
    // proposito. Este camino —la revision simple, que es la que corre con la
    // configuracion por defecto— pasaba la sesion. Dos caminos para lo mismo y
    // solo uno correcto; habia ademas un test que afirmaba el comportamiento
    // equivocado, asi que nada lo delataba.
    //
    // Lo encontro el trabajo del contrato de adaptadores, al escribir la regla
    // "el revisor no hereda el transcript" y comprobar contra que la cumplia.
    resume: esRevision(nombre) ? null : (t.sessionId || null),
    model: politica.model,
    effort: politica.effort,
    prompt: promptDeFase(nombre, run, t, opts.extra),
    tier: t.tier,
  }));
  // LA SESION DE UNA REVISION NO SE GUARDA EN LA TAREA. La revision corre en
  // OTRO runtime (FR-034) y abre sesion nueva a proposito; si su id quedara
  // como el de la tarea, el siguiente GREEN pediria al implementador retomar
  // una sesion que es de otro runtime —o, en el mismo, el razonamiento del
  // revisor—.
  if (!esRevision(nombre) && r?.sessionId && r.sessionId !== t.sessionId) {
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

  // Con el veredicto derivado si el runtime no lo trajo: un `PhaseResult` del
  // contrato de adaptadores no lleva `findings`, y sin esto la revision no
  // puede bloquear nada. Ver `conVeredicto`.
  const res = conVeredicto(r) || { ok: false, budgetExhausted: false, findings: null, text: "la fase no devolvio nada" };
  if (!guarda) return res;

  // La tarea se RELEE del disco: un `noxloop add-target` durante la fase amplio
  // lo que la fase podia tocar, y la foto de antes no lo sabe.
  const fresca = tareaDe(loadRun(run.item.id, { home: deps.home }) || run, taskId);
  const g = verificarAlcance({ fase: nombre, worktree: t.worktree, tarea: fresca, ramasAntes, ramas });
  if (g.ok) return res;
  return { ...res, ok: false, alcance: g, text: `${g.causa}${res.text ? `\n\n${res.text}` : ""}` };
}

/**
 * Las ramas que ninguna fase puede mover: la base del item, por donde se la
 * conozca. Si no se puede resolver, lista vacia — y la guarda de ramas no mira
 * nada, en vez de inventar un nombre.
 */
function ramasProtegidas(run, t, deps) {
  const ramas = new Set([run.item?.baseBranch, run.item?.prTarget, deps.config?.repos?.[t.repo]?.baseBranch]);
  try {
    ramas.add(deps.resolve?.(t.repo)?.baseBranch);
  } catch { /* sin resolucion: se queda con lo que ya sabe */ }
  return [...ramas].filter(Boolean);
}

/**
 * Lo que el driver hace con una fase cuya guarda de alcance salto.
 *
 * - Una rama protegida movida bloquea EN EL ACTO: no es un intento fallido del
 *   que se aprende, es el limite del principio IV cruzado, y lo desatasca una
 *   persona.
 * - Una escritura fuera de alcance consume el intento del bucle (`red` o
 *   `green`) y, agotado, bloquea con la causa textual. Con `bucle: null` el
 *   intento ya se conto en otro presupuesto y solo se registra.
 *
 * @returns {null | "sigue" | "corta"} `null` si no hubo nada que atender
 */
function atenderAlcance(r, itemId, taskId, bucle, deps, budgets, bitacora) {
  if (!r?.alcance) return null;
  const { home } = deps;
  if (bucle) {
    const b = bump(loadRun(itemId, { home }), taskId, bucle, { home, budgets });
    bitacora.warn(`${r.alcance.causa} — intento ${b.count}/${b.budget}`);
    if (!r.alcance.ramasMovidas.length && !b.exhausted) return "sigue";
  } else {
    bitacora.warn(r.alcance.causa);
    if (!r.alcance.ramasMovidas.length) return "sigue";
  }
  transition(loadRun(itemId, { home }), taskId, "blocked", { home, failure: r.alcance.causa });
  return "corta";
}

export function promptDeFase(nombre, run, t, extra) {
  const base = `/noxloop-task ${run.item.id} ${t.id} --phase ${nombre}`;
  // El especialista SUGERIDO por el plan. Es una sugerencia y se pasa como tal:
  // el campo estaba en los dos esquemas y lo produce el workflow de
  // planificacion, pero no llegaba a quien implementa, asi que el plan decia
  // quien iba a hacer la tarea y no era verdad.
  const partes = [];
  if (t.specialist) partes.push(`El plan sugiere el especialista \`${t.specialist}\` para esta tarea.`);
  if (extra) partes.push(extra);
  return partes.length ? `${base}\n\n${partes.join("\n\n")}` : base;
}

/**
 * El techo de invocaciones por item.
 *
 * EL FALLO QUE CIERRA: `limits.callsPerItem` estaba en el esquema y en los dos
 * ejemplos de configuracion (60 y 40), y NADIE lo hacia cumplir. Un recorrido
 * que entraba en un bucle de reintentos podia gastar sin tope: los presupuestos
 * por bucle acotan cada bucle, no la suma del item.
 *
 * Un techo invalido cae al default del esquema en vez de lanzar: dejar el motor
 * sin poder invocar nada por un cero mal puesto es peor que ignorarlo.
 */
export function techoDeLlamadas(config) {
  const n = config?.limits?.callsPerItem;
  return Number.isInteger(n) && n > 0 ? n : 60;
}

/** Si el recorrido ya llego a su techo. En el techo NO se invoca mas. */
export function excedeLlamadas(run, techo) {
  const hechas = run?.spent?.calls;
  if (!Number.isFinite(hechas)) return false;
  return hechas >= techo;
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

/**
 * El PR, en el ticket: el adjunto nativo y el COMENTARIO DE CIERRE (spec 005,
 * FR-003).
 *
 * POR QUE LOS DOS Y NO UNO U OTRO. Hasta la 005 el comentario era solo la
 * degradacion de `linkUrl`. Pero no dicen lo mismo: el adjunto dice «hay un
 * PR» en un costado del ticket; el comentario es lo que se lee en la
 * conversacion, le llega por notificacion a quien sigue el ticket, y dice QUE
 * quedo integrado y que no. Sin el, quien mira el gestor ve el ticket moverse a
 * revision sin una palabra de por que.
 *
 * NUNCA DOS VECES EL MISMO CIERRE. Un relanzamiento que encuentra el PR ya
 * abierto (`alreadyExisted`) no comenta: el cierre ya se dijo cuando se abrio.
 * El precio, declarado: si aquel primer comentario fallo, el relanzamiento no
 * lo reintenta. Llevar la marca en el estado del run exigiria un campo nuevo
 * del item, y un comentario de menos se ve; uno repetido en cada relanzamiento
 * ensucia el ticket de cualquiera que adopte esto.
 *
 * Cada escritura con su propio `try`: que el adjunto falle no puede comerse el
 * comentario, que es el unico que el operador lee.
 */
async function anotarEnGestor(run, pr, deps) {
  const { provider, providerCtx, log = consolaMuda() } = deps;
  if (!provider) return;
  const caps = provider.capabilities?.() || {};
  if (caps.linkUrl && typeof provider.linkUrl === "function") {
    try {
      await provider.linkUrl(run.item.id, pr.url, "Pull request", providerCtx);
    } catch (e) {
      log.warn(`no se pudo adjuntar el PR al ticket: ${e.message}`);
    }
  }
  if (!(caps.comment && typeof provider.comment === "function")) {
    // Degradacion declarada: sin `comment` el cierre queda en el adjunto y en
    // el estado. Se dice en el log para que no parezca olvido.
    log.info("el gestor no declara `comment`: el PR queda sin comentario de cierre");
    return;
  }
  if (pr.alreadyExisted) return;
  try {
    await provider.comment(run.item.id, comentarioDeCierre(run, pr), providerCtx);
  } catch (e) {
    log.warn(`no se pudo dejar el comentario de cierre en el ticket: ${e.message}`);
  }
}

/**
 * El texto del comentario de cierre: el enlace primero —es lo que se busca—, y
 * despues lo integrado y lo bloqueado POR ID, con la causa del bloqueo tal cual
 * (nunca un resumen: el resumen borra el dato que hace falta para seguir).
 */
function comentarioDeCierre(run, pr) {
  const integradas = run.tasks.filter((t) => t.status === "integrated");
  const bloqueadas = run.tasks.filter((t) => t.status === "blocked");
  const lineas = [`noxloop abrio el pull request: ${pr.url}`];
  if (integradas.length) lineas.push(`Integradas: ${integradas.map((t) => t.id).join(", ")}.`);
  if (bloqueadas.length) {
    lineas.push(
      `Bloqueadas: ${bloqueadas.map((t) => (t.lastFailure ? `${t.id} (${t.lastFailure})` : t.id)).join("; ")}.`,
    );
  }
  lineas.push("El merge sigue siendo de una persona.");
  return lineas.join("\n");
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
