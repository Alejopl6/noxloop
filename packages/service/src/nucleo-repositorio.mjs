// `RepositorioDeNucleo` contra el almacen consultable.
//
// ESTO ES EL `TODO(persistencia)` DE `packages/core/src/repositorio.mjs`, que
// dice: "implementar `RepositorioDeNucleo` contra el almacen consultable cuando
// exista". Ya existe. Vive AQUI y no alli porque `packages/core` viaja al
// escritorio como recurso suelto y no puede importar `packages/store`: el
// cableado es trabajo del servicio, que es el unico que conoce a los dos.
//
// LA TRANSICION DE ESTADO NO SE REIMPLEMENTA, SE DELEGA. El segundo TODO de ese
// archivo lo dice: "la maquina de estados del proyecto la implementa tambien el
// almacen (es su escritor unico); la guarda que hay aqui es la del doble de
// prueba". Asi que `transicionar` llama al almacen y punto. La diferencia no es
// de estilo: las guardas del almacen VAN A BUSCAR el artefacto en la base
// —cuentan los hallazgos sin decidir, miran si hay conexion viva— mientras que
// la del doble solo comprueba que quien llama paso un artefacto no nulo. Copiar
// la del doble aqui seria dejar pasar transiciones que el almacen rechaza, y el
// sintoma aparece tres etapas despues.
//
// LO QUE SE GUARDA EN MEMORIA, Y POR QUE NO ES UN DESCUIDO. El esquema de
// `recommendation` tiene `diff` pero no tiene `cambios`, ni `base`, ni
// `entrada`, ni `capacidad`, ni `historial` — y `aplicar` los necesita los
// cuatro: `cambios` es el contenido exacto de cada archivo y `base` es la
// huella contra la que se detecta el diff obsoleto. Sin ellos, `apply` tendria
// que RECALCULAR, que es exactamente lo que el nucleo prohibe en su cabecera
// ("la garantia no es que se abstenga de recalcular: es que no tiene con que").
// Asi que la recomendacion completa vive en memoria mientras el servicio vive,
// y en la tabla queda lo que la tabla sabe guardar, que es lo que necesita la
// guarda de `bootstrap_resuelto`. Un reinicio pierde el diff calculado y obliga
// a volver a correr el analisis: eso es peor que persistirlo entero, y es
// mucho mejor que aplicar algo distinto de lo que el operador aprobo. La
// columna que falta esta en el informe de esta tarea.

/**
 * @param {any} almacen
 * @param {{actor: string}} opciones
 */
export function repositorioDeNucleoSobreAlmacen(almacen, { actor }) {
  /**
   * Las recomendaciones completas, con sus cambios y su base.
   * @type {Map<string, any>}
   */
  const recomendaciones = new Map();
  /** @type {any[]} */
  const decisiones = [];

  const base = almacen.base;

  /** @param {any} fila */
  const proyectoDeFila = (fila) => (fila ? { ...fila } : null);

  return {
    /**
     * El alta de un proyecto la hace el repositorio de proyectos del almacen,
     * que es su escritor unico y el que impone que todo proyecto nazca en
     * `CREATED`. Aqui solo puede llegar una re-escritura de lo que ya hay, y se
     * ignora a proposito: aceptarla seria la puerta por la que un proyecto
     * cambia de estado sin pasar por ninguna guarda.
     */
    guardarProyecto() {
      /* el almacen es el escritor: ver la cabecera de `packages/store/src/proyecto.mjs` */
    },

    /** @param {string} id */
    proyecto(id) {
      return proyectoDeFila(almacen.proyectos.porId(id));
    },

    /**
     * @param {string} id
     * @param {string} hasta
     */
    transicionar(id, hasta) {
      return proyectoDeFila(almacen.proyectos.transicionar(id, hasta, { actor }));
    },

    /** @param {any} c */
    guardarConstitution(c) {
      if (!c.vigente) {
        // Es `{...anterior, vigente: false}`, que el nucleo escribe justo antes
        // de fijar la nueva. En el almacen eso lo hace `fijar` DENTRO de la
        // misma transaccion —hay un indice unico parcial que aborta si hay dos
        // vigentes a la vez— asi que aqui no hay nada que hacer.
        return;
      }
      almacen.constituciones.fijar({
        id: c.id,
        project_id: c.project_id,
        version: c.version,
        ruta_en_repo: c.ruta_en_repo,
        contenido: c.contenido,
        enmendada: c.enmendada ?? null,
      });
    },

    /** @param {string} project_id */
    constitutionVigente(project_id) {
      const fila = almacen.constituciones.vigenteDe(project_id);
      return fila ? { ...fila, vigente: true } : null;
    },

    /** @param {string} project_id */
    constituciones(project_id) {
      return base
        .consultar("SELECT * FROM constitution WHERE project_id = ? ORDER BY ratificada", [project_id])
        .map((/** @type {any} */ f) => ({ ...f, vigente: Number(f.vigente) === 1 }));
    },

    /** @param {any} a */
    guardarEnmienda(a) {
      almacen.constituciones.enmendar({
        id: a.id,
        constitution_id: a.constitution_id,
        version_anterior: a.version_anterior,
        version_nueva: a.version_nueva,
        principio: a.principio,
        fallo_que_motiva: a.fallo_que_motiva,
        que_se_rompe_si_no: a.que_se_rompe_si_no,
        ahora: a.fecha,
      });
    },

    /** @param {string} project_id */
    enmiendas(project_id) {
      return base.consultar(
        "SELECT e.* FROM constitution_amendment e JOIN constitution c ON c.id = e.constitution_id " +
          "WHERE c.project_id = ? ORDER BY e.fecha",
        [project_id],
      );
    },

    /**
     * @param {any} g
     *
     * El almacen solo sabe INSERTAR guidelines y la tabla no tiene clave unica
     * por `(project_id, area)`: guardar dos veces la misma area dejaria dos
     * filas y la pantalla mostraria la vieja o la nueva segun el orden. Se
     * borra la anterior en la misma transaccion, que es lo que "guardar" quiere
     * decir para un documento que se reescribe entero.
     */
    guardarGuideline(g) {
      base.enTransaccion(() => {
        base.escribir("DELETE FROM guideline WHERE project_id = ? AND area = ?", [g.project_id, g.area]);
        almacen.guidelines.guardar({
          id: g.id,
          project_id: g.project_id,
          area: g.area,
          ruta_en_repo: g.ruta_en_repo,
          contenido: g.documento ?? g.contenido ?? "",
          reglas_aplicables: g.reglas_aplicables ?? [],
        });
      });
    },

    /**
     * @param {string} project_id
     * @param {string} area
     */
    guideline(project_id, area) {
      const fila = base.consultarUno("SELECT * FROM guideline WHERE project_id = ? AND area = ?", [project_id, area]);
      return fila ? { ...fila, reglas_aplicables: JSON.parse(String(fila.reglas_aplicables)) } : null;
    },

    /** @param {string} project_id */
    guidelines(project_id) {
      return almacen.guidelines
        .porProyecto(project_id)
        .map((/** @type {any} */ f) => ({ ...f, reglas_aplicables: JSON.parse(String(f.reglas_aplicables)) }));
    },

    /** @param {any} r */
    guardarRecomendacion(r) {
      recomendaciones.set(r.id, r);
      const ya = base.consultarUno("SELECT id FROM recommendation WHERE id = ?", [r.id]);
      if (!ya) {
        almacen.recomendaciones.crear({
          id: r.id,
          project_id: r.project_id,
          // El catalogo del nucleo tiene tipos que el enum del almacen no
          // declara (`instrucciones`, `documentacion`). Se mapean al mas
          // cercano que SI esta en vez de reventar el alta: la alternativa es
          // que una recomendacion valida no se pueda guardar y el bootstrap no
          // avance. La divergencia de los dos enums esta en el informe.
          tipo: tipoDelAlmacen(r.tipo),
          titulo: r.titulo,
          justificacion: r.justificacion,
          diff: r.diff,
          conflicto_constitution: r.conflicto_constitution ?? null,
        });
      }
      if (r.decision && r.decision !== "pendiente") {
        almacen.recomendaciones.decidir(r.id, {
          decision: r.decision,
          motivo_decision: r.motivo_decision ?? null,
          ahora: r.decidida ?? undefined,
        });
      }
    },

    /** @param {string} id */
    recomendacion(id) {
      return recomendaciones.get(id) ?? null;
    },

    /** @param {string} project_id */
    recomendaciones(project_id) {
      return [...recomendaciones.values()].filter((r) => r.project_id === project_id);
    },

    /** @param {any} e */
    registrarDecision(e) {
      decisiones.push({ ...e });
    },

    /** @param {string} project_id */
    decisiones(project_id) {
      return decisiones.filter((d) => d.project_id === project_id);
    },
  };
}

/**
 * El `tipo` del catalogo del nucleo traducido al enum del almacen.
 *
 * Los dos enums existen y no coinciden: `recommendation.tipo` del modelo de
 * datos declara siete valores y el catalogo del nucleo produce dos mas
 * —`instrucciones` y `documentacion`— que son las dos entradas que de verdad
 * escriben un documento. Traducir aqui es lo unico que se puede hacer desde el
 * servicio sin tocar ninguno de los dos paquetes; ampliar el enum del almacen
 * es la solucion, y va en el informe con su diff.
 *
 * @param {string} tipo
 */
function tipoDelAlmacen(tipo) {
  const CONOCIDOS = ["hook", "skill", "mcp", "tool", "subagente", "validacion", "ci"];
  if (CONOCIDOS.includes(tipo)) return tipo;
  return "validacion";
}
