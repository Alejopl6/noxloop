// El orden a mano del board (spec 005, FR-005).
//
// EL GESTOR NO SE ENTERA, Y ES A PROPOSITO (principio VI). El operador ordena
// para decidir que va primero EN SU PANTALLA. Escribir ese orden en el gestor
// cambiaria la prioridad que ve todo su equipo porque alguien arrastro una
// tarjeta en su portatil, y con un gestor sin campo de orden
// obligaria a un `if` por proveedor. El orden es dato del servicio, por
// proyecto, en el almacen (`card_order`); esta ruta no carga el proveedor ni
// toca la cache del board, y su test cuenta cada llamada al gestor para
// probarlo.
//
// LA REGLA AL PINTAR. En cada columna van primero las tarjetas con posicion, por
// su posicion; despues las demas, en el orden en que el gestor las dio. Una
// tarjeta nueva aparece asi debajo de lo que el operador ya ordeno, que es
// donde la buscaria. Una posicion guardada de una tarjeta que desaparecio, o
// que cambio de columna, simplemente no casa con nada: se olvida sin error y
// sin borrarla al pintar — pintar no escribe (SC-007). La siguiente vez que se
// ordene esa columna se reemplaza entera y el resto se va con ella.

import { COLUMNAS } from "./board.mjs";
import { exigir, exigirProyecto } from "./comun.mjs";
import { ErrorDeServicio } from "./errores.mjs";

/** Cuantas tarjetas admite el orden de una columna: mas es un cuerpo que nadie arrastro a mano. */
const MAXIMO_POR_COLUMNA = 1000;

/**
 * Las tarjetas del board, ordenadas por lo que el operador dejo. PURA y
 * ESTABLE: lo que no tiene posicion conserva el orden en que llego.
 *
 * @template {{proyecto: {id: string}, ticket: {id: string}, columna: string}} T
 * @param {T[]} tarjetas
 * @param {Map<string, Record<string, string[]>>} ordenes `{columna: [itemId...]}` por proyecto
 * @returns {T[]}
 */
export function ordenarTarjetas(tarjetas, ordenes) {
  if (!ordenes.size) return tarjetas;
  /** @param {T} t */
  const posicion = (t) => {
    const lista = ordenes.get(String(t.proyecto.id))?.[t.columna];
    const i = lista ? lista.indexOf(String(t.ticket.id)) : -1;
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  // `sort` es estable desde ES2019: los empates (todo lo no ordenado, y
  // tarjetas de proyectos distintos con la misma posicion) conservan el orden
  // de entrada, que es el del gestor.
  return tarjetas
    .map((t, i) => ({ t, i, p: posicion(t) }))
    .sort((a, b) => (a.p === b.p ? a.i - b.i : a.p < b.p ? -1 : 1))
    .map((x) => x.t);
}

/**
 * Los ordenes guardados de los proyectos dados, para `ordenarTarjetas`.
 *
 * @param {any} dep
 * @param {string[]} proyectoIds
 */
export function ordenesDe(dep, proyectoIds) {
  /** @type {Map<string, Record<string, string[]>>} */
  const salida = new Map();
  for (const id of proyectoIds) {
    const orden = dep.almacen.orden.delProyecto(String(id));
    if (Object.keys(orden).length) salida.set(String(id), orden);
  }
  return salida;
}

/**
 * `PUT /v1/projects/:id/board/orden {columna, itemIds}`: la columna entera, de
 * arriba abajo. Reemplaza, no mezcla (ver `packages/store/src/orden.mjs`).
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function ordenDelBoard(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  const cuerpo = await p.cuerpo();
  exigir(cuerpo, ["columna", "itemIds"], "`itemIds` es la columna entera de arriba abajo, con los ids de ticket.");

  const columnas = COLUMNAS.map((c) => c.id);
  if (!columnas.includes(cuerpo.columna)) {
    throw new ErrorDeServicio("cuerpo_invalido", {
      detalle: `\`${String(cuerpo.columna)}\` no es una columna del board`,
      campos: ["columna"],
      opciones: columnas,
    });
  }
  const ids = cuerpo.itemIds;
  if (!Array.isArray(ids) || ids.length > MAXIMO_POR_COLUMNA || ids.some((x) => typeof x !== "string" || !x.trim())) {
    throw new ErrorDeServicio("cuerpo_invalido", {
      detalle: `\`itemIds\` tiene que ser una lista de ids de ticket (texto no vacio), como mucho ${MAXIMO_POR_COLUMNA}`,
      campos: ["itemIds"],
    });
  }
  const repetido = ids.find((x, i) => ids.indexOf(x) !== i);
  if (repetido !== undefined) {
    throw new ErrorDeServicio("cuerpo_invalido", {
      detalle: `el id \`${repetido}\` esta repetido en \`itemIds\`: una tarjeta tiene un solo sitio`,
      campos: ["itemIds"],
    });
  }

  p.dep.almacen.orden.guardarColumna(proyecto.id, cuerpo.columna, ids);
  // Las demas ventanas repintan con el orden nuevo. Sin invalidar la cache del
  // gestor: lo que cambio no viene de el.
  p.estado.bus?.emitir?.("board.invalidado", { projectId: proyecto.id }, { project_id: proyecto.id });
  return { cuerpo: { orden: p.dep.almacen.orden.delProyecto(proyecto.id) } };
}
