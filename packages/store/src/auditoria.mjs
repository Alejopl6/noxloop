// `AuditEvent`: append-only con hash encadenado.
//
// DOS MECANISMOS CONTRA DOS ATACANTES DISTINTOS.
//
// El primero es la aplicacion misma, y son los disparadores del esquema: no hay
// UPDATE ni DELETE sobre esta tabla, ni por una ruta ni por una migracion
// distraida.
//
// El segundo es quien tiene el archivo. Contra ese los disparadores no hacen
// nada —se quitan con un `DROP TRIGGER`— y por eso cada fila lleva el hash de
// la anterior. Una fila alterada por fuera deja el encadenamiento sin cuadrar y
// `verificarCadena` dice cual. Sin esto, un evento `denegado` reescrito como
// `permitido` es indistinguible de uno que siempre fue `permitido`, y la
// auditoria deja de servir para lo unico que sirve: explicar despues que paso.
//
// POR QUE EL HASH INCLUYE EL ID. El encadenamiento por si solo detecta
// alteraciones y reordenamientos, pero no un BORRADO limpio del ultimo trozo ni
// un hueco en medio. Con el id dentro y la continuidad comprobada, borrar el
// evento incomodo deja rastro.
//
// POR QUE HAY UN GENESIS Y NO UN `hash_anterior` NULO. Con NULL, la primera
// fila no se puede verificar contra nada, y truncar el registro hasta dejar una
// sola fila daria una cadena "intacta" de un elemento.

import { createHash } from "node:crypto";

import { fallar } from "./errores.mjs";

/** El eslabon cero. Fijo, publico y sin significado: solo tiene que ser el mismo siempre. */
export const GENESIS = "0".repeat(64);

/**
 * El material firmado, en orden fijo y serializado como lista.
 *
 * POR QUE UNA LISTA JSON Y NO LOS CAMPOS CONCATENADOS CON UN SEPARADOR. Con un
 * separador, dos eventos distintos pueden producir el mismo material moviendo
 * el separador de un campo al siguiente: actor "a|b" con accion "c" firma igual
 * que actor "a" con accion "b|c". `JSON.stringify` escapa por su cuenta y no
 * deja esa frontera.
 *
 * @param {{id: number, instante: string, actor: string, accion: string, objeto_tipo: string, objeto_id: string, resultado: string, detalle: string, hash_anterior: string}} fila
 * @returns {string}
 */
export function hashDeEvento(fila) {
  const material = JSON.stringify([
    fila.id,
    fila.instante,
    fila.actor,
    fila.accion,
    fila.objeto_tipo,
    fila.objeto_id,
    fila.resultado,
    fila.detalle,
    fila.hash_anterior,
  ]);
  return createHash("sha256").update(material).digest("hex");
}

/**
 * @param {import("./sqlite.mjs").BaseSqlite} base
 * @param {((detalle: any) => any)|null} redactor
 */
export function repositorioDeAuditoria(base, redactor) {
  return {
    /**
     * Escribe un evento. No hay `editar` ni `borrar`, y no es un olvido: FR-049
     * dice que la aplicacion no expone ninguna ruta que edite o borre esta
     * tabla, y un metodo que existe acaba llamandose.
     *
     * @param {{actor: string, accion: string, objeto_tipo: string, objeto_id: string, resultado: string, detalle?: any, instante?: string}} evento
     */
    registrar(evento) {
      // La comprobacion va ANTES de tocar nada: el principio IX exige que la
      // redaccion sea previa a la escritura, asi que la ausencia de redactor
      // tiene que cortar antes de que exista una fila.
      if (typeof redactor !== "function") fallar("auditoria_sin_redactor");

      const detalle = JSON.stringify(redactor(evento.detalle ?? {}));
      const instante = evento.instante ?? new Date().toISOString();

      return base.enTransaccion(() => {
        const ultimo = base.consultarUno("SELECT id, hash FROM audit_event ORDER BY id DESC LIMIT 1");
        const fila = {
          id: ultimo ? Number(ultimo.id) + 1 : 1,
          instante,
          actor: evento.actor,
          accion: evento.accion,
          objeto_tipo: evento.objeto_tipo,
          objeto_id: evento.objeto_id,
          resultado: evento.resultado,
          detalle,
          hash_anterior: ultimo ? String(ultimo.hash) : GENESIS,
        };
        const hash = hashDeEvento(fila);
        base.escribir(
          "INSERT INTO audit_event (id, instante, actor, accion, objeto_tipo, objeto_id, resultado, detalle, " +
            "hash_anterior, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            fila.id,
            fila.instante,
            fila.actor,
            fila.accion,
            fila.objeto_tipo,
            fila.objeto_id,
            fila.resultado,
            fila.detalle,
            fila.hash_anterior,
            hash,
          ],
        );
        return Object.freeze({ ...fila, hash });
      });
    },

    /**
     * @param {{limite?: number, objeto_tipo?: string, objeto_id?: string}} [criterio]
     */
    eventos(criterio = {}) {
      const condiciones = [];
      const parametros = [];
      if (criterio.objeto_tipo) {
        condiciones.push("objeto_tipo = ?");
        parametros.push(criterio.objeto_tipo);
      }
      if (criterio.objeto_id) {
        condiciones.push("objeto_id = ?");
        parametros.push(criterio.objeto_id);
      }
      const donde = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
      parametros.push(criterio.limite ?? 200);
      return base
        .consultar(`SELECT * FROM audit_event ${donde} ORDER BY id DESC LIMIT ?`, parametros)
        .map((f) => Object.freeze({ ...f }));
    },

    /**
     * Recorre la cadena entera y devuelve el primer eslabon que no cuadra.
     *
     * Se recorre TODO y se para en el primero: un registro con dos
     * manipulaciones no es mas interesante que uno con una, y lo que el
     * operador necesita es el punto donde dejar de confiar.
     *
     * @returns {{intacta: boolean, roto: {id: number, motivo: string}|null, total: number}}
     */
    verificarCadena() {
      const filas = base.consultar("SELECT * FROM audit_event ORDER BY id ASC");
      let anterior = null;
      for (const fila of filas) {
        const id = Number(fila.id);
        const esperadoId = anterior ? Number(anterior.id) + 1 : 1;
        if (id !== esperadoId) {
          return {
            intacta: false,
            roto: { id, motivo: `hueco en la cadena: falta el evento ${esperadoId}, el siguiente que hay es el ${id}` },
            total: filas.length,
          };
        }
        const esperadoAnterior = anterior ? String(anterior.hash) : GENESIS;
        if (String(fila.hash_anterior) !== esperadoAnterior) {
          return {
            intacta: false,
            roto: { id, motivo: `el hash anterior del evento ${id} no es el del evento que lo precede` },
            total: filas.length,
          };
        }
        const recalculado = hashDeEvento({
          id,
          instante: String(fila.instante),
          actor: String(fila.actor),
          accion: String(fila.accion),
          objeto_tipo: String(fila.objeto_tipo),
          objeto_id: String(fila.objeto_id),
          resultado: String(fila.resultado),
          detalle: String(fila.detalle),
          hash_anterior: String(fila.hash_anterior),
        });
        if (recalculado !== String(fila.hash)) {
          return {
            intacta: false,
            roto: { id, motivo: `el hash del evento ${id} no corresponde a su contenido: la fila se altero` },
            total: filas.length,
          };
        }
        anterior = fila;
      }
      return { intacta: true, roto: null, total: filas.length };
    },
  };
}
