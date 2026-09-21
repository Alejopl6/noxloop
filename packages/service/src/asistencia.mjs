// La asistencia con IA, cableada: `packages/asistencia` propone, la boveda
// guarda la clave, el nucleo decide que es verificable, y este archivo no
// decide nada.
//
// LO QUE ESTA RUTA HACE Y LO QUE NO. Devuelve un borrador. No escribe la
// guideline, no fija la constitution, no guarda nada en el almacen: hay una
// prueba que mide el arbol del proyecto antes y despues de sugerir. Para que el
// borrador se convierta en algo hace falta el `PUT` que ya existe, con una
// persona delante. Un `POST` que ademas guardase seria la puerta por la que una
// propuesta de modelo se convierte en la regla del proyecto sin que nadie la
// confirme.
//
// POR QUE ES `POST` Y NO `GET`, SI SUGERIR NO GUARDA. Porque sugerir GASTA:
// saca una credencial de la boveda, deja un evento en la auditoria y llama a un
// servicio de fuera que cobra. Un `GET` con esas tres cosas detras se lo come
// cualquier cliente que reintente, cualquier precarga y cualquier pestaña que
// se refresque. La flota usa `GET` para su sugerencia porque la suya es un
// calculo local y gratis; esta no lo es.
//
// POR QUE LA CLAVE ES UNA CREDENCIAL Y NO UNA VARIABLE DE ENTORNO. Una clave en
// el entorno del servicio alcanza a todo lo que el servicio hace, no caduca, no
// se puede revocar sin reiniciar y no deja rastro de quien la uso ni para que.
// Aqui pasa por el mismo camino que cualquier otro secreto del producto: se da
// de alta en `/v1/credentials` con `tipo: "modelo"`, se autoriza con un grant, y
// se recupera con un motivo que la auditoria escribe ANTES de devolver el valor.
//
// POR QUE LA VIGENCIA SE COMPRUEBA AQUI Y NO SOLO EN LA BOVEDA. Porque los dos
// vocabularios no se tocan en el sitio que hace falta: la fila del almacen trae
// `revocado_en` y `vigencia_hasta`, y `estadoDelGrant` de `packages/vault` lee
// `revocadoEn` y `vigenciaHasta`. Sobre una fila del almacen esos dos campos
// son `undefined`, asi que esa comprobacion dice «vigente» siempre. La consulta
// de alcance del almacen SI filtra, y en SQL. Esta ruta usa esa, y el hueco va
// en el informe: no es de este paquete y arreglarlo a ciegas cambiaria el
// comportamiento de todo lo que recupera credenciales.

import { COMPROBACIONES, motivoDeNoVerificable } from "../../core/src/index.mjs";
import { crearAsistencia, TAREAS } from "../../asistencia/src/index.mjs";
import { crearProveedorDeAiSdk } from "../../asistencia/src/proveedor-ai-sdk.mjs";

import { exigirProyecto, noEsta } from "./comun.mjs";
import { ErrorDeServicio } from "./errores.mjs";

/** El tipo de credencial que autoriza a llamar a un modelo. Es el enum del modelo de datos. */
export const TIPO_DE_CREDENCIAL = "modelo";

/** El proposito con el que se saca la clave. Es el enum del contrato de la boveda. */
const PROPOSITO = "llamar_api";

/** Como se da de alta la clave, dicho entero. Es la accion de cada ausencia de aqui. */
const COMO_SE_CONSIGUE =
  "Da de alta la clave del modelo con `POST /v1/credentials` usando `tipo: \"modelo\"`, y autoriza a un agente " +
  "de este proyecto a usarla con `POST /v1/grants`. La clave se guarda en la boveda: no se pone en una " +
  "variable de entorno, porque una variable alcanza a todo lo que hace el servicio, no se puede revocar sin " +
  "reiniciarlo y no deja rastro de quien la uso.";

/**
 * Por que no hay asistencia hoy. Se calcula, no se escribe a mano: el motivo
 * cambia segun donde este cortado el camino, y una causa generica manda al
 * operador a revisar lo que ya tenia bien.
 *
 * @param {any} dep
 * @param {string|null} project_id
 * @returns {{disponible: true, grants: any[]}|{disponible: false, porque: string, como_conseguirlo: string}}
 */
export function estadoDeLaAsistencia(dep, project_id) {
  if (!dep.boveda) {
    return {
      disponible: false,
      porque:
        `${dep.ausenciaDeLaBoveda.porque} La clave del modelo es una credencial como cualquier otra, asi que ` +
        "sin boveda no hay donde guardarla ni de donde sacarla.",
      como_conseguirlo: dep.ausenciaDeLaBoveda.comoConseguirlo,
    };
  }

  const deModelo = dep.almacen.boveda
    .credenciales()
    .filter((/** @type {any} */ c) => c.tipo === TIPO_DE_CREDENCIAL);
  if (deModelo.length === 0) {
    return {
      disponible: false,
      porque:
        "no hay ninguna credencial de tipo `modelo` en el inventario de este workspace, asi que no hay clave " +
        "con la que llamar a ningun modelo. La asistencia es una mejora: sin ella, todas las demas etapas del " +
        "producto funcionan igual.",
      como_conseguirlo: COMO_SE_CONSIGUE,
    };
  }

  if (!project_id) {
    // Sin proyecto no se puede mirar la vigencia de ningun grant: los grants
    // son de un proyecto. Se dice asi en vez de afirmar que esta disponible.
    return {
      disponible: false,
      porque:
        `hay ${deModelo.length} credencial(es) de tipo \`modelo\` en el inventario, pero la disponibilidad de ` +
        "la asistencia se decide por proyecto: un grant autoriza a un agente de UN proyecto sobre UNA " +
        "credencial, y sin proyecto delante no hay ninguno que mirar.",
      como_conseguirlo:
        "Pide la sugerencia sobre un proyecto concreto con `POST /v1/projects/:id/assistance/suggest`. " +
        COMO_SE_CONSIGUE,
    };
  }

  const ids = new Set(deModelo.map((/** @type {any} */ c) => c.id));
  // La vigencia se filtra en SQL, que es donde el almacen la define: ver la
  // cabecera de este archivo sobre por que no basta con la de la boveda.
  const vigentes = dep.almacen.boveda
    .alcance({ project_id }, Date.now())
    .grants.filter((/** @type {any} */ g) => ids.has(g.credential_id));

  if (vigentes.length === 0) {
    return {
      disponible: false,
      porque:
        `hay ${deModelo.length} credencial(es) de tipo \`modelo\` en el inventario y ningun grant vigente que ` +
        "autorice a un agente de este proyecto a usarlas. Denegar por defecto tambien vale aqui: una clave " +
        "que se puede usar sin que nadie lo haya autorizado no se puede revocar de forma util.",
      como_conseguirlo: COMO_SE_CONSIGUE,
    };
  }

  return { disponible: true, grants: vigentes };
}

/**
 * El grant con el que se va a sacar la clave, o el error que dice cual falta.
 *
 * POR QUE NO SE ELIGE UNO CUANDO HAY VARIOS. Porque elegir mal no falla: la
 * sugerencia sale igual de bien, cobrada a la cuenta equivocada y firmada por
 * el agente equivocado en la auditoria. Un fallo que produce una respuesta
 * correcta es el que nadie encuentra.
 *
 * @param {any} dep
 * @param {any} proyecto
 * @param {string|null} pedido
 */
function grantParaLaClave(dep, proyecto, pedido) {
  const estado = estadoDeLaAsistencia(dep, proyecto.id);
  if (!estado.disponible) {
    throw new ErrorDeServicio("pieza_ausente", {
      pieza: "la credencial del modelo",
      porque: estado.porque,
      comoConseguirlo: estado.como_conseguirlo,
    });
  }

  if (pedido) {
    const elegido = estado.grants.find((/** @type {any} */ g) => g.id === pedido);
    if (!elegido) {
      throw new ErrorDeServicio("cuerpo_invalido", {
        detalle:
          `el grant \`${pedido}\` no autoriza a este proyecto sobre ninguna credencial de tipo ` +
          "`modelo`, o esta revocado o caducado",
        campos: ["grant_id"],
        opciones: estado.grants.map((/** @type {any} */ g) => g.id),
      });
    }
    return elegido;
  }

  if (estado.grants.length > 1) {
    throw new ErrorDeServicio("cuerpo_invalido", {
      detalle:
        `este proyecto tiene ${estado.grants.length} grants vigentes sobre credenciales de tipo \`modelo\` y ` +
        "no se elige uno por su cuenta: la sugerencia saldria igual de bien, cobrada a la cuenta equivocada y " +
        "firmada en la auditoria por el agente equivocado",
      campos: ["grant_id"],
      opciones: estado.grants.map((/** @type {any} */ g) => g.id),
    });
  }

  return estado.grants[0];
}

/**
 * El snapshot completo con sus hallazgos, en la forma que la asistencia espera.
 *
 * `valor_corregido` gana cuando lo hay, igual que en el nucleo y en la flota: lo
 * que vale es lo que el operador corrigio. Mandarle al modelo el valor original
 * despues de que alguien lo arreglo a mano es pedirle que sugiera sobre el
 * proyecto que el escaneo creyo ver, no sobre el que hay.
 *
 * @param {any} dep
 * @param {any} proyecto
 */
function snapshotDelProyecto(dep, proyecto) {
  const fila = dep.almacen.base.consultarUno(
    "SELECT * FROM project_snapshot WHERE project_id = ? AND estado = 'completo' ORDER BY creado DESC LIMIT 1",
    [proyecto.id],
  );
  if (!fila) {
    throw noEsta("snapshot completo", proyecto.id, "`POST /v1/projects/:id/scan`", `el proyecto \`${proyecto.nombre}\``);
  }
  return {
    id: fila.id,
    project_id: fila.project_id,
    commit: fila.commit ?? null,
    hallazgos: dep.almacen.snapshots.hallazgos(fila.id).map((/** @type {any} */ h) => ({
      categoria: h.categoria,
      clave: h.clave,
      valor: h.valor_corregido === null ? JSON.parse(String(h.valor)) : JSON.parse(String(h.valor_corregido)),
      origen: h.origen,
      evidencia: JSON.parse(String(h.evidencia)),
      confianza: h.confianza,
    })),
  };
}

/**
 * Cada regla propuesta, con su verificabilidad decidida POR EL NUCLEO.
 *
 * ESTA ES LA LINEA QUE SEPARA LO QUE PUEDE DECIDIR UN MODELO DE LO QUE NO. El
 * modelo propone el enunciado y la forma de comprobacion; si esa comprobacion
 * se puede correr sola lo dice `motivoDeNoVerificable`, que es codigo y mira
 * campos. Si lo decidiera el modelo, la pantalla acabaria enseñando como
 * «verificable» una regla que ningun runtime sabe correr — y eso es el verde
 * inventado del principio II con otro disfraz: una afirmacion sin exit code
 * detras.
 *
 * @param {any} sugerencia
 */
function clasificarReglas(sugerencia) {
  const reglas = sugerencia?.sugerencia?.reglas;
  if (!Array.isArray(reglas)) return sugerencia;
  return {
    ...sugerencia,
    sugerencia: {
      ...sugerencia.sugerencia,
      reglas: reglas.map((/** @type {any} */ r) => {
        const motivo = motivoDeNoVerificable(r);
        return motivo === null
          ? { ...r, verificable: true }
          : { ...r, verificable: false, motivo_de_no_verificable: motivo };
      }),
    },
  };
}

/**
 * Lo que la asistencia sabe proponer, y si hoy puede.
 *
 * CONTESTA SIEMPRE, tambien sin clave. Es la ruta con la que la pantalla decide
 * si ofrecer el boton, y una que fallara cuando no hay credencial dejaria a la
 * pantalla sin forma de distinguir «no hay asistencia» de «el servicio no
 * contesta».
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function catalogoDeAsistencia(p) {
  const project_id = p.url.searchParams.get("project_id");
  const estado = estadoDeLaAsistencia(p.dep, project_id);

  return {
    cuerpo: {
      tareas: TAREAS.map((t) => ({
        clave: t.clave,
        titulo: t.titulo,
        para_que: t.para_que,
        por_que_no_es_determinista: t.por_que_no_es_determinista,
        esquema: t.esquema_id,
      })),
      disponible: estado.disponible,
      // El vocabulario de lo que sale de aqui, dicho en la ruta que la pantalla
      // lee ANTES de pedir nada: lo que devuelva la sugerencia no es un
      // hallazgo, y la pantalla tiene que saberlo antes de dibujar el boton.
      marca: {
        origen: "sugerido",
        no_es: ["detectado", "inferido", "vacio"],
        que_significa:
          "`sugerido` es lo unico de este producto que no tiene nada del disco debajo. `detectado` trae la " +
          "ruta que lo respalda, `inferido` trae las señales que el scanner leyo, `vacio` trae la constancia " +
          "de que se busco. Una sugerencia trae las claves de los hallazgos en los que dice apoyarse, y esas " +
          "se comprueban; el texto no se puede comprobar.",
      },
      ...(estado.disponible
        ? {}
        : { ausencia: { porque: estado.porque, como_conseguirlo: estado.como_conseguirlo } }),
    },
  };
}

/**
 * La sugerencia. Propone y no decide.
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function sugerir(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  const cuerpo = await p.cuerpo();

  // El snapshot ANTES de sacar la clave. Sin insumo no hay nada que sugerir, y
  // sacar una credencial para descubrirlo despues deja un evento de acceso en
  // la auditoria por una llamada que no llego a ocurrir.
  const snapshot = snapshotDelProyecto(p.dep, proyecto);

  const grant = grantParaLaClave(p.dep, proyecto, cuerpo.grant_id ?? null);
  const credencial = p.dep.almacen.boveda.credencialPorId(grant.credential_id);
  const boveda = p.dep.exigirBoveda();

  // El registro del acceso lo escribe la boveda ANTES de devolver el valor: no
  // existe el camino por el que alguien obtuvo la clave y el evento no se
  // escribio.
  const clave = await boveda.recuperar(credencial.ref_boveda, {
    grant_id: grant.id,
    project_id: proyecto.id,
    agent_id: grant.agent_id,
    proposito: PROPOSITO,
  });

  // La fabrica se inyecta, igual que los adaptadores de runtime: es lo que
  // permite que ninguna prueba de este repositorio llame a un modelo de verdad.
  const fabrica = p.dep.fabricaDeModelo ?? crearProveedorDeAiSdk;
  const asistencia = crearAsistencia({ proveedor: fabrica({ clave, modelo: cuerpo.modelo }) });

  const sugerencia = await asistencia.sugerir({
    tarea: cuerpo.tarea,
    snapshot,
    opciones: {
      area: cuerpo.area,
      // La lista de formas viaja desde `packages/core`, que es quien la
      // declara. `packages/asistencia` no la copia a proposito: dos listas de
      // lo mismo en dos sitios se separan, y el dia que se separen la pantalla
      // enseñara como verificable una regla que ningun runtime puede correr.
      formas_de_comprobacion: COMPROBACIONES,
    },
  });

  p.estado.bus.emitir(
    "asistencia.sugerida",
    {
      tarea: sugerencia.tarea,
      origen: sugerencia.origen,
      apoyos: sugerencia.apoyos.length,
      modelo: sugerencia.procedencia.modelo,
    },
    { project_id: proyecto.id },
  );

  return { cuerpo: { sugerencia: clasificarReglas(sugerencia) } };
}
