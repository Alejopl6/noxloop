// La decision del operador sobre una tarjeta «movida» (spec 005, US1 esc. 4, FR-004).
//
// LO QUE SE PRUEBA AQUI ES LO QUE EL ALMACEN GARANTIZA: que la decision se
// guarda por proyecto e item, que decidir otra vez la reemplaza (una tarjeta
// tiene UNA decision vigente), que solo caben `seguir` y `soltar`, que se puede
// olvidar entera para un proyecto, que sobrevive a reabrir la base y que se va
// con el proyecto. Que el gestor no se entere y que el board la aplique es
// cosa del servicio, y se prueba alli.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ENUMS, MIGRACIONES, abrirAlmacen } from "../src/index.mjs";
import { almacenDePrueba, capturar, redactorDePrueba } from "./ayuda.mjs";

/** @param {any} almacen @param {any} workspace @param {string} [nombre] */
function proyecto(almacen, workspace, nombre = "Plataforma") {
  return almacen.proyectos.crear({
    workspace_id: workspace.id,
    nombre,
    slug: nombre.toLowerCase(),
    origen: "local",
    ruta_local: `/tmp/${nombre}`,
  });
}

const CUANDO = "2026-09-24T10:00:00.000Z";

test("la decision de las movidas llega en una migracion NUEVA, posterior al orden", () => {
  const m = MIGRACIONES.find((x) => x.nombre === "decision-de-movida");
  assert.ok(m, "falta la migracion `decision-de-movida`");
  assert.ok(m.version > MIGRACIONES.find((x) => x.nombre === "orden-y-ajustes").version);
  assert.deepEqual(ENUMS["movida_decision.decision"], ["seguir", "soltar"]);
});

test("decidir y leer por proyecto: la decision lleva el destino para el que se tomo y cuando", () => {
  const { almacen, workspace } = almacenDePrueba();
  const p = proyecto(almacen, workspace);
  almacen.movidas.decidir(p.id, "iss-1", { decision: "seguir", destino: "Pagos", decidida: CUANDO });
  almacen.movidas.decidir(p.id, "iss-2", { decision: "soltar", destino: null, decidida: CUANDO });
  const d = almacen.movidas.delProyecto(p.id);
  assert.ok(d instanceof Map);
  assert.deepEqual(d.get("iss-1"), { decision: "seguir", destino: "Pagos", decidida: CUANDO });
  assert.deepEqual(d.get("iss-2"), { decision: "soltar", destino: null, decidida: CUANDO });
  almacen.cerrar();
});

test("decidir otra vez REEMPLAZA: una tarjeta tiene una sola decision vigente", () => {
  const { almacen, workspace } = almacenDePrueba();
  const p = proyecto(almacen, workspace);
  almacen.movidas.decidir(p.id, "iss-1", { decision: "seguir", destino: "Pagos", decidida: CUANDO });
  almacen.movidas.decidir(p.id, "iss-1", { decision: "soltar", destino: "Pagos", decidida: "2026-09-24T11:00:00.000Z" });
  const d = almacen.movidas.delProyecto(p.id);
  assert.equal(d.size, 1);
  assert.equal(d.get("iss-1").decision, "soltar");
  almacen.cerrar();
});

test("la decision es por proyecto: el mismo item en otro proyecto no la hereda", () => {
  const { almacen, workspace } = almacenDePrueba();
  const a = proyecto(almacen, workspace, "Alfa");
  const b = proyecto(almacen, workspace, "Beta");
  almacen.movidas.decidir(a.id, "iss-1", { decision: "seguir", destino: "Pagos", decidida: CUANDO });
  assert.equal(almacen.movidas.delProyecto(b.id).size, 0);
  almacen.cerrar();
});

test("una decision fuera del enum o un item vacio se rechazan con causa, y no se escribe nada", () => {
  const { almacen, workspace } = almacenDePrueba();
  const p = proyecto(almacen, workspace);
  const e = capturar(() => almacen.movidas.decidir(p.id, "iss-1", { decision: "borrar", destino: null, decidida: CUANDO }));
  assert.equal(e.codigo, "valor_fuera_del_enum");
  assert.match(String(e.causa), /borrar/);
  const vacio = capturar(() => almacen.movidas.decidir(p.id, " ", { decision: "seguir", destino: null, decidida: CUANDO }));
  assert.ok(vacio, "un item vacio no tiene tarjeta a la que aplicarse");
  assert.equal(almacen.movidas.delProyecto(p.id).size, 0);
  almacen.cerrar();
});

test("olvidar: las de UN item, o todas las de un proyecto (cuando cambian sus reglas)", () => {
  const { almacen, workspace } = almacenDePrueba();
  const a = proyecto(almacen, workspace, "Alfa");
  const b = proyecto(almacen, workspace, "Beta");
  almacen.movidas.decidir(a.id, "1", { decision: "seguir", destino: "X", decidida: CUANDO });
  almacen.movidas.decidir(a.id, "2", { decision: "soltar", destino: "X", decidida: CUANDO });
  almacen.movidas.decidir(b.id, "1", { decision: "seguir", destino: "X", decidida: CUANDO });

  almacen.movidas.olvidar(a.id, "1");
  assert.deepEqual([...almacen.movidas.delProyecto(a.id).keys()], ["2"]);
  almacen.movidas.olvidarDelProyecto(a.id);
  assert.equal(almacen.movidas.delProyecto(a.id).size, 0);
  assert.equal(almacen.movidas.delProyecto(b.id).size, 1, "olvidar un proyecto no toca los demas");
  almacen.cerrar();
});

test("la decision sobrevive a cerrar y reabrir la base", () => {
  const ruta = join(mkdtempSync(join(tmpdir(), "noxloop-movida-")), "almacen.sqlite");
  let almacen = abrirAlmacen({ ruta, redactor: redactorDePrueba });
  const w = almacen.workspaces.crear({ home: "/tmp/h" });
  const p = proyecto(almacen, w);
  almacen.movidas.decidir(p.id, "iss-1", { decision: "soltar", destino: "Pagos", decidida: CUANDO });
  almacen.cerrar();

  almacen = abrirAlmacen({ ruta, redactor: redactorDePrueba });
  assert.equal(almacen.movidas.delProyecto(p.id).get("iss-1").decision, "soltar");
  almacen.cerrar();
});

test("borrar el proyecto se lleva sus decisiones (no quedan filas huerfanas)", () => {
  const { almacen, workspace } = almacenDePrueba();
  const p = proyecto(almacen, workspace);
  almacen.movidas.decidir(p.id, "iss-1", { decision: "seguir", destino: "Pagos", decidida: CUANDO });
  almacen.base.escribir("DELETE FROM project WHERE id = ?", [p.id]);
  assert.equal(almacen.base.consultar("SELECT * FROM movida_decision").length, 0);
  almacen.cerrar();
});
