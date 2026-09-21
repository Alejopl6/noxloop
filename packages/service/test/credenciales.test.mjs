// T141 y T144 — las dos superficies que no pueden existir.
//
// T141: `GET /v1/audit` es SOLO LECTURA. No es que el POST devuelva 403: es que
// no existe. La diferencia importa porque una ruta que existe y deniega es una
// ruta que alguien puede hacer que no deniegue —una bandera, un modo de
// depuracion, un "solo para el administrador"— y la auditoria deja de ser la
// explicacion de lo que paso para pasar a ser la lista de las veces que alguien
// decidio dejar constancia.
//
// T144: ninguna ruta crea una `DangerPolicy` habilitada. Y el test lo comprueba
// RECORRIENDO LAS RUTAS que el router declara, no confiando en que nadie lo
// haga. Confiar es lo que falla: la ruta cuarenta y uno la escribe alguien que
// no leyo FR-051, y la tabla de rutas es el unico sitio donde aparece sola.

import { test } from "node:test";
import assert from "node:assert/strict";

import { TABLA } from "../src/tabla.mjs";
import { concretar } from "../src/rutas.mjs";
import { conServicio, pedir, repoDePrueba, FRASE } from "./ayuda.mjs";

const conBoveda = { frase: FRASE };

async function proyecto(svc, nombre = "Con Credenciales") {
  const r = await pedir(svc, "/v1/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origen: "local", nombre, ruta_local: repoDePrueba() }),
  });
  return (await r.json()).proyecto;
}

async function registrarCredencial(svc, extra = {}) {
  const r = await pedir(svc, "/v1/credentials", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      nombre: "token-del-gestor",
      proveedor: "un-gestor-de-tickets",
      tipo: "api_token",
      alcance_declarado: "leer y comentar tickets del equipo",
      valor: "el-valor-secreto-de-la-prueba-0123456789",
      ...extra,
    }),
  });
  return { estado: r.status, cuerpo: await r.json() };
}

// ---------------------------------------------------------------------------
// T141 — la auditoria no se edita ni se borra
// ---------------------------------------------------------------------------

test("T141: `/v1/audit` declara UN metodo, y es `GET`", () => {
  const audit = TABLA.find((r) => r.patron === "/v1/audit");
  assert.ok(audit, "la ruta de auditoria desaparecio de la tabla");
  assert.deepEqual(
    audit.metodos,
    ["GET"],
    "la tabla es el mecanismo: un metodo declarado aqui es una superficie que existe, y una superficie que existe acaba usandose",
  );
});

test("T141: NINGUNA ruta de la tabla escribe sobre la auditoria", () => {
  // Se recorre la tabla entera y no solo `/v1/audit`: el camino real por el que
  // vuelve una escritura de auditoria no es un `POST /v1/audit` que alguien
  // agregue a la vista de todos, es un `/v1/audit/:id` o un
  // `/v1/audit/purge` que pasa sin que nadie lo relacione con FR-049.
  const ESCRITORES = ["POST", "PUT", "PATCH", "DELETE"];
  const culpables = TABLA.filter(
    (r) => /(^|\/)audit(\/|$)/.test(r.patron) && r.metodos.some((m) => ESCRITORES.includes(m)),
  ).map((r) => `${r.metodos.join("|")} ${r.patron}`);
  assert.deepEqual(culpables, [], `hay rutas que pueden escribir la auditoria:\n${culpables.join("\n")}`);
});

test("T141: por el cable, todo lo que no sea GET sobre /v1/audit da 405 nombrando lo unico que acepta", async () => {
  await conServicio(conBoveda, async (svc) => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await pedir(svc, "/v1/audit", { method });
      assert.equal(r.status, 405, `${method} /v1/audit dio ${r.status}`);
      const { error } = await r.json();
      assert.equal(error.codigo, "metodo_no_permitido");
      assert.match(error.accion, /GET/);
    }
  });
});

test("la auditoria se lee, trae la cadena verificada y crece sola con las operaciones", async () => {
  await conServicio(conBoveda, async (svc) => {
    const { estado } = await registrarCredencial(svc);
    assert.equal(estado, 201);

    const r = await pedir(svc, "/v1/audit");
    assert.equal(r.status, 200, await r.clone().text());
    const cuerpo = await r.json();
    assert.ok(cuerpo.items.length > 0, "registrar una credencial sin dejar rastro no es auditable");
    assert.equal(cuerpo.cadena.intacta, true, "la cadena de hash es lo que detecta una alteracion por fuera");
    for (const e of cuerpo.items) assert.ok(e.hash, "un evento sin hash rompe la cadena de los siguientes");
  });
});

// ---------------------------------------------------------------------------
// T144 — ninguna ruta crea una capacidad peligrosa habilitada
// ---------------------------------------------------------------------------

test("T144: despues de recorrer TODAS las rutas, no hay ni una DangerPolicy habilitada", async () => {
  await conServicio(conBoveda, async (svc) => {
    const p = await proyecto(svc, "Bajo Presion");
    await registrarCredencial(svc);

    // El recorrido sale de la tabla del router y no de una lista escrita a
    // mano: una lista se queda vieja, y la ruta que nadie agrego a la lista es
    // justo la que nadie reviso.
    const valores = {
      id: p.id,
      snapshot_id: "sn-que-no-existe",
      finding_id: "hl-que-no-existe",
      area: "seguridad",
    };

    // El cuerpo va cargado de intentos de encender algo. Si alguna ruta mapea
    // ciegamente el cuerpo a columnas, aqui es donde se ve.
    const cuerpo = JSON.stringify({
      habilitada: true,
      danger: { habilitada: true },
      capacidad: "merge_autonomo",
      habilitada_por: "quien sea",
      danger_policy: { capacidad: "despliegue", habilitada: true },
      nombre: "x",
      origen: "local",
      estado: "ACTIVE",
    });

    // SE MIRA DESPUES DE CADA PETICION, Y NO SOLO AL FINAL. La primera version
    // comprobaba la tabla una vez, al terminar el recorrido — y se le escapaba
    // el caso entero: `danger_policy.project_id` tiene `ON DELETE CASCADE`, y
    // el propio recorrido pasa por `DELETE /v1/projects/:id`. Una politica
    // habilitada creada por cualquier ruta anterior desaparecia con el
    // proyecto antes de que nadie la contara, y el test daba verde con el
    // invariante roto. Se comprobo con una mutacion: sobrevivia.
    const exigirNingunaHabilitada = (donde) => {
      const politicas = svc.dep.almacen.base.consultar("SELECT * FROM danger_policy WHERE habilitada = 1");
      assert.deepEqual(
        politicas,
        [],
        `${donde} dejo una capacidad de alto impacto YA habilitada: FR-051 dice que el valor al crear la fila ` +
          "es `false`, siempre, y que no hay camino en la aplicacion que cree una con `true`",
      );
    };

    for (const entrada of TABLA) {
      if (entrada.crudo) continue; // el canal de eventos no termina nunca
      for (const metodo of entrada.metodos) {
        if (metodo === "GET" || metodo === "HEAD") continue;
        const ruta = concretar(entrada.patron, valores);
        const r = await pedir(svc, ruta, { method: metodo, headers: { "content-type": "application/json" }, body: cuerpo });
        await r.text(); // que conteste lo que quiera: lo que se mide es la base
        exigirNingunaHabilitada(`${metodo} ${ruta}`);
      }
    }

    exigirNingunaHabilitada("el recorrido completo");
  });
});

test("T144: no hay ninguna ruta en la tabla que nombre las capacidades peligrosas", () => {
  // La segunda mitad de T144, y la que sobrevive al dia que el recorrido de
  // arriba deje de alcanzar una ruta nueva: no existe superficie HTTP para
  // habilitar una DangerPolicy. Habilitarla es una decision con dueño humano
  // (FR-051) y no un campo de un `PATCH`.
  const sospechosas = TABLA.filter((r) => /danger|polic|peligro/i.test(r.patron)).map((r) => r.patron);
  assert.deepEqual(sospechosas, [], `aparecio superficie para capacidades peligrosas: ${sospechosas.join(", ")}`);
});

// ---------------------------------------------------------------------------
// El inventario, los grants y la vista inversa
// ---------------------------------------------------------------------------

test("POST /v1/credentials guarda el valor en la boveda y devuelve HUELLA, nunca el valor", async () => {
  await conServicio(conBoveda, async (svc) => {
    const { estado, cuerpo } = await registrarCredencial(svc);
    assert.equal(estado, 201, JSON.stringify(cuerpo));
    assert.ok(cuerpo.huella.startsWith("sha256:"), "la huella es lo que deja comparar sin revelar");
    assert.equal(cuerpo.credencial.valor, undefined, "la estructura ni siquiera tiene campo para el valor");
    assert.ok(!JSON.stringify(cuerpo).includes("el-valor-secreto"));
  });
});

test("sin boveda configurada, registrar una credencial lo DICE y dice como configurarla", async () => {
  // Principio X: la pieza que falta se declara. La alternativa —inventar una
  // frase de paso y guardarla junto al archivo que cifra— es cifrar dejando la
  // llave pegada, y el operador creeria que su token esta protegido.
  await conServicio({}, async (svc) => {
    const { estado, cuerpo } = await registrarCredencial(svc);
    assert.equal(estado, 503);
    assert.equal(cuerpo.error.codigo, "pieza_ausente");
    assert.match(cuerpo.error.accion, /NOXLOOP_BOVEDA_FRASE/);
  });
});

test("GET /v1/credentials es el inventario: nombres, huellas y nada mas", async () => {
  await conServicio(conBoveda, async (svc) => {
    await registrarCredencial(svc);
    const r = await pedir(svc, "/v1/credentials");
    assert.equal(r.status, 200);
    const { items: credenciales } = await r.json();
    assert.equal(credenciales.length, 1);
    assert.equal(credenciales[0].nombre, "token-del-gestor");
    assert.ok(credenciales[0].ref_boveda, "la referencia es un puntero al backend, no el valor");
    assert.equal(credenciales[0].valor, undefined);
  });
});

test("FR-045: `reach` es la vista INVERSA y solo cuenta lo vigente", async () => {
  await conServicio(conBoveda, async (svc) => {
    const p = await proyecto(svc, "Con Grants");
    const { cuerpo: alta } = await registrarCredencial(svc);

    const agente = await (
      await pedir(svc, `/v1/projects/${p.id}/agents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nombre: "implementador", rol: "implementador", runtime: "runtime-a", modelo: "m" }),
      })
    ).json();

    const grant = await pedir(svc, "/v1/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_id: p.id,
        agent_id: agente.agente.id,
        credential_id: alta.credencial.id,
        concedido_por: "la persona que decidio",
      }),
    });
    assert.equal(grant.status, 201, await grant.clone().text());
    const { grant: otorgado } = await grant.json();

    const antes = await (await pedir(svc, `/v1/credentials/${alta.credencial.id}/reach`)).json();
    assert.equal(antes.items.length, 1);
    // Elementos COMPLETOS: la pregunta que esta vista responde es "quien puede
    // tocar esta credencial", y una lista de seis UUID no la responde.
    assert.equal(antes.items[0].agente.id, agente.agente.id);
    assert.equal(antes.items[0].agente.nombre, "implementador");
    assert.equal(antes.items[0].proyecto.id, p.id);
    assert.equal(antes.items[0].credencial.id, alta.credencial.id);
    assert.equal(antes.items[0].credencial.valor, undefined, "ni siquiera aqui viaja el valor");
    assert.equal(antes.items[0].concedido_por, "la persona que decidio");

    const revocado = await pedir(svc, `/v1/grants/${otorgado.id}`, { method: "DELETE" });
    assert.equal(revocado.status, 200, await revocado.clone().text());

    const despues = await (await pedir(svc, `/v1/credentials/${alta.credencial.id}/reach`)).json();
    assert.deepEqual(
      despues.items,
      [],
      "si la revocacion no se ve reflejada en la vista inversa, nadie sabe si revocar sirvio",
    );
  });
});

test("FR-047: rotar da huella nueva y CONSERVA los grants", async () => {
  await conServicio(conBoveda, async (svc) => {
    const p = await proyecto(svc, "Que Rota");
    const { cuerpo: alta } = await registrarCredencial(svc);
    const agente = await (
      await pedir(svc, `/v1/projects/${p.id}/agents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nombre: "implementador", rol: "implementador", runtime: "runtime-a", modelo: "m" }),
      })
    ).json();
    await pedir(svc, "/v1/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_id: p.id,
        agent_id: agente.agente.id,
        credential_id: alta.credencial.id,
        concedido_por: "la persona que decidio",
      }),
    });

    const r = await pedir(svc, `/v1/credentials/${alta.credencial.id}/rotate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ valor: "el-valor-nuevo-despues-de-rotar-9876543210" }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const rotada = await r.json();
    assert.notEqual(rotada.huella, alta.huella, "rotar sin cambiar la huella no se distingue de no rotar");

    const reach = await (await pedir(svc, `/v1/credentials/${alta.credencial.id}/reach`)).json();
    assert.deepEqual(
      reach.items.map((g) => g.agente.id),
      [agente.agente.id],
      "rotar se llevo los grants por delante: el efecto medible de eso no es que se pierdan permisos, es que nadie rota",
    );
  });
});
