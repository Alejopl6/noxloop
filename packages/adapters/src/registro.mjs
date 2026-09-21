// El registro de adaptadores: de un `Agent.runtime` al adaptador que lo corre.
//
// POR QUE ES UN REGISTRO Y NO UN `switch`. Por el mismo motivo que los
// proveedores se cargan por configuracion: el dia que hay un tercer runtime,
// un `switch` obliga a tocar el codigo que lo consume, y de ahi a ramificar el
// motor hay un paso. Aqui la lista se arma en el cableado y todo lo demas
// pregunta por `id`.
//
// LO QUE NO HACE: no carga nada por su cuenta, no lee configuracion, no toca el
// disco. Recibe adaptadores ya construidos, porque construirlos es donde se
// deciden el binario, los hooks y el home — cosas que este paquete no sabe.

import { validarAdaptador } from "./contrato.mjs";

/**
 * @param {import("./contrato.mjs").AgentAdapter[]} adaptadores
 */
export function registroDeAdaptadores(adaptadores = []) {
  /** @type {Map<string, import("./contrato.mjs").AgentAdapter>} */
  const porId = new Map();

  for (const a of adaptadores) {
    const v = validarAdaptador(a);
    if (!v.ok) {
      // Se valida AL REGISTRAR y no al invocar, por lo mismo que el motor valida
      // el proveedor al cargarlo: una capacidad declarada sin su comportamiento
      // no falla al arrancar, falla a mitad de un recorrido — y ahi ya se pago
      // el modelo.
      throw new Error(
        `el adaptador ${a?.id || "(sin id)"} no cumple el contrato:\n  - ${v.problems.join("\n  - ")}`,
      );
    }
    if (porId.has(a.id)) {
      throw new Error(
        `hay dos adaptadores registrados con el id "${a.id}". El id es lo que guarda \`Agent.runtime\`: con dos, ` +
          "cual corre una fase dependeria del orden de registro, y la regla de revisor-distinto-del-implementador " +
          "compararia nombres iguales sobre runtimes distintos.",
      );
    }
    porId.set(a.id, a);
  }

  return {
    /** @param {string} id */
    tiene(id) {
      return porId.has(id);
    },
    /** @param {string} id */
    obtener(id) {
      return porId.get(id) ?? null;
    },
    /** @param {string} id */
    capacidades(id) {
      return porId.get(id)?.capabilities() ?? null;
    },
    ids() {
      return [...porId.keys()];
    },
    todos() {
      return [...porId.values()];
    },
  };
}
