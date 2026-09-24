// La cola global de runs (spec 005, FR-006): quien corre, quien espera y en que
// puesto, y reordenar lo que espera.
//
// LA COLA VIVE EN EL LANZADOR, EN MEMORIA (ver su cabecera): estas rutas solo
// la leen y la reordenan. Lo que agregan es lo que la pantalla necesita para
// no enseñar ids pelados: el nombre del proyecto y, si el run ya tiene
// archivo, el titulo y la clave del ticket. Solo leen.

import { leerRun } from "./lanzador.mjs";
import { ErrorDeServicio } from "./errores.mjs";

/**
 * @param {import("./rutas.mjs").Peticion} p
 * @param {{limite: number, corriendo: any[], esperando: any[]}} cola
 */
function conNombres(p, cola) {
  /** @type {Map<string, string|null>} */
  const nombres = new Map();
  const nombre = (/** @type {string} */ id) => {
    if (!nombres.has(id)) nombres.set(id, p.dep.almacen.proyectos.porId(id)?.nombre ?? null);
    return nombres.get(id) ?? null;
  };
  const mas = (/** @type {any} */ x) => {
    const item = leerRun(p.estado.home, x.itemId)?.item ?? null;
    return { ...x, proyecto: nombre(x.projectId), titulo: item?.title ?? null, key: item?.key ?? null };
  };
  return { limite: cola.limite, corriendo: cola.corriendo.map(mas), esperando: cola.esperando.map(mas) };
}

/**
 * `GET /v1/queue` y `PUT /v1/queue {orden: [itemId...]}`.
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function cola(p) {
  const lanzador = p.estado.motor?.lanzador;
  if (!lanzador) {
    throw new ErrorDeServicio("pieza_ausente", {
      pieza: "el lanzador del motor",
      porque: "este servicio se monto sin lanzador (`crearServidor` sin `motor`), asi que no tiene cola.",
      comoConseguirlo: "Arranca el servicio con `arrancar()`, que monta el lanzador sobre el mismo home.",
    });
  }

  if (p.metodo === "PUT") {
    const cuerpo = await p.cuerpo();
    const orden = cuerpo?.orden;
    if (!Array.isArray(orden) || orden.some((x) => typeof x !== "string" || !x.trim())) {
      throw new ErrorDeServicio("cuerpo_invalido", {
        detalle:
          "`orden` tiene que ser una lista de `itemId` de los runs que esperan: los nombrados van primero, en ese " +
          "orden, y los demas conservan el suyo detras",
        campos: ["orden"],
      });
    }
    // `reordenar` avisa (`run.cambio`/`board.invalidado`) de cada puesto que cambio.
    return { cuerpo: conNombres(p, lanzador.reordenar(orden)) };
  }
  return { cuerpo: conNombres(p, lanzador.cola()) };
}
