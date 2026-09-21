// NFR-002: la vista de inicio responde en menos de 1 segundo con 20 proyectos.
//
// DOS AFIRMACIONES, Y LA SEGUNDA ES LA QUE DE VERDAD PROTEGE. La primera mide
// el reloj, que es lo que pide el requisito. El problema del reloj como unica
// guarda es que con 20 proyectos un escaneo completo tambien baja de un
// segundo en una maquina de desarrollo: la prueba pasaria igual sin un solo
// indice, y el dia que el almacen lleve dos anos de bandeja el escaneo ya no
// baja, en la maquina del operador, donde nadie esta corriendo pruebas.
//
// Por eso la segunda afirmacion mira el PLAN de la consulta y exige que ninguna
// de las tablas que crecen sin techo —bandeja, hallazgos, recomendaciones— se
// recorra entera. Esa si cae en cuanto alguien borra un indice o escribe la
// consulta de forma que no lo pueda usar, que es como se pierden los indices de
// verdad: no borrandolos, sino dejando de poder usarlos.

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { almacenDePrueba } from "./ayuda.mjs";

const PROYECTOS = 20;
const HALLAZGOS_POR_PROYECTO = 400;
const BANDEJA_POR_PROYECTO = 300;
const RECOMENDACIONES_POR_PROYECTO = 60;

/**
 * Los ALIAS de las tablas que crecen con el uso y no pueden recorrerse enteras.
 *
 * SON LOS ALIAS Y NO LOS NOMBRES DE TABLA, Y ASI SE DESCUBRIO. La primera
 * version de esta guarda buscaba `SCAN ... inbox_entry` en el plan, y no caia
 * al quitar los indices: `EXPLAIN QUERY PLAN` nombra el ALIAS de la consulta
 * —`SCAN i`, `SEARCH f USING COVERING INDEX ...`— y el nombre de la tabla no
 * aparece en ninguna linea. La guarda pasaba siempre, con indices y sin ellos,
 * que es la peor forma de fallar: una prueba verde que no mira nada. Se
 * encontro rompiendo el mecanismo a proposito y viendo que la prueba no se
 * enteraba.
 */
const ALIAS_QUE_CRECEN = {
  i: "inbox_entry",
  r: "recommendation",
  a: "agent",
  c: "connection",
  // Las conexiones DEL ESPACIO DE TRABAJO, que la vista de inicio cuenta
  // aparte. Entra en la guarda por el mismo motivo que las demas: el alias es
  // nuevo, y un alias que la guarda no conoce es una subconsulta que puede
  // recorrer la tabla entera sin que nadie se entere.
  c2: "connection",
  s: "project_snapshot",
  s2: "project_snapshot",
  f: "snapshot_finding",
};

/** Las lineas del plan que son un recorrido completo, con el alias que recorren. */
function escaneosDelPlan(plan) {
  return plan
    .map((linea) => ({ linea, alias: (/^\s*SCAN\s+([A-Za-z_][A-Za-z_0-9]*)/.exec(linea) || [])[1] }))
    .filter((e) => e.alias && e.alias in ALIAS_QUE_CRECEN)
    .map((e) => `${e.linea}  (${ALIAS_QUE_CRECEN[e.alias]})`);
}

/**
 * Datos sinteticos. Se escriben en UNA transaccion a proposito: 20 mil
 * `INSERT` con una transaccion por sentencia tardan mas que la consulta que se
 * quiere medir, y la prueba dejaria de ser sobre la consulta.
 */
function sembrar(almacen, workspace) {
  almacen.base.enTransaccion(() => {
    for (let p = 0; p < PROYECTOS; p++) {
      const proyecto = almacen.proyectos.crear({
        workspace_id: workspace.id,
        nombre: `proyecto ${p}`,
        slug: `proyecto-${p}`,
        origen: "local",
        ruta_local: `/tmp/arbol-${p}`,
      });
      const snapshot = almacen.snapshots.crear({ project_id: proyecto.id, commit: randomUUID().replace(/-/g, "") });
      for (let h = 0; h < HALLAZGOS_POR_PROYECTO; h++) {
        almacen.snapshots.agregarHallazgo({
          snapshot_id: snapshot.id,
          categoria: "dependencias",
          clave: `dependencias.paquete-${h}`,
          valor: { version: "1.0.0" },
          origen: "inferido",
          evidencia: [],
          confianza: "media",
          decision: h % 4 === 0 ? "pendiente" : "aceptado",
        });
      }
      for (let b = 0; b < BANDEJA_POR_PROYECTO; b++) {
        almacen.bandeja.crear({
          workspace_id: workspace.id,
          project_id: proyecto.id,
          tipo: "gate_rojo",
          causa: `el gate volvio con exit code 1 sobre la tarea T${b}`,
          estado: b % 5 === 0 ? "esperando" : "aprobada",
          resuelta_por: b % 5 === 0 ? null : "la operadora",
        });
      }
      for (let r = 0; r < RECOMENDACIONES_POR_PROYECTO; r++) {
        almacen.recomendaciones.crear({
          project_id: proyecto.id,
          tipo: "hook",
          titulo: `recomendacion ${r}`,
          justificacion: "porque si",
          diff: "--- a\n+++ b\n",
          decision: r % 3 === 0 ? "pendiente" : "aplicada",
        });
      }
      for (let a = 0; a < 4; a++) {
        almacen.agentes.crear({
          project_id: proyecto.id,
          nombre: `agente-${a}`,
          rol: ["implementador", "revisor", "planificador", "verificador"][a],
          runtime: `runtime-${a}`,
          modelo: "modelo",
        });
      }
    }
  });
}

test("NFR-002: la vista de inicio con 20 proyectos responde en menos de 1 segundo", () => {
  const { almacen, workspace } = almacenDePrueba();
  sembrar(almacen, workspace);

  // Una vez en frio y tres mas: lo que se reporta es la peor de las cuatro, no
  // la mejor. Una media esconde justo el caso que el operador nota.
  let peor = 0;
  for (let i = 0; i < 4; i++) {
    const t = process.hrtime.bigint();
    const filas = almacen.inicio.proyectos();
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    peor = Math.max(peor, ms);
    assert.equal(filas.length, PROYECTOS);
  }
  assert.ok(peor < 1000, `la vista de inicio tardo ${peor.toFixed(1)} ms, y NFR-002 da 1000`);
  almacen.cerrar();
});

test("la vista de inicio trae lo que la pantalla necesita, sin una segunda consulta por proyecto", () => {
  // EL FALLO QUE EVITA. Devolver solo los proyectos obliga a la interfaz a
  // pedir la bandeja de cada uno: 1 + 20 peticiones, cada una con su viaje. El
  // presupuesto de un segundo se gasta en los viajes, no en la consulta, y
  // optimizar la consulta despues no lo arregla.
  const { almacen, workspace } = almacenDePrueba();
  sembrar(almacen, workspace);
  const fila = almacen.inicio.proyectos()[0];
  for (const campo of [
    "id",
    "nombre",
    "slug",
    "estado",
    "origen",
    "actualizado",
    "bandeja_esperando",
    "hallazgos_pendientes",
    "recomendaciones_pendientes",
    "agentes",
    "conexiones_vivas",
    "ultimo_snapshot",
  ]) {
    assert.ok(campo in fila, `a la vista de inicio le falta \`${campo}\``);
  }
  assert.equal(fila.bandeja_esperando, Math.ceil(BANDEJA_POR_PROYECTO / 5));
  assert.equal(fila.hallazgos_pendientes, Math.ceil(HALLAZGOS_POR_PROYECTO / 4));
  assert.equal(fila.agentes, 4);
  almacen.cerrar();
});

test("EL INVARIANTE DE RENDIMIENTO: ninguna tabla que crece se recorre entera", () => {
  const { almacen, workspace } = almacenDePrueba();
  sembrar(almacen, workspace);

  const plan = almacen.inicio.planDeConsulta();

  // `SCAN p` (los 20 proyectos) SI esta permitido y es lo correcto: la vista de
  // inicio los quiere todos, y `project` tiene una fila por proyecto — no crece
  // con el uso, crece con lo que el operador da de alta.
  assert.deepEqual(
    escaneosDelPlan(plan),
    [],
    `la vista de inicio recorre tablas enteras:\n${plan.join("\n")}`,
  );

  // Y ademas: CADA subconsulta correlacionada entra por un indice. Sin esto, la
  // afirmacion de arriba se cumpliria tambien con un plan vacio o con una
  // consulta que dejara de mirar esas tablas.
  const porIndice = plan.filter((linea) => /USING (COVERING )?INDEX/i.test(linea));
  const subconsultas = plan.filter((linea) => /CORRELATED SCALAR SUBQUERY/i.test(linea));
  assert.ok(subconsultas.length >= 6, `la vista de inicio dejo de traer lo de cada proyecto:\n${plan.join("\n")}`);
  assert.ok(
    porIndice.length >= subconsultas.length,
    `hay subconsultas que no entran por indice:\n${plan.join("\n")}`,
  );
  almacen.cerrar();
});

test("la vista inversa de credenciales tampoco recorre `grant` entera", () => {
  // FR-045 se consulta desde la pantalla de una credencial, que es donde el
  // operador esta decidiendo si revocar. Con el almacen lleno, un escaneo ahi
  // se nota igual que en el inicio.
  //
  // Se mira el alias `g`, por lo mismo que arriba: el plan no nombra la tabla.
  const { almacen } = almacenDePrueba();
  const plan = almacen.boveda.planDeAlcance({ credential_id: "c1" });
  assert.deepEqual(
    plan.filter((l) => /^\s*SCAN\s+g\b/.test(l)),
    [],
    `la vista inversa recorre \`grant\` entera:\n${plan.join("\n")}`,
  );
  assert.ok(
    plan.some((l) => /SEARCH\s+g\s+USING (COVERING )?INDEX/i.test(l)),
    `la vista inversa no entra por ningun indice:\n${plan.join("\n")}`,
  );
  almacen.cerrar();
});
