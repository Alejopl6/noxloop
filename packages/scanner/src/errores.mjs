// Los errores del scanner dicen la causa completa y la accion siguiente.
//
// EL FALLO QUE EVITA. El scanner es lo primero que alguien corre, y lo corre
// sobre una ruta que escribio a mano. Los dos errores frecuentes son la ruta
// mal escrita y el permiso, y los dos salen por defecto como `ENOENT` o
// `EACCES`: tecnicamente ciertos, y dejan al operador mirando un codigo de
// errno en una ventana que acaba de abrir. Un scanner que falla asi se
// desinstala antes de la segunda ruta.

/**
 * Un error que ya sabe decir que paso y que hacer despues.
 */
export class ErrorDeScanner extends Error {
  /**
   * @param {string} codigo
   * @param {string} causa texto completo, no un resumen
   * @param {string} accion una operacion concreta, nunca "reintenta"
   */
  constructor(codigo, causa, accion) {
    super(causa);
    this.name = "ErrorDeScanner";
    this.codigo = codigo;
    this.causa = causa;
    this.accion = accion;
  }
}

/**
 * @param {string} ruta
 * @param {string} detalle
 */
export function rutaInaccesible(ruta, detalle) {
  return new ErrorDeScanner(
    "ruta_inaccesible",
    `No se pudo abrir \`${ruta}\` para leerla: ${detalle}. El scanner solo lee, asi que esto no es un ` +
      "permiso de escritura que falte: es que la ruta no existe o no se puede listar con este usuario.",
    "Comprueba la ruta y que el usuario que corre el scanner pueda listarla. Si la ruta lleva un enlace " +
      "simbolico, apunta al directorio de destino: el scanner no sigue enlaces, a proposito.",
  );
}

/**
 * @param {string} ruta
 */
export function noEsDirectorio(ruta) {
  return new ErrorDeScanner(
    "no_es_directorio",
    `\`${ruta}\` no es un directorio. El scanner recorre el arbol de un proyecto, y un archivo suelto no ` +
      "tiene ni manifiestos, ni estructura, ni workflows que leer.",
    "Apunta el scanner al directorio raiz del proyecto — el que contiene el manifiesto y, normalmente, `.git`.",
  );
}
