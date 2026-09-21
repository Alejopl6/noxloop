// `GET /v1/options` — el catalogo de lo que se puede elegir.
//
// EL FALLO CONCRETO. La interfaz pide «area», «rol», «tipo de credencial»,
// «ambito», «runtime» y «nivel de autonomia» con campos de texto libre o con
// listas escritas a mano en el cliente. Las dos formas fallan, y de forma
// distinta:
//
//   - El texto libre traslada al operador el trabajo de saberse un enum que
//     este servicio ya tiene en `packages/store/src/esquema.mjs`. Escribir
//     `api-token` en vez de `api_token` es un 400 que nadie previo.
//   - La lista escrita en el cliente es la interfaz decidiendo producto. Hoy
//     `AREAS_DE_GUIDELINE` esta duplicada en `apps/studio/lib/tipos.ts` y en el
//     `CHECK` de la tabla `guideline`: el dia que el enum crezca, la pantalla
//     sigue ofreciendo siete areas y la octava no existe para el operador.
//
// LA GUARDA QUE LO SOSTIENE es el primer test: los valores de cada grupo se
// comparan CON `ENUMS`, no con una copia. Una etiqueta de mas o de menos falla
// aqui en vez de aparecer como un desplegable incompleto.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { ENUMS } from "../../store/src/index.mjs";
import { registroDeAdaptadores } from "../../adapters/src/index.mjs";

import { conServicio, pedir, repoDePrueba } from "./ayuda.mjs";

/**
 * Un runtime de mentira que cumple el contrato. No se usan los adaptadores de
 * verdad porque arrancarian binarios: lo que se mide aqui es que el catalogo
 * lea el registro, no que `codex` este instalado.
 *
 * @param {string} id
 * @param {{hooks: boolean, models?: any}} caps
 */
function adaptadorDeMentira(id, { hooks, models = "desconocido" }) {
  return {
    id,
    capabilities: () => ({ resume: true, cost: false, effort: false, hooks, models }),
    async preflight() {
      return { ok: true };
    },
    async runPhase() {
      throw new Error("un adaptador de prueba no ejecuta fases");
    },
  };
}

const opciones = async (svc, consulta = "") => (await pedir(svc, `/v1/options${consulta}`)).json();

/** Los grupos que salen tal cual de un enum del almacen, y de cual. */
const DEL_ALMACEN = {
  "project.origen": "project.origen",
  "project.autonomia": "project.autonomia",
  "guideline.area": "guideline.area",
  "credential.tipo": "credential.tipo",
  "credential.ambito": "credential.ambito",
  "agent.rol": "agent.rol",
  "connection.clase": "connection.clase",
};

test("EL INVARIANTE: los valores de cada grupo son los del almacen, no una copia", async () => {
  await conServicio({}, async (svc) => {
    const cuerpo = await opciones(svc);
    for (const [grupo, enumDelAlmacen] of Object.entries(DEL_ALMACEN)) {
      assert.ok(cuerpo.grupos[grupo], `el catalogo no publica \`${grupo}\``);
      // Se comparan los CONJUNTOS y no las listas: el orden lo decide la
      // pantalla —los roles se enseñan en el orden del ciclo, no en el del
      // enum— y lo que no puede diferir es QUE valores hay.
      assert.deepEqual(
        cuerpo.grupos[grupo].opciones.map((/** @type {any} */ o) => o.valor).sort(),
        [...ENUMS[enumDelAlmacen]].sort(),
        `\`${grupo}\` se separo de \`ENUMS["${enumDelAlmacen}"]\`: la pantalla ofreceria valores que la base ` +
          "rechaza con un CHECK, o se callaria uno que existe",
      );
    }
  });
});

test("ninguna opcion viaja sin etiqueta: un enum crudo no es una opcion", async () => {
  await conServicio({}, async (svc) => {
    const cuerpo = await opciones(svc);
    const mudas = [];
    for (const [grupo, datos] of Object.entries(cuerpo.grupos)) {
      for (const opcion of /** @type {any} */ (datos).opciones) {
        if (typeof opcion.etiqueta !== "string" || opcion.etiqueta.trim().length === 0) {
          mudas.push(`${grupo}.${opcion.valor}`);
        }
      }
    }
    assert.deepEqual(
      mudas,
      [],
      `hay valores sin etiqueta: el operador leeria el identificador crudo (${mudas.join(", ")})`,
    );
  });
});

test("ningun grupo se declara sin origen, y el vacio dice por que lo esta", async () => {
  await conServicio({}, async (svc) => {
    const cuerpo = await opciones(svc);
    for (const [grupo, datos] of Object.entries(cuerpo.grupos)) {
      const d = /** @type {any} */ (datos);
      assert.ok(
        ["declarado", "detectado", "por_defecto", "vacio"].includes(d.origen),
        `\`${grupo}\` declara el origen \`${d.origen}\`, que no es del vocabulario del snapshot`,
      );
      if (d.origen === "vacio") {
        assert.ok(d.porque && d.porque.length > 20, `\`${grupo}\` declara el hueco sin decir por que`);
        assert.deepEqual(d.opciones, [], "un grupo vacio con opciones dentro es un vacio que no lo esta");
      }
    }
  });
});

test("los runtimes salen del registro inyectado y traen su evidencia", async () => {
  const adaptadores = registroDeAdaptadores([adaptadorDeMentira("con-hooks", { hooks: true })]);
  await conServicio({ adaptadores }, async (svc) => {
    const cuerpo = await opciones(svc);
    const runtimes = cuerpo.grupos["agent.runtime"];
    assert.equal(runtimes.origen, "detectado");
    assert.deepEqual(
      runtimes.opciones.map((/** @type {any} */ o) => o.valor),
      adaptadores.ids(),
    );
    assert.ok(runtimes.evidencia, "un `detectado` sin evidencia es lo que el principio X prohibe");
  });
});

test("sin registro de runtimes el grupo se declara vacio con su motivo, no como lista muda", async () => {
  await conServicio({}, async (svc) => {
    const cuerpo = await opciones(svc);
    const runtimes = cuerpo.grupos["agent.runtime"];
    assert.equal(runtimes.origen, "vacio");
    assert.deepEqual(runtimes.opciones, []);
    assert.ok(
      runtimes.porque.includes("adaptadores"),
      "una lista vacia sin motivo se lee como «se miro y no hay ninguno», cuando lo que pasa es que nadie " +
        "inyecto el registro",
    );
    assert.ok(runtimes.como_conseguirlo, "un hueco sin salida deja al operador sin nada que hacer");
  });
});

test("cada runtime dice lo que puede y lo que no: sin hooks no es elegible como implementador", async () => {
  const adaptadores = registroDeAdaptadores([
    adaptadorDeMentira("con-hooks", { hooks: true }),
    adaptadorDeMentira("sin-hooks", { hooks: false }),
  ]);
  await conServicio({ adaptadores }, async (svc) => {
    const cuerpo = await opciones(svc);
    const porValor = new Map(
      cuerpo.grupos["agent.runtime"].opciones.map((/** @type {any} */ o) => [o.valor, o]),
    );
    assert.equal(porValor.get("con-hooks").capacidades.hooks, true);
    assert.equal(porValor.get("sin-hooks").capacidades.hooks, false);
    assert.ok(
      porValor.get("sin-hooks").nota.includes("implementador"),
      "elegir un runtime sin hooks para implementar se rechaza al guardar: decirlo despues cuesta el viaje",
    );
  });
});

test("un grupo con una sola opcion lo declara: un select de uno no es un select", async () => {
  const adaptadores = registroDeAdaptadores([adaptadorDeMentira("el-unico", { hooks: true })]);
  await conServicio({ adaptadores }, async (svc) => {
    const cuerpo = await opciones(svc);
    assert.equal(cuerpo.grupos["agent.runtime"].unica, true);
    assert.equal(cuerpo.grupos["guideline.area"].unica, false);
  });
});

test("sin proyecto no se preselecciona nada: no hay de donde sacarlo", async () => {
  await conServicio({}, async (svc) => {
    const cuerpo = await opciones(svc);
    assert.equal(cuerpo.proyecto, null);
    for (const [grupo, datos] of Object.entries(cuerpo.grupos)) {
      const pre = /** @type {any} */ (datos).preseleccion;
      if (!pre) continue;
      assert.notEqual(
        pre.origen,
        "detectado",
        `\`${grupo}\` dice haber detectado una preseleccion sin ningun proyecto delante`,
      );
    }
  });
});

/**
 * Un proyecto local ESCANEADO DE VERDAD.
 *
 * POR QUE HACE FALTA ESCANEAR Y NO BASTA CON DAR DE ALTA. Porque la
 * preseleccion de area sale de una CONSULTA contra `snapshot_finding`, y una
 * consulta contra una tabla vacia pasa igual que una bien escrita. Este helper
 * existe porque la primera version de este archivo no lo tenia: la ruta
 * consultaba una columna `motivo` que esa tabla NO tiene —el hueco de un
 * hallazgo se codifica en su `valor`, no en una columna aparte— y el 500 salio
 * al pegarle con curl a un proyecto escaneado, no aqui.
 *
 * @param {any} svc
 */
async function proyectoEscaneado(svc) {
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
        body: JSON.stringify({ origen: "local", nombre: "Con Snapshot", ruta_local: ruta }),
      })
    ).json()
  ).proyecto;

  await pedir(svc, `/v1/projects/${proyecto.id}/scan`, { method: "POST" });
  for (let i = 0; i < 600; i++) {
    const r = await pedir(svc, `/v1/projects/${proyecto.id}/snapshot`);
    if (r.status === 200) {
      const c = await r.json();
      if (c.snapshot && c.snapshot.estado === "completo") return proyecto;
    } else {
      await r.text();
    }
    await new Promise((listo) => setTimeout(listo, 25));
  }
  throw new Error("el snapshot no termino y la preseleccion no tendria de donde salir");
}

test("con un proyecto, la autonomia preseleccionada es la SUYA y lo dice", async () => {
  await conServicio({}, async (svc) => {
    const alta = await (
      await pedir(svc, "/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origen: "local",
          nombre: "Con Autonomia",
          ruta_local: repoDePrueba(),
          autonomia: "L1",
        }),
      })
    ).json();

    const cuerpo = await opciones(svc, `?project_id=${alta.proyecto.id}`);
    assert.equal(cuerpo.proyecto.id, alta.proyecto.id);

    const autonomia = cuerpo.grupos["project.autonomia"].preseleccion;
    assert.equal(autonomia.valor, "L1");
    assert.equal(autonomia.origen, "detectado");
    assert.ok(autonomia.porque.length > 20);
  });
});

test("con un snapshot completo, el area preseleccionada sale de un hallazgo con su evidencia", async () => {
  await conServicio({}, async (svc) => {
    const proyecto = await proyectoEscaneado(svc);

    const r = await pedir(svc, `/v1/options?project_id=${proyecto.id}`);
    assert.equal(
      r.status,
      200,
      "leer el catalogo de un proyecto escaneado dio error: la consulta de la preseleccion " +
        "toca `snapshot_finding`, y ahi es donde se rompe sin que ningun test sin escanear lo vea",
    );

    const area = (await r.json()).grupos["guideline.area"].preseleccion;
    assert.ok(area, "el repositorio declara `scripts.test`, asi que el snapshot respalda un area y no se dijo");
    assert.equal(area.valor, "testing");
    assert.equal(area.origen, "detectado");
    assert.ok(
      area.evidencia.length > 0,
      "un `detectado` sin la ruta que lo respalda es lo que el principio X prohibe",
    );
  });
});

test("un `project_id` que no existe se rechaza en vez de contestar el catalogo entero", async () => {
  await conServicio({}, async (svc) => {
    const r = await pedir(svc, "/v1/options?project_id=no-existe");
    assert.equal(
      r.status,
      404,
      "un filtro ignorado devuelve otra respuesta con 200: quien la mira cree que es la de su proyecto",
    );
  });
});
