// FR-045, la vista inversa: dada una credencial, que agentes y proyectos la
// alcanzan HOY.
//
// LA PALABRA QUE HACE EL TRABAJO ES "HOY". Una consulta que responde con las
// filas que existen responde otra pregunta —"quien la alcanzo alguna vez"— y
// las dos se parecen lo bastante como para que nadie note el cambiazo hasta
// que importa. El `repositorio.mjs` de la boveda ya lo dice con el fallo
// delante: si la revocacion no se ve reflejada, nadie sabe si revocar sirvio.
//
// Este archivo tambien es el contrato con `packages/vault`: ese paquete dejo
// una interfaz inyectable (`RepositorioDeBoveda`) implementada en memoria con
// un TODO de persistencia. Lo que aqui se prueba es que la implementacion
// contra SQLite responde lo mismo, porque las pruebas de la boveda "no miran el
// almacenamiento, miran que el valor no aparezca y que la vigencia se respete".

import { test } from "node:test";
import assert from "node:assert/strict";

import { almacenDePrueba, capturar, credencialDePrueba, llevarHasta, proyectoDePrueba } from "./ayuda.mjs";
import { ErrorDeAlmacen } from "../src/errores.mjs";

const T0 = Date.parse("2026-09-20T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

/** Monta dos proyectos con un agente cada uno y una credencial global. */
function escenario() {
  const { almacen, workspace } = almacenDePrueba();
  const uno = llevarHasta(almacen, proyectoDePrueba(almacen, workspace.id, { slug: "uno" }), "ACTIVE");
  const dos = llevarHasta(almacen, proyectoDePrueba(almacen, workspace.id, { slug: "dos" }), "ACTIVE");
  const agenteUno = almacen.agentes.porProyecto(uno.id)[0];
  const agenteDos = almacen.agentes.porProyecto(dos.id)[0];
  const credencial = almacen.boveda.guardarCredencial(credencialDePrueba({ workspace_id: workspace.id }));
  return { almacen, workspace, uno, dos, agenteUno, agenteDos, credencial };
}

test("un grant vigente hace que su agente y su proyecto alcancen la credencial", () => {
  const { almacen, uno, agenteUno, credencial } = escenario();
  almacen.boveda.guardarGrant({
    id: "g-vigente",
    project_id: uno.id,
    agent_id: agenteUno.id,
    credential_id: credencial.id,
    vigencia_desde: iso(T0 - 1000),
    vigencia_hasta: null,
    concedido_por: "la operadora",
    concedido_en: iso(T0 - 1000),
  });

  const alcance = almacen.boveda.alcance({ credential_id: credencial.id }, T0);
  assert.deepEqual(alcance.agentes, [agenteUno.id]);
  assert.deepEqual(alcance.proyectos, [uno.id]);
  assert.equal(alcance.grants.length, 1);
  almacen.cerrar();
});

test("un grant REVOCADO no alcanza, aunque la fila siga ahi", () => {
  const { almacen, uno, agenteUno, credencial } = escenario();
  almacen.boveda.guardarGrant({
    id: "g-revocado",
    project_id: uno.id,
    agent_id: agenteUno.id,
    credential_id: credencial.id,
    vigencia_desde: iso(T0 - 5000),
    vigencia_hasta: null,
    concedido_por: "la operadora",
    concedido_en: iso(T0 - 5000),
    revocado_en: iso(T0 - 100),
  });

  const alcance = almacen.boveda.alcance({ credential_id: credencial.id }, T0);
  assert.deepEqual(alcance.grants, []);
  assert.deepEqual(alcance.agentes, []);
  assert.equal(almacen.base.consultarUno('SELECT count(*) AS n FROM "grant"').n, 1, "la fila tenia que seguir ahi");
  almacen.cerrar();
});

test("un grant CADUCADO no alcanza: la vigencia se mira contra el instante que se pasa, no contra el reloj", () => {
  const { almacen, uno, agenteUno, credencial } = escenario();
  almacen.boveda.guardarGrant({
    id: "g-caducado",
    project_id: uno.id,
    agent_id: agenteUno.id,
    credential_id: credencial.id,
    vigencia_desde: iso(T0 - 5000),
    vigencia_hasta: iso(T0 - 1),
    concedido_por: "la operadora",
    concedido_en: iso(T0 - 5000),
  });

  assert.deepEqual(almacen.boveda.alcance({ credential_id: credencial.id }, T0).grants, []);
  // Y un segundo antes del vencimiento si alcanzaba: la prueba no pasa porque
  // la consulta devuelva vacio siempre.
  assert.equal(almacen.boveda.alcance({ credential_id: credencial.id }, T0 - 1000).grants.length, 1);
  almacen.cerrar();
});

test("un grant que empieza MANANA no alcanza hoy", () => {
  // `vigencia_desde` existe en el modelo y una consulta que solo mira `hasta`
  // lo ignora: un grant preparado para el lunes autoriza el viernes.
  const { almacen, uno, agenteUno, credencial } = escenario();
  almacen.boveda.guardarGrant({
    id: "g-futuro",
    project_id: uno.id,
    agent_id: agenteUno.id,
    credential_id: credencial.id,
    vigencia_desde: iso(T0 + 86400000),
    vigencia_hasta: null,
    concedido_por: "la operadora",
    concedido_en: iso(T0),
  });
  assert.deepEqual(almacen.boveda.alcance({ credential_id: credencial.id }, T0).grants, []);
  assert.equal(almacen.boveda.alcance({ credential_id: credencial.id }, T0 + 86400001).grants.length, 1);
  almacen.cerrar();
});

test("EL INVARIANTE: no hay grant implicito. El agente del mismo proyecto sin fila no alcanza", () => {
  const { almacen, uno, agenteUno, credencial } = escenario();
  const otroDelMismoProyecto = almacen.agentes.crear({
    project_id: uno.id,
    nombre: "revisor",
    rol: "revisor",
    runtime: "runtime-b",
    modelo: "modelo-b",
  });
  almacen.boveda.guardarGrant({
    id: "g-solo-uno",
    project_id: uno.id,
    agent_id: agenteUno.id,
    credential_id: credencial.id,
    vigencia_desde: iso(T0 - 1000),
    vigencia_hasta: null,
    concedido_por: "la operadora",
    concedido_en: iso(T0 - 1000),
  });

  const alcance = almacen.boveda.alcance({ credential_id: credencial.id }, T0);
  assert.deepEqual(alcance.agentes, [agenteUno.id]);
  assert.ok(!alcance.agentes.includes(otroDelMismoProyecto.id), "el agente sin fila alcanzo la credencial");
  almacen.cerrar();
});

test("la vista inversa agrupa sin repetir cuando varios grants apuntan al mismo proyecto", () => {
  const { almacen, uno, dos, agenteUno, agenteDos, credencial } = escenario();
  const extra = almacen.agentes.crear({
    project_id: uno.id,
    nombre: "planificador",
    rol: "planificador",
    runtime: "runtime-c",
    modelo: "modelo-c",
  });
  for (const [id, proyecto, agente] of [
    ["g1", uno.id, agenteUno.id],
    ["g2", uno.id, extra.id],
    ["g3", dos.id, agenteDos.id],
  ]) {
    almacen.boveda.guardarGrant({
      id,
      project_id: proyecto,
      agent_id: agente,
      credential_id: credencial.id,
      vigencia_desde: iso(T0 - 1000),
      vigencia_hasta: null,
      concedido_por: "la operadora",
      concedido_en: iso(T0 - 1000),
    });
  }

  const alcance = almacen.boveda.alcance({ credential_id: credencial.id }, T0);
  assert.deepEqual([...alcance.proyectos].sort(), [dos.id, uno.id].sort());
  assert.equal(alcance.agentes.length, 3);
  assert.equal(alcance.grants.length, 3);
  almacen.cerrar();
});

test("el criterio filtra por cualquiera de los tres lados de la tripleta", () => {
  const { almacen, uno, dos, agenteUno, agenteDos, credencial } = escenario();
  for (const [id, proyecto, agente] of [
    ["g1", uno.id, agenteUno.id],
    ["g2", dos.id, agenteDos.id],
  ]) {
    almacen.boveda.guardarGrant({
      id,
      project_id: proyecto,
      agent_id: agente,
      credential_id: credencial.id,
      vigencia_desde: iso(T0 - 1000),
      vigencia_hasta: null,
      concedido_por: "la operadora",
      concedido_en: iso(T0 - 1000),
    });
  }
  assert.deepEqual(almacen.boveda.alcance({ project_id: dos.id }, T0).agentes, [agenteDos.id]);
  assert.deepEqual(almacen.boveda.alcance({ agent_id: agenteUno.id }, T0).proyectos, [uno.id]);
  assert.equal(almacen.boveda.alcance({ project_id: uno.id, agent_id: agenteDos.id }, T0).grants.length, 0);
  almacen.cerrar();
});

test("el repositorio satisface la interfaz `RepositorioDeBoveda` que `packages/vault` inyecta", () => {
  // La lista viene del `@typedef` de `packages/vault/src/repositorio.mjs`. Se
  // copia a mano y no se importa: un import a ese paquete es exactamente lo que
  // prohibe `test/paquete-autocontenido.test.mjs`, y el almacen viaja al
  // escritorio como recurso suelto.
  const { almacen } = almacenDePrueba();
  const ESPERADOS = [
    "alcance",
    "borrarCredencial",
    "credencialPorId",
    "credencialPorRef",
    "credenciales",
    "grantPorId",
    "grants",
    "guardarCredencial",
    "guardarGrant",
    "instantanea",
  ];
  for (const metodo of ESPERADOS) {
    assert.equal(typeof almacen.boveda[metodo], "function", `falta \`${metodo}\` en el repositorio del almacen`);
  }
  almacen.cerrar();
});

test("lo que sale del repositorio esta congelado: nadie muta el almacen por la espalda", () => {
  const { almacen, credencial } = escenario();
  const leida = almacen.boveda.credencialPorId(credencial.id);
  assert.ok(Object.isFrozen(leida));
  assert.throws(() => {
    leida.nombre = "otro";
  }, TypeError);
  assert.equal(almacen.boveda.credencialPorId(credencial.id).nombre, credencial.nombre);
  almacen.cerrar();
});

test("`guardarCredencial` es idempotente por `ref_boveda`: rotar no crea una segunda fila", () => {
  const { almacen, workspace } = almacenDePrueba();
  const c = credencialDePrueba({ workspace_id: workspace.id });
  almacen.boveda.guardarCredencial(c);
  almacen.boveda.guardarCredencial({ ...c, huella: "sha256:nueva", rotada: iso(T0) });
  assert.equal(almacen.boveda.credenciales().length, 1);
  assert.equal(almacen.boveda.credencialPorRef(c.ref_boveda).huella, "sha256:nueva");
  almacen.cerrar();
});

test("una credencial a la que le falta un campo obligatorio se rechaza NOMBRANDOLO, no con un fallo de SQL", () => {
  // EL FALLO QUE EVITA, Y ES EL HUECO REAL ENTRE LOS DOS VOCABULARIOS. La
  // `Credential` que construye `packages/vault` no trae `proveedor`, `ambito`
  // ni `alcance_declarado`, que `data-model.md` exige. Inventarlos aqui seria
  // rellenar un hueco con lo probable, que es justo lo que prohibe el principio
  // X. El almacen los pide por su nombre y dice donde ponerlos.
  const { almacen, workspace } = almacenDePrueba();
  const incompleta = credencialDePrueba({ workspace_id: workspace.id });
  delete incompleta.proveedor;

  const error = capturar(() => almacen.boveda.guardarCredencial(incompleta));
  assert.ok(error instanceof ErrorDeAlmacen);
  assert.equal(error.codigo, "campo_obligatorio_ausente");
  assert.match(error.causa, /proveedor/);
  assert.match(error.causa, /credential/);
  almacen.cerrar();
});

test("un `tipo` fuera del enum de `data-model.md` se rechaza diciendo cuales valen", () => {
  const { almacen, workspace } = almacenDePrueba();
  const error = capturar(() =>
    almacen.boveda.guardarCredencial(credencialDePrueba({ workspace_id: workspace.id, tipo: "token" })),
  );
  assert.equal(error.codigo, "valor_fuera_del_enum");
  assert.match(error.causa, /token/);
  assert.match(error.accion, /api_token/);
  almacen.cerrar();
});

test("borrar una credencial se lleva sus grants: un grant huerfano autoriza contra nada", () => {
  const { almacen, uno, agenteUno, credencial } = escenario();
  almacen.boveda.guardarGrant({
    id: "g1",
    project_id: uno.id,
    agent_id: agenteUno.id,
    credential_id: credencial.id,
    vigencia_desde: iso(T0 - 1000),
    vigencia_hasta: null,
    concedido_por: "la operadora",
    concedido_en: iso(T0 - 1000),
  });
  almacen.boveda.borrarCredencial(credencial.ref_boveda);
  assert.equal(almacen.boveda.credencialPorRef(credencial.ref_boveda), null);
  assert.deepEqual(almacen.boveda.grants(), []);
  almacen.cerrar();
});
