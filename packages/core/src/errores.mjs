// El catalogo de errores del nucleo.
//
// POR QUE UN CATALOGO Y NO UN `throw new Error` EN CADA SITIO. Es la misma
// razon por la que lo tiene el servicio: NFR-006 exige que todo error nombre la
// causa completa y la accion siguiente, y un mensaje escrito donde se detecta el
// fallo sale con lo que sabia quien lo escribio ese dia. Con el catalogo aparte
// hay UN sitio donde ver que puede fallar en las etapas 02-05, y una prueba que
// los recorre todos y cae si alguno no dice que hacer despues.
//
// `estado` viaja con el error porque el contrato de la API fija codigos
// concretos —el 400 de la enmienda sin sus tres campos, el 409 del diff
// obsoleto— y el dominio es quien sabe cual corresponde. El servicio traduce;
// no decide.

/**
 * @typedef {{tipo: string, id?: string|null}} Objeto
 */

export class ErrorDeNucleo extends Error {
  /**
   * @param {string} codigo
   * @param {string} causa texto completo, no un resumen
   * @param {string} accion una operacion o una pantalla concreta, nunca "reintenta"
   * @param {number} [estado] el codigo HTTP que le corresponde en el contrato
   * @param {Objeto} [objeto]
   */
  constructor(codigo, causa, accion, estado = 400, objeto) {
    super(causa);
    this.name = "ErrorDeNucleo";
    this.codigo = codigo;
    this.causa = causa;
    this.accion = accion;
    this.estado = estado;
    this.objeto = objeto ?? null;
  }

  /** La forma que el contrato de la API declara para `error`. */
  aSobre() {
    return { error: { codigo: this.codigo, causa: this.causa, accion: this.accion, objeto: this.objeto } };
  }
}

/**
 * La enmienda sin sus tres campos.
 *
 * La causa cita la regla en vez de decir "campo requerido" a proposito: un
 * obligatorio sin explicacion se rellena con cualquier cosa, y un campo relleno
 * con cualquier cosa es peor que un campo vacio porque parece cumplido.
 *
 * @param {string[]} ausentes
 * @param {Array<{campo: string, largo: number, minimo: number}>} breves
 */
export function enmiendaIncompleta(ausentes, breves) {
  const partes = [];
  if (ausentes.length > 0) {
    partes.push(
      `La enmienda no trae ${ausentes.length === 1 ? "el campo" : "los campos"} ` +
        `${ausentes.map((c) => `\`${c}\``).join(", ")}.`,
    );
  }
  for (const { campo, largo, minimo } of breves) {
    partes.push(
      `\`${campo}\` trae ${largo} caracteres: no alcanza para nombrar un fallo concreto y observado ` +
        `(hacen falta al menos ${minimo}).`,
    );
  }
  return new ErrorDeNucleo(
    "enmienda_incompleta",
    `${partes.join(" ")} La constitution de este proyecto lo dice de si misma y el producto lo exige igual: ` +
      "una enmienda sin un fallo detras no es una enmienda: es una preferencia. El campo existe para que la " +
      "regla se pueda retirar el dia que el fallo que la motivaba deje de existir.",
    "Escribe que cambia, que fallo concreto lo motiva —cuando ocurrio y que costo— y que se rompe si no se " +
      "hace, y vuelve a mandar la enmienda desde Constitution -> Enmendar.",
    400,
  );
}

/**
 * @param {string} tipo
 * @param {string[]} conocidos
 */
export function tipoDeCambioDesconocido(tipo, conocidos) {
  return new ErrorDeNucleo(
    "tipo_de_cambio_desconocido",
    `\`${tipo}\` no es un tipo de cambio de esta constitution. Los que existen son ` +
      `${conocidos.map((t) => `\`${t}\``).join(", ")}, y cada uno decide como sube la version. ` +
      "No hay default: adivinar el salto de version es como una retirada de principio acaba publicada como " +
      "un cambio menor que nadie revisa.",
    `Declara \`tipo_de_cambio\` con uno de ${conocidos.join(", ")} en la enmienda.`,
    400,
  );
}

/**
 * @param {string} id
 */
export function proyectoDesconocido(id) {
  return new ErrorDeNucleo(
    "proyecto_desconocido",
    `No hay ningun proyecto \`${id}\` en el almacen. Una etapa que se fija sobre un proyecto que no existe ` +
      "escribe en el arbol de alguien sin tener a quien atribuirselo, y deja el estado sin dueño.",
    "Comprueba el identificador en la lista de proyectos, o da de alta el proyecto antes de fijar su contexto.",
    404,
    { tipo: "project", id },
  );
}

/**
 * @param {string} estado
 */
export function snapshotIncompleto(estado) {
  return new ErrorDeNucleo(
    "snapshot_incompleto",
    `El snapshot esta en estado \`${estado}\`, no \`completo\`. Una lectura a medias no es un borrador: no hay ` +
      "forma de saber que detectores faltaban, y los apartados que no alcanzo a mirar saldrian como huecos " +
      "declarados cuando en realidad nadie los busco.",
    "Vuelve a escanear el proyecto y propon la constitution sobre el snapshot completo.",
    409,
  );
}

export function constitutionVacia() {
  return new ErrorDeNucleo(
    "constitution_vacia",
    "El contenido de la constitution esta vacio. Un documento en blanco versionado en el repositorio es peor " +
      "que ninguno: el runtime lo encuentra, lo lee, no saca ninguna regla y no tiene forma de distinguirlo " +
      "de un proyecto cuyas reglas son deliberadamente pocas.",
    "Edita la propuesta —o escribe la constitution a mano— y vuelve a fijarla con al menos un principio.",
    400,
  );
}

/**
 * @param {string} ruta
 */
export function constitutionYaExiste(ruta) {
  return new ErrorDeNucleo(
    "constitution_ya_existe",
    `Ya hay un documento distinto en \`${ruta}\`. Adoptar un proyecto y pisar las reglas que su equipo ya ` +
      "habia escrito es la primera forma de perder su confianza, y no se recupera: la siguiente propuesta ya " +
      "no se lee, se rechaza.",
    `Revisa \`${ruta}\`, incorpora a la propuesta lo que quieras conservar, y vuelve a fijarla declarando la ` +
      "sobreescritura.",
    409,
  );
}

/**
 * @param {string} project_id
 */
export function constitutionAusente(project_id) {
  return new ErrorDeNucleo(
    "constitution_ausente",
    `El proyecto \`${project_id}\` no tiene ninguna constitution vigente. Una enmienda modifica un documento ` +
      "que existe; sin el, lo que se pide no es enmendar sino fijar por primera vez, y eso no deja enmienda " +
      "porque no hay version anterior que recuperar.",
    "Fija la constitution del proyecto desde Constitution -> Propuesta, y enmiendala despues.",
    409,
    { tipo: "project", id: project_id },
  );
}

/**
 * @param {string} ruta
 * @param {string} raiz
 */
export function rutaFueraDelProyecto(ruta, raiz) {
  return new ErrorDeNucleo(
    "ruta_fuera_del_proyecto",
    `\`${ruta}\` sale de \`${raiz}\`. Una recomendacion que escribe fuera del arbol del proyecto deja de ser ` +
      "una propuesta revisable y se convierte en un instalador que toca la maquina del operador: el diff que " +
      "aprobo hablaba de su repositorio.",
    "Corrige la ruta del cambio para que sea relativa a la raiz del proyecto y no contenga `..`.",
    400,
  );
}

/**
 * @param {string} desde
 * @param {string} hasta
 * @param {string} porQue
 */
export function transicionInvalida(desde, hasta, porQue) {
  return new ErrorDeNucleo(
    "transicion_invalida",
    `El proyecto no puede pasar de \`${desde}\` a \`${hasta}\`: ${porQue}. Una transicion sin su artefacto ` +
      "deja el proyecto diciendo que una etapa esta resuelta cuando no lo esta, y el fallo aparece tres " +
      "etapas despues sin forma de saber quien lo puso ahi.",
    `Completa la etapa que falta antes de \`${hasta}\`; la lista de lo pendiente esta en el detalle del proyecto.`,
    409,
  );
}

/**
 * @param {string} area
 * @param {readonly string[]} conocidas
 */
export function areaDesconocida(area, conocidas) {
  return new ErrorDeNucleo(
    "area_desconocida",
    `\`${area}\` no es un area de guidelines. Las que existen son ${conocidas.map((a) => `\`${a}\``).join(", ")}. ` +
      "El conjunto es cerrado porque el runtime pide las guidelines por area al compilar el contexto: un area " +
      "inventada produce un documento que nadie lee nunca y que su autor cree aplicado.",
    `Guarda el documento bajo una de las areas declaradas (${conocidas.join(", ")}).`,
    400,
  );
}

/**
 * @param {{ruta: string, motivo: string}[]} desfasados
 */
export function diffObsoleto(desfasados) {
  const lista = desfasados.map((d) => `\`${d.ruta}\` (${d.motivo})`).join("; ");
  return new ErrorDeNucleo(
    "diff_obsoleto",
    `El arbol cambio desde que se calculo el diff de esta recomendacion: ${lista}. Aplicarla ahora escribiria ` +
      "algo distinto de lo que el operador aprobo, o encima de un cambio que nadie vio. Aplicar algo distinto " +
      "de lo mostrado es exactamente como se pierde la confianza en un instalador, y no se recupera.",
    "Vuelve a correr el analisis del bootstrap para recalcular el diff sobre el arbol de ahora, revisalo y " +
      "aplicalo desde ahi.",
    409,
  );
}

/**
 * @param {string} conflicto
 */
export function conflictoNoAceptado(conflicto) {
  return new ErrorDeNucleo(
    "conflicto_no_aceptado",
    `Esta recomendacion contradice la constitution del proyecto: ${conflicto}. Aplicarla sin decirlo deja el ` +
      "proyecto violando su propia regla con la firma del operador encima, y quien lea el repositorio despues " +
      "no tiene forma de saber que la contradiccion se vio y se acepto.",
    "Si la contradiccion es deliberada, aplica la recomendacion aceptando el conflicto y escribe el motivo; " +
      "si no lo es, omitela o enmienda la constitution primero.",
    409,
  );
}

/**
 * @param {string} id
 */
export function recomendacionDesconocida(id) {
  return new ErrorDeNucleo(
    "recomendacion_desconocida",
    `No hay ninguna recomendacion \`${id}\`. Las recomendaciones se calculan en un analisis del bootstrap y ` +
      "viven mientras ese analisis vale: una de un analisis anterior ya no tiene diff comparable con el arbol.",
    "Vuelve a correr el analisis del bootstrap y decide sobre las recomendaciones que devuelve.",
    404,
    { tipo: "recommendation", id },
  );
}

/**
 * @param {string} decision
 * @param {readonly string[]} conocidas
 */
export function decisionDesconocida(decision, conocidas) {
  return new ErrorDeNucleo(
    "decision_desconocida",
    `\`${decision}\` no es una decision sobre una recomendacion. Las salidas son exactamente ` +
      `${conocidas.map((d) => `\`${d}\``).join(", ")}: tres, ni una mas. Una cuarta salida —"luego", "quiza"— ` +
      "es una recomendacion que se queda pendiente para siempre y una decision que nadie registro.",
    `Decide con una de las tres salidas (${conocidas.join(", ")}).`,
    400,
  );
}

export function personalizacionSinCambios() {
  return new ErrorDeNucleo(
    "personalizacion_sin_cambios",
    "Se pidio personalizar la recomendacion sin decir con que cambios. Personalizar es aplicar lo que escribio " +
      "el operador en vez de lo que propuso el bootstrap; sin los cambios no hay nada que escribir, y aplicar " +
      "el original llamandolo personalizado falsea el registro que alimenta la evolucion continua.",
    "Manda los cambios modificados —la misma lista de rutas, con el contenido que quieres— o aplica la " +
      "recomendacion tal cual.",
    400,
  );
}

/**
 * @param {string} id
 * @param {string} ruta
 */
export function rutaFueraDelDiff(id, ruta) {
  return new ErrorDeNucleo(
    "ruta_fuera_del_diff",
    `La personalizacion de \`${id}\` toca \`${ruta}\`, que no estaba en el diff que se mostro. Personalizar es ` +
      "cambiar el CONTENIDO de lo propuesto, no el alcance: una ruta nueva no paso por la revision del " +
      "operador, que aprobo una lista concreta de archivos.",
    "Quita esa ruta de la personalizacion. Si hace falta tocar un archivo mas, vuelve a analizar para que " +
      "entre en el diff y se apruebe con el resto.",
    400,
  );
}
