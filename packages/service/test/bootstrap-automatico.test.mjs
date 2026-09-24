// El bootstrap se dispara solo al fijar la constitution, y deja UNA propuesta
// lista para aprobar de una vez.
//
// QUE SIGNIFICA «AUTOMATICO» AQUI, Y QUE NO. Lo que desaparece es el trabajo de
// pedir el analisis y de decidir recomendacion por recomendacion. Lo que NO
// desaparece es la puerta humana: nada se escribe en el repositorio del
// operador sin una aprobacion explicita con el diff exacto delante (FR-026).
// Este archivo prueba las dos mitades — que llega solo, y que no escribe hasta
// que alguien dice que si.
//
// LAS DOS COSAS QUE SE PIERDEN AL AGRUPAR SI NADIE MIRA: la recomendacion que
// contradice la constitution (FR-028), que es justo la que existe para ser
// mirada, y `diff_obsoleto`, que con un lote se convierte en medio lote
// aplicado si se comprueba mientras se escribe.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { conServicio, diferencias, huellaDelArbol, pedir, repoDePrueba } from "./ayuda.mjs";

/** Un proyecto local escaneado y con el snapshot aceptado: listo para etapa 02. */
async function proyectoDescubierto(svc, yaTiene = {}) {
  const ruta = repoDePrueba();
  writeFileSync(
    join(ruta, "package.json"),
    JSON.stringify({ name: "x", version: "1.0.0", scripts: { test: "node --test" } }),
  );
  // Un par de cosas que el proyecto YA tiene. Sin ellas, «ya_presentes» sale
  // vacio y la prueba de FR-024 —detectar antes de proponer— no prueba nada.
  writeFileSync(join(ruta, "LICENSE"), "MIT\n");
  writeFileSync(join(ruta, ".editorconfig"), "root = true\n");
  // Lo que ESTE proyecto ya trae escrito. El bootstrap no puede volver a
  // proponerlo (FR-024): proponerle a alguien lo que ya hizo le enseña en un
  // segundo que la herramienta no miro su repositorio.
  for (const [nombre, contenido] of Object.entries(yaTiene)) writeFileSync(join(ruta, nombre), contenido);
  const proyecto = (
    await (
      await pedir(svc, "/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ origen: "local", nombre: "Automatico", ruta_local: ruta }),
      })
    ).json()
  ).proyecto;

  await pedir(svc, `/v1/projects/${proyecto.id}/scan`, { method: "POST" });
  let snapshot = null;
  let hallazgos = [];
  for (let i = 0; i < 600; i++) {
    const r = await pedir(svc, `/v1/projects/${proyecto.id}/snapshot`);
    if (r.status === 200) {
      const c = await r.json();
      if (c.snapshot && c.snapshot.estado !== "en_curso") {
        snapshot = c.snapshot;
        hallazgos = c.items;
        break;
      }
    } else {
      await r.text();
    }
    await new Promise((listo) => setTimeout(listo, 25));
  }
  assert.ok(snapshot, "el snapshot no termino y el resto del test no valdria nada");

  for (const h of hallazgos) {
    await pedir(svc, `/v1/snapshots/${snapshot.id}/findings/${h.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "aceptado" }),
    });
  }
  await pedir(svc, `/v1/snapshots/${snapshot.id}/accept`, { method: "POST" });
  return { proyecto, ruta };
}

/** @param {any} svc @param {string} id @param {any} [extra] */
async function fijarConstitution(svc, id, extra = {}) {
  const r = await pedir(svc, `/v1/projects/${id}/constitution`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ markdown: "# C\n\nUna regla.\n", ...extra }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  return r.json();
}

test("fijar la constitution dispara el analisis: la propuesta viene en la MISMA respuesta", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await proyectoDescubierto(svc);
    const cuerpo = await fijarConstitution(svc, proyecto.id);

    // Es la diferencia entera: antes habia que pedir `analyze` a mano.
    assert.ok(cuerpo.propuesta, "fijar la constitution no dejo propuesta de bootstrap");
    assert.equal(cuerpo.propuesta.project_id, proyecto.id);
    assert.ok(cuerpo.propuesta.lote.recomendaciones.length > 0, "la propuesta llego sin nada que aprobar");
    // Y con el diff ya calculado: aprobar en bloque sin el es fe.
    assert.ok(cuerpo.propuesta.lote.diff.length > 0);
    assert.equal(typeof cuerpo.propuesta.decisiones, "number");
  });
});

test("el analisis automatico NO escribe nada en el repositorio del operador (FR-026)", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto, ruta } = await proyectoDescubierto(svc);

    const antes = huellaDelArbol(ruta);
    const cuerpo = await fijarConstitution(svc, proyecto.id);
    const despues = huellaDelArbol(ruta);

    // Lo unico que puede haber cambiado es la constitution, que es lo que el
    // `PUT` venia a escribir y el operador pidio explicitamente.
    const tocado = diferencias(antes, despues).filter(
      (/** @type {string} */ d) => !d.includes(cuerpo.constitution.ruta_en_repo),
    );
    assert.deepEqual(tocado, [], `el analisis automatico toco el arbol:\n${tocado.join("\n")}`);

    // Y las rutas que la propuesta dice que va a crear siguen sin existir.
    for (const r of cuerpo.propuesta.lote.rutas) {
      assert.equal(existsSync(join(ruta, r)), false, `\`${r}\` se escribio sin que nadie lo aprobara`);
    }
  });
});

test("una sola aprobacion escribe el lote entero y registra cada decision", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto, ruta } = await proyectoDescubierto(svc);
    const { propuesta } = await fijarConstitution(svc, proyecto.id);
    const ids = propuesta.lote.recomendaciones.map((/** @type {any} */ r) => r.id);

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/bootstrap/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recomendaciones: ids, motivo: "el bloque aditivo entero" }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const salida = await r.json();

    assert.equal(salida.aplicadas.length, ids.length);
    for (const ruta_escrita of salida.escrituras) {
      assert.ok(existsSync(join(ruta, ruta_escrita)), `\`${ruta_escrita}\` no llego al disco`);
    }

    // Las recomendaciones quedan decididas: FR-027 no se relaja por agrupar.
    const lista = await (await pedir(svc, `/v1/projects/${proyecto.id}/recommendations`)).json();
    for (const id of ids) {
      const guardada = lista.items.find((/** @type {any} */ x) => x.id === id);
      assert.equal(guardada.decision, "aplicada", `\`${id}\` se escribio sin quedar registrada`);
    }
  });
});

test("aprobar el bloque EXIGE los ids que se mostraron: no hay «aplica lo que haya»", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await proyectoDescubierto(svc);
    await fijarConstitution(svc, proyecto.id);

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/bootstrap/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ motivo: "todo" }),
    });
    assert.equal(r.status, 400, await r.clone().text());
    const { error } = await r.json();
    // La causa tiene que explicar POR QUE, no decir «campo requerido»: lo que
    // se aplica es lo que el operador vio, y sin ids no se sabe que vio.
    assert.ok(error.causa.length > 60);
    assert.ok(error.accion.length > 20);
  });
});

test("una recomendacion con conflicto de constitution no se puede colar en el bloque (FR-028)", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await proyectoDescubierto(svc);
    // Un invariante que prohibe crear el archivo que el bootstrap va a proponer.
    const { propuesta } = await fijarConstitution(svc, proyecto.id, {
      invariantes: [
        {
          id: "los_documentos_los_escribe_una_persona",
          enunciado: "Ningun documento del repositorio lo genera una herramienta",
          prohibe: { efecto: "crear_archivo", rutas: ["AGENTS.md", "CONTRIBUTING.md"] },
        },
      ],
    });

    const conflictivas = propuesta.aparte.filter(
      (/** @type {any} */ a) => a.motivo === "conflicto_constitution",
    );
    assert.ok(conflictivas.length > 0, "el invariante no aparto ninguna recomendacion, y el test no prueba nada");
    for (const a of conflictivas) {
      assert.ok(a.conflicto_constitution, "se aparto sin decir cual es el conflicto");
      assert.equal(
        propuesta.lote.recomendaciones.some((/** @type {any} */ r) => r.id === a.recomendacion.id),
        false,
        "la recomendacion conflictiva esta en el lote Y apartada a la vez",
      );
    }

    // Y mandarla a mano dentro del bloque tampoco vale: la guarda no vive solo
    // en quien arma la propuesta.
    const r = await pedir(svc, `/v1/projects/${proyecto.id}/bootstrap/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recomendaciones: [
          ...propuesta.lote.recomendaciones.map((/** @type {any} */ x) => x.id),
          conflictivas[0].recomendacion.id,
        ],
      }),
    });
    assert.equal(r.status, 409, await r.clone().text());
    assert.equal((await r.json()).error.codigo, "recomendacion_fuera_del_lote");
  });
});

test("si el arbol cambio bajo una del bloque, no se escribe ninguna", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto, ruta } = await proyectoDescubierto(svc);
    const { propuesta } = await fijarConstitution(svc, proyecto.id);
    const ids = propuesta.lote.recomendaciones.map((/** @type {any} */ r) => r.id);
    assert.ok(ids.length > 0);

    // El operador tiene el editor abierto. Es el caso normal, no el raro.
    const primera = propuesta.lote.rutas[0];
    writeFileSync(join(ruta, primera), "# esto lo escribi yo mientras revisaba\n");

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/bootstrap/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recomendaciones: ids }),
    });
    assert.equal(r.status, 409, await r.clone().text());
    assert.equal((await r.json()).error.codigo, "diff_obsoleto");

    // Lo que importa: el archivo del operador sigue siendo el suyo, y las otras
    // rutas del bloque tampoco se escribieron.
    assert.match(readFileSync(join(ruta, primera), "utf8"), /lo escribi yo/);
    for (const otra of propuesta.lote.rutas.slice(1)) {
      assert.equal(existsSync(join(ruta, otra)), false, `\`${otra}\` se escribio a pesar del diff obsoleto`);
    }
  });
});

test("`GET /bootstrap/proposal` devuelve la propuesta completa sin pedir el analisis a mano", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await proyectoDescubierto(svc, {
      "CONTRIBUTING.md": "# Como contribuir\n\nEsto lo escribio el equipo.\n",
    });
    await fijarConstitution(svc, proyecto.id);

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/bootstrap/proposal`);
    assert.equal(r.status, 200, await r.clone().text());
    const { propuesta } = await r.json();

    assert.ok(Array.isArray(propuesta.ya_presentes));
    assert.ok(Array.isArray(propuesta.preguntas));
    // Agrupar no es esconder: lo que ya estaba en el proyecto sigue visible, y
    // es lo que demuestra que el bootstrap miro antes de proponer (FR-024).
    assert.ok(
      propuesta.ya_presentes.some((/** @type {any} */ y) => y.capacidad === "guia_de_contribucion"),
      "el proyecto ya trae su guia de contribucion y el bootstrap no la declaro como presente",
    );
    assert.equal(
      propuesta.lote.rutas.includes("CONTRIBUTING.md"),
      false,
      "se propuso escribir la guia de contribucion que el equipo ya tenia escrita",
    );
  });
});
