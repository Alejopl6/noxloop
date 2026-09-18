// Pull requests: un envoltorio determinista sobre el CLI del forge.
//
// POR QUE NO UN SERVIDOR MCP, y la primera razon es de seguridad. Los hooks
// interceptan `Bash` en PreToolUse; las llamadas a herramientas MCP NO pasan por
// ese hook. El limite de autonomia —no mergear, no desplegar— esta forzado
// porque un merge es un comando de shell. Un servidor MCP con una herramienta
// de merge devolveria ese limite a la buena voluntad del prompt, que es
// exactamente de lo que este proyecto existe para no depender.
//
// POR QUE EL CUERPO LO ARMA CODIGO. Porque asi es comparable entre recorridos y
// no puede omitir lo incomodo. Un cuerpo escrito por el modelo tiende a contar
// lo que salio bien; este trae el exit code textual, los huecos declarados del
// gate, las ampliaciones de alcance y las tareas que quedaron bloqueadas con su
// causa real.

import { spawnSync } from "node:child_process";

const TIPO_POR_TIER = { trivial: "chore", small: "feat", medium: "feat", large: "feat" };

/** Conventional Commits, con el alcance derivado de los repos que toco. */
export function prTitle(run) {
  const repos = [...new Set(run.tasks.map((t) => t.repo))];
  const alcance = repos.length === 1 ? repos[0] : repos.slice(0, 2).join(",");
  const tipo = TIPO_POR_TIER[run.tasks[0]?.tier] || "feat";
  const base = `${tipo}(${alcance}): ${run.item.title}`;
  return base.length <= 100 ? base : `${base.slice(0, 97)}...`;
}

/**
 * Recorta para el cuerpo del PR, diciendo que recorto. Un recorte silencioso
 * hace pensar que eso fue todo lo que salio.
 */
function recorte(texto, max) {
  const t = String(texto ?? "").trim();
  if (!t) return "(sin salida)";
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n... [truncado: ${t.length - max} caracteres mas]`;
}

function bloqueDeTarea(t) {
  const lineas = [`### ${t.id} — ${t.title}`, "", `**Criterio**: ${t.acceptance}`];

  if (t.gateEvidence) {
    const ev = t.gateEvidence;
    lineas.push(
      "",
      "**Gate**:",
      "```",
      `$ ${ev.command}`,
      `exit ${ev.exitCode}${ev.timedOut ? " (TIMEOUT)" : ""}  ·  ${Math.round((ev.durationMs || 0) / 1000)}s`,
      "```",
    );
  } else {
    lineas.push("", "**Gate**: sin evidencia registrada.");
  }

  // EL ROJO, CON SU CORRIDA. Antes el PR decia "exit 0" del gate y "creeme" del
  // rojo: la evidencia se validaba al transicionar y despues se tiraba. Quien
  // revisa quedaba obligado a creerle al estado, y el estado vale justamente
  // porque hay una corrida detras.
  //
  // A una tarea que declaro no tener tests no se le reclama: ese caso ya se
  // explica abajo, con su motivo.
  if (t.testFiles?.length) {
    if (t.redEvidence) {
      const rv = t.redEvidence;
      lineas.push(
        "",
        "**Rojo** (el test corrido ANTES del cambio):",
        "```",
        `$ ${rv.command || "(comando no registrado)"}`,
        `exit ${rv.exitCode}${rv.timedOut ? " (TIMEOUT)" : ""}  ·  ${Math.round((rv.durationMs || 0) / 1000)}s`,
        "",
        recorte(rv.output, 1200),
        "```",
      );
    } else {
      // Omitirlo seria indistinguible de "no habia nada que mostrar", y son
      // cosas distintas: una tarea vieja sin evidencia y una que nunca vio el
      // rojo se verian igual.
      lineas.push("", "**Rojo**: sin evidencia registrada de la corrida.");
    }
  }

  if (!t.testFiles?.length) {
    lineas.push("", `**Sin tests**, a proposito: ${t.noTestsBecause || "no se declaro el motivo"}`);
  }

  if (t.reviewWaived) {
    // Una revision que no ocurrio se declara. Es la contrapartida de que un
    // tier pueda abaratarla: se abarata a la vista, no en silencio.
    lineas.push("", `**Sin revision automatica**: ${t.reviewWaived}`);
  }

  // Solo se informan los bucles que necesitaron mas de un intento. Listar
  // cuatro contadores en 1 es ruido; un 3 en green es informacion.
  const caros = Object.entries(t.attempts || {}).filter(([, n]) => n > 1);
  if (caros.length) {
    lineas.push("", `**Iteraciones**: ${caros.map(([k, n]) => `${k} ${n}`).join(", ")}`);
  }

  if (t.addedTargets?.length) {
    lineas.push("", "**Alcance ampliado** durante la tarea:");
    for (const a of t.addedTargets) lineas.push(`- \`${a.path}\` — ${a.why}`);
  }

  return lineas.join("\n");
}

/**
 * @param {object} run
 * @param {{gaps?: Record<string, string[]>, refs?: string[]}} opts
 */
export function prBody(run, opts = {}) {
  const gaps = opts.gaps || {};
  const hechas = run.tasks.filter((t) => t.status === "integrated");
  const bloqueadas = run.tasks.filter((t) => t.status === "blocked");
  const s = [];

  s.push(`## ${run.item.title}`, "");
  if (run.item.key) s.push(`**Ticket**: ${run.item.key} — ${run.item.url}`, "");
  else s.push(`**Ticket**: ${run.item.url}`, "");
  if (opts.refs?.length) s.push(opts.refs.join(" "), "");

  const criterios = run.item.acceptance || [];
  if (criterios.length) {
    s.push("### Criterios de aceptacion", "");
    for (const c of criterios) s.push(`- ${c}`);
    s.push("");
  }

  // LO QUE QUEDO AFUERA A PROPOSITO, antes de las tareas.
  //
  // EL FALLO QUE CIERRA: `data-model.md` decia literalmente de `outOfScope`
  // "Va al PR", y no iba a ningun lado. Quien revisa el PR no tenia forma de
  // saber que se dejo afuera adrede, asi que un recorte deliberado se leia como
  // un olvido — y al reves, que es peor.
  if (run.outOfScope?.length) {
    s.push("### Fuera de alcance, a proposito", "");
    for (const x of run.outOfScope) s.push(`- ${x}`);
    s.push("");
  }

  // Y por que el orden fue serial, si lo fue. Sin esto, un plan serializado por
  // una limitacion del gestor se ve igual que uno que nadie supo paralelizar.
  if (run.serializedBecause) {
    s.push("### Por que el orden fue serial", "", run.serializedBecause, "");
  }

  s.push(`### Tareas (${hechas.length} de ${run.tasks.length} integradas)`, "");
  for (const t of hechas) s.push(bloqueDeTarea(t), "");

  if (bloqueadas.length) {
    s.push("### Tareas bloqueadas", "");
    s.push(
      `${bloqueadas.length} de ${run.tasks.length} no salieron. El PR se abre igual con las que si:`,
      "una bloqueada con un diagnostico honesto vale mas que un verde inventado.",
      "",
    );
    for (const t of bloqueadas) {
      s.push(`**${t.id} — ${t.title}**`, "");
      if (!t.testFiles?.length) {
        s.push(`Sin tests, a proposito: ${t.noTestsBecause || "no se declaro el motivo"}`, "");
      }
      s.push("```", String(t.lastFailure || "sin causa registrada"), "```", "");
    }
  }

  const reposTocados = [...new Set(run.tasks.map((t) => t.repo))];
  const huecos = reposTocados.flatMap((r) => (gaps[r] || []).map((g) => `\`${r}\`: ${g}`));
  if (huecos.length) {
    s.push("### Lo que el gate NO cubre", "");
    s.push("Declarado en la configuracion del repositorio. Un verde con huecos no es un verde completo:", "");
    for (const h of huecos) s.push(`- ${h}`);
    s.push("");
  }

  s.push(
    "---",
    "",
    "Abierto por noxloop. **Nada se mergeo ni se desplego**: la revision humana y el merge",
    "son la decision con la que termina el recorrido, y siguen siendo tuyas.",
    "",
    `Rama: \`${run.item.branch || "?"}\``,
  );

  return s.join("\n");
}

/**
 * Abre el PR del item, o devuelve el que ya existe.
 *
 * @param {{
 *   cwd: string, base: string, cli?: string, gaps?: object, refs?: string[],
 *   dryRun?: boolean, exec?: (args: string[]) => {ok: boolean, out: string}
 * }} opts
 */
export async function createPR(run, opts) {
  const cli = opts.cli || "gh";
  const exec = opts.exec || ((args) => ejecutar(cli, args, opts.cwd));
  const body = prBody(run, { gaps: opts.gaps, refs: opts.refs });
  const title = prTitle(run);

  if (opts.dryRun) return { url: null, alreadyExisted: false, dryRun: true, title, body };

  // Idempotente antes que nada: relanzar un recorrido no puede abrir un segundo
  // PR para la misma rama.
  const existente = exec(["pr", "view", run.item.branch, "--json", "url", "-q", ".url"]);
  if (existente.ok && existente.out.trim().startsWith("http")) {
    return { url: existente.out.trim(), alreadyExisted: true, title, body };
  }

  const creado = exec([
    "pr", "create",
    "--base", opts.base,
    "--head", run.item.branch,
    "--title", title,
    "--body", body,
  ]);
  if (!creado.ok) {
    return { url: null, alreadyExisted: false, error: creado.out, title, body };
  }

  const url = (creado.out.match(/https?:\/\/\S+/) || [null])[0];
  return { url, alreadyExisted: false, title, body };
}

function ejecutar(cli, args, cwd) {
  const r = spawnSync(cli, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return { ok: r.status === 0, out: `${r.stdout || ""}${r.stderr || ""}`.trim() };
}
