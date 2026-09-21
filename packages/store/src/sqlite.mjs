// La UNICA linea del proyecto que menciona `node:sqlite`.
//
// POR QUE UNA CAPA FINA Y NO `new DatabaseSync(...)` REPARTIDO. `node:sqlite`
// es una API experimental: puede cambiar de firma entre dos versiones menores
// de Node, y el proyecto prueba contra 22 y 24 a la vez. Con la construccion
// repartida por los repositorios, un cambio de firma es un recorrido por todo
// el paquete y una tarde de sustituciones a ojo. Aqui es un archivo. Hay una
// prueba que lo afirma (`test/advertencia-experimental.test.mjs`) y que cae en
// cuanto un segundo archivo importa el modulo.
//
// POR QUE `node:sqlite` Y NO UN PAQUETE DE NPM. La constitution prohibe
// dependencias en el camino critico, y un binding nativo ademas hay que
// compilarlo: el dia que el operador instala la aplicacion en una maquina sin
// toolchain, el almacen no abre y la ventana no carga.
//
// LA ADVERTENCIA EXPERIMENTAL. En Node 22 y 24, cargar este modulo emite
// `ExperimentalWarning: SQLite is an experimental feature...` por stderr. Ese
// stderr es el del sidecar —que el escritorio lee para saber si el servicio
// arranco— y el de CI. La salida facil (`--no-warnings`, `NODE_NO_WARNINGS`,
// `process.removeAllListeners("warning")`) apaga tambien las advertencias de
// deprecacion y la de una promesa rechazada sin manejar, que son exactamente
// las que hay que ver. Aqui se acota en las dos dimensiones: en el TIEMPO, el
// parche vive lo que dura la carga del modulo y se deshace en un `finally`; en
// el CONTENIDO, solo desaparece la advertencia cuyo tipo es
// `ExperimentalWarning` y cuyo texto nombra SQLite, y cualquier otra que caiga
// en esa ventana se reenvia intacta al `emitWarning` de verdad.

/**
 * @param {any} aviso  el primer argumento de `process.emitWarning`
 * @param {any} [opciones]  el segundo: o el tipo como texto, o `{ type }`
 * @returns {boolean}
 */
export function esAdvertenciaExperimentalDeSqlite(aviso, opciones) {
  const tipo =
    typeof opciones === "string"
      ? opciones
      : opciones && typeof opciones === "object" && typeof opciones.type === "string"
        ? opciones.type
        : aviso instanceof Error
          ? aviso.name
          : undefined;
  if (tipo !== "ExperimentalWarning") return false;
  const texto = aviso instanceof Error ? aviso.message : typeof aviso === "string" ? aviso : "";
  // El texto exacto de Node es "SQLite is an experimental feature and might
  // change at any time". Se exige que la advertencia hable de SQLite COMO
  // FUNCION EXPERIMENTAL y no que solo mencione la palabra: una advertencia
  // futura que diga "SQLite connection pooling is an experimental feature" es
  // otra cosa y tiene que verse.
  return /\bSQLite is an experimental feature\b/i.test(texto);
}

/**
 * Corre `fn` con la advertencia de SQLite silenciada y nada mas.
 *
 * Es `async` a proposito: la advertencia se emite cuando Node EVALUA el modulo,
 * que ocurre en una microtarea posterior al `import()`. Con un `finally`
 * sincrono el parche se deshace antes de que la advertencia llegue, y el
 * silenciado no sirve de nada — parece que funciona en local y sigue
 * apareciendo en CI.
 *
 * @template T
 * @param {() => T|Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function sinLaAdvertenciaDeSqlite(fn) {
  const original = process.emitWarning;
  process.emitWarning = function (aviso, ...resto) {
    if (esAdvertenciaExperimentalDeSqlite(aviso, resto[0])) return undefined;
    return original.apply(this, /** @type {any} */ ([aviso, ...resto]));
  };
  try {
    return await fn();
  } finally {
    process.emitWarning = original;
  }
}

const { DatabaseSync } = await sinLaAdvertenciaDeSqlite(() => import("node:sqlite"));

/**
 * @typedef {object} BaseSqlite
 * @property {(sql: string) => void} ejecutar
 * @property {(sql: string, parametros?: any[]) => any[]} consultar
 * @property {(sql: string, parametros?: any[]) => any} consultarUno
 * @property {(sql: string, parametros?: any[]) => {cambios: number, ultimoId: number}} escribir
 * @property {(sql: string, parametros?: any[]) => string[]} plan
 * @property {<T>(fn: () => T) => T} enTransaccion
 * @property {() => boolean} enTransaccionAhora
 * @property {() => void} cerrar
 */

/**
 * Abre la base y deja los pragmas puestos.
 *
 * `foreign_keys` viene APAGADO por defecto en SQLite, que es la trampa clasica:
 * las claves foraneas estan declaradas en el esquema, parecen puestas, y no se
 * comprueban. Un snapshot con `project_id` de un proyecto borrado no da error;
 * da una fila que ninguna consulta encuentra y que nadie limpia nunca.
 *
 * @param {string} ruta  archivo, o `:memory:` para las pruebas
 * @returns {BaseSqlite}
 */
export function abrirBase(ruta) {
  const base = new DatabaseSync(ruta);
  base.exec("PRAGMA foreign_keys = ON");
  // Los dos escritores que el principio VIII prohibe no se dan en el mismo
  // proceso pero si entre el sidecar y una sesion de CLI sobre el mismo home.
  // WAL deja que los lectores no bloqueen, y `busy_timeout` convierte un
  // `SQLITE_BUSY` inmediato —que el operador ve como "la ventana no carga"— en
  // una espera corta.
  if (ruta !== ":memory:") base.exec("PRAGMA journal_mode = WAL");
  base.exec("PRAGMA busy_timeout = 5000");

  let profundidad = 0;

  /** @type {BaseSqlite} */
  const capa = {
    ejecutar(sql) {
      base.exec(sql);
    },
    consultar(sql, parametros = []) {
      return base.prepare(sql).all(...parametros);
    },
    consultarUno(sql, parametros = []) {
      return base.prepare(sql).get(...parametros) ?? null;
    },
    escribir(sql, parametros = []) {
      const r = base.prepare(sql).run(...parametros);
      return { cambios: Number(r.changes), ultimoId: Number(r.lastInsertRowid) };
    },
    plan(sql, parametros = []) {
      return base
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...parametros)
        .map((f) => String(/** @type {any} */ (f).detail));
    },
    enTransaccionAhora() {
      return profundidad > 0;
    },

    /**
     * `BEGIN IMMEDIATE` y no `BEGIN`: una transaccion diferida toma el bloqueo
     * de escritura en la PRIMERA escritura, asi que dos procesos pueden leer,
     * decidir y chocar al escribir. Con `IMMEDIATE` el segundo espera desde el
     * principio, que es lo que hace que la guarda de transicion valga algo.
     *
     * El anidamiento va por `SAVEPOINT`: SQLite no tiene transacciones
     * anidadas, y un `BEGIN` dentro de otro es un error que aparece solo
     * cuando dos repositorios se llaman entre si.
     */
    enTransaccion(fn) {
      const punto = `punto_${profundidad}`;
      if (profundidad === 0) base.exec("BEGIN IMMEDIATE");
      else base.exec(`SAVEPOINT ${punto}`);
      profundidad++;
      try {
        const resultado = fn();
        profundidad--;
        if (profundidad === 0) base.exec("COMMIT");
        else base.exec(`RELEASE ${punto}`);
        return resultado;
      } catch (e) {
        profundidad--;
        if (profundidad === 0) base.exec("ROLLBACK");
        else {
          base.exec(`ROLLBACK TO ${punto}`);
          base.exec(`RELEASE ${punto}`);
        }
        throw e;
      }
    },
    cerrar() {
      base.close();
    },
  };
  return capa;
}
