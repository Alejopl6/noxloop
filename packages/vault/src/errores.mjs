// Los errores de la boveda, con la forma que exige NFR-006: codigo, causa y
// accion.
//
// POR QUE LA ACCION ES OBLIGATORIA. Un acceso denegado que solo dice "denegado"
// deja a la tarea bloqueada sin salida y al operador buscando en el codigo.
// Denegar por defecto solo es sostenible si cada negativa dice como pedir lo que
// falta; si no, la presion para aflojar la regla aparece a la tercera vez.
//
// POR QUE EL MENSAJE NO LLEVA EL VALOR. Un mensaje de error es texto que se
// persiste: va al log del servicio, al detalle de un evento y a la respuesta de
// la API. El principio IX lo nombra explicitamente entre los sitios donde el
// valor no puede estar, asi que aqui se nombran variables y referencias, nunca
// contenidos.

export class ErrorDeBoveda extends Error {
  /**
   * @param {string} codigo identificador estable, el que se compara en las pruebas
   * @param {{ causa: string, accion: string }} detalle
   */
  constructor(codigo, { causa, accion }) {
    super(`${codigo}: ${causa}`);
    this.name = "ErrorDeBoveda";
    this.codigo = codigo;
    this.causa = causa;
    this.accion = accion;
  }
}

/**
 * @param {string} codigo
 * @param {string} causa
 * @param {string} accion
 * @returns {never}
 */
export function fallar(codigo, causa, accion) {
  throw new ErrorDeBoveda(codigo, { causa, accion });
}
