// El orden a mano del board y los ajustes del servicio (spec 005, FR-005..006).
//
// QUIEN ESCRIBE AQUI. Solo el servicio (principio VIII): la interfaz pide
// `PUT /v1/projects/:id/board/orden` y el servicio llama a `guardarColumna`.
//
// POR QUE GUARDAR UNA COLUMNA ES REEMPLAZARLA ENTERA. Lo que el operador ve es
// una lista de arriba abajo, y lo que manda al soltar una tarjeta es esa lista.
// Un "mueve X a la posicion 2" depende de que el servidor y la pantalla tengan
// la misma lista debajo, y con dos ventanas abiertas no la tienen: el
// resultado seria un orden que ninguna de las dos pinto. Reemplazar deja
// exactamente lo que la ultima ventana vio.

import { fallar } from "./errores.mjs";

/** @param {import("./sqlite.mjs").BaseSqlite} base */
export function repositorioDeOrden(base) {
  return {
    /**
     * El orden de UNA columna de un proyecto, de arriba abajo. Las tarjetas
     * listadas salen de cualquier otra columna en la que tuvieran posicion
     * (una tarjeta tiene una sola); las que estaban en esta columna y no se
     * listan dejan de tener posicion.
     *
     * @param {string} projectId
     * @param {string} columna
     * @param {string[]} itemIds
     */
    guardarColumna(projectId, columna, itemIds) {
      const ids = itemIds.map((x) => String(x ?? ""));
      if (ids.some((x) => x.trim() === "")) fallar("orden_invalido", { columna, detalle: "hay un id vacio" });
      const repetido = ids.find((x, i) => ids.indexOf(x) !== i);
      if (repetido !== undefined) {
        fallar("orden_invalido", { columna, detalle: `el id \`${repetido}\` esta repetido` });
      }
      // En transaccion: un orden a medias (borrado el viejo, sin escribir el
      // nuevo) pintaria la columna en el orden del gestor como si nadie la
      // hubiera tocado.
      base.enTransaccion(() => {
        base.escribir("DELETE FROM card_order WHERE project_id = ? AND columna = ?", [projectId, columna]);
        ids.forEach((id, posicion) => {
          base.escribir(
            `INSERT INTO card_order (project_id, item_id, columna, posicion) VALUES (?, ?, ?, ?)
             ON CONFLICT (project_id, item_id) DO UPDATE SET columna = excluded.columna, posicion = excluded.posicion`,
            [projectId, id, columna, posicion],
          );
        });
      });
    },

    /**
     * `{columna: [itemId...]}` de un proyecto, cada lista de arriba abajo.
     *
     * @param {string} projectId
     * @returns {Record<string, string[]>}
     */
    delProyecto(projectId) {
      /** @type {Record<string, string[]>} */
      const salida = {};
      const filas = base.consultar(
        "SELECT item_id, columna FROM card_order WHERE project_id = ? ORDER BY columna, posicion",
        [projectId],
      );
      for (const f of filas) (salida[f.columna] ??= []).push(String(f.item_id));
      return salida;
    },
  };
}

/** @param {import("./sqlite.mjs").BaseSqlite} base */
export function repositorioDeAjustes(base) {
  return {
    /**
     * El valor guardado, o `undefined` si nunca se guardo. `undefined` y no un
     * valor por defecto: el defecto es de quien lo usa (el servicio sabe que
     * el limite por defecto es 3; el almacen no tiene por que).
     *
     * @param {string} clave
     */
    leer(clave) {
      const fila = base.consultarUno("SELECT valor FROM service_setting WHERE clave = ?", [clave]);
      return fila ? JSON.parse(String(fila.valor)) : undefined;
    },

    /** @param {string} clave @param {any} valor */
    guardar(clave, valor) {
      base.escribir(
        "INSERT INTO service_setting (clave, valor) VALUES (?, ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor",
        [clave, JSON.stringify(valor)],
      );
    },
  };
}
