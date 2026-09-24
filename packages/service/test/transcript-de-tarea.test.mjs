// `GET /v1/runs/:itemId/tasks/:taskId/transcript` y el evento `run.transcript`
// (spec 004, US2, FR-005, SC-002).
//
// LO QUE SE PRUEBA. Que la ruta devuelve lo que el MOTOR escribio —se escribe
// con `abrirTranscript` del motor y se lee con el servicio, para que los
// nombres de archivo no puedan separarse—, por fases y en orden, con los
// tokens de cada fase y «sin medir» distinto de cero; que pagina y dice lo
// cortado; que una linea a medias no se devuelve; que leer no escribe NADA
// (principio VIII); y que cuando el transcript crece llega `run.transcript`
// por el canal en menos de tres segundos (SC-002).

import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { conServicio, diferencias, eventos, huellaDelArbol, leerFrames, pedir } from "./ayuda.mjs";
import { runEnDisco } from "./ayuda-motor.mjs";
import { leerTranscript, vigilarTranscripts } from "../src/transcript.mjs";
import { abrirTranscript, rutaDeTranscript } from "../../engine/src/transcript.mjs";

const ahora = (ms = 0) => new Date(Date.parse("2026-09-24T10:00:00.000Z") + ms).toISOString();

/** Las fases de T001 como las deja el motor: RED sin medir, GREEN medida, dos lentes de REVIEW. */
async function transcriptsDeEjemplo(home, itemId = "9") {
  const red = await abrirTranscript({ home, itemId, taskId: "T001", fase: "RED", env: {}, secretos: [] });
  red.alEvento({ t: ahora(0), tipo: "texto", contenido: "Escribo el test del **criterio**." });
  red.alEvento({ t: ahora(1), tipo: "herramienta", herramienta: "Write", contenido: '{"file_path":"test/csv.test.mjs"}' });
  red.alEvento({ t: ahora(2), tipo: "resultado_herramienta", herramienta: "Write", contenido: "escrito" });
  red.cerrar({ ok: true, text: "rojo, como se esperaba" });

  const green = await abrirTranscript({ home, itemId, taskId: "T001", fase: "GREEN", env: {}, secretos: [] });
  green.alEvento({ t: ahora(10), tipo: "texto", contenido: "Implemento." });
  green.alEvento({
    t: ahora(11), tipo: "resultado", contenido: "verde",
    tokens: { entrada: 1200, salida: 300, cacheLectura: 5000, cacheEscritura: null },
  });
  green.cerrar({ ok: true, text: "verde" });

  for (const [lente, ms] of [["seguridad", 20], ["correccion", 21]]) {
    const rev = await abrirTranscript({ home, itemId, taskId: "T001", fase: "REVIEW", lente, env: {}, secretos: [] });
    rev.alEvento({
      t: ahora(ms), tipo: "resultado", contenido: `sin hallazgos de ${lente}`,
      tokens: { entrada: 10, salida: 5, cacheLectura: null, cacheEscritura: null },
    });
    rev.cerrar({ ok: true, text: "ok" });
  }
  // Otra tarea del mismo run: no puede colarse en el transcript de T001.
  const otra = await abrirTranscript({ home, itemId, taskId: "T0011", fase: "GREEN", env: {}, secretos: [] });
  otra.cerrar({ ok: true, text: "de otra tarea" });
}

function runDeEjemplo(home) {
  return runEnDisco(home, "9", {
    projectId: "p-1",
    tasks: [
      { id: "T001", title: "exportar", repo: "app", status: "reviewed", attempts: {}, dependsOn: [] },
      { id: "T0011", title: "otra", repo: "app", status: "pending", attempts: {}, dependsOn: [] },
    ],
  });
}

test("US2: por fases y en orden, cada una con sus eventos y sus tokens; «sin medir» no es cero", async () => {
  await conServicio({ motor: { intervaloMs: 0 } }, async (svc) => {
    runDeEjemplo(svc.home);
    await transcriptsDeEjemplo(svc.home);

    const r = await pedir(svc, "/v1/runs/9/tasks/T001/transcript");
    assert.equal(r.status, 200, await r.clone().text());
    const t = await r.json();

    assert.deepEqual(
      t.fases.map((f) => [f.fase, f.lente ?? null]),
      [["RED", null], ["GREEN", null], ["REVIEW", "seguridad"], ["REVIEW", "correccion"]],
      "las fases salen en el orden en que ocurrieron, y la otra tarea no se cuela",
    );
    const [red, green] = t.fases;
    assert.deepEqual(red.eventos.map((e) => e.tipo), ["texto", "herramienta", "resultado_herramienta", "resultado"]);
    assert.equal(red.eventos[2].herramienta, "Write");
    assert.deepEqual(red.tokens, { medido: false, entrada: null, salida: null, cacheLectura: null, cacheEscritura: null });
    assert.deepEqual(green.tokens, { medido: true, entrada: 1200, salida: 300, cacheLectura: 5000, cacheEscritura: null });
    assert.equal(red.cortado, false);
    assert.equal(red.siguiente, 4);

    // El total no es medido: RED no se midio, y un total con una parte sin
    // contar se leeria como el gasto entero.
    assert.equal(t.total.medido, false);

    const soloRevision = await (await pedir(svc, "/v1/runs/9/tasks/T001/transcript?fase=REVIEW")).json();
    assert.deepEqual(soloRevision.fases.map((f) => f.lente), ["seguridad", "correccion"]);
    assert.deepEqual(soloRevision.total, { medido: true, entrada: 20, salida: 10, cacheLectura: null, cacheEscritura: null });
  });
});

test("paginado: `desde` y `limite` por linea, `siguiente` para lo que sigue, y lo cortado se dice", async () => {
  await conServicio({ motor: { intervaloMs: 0 } }, async (svc) => {
    runDeEjemplo(svc.home);
    await transcriptsDeEjemplo(svc.home);

    const primera = await (await pedir(svc, "/v1/runs/9/tasks/T001/transcript?fase=RED&limite=2")).json();
    const [f1] = primera.fases;
    assert.equal(f1.eventos.length, 2);
    assert.equal(f1.cortado, true, "hay mas lineas y no se dice");
    assert.equal(f1.siguiente, 2);
    assert.equal(f1.total, 4);

    const segunda = await (await pedir(svc, `/v1/runs/9/tasks/T001/transcript?fase=RED&desde=${f1.siguiente}&limite=2`)).json();
    assert.deepEqual(segunda.fases[0].eventos.map((e) => e.tipo), ["resultado_herramienta", "resultado"]);
    assert.equal(segunda.fases[0].cortado, false);

    const mal = await pedir(svc, "/v1/runs/9/tasks/T001/transcript?desde=-1");
    assert.equal(mal.status, 400);
    assert.equal((await mal.json()).error.codigo, "parametro_invalido");
  });
});

test("una linea a medias —el motor escribiendo— no se devuelve ni se cuenta hasta que termina", async () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-transcript-svc-"));
  await transcriptsDeEjemplo(home);
  const ruta = rutaDeTranscript(home, { itemId: "9", taskId: "T001", fase: "GREEN" });
  appendFileSync(ruta, '{"t":"2026-09-24T10:00:30.000Z","tipo":"texto","conte');
  const [green] = leerTranscript(home, "9", "T001", { fase: "GREEN" }).fases;
  assert.equal(green.total, 2);
  assert.equal(green.eventos.length, 2);
  appendFileSync(ruta, 'nido":"ya entera"}\n');
  const [despues] = leerTranscript(home, "9", "T001", { fase: "GREEN", desde: green.siguiente }).fases;
  assert.deepEqual(despues.eventos.map((e) => e.contenido), ["ya entera"]);
});

test("run o tarea que no existen: 404 que dice donde mirar; una tarea sin transcript todavia: fases vacias", async () => {
  await conServicio({ motor: { intervaloMs: 0 } }, async (svc) => {
    runDeEjemplo(svc.home);
    assert.equal((await pedir(svc, "/v1/runs/nada/tasks/T001/transcript")).status, 404);
    assert.equal((await pedir(svc, "/v1/runs/9/tasks/T999/transcript")).status, 404);
    const vacio = await (await pedir(svc, "/v1/runs/9/tasks/T0011/transcript")).json();
    assert.deepEqual(vacio.fases, []);
    assert.equal(vacio.total.medido, false);
  });
});

test("EL INVARIANTE: leer el transcript no escribe nada en el home (principio VIII)", async () => {
  await conServicio({ motor: { intervaloMs: 0 } }, async (svc) => {
    runDeEjemplo(svc.home);
    await transcriptsDeEjemplo(svc.home);
    const antes = huellaDelArbol(svc.home);
    for (let i = 0; i < 2; i++) assert.equal((await pedir(svc, "/v1/runs/9/tasks/T001/transcript")).status, 200);
    assert.deepEqual(diferencias(antes, huellaDelArbol(svc.home)), [], "una lectura de transcript escribio en el home");
  });
});

test("SC-002: cuando el transcript crece, `run.transcript` llega por el canal en menos de 3 s", async () => {
  await conServicio({ motor: { intervaloMs: 0 } }, async (svc) => {
    runDeEjemplo(svc.home);
    await transcriptsDeEjemplo(svc.home);
    // Abrir el transcript arma el sondeo, como lo hace la interfaz.
    assert.equal((await pedir(svc, "/v1/runs/9/tasks/T001/transcript")).status, 200);

    const canal = await pedir(svc, "/v1/events", { headers: { accept: "text/event-stream" } });
    const escrito = Date.now();
    const green = await abrirTranscript({ home: svc.home, itemId: "9", taskId: "T001", fase: "GREEN", env: {}, secretos: [] });
    green.alEvento({ t: new Date().toISOString(), tipo: "texto", contenido: "sigo trabajando" });

    const frames = await leerFrames(canal, (f) => eventos(f).some((e) => e.tipo === "run.transcript"), 3000);
    const evento = eventos(frames).find((e) => e.tipo === "run.transcript");
    assert.ok(evento, "no llego `run.transcript` en 3 s: el detalle no se actualizaria solo");
    assert.ok(Date.now() - escrito < 3000);
    assert.deepEqual(
      { ...evento.datos.datos },
      { projectId: "p-1", itemId: "9", taskId: "T001", fase: "GREEN" },
    );
    assert.equal(evento.datos.project_id, "p-1");
  });
});

test("el sondeo no avisa de lo que ya estaba al armarse, y si de lo que crece; una lente viaja con su fase", async () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-sondeo-"));
  runDeEjemplo(home);
  await transcriptsDeEjemplo(home);
  const emitidos = [];
  const estado = { home, bus: { emitir: (tipo, datos) => emitidos.push({ tipo, datos }) } };
  const s = vigilarTranscripts(estado, { intervaloMs: 20 });
  try {
    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual(emitidos, [], "avisar de lo que ya estaba haria releer a todas las ventanas");

    const rev = await abrirTranscript({ home, itemId: "9", taskId: "T001", fase: "REVIEW", lente: "seguridad", env: {}, secretos: [] });
    rev.alEvento({ t: new Date().toISOString(), tipo: "texto", contenido: "miro el diff" });
    const plan = await abrirTranscript({ home, itemId: "9", taskId: "plan:9", fase: "PLAN", env: {}, secretos: [] });
    plan.alEvento({ t: new Date().toISOString(), tipo: "texto", contenido: "parto el ticket" });
    await new Promise((r) => setTimeout(r, 120));

    const datos = emitidos.filter((e) => e.tipo === "run.transcript").map((e) => e.datos);
    assert.deepEqual(
      datos.sort((a, b) => a.fase.localeCompare(b.fase)),
      [
        { projectId: "p-1", itemId: "9", taskId: "plan:9", fase: "PLAN" },
        { projectId: "p-1", itemId: "9", taskId: "T001", fase: "REVIEW", lente: "seguridad" },
      ],
    );
  } finally {
    s.detener();
  }
});
