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

  p.estado.bus.emitir(
    "proyecto.estado",
    { estado: salida.proyecto.estado, motivo: `constitution ${salida.constitution.version} fijada` },
    { project_id: proyecto.id },
  );

  return {
    cuerpo: {
      ...salida,
      constitution: {
        ...salida.constitution,
        markdown: salida.constitution.contenido,
        ...(apartados ? { apartados } : {}),
      },
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
    constitution: p.dep.nucleo.constitutionVigente(proyecto.id),
    project_id: proyecto.id,
    repositorio: p.dep.nucleo,
  });

  return { cuerpo: { analisis } };
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
