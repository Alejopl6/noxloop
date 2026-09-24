// Run desde el board, con PROCESOS DE VERDAD: el servicio compone la
// configuracion del proyecto, arranca el motor como subproceso y el run queda
// en disco con su PR (SC-005, con el proveedor `fake` y el agente falso).
//
// POR QUE ESTE TEST PAGA LOS PROCESOS. Los demas tests del lanzador inyectan el
// spawn para probar la politica. Este prueba que la politica y el motor
// ENCAJAN: que la configuracion que compone `motor.mjs` la carga el motor, que
// `--project` llega al archivo del run, que el entorno declarado alcanza para
// que el motor corra (git, npm, el gate), y que lo que el motor escribe es lo
// que el board lee. Cada una de esas costuras ya fallo alguna vez en este
// repositorio cuando se juntaron las piezas.
//
// Lo unico que no es el binario de la CLI es el punto de entrada: el agente de
// verdad necesita un modelo, asi que se lanza `fixtures/motor-con-agente-falso.mjs`,
// que acepta la misma linea de comandos y llama al mismo `ejecutarComando`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as fake from "../../../providers/fake/index.mjs";
import { VARIABLES_DEL_ENTORNO_BASE } from "../src/lanzador.mjs";
import { conServicio, pedir } from "./ayuda.mjs";
import { proyectoActivo, repoConRemoto } from "./ayuda-motor.mjs";

const FIXTURE = new URL("./fixtures/motor-con-agente-falso.mjs", import.meta.url).pathname;

const git = (cwd, ...a) =>
  execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

test("SC-005 — Run en un proyecto L2: el motor corre como subproceso y el ticket llega a En revision con su PR", async (t) => {
  fake.reset();
  t.after(() => fake.reset());
  await conServicio({ motor: { binDelMotor: FIXTURE, intervaloMs: 100 } }, async (svc) => {
    const org = repoConRemoto();
    const proyecto = await proyectoActivo(svc, { ruta: org.repo, autonomia: "L2" });

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: "2" }),
    });
    assert.equal(r.status, 202, await r.clone().text());

    // Se espera mirando lo que mira la interfaz: `/v1/runs`.
    const fin = Date.now() + 90_000;
    let item = null;
    while (Date.now() < fin) {
      const lista = await (await pedir(svc, `/v1/runs?project=${proyecto.id}`)).json();
      item = lista.items.find((/** @type {any} */ x) => x.itemId === "2");
      if (item && ["pr_abierto", "fallido", "bloqueado", "necesita_criterios", "interrumpido"].includes(item.estado)) break;
      await new Promise((listo) => setTimeout(listo, 200));
    }
    assert.equal(item?.estado, "pr_abierto", `el run no llego al PR: ${JSON.stringify(item)}`);
    assert.equal(item.pr, "https://forja.test/pr/1");
    assert.deepEqual(item.avance, { hechas: 1, total: 1, fase: null });

    // EL RUN EN DISCO, escrito por el motor —no por este servicio— y con el
    // proyecto de quien lo lanzo: `--project` llego hasta `createRun`.
    const enDisco = JSON.parse(readFileSync(join(svc.home, "runs", "run-2.json"), "utf8"));
    assert.equal(enDisco.projectId, proyecto.id, "el run no quedo atribuido al proyecto que lo lanzo (FR-019)");
    assert.equal(enDisco.item.pr, "https://forja.test/pr/1");

    // El trabajo existe de verdad: test antes que implementacion, en la rama del
    // ticket, y la base intacta (principio IV).
    const historial = git(org.repo, "log", "--format=%s", "--reverse", enDisco.item.branch).split("\n");
    assert.ok(historial.findIndex((l) => l.startsWith("test(")) < historial.findIndex((l) => l.startsWith("feat(")));
    assert.equal(git(org.remoto, "log", "--oneline", "main").split("\n").length, 1, "la base del remoto se movio");

    // El entorno que recibio el subproceso: el DECLARADO, no el del servicio.
    const nombres = JSON.parse(readFileSync(join(svc.home, "entorno-del-motor.json"), "utf8"));
    for (const n of nombres) {
      assert.ok(
        // `__CF_USER_TEXT_ENCODING` lo pone macOS en todo proceso hijo.
        [...VARIABLES_DEL_ENTORNO_BASE, "NOXLOOP_HOME", "__CF_USER_TEXT_ENCODING"].includes(n),
        `el motor heredo \`${n}\` del servicio: el entorno del subproceso se construye, no se hereda`,
      );
    }

    // Y el board lo pinta donde toca, con el enlace al PR.
    const board = await (await pedir(svc, `/v1/board?project=${proyecto.id}`)).json();
    const tarjeta = board.tarjetas.find((/** @type {any} */ x) => x.id === `${proyecto.id}:2`);
    assert.equal(tarjeta?.columna, "in_review", JSON.stringify(tarjeta));
    assert.equal(tarjeta.chip.tipo, "pr_listo");
    assert.equal(tarjeta.chip.texto, "PR #1 listo");
    assert.equal(tarjeta.accion.tipo, "open_run");
  });
});
