// La bitacora: solo crece, y una alteracion externa se nota.
//
// EL FALLO QUE EVITA. Una auditoria editable no sirve para lo unico para lo que
// existe, que es explicar despues que paso. Si el mismo proceso que usa las
// credenciales puede reescribir la linea que dice que las uso, la bitacora pasa
// a ser la lista de las veces que alguien decidio dejar constancia.
//
// POR QUE HASH ENCADENADO Y NO "SOLO NO BORRAR". El almacen es un archivo, y un
// archivo se edita con un editor de texto sin pasar por este modulo. La cadena
// no impide la edicion —nada la impide— pero hace que se vea: cambiar un evento
// obliga a recalcular todos los siguientes, y quien tenga acceso a hacerlo ya
// no es el vector que esto cubre. Sin cadena, la alteracion es invisible.
//
// POR QUE NO HAY NI UNA FUNCION QUE EDITE. No es disciplina: es que el modulo no
// exporta ninguna, y la lista de eventos vive en un cierre. Un `editar` tendria
// que escribirse a proposito y aparecer en el diff.

import { createHash } from "node:crypto";

/** Serializacion estable: dos objetos con las mismas claves en otro orden dan el mismo hash. */
function canonico(valor) {
  if (valor === null || typeof valor !== "object") return JSON.stringify(valor) ?? "null";
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`;
  const claves = Object.keys(valor).sort();
  return `{${claves.map((k) => `${JSON.stringify(k)}:${canonico(valor[k])}`).join(",")}}`;
}

function hashDe(evento) {
  const { hash: _ignorado, ...resto } = evento;
  return createHash("sha256").update(canonico(resto)).digest("hex");
}

function congelar(valor) {
  if (valor === null || typeof valor !== "object") return valor;
  for (const v of Object.values(valor)) congelar(v);
  return Object.freeze(valor);
}

/**
 * @param {{ eventos?: any[] }} [inicial] eventos ya escritos, para poder verificarlos
 * @returns {{ registrar: (datos: any) => any, listar: () => any[], verificar: () => { ok: boolean, desde: number|null } }}
 */
export function crearAuditoria(inicial = {}) {
  /** @type {any[]} */
  const eventos = (inicial.eventos ?? []).map((e) => ({ ...e }));

  return {
    /**
     * Escribe un evento. Es parte de la operacion que lo produce, no un reporte
     * posterior: `recuperar` no devuelve el valor antes de que esto haya
     * corrido.
     */
    registrar(datos) {
      const anterior = eventos.at(-1) ?? null;
      const evento = {
        seq: eventos.length + 1,
        ts: new Date().toISOString(),
        ...datos,
        hashPrevio: anterior ? anterior.hash : null,
      };
      evento.hash = hashDe(evento);
      eventos.push(evento);
      return congelar(JSON.parse(JSON.stringify(evento)));
    },

    /** Copias congeladas: quedarse con la referencia y cambiarla despues es la via mas corta a una bitacora falsa. */
    listar() {
      return eventos.map((e) => congelar(JSON.parse(JSON.stringify(e))));
    },

    /**
     * @returns {{ ok: boolean, desde: number|null }} `desde` es el numero del
     * primer evento que no cuadra, que es por donde hay que empezar a mirar.
     */
    verificar() {
      let previo = null;
      for (const [i, evento] of eventos.entries()) {
        const esperado = previo ? previo.hash : null;
        if (evento.seq !== i + 1 || evento.hashPrevio !== esperado || evento.hash !== hashDe(evento)) {
          return { ok: false, desde: evento.seq ?? i + 1 };
        }
        previo = evento;
      }
      return { ok: true, desde: null };
    },
  };
}
