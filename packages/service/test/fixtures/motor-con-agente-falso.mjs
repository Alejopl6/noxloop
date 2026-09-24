#!/usr/bin/env node
// El motor DE VERDAD, con el agente falso: lo que el lanzador del servicio
// arranca en `lanzar-motor-real.test.mjs` en lugar de `bin/noxloop.mjs`.
//
// POR QUE HACE FALTA Y QUE SE CAMBIA. La CLI del motor monta el runtime de
// Claude, y en un test no hay modelo. Este archivo acepta EXACTAMENTE la misma
// linea de comandos que la CLI para los pasos que el servicio lanza
// (`plan|run|resume <item> --config <ruta> [--project <id>]`), carga la
// configuracion con el MISMO `loadConfig` —con `NOXLOOP_HOME` del entorno, como
// la CLI— y llama al MISMO `ejecutarComando`. Lo unico inyectado es lo que no
// puede existir sin red ni cuenta: el modelo (que escribe el plan, el test y la
// implementacion y corre la fase por el adaptador `fake`) y el forge. Worktrees,
// gate real, commits, cola de integracion y estado del run corren de verdad.
//
// Y DEJA DICHO QUE ENTORNO RECIBIO: los NOMBRES de sus variables, nunca los
// valores, en `<home>/entorno-del-motor.json`. Es como el test comprueba que el
// subproceso recibio el entorno declarado y no el del servicio heredado.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadConfig } from "../../../engine/src/config.mjs";
import { ejecutarComando } from "../../../engine/src/comandos.mjs";
import { crearAdaptadorFake } from "../../../adapters/src/adaptadores/fake.mjs";

const argv = process.argv.slice(2);
const [comando, itemId] = argv;
// `node --test` tambien corre los `.mjs` bajo `test/`: sin orden no hay nada
// que simular, y sin esta salida el runner lo contaba como un test fallido.
if (!comando) process.exit(0);
const flag = (/** @type {string} */ n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const config = loadConfig(String(flag("config")));
mkdirSync(config.home, { recursive: true });
writeFileSync(join(config.home, "entorno-del-motor.json"), JSON.stringify(Object.keys(process.env).sort()));

const adaptador = crearAdaptadorFake();

/** @param {any} fase */
async function modelo(fase) {
  if (fase.phase === "PLAN") {
    const ruta = /--out (\S+)/.exec(fase.prompt)?.[1];
    if (!ruta) throw new Error(`el prompt de PLAN no dice donde escribir: ${fase.prompt}`);
    const repo = Object.keys(config.repos)[0];
    mkdirSync(join(ruta, ".."), { recursive: true });
    writeFileSync(
      ruta,
      JSON.stringify({
        repoScope: [repo],
        evidence: [{ repo, why: "es el unico repositorio del proyecto" }],
        tasks: [
          {
            id: "T001",
            repo,
            title: "publicar el catalogo de permisos",
            acceptance: "el modulo de permisos exporta el catalogo",
            targetFiles: ["src/permisos.mjs"],
            testFiles: ["test/permisos.test.mjs"],
            tier: "small",
            dependsOn: [],
            dependencyKind: "hard",
          },
        ],
      }),
    );
  }
  const t = fase.task;
  if (fase.phase === "RED") {
    mkdirSync(join(fase.cwd, "test"), { recursive: true });
    writeFileSync(
      join(fase.cwd, t.testFiles[0]),
      `import { catalogo } from "../${t.targetFiles[0]}";\nif (!Array.isArray(catalogo)) throw new Error("rojo");\n`,
    );
  }
  if (fase.phase === "GREEN") {
    mkdirSync(join(fase.cwd, "src"), { recursive: true });
    writeFileSync(join(fase.cwd, t.targetFiles[0]), 'export const catalogo = ["leer", "escribir"];\n');
  }
  return await adaptador.runPhase(fase);
}

const r = /** @type {any} */ (
  await ejecutarComando(/** @type {any} */ (comando), itemId, config, {
    inject: {
      runPhase: modelo,
      createPR: async () => ({ url: "https://forja.test/pr/1", alreadyExisted: false }),
    },
    projectId: flag("project"),
  })
);
process.stdout.write(JSON.stringify(r, null, 2) + "\n");
if (r.ok === false) process.exit(1);
