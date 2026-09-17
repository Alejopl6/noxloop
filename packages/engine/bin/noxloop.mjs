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

const PENDIENTES = {
  plan: "T036-T040 (fase 3 de tasks.md)",
  run: "T036-T040 (fase 3 de tasks.md)",
  resume: "T068 (fase 6 de tasks.md)",
  milestone: "T049-T052 (fase 4 de tasks.md)",
  inbox: "T079 (fase 8 de tasks.md)",
  daemon: "T079-T080 (fase 8 de tasks.md)",
  unstick: "T070 (fase 6 de tasks.md)",
};

const AYUDA = `noxloop ${VERSION} — un ticket entra, un pull request sale.

  noxloop doctor                    que esta declarado, que falta, que credencial no esta
  noxloop validate [archivo]        valida una configuracion contra el esquema
  noxloop status [<item>]           el estado de los recorridos, sin interpretacion
  noxloop add-target <item> <tarea> <ruta> "<motivo>"
                                    amplia el alcance de una tarea, con su motivo

Todavia no implementados (cada uno dice que tarea lo trae):
  plan, run, resume, milestone, inbox, daemon, unstick

Opciones globales:
  --config <ruta>   por defecto ./noxloop.config.json
  --json            fuerza salida JSON, tambien en status
  --search <dir>    donde buscar checkouts de repos sin \`path\` declarado
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
        `Lo que ya funciona: doctor, validate, status, add-target.`,
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
