// El orden a mano del board y los ajustes del servicio (spec 005, FR-005..006).
//
// LO QUE SE PRUEBA AQUI ES LO QUE EL ALMACEN GARANTIZA: que el orden se guarda
// por proyecto y por columna, que sobrevive a cerrar y reabrir la base, que
// reordenar una columna REEMPLAZA su orden entero (no lo mezcla con el viejo) y
// que una tarjeta tiene UNA sola posicion aunque cambie de columna. Que el
// gestor no se entere es cosa del servicio, y se prueba alli.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MIGRACIONES, abrirAlmacen } from "../src/index.mjs";
import { almacenDePrueba, capturar, redactorDePrueba } from "./ayuda.mjs";

/** @param {any} almacen @param {any} workspace @param {string} [nombre] */
function proyecto(almacen, workspace, nombre = "Payments") {
  return almacen.proyectos.crear({
    workspace_id: workspace.id,
    nombre,
    slug: nombre.toLowerCase(),
    origen: "local",
    ruta_local: `/tmp/${nombre}`,
  });
}

test("el orden y los ajustes llegan en una migracion NUEVA, no retocando las que ya corrieron", () => {
  const m = MIGRACIONES.find((x) => x.nombre === "orden-y-ajustes");
  assert.ok(m, "falta la migracion `orden-y-ajustes`");
  assert.ok(m.version > MIGRACIONES.find((x) => x.nombre === "tareas-propias").version);
});

test("guardar el orden de una columna y leerlo por proyecto", () => {
  const { almacen, workspace } = almacenDePrueba();
  const p = proyecto(almacen, workspace);
  almacen.orden.guardarColumna(p.id, "todo", ["3", "1", "2"]);
  assert.deepEqual(almacen.orden.delProyecto(p.id), { todo: ["3", "1", "2"] });
  almacen.cerrar();
});

test("reordenar una columna REEMPLAZA su orden: lo que no se manda deja de tener posicion", () => {
  const { almacen, workspace } = almacenDePrueba();
  const p = proyecto(almacen, workspace);
  almacen.orden.guardarColumna(p.id, "todo", ["3", "1", "2"]);
  almacen.orden.guardarColumna(p.id, "todo", ["2", "3"]);
  assert.deepEqual(almacen.orden.delProyecto(p.id), { todo: ["2", "3"] });
  almacen.cerrar();
});

test("una tarjeta tiene UNA posicion: ordenarla en otra columna la saca de la vieja", () => {
  const { almacen, workspace } = almacenDePrueba();
  const p = proyecto(almacen, workspace);
  almacen.orden.guardarColumna(p.id, "todo", ["1", "2"]);
  almacen.orden.guardarColumna(p.id, "in_review", ["2"]);
  assert.deepEqual(almacen.orden.delProyecto(p.id), { todo: ["1"], in_review: ["2"] });
  almacen.cerrar();
});

test("el orden es por proyecto: el mismo item en otro proyecto es otra tarjeta", () => {
  const { almacen, workspace } = almacenDePrueba();
  const a = proyecto(almacen, workspace, "Alfa");
  const b = proyecto(almacen, workspace, "Beta");
  almacen.orden.guardarColumna(a.id, "todo", ["1", "2"]);
  almacen.orden.guardarColumna(b.id, "todo", ["2", "1"]);
  assert.deepEqual(almacen.orden.delProyecto(a.id), { todo: ["1", "2"] });
  assert.deepEqual(almacen.orden.delProyecto(b.id), { todo: ["2", "1"] });
  almacen.cerrar();
});

test("un id repetido o vacio se rechaza con causa, y no se escribe nada", () => {
  const { almacen, workspace } = almacenDePrueba();
  const p = proyecto(almacen, workspace);
  almacen.orden.guardarColumna(p.id, "todo", ["1"]);
  const e = capturar(() => almacen.orden.guardarColumna(p.id, "todo", ["2", "2"]));
  assert.match(String(e.message), /repetid/);
  assert.deepEqual(almacen.orden.delProyecto(p.id), { todo: ["1"] });
  almacen.cerrar();
});

test("el orden y los ajustes sobreviven a cerrar y reabrir la base", () => {
  const ruta = join(mkdtempSync(join(tmpdir(), "noxloop-orden-")), "almacen.sqlite");
  let almacen = abrirAlmacen({ ruta, redactor: redactorDePrueba });
  const w = almacen.workspaces.crear({ home: "/tmp/h" });
  const p = proyecto(almacen, w);
  almacen.orden.guardarColumna(p.id, "todo", ["b", "a"]);
  almacen.ajustes.guardar("runsSimultaneos", 5);
  almacen.cerrar();

  almacen = abrirAlmacen({ ruta, redactor: redactorDePrueba });
  assert.deepEqual(almacen.orden.delProyecto(p.id), { todo: ["b", "a"] });
  assert.equal(almacen.ajustes.leer("runsSimultaneos"), 5);
  almacen.cerrar();
});

test("ajustes: sin valor guardado se lee `undefined`; guardar dos veces se queda con el ultimo", () => {
  const { almacen } = almacenDePrueba();
  assert.equal(almacen.ajustes.leer("runsSimultaneos"), undefined);
  almacen.ajustes.guardar("runsSimultaneos", 2);
  almacen.ajustes.guardar("runsSimultaneos", 4);
  assert.equal(almacen.ajustes.leer("runsSimultaneos"), 4);
  almacen.cerrar();
});

test("borrar el proyecto se lleva su orden (no quedan filas huerfanas)", () => {
  const { almacen, workspace } = almacenDePrueba();
  const p = proyecto(almacen, workspace);
  almacen.orden.guardarColumna(p.id, "todo", ["1"]);
  almacen.base.escribir("DELETE FROM project WHERE id = ?", [p.id]);
  assert.equal(almacen.base.consultar("SELECT * FROM card_order").length, 0);
  almacen.cerrar();
});
