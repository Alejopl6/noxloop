// `GET /v1/projects/:id/agents/suggest` — la flota propuesta desde el servicio.
//
// LO QUE ESTA RUTA NO PUEDE HACER, Y ES LO PRIMERO QUE SE PRUEBA AQUI: no
// guarda. Devuelve una propuesta; quien la confirma es el operador, campo por
// campo si quiere, por las rutas de alta que ya existen. Una sugerencia que se
// guarda sola deja de ser una sugerencia y se convierte en configuracion que
// nadie escribio.
//
// LOS PENDIENTES VIAJAN EN LA RESPUESTA, y no es decoracion. Tres agentes con
// `modelo` y `presupuesto` vacios que no se declaran vacios se guardan creyendo
// que estan completos — y el techo de gasto que nadie puso se descubre el dia
// que no corta un run.
//
// Y EL REGISTRO DE RUNTIMES SE INYECTA. Este servicio no construye adaptadores:
// construirlos es donde se deciden el binario, los hooks y el home, cosas que
// no sabe. Sin registro inyectado la ruta NO inventa una flota vacia —que se
// leeria como "este proyecto no puede tener agentes"—: nombra la pieza que
// falta y como conseguirla.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { registroDeAdaptadores } from "../../adapters/src/index.mjs";
import { conServicio, huellaDelArbol, diferencias, pedir, repoDePrueba } from "./ayuda.mjs";

/**
 * Dos runtimes de mentira que cumplen el contrato: uno con hooks y otro sin
 * ellos, que es la forma del producto (implementador y revisor separados).
 *
 * NO SE USAN LOS ADAPTADORES DE VERDAD porque arrancarian binarios: lo que esta
 * prueba mide es el cableado de la ruta, no que `codex` este instalado.
 *
 * @param {string} id
 * @param {{hooks: boolean, cost: boolean, models?: any}} caps
 */
function adaptadorDeMentira(id, { hooks, cost, models = "desconocido" }) {
  return {
    id,
    capabilities: () => ({ resume: true, cost, effort: false, hooks, models }),
    async preflight() {
      return { ok: true };
    },
    async runPhase() {
      // Nunca se llama: esta ruta sugiere, no ejecuta. Esta aqui porque el
      // contrato la exige, y exigirla es lo que impide registrar un adaptador
      // que declara capacidades sin el comportamiento detras.
      throw new Error("un adaptador de prueba no ejecuta fases");
    },
  };
}

const DOS_RUNTIMES = () =>
  registroDeAdaptadores([
    adaptadorDeMentira("con-hooks", { hooks: true, cost: true }),
    adaptadorDeMentira("sin-hooks", { hooks: false, cost: false }),
  ]);

/** Un proyecto local escaneado y con el snapshot aceptado. */
async function proyectoDescubierto(svc) {
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
        body: JSON.stringify({ origen: "local", nombre: "Con flota", ruta_local: ruta }),
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

test("sugiere la flota desde el snapshot, y el revisor no comparte runtime (FR-034)", async () => {
  await conServicio({ adaptadores: DOS_RUNTIMES() }, async (svc) => {
    const { proyecto } = await proyectoDescubierto(svc);

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/agents/suggest`);
    assert.equal(r.status, 200, await r.clone().text());
    const { sugerencia } = await r.json();

    const impl = sugerencia.agentes.find((/** @type {any} */ a) => a.rol === "implementador");
    const rev = sugerencia.agentes.find((/** @type {any} */ a) => a.rol === "revisor");
    assert.ok(impl && rev, "no se sugirieron los dos roles obligatorios");
    assert.equal(impl.runtime, "con-hooks", "el implementador exige hooks");
    assert.notEqual(rev.runtime, impl.runtime);
    assert.equal(sugerencia.sugerida, true);
  });
});

test("la respuesta lleva los PENDIENTES declarados, no solo los agentes", async () => {
  await conServicio({ adaptadores: DOS_RUNTIMES() }, async (svc) => {
    const { proyecto } = await proyectoDescubierto(svc);
    const { sugerencia } = await (await pedir(svc, `/v1/projects/${proyecto.id}/agents/suggest`)).json();

    // La lista junta: repartida por agente obliga a abrir cada ficha para
    // descubrir que falta, y lo que no se ve se guarda vacio.
    assert.ok(Array.isArray(sugerencia.pendientes) && sugerencia.pendientes.length > 0);
    assert.ok(
      sugerencia.pendientes.some((/** @type {any} */ p) => p.campo === "presupuesto"),
      "el presupuesto no se deduce de un repositorio y la respuesta no lo declara pendiente",
    );
    for (const p of sugerencia.pendientes) {
      assert.ok(p.agente && p.rol && p.campo, "un pendiente sin decir de que agente y que campo no sirve");
      assert.ok(p.porque.length > 30, `el pendiente \`${p.campo}\` no explica por que esta vacio`);
    }

    // Y cada agente declara los suyos, para que el formulario los marque.
    for (const a of sugerencia.agentes) {
      assert.ok(a.pendientes.includes("presupuesto"));
      assert.ok(a.procedencia.presupuesto.origen === "vacio");
    }
  });
});

test("cada campo declara su origen: el operador puede juzgar por que se le propone", async () => {
  await conServicio({ adaptadores: DOS_RUNTIMES() }, async (svc) => {
    const { proyecto } = await proyectoDescubierto(svc);
    const { sugerencia } = await (await pedir(svc, `/v1/projects/${proyecto.id}/agents/suggest`)).json();

    const ORIGENES = ["detectado", "inferido", "por_defecto", "vacio"];
    for (const a of sugerencia.agentes) {
      for (const campo of ["rol", "runtime", "modelo", "skills", "tools", "mcps", "permisos", "presupuesto", "contexto"]) {
        const p = a.procedencia[campo];
        assert.ok(p, `\`${a.nombre}\` propone \`${campo}\` sin decir de donde sale`);
        assert.ok(ORIGENES.includes(p.origen), `\`${campo}\` salio con origen \`${p.origen}\``);
        if (p.origen === "detectado") {
          assert.ok(p.evidencia.length > 0, `\`${campo}\` se declara detectado sin la ruta que lo respalda`);
        }
      }
    }
  });
});

test("sugerir NO guarda: no aparece ningun agente dado de alta, ni se toca el repositorio", async () => {
  await conServicio({ adaptadores: DOS_RUNTIMES() }, async (svc) => {
    const { proyecto, ruta } = await proyectoDescubierto(svc);

    const antes = huellaDelArbol(ruta);
    await pedir(svc, `/v1/projects/${proyecto.id}/agents/suggest`);
    assert.deepEqual(diferencias(antes, huellaDelArbol(ruta)), [], "sugerir la flota toco el repositorio");

    const { items } = await (await pedir(svc, `/v1/projects/${proyecto.id}/agents`)).json();
    assert.deepEqual(items, [], "la sugerencia se guardo sola: eso ya no es una propuesta");
  });
});

test("los agentes YA guardados entran como `existentes`: FR-034 se mide contra ellos", async () => {
  // El caso normal: el operador dio de alta el implementador ayer y hoy pide
  // que le sugieran el resto. Una sugerencia que solo mira lo que ella propone
  // coloca al revisor encima del runtime del implementador guardado, y el
  // propio servicio la rechaza al guardarla.
  await conServicio({ adaptadores: DOS_RUNTIMES() }, async (svc) => {
    const { proyecto } = await proyectoDescubierto(svc);

    const alta = await pedir(svc, `/v1/projects/${proyecto.id}/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nombre: "El mio", rol: "implementador", runtime: "con-hooks", modelo: "m" }),
    });
    assert.equal(alta.status, 201, await alta.clone().text());

    const { sugerencia } = await (await pedir(svc, `/v1/projects/${proyecto.id}/agents/suggest`)).json();

    assert.equal(
      sugerencia.agentes.some((/** @type {any} */ a) => a.rol === "implementador"),
      false,
      "se propuso un segundo implementador sobre uno que ya estaba dado de alta",
    );
    const dicho = sugerencia.no_sugeridos.find((/** @type {any} */ n) => n.rol === "implementador");
    assert.match(dicho.porque, /El mio/);

    const rev = sugerencia.agentes.find((/** @type {any} */ a) => a.rol === "revisor");
    assert.ok(rev, "no se sugirio el revisor que falta");
    assert.notEqual(rev.runtime, "con-hooks", "el revisor sugerido choca con el implementador ya guardado");

    // Y lo sugerido se puede guardar de verdad por la ruta de alta que ya hay.
    const guardado = await pedir(svc, `/v1/projects/${proyecto.id}/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nombre: rev.nombre, rol: rev.rol, runtime: rev.runtime, modelo: "elegido-por-el-operador" }),
    });
    assert.equal(guardado.status, 201, await guardado.clone().text());
  });
});

test("sin registro de runtimes la ruta nombra la pieza que falta en vez de inventar una flota vacia", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await proyectoDescubierto(svc);

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/agents/suggest`);
    assert.equal(r.status, 503, await r.clone().text());
    const { error } = await r.json();
    assert.equal(error.codigo, "pieza_ausente");
    // Una sugerencia vacia se leeria como «este proyecto no puede tener
    // agentes», que es una conclusion que nadie saco.
    assert.ok(error.causa.length > 60);
    assert.ok(error.accion.length > 20);
  });
});

test("sin snapshot completo no se sugiere: se dice, en vez de sacar los campos del catalogo", async () => {
  await conServicio({ adaptadores: DOS_RUNTIMES() }, async (svc) => {
    const ruta = repoDePrueba();
    const proyecto = (
      await (
        await pedir(svc, "/v1/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ origen: "local", nombre: "Sin escanear", ruta_local: ruta }),
        })
      ).json()
    ).proyecto;

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/agents/suggest`);
    assert.equal(r.status, 404, await r.clone().text());
    assert.match((await r.json()).error.accion, /scan/);
  });
});

test("`/v1/capabilities` deja de decir que no hay runtimes cuando si los hay", async () => {
  // LA INCOHERENCIA QUE ESTO CIERRA. Mientras `/agents/suggest` propone agentes
  // sobre dos runtimes, `/v1/capabilities` seguia declarando `runtimes: []` con
  // el motivo "este servicio todavia no ejecuta ningun runtime de agente". Un
  // operador que lee las capacidades para saber que hay monta su flota sobre
  // una respuesta falsa — y una declaracion de capacidades en la que no se
  // puede confiar no vale mas que no tenerla.
  await conServicio({ adaptadores: DOS_RUNTIMES() }, async (svc) => {
    const caps = await (await pedir(svc, "/v1/capabilities")).json();

    assert.equal(caps.runtimes.origen, "detectado");
    assert.deepEqual([...caps.runtimes.valor].sort(), ["con-hooks", "sin-hooks"]);
    // Un `detectado` sin lo que lo respalda es una opinion, tambien aqui.
    assert.ok(caps.runtimes.evidencia, "se declara detectado sin evidencia");
  });
});

test("sin registro inyectado, `/v1/capabilities` sigue declarando el hueco con su motivo", async () => {
  await conServicio({}, async (svc) => {
    const caps = await (await pedir(svc, "/v1/capabilities")).json();
    assert.deepEqual(caps.runtimes.valor, []);
    assert.equal(caps.runtimes.origen, "vacio");
    assert.ok(caps.runtimes.motivo.length > 20);
  });
});
