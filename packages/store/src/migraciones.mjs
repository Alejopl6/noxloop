// El corredor de migraciones: versionadas, en transaccion, idempotentes.
//
// QUE PASA SI EL PROCESO MUERE ENTRE DOS SENTENCIAS DE LA MISMA MIGRACION. Es
// la pregunta que decide el diseno entero, y la respuesta es que no hay un
// "entre". Cada migracion corre dentro de `BEGIN IMMEDIATE`, y su fila de
// version se escribe DENTRO de la misma transaccion: o commitean las dos cosas
// o no commitea ninguna. SQLite hace el DDL transaccional —a diferencia de
// otros motores— asi que un `CREATE TABLE` a medias no existe.
//
// Sin eso, el fallo es feo y tardio: la base queda con la primera tabla creada
// y sin fila de version; al reabrir, el corredor vuelve a intentar la migracion
// ENTERA y revienta en el `CREATE TABLE` de la mitad que si se aplico. La base
// no abre, el mensaje dice "table already exists" y la unica salida que se le
// ocurre a cualquiera es borrar el archivo — es decir, perder el almacen.
//
// LA HUELLA. Cada version guarda el hash de su SQL. Editar en sitio una
// migracion ya aplicada es gratis en el editor: la maquina de quien la edito
// tiene el esquema nuevo, la del operador tiene el viejo, y las dos dicen
// "version 1". Con la huella, la segunda lo dice en voz alta al arrancar en vez
// de fallar tres consultas despues por una columna que no existe.

import { createHash } from "node:crypto";

import { MIGRACIONES } from "./esquema.mjs";
import { fallar } from "./errores.mjs";

export { MIGRACIONES };

const TABLA_DE_CONTROL = `
CREATE TABLE IF NOT EXISTS esquema_migracion (
  version  INTEGER PRIMARY KEY,
  nombre   TEXT NOT NULL,
  huella   TEXT NOT NULL,
  aplicada TEXT NOT NULL
) STRICT
`;

/** @param {string} sql @returns {string} */
function huellaDe(sql) {
  // Se normalizan los espacios a proposito: reindentar el SQL no es cambiarlo,
  // y una huella que cambia con la indentacion convierte la guarda en ruido —
  // y una guarda que grita sin motivo se acaba apagando.
  return createHash("sha256").update(sql.replace(/\s+/g, " ").trim()).digest("hex");
}

/**
 * @param {import("./sqlite.mjs").BaseSqlite} base
 * @returns {number} la version del esquema aplicada, 0 si no hay ninguna
 */
export function versionDeEsquema(base) {
  base.ejecutar(TABLA_DE_CONTROL);
  const fila = base.consultarUno("SELECT MAX(version) AS version FROM esquema_migracion");
  return fila && fila.version !== null ? Number(fila.version) : 0;
}

/**
 * @param {import("./sqlite.mjs").BaseSqlite} base
 * @param {ReadonlyArray<{version: number, nombre: string, sql: string}>} [migraciones]
 * @returns {{aplicadas: number[], version: number}}
 */
export function aplicarMigraciones(base, migraciones = MIGRACIONES) {
  base.ejecutar(TABLA_DE_CONTROL);

  /** @type {Map<number, any>} */
  const yaAplicadas = new Map(
    base.consultar("SELECT version, nombre, huella FROM esquema_migracion").map((f) => [Number(f.version), f]),
  );

  const aplicadas = [];
  // Por version y no por orden de declaracion: el orden del array es de quien
  // edita el archivo, y dos ramas que agregan una migracion cada una lo dejan
  // como quede el merge.
  for (const migracion of [...migraciones].sort((a, b) => a.version - b.version)) {
    const huella = huellaDe(migracion.sql);
    const previa = yaAplicadas.get(migracion.version);

    if (previa) {
      if (previa.huella !== huella) {
        fallar("migracion_alterada", { version: migracion.version, nombre: migracion.nombre });
      }
      continue;
    }

    base.enTransaccion(() => {
      base.ejecutar(migracion.sql);
      base.escribir("INSERT INTO esquema_migracion (version, nombre, huella, aplicada) VALUES (?, ?, ?, ?)", [
        migracion.version,
        migracion.nombre,
        huella,
        new Date().toISOString(),
      ]);
    });
    aplicadas.push(migracion.version);
  }

  return { aplicadas, version: versionDeEsquema(base) };
}
