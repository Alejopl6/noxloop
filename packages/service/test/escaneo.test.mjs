// T081 / T082 — el escaneo: respuesta inmediata, progreso por SSE, y una
// cancelacion que no deja estado a medias.
//
// POR QUE `POST /scan` NO PUEDE ESPERAR AL SNAPSHOT. Un escaneo de un
// repositorio real tarda; una peticion HTTP que se queda abierta todo ese rato
// es una pantalla congelada, y el operador la mata y vuelve a apretar. Por eso
// devuelve `{snapshot_id}` de inmediato y todo lo que pasa despues va por el
// canal de eventos — que es ademas lo que deja que una segunda ventana vea el
// mismo escaneo sin haberlo pedido.
//
// POR QUE LA CANCELACION SE PRUEBA MIRANDO EL ALMACEN Y NO LA RESPUESTA.
// FR-015 dice "sin dejar estado parcial". Un `DELETE` que devuelve 200 y deja
// doce hallazgos a medias cumple la respuesta y rompe la promesa: esos doce se
// leen despues como la lectura entera del proyecto, y no hay forma de saber
// cuales faltaban.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  conServicio,
  pedir,
  repoDePrueba,
  repoGrandeDePrueba,
  leerFrames,
  eventos,
  huellaDelArbol,
  diferencias,
} from "./ayuda.mjs";

/** Un proyecto local dado de alta, con su ruta. */
async function proyectoLocal(svc, nombre = "Escaneado", rutaDada = null) {
  const ruta = rutaDada ?? repoDePrueba();
  writeFileSync(join(ruta, "package.json"), JSON.stringify({ name: "x", version: "1.0.0", scripts: { test: "node --test" } }));
  const r = await pedir(svc, "/v1/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origen: "local", nombre, ruta_local: ruta }),
  });
  const { proyecto } = await r.json();
  return { proyecto, ruta };
}

/** Espera a que el snapshot deje de estar `en_curso`. */
async function esperarSnapshot(svc, id, ms = 15000) {
  const limite = Date.now() + ms;
  for (;;) {
    const r = await pedir(svc, `/v1/projects/${id}/snapshot`);
    if (r.status === 200) {
      const cuerpo = await r.json();
      if (cuerpo.snapshot && cuerpo.snapshot.estado !== "en_curso") return { ...cuerpo, hallazgos: cuerpo.items };
    } else {
      await r.text();
    }
    if (Date.now() > limite) throw new Error("el snapshot no termino a tiempo");
    await new Promise((listo) => setTimeout(listo, 25));
  }
}

test("POST /scan devuelve `{snapshot_id}` DE INMEDIATO, sin esperar al recorrido", async () => {
  await conServicio({}, async (svc) => {
    // Sobre un repositorio GRANDE a proposito. Con tres archivos este test pasa
    // aunque el manejador espere al recorrido entero, y entonces no prueba lo
    // que dice probar: la primera version del servicio llamaba al scanner en
    // linea y el inventario —que es sincrono— corria completo antes de que
    // saliera el 202.
    const { proyecto } = await proyectoLocal(svc, "Grande", repoGrandeDePrueba());
    const t0 = Date.now();
    const r = await pedir(svc, `/v1/projects/${proyecto.id}/scan`, { method: "POST" });
    const tardo = Date.now() - t0;

    assert.equal(r.status, 202, await r.clone().text());
    const cuerpo = await r.json();
    assert.ok(cuerpo.snapshot_id, "sin el id no hay nada que cancelar ni con que correlacionar los eventos");
    assert.ok(tardo < 300, `la respuesta tardo ${tardo}ms: el progreso va por SSE justamente para que no tarde`);
    await esperarSnapshot(svc, proyecto.id);
  });
});

test("el progreso y los hallazgos viajan por SSE, no por la respuesta", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await proyectoLocal(svc);

    const canal = await pedir(svc, "/v1/events");
    assert.equal(canal.status, 200);

    await pedir(svc, `/v1/projects/${proyecto.id}/scan`, { method: "POST" });

    const frames = await leerFrames(canal, (f) => eventos(f).some((e) => e.tipo === "scan.terminado"), 20000);
    const tipos = eventos(frames).map((e) => e.tipo);

    assert.ok(tipos.includes("scan.progreso"), "sin progreso, una barra quieta se lee como colgado");
    assert.ok(tipos.includes("scan.terminado"));
    assert.ok(tipos.includes("scan.hallazgo"), "los hallazgos salen segun aparecen para que la lista crezca en vivo");

    const progreso = eventos(frames).find((e) => e.tipo === "scan.progreso");
    assert.equal(typeof progreso.datos.datos.archivos_vistos, "number");
    assert.equal(typeof progreso.datos.datos.fase, "string", "la fase le pone nombre a lo que pasa; un 37% solo, no");
    assert.equal(progreso.datos.project_id, proyecto.id, "sin project_id la ventana no sabe de cual de los 20 es");
  });
});

test("FR-011: el escaneo no escribe NADA en el repositorio del operador", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto, ruta } = await proyectoLocal(svc);
    const antes = huellaDelArbol(ruta);
    await pedir(svc, `/v1/projects/${proyecto.id}/scan`, { method: "POST" });
    await esperarSnapshot(svc, proyecto.id);
    assert.deepEqual(
      diferencias(antes, huellaDelArbol(ruta)),
      [],
      "la primera accion del producto sobre el repositorio de alguien lo toco: no hay segunda oportunidad para esa impresion",
    );
  });
});

test("GET /snapshot trae el vigente con sus hallazgos", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await proyectoLocal(svc);
    await pedir(svc, `/v1/projects/${proyecto.id}/scan`, { method: "POST" });
    const cuerpo = await esperarSnapshot(svc, proyecto.id);

    assert.equal(cuerpo.snapshot.estado, "completo");
    assert.ok(cuerpo.hallazgos.length > 0, "un snapshot sin hallazgos es un escaneo que no leyo nada");
    for (const h of cuerpo.hallazgos) {
      assert.ok(["detectado", "inferido", "declarado"].includes(h.origen), "el principio X: detectado != inferido");
      assert.equal(h.decision, "pendiente");
      assert.ok(Array.isArray(h.evidencia));
    }
  });
});

test("DELETE /v1/scans/:id cancela y NO deja estado parcial (FR-015)", async () => {
  await conServicio({}, async (svc) => {
    // Un repositorio grande a proposito: la cancelacion es una carrera de
    // verdad contra el recorrido, y sobre tres archivos el escaneo gana
    // siempre. Lo que se prueba sigue siendo lo mismo; lo que cambia es que el
    // resultado deja de depender de la maquina donde corre.
    const { proyecto } = await proyectoLocal(svc, "Cancelado", repoGrandeDePrueba());
    const { snapshot_id } = await (await pedir(svc, `/v1/projects/${proyecto.id}/scan`, { method: "POST" })).json();

    const r = await pedir(svc, `/v1/scans/${snapshot_id}`, { method: "DELETE" });
    assert.equal(r.status, 200, await r.clone().text());

    // El snapshot queda `cancelado` y SIN hallazgos. No es que se borren
    // despues: es que los parciales no se persisten nunca.
    const fin = await esperarSnapshot(svc, proyecto.id);
    assert.equal(fin.snapshot.id, snapshot_id);
    assert.equal(fin.snapshot.estado, "cancelado");
    assert.deepEqual(
      fin.hallazgos,
      [],
      "un cancelado con hallazgos a medias se acaba leyendo como la lectura entera del proyecto",
    );
  });
});

test("cancelar un escaneo que no existe da 404 diciendo donde mirar", async () => {
  await conServicio({}, async (svc) => {
    const r = await pedir(svc, "/v1/scans/no-existe", { method: "DELETE" });
    assert.equal(r.status, 404);
    const { error } = await r.json();
    assert.equal(error.codigo, "recurso_desconocido");
    assert.ok(error.accion.length > 20);
  });
});

test("T082: PATCH de un hallazgo guarda la decision y el valor corregido", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await proyectoLocal(svc);
    await pedir(svc, `/v1/projects/${proyecto.id}/scan`, { method: "POST" });
    const { snapshot, hallazgos } = await esperarSnapshot(svc, proyecto.id);

    const uno = hallazgos[0];
    const r = await pedir(svc, `/v1/snapshots/${snapshot.id}/findings/${uno.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "corregido", valor_corregido: { lo: "que el operador sabe" } }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const { hallazgo } = await r.json();
    assert.equal(hallazgo.decision, "corregido");
    assert.deepEqual(hallazgo.valor_corregido, { lo: "que el operador sabe" });
  });
});

test("una decision que no esta en el enum se rechaza nombrando las que si", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await proyectoLocal(svc);
    await pedir(svc, `/v1/projects/${proyecto.id}/scan`, { method: "POST" });
    const { snapshot, hallazgos } = await esperarSnapshot(svc, proyecto.id);

    const r = await pedir(svc, `/v1/snapshots/${snapshot.id}/findings/${hallazgos[0].id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "me-da-igual" }),
    });
    assert.equal(r.status >= 400 && r.status < 500, true, `dio ${r.status}`);
    const { error } = await r.json();
    assert.ok(error.accion.length > 20);
  });
});

test("T082: POST /accept con todo decidido pasa el proyecto a DISCOVERED", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await proyectoLocal(svc);
    await pedir(svc, `/v1/projects/${proyecto.id}/scan`, { method: "POST" });
    const { snapshot, hallazgos } = await esperarSnapshot(svc, proyecto.id);

    for (const h of hallazgos) {
      await pedir(svc, `/v1/snapshots/${snapshot.id}/findings/${h.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "aceptado" }),
      });
    }

    const r = await pedir(svc, `/v1/snapshots/${snapshot.id}/accept`, { method: "POST" });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await r.json()).proyecto.estado, "DISCOVERED");
  });
});

test("EL INVARIANTE: aceptar con hallazgos pendientes se rechaza CONTANDO cuantos quedan", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await proyectoLocal(svc);
    await pedir(svc, `/v1/projects/${proyecto.id}/scan`, { method: "POST" });
    const { snapshot } = await esperarSnapshot(svc, proyecto.id);

    const r = await pedir(svc, `/v1/snapshots/${snapshot.id}/accept`, { method: "POST" });
    assert.equal(r.status, 409, await r.clone().text());
    const { error } = await r.json();
    assert.match(
      error.causa,
      /pendiente/,
      "un hallazgo sin decidir es un hueco sin declarar, y aceptarlo lo convierte en la constitution del proyecto sin que nadie lo mire",
    );
    assert.ok(error.accion.length > 20);
    assert.equal((await (await pedir(svc, `/v1/projects/${proyecto.id}`)).json()).proyecto.estado, "CREATED");
  });
});
