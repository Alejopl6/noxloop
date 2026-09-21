// `RepositorioDeConexiones`: la unica via por la que las conexiones tocan un
// almacen.
//
// POR QUE HAY UNA INTERFAZ Y UNA IMPLEMENTACION EN MEMORIA, Y NINGUN ESQUEMA.
// El almacen persistente lo construye otro paquete, en paralelo. Escribir aqui
// un esquema con sus tablas y su migracion es comprometer esa decision desde el
// sitio equivocado, y hay que rehacerlo entero cuando se tome. Lo que si se
// puede fijar ahora —y es lo que de verdad importa— son las operaciones: que se
// pregunta, que se devuelve y que no se devuelve nunca.
//
// TODO(persistencia): implementar `RepositorioDeConexiones` contra el almacen
// que decida el paquete de persistencia. Las pruebas de este paquete corren
// contra la version en memoria y valen igual para la persistente: no miran el
// almacenamiento, miran que el valor no aparezca y que la revocacion corte.
//
// LO QUE ESTA INTERFAZ NO TIENE, Y ES DELIBERADO: ninguna operacion que guarde
// o devuelva el valor de una credencial. El valor vive en el deposito de
// secretos; aqui vive el inventario, que es otra cosa.

import { congelar } from "./modelo.mjs";

/**
 * @typedef {object} RepositorioDeConexiones
 * @property {(conexion: any) => void} guardar
 * @property {(id: string) => any|null} porId
 * @property {(handle: string) => any|null} porHandle
 * @property {(projectId: string) => any[]} porProyecto
 * @property {(id: string) => void} borrar
 * @property {() => any} instantanea
 */

const copia = (o) => (o === null || o === undefined ? o : congelar(JSON.parse(JSON.stringify(o))));

/**
 * @returns {RepositorioDeConexiones}
 */
export function repositorioEnMemoria() {
  /** @type {Map<string, any>} */
  const conexiones = new Map();

  return {
    guardar(conexion) {
      conexiones.set(conexion.id, { ...conexion });
    },
    porId(id) {
      return copia(conexiones.get(id) ?? null);
    },
    porHandle(handle) {
      for (const c of conexiones.values()) if (c.handle === handle) return copia(c);
      return null;
    },
    porProyecto(projectId) {
      return [...conexiones.values()].filter((c) => c.project_id === projectId).map((c) => copia(c));
    },
    borrar(id) {
      conexiones.delete(id);
    },
    instantanea() {
      return congelar({ conexiones: [...conexiones.values()].map((c) => ({ ...c })) });
    },
  };
}
