// Etapas 02-05 sobre `packages/core`: constitution, guidelines, diseño y
// bootstrap.
//
// ESTE ARCHIVO NO DECIDE CASI NADA, Y ESO ES LO QUE TIENE QUE HACER. Las dos
// reglas que importan viven en el nucleo y aqui solo se cablean:
//
//   - `amend` sin los tres campos es 400. `validarEnmienda` lo lanza con su
//     causa citando la regla, y el nucleo ya trae el `estado` HTTP puesto,
//     porque el contrato de la API fija ese codigo y el dominio es quien sabe
//     cual corresponde. Este archivo traduce; no decide.
//   - `apply` con el arbol cambiado es `diff_obsoleto`. Tampoco se comprueba
//     aqui: `aplicar` recibe la recomendacion —que lleva el contenido exacto y
//     la huella de la base— y compara. La garantia no es que este servicio se
//     abstenga de recalcular: es que `aplicar` no tiene con que.
//
// POR QUE EL ARBOL ES `arbolDeDisco(proyecto.ruta_local)` Y NO UNA RUTA SUELTA.
// Porque `rutaSegura` vive dentro y corta los `..`: una recomendacion —o una
// personalizacion mandada a mano— que apunte fuera del proyecto escribiria en
// el disco del operador desde una peticion HTTP. Es la unica defensa, y esta
// puesta en el sitio por el que pasan todas las escrituras.

import {
  analizar,
  aplicar,
  aplicarEnmienda,
  aplicarLote,
  arbolDeDisco,
  AREAS,
  crearGuideline,
  definirDiseno,
  etapaDeDiseno,
  fijarConstitution,
  guardarGuideline,
  omitir,
  omitirDiseno,
  personalizar,
  proponerBootstrap,
  proponerConstitution,
  RUTA_POR_DEFECTO,
  rutaDeGuideline,
  validarEnmienda,
} from "../../core/src/index.mjs";

import { coleccion, exigir, exigirProyecto, noEsta } from "./comun.mjs";
import { ErrorDeServicio } from "./errores.mjs";

/** Donde se pide volver a calcular cuando una recomendacion ya no esta. */
const DONDE_SE_ANALIZA = "`POST /v1/projects/:id/bootstrap/analyze`, que vuelve a calcular el analisis";

/**
 * El snapshot completo de un proyecto, con sus hallazgos, en la forma que el
 * nucleo espera. El nucleo no conoce el almacen: recibe el objeto.
 *
 * @param {any} dep
 * @param {any} proyecto
 */
function snapshotDelNucleo(dep, proyecto) {
  const fila = dep.almacen.base.consultarUno(
    "SELECT * FROM project_snapshot WHERE project_id = ? AND estado = 'completo' ORDER BY creado DESC LIMIT 1",
    [proyecto.id],
  );
  if (!fila) {
    throw noEsta("snapshot completo", proyecto.id, "`POST /v1/projects/:id/scan`", `el proyecto \`${proyecto.nombre}\``);
  }
  const hallazgos = dep.almacen.snapshots.hallazgos(fila.id).map((/** @type {any} */ h) => ({
    categoria: h.categoria,
    clave: h.clave,
    // Lo que vale es lo que el operador CORRIGIO cuando corrigio. Derivar la
    // constitution del valor original despues de que alguien lo arreglo a mano
    // es ignorar la unica correccion humana que hubo en todo el recorrido.
    valor: h.valor_corregido === null ? JSON.parse(String(h.valor)) : JSON.parse(String(h.valor_corregido)),
    origen: h.origen,
    evidencia: JSON.parse(String(h.evidencia)),
    confianza: h.confianza,
    decision: h.decision,
  }));
  return { ...fila, estado: "completo", hallazgos };
}

/** @param {any} proyecto */
const arbolDe = (proyecto) => arbolDeDisco(proyecto.ruta_local);

/**
 * Los invariantes declarados al fijar la constitution, por `constitution_id`.
 *
 * POR QUE ESTAN AQUI Y NO EN EL ALMACEN, Y POR QUE IMPORTA MAS QUE LOS
 * APARTADOS. Por el mismo motivo: la tabla `constitution` guarda el documento y
 * no tiene columna para ellos. Pero el precio es mayor. Los invariantes son el
 * dato contra el que el bootstrap contrasta cada recomendacion (FR-028); sin
 * ellos, `invariantesDe` solo puede derivar el implicito —que el bootstrap no
 * reescriba la propia constitution— y CUALQUIER otro conflicto declarado por el
 * operador deja de detectarse. No falla: propone la recomendacion sin marcarla,
 * que es exactamente el caso que FR-028 existe para impedir.
 *
 * Leerlos de aqui los mantiene vivos mientras vive el proceso, que es lo unico
 * que este paquete puede hacer sin decidir el esquema de otro. La columna que
 * falta va en el informe de esta tarea, igual que la de los apartados.
 *
 * @type {Map<string, any[]>}
 */
const invariantesPorConstitution = new Map();

/**
 * La constitution vigente con sus invariantes, si se declararon en esta sesion.
 *
 * @param {any} dep
 * @param {string} project_id
 */
function constitutionParaElBootstrap(dep, project_id) {
  const vigente = dep.nucleo.constitutionVigente(project_id);
  if (!vigente) return null;
  const invariantes = invariantesPorConstitution.get(vigente.id);
  return invariantes ? { ...vigente, invariantes } : vigente;
}

/**
 * El bootstrap, analizado SOLO en cuanto la constitution queda fijada.
 *
 * POR QUE SE DISPARA AQUI Y NO SE ESPERA A QUE LO PIDAN. Porque pedir el
 * analisis nunca fue una decision: es trabajo. Todo lo que hace falta para
 * calcularlo —el snapshot, el arbol y la constitution— ya esta sobre la mesa
 * justo en este instante, y el operador no tiene forma de saber que existe una
 * pantalla que hay que ir a buscar. Lo que se automatiza es el calculo.
 *
 * LO QUE ESTO NO HACE, Y ES LA MITAD QUE IMPORTA: no escribe. `analizar` no
 * toca el arbol —ni un archivo, ni un temporal, ni una cache— y esta ruta
 * tampoco. FR-026 sigue entero: la propuesta llega calculada y espera una
 * aprobacion explicita con el diff exacto delante.
 *
 * POR QUE NO SE PROPAGA EL ERROR SI NO HAY SNAPSHOT. Porque el `PUT` que lo
 * llamo venia a fijar la constitution y eso ya se hizo y se escribio. Tumbar la
 * respuesta por una etapa que ni siquiera se habia pedido dejaria al operador
 * creyendo que la constitution no quedo fijada, que es falso y peor. Se
 * devuelve el aviso con la causa y la accion.
 *
 * @param {any} p
 * @param {any} proyecto
 * @returns {{propuesta: any}|{aviso: any}}
 */
function analizarSolo(p, proyecto) {
  try {
    const analisis = analizar({
      snapshot: snapshotDelNucleo(p.dep, proyecto),
      arbol: arbolDe(proyecto),
      constitution: constitutionParaElBootstrap(p.dep, proyecto.id),
      project_id: proyecto.id,
      repositorio: p.dep.nucleo,
    });
    return { propuesta: proponerBootstrap(analisis) };
  } catch (e) {
    const error = /** @type {any} */ (e);
    return {
      aviso: {
        codigo: "bootstrap_no_analizado",
        causa:
          "la constitution quedo fijada, pero el bootstrap no se pudo analizar solo: " +
          `${error.causa ?? error.message}`,
        accion:
          error.accion ??
          "Corre el escaneo del proyecto y acepta el snapshot; despues pide `GET /v1/projects/:id/bootstrap/proposal`.",
      },
    };
  }
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function proponer(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  const snapshot = snapshotDelNucleo(p.dep, proyecto);
  return { cuerpo: { propuesta: proponerConstitution({ snapshot, proyecto }) } };
}

/**
 * Los apartados con su origen, si el servicio los tiene.
 *
 * POR QUE VAN APARTE DEL MARKDOWN, Y ES LA PARTE QUE MAS IMPORTA. El origen de
 * cada apartado —`detectado`, `inferido` o `vacio`— NO SE PUEDE DEDUCIR DE LA
 * PROSA. Deducirlo seria exactamente el contexto inventado que prohibe el
 * principio X, y el precio aqui no es una pantalla mal dibujada: un apartado
 * inferido que llega marcado como detectado se convierte en la regla del
 * proyecto y el runtime la aplica durante meses sin que nadie la revise.
 *
 * POR QUE PUEDEN FALTAR, Y POR QUE ESO SE DICE EN VEZ DE RELLENARSE. El esquema
 * del almacen guarda la constitution como `contenido` y no tiene columna para
 * los apartados, asi que hoy solo viven mientras vive el proceso. Tras un
 * reinicio, esta ruta devuelve la constitution SIN `apartados` — y el contrato
 * declara justo eso: la interfaz dice "el origen de cada parte no viene en la
 * respuesta" en vez de pintar marcas que no tiene. La columna que falta va en
 * el informe de esta tarea.
 *
 * @type {Map<string, any[]>}
 */
const apartadosPorConstitution = new Map();

/** @param {import("./rutas.mjs").Peticion} p */
export async function constitution(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  if (p.metodo === "GET") {
    const vigente = p.dep.nucleo.constitutionVigente(proyecto.id);
    if (!vigente) {
      throw noEsta(
        "constitution vigente",
        proyecto.id,
        "`PUT /v1/projects/:id/constitution`, que la fija",
        `el proyecto \`${proyecto.nombre}\``,
      );
    }
    const apartados = apartadosPorConstitution.get(vigente.id) ?? null;
    return {
      cuerpo: {
        constitution: {
          ...vigente,
          markdown: vigente.contenido,
          // La clave NO ESTA cuando no se conocen, en vez de estar con una
          // lista vacia: `[]` significa "no tiene apartados" y ausente
          // significa "no se sabe cual es el origen de cada parte". Son cosas
          // distintas y la interfaz tiene que poder decirlas distinto.
          ...(apartados ? { apartados } : {}),
        },
        enmiendas: p.dep.nucleo.enmiendas(proyecto.id),
        historial: p.dep.nucleo.constituciones(proyecto.id).map((/** @type {any} */ c) => ({
          id: c.id,
          version: c.version,
          ratificada: c.ratificada,
          vigente: c.vigente,
        })),
        ...(apartados
          ? {}
          : {
              avisos: [
                {
                  codigo: "apartados_no_persistidos",
                  causa:
                    "esta constitution se devuelve sin `apartados`: el almacen guarda el documento pero todavia " +
                    "no tiene donde guardar el origen de cada apartado, asi que se pierde al reiniciar el servicio.",
                  accion:
                    "Vuelve a fijar la constitution con `apartados` para recuperarlos en esta sesion. No deduzcas " +
                    "el origen del texto: un apartado inferido leido como detectado se aplica durante meses.",
                },
              ],
            }),
      },
    };
  }

  const cuerpo = await p.cuerpo();
  // `markdown` es el nombre del contrato. `contenido` se sigue aceptando porque
  // es como se llama el campo dentro del nucleo y del almacen, y romper a quien
  // ya lo manda no compra nada.
  const markdown = cuerpo.markdown ?? cuerpo.contenido;
  exigir(
    { markdown },
    ["markdown"],
    "La constitution vive versionada en el repositorio: sin el documento no hay nada que fijar.",
  );

  const apartados = validarApartados(cuerpo.apartados);

  const salida = fijarConstitution({
    project_id: proyecto.id,
    contenido: markdown,
    ruta_en_repo: cuerpo.ruta_en_repo ?? RUTA_POR_DEFECTO,
    arbol: arbolDe(proyecto),
    repositorio: p.dep.nucleo,
    version: cuerpo.version ?? "1.0.0",
    invariantes: cuerpo.invariantes ?? [],
    sobreescribir: cuerpo.sobreescribir === true,
  });

  if (apartados) apartadosPorConstitution.set(salida.constitution.id, apartados);
  // Los invariantes viajan con la constitution al nucleo, pero el almacen no
  // tiene donde guardarlos. Ver la cabecera de `invariantesPorConstitution`:
  // sin esto, FR-028 solo detectaria el conflicto implicito.
  if (Array.isArray(salida.constitution.invariantes) && salida.constitution.invariantes.length > 0) {
    invariantesPorConstitution.set(salida.constitution.id, [...salida.constitution.invariantes]);
  }

  p.estado.bus.emitir(
    "proyecto.estado",
    { estado: salida.proyecto.estado, motivo: `constitution ${salida.constitution.version} fijada` },
    { project_id: proyecto.id },
  );

  // El bootstrap se analiza SOLO. Ver la cabecera de `analizarSolo`.
  const automatico = analizarSolo(p, proyecto);
  if ("propuesta" in automatico) {
    p.estado.bus.emitir(
      "bootstrap.propuesta",
      {
        snapshot_id: automatico.propuesta.snapshot_id,
        decisiones: automatico.propuesta.decisiones,
        en_bloque: automatico.propuesta.lote.recomendaciones.length,
        aparte: automatico.propuesta.aparte.length,
        preguntas: automatico.propuesta.preguntas.length,
      },
      { project_id: proyecto.id },
    );
  }

  return {
    cuerpo: {
      ...salida,
      constitution: {
        ...salida.constitution,
        markdown: salida.constitution.contenido,
        ...(apartados ? { apartados } : {}),
      },
      // O la propuesta, o el aviso de por que no la hay. Nunca las dos ni
      // ninguna: una respuesta muda aqui se lee como «el bootstrap no aplica a
      // este proyecto», que es una conclusion que nadie saco.
      ...("propuesta" in automatico ? { propuesta: automatico.propuesta } : { avisos: [automatico.aviso] }),
    },
  };
}

/**
 * Los apartados, comprobados uno a uno.
 *
 * EL CAMPO QUE SE VALIDA DE VERDAD ES `origen`. Un apartado que llega sin el, o
 * con uno que no es ninguno de los tres, no se puede guardar "como venga": lo
 * que la pantalla pinte encima sera una marca que nadie puso. Y un `detectado`
 * sin evidencia es la misma regla que el almacen ya impone sobre los hallazgos
 * —FR-013, un detectado sin la ruta que lo respalda es una opinion— aplicada
 * aqui, que es el otro sitio por el que ese dato entra al proyecto.
 *
 * @param {any} crudos
 * @returns {any[]|null} `null` cuando no vinieron, que es distinto de que esten vacios
 */
function validarApartados(crudos) {
  if (crudos === undefined || crudos === null) return null;
  if (!Array.isArray(crudos)) {
    throw new ErrorDeServicio("cuerpo_invalido", {
      detalle: "`apartados` tiene que ser una lista de `{clave, contenido, origen, evidencia}`",
      campos: ["apartados"],
    });
  }

  const ORIGENES = ["detectado", "inferido", "vacio"];
  const problemas = [];
  for (const [i, apartado] of crudos.entries()) {
    const donde = `apartados[${i}]${apartado && apartado.clave ? ` (\`${apartado.clave}\`)` : ""}`;
    if (!apartado || typeof apartado !== "object") {
      problemas.push(`${donde}: no es un objeto`);
      continue;
    }
    if (!apartado.clave) problemas.push(`${donde}: sin \`clave\``);
    if (!ORIGENES.includes(apartado.origen)) {
      problemas.push(`${donde}: \`origen\` vale ${JSON.stringify(apartado.origen)} y tiene que ser uno de ${ORIGENES.join(", ")}`);
    }
    if (apartado.origen === "detectado" && !(Array.isArray(apartado.evidencia) && apartado.evidencia.length > 0)) {
      problemas.push(`${donde}: se declara \`detectado\` sin evidencia, y un detectado sin la ruta que lo respalda es una opinion`);
    }
  }

  if (problemas.length > 0) {
    throw new ErrorDeServicio("cuerpo_invalido", {
      detalle: `los apartados no se pueden guardar tal como llegaron — ${problemas.join("; ")}`,
      campos: ["apartados"],
      opciones: ORIGENES,
    });
  }

  return crudos;
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function enmendar(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  const cuerpo = await p.cuerpo();

  // Los tres campos ANTES de tocar nada. `validarEnmienda` lanza el 400 con la
  // causa que cita la regla —"una enmienda sin un fallo detras no es una
  // enmienda: es una preferencia"— y con su `estado` puesto.
  validarEnmienda(cuerpo);

  const salida = aplicarEnmienda({
    project_id: proyecto.id,
    datos: cuerpo,
    arbol: arbolDe(proyecto),
    repositorio: p.dep.nucleo,
  });

  return { cuerpo: salida };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function guideline(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  const area = p.parametros.area;

  if (!AREAS.includes(area)) {
    throw new ErrorDeServicio("cuerpo_invalido", {
      detalle:
        `\`${area}\` no es un area de guidelines. Las declaradas son ${AREAS.map((a) => `\`${a}\``).join(", ")}, ` +
        "y la lista es cerrada porque cada area se compila al contexto de un tipo de tarea distinto",
      campos: ["area"],
      opciones: AREAS,
    });
  }

  if (p.metodo === "GET") {
    const guardada = p.dep.nucleo.guideline(proyecto.id, area);
    if (!guardada) {
      throw noEsta(
        `guideline de \`${area}\``,
        proyecto.id,
        `\`PUT /v1/projects/:id/guidelines/${area}\``,
        `el proyecto \`${proyecto.nombre}\``,
      );
    }
    return { cuerpo: { guideline: guardada } };
  }

  const cuerpo = await p.cuerpo();
  exigir(cuerpo, ["contenido"]);

  const vigente = p.dep.nucleo.constitutionVigente(proyecto.id);
  const nueva = crearGuideline({
    project_id: proyecto.id,
    area,
    contenido: cuerpo.contenido,
    reglas: cuerpo.reglas ?? [],
    ruta_en_repo: cuerpo.ruta_en_repo ?? rutaDeGuideline(area, vigente ? vigente.ruta_en_repo : RUTA_POR_DEFECTO),
  });

  const salida = guardarGuideline({ guideline: nueva, arbol: arbolDe(proyecto), repositorio: p.dep.nucleo });
  return { cuerpo: salida };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function diseno(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  const cuerpo = await p.cuerpo();

  // FR-023: omitirla no bloquea. El nucleo devuelve `bloquea: false` y
  // `penalizacion: null` SIEMPRE, y esos dos campos viajan a la respuesta
  // porque son el contrato: una etapa opcional que la interfaz pinta en rojo
  // deja de ser opcional en la practica.
  if (cuerpo.omitir === true) {
    const salida = omitirDiseno({ project_id: proyecto.id, motivo: cuerpo.motivo ?? null, repositorio: p.dep.nucleo });
    return { cuerpo: { ...salida, etapa: etapaDeDiseno(p.dep.nucleo, proyecto.id) } };
  }

  exigir(cuerpo, ["contenido"], "O manda `contenido`, o manda `omitir: true` — omitirla no bloquea ni penaliza.");
  const vigente = p.dep.nucleo.constitutionVigente(proyecto.id);
  const salida = definirDiseno({
    project_id: proyecto.id,
    contenido: cuerpo.contenido,
    reglas: cuerpo.reglas ?? [],
    arbol: arbolDe(proyecto),
    repositorio: p.dep.nucleo,
    ruta_en_repo: cuerpo.ruta_en_repo ?? rutaDeGuideline("diseno", vigente ? vigente.ruta_en_repo : RUTA_POR_DEFECTO),
  });
  return { cuerpo: { ...salida, etapa: etapaDeDiseno(p.dep.nucleo, proyecto.id) } };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function analizarBootstrap(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  const snapshot = snapshotDelNucleo(p.dep, proyecto);

  const analisis = analizar({
    snapshot,
    arbol: arbolDe(proyecto),
    constitution: constitutionParaElBootstrap(p.dep, proyecto.id),
    project_id: proyecto.id,
    repositorio: p.dep.nucleo,
  });

  return { cuerpo: { analisis } };
}

/**
 * La propuesta completa: el bloque que se aprueba de una vez, lo que se decide
 * solo, lo que hay que preguntar y lo que ya estaba.
 *
 * VUELVE A ANALIZAR, y no reusa lo guardado, por el mismo motivo por el que
 * `apply` no recalcula: el diff que se muestra tiene que ser el diff contra el
 * arbol de AHORA. Una propuesta armada con recomendaciones de hace dos horas se
 * ve igual de bien y choca contra `diff_obsoleto` al aprobarla — o peor, deja
 * de chocar el dia que alguien "optimice" la comprobacion.
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function propuestaDeBootstrap(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  const analisis = analizar({
    snapshot: snapshotDelNucleo(p.dep, proyecto),
    arbol: arbolDe(proyecto),
    constitution: constitutionParaElBootstrap(p.dep, proyecto.id),
    project_id: proyecto.id,
    repositorio: p.dep.nucleo,
  });
  return { cuerpo: { propuesta: proponerBootstrap(analisis) } };
}

/**
 * Aprueba el bloque entero: UNA decision del operador, todas sus escrituras.
 *
 * LOS IDS SON OBLIGATORIOS Y NO ES BUROCRACIA. Un «aplica todo lo pendiente»
 * aplica tambien lo que se calculo DESPUES de que el operador mirara la
 * pantalla: otra ventana, otro analisis, una recomendacion que el no vio. Lo
 * que se escribe tiene que ser lo que se mostro, y los ids son la unica forma
 * de decir cual fue.
 *
 * LAS TRES GUARDAS VIVEN EN EL NUCLEO. `aplicarLote` comprueba que ninguna
 * exige mirarse (FR-028), que ninguna pisa a otra, y que el arbol no se movio
 * bajo NINGUNA antes de escribir la primera. Este archivo traduce; no decide.
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function aprobarBootstrap(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  const cuerpo = await p.cuerpo();
  const ids = cuerpo.recomendaciones ?? cuerpo.ids;

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ErrorDeServicio("cuerpo_invalido", {
      detalle:
        "`recomendaciones` tiene que traer los ids que la propuesta mostro. No hay «aplica todo lo pendiente»: " +
        "eso aplicaria tambien lo que se calculo despues de que el operador mirara la pantalla —otra ventana, " +
        "otro analisis— y lo que se escribe tiene que ser exactamente lo que se mostro",
      campos: ["recomendaciones"],
    });
  }

  const recomendaciones = ids.map((/** @type {string} */ id) => {
    const guardada = p.dep.nucleo.recomendacion(id);
    if (!guardada) throw noEsta("recomendacion", id, DONDE_SE_ANALIZA);
    if (guardada.project_id !== proyecto.id) {
      // Un id de otro proyecto dentro del bloque escribiria en un repositorio
      // que esta aprobacion no menciona.
      throw noEsta("recomendacion", id, DONDE_SE_ANALIZA, `el proyecto \`${proyecto.nombre}\``);
    }
    return guardada;
  });

  const salida = aplicarLote(
    { lote: { recomendaciones } },
    { arbol: arbolDe(proyecto), repositorio: p.dep.nucleo, motivo: cuerpo.motivo ?? null },
  );

  p.estado.bus.emitir(
    "bootstrap.lote.aplicado",
    {
      recomendaciones: salida.aplicadas.map((/** @type {any} */ r) => r.id),
      escrituras: salida.escrituras,
      sin_cambios: salida.sin_cambios,
    },
    { project_id: proyecto.id },
  );

  return { cuerpo: salida };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function recomendaciones(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  // El `diff` que sale de aqui es EL que se va a escribir. `apply` no
  // recalcula: recibe esta misma recomendacion. Si el arbol cambio desde que se
  // calculo, `apply` falla con `diff_obsoleto` y pide recalcular — nunca
  // escribe algo distinto de lo que se devolvio aqui.
  return { cuerpo: coleccion(p.dep.nucleo.recomendaciones(proyecto.id)) };
}

/**
 * @param {import("./rutas.mjs").Peticion} p
 * @returns {{recomendacion: any, proyecto: any}}
 */
function recomendacionYProyecto(p) {
  const recomendacion = p.dep.nucleo.recomendacion(p.parametros.id);
  if (!recomendacion) throw noEsta("recomendacion", p.parametros.id, DONDE_SE_ANALIZA);
  const proyecto = exigirProyecto(p.dep, recomendacion.project_id);
  return { recomendacion, proyecto };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function aplicarRecomendacion(p) {
  const { recomendacion, proyecto } = recomendacionYProyecto(p);
  const cuerpo = await p.cuerpo();

  const salida = aplicar(recomendacion, {
    arbol: arbolDe(proyecto),
    repositorio: p.dep.nucleo,
    motivo: cuerpo.motivo ?? null,
    // Aceptar un conflicto con la constitution es una decision del operador y
    // tiene que venir dicha: por defecto, una recomendacion que choca con un
    // invariante NO se aplica.
    conflicto_aceptado: cuerpo.conflicto_aceptado === true,
  });

  p.estado.bus.emitir(
    "recomendacion.aplicada",
    { recomendacion_id: recomendacion.id, escrituras: salida.escrituras, sin_cambios: salida.sin_cambios },
    { project_id: proyecto.id },
  );

  return { cuerpo: salida };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function personalizarRecomendacion(p) {
  const { recomendacion, proyecto } = recomendacionYProyecto(p);
  const cuerpo = await p.cuerpo();
  const cambios = cuerpo.diff_modificado ?? cuerpo.cambios_modificados;

  if (!Array.isArray(cambios) || cambios.length === 0) {
    throw new ErrorDeServicio("cuerpo_invalido", {
      detalle:
        "`diff_modificado` tiene que ser una lista de `{ruta, contenido}` con al menos un cambio. Personalizar " +
        "cambia el CONTENIDO de lo que ya estaba en el diff, nunca su alcance: una ruta que el diff no tenia " +
        "es una escritura que el operador no reviso",
      campos: ["diff_modificado"],
    });
  }

  const salida = personalizar(recomendacion, {
    arbol: arbolDe(proyecto),
    repositorio: p.dep.nucleo,
    cambios_modificados: cambios,
    motivo: cuerpo.motivo ?? null,
    conflicto_aceptado: cuerpo.conflicto_aceptado === true,
  });

  p.estado.bus.emitir(
    "recomendacion.aplicada",
    { recomendacion_id: recomendacion.id, escrituras: salida.escrituras, personalizada: true },
    { project_id: proyecto.id },
  );

  return { cuerpo: salida };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function omitirRecomendacion(p) {
  const { recomendacion } = recomendacionYProyecto(p);
  const cuerpo = await p.cuerpo();
  // El motivo no es obligatorio, y la decision es deliberada: exigirlo
  // convierte "no lo quiero" en "escribe algo aqui", y lo que se escribe
  // entonces es ruido. Lo que informa la evolucion es el motivo de quien
  // quiso darlo, no el que alguien tuvo que inventar para poder seguir.
  return { cuerpo: omitir(recomendacion, { repositorio: p.dep.nucleo, motivo: cuerpo.motivo ?? null }) };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function completarBootstrap(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  // Otra vez: la guarda esta en el almacen y VA A BUSCAR. Cuenta cuantas
  // recomendaciones quedan sin decidir y se niega diciendo cuantas. Nada se
  // escribe sin decision, y una pendiente no se aplica sola al avanzar.
  const actualizado = p.dep.almacen.proyectos.transicionar(proyecto.id, "BOOTSTRAPPED", { actor: "operador" });
  p.estado.bus.emitir(
    "proyecto.estado",
    { estado: actualizado.estado, motivo: "bootstrap completado" },
    { project_id: proyecto.id },
  );
  return { cuerpo: { proyecto: actualizado } };
}

// ---------------------------------------------------------------------------
// El modo rapido (spec 003, US8): las etapas 02 y 05 decididas por UNA sola
// decision del operador, sin escribir en su repositorio.
// ---------------------------------------------------------------------------

/**
 * Un arbol que LEE del disco y NO ESCRIBE: anota lo que se habria escrito.
 *
 * POR QUE EXISTE. `fijarConstitution` escribe el documento en el repositorio
 * (FR-021: vive versionada junto al codigo), y eso esta bien cuando el
 * operador pulso «Fijar» con el documento delante. En el modo rapido pulso
 * «Activar»: decidio llegar al board, no escribir un archivo en su repo. Nada
 * se escribe sin decision explicita, asi que la constitution queda en el
 * almacen —que es lo que la guarda `constitution_vigente` mira— y lo que no se
 * escribio se DEVUELVE para decirlo como hueco, en vez de callarlo.
 *
 * @param {any} proyecto
 */
function arbolQueNoEscribe(proyecto) {
  const disco = arbolDe(proyecto);
  /** @type {string[]} */
  const noEscritas = [];
  return {
    noEscritas,
    arbol: {
      raiz: disco.raiz,
      existe: disco.existe,
      leer: disco.leer,
      escribir: (/** @type {string} */ ruta) => {
        noEscritas.push(ruta);
      },
    },
  };
}

/**
 * Fija la constitution MINIMA que el nucleo sabe derivar del snapshot aceptado,
 * sin escribirla en el repositorio. Pasa por `fijarConstitution` —la misma via
 * que el `PUT`— asi que la transicion la sigue juzgando el almacen.
 *
 * `sobreescribir: true` NO pisa nada: el arbol de arriba no escribe. Sin el,
 * un repositorio que ya trae su constitution en esa ruta haria fallar el modo
 * rapido por un archivo que este camino ni siquiera iba a tocar.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} proyecto
 */
export function fijarConstitutionMinima(p, proyecto) {
  const snapshot = snapshotDelNucleo(p.dep, proyecto);
  const propuesta = proponerConstitution({ snapshot, proyecto });
  const { arbol, noEscritas } = arbolQueNoEscribe(proyecto);

  const salida = fijarConstitution({
    project_id: proyecto.id,
    contenido: propuesta.documento,
    ruta_en_repo: propuesta.ruta_en_repo,
    arbol,
    repositorio: p.dep.nucleo,
    version: propuesta.version,
    sobreescribir: true,
  });

  // El origen de cada apartado viaja como lo produjo el nucleo, igual que en el
  // `PUT` del asistente: un inferido nunca se guarda como detectado.
  apartadosPorConstitution.set(
    salida.constitution.id,
    propuesta.apartados.map((/** @type {any} */ a) => ({
      clave: a.id,
      contenido: a.contenido ?? "",
      origen: a.origen,
      evidencia: a.evidencia ?? [],
    })),
  );

  p.estado.bus.emitir(
    "proyecto.estado",
    { estado: salida.proyecto.estado, motivo: `constitution ${salida.constitution.version} fijada por el modo rapido` },
    { project_id: proyecto.id },
  );

  return {
    constitution: { id: salida.constitution.id, version: salida.constitution.version, ruta_en_repo: salida.constitution.ruta_en_repo },
    proyecto: salida.proyecto,
    noEscritas,
    vacios: propuesta.apartados.filter((/** @type {any} */ a) => a.origen === "vacio").map((/** @type {any} */ a) => a.id),
  };
}

/**
 * Resuelve el bootstrap OMITIENDO cada recomendacion pendiente, con motivo.
 *
 * OMITIR Y NO APLICAR. Aplicar escribe en el repositorio del operador, y el
 * modo rapido no tiene la decision de escribir (FR-026 de la 002). Omitir es
 * una decision registrada —con su motivo, en la base y en la historia de la
 * recomendacion— que el operador puede revisar despues desde Settings ->
 * Bootstrap: `analyze` vuelve a proponer lo que se omitio.
 *
 * Si todavia no hay ninguna recomendacion, se ANALIZA primero: la guarda
 * distingue «no corrio» de «corrio y todo quedo decidido», y el modo rapido no
 * puede fingir lo segundo.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} proyecto
 * @param {string} motivo
 */
export function resolverBootstrapOmitiendo(p, proyecto, motivo) {
  const base = p.dep.almacen.base;
  const contar = () => Number(base.consultarUno("SELECT COUNT(*) AS n FROM recommendation WHERE project_id = ?", [proyecto.id]).n);

  let analizado = false;
  if (contar() === 0) {
    analizar({
      snapshot: snapshotDelNucleo(p.dep, proyecto),
      arbol: arbolDe(proyecto),
      constitution: constitutionParaElBootstrap(p.dep, proyecto.id),
      project_id: proyecto.id,
      repositorio: p.dep.nucleo,
    });
    analizado = true;
  }

  let omitidas = 0;
  // Primero por el nucleo, que deja la decision en la historia de la
  // recomendacion en memoria ademas de en la base.
  for (const rec of p.dep.nucleo.recomendaciones(proyecto.id)) {
    if (rec.decision !== "pendiente") continue;
    omitir(rec, { repositorio: p.dep.nucleo, motivo });
    omitidas++;
  }
  // Y lo que quede pendiente en la base sin copia en memoria —un analisis de
  // antes de reiniciar el servicio— se decide directo en el almacen: la guarda
  // cuenta filas, y una fila pendiente huerfana bloquearia la etapa para
  // siempre.
  const huerfanas = base.consultar("SELECT id FROM recommendation WHERE project_id = ? AND decision = 'pendiente'", [proyecto.id]);
  for (const fila of huerfanas) {
    p.dep.almacen.recomendaciones.decidir(String(fila.id), { decision: "omitida", motivo_decision: motivo });
    omitidas++;
  }

  return { analizado, total: contar(), omitidas };
}
