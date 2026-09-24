// Las tareas propias por el servicio (spec 003, US7, FR-030..032).
//
// LO QUE SE PRUEBA, en el orden en que el operador lo vive: crea una tarea
// desde el board sin haber conectado ningun gestor, la ve en Todo con su clave,
// pulsa Run, y el motor la recibe por el MISMO contrato que un ticket de Linear.
// Todo pasa por el servicio: es el unico escritor del almacen (principio VIII),
// tambien cuando quien escribe el estado de la tarea es el motor.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";

import { conServicio, pedir, TOKEN } from "./ayuda.mjs";
import { proyectoActivo, runEnDisco } from "./ayuda-motor.mjs";

/** Un spawn que no lanza nada: registra, y el motor "termina" cuando el test quiere. */
function spawnQueRegistra() {
  const llamadas = [];
  const spawn = (comando, args, opciones) => {
    const hijo = /** @type {any} */ (new EventEmitter());
    hijo.stdout = new PassThrough();
    hijo.stderr = new PassThrough();
    hijo.kill = () => {
      setImmediate(() => hijo.emit("close", null, "SIGTERM"));
      return true;
    };
    llamadas.push({ comando, args, opciones, hijo });
    return hijo;
  };
  return { spawn, llamadas };
}

/** Claude conectado con la suscripcion, Codex sin sesion: el `ejecutar` de `estadoDeAutenticacion`. */
const autenticacion = (conectados = ["claude-agent-sdk"]) => async (argv) => {
  if (argv[0] === "claude") {
    return { code: 0, stdout: JSON.stringify({ loggedIn: conectados.includes("claude-agent-sdk"), authMethod: "claude.ai" }), stderr: "" };
  }
  return { code: 0, stdout: conectados.includes("codex") ? "Logged in using ChatGPT" : "Not logged in", stderr: "" };
};

const json = (cuerpo) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });

async function crear(svc, proyectoId, cuerpo) {
  const r = await pedir(svc, `/v1/projects/${proyectoId}/tasks`, json(cuerpo));
  return { estado: r.status, cuerpo: await r.json() };
}

test("POST /v1/projects/:id/tasks crea la tarea con su clave `<PREFIJO>-<n>` y la devuelve entera", async () => {
  await conServicio({ motor: { intervaloMs: 0, ejecutarAutenticacion: autenticacion() } }, async (svc) => {
    const p = await proyectoActivo(svc, { nombre: "Payments", conexiones: [] });
    const r = await crear(svc, p.id, {
      titulo: "cobrar con un clic",
      plan: "## Plan\n- boton",
      criterios: ["el cobro se hace con un clic"],
      prioridad: 1,
      etiquetas: ["api"],
    });
    assert.equal(r.estado, 201, JSON.stringify(r.cuerpo));
    const t = r.cuerpo.tarea;
    assert.equal(t.key, "PAY-1");
    assert.equal(t.projectId, p.id);
    assert.equal(t.estado, "todo");
    assert.equal(t.termino, "pr");
    assert.equal(t.ejecutor, null);
    assert.deepEqual(t.criterios, ["el cobro se hace con un clic"]);

    const segunda = await crear(svc, p.id, { titulo: "devolver", plan: "", criterios: [], prioridad: null, etiquetas: [] });
    assert.equal(segunda.cuerpo.tarea.key, "PAY-2");

    const leida = await (await pedir(svc, `/v1/tasks/${t.id}`)).json();
    assert.equal(leida.tarea.key, "PAY-1");

    const lista = await (await pedir(svc, `/v1/projects/${p.id}/tasks`)).json();
    assert.deepEqual(lista.items.map((x) => x.key), ["PAY-2", "PAY-1"]);
    assert.equal(lista.total, 2);
  });
});

test("la forma se valida ANTES de escribir: sin titulo, prioridad fuera de 0..4, un termino que mergea, un ejecutor sin runtime", async () => {
  await conServicio({ motor: { intervaloMs: 0 } }, async (svc) => {
    const p = await proyectoActivo(svc, { conexiones: [] });
    for (const [cuerpo, campo] of [
      [{ plan: "x" }, "titulo"],
      [{ titulo: "x", prioridad: 9 }, "prioridad"],
      [{ titulo: "x", termino: "merge" }, "termino"],
      [{ titulo: "x", ejecutor: { agente: "a" } }, "ejecutor"],
      [{ titulo: "x", criterios: "uno" }, "criterios"],
    ]) {
      const r = await crear(svc, p.id, cuerpo);
      assert.equal(r.estado, 400, `${campo}: ${JSON.stringify(r.cuerpo)}`);
      assert.equal(r.cuerpo.error.codigo, "cuerpo_invalido");
      assert.match(r.cuerpo.error.causa, new RegExp(campo));
    }
    const lista = await (await pedir(svc, `/v1/projects/${p.id}/tasks`)).json();
    assert.equal(lista.total, 0, "un cuerpo invalido dejo una fila a medias");
  });
});

test("PATCH edita, POST comments acumula, y DELETE solo borra una tarea SIN run", async () => {
  await conServicio({ motor: { intervaloMs: 0 } }, async (svc) => {
    const p = await proyectoActivo(svc, { conexiones: [] });
    const t = (await crear(svc, p.id, { titulo: "una" })).cuerpo.tarea;

    const r = await pedir(svc, `/v1/tasks/${t.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ titulo: "otra", ejecutor: { runtime: "claude-agent-sdk", agente: "api" }, termino: "commit", key: "HACK-1" }),
    });
    assert.equal(r.status, 200);
    const cambiada = (await r.json()).tarea;
    assert.equal(cambiada.titulo, "otra");
    assert.equal(cambiada.termino, "commit");
    assert.equal(cambiada.key, t.key, "la clave no se edita");

    const c = await pedir(svc, `/v1/tasks/${t.id}/comments`, json({ texto: "PR abierto: https://forja.test/pr/1" }));
    assert.equal(c.status, 201);
    assert.deepEqual((await (await pedir(svc, `/v1/tasks/${t.id}`)).json()).comentarios.map((x) => x.texto), [
      "PR abierto: https://forja.test/pr/1",
    ]);

    // Con un run en disco, borrar dejaria un run apuntando a nada.
    const conRun = (await crear(svc, p.id, { titulo: "con run" })).cuerpo.tarea;
    runEnDisco(svc.home, conRun.id, { projectId: p.id });
    const no = await pedir(svc, `/v1/tasks/${conRun.id}`, { method: "DELETE" });
    assert.equal(no.status, 409);
    assert.equal((await no.json()).error.codigo, "tarea_con_run");

    const si = await pedir(svc, `/v1/tasks/${t.id}`, { method: "DELETE" });
    assert.equal(si.status, 200);
    assert.equal((await pedir(svc, `/v1/tasks/${t.id}`)).status, 404);
  });
});

test("US7-1: un proyecto SIN gestor muestra sus tareas en el board, con origen `local`, clave y ejecutor resuelto", async () => {
  await conServicio({ motor: { intervaloMs: 0, ejecutarAutenticacion: autenticacion() } }, async (svc) => {
    const p = await proyectoActivo(svc, { nombre: "Payments", conexiones: [] });
    const t = (await crear(svc, p.id, { titulo: "cobrar", criterios: ["cobra"], prioridad: 0, etiquetas: ["api"] })).cuerpo.tarea;
    await crear(svc, p.id, { titulo: "idea", estado: "backlog" });

    const board = await (await pedir(svc, `/v1/board?project=${p.id}`)).json();
    const tarjeta = board.tarjetas.find((x) => x.id === `${p.id}:${t.id}`);
    assert.ok(tarjeta, JSON.stringify(board));
    assert.equal(tarjeta.origen, "local");
    assert.equal(tarjeta.ticket.key, "PAY-1");
    assert.equal(tarjeta.ticket.prioridad, 0);
    assert.equal(tarjeta.columna, "todo");
    assert.deepEqual(tarjeta.ejecutor, { runtime: "claude-agent-sdk", agente: null });
    assert.deepEqual(tarjeta.accion, { tipo: "run", habilitada: true, motivo: null });
    assert.ok(board.tarjetas.some((x) => x.ticket.titulo === "idea" && x.columna === "backlog"));
    assert.equal(board.proyectos.find((x) => x.id === p.id).gestor, "local");
    assert.ok(!board.avisos.some((a) => /gestor/i.test(a.causa)), "un proyecto sin gestor externo ya no es un aviso");
  });
});

test("FR-031/032: el ejecutor y el termino que el motor NO sabe cumplir deshabilitan Run diciendo el hueco", async () => {
  await conServicio({ motor: { intervaloMs: 0, ejecutarAutenticacion: autenticacion(["claude-agent-sdk", "codex"]) } }, async (svc) => {
    const p = await proyectoActivo(svc, { conexiones: [] });
    const codex = (await crear(svc, p.id, { titulo: "con codex", ejecutor: { runtime: "codex" } })).cuerpo.tarea;
    const commit = (await crear(svc, p.id, { titulo: "solo commit", termino: "commit" })).cuerpo.tarea;
    const board = await (await pedir(svc, `/v1/board?project=${p.id}`)).json();

    const deCodex = board.tarjetas.find((x) => x.ticket.id === codex.id);
    assert.deepEqual(deCodex.ejecutor, { runtime: "codex", agente: null });
    assert.equal(deCodex.accion.habilitada, false);
    assert.match(deCodex.accion.motivo, /codex/);

    const deCommit = board.tarjetas.find((x) => x.ticket.id === commit.id);
    assert.equal(deCommit.accion.habilitada, false);
    assert.match(deCommit.accion.motivo, /commit/);

    // Y la ruta dice lo mismo que el boton: el 409 con el hueco, no un run que muere.
    const r = await pedir(svc, `/v1/projects/${p.id}/runs`, json({ itemId: commit.id }));
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error.codigo, "termino_sin_soporte");
    const r2 = await pedir(svc, `/v1/projects/${p.id}/runs`, json({ itemId: codex.id }));
    assert.equal(r2.status, 409);
    assert.equal((await r2.json()).error.codigo, "ejecutor_sin_soporte");
  });
});

test("un runtime sin sesion ni key: Run deshabilitado con «Conecta un modelo en Settings → Modelos»", async () => {
  await conServicio({ motor: { intervaloMs: 0, ejecutarAutenticacion: autenticacion([]) } }, async (svc) => {
    const p = await proyectoActivo(svc, { conexiones: [] });
    await crear(svc, p.id, { titulo: "sin modelo" });
    const board = await (await pedir(svc, `/v1/board?project=${p.id}`)).json();
    const t = board.tarjetas.find((x) => x.ticket.titulo === "sin modelo");
    assert.equal(t.accion.habilitada, false);
    assert.match(t.accion.motivo, /Conecta un modelo en Settings → Modelos/);
  });
});

test("Run sobre una tarea local: el motor recibe el gestor `local`, el runtime resuelto, y el servicio por ENTORNO (token fuera de argv)", async () => {
  const falso = spawnQueRegistra();
  await conServicio({ motor: { intervaloMs: 0, spawn: falso.spawn, ejecutarAutenticacion: autenticacion() } }, async (svc) => {
    const p = await proyectoActivo(svc, { conexiones: [], autonomia: "L1" });
    const t = (await crear(svc, p.id, { titulo: "cobrar", criterios: ["cobra"], ejecutor: { runtime: "claude-agent-sdk", agente: "api" } })).cuerpo.tarea;

    const r = await pedir(svc, `/v1/projects/${p.id}/runs`, json({ itemId: t.id }));
    assert.equal(r.status, 202, await r.clone().text());
    const fin = Date.now() + 2000;
    while (!falso.llamadas.length && Date.now() < fin) await new Promise((l) => setTimeout(l, 5));
    const { args, opciones } = falso.llamadas[0];

    assert.ok(!args.some((a) => a.includes(TOKEN)), "el token de sesion aparecio en la linea de comandos");
    assert.equal(opciones.env.NOXLOOP_SERVICE_TOKEN, TOKEN);
    assert.equal(opciones.env.NOXLOOP_SERVICE_URL, svc.url);

    const config = JSON.parse(readFileSync(args[args.indexOf("--config") + 1], "utf8"));
    assert.equal(config.provider.name, "local");
    assert.deepEqual(config.provider.options, { projectId: p.id });
    assert.equal(config.provider.stateMap.done, null, "el motor no cierra tareas: la autonomia termina en el PR");
    assert.equal(config.runtime, "claude-agent-sdk");
    const gaps = Object.values(config.repos)[0].gaps.join(" ");
    assert.match(gaps, /agente `api`/, "el agente que el motor no sabe entregar se declara como hueco en el PR");
  });
});
