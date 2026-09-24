// Las migraciones del almacen: versionadas, en transaccion, idempotentes.
//
// EL FALLO QUE EVITA. Una migracion que se aplica dos veces y duplica algo no
// da un error: da una segunda fila de configuracion, un segundo indice con otro
// nombre o una tabla con el doble de columnas por defecto. El sintoma aparece
// semanas despues, en una consulta que devuelve el doble de filas, y para
// entonces nadie relaciona el numero raro con el arranque del servicio.
//
// La segunda prueba es la que de verdad cuesta: que pasa si el proceso muere
// entre dos sentencias de la MISMA migracion. Si la migracion no corre dentro
// de una transaccion, la base queda con media migracion aplicada y la fila de
// version sin escribir; al reabrir, el corredor la vuelve a intentar entera y
// revienta en el `CREATE TABLE` de la mitad que si se aplico. La base queda
// muerta y la unica salida que se le ocurre a cualquiera es borrarla — es
// decir, perder el almacen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { abrirBase } from "../src/sqlite.mjs";
import { MIGRACIONES, aplicarMigraciones, versionDeEsquema } from "../src/migraciones.mjs";
import { ErrorDeAlmacen } from "../src/errores.mjs";
import { capturar } from "./ayuda.mjs";

/** El retrato del esquema: lo que una segunda aplicacion no puede cambiar. */
function retrato(base) {
  return base
    .consultar(
      "SELECT type, name, COALESCE(sql, '') AS sql FROM sqlite_master " +
        "WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .map((f) => `${f.type} ${f.name} ${f.sql}`);
}

test("aplicar las migraciones dos veces deja exactamente el mismo esquema y las mismas filas de version", () => {
  const base = abrirBase(":memory:");
  const primera = aplicarMigraciones(base);
  const antes = retrato(base);
  const filasAntes = base.consultar("SELECT version, nombre, huella FROM esquema_migracion ORDER BY version");

  const segunda = aplicarMigraciones(base);
  const despues = retrato(base);
  const filasDespues = base.consultar("SELECT version, nombre, huella FROM esquema_migracion ORDER BY version");

  assert.deepEqual(despues, antes, "la segunda aplicacion cambio el esquema");
  assert.deepEqual(filasDespues, filasAntes, "la segunda aplicacion duplico filas de version");
  assert.deepEqual(
    primera.aplicadas,
    MIGRACIONES.map((m) => m.version),
  );
  assert.deepEqual(segunda.aplicadas, [], "la segunda aplicacion volvio a correr migraciones ya aplicadas");
  assert.equal(filasDespues.length, MIGRACIONES.length);
  base.cerrar();
});

test("la idempotencia sobrevive a cerrar y reabrir el archivo", () => {
  const dir = mkdtempSync(join(tmpdir(), "noxloop-almacen-"));
  const ruta = join(dir, "control.sqlite");
  try {
    const uno = abrirBase(ruta);
    aplicarMigraciones(uno);
    const antes = retrato(uno);
    uno.cerrar();

    const dos = abrirBase(ruta);
    const resultado = aplicarMigraciones(dos);
    assert.deepEqual(resultado.aplicadas, []);
    assert.deepEqual(retrato(dos), antes);
    assert.equal(versionDeEsquema(dos), MIGRACIONES.at(-1).version);
    dos.cerrar();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("una migracion que revienta a la mitad no deja NADA: ni la primera sentencia ni la fila de version", () => {
  const base = abrirBase(":memory:");
  const aMedias = [
    {
      version: 1,
      nombre: "a-medias",
      sql: `
        CREATE TABLE primera (a TEXT) STRICT;
        CREATE TABLE segunda (b TEXT) STRICT;
        ESTO NO ES SQL;
      `,
    },
  ];

  assert.throws(() => aplicarMigraciones(base, aMedias));

  const tablas = base.consultar("SELECT name FROM sqlite_master WHERE type = 'table'").map((f) => f.name);
  assert.ok(!tablas.includes("primera"), "la primera sentencia quedo aplicada: la migracion no corrio en transaccion");
  assert.ok(!tablas.includes("segunda"));
  assert.deepEqual(base.consultar("SELECT version FROM esquema_migracion"), []);

  // Y lo que de verdad importa: el corredor puede volver a intentarla entera.
  const arreglada = [{ version: 1, nombre: "a-medias", sql: "CREATE TABLE primera (a TEXT) STRICT;" }];
  assert.deepEqual(aplicarMigraciones(base, arreglada).aplicadas, [1]);
  base.cerrar();
});

test("una migracion ya aplicada cuyo SQL cambio se rechaza nombrando la version", () => {
  // EL FALLO QUE EVITA. Editar en sitio una migracion ya aplicada es gratis en
  // el editor y caro en produccion: la maquina del que la escribio tiene el
  // esquema nuevo, la del operador tiene el viejo, y las dos dicen "version 1".
  const base = abrirBase(":memory:");
  aplicarMigraciones(base, [{ version: 1, nombre: "inicial", sql: "CREATE TABLE t (a TEXT) STRICT;" }]);

  const error = capturar(() =>
    aplicarMigraciones(base, [{ version: 1, nombre: "inicial", sql: "CREATE TABLE t (a TEXT, b TEXT) STRICT;" }]),
  );
  assert.ok(error instanceof ErrorDeAlmacen);
  assert.equal(error.codigo, "migracion_alterada");
  assert.match(error.causa, /1/);
  assert.ok(error.accion.length > 0, "un rechazo sin accion deja al operador sin salida");
  base.cerrar();
});

test("reindentar una migracion no la marca como alterada: la guarda no grita sin motivo", () => {
  // Una guarda que salta por un cambio de espacios se acaba apagando, y con
  // ella se va la que detecta el cambio de verdad.
  const base = abrirBase(":memory:");
  aplicarMigraciones(base, [{ version: 1, nombre: "inicial", sql: "CREATE TABLE t (a TEXT) STRICT;" }]);
  const resultado = aplicarMigraciones(base, [
    { version: 1, nombre: "inicial", sql: "\n  CREATE TABLE t (a TEXT)   STRICT;\n" },
  ]);
  assert.deepEqual(resultado.aplicadas, []);
  base.cerrar();
});

test("las migraciones se aplican en orden de version, no en orden de declaracion", () => {
  const base = abrirBase(":memory:");
  const desordenadas = [
    { version: 2, nombre: "columna", sql: "ALTER TABLE t ADD COLUMN b TEXT;" },
    { version: 1, nombre: "tabla", sql: "CREATE TABLE t (a TEXT) STRICT;" },
  ];
  assert.deepEqual(aplicarMigraciones(base, desordenadas).aplicadas, [1, 2]);
  const columnas = base.consultar("SELECT name FROM pragma_table_info('t')").map((f) => f.name);
  assert.deepEqual(columnas, ["a", "b"]);
  base.cerrar();
});

test("cada migracion declarada tiene una version unica y creciente", () => {
  const versiones = MIGRACIONES.map((m) => m.version);
  assert.deepEqual(versiones, [...new Set(versiones)], "hay dos migraciones con la misma version");
  assert.deepEqual(versiones, [...versiones].sort((a, b) => a - b));
  for (const m of MIGRACIONES) {
    assert.equal(typeof m.nombre, "string");
    assert.ok(m.nombre.length > 0, `la migracion ${m.version} no tiene nombre`);
  }
});
