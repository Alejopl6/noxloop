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

/** Que hace falta correr para cada nivel de ticket. */
const POR_NIVEL = {
  epic: { accion: "milestone", porque: "un hito agrupa historias: se recorre entero, con una sola aprobacion" },
  feature: { accion: "milestone", porque: "un hito agrupa historias: se recorre entero, con una sola aprobacion" },
  story: { accion: "plan+run", porque: "una historia se planifica y se ejecuta" },
  task: { accion: "plan+run", porque: "una tarea suelta se planifica como un plan de una sola tarea" },
};

/**
 * @param {"plan"|"run"|"resume"|"dispatch"} comando
 * @param {string} itemId
 * @param {object} config
 */
export async function ejecutarComando(comando, itemId, config, opts = {}) {
  const log = createLogger({ home: config.home, quiet: comando === "dispatch" });

  if (comando === "dispatch") return despachar(itemId, config, { ...opts, log });
  if (comando === "plan") return planificar(itemId, config, { ...opts, log });
  if (comando === "run" || comando === "resume") return ejecutar(itemId, config, { ...opts, log, comando });
  throw new Error(`comando desconocido: ${comando}`);
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
        ? `todavia no implementado: noxloop milestone (T051)`
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
  const deps = await buildDeps(item, config, { ...opts, provider, providerCtx: ctx });
  const { integrationPath } = deps.resolve(repoPrincipal);

  const r = await planItem(itemId, {
    ...deps,
    workdir: integrationPath,
    materialize: opts.materialize !== false,
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

  const deps = await buildDeps(run.item, config, opts);
  const r = await runItem(itemId, { ...deps, dryRun: opts.dryRun });

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
