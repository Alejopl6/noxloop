// EL SELLADO. Aqui es donde lo que devolvio un modelo se convierte en algo que
// se puede enseñar sin mentir, o no se convierte en nada.
//
// EL PRINCIPIO QUE SOSTIENE ESTE ARCHIVO. El vocabulario del scanner esta
// cerrado y el operador ya lo aprendio: `detectado` es un hecho con un archivo
// detras, `inferido` es una lectura del scanner sobre señales que tambien
// enseña, `vacio` es la constancia de que se busco y no habia. Las tres tienen
// algo del disco debajo, y por eso las tres se pueden discutir mirando el
// disco. Lo que propone un modelo no tiene nada del disco debajo.
//
// Si esa cuarta cosa entra al mismo saco, el precio no es una pantalla fea: el
// hallazgo se acepta, se convierte en la constitution del proyecto, y el
// runtime lo aplica durante meses sin que nadie lo vuelva a mirar. Es
// exactamente el daño que describe el principio X, y por eso el sellado hace
// tres cosas y ninguna es opcional:
//
//   1. SE QUEDA SOLO CON LO DECLARADO. Lo que el modelo metio de su cosecha no
//      viaja. Un modelo que devuelve `origen: "detectado"` o una `evidencia`
//      inventada no consigue publicar ninguna de las dos, porque el filtro no
//      pregunta que trae: copia lo que el esquema declara.
//   2. MARCA CADA PIEZA. `origen: "sugerido"`, puesto por este codigo y no por
//      el modelo. La palabra es nueva a proposito: no reusa `inferido`, que es
//      como el scanner llama a SUS lecturas —y las del scanner enseñan las
//      señales que las sostienen—.
//   3. COMPRUEBA LAS CITAS. Cada pieza dice en que hallazgos se apoya, por
//      clave, y cada clave tiene que existir en el snapshot. Es lo unico
//      comprobable por maquina de una sugerencia: una frase plausible que cita
//      un hecho inventado no se distingue leyendola de una que cita uno real.
//
// POR QUE LA COMPROBACION DE CITAS VIVE AQUI Y NO EN CADA TAREA. Para que una
// tarea nueva no pueda olvidarse de hacerla. Ninguna tarea comprueba nada por
// su cuenta: declaran su esquema y su insumo, y pasan por aqui.

import { citaInventada, sugerenciaSinApoyo } from "./errores.mjs";
import { soloLoDeclarado } from "./esquema.mjs";

/**
 * La palabra. Es nueva a proposito y no reusa ninguna del scanner.
 *
 * @type {"sugerido"}
 */
export const ORIGEN_DE_LO_SUGERIDO = "sugerido";

/** El campo con el que una pieza sugerida cita los hechos en los que se apoya. */
export const CAMPO_DE_CITA = "se_apoya_en";

/**
 * Lo que la respuesta dice de si misma, pegado al dato.
 *
 * POR QUE VIAJA DENTRO Y NO EN LA DOCUMENTACION DE LA API. Una marca que solo
 * existe en el contrato es una marca que el operador no ve: la lee quien
 * implementa el cliente, una vez, y despues nadie. Esta va pegada al objeto,
 * asi que la tiene delante la interfaz, un `curl` de diagnostico y el log en el
 * que alguien pegue la respuesta.
 */
export const ADVERTENCIA =
  "Esto no es un hallazgo. Lo propuso un modelo a partir del snapshot y no hay ningun archivo que lo respalde: " +
  "donde el scanner dice `detectado` hay una ruta y una linea, y aqui no hay ninguna. Leelo, corrigelo y " +
  "decide tu; nada de esto se guarda si no lo guardas.";

/**
 * Las piezas de un objeto sugerido: todo lo que trae el campo de cita.
 *
 * Se busca por forma y no por ruta declarada para que una tarea nueva quede
 * cubierta sin tocar esto.
 *
 * @param {any} valor
 * @param {string} [donde]
 * @param {any[]} [acc]
 * @returns {{ruta: string, pieza: any}[]}
 */
function piezasDe(valor, donde = "la sugerencia", acc = []) {
  if (Array.isArray(valor)) {
    for (const [i, e] of valor.entries()) piezasDe(e, `${donde}[${i}]`, acc);
    return acc;
  }
  if (valor && typeof valor === "object") {
    if (Array.isArray(valor[CAMPO_DE_CITA])) acc.push({ ruta: donde, pieza: valor });
    for (const [campo, sub] of Object.entries(valor)) {
      if (campo === CAMPO_DE_CITA) continue;
      piezasDe(sub, `${donde}.${campo}`, acc);
    }
  }
  return acc;
}

/**
 * Sella una respuesta del modelo: la limpia, la marca y comprueba sus citas.
 *
 * @param {{
 *   tarea: string,
 *   esquema: any,
 *   esquemaId: string,
 *   objeto: any,
 *   snapshot: any,
 *   procedencia: {modelo: string, proveedor: string, generado: string},
 * }} datos
 */
export function sellar({ tarea, esquema, esquemaId, objeto, snapshot, procedencia }) {
  // 1. Solo lo declarado. Lo que el modelo metio de mas no llega ni a mirarse.
  const limpio = soloLoDeclarado(objeto, esquema);

  const hallazgos = snapshot.hallazgos ?? [];

  // UNA CLAVE PUEDE APARECER VARIAS VECES, y descubrirlo sobre el snapshot de
  // verdad de este repositorio costo una version de este archivo: el detector
  // de riesgos emite VEINTE hallazgos con la clave `riesgos.secreto`, uno por
  // archivo. Con un `Map` de clave a hallazgo se conservaba el ultimo, y el
  // apoyo habria enseñado un archivo diciendo implicitamente «este es el
  // archivo» cuando hay veinte. Se agrupan: el apoyo dice cuantos hallazgos
  // comparten la clave y junta sus rutas.
  /** @type {Map<string, any[]>} */
  const porClave = new Map();
  for (const h of hallazgos) {
    const grupo = porClave.get(h.clave);
    if (grupo) grupo.push(h);
    else porClave.set(h.clave, [h]);
  }
  const claves = [...porClave.keys()];

  // 2. Las citas, ANTES de marcar nada: una respuesta que no se puede entregar
  // no se marca a medias.
  const citadas = new Set();
  for (const { ruta, pieza } of piezasDe(limpio)) {
    const citas = pieza[CAMPO_DE_CITA];
    if (citas.length === 0) throw sugerenciaSinApoyo(pieza.enunciado ?? ruta);
    for (const clave of citas) {
      if (!porClave.has(clave)) throw citaInventada(clave, claves, ruta);
      citadas.add(clave);
    }
  }

  // 3. La marca, puesta por este codigo. Se pone DESPUES de limpiar, asi que no
  // hay forma de que la sobreescriba lo que dijo el modelo.
  for (const { pieza } of piezasDe(limpio)) pieza.origen = ORIGEN_DE_LO_SUGERIDO;

  return {
    tarea,
    origen: ORIGEN_DE_LO_SUGERIDO,
    advertencia: ADVERTENCIA,
    procedencia: {
      proveedor: procedencia.proveedor,
      modelo: procedencia.modelo,
      esquema: esquemaId,
      generado: procedencia.generado,
      snapshot_id: snapshot.id ?? null,
    },
    sugerencia: limpio,
    // LOS HECHOS QUE LA SUGERENCIA CITA, con el origen que les puso el scanner
    // y con su evidencia de verdad. Van en una rama aparte y no mezclados con
    // lo sugerido: es lo que permite mirar una cosa y desconfiar de la otra en
    // la misma pantalla.
    apoyos: [...citadas].sort().map((clave) => {
      const grupo = /** @type {any[]} */ (porClave.get(clave));
      const primero = grupo[0];
      return {
        clave,
        categoria: primero.categoria ?? null,
        // Cuando la clave agrupa varios hallazgos, el valor del primero seria
        // una respuesta falsa a «cual es el valor». Se dice cuantos hay.
        ...(grupo.length === 1 ? { valor: primero.valor ?? null } : { hallazgos: grupo.length }),
        // El origen mas flojo del grupo manda: si alguno es una lectura del
        // scanner, el apoyo entero no se puede presentar como un hecho medido.
        origen: grupo.some((/** @type {any} */ h) => h.origen === "inferido") ? "inferido" : primero.origen,
        confianza: primero.confianza ?? null,
        evidencia: grupo.flatMap((/** @type {any} */ h) => h.evidencia ?? []),
      };
    }),
  };
}
