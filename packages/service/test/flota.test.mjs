// T191 y la flota — `revisor_comparte_runtime`, la bandeja y el dashboard.
//
// POR QUE `activate` VALIDA AL GUARDAR Y NO AL EJECUTAR. Un error de
// configuracion descubierto a mitad de un run cuesta el run entero: el trabajo
// hecho, el presupuesto gastado y la confianza de quien lo lanzo. FR-034 lo
// pone en el momento de guardar a proposito.
//
// POR QUE EL REVISOR NO PUEDE COMPARTIR RUNTIME CON EL IMPLEMENTADOR. Una
// revision hecha por el mismo runtime que escribio el codigo aprueba sus
// propios puntos ciegos. No es una segunda opinion: es la primera repetida, y
// cuesta lo mismo.
//
// NFR-002 — el dashboard con 20 proyectos en menos de un segundo. Y se mide con
// 20 porque ese es el numero del requisito: con tres, cualquier cosa pasa.

import { test } from "node:test";
import assert from "node:assert/strict";

import { conServicio, pedir, repoDePrueba } from "./ayuda.mjs";
import { registroDeAdaptadores } from "../../adapters/src/registro.mjs";

/** Dos runtimes de mentira que cumplen el contrato: uno con hooks y otro sin. */
function runtimesDeMentira() {
  const uno = (/** @type {string} */ id, /** @type {boolean} */ hooks) => ({
    id,
    capabilities: () => ({ resume: true, cost: true, effort: false, hooks, models: "desconocido" }),
    preflight: async () => ({ ok: true }),
    runPhase: async () => {
      throw new Error("esta ruta no ejecuta fases");
    },
  });
  return registroDeAdaptadores([uno("con-hooks", true), uno("sin-hooks", false)]);
}

async function crearProyecto(svc, nombre) {
  const r = await pedir(svc, "/v1/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origen: "local", nombre, ruta_local: repoDePrueba() }),
  });
  return (await r.json()).proyecto;
}

async function crearAgente(svc, projectId, datos) {
  const r = await pedir(svc, `/v1/projects/${projectId}/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ modelo: "un-modelo", ...datos }),
  });
  return { estado: r.status, cuerpo: await r.json() };
}

test("POST /agents declara un agente de la flota", async () => {
  await conServicio({}, async (svc) => {
    const p = await crearProyecto(svc, "Con Flota");
    const { estado, cuerpo } = await crearAgente(svc, p.id, {
      nombre: "quien implementa",
      rol: "implementador",
      runtime: "runtime-a",
    });
    assert.equal(estado, 201, JSON.stringify(cuerpo));
    assert.equal(cuerpo.agente.rol, "implementador");
    assert.deepEqual(cuerpo.agente.skills, [], "los campos JSON vuelven como JSON, no como texto");
  });
});

test("un implementador SIN hooks se guarda: el motor fuerza el TDD despues de la fase, y el agente lo declara", async () => {
  // Antes el modelo de flota lo rechazaba (`runtime_sin_hooks_para_implementador`).
  // Ahora el motor lo sostiene a posteriori —revierte lo escrito fuera de
  // alcance y cuenta el intento—, que no es la misma garantia que un hook que
  // bloquea: por eso `tdd` lo dice, para que la pantalla de flota lo pinte.
  await conServicio({ adaptadores: runtimesDeMentira() }, async (svc) => {
    const p = await crearProyecto(svc, "Sin Hooks");
    const impl = await crearAgente(svc, p.id, { nombre: "impl", rol: "implementador", runtime: "sin-hooks" });
    assert.equal(impl.estado, 201, JSON.stringify(impl.cuerpo));
    assert.equal(impl.cuerpo.agente.tdd, "por_motor");

    const rev = await crearAgente(svc, p.id, { nombre: "rev", rol: "revisor", runtime: "con-hooks" });
    assert.equal(rev.cuerpo.agente.tdd, "no_aplica");

    const lista = await (await pedir(svc, `/v1/projects/${p.id}/agents`)).json();
    const porNombre = Object.fromEntries(lista.items.map((/** @type {any} */ a) => [a.nombre, a.tdd]));
    assert.deepEqual(porNombre, { impl: "por_motor", rev: "no_aplica" });

    const cambiado = await pedir(svc, `/v1/agents/${impl.cuerpo.agente.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runtime: "con-hooks", rol: "implementador" }),
    });
    // con-hooks ya es el runtime del revisor: FR-034 lo rechaza igual que siempre.
    assert.equal(cambiado.status, 409);
  });
});

test("con hooks el agente declara `por_hook`; sin registro de runtimes, `tdd` es null (no se sabe)", async () => {
  await conServicio({ adaptadores: runtimesDeMentira() }, async (svc) => {
    const p = await crearProyecto(svc, "Con Hooks");
    const impl = await crearAgente(svc, p.id, { nombre: "impl", rol: "implementador", runtime: "con-hooks" });
    assert.equal(impl.cuerpo.agente.tdd, "por_hook");
  });
  await conServicio({}, async (svc) => {
    const p = await crearProyecto(svc, "Sin Registro");
    const impl = await crearAgente(svc, p.id, { nombre: "impl", rol: "implementador", runtime: "runtime-a" });
    assert.equal(impl.cuerpo.agente.tdd, null, "sin registro no se puede afirmar quien sostiene el TDD");
  });
});

test("EL INVARIANTE (FR-034): el revisor no puede compartir runtime, y se rechaza AL GUARDAR", async () => {
  // El contrato lo pone en `activate`, y el motivo de ponerlo al guardar esta
  // escrito al lado: "un error de configuracion descubierto a mitad de un run
  // cuesta el run entero". El almacen lo lleva un paso mas lejos —lo aborta un
  // disparador del esquema, asi que la fila mala no llega a existir— y eso
  // hace que la flota rota sea inalcanzable, no solo no activable. Lo que este
  // test exige es que ese "no" salga con causa y accion, y no como un 500 con
  // una cadena de SQLite adentro.
  await conServicio({}, async (svc) => {
    const p = await crearProyecto(svc, "Revisor Duplicado");
    const primero = await crearAgente(svc, p.id, { nombre: "implementa", rol: "implementador", runtime: "el-mismo" });
    assert.equal(primero.estado, 201);

    const segundo = await crearAgente(svc, p.id, { nombre: "revisa", rol: "revisor", runtime: "el-mismo" });
    assert.equal(segundo.estado, 409, JSON.stringify(segundo.cuerpo));
    const { error } = segundo.cuerpo;
    assert.equal(error.codigo, "revisor_comparte_runtime");
    assert.match(error.causa, /el-mismo/, "la causa tiene que nombrar el runtime compartido");
    assert.match(error.causa, /revisa/);
    assert.match(error.causa, /implementa/);
    assert.ok(error.accion.length > 30, "la accion tiene que decir cual de los dos cambiar");
  });
});

test("FR-034 tambien al EDITAR: no se puede dejar al revisor en el runtime del implementador", async () => {
  // El camino que una comprobacion puesta solo en el alta deja abierto: crear
  // el revisor con otro runtime y despues igualarlo con un `PATCH`.
  await conServicio({}, async (svc) => {
    const p = await crearProyecto(svc, "Editado Hasta Romperlo");
    await crearAgente(svc, p.id, { nombre: "implementa", rol: "implementador", runtime: "runtime-a" });
    const revisor = await crearAgente(svc, p.id, { nombre: "revisa", rol: "revisor", runtime: "runtime-b" });

    const r = await pedir(svc, `/v1/agents/${revisor.cuerpo.agente.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runtime: "runtime-a" }),
    });
    assert.equal(r.status, 409, await r.clone().text());
    assert.equal((await r.json()).error.codigo, "revisor_comparte_runtime");
  });
});

test("con runtimes distintos, `activate` deja que decida la maquina de estados del almacen", async () => {
  await conServicio({}, async (svc) => {
    const p = await crearProyecto(svc, "Runtimes Distintos");
    await crearAgente(svc, p.id, { nombre: "implementa", rol: "implementador", runtime: "runtime-a" });
    await crearAgente(svc, p.id, { nombre: "revisa", rol: "revisor", runtime: "runtime-b" });

    const r = await pedir(svc, `/v1/projects/${p.id}/activate`, { method: "POST" });
    assert.equal(r.status, 409, "desde CREATED no se llega a ACTIVE, y el que lo dice es el almacen");
    const { error } = await r.json();
    assert.notEqual(error.codigo, "revisor_comparte_runtime");
    assert.ok(error.accion.length > 20);
  });
});

test("PATCH y DELETE sobre un agente lo modifican y lo quitan de la flota", async () => {
  await conServicio({}, async (svc) => {
    const p = await crearProyecto(svc, "Flota Editable");
    const { cuerpo } = await crearAgente(svc, p.id, { nombre: "implementa", rol: "implementador", runtime: "a" });

    const patch = await pedir(svc, `/v1/agents/${cuerpo.agente.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runtime: "b", modelo: "otro-modelo" }),
    });
    assert.equal(patch.status, 200, await patch.clone().text());
    assert.equal((await patch.json()).agente.runtime, "b");

    const del = await pedir(svc, `/v1/agents/${cuerpo.agente.id}`, { method: "DELETE" });
    assert.equal(del.status, 200);
    assert.deepEqual((await (await pedir(svc, `/v1/projects/${p.id}/agents`)).json()).items, []);
  });
});

test("la bandeja lista de todos los proyectos, y `/:id` trae la causa COMPLETA (FR-062)", async () => {
  await conServicio({}, async (svc) => {
    const p = await crearProyecto(svc, "Con Bandeja");
    const causa =
      "El agente `implementador` pidio la credencial `token-del-gestor` para el proyecto y no hay ningun " +
      "grant vigente que lo autorice. La tarea quedo bloqueada en vez de continuar sin ella, porque denegar " +
      "por defecto es lo unico que hace que un grant signifique algo.";
    const entrada = svc.dep.almacen.bandeja.crear({
      workspace_id: svc.dep.workspace.id,
      project_id: p.id,
      tipo: "autorizacion_credencial",
      causa,
      decisiones_posibles: ["conceder", "rechazar"],
    });

    const lista = await pedir(svc, "/v1/inbox");
    assert.equal(lista.status, 200, await lista.clone().text());
    const { items: entradas } = await lista.json();
    assert.equal(entradas.length, 1);

    const una = await pedir(svc, `/v1/inbox/${entrada.id}`);
    assert.equal(una.status, 200);
    const cuerpo = await una.json();
    assert.equal(cuerpo.entrada.causa, causa, "FR-062: textual y completa, no un resumen generado");
    assert.deepEqual(cuerpo.entrada.decisiones_posibles, ["conceder", "rechazar"]);
  });
});

test("resolver una entrada exige quien la resolvio: una decision sin dueño no es una decision", async () => {
  await conServicio({}, async (svc) => {
    const p = await crearProyecto(svc, "Resolver");
    const entrada = svc.dep.almacen.bandeja.crear({
      workspace_id: svc.dep.workspace.id,
      project_id: p.id,
      tipo: "autorizacion_credencial",
      causa: "una causa lo bastante larga como para que valga como causa completa de verdad",
    });

    const sinDueno = await pedir(svc, `/v1/inbox/${entrada.id}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "aprobada" }),
    });
    assert.ok(sinDueno.status >= 400 && sinDueno.status < 500, `dio ${sinDueno.status}`);
    assert.ok((await sinDueno.json()).error.accion.length > 20);

    const conDueno = await pedir(svc, `/v1/inbox/${entrada.id}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "aprobada", resuelta_por: "la persona", motivo: "porque si" }),
    });
    assert.equal(conDueno.status, 200, await conDueno.clone().text());
    assert.equal((await conDueno.json()).entrada.estado, "aprobada");
    assert.equal((await (await pedir(svc, "/v1/inbox")).json()).items.length, 0, "ya no espera a nadie");
  });
});

test("T191 / NFR-002: `GET /v1/dashboard` con 20 proyectos responde en menos de un segundo", async () => {
  await conServicio({}, async (svc) => {
    for (let i = 0; i < 20; i++) {
      const p = await crearProyecto(svc, `Proyecto ${i}`);
      svc.dep.almacen.bandeja.crear({
        workspace_id: svc.dep.workspace.id,
        project_id: p.id,
        tipo: "autorizacion_credencial",
        causa: `la entrada de bandeja numero ${i}, con texto suficiente para pasar por causa completa`,
      });
    }

    // Se mide la SEGUNDA, no la primera: la primera incluye el arranque del
    // plan de consulta de SQLite y mediria otra cosa.
    await pedir(svc, "/v1/dashboard");
    const t0 = Date.now();
    const r = await pedir(svc, "/v1/dashboard");
    const tardo = Date.now() - t0;

    assert.equal(r.status, 200, await r.clone().text());
    const cuerpo = await r.json();
    assert.equal(cuerpo.items.length, 20, "el dashboard tambien viaja en el sobre: `items` y los agregados al lado");
    assert.equal(cuerpo.cursor, null);
    assert.equal(cuerpo.proyectos.total, 20);
    assert.equal(cuerpo.bandeja.esperando, 20);
    assert.ok(cuerpo.proyectos.por_estado.CREATED === 20, JSON.stringify(cuerpo.proyectos.por_estado));
    assert.ok(tardo < 1000, `el dashboard tardo ${tardo}ms con 20 proyectos y NFR-002 da menos de 1000`);
  });
});

test("T191, la otra mitad: el dashboard no hace 1 + N consultas", async () => {
  // El reloj pasa con 20 proyectos aunque la consulta sea mala; el que lo paga
  // es el operador dos años despues, en su maquina, donde nadie corre pruebas.
  // Se mira el PLAN, que es lo que no depende del tamaño de la muestra.
  await conServicio({}, async (svc) => {
    const plan = svc.dep.almacen.inicio.planDeConsulta();
    const texto = JSON.stringify(plan);
    assert.ok(!/SCAN inbox_entry/i.test(texto), `la vista de inicio recorre la bandeja entera:\n${texto}`);
  });
});
