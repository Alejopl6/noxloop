// El repositorio de las tareas propias: el gestor local (spec 003, FR-030).
//
// QUIEN ESCRIBE AQUI. Solo el servicio de control (principio VIII). El
// proveedor `providers/local` NO abre esta base: recibe una interfaz inyectada
// cuando corre dentro del servicio, y habla por HTTP con el servicio cuando
// corre dentro del motor. Si el motor abriera la base por su cuenta habria dos
// escritores del mismo almacen con dos pids, y la guarda de transicion de uno
// no veria lo que hizo el otro.
//
// POR QUE CADA ESCRITURA MAPEA CAMPO POR CAMPO. Lo mismo que el resto de los
// repositorios: `actualizar({...cuerpoDeLaPeticion})` no puede cambiar la clave
// ni el proyecto de una tarea solo porque el cuerpo los traia.

import { randomUUID } from "node:crypto";

import { ENUMS } from "./esquema.mjs";
import { fallar } from "./errores.mjs";

/** Los campos que `actualizar` acepta. La clave, el numero y el proyecto no estan: no se editan. */
const EDITABLES = Object.freeze(["repo", "titulo", "plan", "criterios", "prioridad", "etiquetas", "ejecutor", "termino", "estado"]);

/** Los campos JSON, que salen como JSON y no como texto. */
const JSON_DE_LA_TAREA = ["criterios", "etiquetas", "ejecutor"];

/** El prefijo cuando el nombre no tiene ninguna letra latina de la que sacarlo. */
const PREFIJO_POR_DEFECTO = "TSK";

/**
 * El prefijo de las claves de un proyecto, derivado de su nombre.
 *
 * Varias palabras: sus iniciales (`Mi App Nueva` -> `MAN`), hasta cuatro. Una
 * sola: sus tres primeras letras (`Payments` -> `PAY`). Es lo que hace un
 * operador a mano, y el referente (Nodal) lo hace igual. Nunca vacio: un nombre
 * sin letras latinas da `TSK` en vez de una clave `-12` que no se puede citar.
 *
 * @param {string} nombre
 */
export function prefijoDe(nombre) {
  const palabras = String(nombre ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((p) => /^[A-Z]/.test(p));
  if (palabras.length === 0) return PREFIJO_POR_DEFECTO;
  if (palabras.length === 1) return palabras[0].slice(0, 3);
  return palabras
    .slice(0, 4)
    .map((p) => p[0])
    .join("");
}

/** @param {any} fila */
function deFila(fila) {
  if (!fila) return null;
  const salida = { ...fila };
  for (const campo of JSON_DE_LA_TAREA) {
    if (typeof salida[campo] === "string") {
      try {
        salida[campo] = JSON.parse(salida[campo]);
      } catch {
        // Una columna con JSON roto no tumba la lectura: el CHECK de la base lo
        // impide al escribir, asi que esto solo pasa si alguien la edito a mano.
      }
    }
  }
  return Object.freeze(salida);
}

/**
 * @param {string} campo
 * @param {any} valor
 */
function exigirEnum(campo, valor) {
  const permitidos = ENUMS[`local_task.${campo}`];
  if (!permitidos.includes(valor)) fallar("valor_fuera_del_enum", { tabla: "local_task", campo, valor, permitidos });
  return valor;
}

/** @param {any} prefijo */
function exigirPrefijo(prefijo) {
  if (typeof prefijo !== "string" || !/^[A-Z][A-Z0-9]{0,9}$/.test(prefijo)) {
    fallar("campo_obligatorio_ausente", {
      tabla: "local_task_sequence",
      campo: "prefijo",
      pista:
        "El prefijo de las claves es de 1 a 10 mayusculas o digitos y empieza por letra (`PAY`, `CORE2`): viaja en " +
        "nombres de rama y en mensajes de commit, donde un espacio o una barra rompen algo.",
    });
  }
  return prefijo;
}

/** @param {import("./sqlite.mjs").BaseSqlite} base */
export function repositorioDeTareas(base) {
  const porId = (/** @type {string} */ id) => deFila(base.consultarUno("SELECT * FROM local_task WHERE id = ?", [id]));

  return {
    prefijoDe,

    /**
     * Crea una tarea y le da la siguiente clave del proyecto, en UNA
     * transaccion: dos ventanas creando a la vez no pueden sacar el mismo
     * numero.
     *
     * @param {{project_id: string, titulo: string, repo?: string|null, plan?: string, criterios?: string[],
     *   prioridad?: number|null, etiquetas?: string[], ejecutor?: {runtime: string, agente?: string|null}|null,
     *   termino?: string, estado?: string, prefijo?: string, ahora?: number|string, id?: string}} datos
     */
    crear(datos) {
      const proyecto = base.consultarUno("SELECT id, nombre FROM project WHERE id = ?", [datos.project_id]);
      if (!proyecto) fallar("proyecto_desconocido", { id: datos.project_id });
      if (typeof datos.titulo !== "string" || !datos.titulo.trim()) {
        fallar("campo_obligatorio_ausente", { tabla: "local_task", campo: "titulo", pista: "Una tarea sin titulo no se puede ver en el board." });
      }
      const termino = exigirEnum("termino", datos.termino ?? "pr");
      const estado = exigirEnum("estado", datos.estado ?? "todo");
      const prefijoPedido = datos.prefijo === undefined || datos.prefijo === null ? null : exigirPrefijo(datos.prefijo);
      const ahora = datos.ahora ? new Date(datos.ahora).toISOString() : new Date().toISOString();

      return base.enTransaccion(() => {
        const secuencia = base.consultarUno("SELECT * FROM local_task_sequence WHERE project_id = ?", [proyecto.id]);
        if (!secuencia) {
          base.escribir("INSERT INTO local_task_sequence (project_id, prefijo, ultimo) VALUES (?, ?, 0)", [
            proyecto.id,
            prefijoPedido ?? prefijoDe(String(proyecto.nombre)),
          ]);
        } else if (prefijoPedido && prefijoPedido !== secuencia.prefijo) {
          base.escribir("UPDATE local_task_sequence SET prefijo = ? WHERE project_id = ?", [prefijoPedido, proyecto.id]);
        }
        base.escribir("UPDATE local_task_sequence SET ultimo = ultimo + 1 WHERE project_id = ?", [proyecto.id]);
        const { prefijo, ultimo } = base.consultarUno("SELECT prefijo, ultimo FROM local_task_sequence WHERE project_id = ?", [
          proyecto.id,
        ]);

        const id = datos.id ?? randomUUID();
        base.escribir(
          "INSERT INTO local_task (id, project_id, repo, numero, clave, titulo, plan, criterios, prioridad, etiquetas, " +
            "ejecutor, termino, estado, creado, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            id,
            proyecto.id,
            datos.repo ?? null,
            Number(ultimo),
            `${prefijo}-${ultimo}`,
            datos.titulo.trim(),
            String(datos.plan ?? ""),
            JSON.stringify(datos.criterios ?? []),
            datos.prioridad ?? null,
            JSON.stringify(datos.etiquetas ?? []),
            datos.ejecutor ? JSON.stringify(datos.ejecutor) : null,
            termino,
            estado,
            ahora,
            ahora,
          ],
        );
        return porId(id);
      });
    },

    porId,

    /** El prefijo vigente del proyecto, o el que tendria si todavia no tiene tareas. */
    prefijoDelProyecto(/** @type {string} */ projectId) {
      const s = base.consultarUno("SELECT prefijo FROM local_task_sequence WHERE project_id = ?", [projectId]);
      if (s) return String(s.prefijo);
      const p = base.consultarUno("SELECT nombre FROM project WHERE id = ?", [projectId]);
      return p ? prefijoDe(String(p.nombre)) : null;
    },

    /**
     * Las tareas de un proyecto, las mas nuevas primero. Sin terminadas salvo
     * que se pidan: es lo que `listItems` promete (un `done` sin `includeDone`
     * se volveria a ofrecer para correr).
     *
     * @param {string} projectId
     * @param {{incluirTerminadas?: boolean, limite?: number, desde?: number}} [opts]
     */
    listar(projectId, opts = {}) {
      const filtro = opts.incluirTerminadas ? "" : " AND estado <> 'done'";
      const total = Number(
        base.consultarUno(`SELECT COUNT(*) AS n FROM local_task WHERE project_id = ?${filtro}`, [projectId]).n,
      );
      const limite = Number.isInteger(opts.limite) && Number(opts.limite) > 0 ? Number(opts.limite) : 100;
      const desde = Number.isInteger(opts.desde) && Number(opts.desde) >= 0 ? Number(opts.desde) : 0;
      const filas = base
        .consultar(`SELECT * FROM local_task WHERE project_id = ?${filtro} ORDER BY numero DESC LIMIT ? OFFSET ?`, [
          projectId,
          limite,
          desde,
        ])
        .map(deFila);
      return { filas, total };
    },

    /**
     * @param {string} id
     * @param {Record<string, any>} cambios solo los de `EDITABLES`; el resto se ignora
     */
    actualizar(id, cambios) {
      const actual = porId(id);
      if (!actual) return null;
      const sets = [];
      const valores = [];
      for (const campo of EDITABLES) {
        if (!(campo in cambios)) continue;
        let v = cambios[campo];
        if (campo === "termino" || campo === "estado") exigirEnum(campo, v);
        if (campo === "titulo" && (typeof v !== "string" || !v.trim())) {
          fallar("campo_obligatorio_ausente", { tabla: "local_task", campo: "titulo", pista: "Una tarea sin titulo no se puede ver en el board." });
        }
        if (campo === "criterios" || campo === "etiquetas") v = JSON.stringify(v ?? []);
        if (campo === "ejecutor") v = v ? JSON.stringify(v) : null;
        if (campo === "titulo") v = v.trim();
        sets.push(`${campo} = ?`);
        valores.push(v ?? null);
      }
      if (!sets.length) return actual;
      sets.push("actualizado = ?");
      valores.push(new Date().toISOString());
      base.escribir(`UPDATE local_task SET ${sets.join(", ")} WHERE id = ?`, [...valores, id]);
      return porId(id);
    },

    /** @param {string} id @param {string} estado */
    cambiarEstado(id, estado) {
      return this.actualizar(id, { estado });
    },

    /** @param {string} id */
    borrar(id) {
      return base.escribir("DELETE FROM local_task WHERE id = ?", [id]).cambios > 0;
    },

    /** @param {string} id @param {string} texto */
    comentar(id, texto) {
      const fila = { id: randomUUID(), task_id: id, texto: String(texto), creado: new Date().toISOString() };
      base.escribir("INSERT INTO local_task_comment (id, task_id, texto, creado) VALUES (?, ?, ?, ?)", [
        fila.id,
        fila.task_id,
        fila.texto,
        fila.creado,
      ]);
      return Object.freeze(fila);
    },

    /** @param {string} id */
    comentarios(id) {
      return base
        .consultar("SELECT * FROM local_task_comment WHERE task_id = ? ORDER BY creado, rowid", [id])
        .map((f) => Object.freeze({ ...f }));
    },
  };
}
