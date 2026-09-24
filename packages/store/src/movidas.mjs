// Lo que el operador decidio sobre una tarjeta «movida» (spec 005, US1 esc. 4, FR-004).
//
// QUIEN ESCRIBE AQUI. Solo el servicio (principio VIII): la interfaz pide
// `POST /v1/projects/:id/board/movidas/:itemId {decision}` y el servicio llama a
// `decidir`. El board LEE (`delProyecto`) y no escribe nunca (SC-007): por eso
// «olvidar» tiene sus propios metodos, que llama quien si escribe (cambiar las
// reglas del gestor olvida todas las del proyecto).
//
// EL GESTOR NO SE ENTERA. Ni seguir ni soltar escriben en Linear: la issue sigue
// donde el equipo la puso. Lo que cambia es que pinta ESTE board.

import { ENUMS } from "./esquema.mjs";
import { fallar } from "./errores.mjs";

/**
 * @typedef {{decision: "seguir"|"soltar", destino: string|null, decidida: string}} DecisionDeMovida
 */

/** @param {import("./sqlite.mjs").BaseSqlite} base */
export function repositorioDeMovidas(base) {
  return {
    /**
     * Guarda (o reemplaza) la decision sobre UN item de un proyecto: una
     * tarjeta tiene una sola decision vigente, la ultima.
     *
     * @param {string} projectId
     * @param {string} itemId
     * @param {DecisionDeMovida} d
     */
    decidir(projectId, itemId, d) {
      const id = String(itemId ?? "");
      const permitidos = ENUMS["movida_decision.decision"];
      if (!permitidos.includes(d?.decision)) {
        fallar("valor_fuera_del_enum", { tabla: "movida_decision", campo: "decision", valor: d?.decision, permitidos });
      }
      if (!id.trim()) {
        fallar("campo_obligatorio_ausente", { tabla: "movida_decision", campo: "item_id", pista: "Es el id del ticket en el gestor, el de la tarjeta." });
      }
      base.escribir(
        `INSERT INTO movida_decision (project_id, item_id, decision, destino, decidida) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (project_id, item_id) DO UPDATE SET
           decision = excluded.decision, destino = excluded.destino, decidida = excluded.decidida`,
        [projectId, id, d.decision, d.destino ?? null, String(d.decidida)],
      );
    },

    /**
     * Las decisiones de un proyecto, `itemId -> decision`.
     *
     * @param {string} projectId
     * @returns {Map<string, DecisionDeMovida>}
     */
    delProyecto(projectId) {
      const filas = base.consultar(
        "SELECT item_id, decision, destino, decidida FROM movida_decision WHERE project_id = ? ORDER BY item_id",
        [projectId],
      );
      return new Map(
        filas.map((f) => [
          String(f.item_id),
          { decision: f.decision, destino: f.destino == null ? null : String(f.destino), decidida: String(f.decidida) },
        ]),
      );
    },

    /** @param {string} projectId @param {string} itemId */
    olvidar(projectId, itemId) {
      base.escribir("DELETE FROM movida_decision WHERE project_id = ? AND item_id = ?", [projectId, String(itemId)]);
    },

    /** @param {string} projectId */
    olvidarDelProyecto(projectId) {
      base.escribir("DELETE FROM movida_decision WHERE project_id = ?", [projectId]);
    },
  };
}
