// Constitution, guidelines y bootstrap sobre `packages/core`.
//
// LOS DOS INVARIANTES QUE ESTE ARCHIVO PROTEGE, Y LOS DOS VIENEN DEL CONTRATO:
//
//   1. `amend` sin los tres campos es 400. No es validacion de formulario: es
//      la constitution de este repositorio aplicada al producto — "una enmienda
//      sin un fallo detras no es una enmienda: es una preferencia". Lo que
//      exigimos de nosotros lo exige el producto.
//
//   2. `apply` con el arbol cambiado es `diff_obsoleto`. `GET /recommendations`
//      devuelve el diff EXACTO que se va a escribir y `apply` no recalcula
//      nada. Aplicar algo distinto de lo mostrado es la forma exacta en que se
//      pierde la confianza en un instalador: el operador revisa un diff,
//      aprueba, y aparece otra cosa. La siguiente vez no revisa.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { conServicio, pedir, repoDePrueba } from "./ayuda.mjs";

/** Un proyecto local ya escaneado y con el snapshot aceptado: listo para etapa 02. */
async function proyectoDescubierto(svc, nombre = "Descubierto") {
  const ruta = repoDePrueba();
  writeFileSync(
    join(ruta, "package.json"),
    JSON.stringify({ name: "x", version: "1.0.0", scripts: { test: "node --test" } }),
  );
  const proyecto = (
    await (
      await pedir(svc, "/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ origen: "local", nombre, ruta_local: ruta }),
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
  const aceptado = await pedir(svc, `/v1/snapshots/${snapshot.id}/accept`, { method: "POST" });
  assert.equal(aceptado.status, 200, await aceptado.clone().text());

  return { proyecto, ruta, snapshot };
}

test("POST /constitution/propose deriva del snapshot y marca cada apartado", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await proyectoDescubierto(svc);
    const r = await pedir(svc, `/v1/projects/${proyecto.id}/constitution/propose`, { method: "POST" });
    assert.equal(r.status, 200, await r.clone().text());
    const { propuesta } = await r.json();

    assert.ok(propuesta.apartados.length > 0);
    for (const a of propuesta.apartados) {
      assert.ok(
        ["detectado", "inferido", "vacio"].includes(a.origen),
        `el apartado \`${a.id}\` salio con origen \`${a.origen}\`: el principio X exige los tres y solo los tres`,
      );
      if (a.origen === "vacio") {
        assert.ok(a.motivo.length > 0, "un hueco sin motivo no se distingue de un detector que no miro");
      }
    }
    assert.ok(propuesta.documento.length > 0, "sin documento no hay nada que el operador pueda leer y corregir");
  });
});

test("PUT /constitution escribe en el repositorio y pasa a CONSTITUTED", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto, ruta } = await proyectoDescubierto(svc);
    const contenido = "# Constitution del proyecto\n\nTodo test antes que su implementacion.\n";

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/constitution`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contenido }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const cuerpo = await r.json();
    assert.equal(cuerpo.proyecto.estado, "CONSTITUTED");

    // FR-021: vive versionada EN EL REPOSITORIO, no solo en el almacen.
    const enDisco = readFileSync(join(ruta, cuerpo.constitution.ruta_en_repo), "utf8");
    assert.match(enDisco, /Todo test antes que su implementacion/);
  });
});

test("GET /constitution devuelve la vigente y su historial de enmiendas", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await proyectoDescubierto(svc);
    await pedir(svc, `/v1/projects/${proyecto.id}/constitution`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contenido: "# C\n\nUna regla.\n" }),
    });

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/constitution`);
    assert.equal(r.status, 200);
    const cuerpo = await r.json();
    assert.ok(cuerpo.constitution.version);
    assert.deepEqual(cuerpo.enmiendas, []);
  });
});

test("EL INVARIANTE: `amend` SIN los tres campos es 400, y el error cita la regla", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await proyectoDescubierto(svc);
    await pedir(svc, `/v1/projects/${proyecto.id}/constitution`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contenido: "# C\n\nUna regla.\n" }),
    });

    const incompletas = [
      { principio: "el test primero" },
      { principio: "el test primero", fallo_que_motiva: "paso una vez que alguien se salto el rojo entero" },
      { fallo_que_motiva: "paso una vez que alguien se salto el rojo", que_se_rompe_si_no: "vuelve a pasar igual" },
    ];

    for (const datos of incompletas) {
      const r = await pedir(svc, `/v1/projects/${proyecto.id}/constitution/amend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(datos),
      });
      assert.equal(r.status, 400, `${JSON.stringify(datos)} dio ${r.status}`);
      const { error } = await r.json();
      assert.match(
        error.causa,
        /preferencia/,
        "el 400 existe para citar la regla, no para decir 'campo requerido': un obligatorio sin explicacion se rellena con cualquier cosa",
      );
      assert.ok(error.accion.length > 20);
    }
  });
});

test("`amend` con los tres campos sube la version y archiva la anterior", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto, ruta } = await proyectoDescubierto(svc);
    const puesta = await pedir(svc, `/v1/projects/${proyecto.id}/constitution`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contenido: "# C\n\nUna regla.\n" }),
    });
    const anterior = (await puesta.json()).constitution.version;

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/constitution/amend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        principio: "el revisor no comparte runtime",
        fallo_que_motiva:
          "un revisor con el mismo runtime aprobo tres PRs con el mismo fallo de concurrencia que el implementador no vio",
        que_se_rompe_si_no:
          "la revision deja de ser una segunda opinion y pasa a ser la primera repetida, con el mismo coste",
      }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const cuerpo = await r.json();
    assert.notEqual(cuerpo.constitution.version, anterior);
    for (const escritura of cuerpo.escrituras) {
      assert.ok(readFileSync(join(ruta, escritura), "utf8").length > 0, `${escritura} no se escribio`);
    }

    const historial = await (await pedir(svc, `/v1/projects/${proyecto.id}/constitution`)).json();
    assert.equal(historial.enmiendas.length, 1);
    assert.match(historial.enmiendas[0].fallo_que_motiva, /concurrencia/);
  });
});

test("GET/PUT de una guideline por area, y un area inventada se rechaza nombrando las que hay", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await proyectoDescubierto(svc);
    await pedir(svc, `/v1/projects/${proyecto.id}/constitution`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contenido: "# C\n\nUna regla.\n" }),
    });

    const puesta = await pedir(svc, `/v1/projects/${proyecto.id}/guidelines/testing`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contenido: "Los tests corren con el runner del runtime.",
        reglas: [{ enunciado: "no hay tests sin asercion", comprobacion: { tipo: "comando", comando: "node --test" } }],
      }),
    });
    assert.equal(puesta.status, 200, await puesta.clone().text());
    assert.equal((await puesta.json()).guideline.reglas_aplicables.length, 1);

    const leida = await pedir(svc, `/v1/projects/${proyecto.id}/guidelines/testing`);
    assert.equal(leida.status, 200);
    assert.match((await leida.json()).guideline.contenido, /runner del runtime/);

    const mala = await pedir(svc, `/v1/projects/${proyecto.id}/guidelines/telepatia`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contenido: "x" }),
    });
    assert.equal(mala.status, 400);
    assert.match((await mala.json()).error.accion, /testing|frontend|backend/);
  });
});

test("FR-023: omitir el diseño no bloquea ni penaliza", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await proyectoDescubierto(svc);
    await pedir(svc, `/v1/projects/${proyecto.id}/constitution`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contenido: "# C\n\nUna regla.\n" }),
    });

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/design`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ omitir: true, motivo: "no hay interfaz en este proyecto" }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const cuerpo = await r.json();
    assert.equal(cuerpo.etapa.estado, "omitida");
    assert.equal(cuerpo.etapa.bloquea, false, "FR-023 dice que omitirla no bloquea, y `false` es el contrato");
    assert.equal(cuerpo.etapa.penalizacion, null);
  });
});

test("bootstrap: `analyze` detecta lo existente ANTES de proponer (FR-024)", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await proyectoDescubierto(svc);
    await pedir(svc, `/v1/projects/${proyecto.id}/constitution`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contenido: "# C\n\nUna regla.\n" }),
    });

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/bootstrap/analyze`, { method: "POST" });
    assert.equal(r.status, 200, await r.clone().text());
    const cuerpo = await r.json();
    assert.ok(Array.isArray(cuerpo.analisis.ya_presentes), "lo que ya existe se declara antes que lo que falta");
    assert.equal(
      typeof cuerpo.analisis.constitution_evaluada,
      "boolean",
      "sin esto, `conflicto: null` no distingue 'no habia reglas' de 'se comprobo y no hay conflicto'",
    );

    const recs = await (await pedir(svc, `/v1/projects/${proyecto.id}/recommendations`)).json();
    for (const rec of recs.items) {
      assert.ok(rec.diff.length > 0, "FR-026: el diff se calcula ANTES de proponer, y viaja con la recomendacion");
    }
  });
});

test("EL INVARIANTE: `apply` con el arbol cambiado es `diff_obsoleto` y NO escribe", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto, ruta } = await proyectoDescubierto(svc);
    await pedir(svc, `/v1/projects/${proyecto.id}/constitution`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contenido: "# C\n\nUna regla.\n" }),
    });
    await pedir(svc, `/v1/projects/${proyecto.id}/bootstrap/analyze`, { method: "POST" });
    const { items: recomendaciones } = await (await pedir(svc, `/v1/projects/${proyecto.id}/recommendations`)).json();
    assert.ok(recomendaciones.length > 0, "sin recomendaciones el test no prueba nada");

    const rec = recomendaciones[0];
    const archivo = rec.cambios[0].ruta;
    // Alguien mas —el operador, otra rama, otra ventana— escribe ahi entre que
    // el diff se calculo y alguien lo aprobo.
    const deOtro = "esto lo escribio otra persona despues de calcularse el diff\n";
    writeFileSync(join(ruta, archivo), deOtro);

    const r = await pedir(svc, `/v1/recommendations/${rec.id}/apply`, { method: "POST" });
    assert.equal(r.status, 409, await r.clone().text());
    const { error } = await r.json();
    assert.equal(error.codigo, "diff_obsoleto");
    assert.ok(error.accion.length > 20);

    assert.equal(
      readFileSync(join(ruta, archivo), "utf8"),
      deOtro,
      "escribio encima de un cambio que nadie vio: la operacion tiene que ser todo o nada",
    );
  });
});

test("`apply` sobre el arbol intacto escribe exactamente lo que el diff mostraba, e idempotente", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto, ruta } = await proyectoDescubierto(svc);
    await pedir(svc, `/v1/projects/${proyecto.id}/constitution`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contenido: "# C\n\nUna regla.\n" }),
    });
    await pedir(svc, `/v1/projects/${proyecto.id}/bootstrap/analyze`, { method: "POST" });
    const { items: recomendaciones } = await (await pedir(svc, `/v1/projects/${proyecto.id}/recommendations`)).json();
    const rec = recomendaciones[0];

    const r = await pedir(svc, `/v1/recommendations/${rec.id}/apply`, { method: "POST" });
    assert.equal(r.status, 200, await r.clone().text());
    const cuerpo = await r.json();
    assert.equal(cuerpo.recomendacion.decision, "aplicada");
    assert.equal(
      readFileSync(join(ruta, rec.cambios[0].ruta), "utf8"),
      rec.cambios[0].contenido,
      "se escribio algo distinto de lo que el operador aprobo",
    );

    const otraVez = await pedir(svc, `/v1/recommendations/${rec.id}/apply`, { method: "POST" });
    assert.equal(otraVez.status, 200, "aplicar dos veces tiene que dar el mismo estado final");
    assert.equal((await otraVez.json()).sin_cambios, true);
  });
});

test("FR-027: `skip` se registra con su motivo, que es lo que informa la evolucion", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await proyectoDescubierto(svc);
    await pedir(svc, `/v1/projects/${proyecto.id}/constitution`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contenido: "# C\n\nUna regla.\n" }),
    });
    await pedir(svc, `/v1/projects/${proyecto.id}/bootstrap/analyze`, { method: "POST" });
    const { items: recomendaciones } = await (await pedir(svc, `/v1/projects/${proyecto.id}/recommendations`)).json();

    const r = await pedir(svc, `/v1/recommendations/${recomendaciones[0].id}/skip`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ motivo: "el equipo ya tiene esto resuelto de otra forma" }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const cuerpo = await r.json();
    assert.equal(cuerpo.recomendacion.decision, "omitida");
    assert.equal(cuerpo.recomendacion.motivo_decision, "el equipo ya tiene esto resuelto de otra forma");
    assert.deepEqual(cuerpo.escrituras, [], "omitir no escribe en el arbol");
  });
});

test("una recomendacion que no esta da 404 diciendo que hay que volver a analizar", async () => {
  await conServicio({}, async (svc) => {
    const r = await pedir(svc, "/v1/recommendations/rec_inventada/apply", { method: "POST" });
    assert.equal(r.status, 404);
    const { error } = await r.json();
    assert.equal(error.codigo, "recurso_desconocido");
    assert.match(error.accion, /analyze|analisis|analiza/i);
  });
});

test("`bootstrap/complete` con todo decidido pasa a BOOTSTRAPPED", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await proyectoDescubierto(svc);
    await pedir(svc, `/v1/projects/${proyecto.id}/constitution`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contenido: "# C\n\nUna regla.\n" }),
    });
    await pedir(svc, `/v1/projects/${proyecto.id}/bootstrap/analyze`, { method: "POST" });
    const { items: recomendaciones } = await (await pedir(svc, `/v1/projects/${proyecto.id}/recommendations`)).json();

    const aMedias = await pedir(svc, `/v1/projects/${proyecto.id}/bootstrap/complete`, { method: "POST" });
    assert.equal(aMedias.status, 409, "nada se escribe sin decision, y una pendiente no se aplica sola al avanzar");

    for (const rec of recomendaciones) {
      await pedir(svc, `/v1/recommendations/${rec.id}/skip`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ motivo: "no hace falta en este proyecto" }),
      });
    }

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/bootstrap/complete`, { method: "POST" });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await r.json()).proyecto.estado, "BOOTSTRAPPED");
  });
});
