// La capa entre el CLI y el motor.
//
// Existe para que `bin/noxloop.mjs` sea solo enrutado de argumentos y formato de
// salida. Un CLI con la logica de cableado adentro no se puede probar, y esta
// logica —resolver el nivel del ticket, decidir a quien delegar, armar el
// reporte para una persona— es justo la que conviene poder probar.

import { planItem } from "./planner.mjs";
import { runItem } from "./driver.mjs";
import { loadRun } from "./state.mjs";
import { resumable } from "./scheduler.mjs";
import { buildDeps, loadProvider, itemBranchName, reposDeclarados } from "./wiring.mjs";
import { createLogger } from "./log.mjs";
import { revisarBandeja } from "./inbox.mjs";
import { correrDaemon, unaVuelta } from "./daemon.mjs";
import { prepararHito, correrHito, reporteDeHito } from "./milestone.mjs";
import { diagnosticar, prepararReanudacion, destrabar, limpiarHuerfanos } from "./recovery.mjs";

/** Que hace falta correr para cada nivel de ticket. */
const POR_NIVEL = {
  epic: { accion: "milestone", porque: "un hito agrupa historias: se recorre entero, con una sola aprobacion" },
  feature: { accion: "milestone", porque: "un hito agrupa historias: se recorre entero, con una sola aprobacion" },
  story: { accion: "plan+run", porque: "una historia se planifica y se ejecuta" },
  task: { accion: "plan+run", porque: "una tarea suelta se planifica como un plan de una sola tarea" },
};

/**
 * @param {"plan"|"run"|"resume"|"dispatch"|"inbox"|"daemon"|"milestone"|"diagnose"|"unstick"|"prune"} comando
 * @param {string} itemId
 * @param {object} config
 */
export async function ejecutarComando(comando, itemId, config, opts = {}) {
  const log = createLogger({ home: config.home, quiet: comando === "dispatch" });

  if (comando === "dispatch") return despachar(itemId, config, { ...opts, log });
  if (comando === "plan") return planificar(itemId, config, { ...opts, log });
  if (comando === "run" || comando === "resume") return ejecutar(itemId, config, { ...opts, log, comando });
  if (comando === "inbox") return bandeja(config, { ...opts, log });
  if (comando === "daemon") return daemon(config, { ...opts, log });
  if (comando === "milestone") return hito(itemId, config, { ...opts, log });
  if (comando === "diagnose") return diagnostico(itemId, config, { ...opts, log });
  if (comando === "unstick") return destrabarTarea(itemId, config, { ...opts, log });
  if (comando === "prune") return podar(config, { ...opts, log });
  if (comando === "board") return tablero(config, { ...opts, log });
  throw new Error(`comando desconocido: ${comando}`);
}

/**
 * El despachador que usan la bandeja y el daemon: un ticket entra, se resuelve
 * su nivel, y se lo lleva al camino que le toca.
 *
 * ES EL CABLEADO DE VERDAD, y por eso vive aca y no dentro del daemon: el
 * daemon recibe `despachar` inyectado para poder probar su bucle sin modelo, y
 * si esta funcion viviera adentro, lo que corre en produccion no seria lo que
 * los tests ejercitan. Hay un test de punta a punta que la recorre entera.
 */
function hacerDespachador(config, opts) {
  return async (item) => {
    const nivel = item.level;

    if (nivel === "epic" || nivel === "feature") {
      const r = /** @type {any} */ (await hito(String(item.id), config, { ...opts, go: true }));
      return { ok: r.ok !== false, porque: r.reason, clase: "transitorio" };
    }

    const plan = /** @type {any} */ (await planificar(String(item.id), config, opts));
    if (!plan.ok) {
      // Un ticket sin criterios verificables no se arregla esperando: es un
      // rechazo PERMANENTE, y reintentarlo cada dos minutos paga el modelo para
      // llegar al mismo lugar. Un fallo del gestor o de la red, en cambio, es
      // transitorio y hay que reintentarlo.
      return {
        ok: false,
        porque: plan.question ? `${plan.reason} — ${plan.question}` : plan.reason,
        clase: plan.question || /criterio/i.test(String(plan.reason)) ? "permanente" : "transitorio",
      };
    }

    const corrida = /** @type {any} */ (await ejecutar(String(item.id), config, { ...opts, comando: "run" }));
    return {
      ok: Boolean(corrida.pr),
      porque: corrida.pr ? undefined : (corrida.reason || corrida.humano?.join(" ")),
      clase: "transitorio",
      pr: corrida.pr || null,
    };
  };
}

/**
 * Levanta el board de control y se queda sirviendo hasta que lo interrumpan.
 *
 * POR QUE VIVE ACA Y NO EN EL BIN. Es el mismo motivo por el que `hacerDespachador`
 * vive aca: lo que corre en produccion tiene que ser lo que los tests ejercitan.
 * El bin solo traduce banderas.
 *
 * NO ESCRIBE NADA. Ver board.mjs — este proceso lee el estado, y que no pueda
 * escribirlo es lo que deja intacto el unico-escritor del motor.
 */
async function tablero(config, opts) {
  const { levantarBoard } = await import("./board-server.mjs");
  const { srv, url } = await levantarBoard({ home: config.home, port: opts.port });

  opts.log?.info(`board en ${url} — lee ${config.home}, no escribe nada`);
  if (opts.open) await abrirEnNavegador(url, opts.log);

  // Sin señal el board se queda vivo mientras viva el proceso: es un servidor,
  // y terminar solo lo volveria inutil. Con señal cierra y devuelve.
  if (opts.signal) {
    await new Promise((res) => {
      if (opts.signal.aborted) return res(undefined);
      opts.signal.addEventListener("abort", () => res(undefined), { once: true });
    });
    await new Promise((res) => srv.close(() => res(undefined)));
    return { ok: true, url, cerrado: true };
  }

  return { ok: true, url, srv };
}

/** Abrir el navegador es una comodidad: si no se puede, se dice y se sigue. */
async function abrirEnNavegador(url, log) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const { spawn } = await import("node:child_process");
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch (e) {
    log?.warn(`no pude abrir el navegador con ${cmd}: ${e.message}. La URL es ${url}`);
  }
}

async function bandeja(config, opts) {
  const { mod: provider, ctx } = await cargarProveedor(config, opts);
  const r = await revisarBandeja(config, { provider, providerCtx: ctx, home: config.home, log: opts.log });

  const humano = [];
  if (r.nuevos.length) {
    humano.push(`${r.nuevos.length} ticket(s) para despachar:`);
    for (const i of r.nuevos) humano.push(`  ${i.key || i.id}  [${i.level}]  ${i.title}  (${i.disparos.join(", ")})`);
  } else {
    humano.push("no hay tickets nuevos");
  }
  for (const v of r.vistos) humano.push(`  · ${v.item?.key || v.item?.id || v.id}: ya tiene recorrido (${v.estado})`);
  for (const o of r.omitidos) humano.push(`  ✗ ${o.item?.key || o.item?.id}: ${o.porque}`);
  for (const d of r.degradaciones) humano.push(`  ! ${d}`);
  humano.push("", "`inbox` no ejecuta nada. Para despachar: noxloop daemon, o noxloop plan <item>.");

  return { ...r, humano };
}

async function daemon(config, opts) {
  const { mod: provider, ctx } = await cargarProveedor(config, opts);
  const despachar = opts.inject?.despachar || hacerDespachador(config, opts);

  const r = await correrDaemon(config, {
    provider, providerCtx: ctx, home: config.home, log: opts.log,
    despachar,
    ...(opts.inject?.dormir ? { dormir: opts.inject.dormir } : {}),
    ...(opts.inject?.ahora ? { ahora: opts.inject.ahora } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.vueltas ? { vueltas: opts.vueltas } : {}),
  });
  return { ...r, humano: [`daemon terminado: ${r.motivo || "senial de terminacion"}`] };
}

async function hito(itemId, config, opts) {
  const { mod: provider, ctx } = await cargarProveedor(config, opts);
  const item = await provider.getItem(itemId, ctx);
  if (!item) return { ok: false, humano: [`el hito ${itemId} no existe`] };

  const deps = await buildDeps(item, config, { ...opts, provider, providerCtx: ctx, inject: opts.inject });
  const comunes = {
    ...deps,
    provider, providerCtx: ctx,
    planItem: (id, d) => planItem(id, d),
    runItem: (id, d) => runItem(id, d),
    skip: opts.skip, only: opts.only, repo: opts.repo,
    maxItems: opts.maxItems, maxCostUsd: opts.maxCostUsd,
    projectId: opts.projectId,
  };

  if (!opts.go) {
    const r = await prepararHito(itemId, comunes);
    return {
      ...r,
      humano: [
        `hito ${item.key || itemId} — ${item.title}`,
        "",
        ...lineasDeHito(r),
        "",
        "Esto es el UNICO punto de aprobacion humana del hito entero.",
        "El hito integra cada historia a su rama SIN esperar revision humana, asi que",
        "un error temprano viaja hacia las siguientes. Es el precio de no detenerse.",
        `Si el recorrido te sirve: noxloop milestone ${itemId} --go --max-items 1`,
      ],
    };
  }

  const r = await correrHito(itemId, comunes);
  return { ...r, humano: lineasDeHito(r) };
}

/** El reporte para una persona. Distingue bloqueada de inalcanzable, que es lo
 * unico que hace util el resumen final: una fallo, la otra nunca pudo
 * intentarse. */
function lineasDeHito(r) {
  const l = [];
  if (r.ok === false) return [`no se pudo: ${r.reason || r.porque || "sin motivo"}`];

  l.push(`rama del hito: ${r.branch} (sobre ${r.baseBranch}) en ${r.repo}`);
  if (r.ordenSegun) l.push(`orden: ${r.orden?.join(" → ") || "-"}  [${r.ordenSegun}]`);
  if (r.integrated?.length) l.push(`integradas: ${r.integrated.join(", ")}`);
  if (r.prOpen?.length) l.push(`con PR sin integrar: ${r.prOpen.join(", ")}`);
  if (r.pending?.length) l.push(`pendientes: ${r.pending.join(", ")}`);
  for (const b of r.blocked || []) {
    l.push(`  ✗ ${b.id || b}: ${String(b.porque || b.reason || "sin causa").split("\n")[0]}`);
  }
  for (const u of r.unreachable || []) {
    l.push(`  · ${u.id || u}: inalcanzable — depende de ${(u.porque || []).join(", ")} (no fallo: nunca pudo intentarse)`);
  }
  for (const s_ of r.skipped || []) l.push(`  — ${s_.id || s_}: excluida (${s_.why || s_.porque || ""})`);
  if (r.spent) l.push(`gasto: ${r.spent.calls || 0} invocacion(es)${r.spent.usd ? `, ${r.spent.usd} USD` : ""}`);
  if (r.stoppedBy) l.push(`se detuvo por: ${r.stoppedBy}`);
  if (r.prs?.length) l.push("", "pull requests:", ...r.prs.map((p) => `  ${p.item || p.id}: ${p.pr || p.url}`));
  l.push("", "Ninguno se mergeo: el merge del hito a su base sigue siendo humano.");
  return l;
}

function diagnostico(itemId, config, opts) {
  const r = diagnosticar(itemId, { home: config.home, config });
  const humano = [];
  if (!r.existe) return { ...r, humano: [`no hay recorrido para ${itemId}`] };
  humano.push(`recorrido ${itemId}: ${(r.integradas || []).length} integradas, ${(r.bloqueadas || []).length} bloqueadas, ${(r.enVuelo || []).length} en vuelo`);
  for (const t of r.enVuelo || []) {
    humano.push(`  ${t.id} [${t.status}] ${t.sucio ? "worktree SUCIO" : "limpio"} — decision: ${(t.decisiones || []).join(" | ")}`);
  }
  for (const h of r.huerfanos || []) humano.push(`  huerfano: ${h.path || h}`);
  return { ...r, humano };
}

function destrabarTarea(itemId, config, opts) {
  if (!opts.task) return { ok: false, humano: ["uso: noxloop unstick <item> --task <tarea> --nota \"<que se decidio>\""] };
  const r = destrabar(itemId, opts.task, { home: config.home, nota: opts.nota, volverA: opts.volverA });
  return {
    ...r,
    humano: r.ok === false
      ? [`no se pudo destrabar ${opts.task}: ${r.porque || r.reason}`]
      : [`${opts.task} vuelve al bucle. La decision quedo registrada.`,
         "Ojo: registrarla solo aca es un atajo — la fuente de verdad es el ticket."],
  };
}

function podar(config, opts) {
  const r = limpiarHuerfanos({ home: config.home, config, force: Boolean(opts.force) });
  const humano = [];
  for (const q of r.quitados || []) humano.push(`quitado: ${q}`);
  for (const c of r.conservados || []) humano.push(`CONSERVADO: ${c.path || c} — ${c.motivo || ""}`);
  if (!humano.length) humano.push("no hay nada huerfano");
  return { ...r, humano };
}

/** El proveedor, inyectable para poder probar el cableado sin red. */
async function cargarProveedor(config, opts) {
  if (opts.inject?.provider) {
    return { mod: opts.inject.provider, ctx: opts.inject.providerCtx || {} };
  }
  return loadProvider(config, { log: opts.log });
}

/**
 * EL NIVEL NO SE ADIVINA POR EL NOMBRE DEL TIPO. Cada gestor lo llama distinto
 * —"User Story", "Product Backlog Item", "Issue"— y un despachador que compare
 * contra una constante funciona en un proyecto y no hace nada en otro, sin
 * error y sin aviso. Lo resuelve el proveedor con su mapa de tipos.
 */
async function despachar(itemId, config, opts) {
  const { mod: provider, ctx } = await loadProvider(config, { log: opts.log });
  const item = await provider.getItem(itemId, ctx);
  if (!item) {
    return { ok: false, humano: [`el ticket ${itemId} no existe en el gestor ${provider.meta.name}`] };
  }

  const plan = POR_NIVEL[item.level];
  const caps = provider.capabilities();

  if (plan.accion === "milestone" && !caps.children) {
    return {
      ok: false,
      item: itemId,
      level: item.level,
      humano: [
        `${item.key || itemId} es de nivel "${item.level}", que se recorre como hito,`,
        `pero el gestor ${provider.meta.name} no soporta leer hijos (capabilities().children es false).`,
        `Se dice ahora y no a mitad del recorrido.`,
      ],
    };
  }

  return {
    ok: true,
    item: itemId,
    key: item.key,
    title: item.title,
    level: item.level,
    accion: plan.accion,
    branch: itemBranchName(item),
    humano: [
      `${item.key || itemId} — ${item.title}`,
      `nivel: ${item.level} → ${plan.accion}  (${plan.porque})`,
      plan.accion === "milestone"
        ? `corre: noxloop milestone ${itemId}   (prepara y para; con --go lo lanza)`
        : `corre: noxloop plan ${itemId}  y despues  noxloop run ${itemId}`,
    ],
  };
}

async function planificar(itemId, config, opts) {
  const { mod: provider, ctx } = await loadProvider(config, { log: opts.log });
  const item = await provider.getItem(itemId, ctx);
  if (!item) return { ok: false, humano: [`el ticket ${itemId} no existe`] };

  // La planificacion corre DENTRO del worktree de la rama del item. Si corriera
  // en el checkout principal, la especificacion que produce quedaria en el arbol
  // de trabajo de una persona y no llegaria ni a la rama ni al PR — es un fallo
  // observado, no una hipotesis.
  const repoPrincipal = reposDeclarados(config)[0];
  const deps = await buildDeps(item, config, { ...opts, provider, providerCtx: ctx, inject: opts.inject });
  const { integrationPath } = deps.resolve(repoPrincipal);

  const r = await planItem(itemId, {
    ...deps,
    workdir: integrationPath,
    materialize: opts.materialize !== false,
    // El proyecto del servicio que lanza, si lo hay. `planItem` lo pasa a
    // `createRun`; sin el, el run se declara sin proyecto y el board tiene que
    // atribuirlo por la ruta del repositorio, que es un rodeo.
    projectId: opts.projectId,
  });

  const humano = [];
  if (r.alreadyPlanned) {
    humano.push(`ya hay un plan para ${itemId} con ${r.tasks} tarea(s). Para ejecutarlo: noxloop run ${itemId}`);
  } else if (r.ok) {
    const run = loadRun(itemId, { home: config.home });
    humano.push(`plan aceptado: ${r.tasks} tarea(s) sobre ${(r.repos || []).join(", ")}`, "");
    for (const t of run.tasks) {
      const deps_ = t.dependsOn.length ? `  ← ${t.dependsOn.join(", ")} (${t.dependencyKind})` : "";
      humano.push(`  ${t.id}  [${t.tier}]  ${t.repo}  ${t.title}${deps_}`);
      humano.push(`        criterio: ${t.acceptance}`);
    }
    humano.push("", "Esto es el unico punto de aprobacion humana del flujo.",
      `Si el plan te sirve: noxloop run ${itemId}`);
  } else {
    humano.push(`NO se pudo planificar ${itemId}: ${r.reason}`);
    if (r.question) humano.push("", "La pregunta que hay que responder:", `  ${r.question}`);
    for (const p of r.problems || []) humano.push(`  - ${p}`);
  }
  for (const n of r.notes || []) humano.push(`  · ${n}`);

  return { ...r, item: itemId, humano };
}

async function ejecutar(itemId, config, opts) {
  const run = loadRun(itemId, { home: config.home });
  if (!run) {
    return {
      ok: false,
      humano: [
        `no hay recorrido para ${itemId}.`,
        `Corre primero: noxloop plan ${itemId}`,
        `El motor no replanifica solo: un recorrido que arma su propio plan puede cambiar el alcance sin que nadie lo apruebe.`,
      ],
    };
  }

  if (opts.comando === "resume") {
    const aMedias = resumable(run);
    if (aMedias.length) {
      opts.log.info(`retomando ${aMedias.length} tarea(s) que quedaron en vuelo: ${aMedias.join(", ")}`);
    }
  }

  const deps = await buildDeps(run.item, config, { ...opts, inject: opts.inject });
  const r = /** @type {any} */ (await runItem(itemId, { ...deps, dryRun: opts.dryRun }));

  const humano = [];
  if (r.dryRun) {
    humano.push(`--dry-run: esto es lo que haria con ${r.plan.length} tarea(s), sin ejecutar nada`, "");
    for (const p of r.plan) humano.push(`  ${p.task} [${p.tier}] ${p.repo} (${p.status})`, `      ${p.haria.join(" → ")}`);
    return { ...r, humano };
  }

  if (r.pr) {
    humano.push(`PR ${r.prAlreadyExisted ? "(ya existia) " : ""}${r.pr}`);
    humano.push(`integradas: ${r.integrated.join(", ") || "ninguna"}`);
  } else {
    humano.push(`sin PR: ${r.reason || "no se llego a abrir"}`);
  }
  if (r.blocked?.length) {
    humano.push("", `bloqueadas (${r.blocked.length}), con su causa:`);
    const fin = loadRun(itemId, { home: config.home });
    for (const id of r.blocked) {
      const t = fin.tasks.find((x) => x.id === id);
      humano.push(`  ${id}: ${String(t?.lastFailure || "sin causa").split("\n")[0]}`);
    }
  }
  humano.push("", "Nada se mergeo ni se desplego: eso sigue siendo tuyo.");

  return { ...r, humano };
}
