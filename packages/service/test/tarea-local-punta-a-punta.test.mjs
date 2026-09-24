// US7, el test independiente de la spec, con PROCESOS DE VERDAD: sin ningun
// gestor conectado, crear una tarea, pulsar Run, y ver el run del motor sobre
// ella hasta el PR.
//
// LO QUE ESTE TEST PRUEBA QUE NINGUN OTRO PRUEBA. Que el motor —otro proceso,
// que no puede abrir el almacen— lee la tarea, mueve su estado y deja el
// enlace al PR PASANDO POR EL SERVICIO: el proveedor local, cargado por el
// motor desde su configuracion, le habla a `/v1/tasks/...` con el token de
// sesion que el lanzador le puso en el entorno. Si esa costura fallara, el
// planificador diria «el ticket no existe» o el board dejaria la tarea en Todo
// con el PR ya abierto (US7, escenario 3: el gestor local implementa el mismo
// contrato que Linear).
//
// Como en `lanzar-motor-real.test.mjs`, lo unico que no es la CLI del motor es
// el punto de entrada: el modelo y el forge se inyectan en
// `fixtures/motor-con-agente-falso.mjs`; worktrees, gate, commits, estado del
// run y el proveedor local corren de verdad.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { conServicio, pedir } from "./ayuda.mjs";
import { proyectoActivo, repoConRemoto } from "./ayuda-motor.mjs";

const FIXTURE = new URL("./fixtures/motor-con-agente-falso.mjs", import.meta.url).pathname;

const conectado = async (argv) =>
  argv[0] === "claude"
    ? { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }), stderr: "" }
    : { code: 0, stdout: "Not logged in", stderr: "" };

test("US7 — una tarea local, sin gestor conectado, llega a En revision con su PR; el motor escribe su estado por el servicio", async () => {
  await conServicio({ motor: { binDelMotor: FIXTURE, intervaloMs: 100, ejecutarAutenticacion: conectado } }, async (svc) => {
    const org = repoConRemoto();
    const proyecto = await proyectoActivo(svc, { nombre: "Payments", ruta: org.repo, autonomia: "L2", conexiones: [] });

    const alta = await pedir(svc, `/v1/projects/${proyecto.id}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        titulo: "publicar el catalogo de permisos",
        plan: "## Plan\nExportar el catalogo desde `src/permisos.mjs`.",
        criterios: ["el modulo de permisos exporta el catalogo"],
        prioridad: 1,
      }),
    });
    assert.equal(alta.status, 201, await alta.clone().text());
    const tarea = (await alta.json()).tarea;
    assert.equal(tarea.key, "PAY-1");

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: tarea.id }),
    });
    assert.equal(r.status, 202, await r.clone().text());

    const fin = Date.now() + 90_000;
    let item = null;
    while (Date.now() < fin) {
      const lista = await (await pedir(svc, `/v1/runs?project=${proyecto.id}`)).json();
      item = lista.items.find((/** @type {any} */ x) => x.itemId === tarea.id);
      if (item && ["pr_abierto", "fallido", "bloqueado", "necesita_criterios", "interrumpido"].includes(item.estado)) break;
      await new Promise((listo) => setTimeout(listo, 200));
    }
    assert.equal(item?.estado, "pr_abierto", `el run no llego al PR: ${JSON.stringify(item)}`);

    // El motor leyo la tarea POR EL CONTRATO: el run lleva su clave y su titulo.
    const enDisco = JSON.parse(readFileSync(join(svc.home, "runs", `run-${tarea.id}.json`), "utf8"));
    assert.equal(enDisco.item.key, "PAY-1");
    assert.equal(enDisco.item.provider, "local");
    assert.equal(enDisco.projectId, proyecto.id);

    // Y ESCRIBIO por el servicio: el estado de la tarea y el enlace al PR.
    const leida = await (await pedir(svc, `/v1/tasks/${tarea.id}`)).json();
    assert.equal(leida.tarea.estado, "in_review", "el motor no movio el estado de la tarea local");
    assert.ok(
      leida.comentarios.some((/** @type {any} */ c) => c.texto.includes("https://forja.test/pr/1")),
      `el enlace al PR no quedo en la tarea: ${JSON.stringify(leida.comentarios)}`,
    );

    // El board la pinta donde toca, con su origen.
    const board = await (await pedir(svc, `/v1/board?project=${proyecto.id}`)).json();
    const tarjeta = board.tarjetas.find((/** @type {any} */ x) => x.id === `${proyecto.id}:${tarea.id}`);
    assert.equal(tarjeta?.columna, "in_review", JSON.stringify(tarjeta));
    assert.equal(tarjeta.origen, "local");
    assert.equal(tarjeta.ticket.key, "PAY-1");
    assert.equal(tarjeta.chip.tipo, "pr_listo");
  });
});
