#!/usr/bin/env node
// La entrada unica.
//
// CONTRATO DE SALIDA: lo que una maquina consume va a stdout como JSON; lo que
// una persona lee va a stderr. Es lo que permite componer esto con otras
// herramientas, y lo que hace que los tests no dependan de parsear prosa.
//
// Los subcomandos que todavia no existen lo DICEN, con el identificador de la
// tarea que los trae. Un comando que existe a medias y falla raro es peor que
// uno que todavia no esta.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig, ConfigError } from "../src/config.mjs";
import { doctor } from "../src/doctor.mjs";
import { listRuns, loadRun, addTarget, saveRun } from "../src/state.mjs";
import { inspect as inspectLock } from "../src/lock.mjs";
import { validate } from "../src/schema.mjs";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const PENDIENTES = {};

/** Los subcomandos que llevan un item, y los que no. */
const CON_ITEM = ["plan", "run", "resume", "dispatch", "milestone", "diagnose", "unstick"];
const SIN_ITEM = ["inbox", "daemon", "prune"];

const AYUDA = `noxloop ${VERSION} — un ticket entra, un pull request sale.

  noxloop doctor                    que esta declarado, que falta, que credencial no esta
  noxloop validate [archivo]        valida una configuracion contra el esquema

  noxloop inbox                     que tickets hay asignados o mencionados. No ejecuta nada
  noxloop daemon                    el bucle: asignar un ticket es todo lo que hay que hacer

  noxloop plan <item>               planifica y PARA. Es el punto de aprobacion humana
  noxloop run <item>                ejecuta el plan: tareas en paralelo, un PR
  noxloop milestone <item>          prepara el recorrido de una epica o feature, y PARA
  noxloop milestone <item> --go     lo lanza  [--max-items N] [--skip a,b] [--only c]
  noxloop dispatch <item>           resuelve el nivel del ticket y delega

  noxloop status [<item>]           el estado de los recorridos, sin interpretacion
  noxloop diagnose <item>           que quedo a medias, y que decision hace falta
  noxloop resume <item>             retoma un recorrido interrumpido
  noxloop unstick <item> --task <t> --nota "<que se decidio>"
                                    devuelve una tarea bloqueada al bucle
  noxloop prune [--force]           limpia worktrees huerfanos (sin --force no descarta trabajo)
  noxloop board [--port N] [--open] el tablero 360 en el navegador: que hay, que corre,
                                    que te necesita. Solo lectura, solo 127.0.0.1.
                                    Con [--home <ruta>] no necesita configuracion
  noxloop add-target <item> <tarea> <ruta> "<motivo>"
                                    amplia el alcance de una tarea, con su motivo

Opciones globales:
  --config <ruta>   por defecto ./noxloop.config.json
  --json            fuerza salida JSON, tambien en status
  --search <dir>    donde buscar checkouts de repos sin \`path\` declarado
  --project <id>    en plan/milestone: el proyecto del servicio de control que lanza.
                    Queda escrito en el run para que el board lo atribuya sin adivinar
`;

function parseArgs(argv) {
  /** @type {{_: string[], flags: Record<string, string|boolean>}} */
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const nombre = a.slice(2);
      const siguiente = argv[i + 1];
      if (siguiente && !siguiente.startsWith("--")) {
        args.flags[nombre] = siguiente;
        i++;
      } else {
        args.flags[nombre] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function salidaJson(datos) {
  process.stdout.write(JSON.stringify(datos, null, 2) + "\n");
}

function aviso(texto) {
  process.stderr.write(texto + "\n");
}

function rutaConfig(args) {
  const p = args.flags.config || "noxloop.config.json";
  return resolve(String(p));
}

function cargar(args) {
  const ruta = rutaConfig(args);
  if (!existsSync(ruta)) {
    aviso(`no encontre ${ruta}.\nCopia examples/noxloop.config.json y editalo, o pasa --config <ruta>.`);
    process.exit(1);
  }
  try {
    return loadConfig(ruta);
  } catch (e) {
    if (e instanceof ConfigError) {
      aviso(`la configuracion de ${e.file} no es valida:`);
      for (const p of e.problems) aviso(`  - ${p}`);
      process.exit(1);
    }
    throw e;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const comando = args._[0];

  if (!comando || comando === "help" || args.flags.help) {
    aviso(AYUDA);
    process.exit(comando ? 0 : 1);
  }
  if (comando === "version" || args.flags.version) {
    salidaJson({ version: VERSION });
    return;
  }

  if (PENDIENTES[comando]) {
    aviso(
      `\`noxloop ${comando}\` todavia no esta implementado.\n` +
        `Lo trae ${PENDIENTES[comando]}.\n` +
        `Lo que ya funciona: ${[...CON_ITEM, ...SIN_ITEM, "doctor", "validate", "status", "add-target"].join(", ")}.`,
    );
    process.exit(2);
  }

  if (comando === "validate") {
    const ruta = args._[1] ? resolve(args._[1]) : rutaConfig(args);
    const esquema = JSON.parse(
      readFileSync(new URL("../schemas/config.schema.json", import.meta.url), "utf8"),
    );
    let crudo;
    try {
      crudo = JSON.parse(readFileSync(ruta, "utf8"));
    } catch (e) {
      aviso(`no se pudo leer ${ruta}: ${e.message}`);
      process.exit(1);
    }
    const problemas = validate(esquema, crudo);
    salidaJson({ file: ruta, valid: problemas.length === 0, problems: problemas });
    if (problemas.length) {
      aviso(`${ruta}: ${problemas.length} problema(s)`);
      for (const p of problemas) aviso(`  - ${p}`);
      process.exit(1);
    }
    aviso(`${ruta}: valida`);
    return;
  }

  if (comando === "doctor") {
    const config = cargar(args);
    const busqueda = args.flags.search ? [String(args.flags.search)] : [];
    const r = await doctor(config, { search: busqueda });
    salidaJson(r);
    aviso(r.ready ? "listo para usar" : `NO esta listo: ${r.problemas.length} problema(s)`);
    for (const p of r.problemas) aviso(`  ✗ ${p}`);
    for (const a of r.avisos) aviso(`  · ${a}`);
    if (!r.ready) process.exit(1);
    return;
  }

  if (comando === "board") {
    // El board NO pasa por `cargar`: es un lector de un directorio, y exigirle
    // una configuracion con proveedor y repos rompia justo su escenario —
    // mirar que quedo cuando el gestor esta caido, o desde otra maquina sin los
    // checkouts. Se encontro usandolo.
    const { resolverHomeDelBoard, levantarBoard } = await import("../src/board-server.mjs");
    const r = resolverHomeDelBoard(args.flags, process.env, () => cargar(args));
    if (!r.home) {
      aviso(r.problema);
      process.exit(1);
    }

    const { url, srv } = await levantarBoard({ home: r.home, port: args.flags.port ? Number(args.flags.port) : undefined });
    aviso(`board en ${url}`);
    aviso(`  lee ${r.home} (via ${r.de}) y no escribe nada`);
    aviso(`  ctrl-c para cerrarlo`);
    if (args.flags.open) {
      const { spawn } = await import("node:child_process");
      const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      try {
        spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
      } catch {
        aviso(`  (no pude abrir el navegador con ${cmd}: abrila a mano)`);
      }
    }
    for (const senial of ["SIGINT", "SIGTERM"]) {
      process.on(senial, () => {
        aviso(`\nrecibi ${senial}: cierro el board...`);
        srv.close(() => process.exit(0));
      });
    }
    return;
  }

  if (CON_ITEM.includes(comando) || SIN_ITEM.includes(comando)) {
    const itemId = args._[1];
    if (CON_ITEM.includes(comando) && !itemId) {
      aviso(`uso: noxloop ${comando} <item>`);
      process.exit(1);
    }
    const config = cargar(args);
    const { ejecutarComando } = await import("../src/comandos.mjs");

    // El daemon corre hasta que se lo interrumpe, y tiene que soltar el lock al
    // salir: si no, el proximo arranque lo encuentra tomado por un pid muerto.
    const ac = new AbortController();
    if (comando === "daemon") {
      for (const senial of ["SIGINT", "SIGTERM"]) {
        process.on(senial, () => {
          aviso(`\nrecibi ${senial}: termino la vuelta y suelto el lock...`);
          ac.abort();
        });
      }
    }

    const verbo = /** @type {any} */ (comando);
    const r = /** @type {any} */ (await ejecutarComando(verbo, itemId, config, {
      dryRun: Boolean(args.flags["dry-run"]),
      search: args.flags.search ? [String(args.flags.search)] : [],
      materialize: args.flags["no-materialize"] ? false : true,
      go: Boolean(args.flags.go),
      force: Boolean(args.flags.force),
      maxItems: args.flags["max-items"] ? Number(args.flags["max-items"]) : undefined,
      maxCostUsd: args.flags["max-cost"] ? Number(args.flags["max-cost"]) : undefined,
      skip: args.flags.skip ? String(args.flags.skip).split(",").map((x) => x.trim()) : undefined,
      only: args.flags.only ? String(args.flags.only).split(",").map((x) => x.trim()) : undefined,
      repo: args.flags.repo ? String(args.flags.repo) : undefined,
      task: args.flags.task ? String(args.flags.task) : undefined,
      nota: args.flags.nota ? String(args.flags.nota) : undefined,
      port: args.flags.port ? Number(args.flags.port) : undefined,
      open: Boolean(args.flags.open),
      volverA: args.flags["volver-a"] ? String(args.flags["volver-a"]) : undefined,
      // De que proyecto es el run. Lo sabe quien lanza —el servicio de control—
      // y no el motor: por eso viaja como opcion y no se deduce de la config.
      projectId: args.flags.project ? String(args.flags.project) : undefined,
      signal: ac.signal,
    }));
    salidaJson(r);
    for (const linea of r.humano || []) aviso(linea);
    if (r.ok === false) process.exit(1);
    return;
  }

  if (comando === "status") {
    const config = cargar(args);
    const home = config.home;
    const itemId = args._[1];
    // Solo lectura, y sin tocar el gestor: tiene que poder correr con la red
    // caida, que es justo cuando mas falta saber en que quedo un recorrido.
    const runs = itemId ? [loadRun(itemId, { home })].filter(Boolean) : listRuns({ home });
    const resumen = runs.map((run) => ({
      item: { id: run.item.id, title: run.item.title, pr: run.item.pr, branch: run.item.branch },
      lock: inspectLock(`run-${run.item.id}`, { home }),
      spent: run.spent,
      tasks: (run.tasks || []).map((t) => ({
        id: t.id,
        repo: t.repo,
        status: t.status,
        tier: t.tier,
        attempts: t.attempts,
        redVerified: t.redVerified,
        gate: t.gateEvidence ? { exitCode: t.gateEvidence.exitCode, ranAt: t.gateEvidence.ranAt } : null,
        addedTargets: t.addedTargets,
        lastFailure: t.lastFailure,
      })),
    }));
    salidaJson({ home, runs: resumen });
    if (!runs.length) aviso(itemId ? `no hay recorrido para ${itemId}` : "no hay recorridos");
    return;
  }

  if (comando === "add-target") {
    const [, itemId, taskId, ruta, ...motivo] = args._;
    if (!itemId || !taskId || !ruta || motivo.length === 0) {
      aviso('uso: noxloop add-target <item> <tarea> <ruta> "<motivo>"');
      process.exit(1);
    }
    const config = cargar(args);
    const run = loadRun(itemId, { home: config.home });
    if (!run) {
      aviso(`no hay recorrido para ${itemId}`);
      process.exit(1);
    }
    addTarget(run, taskId, ruta, motivo.join(" "));
    saveRun(run, { home: config.home });
    salidaJson({ item: itemId, task: taskId, added: ruta });
    aviso(`${ruta} declarado en ${taskId}; queda registrado y se reporta en el PR`);
    return;
  }

  aviso(`no conozco el comando "${comando}".\n\n${AYUDA}`);
  process.exit(1);
}

main().catch((e) => {
  aviso(`error: ${e.message}`);
  process.exit(1);
});
