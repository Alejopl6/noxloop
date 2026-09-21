// `RepositorioDeFlota`: la unica via por la que el modelo de flota toca un
// almacen.
//
// POR QUE HAY UNA INTERFAZ Y UNA IMPLEMENTACION EN MEMORIA, Y NINGUN ESQUEMA.
// Por lo mismo que en la boveda y en el nucleo: el almacen consultable lo
// construye otro paquete, y escribir aqui tablas, indices y migraciones es
// comprometer esa decision desde el sitio equivocado. Lo que si se puede fijar
// ahora, y es lo que importa, son las operaciones: que se pregunta, que se
// devuelve y que garantias tiene.
//
// TODO(persistencia): implementar `RepositorioDeFlota` contra el almacen
// consultable cuando exista. Las pruebas de este paquete corren contra la
// version en memoria y valen igual para la persistente: no miran el
// almacenamiento, miran que la regla del revisor se aplique al guardar.

/**
 * @typedef {object} RepositorioDeFlota
 * @property {(a: any) => void} guardarAgente
 * @property {(project_id: string|null) => any[]} agentes
 * @property {(id: string) => any|null} agente
 * @property {(id: string) => void} borrarAgente
 */

/** Lo que sale del repositorio no se muta por la espalda. */
function congelar(/** @type {any} */ valor) {
  if (valor === null || typeof valor !== "object") return valor;
  for (const v of Object.values(valor)) congelar(v);
  return Object.freeze(valor);
}

const copia = (/** @type {any} */ o) => (o === null || o === undefined ? o : congelar(JSON.parse(JSON.stringify(o))));

/** @returns {RepositorioDeFlota} */
export function repositorioDeFlotaEnMemoria() {
  /** @type {Map<string, any>} */
  const porId = new Map();

  return {
    guardarAgente(a) {
      porId.set(a.id, { ...a });
    },
    agentes(project_id) {
      const clave = project_id ?? null;
      return [...porId.values()].filter((a) => (a.project_id ?? null) === clave).map((a) => copia(a));
    },
    agente(id) {
      return copia(porId.get(id) ?? null);
    },
    borrarAgente(id) {
      porId.delete(id);
    },
  };
}
