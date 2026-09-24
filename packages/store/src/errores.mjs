// Los errores del almacen, con la forma que exige NFR-006: codigo, causa y
// accion. Es el mismo catalogo que el servicio de control, y por la misma razon.
//
// POR QUE UN CATALOGO Y NO UN `throw new Error` EN CADA SITIO. "Una transicion
// sin su artefacto se rechaza con causa textual" es un requisito de
// `data-model.md`, no una cortesia. Un mensaje escrito en el sitio donde se
// detecta el fallo sale con lo que sabia quien lo escribio ese dia, y la mitad
// de las veces sale como "transicion invalida": tecnicamente cierto, y deja al
// operador mirando una pantalla que no avanza sin saber que le falta.
//
// `causa` dice QUE PASO con los datos concretos delante. `accion` nombra la
// operacion o la pantalla siguiente — nunca "reintenta".

/**
 * @typedef {object} EntradaDeCatalogo
 * @property {(datos: any) => string} causa
 * @property {(datos: any) => string} accion
 */

/** @type {Record<string, EntradaDeCatalogo>} */
export const CATALOGO = {
  migracion_alterada: {
    causa: (d) =>
      `La migracion ${d.version} (\`${d.nombre}\`) ya esta aplicada en esta base, pero su SQL cambio desde ` +
      "entonces. Una migracion editada en sitio deja dos esquemas distintos llamandose igual: el de quien la " +
      "edito y el de quien ya la habia aplicado, y ninguna consulta avisa de la diferencia.",
    accion: (d) =>
      `Deja la migracion ${d.version} tal como se aplico y mete el cambio en una migracion nueva con la ` +
      "version siguiente. Si la base es de desarrollo y se puede tirar, borra el archivo y deja que se cree entera.",
  },

  estado_desconocido: {
    causa: (d) => `\`${d.estado}\` no es un estado de la maquina de \`Project\`. Los que hay son: ${d.declarados}.`,
    accion: () => "Usa uno de los estados declarados. La maquina no acepta estados que no esten en el diagrama.",
  },

  proyecto_desconocido: {
    causa: (d) =>
      `No hay ningun proyecto con id \`${d.id}\` en este almacen. Una escritura contra un id inexistente afecta ` +
      "cero filas y no falla: se diria que la transicion ocurrio, y el proyecto se quedaria donde estaba.",
    accion: () => "Comprueba el id contra la lista de proyectos del workspace antes de moverlo de estado.",
  },

  transicion_no_declarada: {
    causa: (d) =>
      `\`${d.desde} -> ${d.hasta}\` no es una transicion de la maquina de \`Project\`. Desde \`${d.desde}\` ` +
      `solo se puede ir a: ${d.disponibles}. Ninguna transicion salta un estado salvo \`CREATED -> CONSTITUTED\` ` +
      "para un proyecto nuevo, que no tiene codigo que escanear.",
    accion: (d) =>
      `Pasa por ${d.disponibles} antes de llegar a \`${d.hasta}\`. Cada etapa intermedia deja el artefacto que ` +
      "la siguiente necesita, y saltarsela deja el hueco sin declarar.",
  },

  retroceso_no_existe: {
    causa: (d) =>
      `El proyecto esta en \`${d.desde}\` y se pidio \`${d.hasta}\`, que es anterior. Retroceder no existe en ` +
      "esta maquina: un estado que baja deja sin explicar los artefactos que ya se produjeron, y el historial " +
      "de como llego el proyecto hasta ahi deja de leerse.",
    accion: (d) =>
      `Reabre la etapa \`${d.hasta}\` sin mover el estado: corrige el snapshot, enmienda la constitution o ` +
      `vuelve a decidir las recomendaciones. El proyecto se queda en \`${d.desde}\` mientras tanto.`,
  },

  atajo_solo_para_proyecto_nuevo: {
    causa: (d) =>
      `\`CREATED -> CONSTITUTED\` es el atajo del proyecto nuevo —el que no tiene codigo que escanear— y este ` +
      `proyecto tiene origen \`${d.origen}\`. Un proyecto \`${d.origen}\` tiene un arbol que leer, y saltarse ` +
      "`DISCOVERED` significa fijar la constitution sin haber mirado lo que ya hay.",
    accion: () =>
      "Corre el snapshot, decide sus hallazgos y pasa por `DISCOVERED`. Si de verdad es un proyecto nuevo, " +
      "corrige su `origen` antes de moverlo.",
  },

  transicion_sin_artefacto: {
    causa: (d) =>
      `\`${d.desde} -> ${d.hasta}\` exige el artefacto \`${d.artefacto}\` y no esta: ${d.hallado}. El estado ` +
      "no se escribe a partir de que alguien diga que la etapa termino, igual que ningun gate pasa sin su exit code.",
    accion: (d) => d.comoConseguirlo,
  },

  escritor_concurrente: {
    causa: (d) =>
      `La transicion se calculo sobre el estado \`${d.esperado}\` y el proyecto esta en \`${d.actual}\`: otro ` +
      "escritor lo movio en medio. Dejar pasar la escritura pisaria su trabajo y dejaria el proyecto en un " +
      "estado que no corresponde a ningun recorrido.",
    accion: () =>
      "Vuelve a leer el proyecto y decide sobre su estado actual. Si esto pasa con la aplicacion abierta dos " +
      "veces, la segunda ventana esta escribiendo: solo el servicio de control escribe el almacen.",
  },

  hallazgo_sin_evidencia: {
    causa: (d) =>
      `El hallazgo \`${d.clave}\` declara origen \`detectado\` y no trae evidencia. Un detectado sin la ruta y ` +
      "la linea que lo respaldan es una opinion del modelo con etiqueta de hecho, y se convierte en la " +
      "constitution del proyecto sin que nadie vuelva a comprobarlo (FR-013, principio X).",
    accion: () =>
      "Adjunta la evidencia —rutas y lineas— o declara el hallazgo como `inferido` con su confianza. Si se " +
      "busco y no habia, declara el hueco en vez de rellenarlo.",
  },

  auditoria_sin_redactor: {
    causa: () =>
      "Se pidio escribir un evento de auditoria y el almacen no tiene redactor. El principio IX exige que la " +
      "redaccion contra la boveda ocurra ANTES de persistir: sin redactor, el `detalle` iria crudo a disco, y " +
      "un instante en disco es todo lo que hace falta para que un secreto se considere filtrado.",
    accion: () =>
      "Construye el almacen con `abrirAlmacen({ ruta, redactor })` pasando el redactor de la boveda " +
      "(`crearRedactor` en `packages/vault`). El almacen no trae uno por defecto a proposito.",
  },

  campo_obligatorio_ausente: {
    causa: (d) =>
      `Falta \`${d.campo}\` para escribir en \`${d.tabla}\`, y \`data-model.md\` lo declara obligatorio. El ` +
      "almacen no lo rellena con lo probable: un campo inventado aqui se lee despues como un dato verificado.",
    accion: (d) => `Pasa \`${d.campo}\` explicitamente. ${d.pista || ""}`.trim(),
  },

  valor_fuera_del_enum: {
    causa: (d) => `\`${d.valor}\` no es un valor valido de \`${d.tabla}.${d.campo}\`.`,
    accion: (d) =>
      `Usa uno de: ${d.permitidos.join(", ")}. Si el valor viene de otro paquete con otro vocabulario, la ` +
      "traduccion va en quien llama, no en el almacen: una equivalencia silenciosa aqui borra la diferencia " +
      "entre dos cosas que el modelo distingue.",
  },
};

export class ErrorDeAlmacen extends Error {
  /**
   * @param {string} codigo clave del CATALOGO
   * @param {Record<string, any>} [datos]
   */
  constructor(codigo, datos = {}) {
    const entrada = CATALOGO[codigo];
    const causa = entrada ? entrada.causa(datos) : `codigo de error no declarado: ${codigo}`;
    super(`${codigo}: ${causa}`);
    this.name = "ErrorDeAlmacen";
    this.codigo = codigo;
    this.causa = causa;
    this.accion = entrada ? entrada.accion(datos) : "Declara este codigo en el catalogo de `errores.mjs`.";
    this.datos = datos;
  }
}

/**
 * @param {string} codigo
 * @param {Record<string, any>} [datos]
 * @returns {never}
 */
export function fallar(codigo, datos = {}) {
  throw new ErrorDeAlmacen(codigo, datos);
}
