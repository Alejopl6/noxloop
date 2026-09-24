// La maquina de estados de `Project`: transiciones con guarda, escritor unico.
//
// EL FALLO QUE EVITA ESTA MEDIDO Y ESCRITO EN LA CONSTITUTION. El principio
// VIII dice que la superficie de v2 se multiplica por diez y que cada pantalla
// nueva es candidata a segundo escritor, y remata: "un segundo escritor saltea
// las guardas de transicion, que son lo unico que sostiene el principio del
// exit code". Esto es esa guarda.
//
// NINGUNA GUARDA PREGUNTA, TODAS VAN A BUSCAR. No existe
// `transicionar(id, "CONSTITUTED", { constitutionFijada: true })`: el parametro
// seria la prosa de un modelo convertida en estado, que es exactamente lo que
// prohibe el principio II. Cada guarda consulta la base por el artefacto.
//
// POR QUE RETROCEDER NO EXISTE. Un estado que baja deja sin explicar los
// artefactos que ya se produjeron. Lo que se hace es reabrir la etapa sin mover
// el estado: el snapshot se vuelve a correr, la constitution se enmienda, las
// recomendaciones se vuelven a decidir — y el historial sigue leyendose.

import { randomUUID } from "node:crypto";

import { fallar } from "./errores.mjs";
import { ENUMS } from "./esquema.mjs";

/** En orden. El indice es lo que distingue avanzar de retroceder. */
export const ESTADOS = Object.freeze([...ENUMS["project.estado"]]);

/**
 * Las aristas del diagrama de `data-model.md`, una a una.
 *
 * `artefacto` no es documentacion: es la clave de la guarda que se ejecuta, y
 * hay una prueba que exige que ninguna transicion la deje vacia.
 *
 * @type {ReadonlyArray<{desde: string, hasta: string, artefacto: string|null, soloOrigen?: string}>}
 */
export const TRANSICIONES = Object.freeze([
  { desde: "CREATED", hasta: "DISCOVERED", artefacto: "snapshot_aceptado" },
  // La unica que salta un estado, y solo para un proyecto `nuevo`: no hay
  // codigo que escanear, asi que `DISCOVERED` no tendria sobre que decidir.
  { desde: "CREATED", hasta: "CONSTITUTED", artefacto: "constitution_vigente", soloOrigen: "nuevo" },
  { desde: "DISCOVERED", hasta: "CONSTITUTED", artefacto: "constitution_vigente" },
  { desde: "CONSTITUTED", hasta: "BOOTSTRAPPED", artefacto: "bootstrap_resuelto" },
  { desde: "BOOTSTRAPPED", hasta: "CONNECTED", artefacto: "conexion_viva" },
  { desde: "CONNECTED", hasta: "ACTIVE", artefacto: "flota_declarada" },
  // Reconfiguracion. No exige artefacto nuevo porque no hay etapa nueva: lo que
  // cambia es la flota de un proyecto que ya esta declarado entero.
  { desde: "ACTIVE", hasta: "ACTIVE", artefacto: null },
]);

/** @param {string} estado */
export function transicionesDesde(estado) {
  return TRANSICIONES.filter((t) => t.desde === estado);
}

/**
 * Las guardas. Cada una devuelve si el artefacto esta y QUE ENCONTRO, porque la
 * causa del rechazo tiene que decir lo segundo: "falta el snapshot" y "el
 * snapshot esta pero tiene 12 hallazgos sin decidir" mandan al operador a
 * sitios distintos.
 *
 * @type {Record<string, (base: any, proyecto: any) => {listo: boolean, hallado: string, comoConseguirlo: string}>}
 */
export const GUARDAS = {
  /**
   * "Snapshot aceptado" no es "snapshot terminado". Un hallazgo `pendiente` es
   * un hueco sin declarar, y el principio X dice que el hueco se declara hueco:
   * dejarlo pasar convierte la lectura de la maquina en la constitution del
   * proyecto sin que nadie la haya mirado.
   */
  snapshot_aceptado(base, proyecto) {
    const completo = base.consultarUno(
      "SELECT id FROM project_snapshot WHERE project_id = ? AND estado = 'completo' ORDER BY creado DESC LIMIT 1",
      [proyecto.id],
    );
    if (!completo) {
      const enCurso = base.consultarUno(
        "SELECT COUNT(*) AS n FROM project_snapshot WHERE project_id = ? AND estado <> 'completo'",
        [proyecto.id],
      );
      return {
        listo: false,
        hallado: enCurso.n
          ? `hay ${enCurso.n} snapshot(s) sin completar y ninguno completo`
          : "este proyecto no tiene ningun snapshot",
        comoConseguirlo:
          "Corre el snapshot del proyecto y espera a que termine. Un snapshot cancelado o a medias no habilita " +
          "la etapa: lo que se acepta es la lectura entera, no un trozo.",
      };
    }
    const pendientes = base.consultarUno(
      "SELECT COUNT(*) AS n FROM snapshot_finding WHERE snapshot_id = ? AND decision = 'pendiente'",
      [completo.id],
    );
    if (Number(pendientes.n) > 0) {
      return {
        listo: false,
        hallado: `el snapshot esta completo pero tiene ${pendientes.n} hallazgo(s) con decision pendiente`,
        comoConseguirlo:
          "Decide cada hallazgo pendiente —aceptar, corregir o descartar— en la pantalla del snapshot. Un " +
          "hallazgo sin decidir es un hueco que se hereda como si fuera un hecho verificado.",
      };
    }
    const cuantos = base.consultarUno("SELECT COUNT(*) AS n FROM snapshot_finding WHERE snapshot_id = ?", [completo.id]);
    if (Number(cuantos.n) === 0) {
      return {
        listo: false,
        hallado: "el snapshot esta completo pero no tiene ningun hallazgo",
        comoConseguirlo:
          "Un snapshot sin hallazgos es un escaneo que no leyo nada. Vuelve a correrlo, y si de verdad no hay " +
          "nada que leer el proyecto es `nuevo`: corrige su origen y usa el atajo a `CONSTITUTED`.",
      };
    }
    return {
      listo: true,
      hallado: `snapshot ${completo.id} completo y con todos sus hallazgos decididos`,
      comoConseguirlo: "",
    };
  },

  constitution_vigente(base, proyecto) {
    const vigente = base.consultarUno("SELECT id, version FROM constitution WHERE project_id = ? AND vigente = 1", [
      proyecto.id,
    ]);
    if (vigente) {
      return { listo: true, hallado: `constitution ${vigente.version} vigente`, comoConseguirlo: "" };
    }
    const cuantas = base.consultarUno("SELECT COUNT(*) AS n FROM constitution WHERE project_id = ?", [proyecto.id]);
    return {
      listo: false,
      hallado: Number(cuantas.n)
        ? `hay ${cuantas.n} constitution(s) guardadas para este proyecto y ninguna esta marcada vigente`
        : "este proyecto no tiene ninguna constitution",
      comoConseguirlo:
        "Fija la constitution del proyecto. Vive versionada en el repositorio (FR-021) y el almacen guarda el " +
        "puntero y la copia indexada: sin ella, cada tarea hereda las suposiciones del modelo.",
    };
  },

  bootstrap_resuelto(base, proyecto) {
    const total = base.consultarUno("SELECT COUNT(*) AS n FROM recommendation WHERE project_id = ?", [proyecto.id]);
    if (Number(total.n) === 0) {
      return {
        listo: false,
        hallado: "el bootstrap no produjo ninguna recomendacion",
        comoConseguirlo:
          "Corre el bootstrap del proyecto. Si de verdad no hay nada que recomendar, deja constancia de que se " +
          "busco: un bootstrap vacio y un bootstrap que no corrio se ven igual desde aqui.",
      };
    }
    const pendientes = base.consultarUno(
      "SELECT COUNT(*) AS n FROM recommendation WHERE project_id = ? AND decision = 'pendiente'",
      [proyecto.id],
    );
    if (Number(pendientes.n) > 0) {
      return {
        listo: false,
        hallado: `quedan ${pendientes.n} recomendacion(es) sin decidir de ${total.n}`,
        comoConseguirlo:
          "Decide cada recomendacion —aplicar, personalizar u omitir— en la pantalla de bootstrap. Nada se " +
          "escribe sin decision, y una recomendacion pendiente no se aplica sola al avanzar de etapa.",
      };
    }
    return { listo: true, hallado: `${total.n} recomendacion(es), todas decididas`, comoConseguirlo: "" };
  },

  /**
   * UNA CONEXION DEL ESPACIO DE TRABAJO SATISFACE ESTA GUARDA. Es un cambio de
   * significado de una transicion, asi que va razonado y no comentado de paso.
   *
   * LO QUE ESTA GUARDA COMPRUEBA ES UNA CAPACIDAD, NO UNA PROPIEDAD. La etapa
   * 06 dice «conecta el proyecto con su ecosistema», y lo que el proyecto
   * necesita para su primer ciclo es ALCANZAR la forja y el gestor de tickets:
   * de donde sale el work item y donde se abre el pull request. Una cuenta de
   * codigo conectada a nivel de espacio de trabajo la alcanza igual —es la
   * misma credencial, la misma boveda y el mismo grant— asi que exigir ademas
   * que la FILA cuelgue de este proyecto seria exigir una propiedad de
   * contabilidad, no una capacidad. Y una guarda que pinta rojo sobre algo que
   * de verdad funciona es la que ensena al operador a rodear las guardas.
   *
   * EL RIESGO QUE ESTO ABRE, Y POR QUE SE ACEPTA. Conectar una cuenta deja a
   * TODOS los proyectos del espacio a un paso de `CONNECTED`, incluidos los que
   * el operador no pensaba conectar. No es un verde falso —esos proyectos
   * alcanzan la forja de verdad— y ademas ninguno avanza solo: la unica via que
   * mueve el estado es una transicion pedida sobre ESE proyecto, y el servicio
   * solo la intenta para el proyecto sobre el que se acaba de actuar. Lo que no
   * se puede perder es la distincion, y por eso `hallado` DICE de quien es la
   * conexion que conto: «de este proyecto» y «del espacio de trabajo» mandan al
   * operador a sitios distintos cuando algo falle despues.
   *
   * LA CONEXION DE OTRO ESPACIO DE TRABAJO NO CUENTA, y por eso la consulta
   * filtra por `workspace_id` en vez de por «project_id IS NULL» a secas: sin
   * ese filtro, una fila del espacio A pondria en verde a un proyecto del
   * espacio B — que es exactamente el agujero que la columna vino a tapar.
   */
  conexion_viva(base, proyecto) {
    const viva = base.consultarUno(
      "SELECT id, proveedor, project_id FROM connection " +
        "WHERE estado = 'viva' AND (project_id = ? OR (project_id IS NULL AND workspace_id = ?)) " +
        // Lo propio primero: un proyecto con conexion propia no se lee como
        // apoyado en la del espacio.
        "ORDER BY (project_id IS NULL) LIMIT 1",
      [proyecto.id, proyecto.workspace_id],
    );
    if (viva) {
      return {
        listo: true,
        hallado: `conexion viva con ${viva.proveedor}, ${viva.project_id ? "de este proyecto" : "del espacio de trabajo"}`,
        comoConseguirlo: "",
      };
    }

    // EL GESTOR LOCAL NO NECESITA CONEXION EXTERNA (spec 003, US8, FR-035).
    //
    // Lo que esta guarda comprueba es una capacidad —alcanzar de donde salen
    // los tickets y donde se abre el PR— y desde FR-030 un proyecto puede
    // sacar sus tickets del propio servicio. Para ese proyecto la capacidad
    // YA ESTA: exigirle una conexion viva era exigirle conectar algo que no
    // va a usar, y fue lo que dejo proyectos del operador varados en
    // `CREATED` sin camino corto al board.
    //
    // EL ARTEFACTO SE VA A BUSCAR, como en todas las guardas: la secuencia de
    // claves del proyecto (`local_task_sequence`), que existe desde que el
    // proyecto declaro el gestor local o creo su primera tarea propia.
    //
    // Y EL LIMITE, que es la mitad que importa: un proyecto con un TRACKER
    // PROPIO declarado —en el estado que sea— no entra por aqui. El operador
    // dijo de donde salen sus tickets; si ese tracker no esta vivo, el rojo de
    // abajo lo dice, y tener tareas locales no lo tapa. Relajar la guarda para
    // el seria ejecutar tickets de otro sitio del que declaro.
    const local = base.consultarUno("SELECT prefijo FROM local_task_sequence WHERE project_id = ?", [proyecto.id]);
    const trackerPropio = base.consultarUno(
      "SELECT COUNT(*) AS n FROM connection WHERE project_id = ? AND clase = 'tracker'",
      [proyecto.id],
    );
    if (local && Number(trackerPropio.n) === 0) {
      return {
        listo: true,
        hallado:
          `el proyecto usa el gestor local (tareas propias, claves \`${local.prefijo}-<n>\`): sus tickets los ` +
          "lleva este servicio y no necesita ninguna conexion externa",
        comoConseguirlo: "",
      };
    }
    // El rojo cuenta LOS DOS ALCANCES. Decir "este proyecto no tiene ninguna
    // conexion" teniendo el espacio una `pendiente` manda a conectar otra vez
    // en vez de a terminar la que esta a medias.
    const otras = base.consultar(
      "SELECT estado, (project_id IS NULL) AS del_espacio, COUNT(*) AS n FROM connection " +
        "WHERE (project_id = ? OR (project_id IS NULL AND workspace_id = ?)) " +
        "GROUP BY estado, del_espacio",
      [proyecto.id, proyecto.workspace_id],
    );
    return {
      listo: false,
      hallado: otras.length
        ? `hay conexiones pero ninguna viva (${otras
            .map((f) => `${f.n} ${f.estado} ${f.del_espacio ? "del espacio de trabajo" : "de este proyecto"}`)
            .join(", ")})`
        : "ni este proyecto ni su espacio de trabajo tienen ninguna conexion",
      comoConseguirlo:
        "Conecta al menos un proveedor y comprueba la conexion hasta que quede `viva`. La cuenta de codigo se " +
        "conecta una vez para todo el espacio de trabajo —desde el alta de un proyecto o desde esta pantalla— y " +
        "un `tracker` puede ser de este proyecto. Una conexion `pendiente` es una que todavia no contesto: el " +
        "estado se escribe con la respuesta, no con la intencion.",
    };
  },

  flota_declarada(base, proyecto) {
    const agentes = base.consultar("SELECT rol, COUNT(*) AS n FROM agent WHERE project_id = ? GROUP BY rol", [
      proyecto.id,
    ]);
    if (agentes.length === 0) {
      return {
        listo: false,
        hallado: "este proyecto no tiene ningun agente declarado",
        comoConseguirlo:
          "Declara la flota del proyecto: al menos quien implementa y quien revisa, con runtimes distintos.",
      };
    }
    const roles = new Set(agentes.map((f) => String(f.rol)));
    if (!roles.has("implementador")) {
      return {
        listo: false,
        hallado: `la flota tiene ${agentes.map((f) => `${f.n} ${f.rol}`).join(", ")} y ningun implementador`,
        comoConseguirlo:
          "Declara al menos un agente con rol `implementador`: sin el, el proyecto no tiene quien escriba.",
      };
    }
    return {
      listo: true,
      hallado: `flota de ${agentes.map((f) => `${f.n} ${f.rol}`).join(", ")}`,
      comoConseguirlo: "",
    };
  },
};

/**
 * @param {import("./sqlite.mjs").BaseSqlite} base
 */
/**
 * @param {any} base
 * @param {{registrar: (e: any) => any}} [auditoria] el registro append-only, para que las transiciones dejen rastro
 */
export function repositorioDeProyectos(base, auditoria) {
  const leer = (id) => base.consultarUno("SELECT * FROM project WHERE id = ?", [id]);

  return {
    /** @param {Record<string, any>} datos */
    crear(datos) {
      const ahora = datos.ahora ? new Date(datos.ahora).toISOString() : new Date().toISOString();
      const fila = {
        id: datos.id ?? randomUUID(),
        workspace_id: datos.workspace_id,
        nombre: datos.nombre,
        slug: datos.slug,
        origen: datos.origen ?? "local",
        ruta_local: datos.ruta_local,
        remoto: datos.remoto ?? null,
        // Todo proyecto NACE en `CREATED`. No se acepta un estado inicial por
        // parametro: seria la puerta por la que un proyecto entra ya en
        // `ACTIVE` sin haber pasado por ninguna guarda.
        estado: "CREATED",
        autonomia: datos.autonomia ?? "L0",
        creado: ahora,
        actualizado: ahora,
      };
      base.escribir(
        "INSERT INTO project (id, workspace_id, nombre, slug, origen, ruta_local, remoto, estado, autonomia, " +
          "creado, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          fila.id,
          fila.workspace_id,
          fila.nombre,
          fila.slug,
          fila.origen,
          fila.ruta_local,
          fila.remoto,
          fila.estado,
          fila.autonomia,
          fila.creado,
          fila.actualizado,
        ],
      );
      return Object.freeze(fila);
    },

    porId(id) {
      const fila = leer(id);
      return fila ? Object.freeze({ ...fila }) : null;
    },

    porSlug(workspaceId, slug) {
      const fila = base.consultarUno("SELECT * FROM project WHERE workspace_id = ? AND slug = ?", [workspaceId, slug]);
      return fila ? Object.freeze({ ...fila }) : null;
    },

    listar(workspaceId) {
      return base
        .consultar("SELECT * FROM project WHERE workspace_id = ? ORDER BY actualizado DESC", [workspaceId])
        .map((f) => Object.freeze({ ...f }));
    },

    /** El estado de cada artefacto, para la pantalla que explica por que el proyecto no avanza. */
    artefactos(id) {
      const proyecto = leer(id);
      if (!proyecto) fallar("proyecto_desconocido", { id });
      /** @type {Record<string, any>} */
      const resultado = {};
      for (const [nombre, guarda] of Object.entries(GUARDAS)) resultado[nombre] = Object.freeze(guarda(base, proyecto));
      return Object.freeze(resultado);
    },

    /**
     * La unica via por la que `project.estado` cambia.
     *
     * @param {string} id
     * @param {string} hasta
     * @param {{actor: string, desde?: string, ahora?: number}} opciones
     */
    transicionar(id, hasta, opciones) {
      if (!ESTADOS.includes(hasta)) fallar("estado_desconocido", { estado: hasta, declarados: ESTADOS.join(", ") });

      return base.enTransaccion(() => {
        const proyecto = leer(id);
        if (!proyecto) fallar("proyecto_desconocido", { id });
        const desde = String(proyecto.estado);

        // El estado esperado por quien llama, si lo declaro. Es la mitad
        // lectora del compare-and-set: la interfaz leyo el proyecto hace medio
        // segundo y decide sobre lo que leyo.
        const esperado = opciones.desde ?? desde;
        if (esperado !== desde) fallar("escritor_concurrente", { esperado, actual: desde });

        const arista = TRANSICIONES.find((t) => t.desde === desde && t.hasta === hasta);
        if (!arista) {
          // Retroceder tiene su propia causa: "no se puede" y "no existe el
          // camino de vuelta, reabre la etapa" mandan al operador a sitios
          // distintos, y el segundo es el que resuelve.
          if (ESTADOS.indexOf(hasta) < ESTADOS.indexOf(desde)) fallar("retroceso_no_existe", { desde, hasta });
          const disponibles = transicionesDesde(desde).map((t) => `\`${t.hasta}\``);
          fallar("transicion_no_declarada", {
            desde,
            hasta,
            disponibles: disponibles.length ? disponibles.join(" o ") : "ningun estado: es terminal",
          });
        }

        if (arista.soloOrigen && proyecto.origen !== arista.soloOrigen) {
          fallar("atajo_solo_para_proyecto_nuevo", { origen: proyecto.origen });
        }

        if (arista.artefacto) {
          const veredicto = GUARDAS[arista.artefacto](base, proyecto);
          if (!veredicto.listo) {
            fallar("transicion_sin_artefacto", {
              desde,
              hasta,
              artefacto: arista.artefacto,
              hallado: veredicto.hallado,
              comoConseguirlo: veredicto.comoConseguirlo,
            });
          }
        }

        const ahora = opciones.ahora ? new Date(opciones.ahora).toISOString() : new Date().toISOString();
        // La escritura es CONDICIONAL sobre el estado que se leyo. Dentro de una
        // transaccion `IMMEDIATE` ya no deberia poder cambiar nadie, pero la
        // condicion es gratis y convierte un fallo silencioso —cero filas
        // afectadas, nadie mira el resultado— en un error con nombre.
        const { cambios } = base.escribir(
          "UPDATE project SET estado = ?, actualizado = ? WHERE id = ? AND estado = ?",
          [hasta, ahora, id, desde],
        );
        if (cambios !== 1) fallar("escritor_concurrente", { esperado: desde, actual: "otro" });

        // LA TRANSICION DEJA RASTRO, y esto faltaba entero.
        //
        // `project.estado` guarda DONDE esta el proyecto, no COMO llego. Sin
        // esta fila, "paso por los seis estados en orden" no es una pregunta
        // que se pueda responder despues: solo se puede observar en vivo, y
        // quien mira la aplicacion tres semanas mas tarde no estaba mirando.
        //
        // Lo encontro el recorrido de punta a punta, al intentar demostrar
        // justo eso y descubrir que el producto no lo soporta.
        //
        // Va a la auditoria y no a una tabla de historia propia por una razon
        // concreta: `audit_event` NO CUELGA DE NINGUNA CLAVE FORANEA, asi que
        // borrar el proyecto no se lleva por delante la explicacion de lo que
        // paso con el. Una tabla de historia con `REFERENCES project(id)` se
        // se habria ido con la cascada justo cuando mas falta hace.
        //
        // `?.` y no obligatorio: el repositorio se monta tambien en pruebas que
        // no necesitan auditoria, y exigirla ahi convertiria un test de
        // transiciones en un test de auditoria.
        auditoria?.registrar({
          actor: opciones.actor,
          accion: "proyecto.transicion",
          objeto_tipo: "project",
          objeto_id: id,
          resultado: "permitido",
          detalle: { desde, hasta, artefacto: arista.artefacto ?? null },
          instante: ahora,
        });

        return Object.freeze({ ...leer(id) });
      });
    },
  };
}
