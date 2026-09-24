// El catalogo de errores de la capa de runtimes.
//
// POR QUE UN CATALOGO Y NO UN `throw new Error` EN CADA SITIO. La misma razon
// que en el nucleo y en el servicio: NFR-006 exige que todo error nombre la
// causa completa y la accion siguiente, y un mensaje escrito donde se detecta el
// fallo sale con lo que sabia quien lo escribio ese dia. Con el catalogo aparte
// hay UN sitio donde ver que puede fallar al configurar o invocar un runtime, y
// una prueba que los recorre y cae si alguno no dice que hacer despues.

/**
 * @typedef {{tipo: string, id?: string|null}} Objeto
 */

export class ErrorDeAdaptador extends Error {
  /**
   * @param {string} codigo
   * @param {string} causa texto completo, no un resumen
   * @param {string} accion una operacion o una pantalla concreta, nunca "reintenta"
   * @param {number} [estado] el codigo HTTP que le corresponde en el contrato
   * @param {Objeto} [objeto]
   */
  constructor(codigo, causa, accion, estado = 400, objeto) {
    super(causa);
    this.name = "ErrorDeAdaptador";
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

// --------------------------------------------------------------- flota

/**
 * @param {string} runtime
 * @param {string} nombreDelRevisor
 * @param {string} nombreDelImplementador
 */
export function revisorComparteRuntime(runtime, nombreDelRevisor, nombreDelImplementador) {
  return new ErrorDeAdaptador(
    "revisor_comparte_runtime",
    `El revisor \`${nombreDelRevisor}\` y el implementador \`${nombreDelImplementador}\` usan el mismo ` +
      `runtime \`${runtime}\`. Un revisor que corre sobre el mismo runtime que escribio el codigo comparte ` +
      "sus sesgos, sus puntos ciegos y su forma de equivocarse: revisa con la misma cabeza que implemento, y " +
      "la revision se vuelve confirmacion. Se comprueba al guardar y no al ejecutar porque un error de " +
      "configuracion descubierto a mitad de un run cuesta el run entero — worktrees creados, gates corridos y " +
      "modelo pagado.",
    `Asigna al revisor un runtime distinto de \`${runtime}\` desde Flota -> Agentes, o cambia el del ` +
      "implementador. Hay al menos dos runtimes registrados justamente para esto.",
    409,
  );
}

/**
 * @param {string} runtime
 * @param {readonly string[]} conocidos
 */
export function runtimeDesconocido(runtime, conocidos) {
  return new ErrorDeAdaptador(
    "runtime_desconocido",
    `\`${runtime}\` no es ningun adaptador registrado. Los que hay son ` +
      `${conocidos.map((r) => `\`${r}\``).join(", ") || "ninguno"}. Un agente apuntando a un runtime que no ` +
      "existe no falla al guardarse: falla en la primera fase que lo invoca, con la tarea ya repartida.",
    `Elige uno de los runtimes registrados (${conocidos.join(", ") || "registra uno primero"}), o registra el ` +
      "adaptador antes de apuntar un agente a el.",
    400,
  );
}

/**
 * @param {string} runtime
 * @param {string} nombre
 */
export function runtimeSinHooksParaImplementador(runtime, nombre) {
  return new ErrorDeAdaptador(
    "runtime_sin_hooks_para_implementador",
    `El agente \`${nombre}\` tiene rol \`implementador\` sobre el runtime \`${runtime}\`, que declara ` +
      "`hooks: false`, y este camino lo correria FUERA del motor, sin la guarda posterior con la que el motor " +
      "sostiene el TDD de un runtime sin hooks. Los hooks del paso RED y del limite de autonomia corren DENTRO " +
      "del subproceso del runtime; sin ellos ni esa guarda, el principio I depende de que el prompt se acuerde, " +
      "y ya esta medido que un prompt " +
      "que pide TDD funciona en las dos primeras iteraciones y deja de funcionar en la tercera. Un hook no se " +
      "cansa; un recordatorio si.",
    `Usa para implementar un runtime que declare \`hooks: true\`, y deja \`${runtime}\` para revisar, ` +
      "planificar o verificar, que son roles que no escriben codigo de produccion.",
    409,
  );
}

/**
 * @param {string} runtime
 * @param {string} nombre
 */
export function techoDeGastoInaplicable(runtime, nombre) {
  return new ErrorDeAdaptador(
    "techo_de_gasto_inaplicable",
    `El agente \`${nombre}\` declara un techo de gasto en USD sobre el runtime \`${runtime}\`, que declara ` +
      "`cost: false`: no reporta cuanto gasto, asi que ese techo no puede dispararse nunca. Un limite que se " +
      "lee como puesto y no lo esta es peor que no tenerlo — es el fallo que ya corrigio `callsPerItem`, que " +
      "estaba en el esquema, en los dos ejemplos y en ningun sitio que lo hiciera cumplir.",
    `Quita \`presupuesto.usd\` de este agente y acotalo por intentos o por tiempo, que \`${runtime}\` si ` +
      "permite medir; o usa un runtime que reporte gasto.",
    409,
  );
}

/**
 * @param {string} project_id
 * @param {readonly string[]} faltan
 */
export function flotaIncompleta(project_id, faltan) {
  return new ErrorDeAdaptador(
    "flota_incompleta",
    `La flota del proyecto \`${project_id}\` no tiene ningun agente con ${faltan.length === 1 ? "el rol" : "los roles"} ` +
      `${faltan.map((r) => `\`${r}\``).join(", ")}. Activar el proyecto sin esos roles lo deja lanzando runs que ` +
      "se atascan en la primera fase que los necesita, y el operador lo descubre con el run a medias en vez de " +
      "en la pantalla donde estaba configurando.",
    `Da de alta un agente con ${faltan.length === 1 ? "el rol" : "cada uno de los roles"} ` +
      `${faltan.join(", ")} desde Flota -> Agentes y vuelve a activar.`,
    409,
    { tipo: "project", id: project_id },
  );
}

/**
 * @param {string} rol
 * @param {readonly string[]} conocidos
 */
export function rolDesconocido(rol, conocidos) {
  return new ErrorDeAdaptador(
    "rol_desconocido",
    `\`${rol}\` no es un rol de la flota. Los que existen son ${conocidos.map((r) => `\`${r}\``).join(", ")}. ` +
      "El conjunto es cerrado porque las reglas de la flota se aplican POR rol: un rol inventado no choca con " +
      "nada, no exige hooks y no cuenta para activar — o sea, se salta todas las guardas sin avisar.",
    `Declara el agente con uno de los roles existentes (${conocidos.join(", ")}).`,
    400,
  );
}

// --------------------------------------------------------------- bandeja

/**
 * @param {string} tipo
 * @param {readonly string[]} conocidos
 */
export function tipoDeEntradaDesconocido(tipo, conocidos) {
  return new ErrorDeAdaptador(
    "tipo_de_entrada_desconocido",
    `\`${tipo}\` no es un tipo de entrada de la bandeja. Los que existen son ` +
      `${conocidos.map((x) => `\`${x}\``).join(", ")}. El conjunto es cerrado porque la pantalla decide con el ` +
      "tipo que decisiones ofrece: una entrada de un tipo inventado llega a la bandeja sin acciones posibles y " +
      "se queda ahi bloqueando el trabajo que la genero.",
    `Crea la entrada con uno de los ocho tipos (${conocidos.join(", ")}).`,
    400,
  );
}

/**
 * @param {string} estado
 * @param {readonly string[]} conocidos
 */
export function estadoDeEntradaDesconocido(estado, conocidos) {
  return new ErrorDeAdaptador(
    "estado_de_entrada_desconocido",
    `\`${estado}\` no es una salida de una entrada de la bandeja. Las que hay son ` +
      `${conocidos.map((x) => `\`${x}\``).join(", ")}. Una salida de mas —"luego", "quiza"— es una entrada que ` +
      "se queda esperando para siempre y una decision que nadie registro, y la metrica de bloqueo a respuesta " +
      "deja de medir nada.",
    `Resuelve la entrada con una de las salidas declaradas (${conocidos.join(", ")}).`,
    400,
  );
}

export function causaAusente() {
  return new ErrorDeAdaptador(
    "causa_ausente",
    "La entrada de la bandeja no trae causa. La bandeja existe para que el operador decida SIN salir de la " +
      "aplicacion, y una entrada sin causa lo obliga a irse a buscar el log — que es exactamente el viaje que " +
      "el producto vino a quitar. Una entrada sin causa no es una entrada incompleta: es una interrupcion sin " +
      "informacion.",
    "Crea la entrada con el texto completo de lo que la provoco: la salida del gate, el mensaje del conflicto " +
      "o la pregunta del agente, tal cual llego.",
    400,
  );
}

/**
 * @param {string} marca lo que delata la elision
 */
export function causaResumida(marca) {
  return new ErrorDeAdaptador(
    "causa_resumida",
    `La causa llega elidida (${marca}). FR-062 pide la causa TEXTUAL Y COMPLETA, no un resumen generado, y la ` +
      "razon es la misma que sostiene el principio del exit code aplicada a la lectura: la parte que se pierde " +
      "en el resumen es justo la que habria hecho decidir distinto, y no se descubre nunca porque el original " +
      "ya no esta. Guardar un texto recortado bajo un campo que se llama `causa completa` es peor que no " +
      "tenerlo: el operador no tiene forma de saber que le falta algo.",
    "Pasa el texto completo, sin recortes ni marcas de continuacion. No hay tope: un stacktrace de 40 KB entra " +
      "entero, y si algo hay que recortar lo decide la pantalla al pintarlo, no el modelo de datos.",
    400,
  );
}

// --------------------------------------------------------------- contexto

/**
 * @param {string} fuente
 * @param {string} porque
 */
export function fuenteDeContextoAusente(fuente, porque) {
  return new ErrorDeAdaptador(
    "fuente_de_contexto_ausente",
    `No se puede compilar el contexto sin \`${fuente}\`: ${porque}`,
    `Completa \`${fuente}\` antes de lanzar el ciclo; el detalle del proyecto lista lo que falta por etapa.`,
    409,
  );
}
