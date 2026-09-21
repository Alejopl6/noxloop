// Los repositorios de las entidades. Uno por agregado, todos sobre la misma capa.
//
// POR QUE CADA ESCRITURA MAPEA CAMPO POR CAMPO DESDE UNA LISTA DECLARADA, Y NO
// `Object.keys(fila)`. Es dos lineas mas y es la diferencia entre un almacen
// que guarda lo que se le declaro y uno que guarda lo que le llegue. El camino
// real de una fuga no es `INSERT INTO credential (valor)`: es
// `guardarCredencial({ ...credencial, valor })` escrito en un sitio donde el
// valor estaba a mano, y un INSERT armado con las claves del objeto lo escribe
// sin que nadie lo vea en la revision. Hay una prueba que mete un centinela por
// ahi y lo busca en el volcado entero de la base.
//
// POR QUE LO QUE SALE VA CONGELADO. Lo mismo que hace `packages/vault` en su
// repositorio en memoria: un objeto devuelto y mutado por quien lo recibio es
// un cambio que no paso por ninguna guarda y que el siguiente lector se cree.

import { randomUUID } from "node:crypto";

import { ENUMS } from "./esquema.mjs";
import { fallar } from "./errores.mjs";

/** @param {any} valor */
const congelar = (valor) => (valor === null || valor === undefined ? null : Object.freeze({ ...valor }));

/** @param {any[]} filas */
const congelarTodas = (filas) => Object.freeze(filas.map((f) => Object.freeze({ ...f })));

/**
 * @param {Record<string, any>} datos
 * @param {string} tabla
 * @param {string} campo
 * @param {string} [pista]
 */
function exigir(datos, tabla, campo, pista) {
  const valor = datos[campo];
  if (valor === undefined || valor === null || valor === "") fallar("campo_obligatorio_ausente", { tabla, campo, pista });
  return valor;
}

/**
 * @param {string} tabla
 * @param {string} campo
 * @param {any} valor
 */
function exigirEnum(tabla, campo, valor) {
  const permitidos = ENUMS[`${tabla}.${campo}`];
  if (permitidos && !permitidos.includes(valor)) fallar("valor_fuera_del_enum", { tabla, campo, valor, permitidos });
  return valor;
}

const ahoraIso = (ahora) => (ahora ? new Date(ahora).toISOString() : new Date().toISOString());
const json = (valor, porDefecto) => JSON.stringify(valor ?? porDefecto);

/** @param {import("./sqlite.mjs").BaseSqlite} base */
export function repositorioDeWorkspaces(base) {
  return {
    crear(datos) {
      const fila = {
        id: datos.id ?? randomUUID(),
        home: exigir(datos, "workspace", "home"),
        creado: ahoraIso(datos.ahora),
        version_esquema: datos.version_esquema ?? 0,
      };
      base.escribir("INSERT INTO workspace (id, home, creado, version_esquema) VALUES (?, ?, ?, ?)", [
        fila.id,
        fila.home,
        fila.creado,
        fila.version_esquema,
      ]);
      return Object.freeze(fila);
    },
    porId(id) {
      return congelar(base.consultarUno("SELECT * FROM workspace WHERE id = ?", [id]));
    },
    todos() {
      return congelarTodas(base.consultar("SELECT * FROM workspace ORDER BY creado"));
    },
  };
}

/** @param {import("./sqlite.mjs").BaseSqlite} base */
export function repositorioDeSnapshots(base) {
  return {
    crear(datos) {
      const fila = {
        id: datos.id ?? randomUUID(),
        project_id: exigir(datos, "project_snapshot", "project_id"),
        commit: exigir(
          datos,
          "project_snapshot",
          "commit",
          "Es el punto exacto del analisis: sin el, el snapshot no se puede volver a reproducir.",
        ),
        creado: ahoraIso(datos.ahora),
        estado: exigirEnum("project_snapshot", "estado", datos.estado ?? "en_curso"),
        duracion_ms: datos.duracion_ms ?? null,
      };
      base.escribir(
        'INSERT INTO project_snapshot (id, project_id, "commit", creado, estado, duracion_ms) VALUES (?, ?, ?, ?, ?, ?)',
        [fila.id, fila.project_id, fila.commit, fila.creado, fila.estado, fila.duracion_ms],
      );
      return Object.freeze(fila);
    },

    completar(id, { duracion_ms }) {
      // `duracion_ms` es obligatoria al completar y no despues: NFR-001 se mide
      // con ella, y una medida que falta no es cero — deja la metrica contando
      // de menos justo los snapshots que mas tardaron.
      if (typeof duracion_ms !== "number") {
        fallar("campo_obligatorio_ausente", {
          tabla: "project_snapshot",
          campo: "duracion_ms",
          pista: "Se mide NFR-001 con ella; un snapshot completo sin duracion no se cuenta.",
        });
      }
      base.escribir("UPDATE project_snapshot SET estado = 'completo', duracion_ms = ? WHERE id = ?", [duracion_ms, id]);
      return congelar(base.consultarUno("SELECT * FROM project_snapshot WHERE id = ?", [id]));
    },

    /**
     * FR-013: un hallazgo `detectado` sin evidencia NO SE PERSISTE.
     *
     * La comprobacion esta tambien en un CHECK de la tabla. Se duplica a
     * proposito: el CHECK protege de cualquier camino, y esta de aqui da el
     * error que el operador puede leer —con la clave del hallazgo delante— en
     * vez de un `CHECK constraint failed`.
     */
    agregarHallazgo(datos) {
      const evidencia = datos.evidencia ?? [];
      const origen = exigirEnum("snapshot_finding", "origen", datos.origen);
      if (origen === "detectado" && (!Array.isArray(evidencia) || evidencia.length === 0)) {
        fallar("hallazgo_sin_evidencia", { clave: datos.clave });
      }
      const fila = {
        id: datos.id ?? randomUUID(),
        snapshot_id: exigir(datos, "snapshot_finding", "snapshot_id"),
        categoria: exigirEnum("snapshot_finding", "categoria", datos.categoria),
        clave: exigir(datos, "snapshot_finding", "clave"),
        valor: json(datos.valor, {}),
        origen,
        evidencia: json(evidencia, []),
        confianza: exigirEnum("snapshot_finding", "confianza", datos.confianza),
        decision: exigirEnum("snapshot_finding", "decision", datos.decision ?? "pendiente"),
        valor_corregido: datos.valor_corregido === undefined ? null : JSON.stringify(datos.valor_corregido),
      };
      base.escribir(
        "INSERT INTO snapshot_finding (id, snapshot_id, categoria, clave, valor, origen, evidencia, confianza, " +
          "decision, valor_corregido) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          fila.id,
          fila.snapshot_id,
          fila.categoria,
          fila.clave,
          fila.valor,
          fila.origen,
          fila.evidencia,
          fila.confianza,
          fila.decision,
          fila.valor_corregido,
        ],
      );
      return Object.freeze(fila);
    },

    decidirHallazgo(id, { decision, valor_corregido }) {
      exigirEnum("snapshot_finding", "decision", decision);
      base.escribir("UPDATE snapshot_finding SET decision = ?, valor_corregido = ? WHERE id = ?", [
        decision,
        valor_corregido === undefined ? null : JSON.stringify(valor_corregido),
        id,
      ]);
      return congelar(base.consultarUno("SELECT * FROM snapshot_finding WHERE id = ?", [id]));
    },

    hallazgos(snapshotId) {
      return congelarTodas(
        base.consultar("SELECT * FROM snapshot_finding WHERE snapshot_id = ? ORDER BY clave", [snapshotId]),
      );
    },

    porProyecto(projectId) {
      return congelarTodas(
        base.consultar("SELECT * FROM project_snapshot WHERE project_id = ? ORDER BY creado DESC", [projectId]),
      );
    },
  };
}

/** @param {import("./sqlite.mjs").BaseSqlite} base */
export function repositorioDeConstituciones(base) {
  return {
    /**
     * Fijar una constitution desplaza a la anterior en la MISMA transaccion.
     *
     * EL FALLO QUE EVITA. En dos pasos —insertar la nueva, apagar la vieja—
     * existe un instante con dos vigentes, y el indice unico parcial lo aborta:
     * la nueva no entra y la vieja sigue. En este orden no hay instante.
     */
    fijar(datos) {
      return base.enTransaccion(() => {
        const projectId = exigir(datos, "constitution", "project_id");
        base.escribir("UPDATE constitution SET vigente = 0 WHERE project_id = ? AND vigente = 1", [projectId]);
        const fila = {
          id: datos.id ?? randomUUID(),
          project_id: projectId,
          version: exigir(datos, "constitution", "version"),
          ruta_en_repo: exigir(
            datos,
            "constitution",
            "ruta_en_repo",
            "La constitution vive versionada en el repositorio (FR-021); el almacen guarda el puntero.",
          ),
          contenido: datos.contenido ?? "",
          ratificada: ahoraIso(datos.ahora),
          enmendada: datos.enmendada ?? null,
          vigente: 1,
        };
        base.escribir(
          "INSERT INTO constitution (id, project_id, version, ruta_en_repo, contenido, ratificada, enmendada, " +
            "vigente) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
          [fila.id, fila.project_id, fila.version, fila.ruta_en_repo, fila.contenido, fila.ratificada, fila.enmendada],
        );
        return Object.freeze(fila);
      });
    },

    vigenteDe(projectId) {
      return congelar(base.consultarUno("SELECT * FROM constitution WHERE project_id = ? AND vigente = 1", [projectId]));
    },

    /** Una enmienda sin el fallo que la motiva no es una enmienda: es una preferencia. */
    enmendar(datos) {
      const fila = {
        id: datos.id ?? randomUUID(),
        constitution_id: exigir(datos, "constitution_amendment", "constitution_id"),
        version_anterior: exigir(datos, "constitution_amendment", "version_anterior"),
        version_nueva: exigir(datos, "constitution_amendment", "version_nueva"),
        principio: exigir(datos, "constitution_amendment", "principio"),
        fallo_que_motiva: exigir(
          datos,
          "constitution_amendment",
          "fallo_que_motiva",
          "Sin un fallo concreto y observado detras, no es una enmienda.",
        ),
        que_se_rompe_si_no: exigir(datos, "constitution_amendment", "que_se_rompe_si_no"),
        fecha: ahoraIso(datos.ahora),
      };
      base.escribir(
        "INSERT INTO constitution_amendment (id, constitution_id, version_anterior, version_nueva, principio, " +
          "fallo_que_motiva, que_se_rompe_si_no, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          fila.id,
          fila.constitution_id,
          fila.version_anterior,
          fila.version_nueva,
          fila.principio,
          fila.fallo_que_motiva,
          fila.que_se_rompe_si_no,
          fila.fecha,
        ],
      );
      return Object.freeze(fila);
    },

    enmiendas(constitutionId) {
      return congelarTodas(
        base.consultar("SELECT * FROM constitution_amendment WHERE constitution_id = ? ORDER BY fecha", [
          constitutionId,
        ]),
      );
    },
  };
}

/** @param {import("./sqlite.mjs").BaseSqlite} base */
export function repositorioDeGuidelines(base) {
  return {
    guardar(datos) {
      const fila = {
        id: datos.id ?? randomUUID(),
        project_id: exigir(datos, "guideline", "project_id"),
        area: exigirEnum("guideline", "area", datos.area),
        ruta_en_repo: exigir(datos, "guideline", "ruta_en_repo"),
        contenido: datos.contenido ?? "",
        reglas_aplicables: json(datos.reglas_aplicables, []),
      };
      base.escribir(
        "INSERT INTO guideline (id, project_id, area, ruta_en_repo, contenido, reglas_aplicables) VALUES (?, ?, ?, ?, ?, ?)",
        [fila.id, fila.project_id, fila.area, fila.ruta_en_repo, fila.contenido, fila.reglas_aplicables],
      );
      return Object.freeze(fila);
    },
    porProyecto(projectId) {
      return congelarTodas(base.consultar("SELECT * FROM guideline WHERE project_id = ? ORDER BY area", [projectId]));
    },
  };
}

/** @param {import("./sqlite.mjs").BaseSqlite} base */
export function repositorioDeRecomendaciones(base) {
  return {
    crear(datos) {
      const decision = exigirEnum("recommendation", "decision", datos.decision ?? "pendiente");
      const fila = {
        id: datos.id ?? randomUUID(),
        project_id: exigir(datos, "recommendation", "project_id"),
        tipo: exigirEnum("recommendation", "tipo", datos.tipo),
        titulo: exigir(datos, "recommendation", "titulo"),
        justificacion: exigir(datos, "recommendation", "justificacion"),
        diff: exigir(datos, "recommendation", "diff", "FR-026: los cambios exactos se calculan ANTES de proponer."),
        conflicto_constitution: datos.conflicto_constitution ?? null,
        decision,
        motivo_decision: datos.motivo_decision ?? null,
        decidida: decision === "pendiente" ? null : ahoraIso(datos.ahora),
      };
      base.escribir(
        "INSERT INTO recommendation (id, project_id, tipo, titulo, justificacion, diff, conflicto_constitution, " +
          "decision, motivo_decision, decidida) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          fila.id,
          fila.project_id,
          fila.tipo,
          fila.titulo,
          fila.justificacion,
          fila.diff,
          fila.conflicto_constitution,
          fila.decision,
          fila.motivo_decision,
          fila.decidida,
        ],
      );
      return Object.freeze(fila);
    },

    decidir(id, { decision, motivo_decision = null, ahora }) {
      exigirEnum("recommendation", "decision", decision);
      base.escribir("UPDATE recommendation SET decision = ?, motivo_decision = ?, decidida = ? WHERE id = ?", [
        decision,
        motivo_decision,
        ahoraIso(ahora),
        id,
      ]);
      return congelar(base.consultarUno("SELECT * FROM recommendation WHERE id = ?", [id]));
    },

    porProyecto(projectId) {
      return congelarTodas(
        base.consultar("SELECT * FROM recommendation WHERE project_id = ? ORDER BY titulo", [projectId]),
      );
    },
  };
}

/** @param {import("./sqlite.mjs").BaseSqlite} base */
export function repositorioDeConexiones(base) {
  return {
    crear(datos) {
      const clase = exigirEnum("connection", "clase", datos.clase);
      const fila = {
        id: datos.id ?? randomUUID(),
        project_id: exigir(datos, "connection", "project_id"),
        clase,
        proveedor: exigir(datos, "connection", "proveedor"),
        id_externo: datos.id_externo ?? null,
        estado: exigirEnum("connection", "estado", datos.estado ?? "pendiente"),
        credential_id: datos.credential_id ?? null,
        capacidades: json(datos.capacidades, {}),
      };
      base.escribir(
        "INSERT INTO connection (id, project_id, clase, proveedor, id_externo, estado, credential_id, capacidades) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          fila.id,
          fila.project_id,
          fila.clase,
          fila.proveedor,
          fila.id_externo,
          fila.estado,
          fila.credential_id,
          fila.capacidades,
        ],
      );
      return Object.freeze(fila);
    },

    cambiarEstado(id, estado) {
      exigirEnum("connection", "estado", estado);
      base.escribir("UPDATE connection SET estado = ? WHERE id = ?", [estado, id]);
      return congelar(base.consultarUno("SELECT * FROM connection WHERE id = ?", [id]));
    },

    porProyecto(projectId) {
      return congelarTodas(base.consultar("SELECT * FROM connection WHERE project_id = ? ORDER BY clase", [projectId]));
    },
  };
}

/** @param {import("./sqlite.mjs").BaseSqlite} base */
export function repositorioDeAgentes(base) {
  return {
    crear(datos) {
      const fila = {
        id: datos.id ?? randomUUID(),
        project_id: exigir(datos, "agent", "project_id"),
        nombre: exigir(datos, "agent", "nombre"),
        rol: exigirEnum("agent", "rol", datos.rol),
        runtime: exigir(datos, "agent", "runtime"),
        modelo: exigir(datos, "agent", "modelo"),
        skills: json(datos.skills, []),
        tools: json(datos.tools, []),
        mcps: json(datos.mcps, []),
        permisos: json(datos.permisos, {}),
        presupuesto: json(datos.presupuesto, {}),
        contexto: json(datos.contexto, {}),
      };
      // FR-034 lo aborta el disparador del esquema, no este metodo: es el unico
      // sitio donde se cumple tambien para quien no pase por aqui.
      base.escribir(
        "INSERT INTO agent (id, project_id, nombre, rol, runtime, modelo, skills, tools, mcps, permisos, " +
          "presupuesto, contexto) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          fila.id,
          fila.project_id,
          fila.nombre,
          fila.rol,
          fila.runtime,
          fila.modelo,
          fila.skills,
          fila.tools,
          fila.mcps,
          fila.permisos,
          fila.presupuesto,
          fila.contexto,
        ],
      );
      return Object.freeze(fila);
    },
    porProyecto(projectId) {
      return congelarTodas(base.consultar("SELECT * FROM agent WHERE project_id = ? ORDER BY nombre", [projectId]));
    },
    porId(id) {
      return congelar(base.consultarUno("SELECT * FROM agent WHERE id = ?", [id]));
    },
  };
}

/** @param {import("./sqlite.mjs").BaseSqlite} base */
export function repositorioDeBandeja(base) {
  return {
    crear(datos) {
      const estado = exigirEnum("inbox_entry", "estado", datos.estado ?? "esperando");
      const fila = {
        id: datos.id ?? randomUUID(),
        workspace_id: exigir(datos, "inbox_entry", "workspace_id"),
        project_id: datos.project_id ?? null,
        tipo: exigirEnum("inbox_entry", "tipo", datos.tipo),
        causa: exigir(datos, "inbox_entry", "causa", "FR-062: textual y completa, no un resumen generado."),
        contexto: json(datos.contexto, {}),
        decisiones_posibles: json(datos.decisiones_posibles, []),
        estado,
        creada: ahoraIso(datos.ahora),
        resuelta: estado === "esperando" ? null : ahoraIso(datos.ahora),
        resuelta_por: estado === "esperando" || estado === "caducada" ? null : (datos.resuelta_por ?? null),
      };
      base.escribir(
        "INSERT INTO inbox_entry (id, workspace_id, project_id, tipo, causa, contexto, decisiones_posibles, " +
          "estado, creada, resuelta, resuelta_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          fila.id,
          fila.workspace_id,
          fila.project_id,
          fila.tipo,
          fila.causa,
          fila.contexto,
          fila.decisiones_posibles,
          fila.estado,
          fila.creada,
          fila.resuelta,
          fila.resuelta_por,
        ],
      );
      return Object.freeze(fila);
    },

    resolver(id, { estado, resuelta_por = null, ahora }) {
      exigirEnum("inbox_entry", "estado", estado);
      if (estado !== "caducada" && !resuelta_por) {
        fallar("campo_obligatorio_ausente", {
          tabla: "inbox_entry",
          campo: "resuelta_por",
          pista: "Una entrada resuelta sin quien la resolvio deja la decision sin dueno.",
        });
      }
      base.escribir("UPDATE inbox_entry SET estado = ?, resuelta = ?, resuelta_por = ? WHERE id = ?", [
        estado,
        ahoraIso(ahora),
        estado === "caducada" ? null : resuelta_por,
        id,
      ]);
      return congelar(base.consultarUno("SELECT * FROM inbox_entry WHERE id = ?", [id]));
    },

    esperando(workspaceId) {
      return congelarTodas(
        base.consultar("SELECT * FROM inbox_entry WHERE workspace_id = ? AND estado = 'esperando' ORDER BY creada", [
          workspaceId,
        ]),
      );
    },
  };
}

/** @param {import("./sqlite.mjs").BaseSqlite} base */
export function repositorioDePoliticas(base) {
  return {
    /** Nace apagada SIEMPRE. El disparador del esquema lo impone; aqui ni siquiera hay parametro para encenderla. */
    declarar(datos) {
      const fila = {
        id: datos.id ?? randomUUID(),
        project_id: exigir(datos, "danger_policy", "project_id"),
        capacidad: exigirEnum("danger_policy", "capacidad", datos.capacidad),
        habilitada: 0,
        habilitada_por: null,
        habilitada_en: null,
        condiciones: json(datos.condiciones, {}),
      };
      base.escribir("INSERT INTO danger_policy (id, project_id, capacidad, condiciones) VALUES (?, ?, ?, ?)", [
        fila.id,
        fila.project_id,
        fila.capacidad,
        fila.condiciones,
      ]);
      return Object.freeze(fila);
    },

    habilitar({ project_id, capacidad, habilitada_por, condiciones, ahora }) {
      if (!habilitada_por) {
        fallar("campo_obligatorio_ausente", {
          tabla: "danger_policy",
          campo: "habilitada_por",
          pista: "Habilitar una capacidad de alto impacto sin quien deja la decision sin dueno (FR-051).",
        });
      }
      base.escribir(
        "UPDATE danger_policy SET habilitada = 1, habilitada_por = ?, habilitada_en = ?, condiciones = " +
          "COALESCE(?, condiciones) WHERE project_id = ? AND capacidad = ?",
        [habilitada_por, ahoraIso(ahora), condiciones ? JSON.stringify(condiciones) : null, project_id, capacidad],
      );
      return congelar(
        base.consultarUno("SELECT * FROM danger_policy WHERE project_id = ? AND capacidad = ?", [project_id, capacidad]),
      );
    },

    porProyecto(projectId) {
      return congelarTodas(
        base.consultar("SELECT * FROM danger_policy WHERE project_id = ? ORDER BY capacidad", [projectId]),
      );
    },
  };
}

/**
 * La vista de inicio (NFR-002): todo lo que la pantalla necesita en UNA consulta.
 *
 * POR QUE UNA SOLA Y NO 1 + N. Devolver solo los proyectos obliga a la interfaz
 * a pedir despues la bandeja de cada uno: 21 peticiones con su viaje cada una.
 * El presupuesto de un segundo se gasta en los viajes, y optimizar la consulta
 * despues ya no lo arregla.
 *
 * POR QUE SUBCONSULTAS CORRELACIONADAS Y NO `GROUP BY` GLOBAL. Con 20
 * proyectos, agrupar la bandeja entera obliga a recorrerla entera. Correlacionar
 * por proyecto entra por `(project_id, estado)` y toca solo lo que cuenta. La
 * prueba de rendimiento mira el PLAN, no solo el reloj: con 20 proyectos el
 * reloj pasa igual sin indices, y el que lo paga es el operador dos anos
 * despues, en su maquina, donde nadie corre pruebas.
 *
 * @param {import("./sqlite.mjs").BaseSqlite} base
 */
export function vistaDeInicio(base) {
  const CONSULTA = `
    SELECT
      p.id, p.nombre, p.slug, p.estado, p.origen, p.autonomia, p.actualizado, p.workspace_id,
      (SELECT COUNT(*) FROM inbox_entry i
        WHERE i.project_id = p.id AND i.estado = 'esperando')   AS bandeja_esperando,
      (SELECT COUNT(*) FROM recommendation r
        WHERE r.project_id = p.id AND r.decision = 'pendiente') AS recomendaciones_pendientes,
      (SELECT COUNT(*) FROM agent a WHERE a.project_id = p.id)  AS agentes,
      (SELECT COUNT(*) FROM connection c
        WHERE c.project_id = p.id AND c.estado = 'viva')        AS conexiones_vivas,
      (SELECT MAX(s.creado) FROM project_snapshot s
        WHERE s.project_id = p.id)                              AS ultimo_snapshot,
      (SELECT COUNT(*) FROM project_snapshot s2
        JOIN snapshot_finding f ON f.snapshot_id = s2.id
        WHERE s2.project_id = p.id AND f.decision = 'pendiente') AS hallazgos_pendientes
    FROM project p
    ORDER BY p.actualizado DESC
  `;

  return {
    proyectos() {
      return congelarTodas(base.consultar(CONSULTA));
    },
    /** El plan de la consulta, para la guarda de rendimiento. */
    planDeConsulta() {
      return base.plan(CONSULTA);
    },
  };
}
