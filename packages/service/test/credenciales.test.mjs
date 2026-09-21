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
import { crearAdaptadorFalso } from "../../connections/src/adaptadores/fake.mjs";
import { conServicio, pedir, repoDePrueba, FRASE } from "./ayuda.mjs";

const conBoveda = { frase: FRASE };

/**
 * El servicio con el adaptador de conexiones falso: sin red, sin contenedores y
 * sin credenciales de nadie.
 *
 * `sondeosAntesDeAutorizar: 0` para que el `callback` conteste en el primer
 * sondeo. El valor por defecto obliga a dar una vuelta durmiendo, y el `callback`
 * de la ruta espera con `timeoutMs: 1`: la diferencia entre pasar y no pasar
 * acaba siendo cuanto tardo la primera vuelta, que es una carrera y no una
 * prueba.
 */
const conConexiones = () => ({
  frase: FRASE,
  // Uno nuevo por servicio y no una constante compartida: el repositorio del
  // adaptador vive en memoria, y un adaptador reusado hace que las conexiones
  // de un test aparezcan en el inventario del siguiente.
  proveedorDeConexiones: crearAdaptadorFalso({ sondeosAntesDeAutorizar: 0 }),
});

const json = (cuerpo) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });

/** @param {any} svc @param {string} projectId */
const filasDeConexion = (svc, projectId) => svc.dep.almacen.conexiones.porProyecto(projectId);

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

// ---------------------------------------------------------------------------
// Conexiones: la etapa 06 llega hasta donde mira la guarda
// ---------------------------------------------------------------------------
//
// LO QUE ESTAS PRUEBAS MIDEN, Y POR QUE NO BASTA CON QUE `authorize` DEVUELVA
// 201. `packages/connections` habla de conexiones `pendiente | conectada |
// revocada` en un repositorio en memoria, y la guarda `conexion_viva` de
// `packages/store` cuenta filas de la tabla `connection` con `estado = 'viva'`.
// Son dos vocabularios y dos almacenes: conectar de verdad por HTTP y dejar la
// guarda en rojo es exactamente lo que pasaba, y el sintoma para el operador era
// un proyecto que se quedaba en `BOOTSTRAPPED` sin que nada fallara.

test("conectar por HTTP deja la conexion donde mira la guarda, con el vocabulario del almacen", async () => {
  await conServicio(conConexiones(), async (svc) => {
    const p = await proyecto(svc, "Que Se Conecta");

    const r = await pedir(
      svc,
      `/v1/projects/${p.id}/connections/authorize`,
      { method: "POST", ...json({ proveedor: "falso-api-key", valores: { api_key: "una-clave-que-no-vuelve" } }) },
    );
    assert.equal(r.status, 201, await r.clone().text());
    const cuerpo = await r.json();

    const filas = filasDeConexion(svc, p.id);
    assert.equal(filas.length, 1, "la conexion no dejo fila en `connection`, que es la tabla donde mira la guarda");
    assert.equal(filas[0].id, cuerpo.conexion.id, "la fila y la conexion que devolvio el servicio no son la misma");
    assert.equal(
      filas[0].estado,
      "viva",
      "la fila guardo el estado de `packages/connections` (`conectada`) en una columna que solo entiende el del " +
        "almacen: la guarda cuenta `viva` y no encontraria ninguna",
    );
    assert.equal(filas[0].proveedor, "falso-api-key");
    assert.equal(filas[0].clase, "infra", "la clase sale del catalogo del adaptador, no se adivina del slug");
    assert.equal(filas[0].id_externo, cuerpo.session_token);

    const guarda = svc.dep.almacen.proyectos.artefactos(p.id).conexion_viva;
    assert.equal(guarda.listo, true, `la guarda sigue en rojo: ${guarda.hallado}`);

    // Y NO SE SALTEA LA MAQUINA DE ESTADOS. Este proyecto no paso por snapshot,
    // constitution ni bootstrap: conectar un proveedor no lo puede empujar a
    // `CONNECTED`, porque la unica arista que llega ahi sale de `BOOTSTRAPPED`.
    assert.equal(
      svc.dep.almacen.proyectos.porId(p.id).estado,
      "CREATED",
      "conectar movio el estado de un proyecto que no habia pasado por las etapas anteriores",
    );
    assert.equal(cuerpo.proyecto, undefined, "la respuesta anuncia un avance de etapa que no ocurrio");
  });
});

test("FR-032: una conexion `scm` se guarda SIN identificador de la capa de integracion", async () => {
  // El `CHECK (clase <> 'scm' OR id_externo IS NULL)` del esquema no es una
  // manía: `scm` no es una integracion, git se habla directo, y un `id_externo`
  // en esa fila es la señal de que alguien metio el repositorio por el
  // proveedor — a partir de ese dia clonar depende de que el proveedor conteste.
  // Arrastrar el handle del adaptador a esa columna revienta con
  // SQLITE_CONSTRAINT, y el proveedor `github` del catalogo por defecto es
  // `clase: "scm"`: esto no es un caso del adaptador falso.
  await conServicio(conConexiones(), async (svc) => {
    const p = await proyecto(svc, "Con El Scm");

    const r = await pedir(
      svc,
      `/v1/projects/${p.id}/connections/authorize`,
      { method: "POST", ...json({ proveedor: "falso-pat", valores: { pat: "un-token", usuario: "alguien" } }) },
    );
    assert.equal(r.status, 201, await r.clone().text());

    const filas = filasDeConexion(svc, p.id);
    assert.equal(filas.length, 1, "la conexion `scm` no se guardo: es inventario y tiene que estar");
    assert.equal(filas[0].clase, "scm");
    assert.equal(
      filas[0].id_externo,
      null,
      "la fila `scm` se llevo el identificador de la capa de integracion adentro (FR-032)",
    );
    assert.equal(svc.dep.almacen.proyectos.artefactos(p.id).conexion_viva.listo, true);
  });
});

test("oauth2: `authorize` deja la fila pendiente y el `callback` la pone viva, sin crear una segunda", async () => {
  await conServicio(conConexiones(), async (svc) => {
    const p = await proyecto(svc, "Que Autoriza");

    const r = await pedir(svc, `/v1/projects/${p.id}/connections/authorize`, {
      method: "POST",
      ...json({ proveedor: "falso-oauth2" }),
    });
    assert.equal(r.status, 201, await r.clone().text());
    const { session_token } = await r.json();

    const pendiente = filasDeConexion(svc, p.id);
    assert.equal(pendiente.length, 1, "una autorizacion en curso tambien es inventario: el operador la ve esperando");
    assert.equal(pendiente[0].estado, "pendiente");
    const guardaAntes = svc.dep.almacen.proyectos.artefactos(p.id).conexion_viva;
    assert.equal(guardaAntes.listo, false, "una conexion que todavia no contesto no habilita la etapa");
    assert.match(
      guardaAntes.hallado,
      /ninguna viva/,
      "la guarda no distingue 'no hay conexiones' de 'hay una esperando', y mandan al operador a sitios distintos",
    );

    const cb = await pedir(svc, `/v1/connections/${session_token}/callback`, { method: "POST", ...json({}) });
    assert.equal(cb.status, 200, await cb.clone().text());

    const viva = filasDeConexion(svc, p.id);
    assert.equal(viva.length, 1, "el `callback` creo una fila nueva en vez de completar la que `authorize` dejo");
    assert.equal(viva[0].id, pendiente[0].id);
    assert.equal(viva[0].estado, "viva");
  });
});

test("revocar una conexion la marca revocada TAMBIEN donde mira la guarda", async () => {
  // La otra direccion de la misma costura, y la peor: una fila `viva` que
  // sobrevive a la revocacion deja al proyecto en `CONNECTED` apoyado en una
  // conexion que ya no entrega credenciales.
  await conServicio(conConexiones(), async (svc) => {
    const p = await proyecto(svc, "Que Revoca");
    const r = await pedir(svc, `/v1/projects/${p.id}/connections/authorize`, {
      method: "POST",
      ...json({ proveedor: "falso-api-key", valores: { api_key: "una-clave-que-no-vuelve" } }),
    });
    const { conexion } = await r.json();

    const borrada = await pedir(svc, `/v1/connections/${conexion.id}`, { method: "DELETE" });
    assert.equal(borrada.status, 200, await borrada.clone().text());

    const filas = filasDeConexion(svc, p.id);
    assert.equal(filas.length, 1);
    assert.equal(filas[0].estado, "revocada", "la fila del almacen sigue diciendo que la conexion esta viva");
    assert.equal(svc.dep.almacen.proyectos.artefactos(p.id).conexion_viva.listo, false);
  });
});
