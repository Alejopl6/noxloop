// Los errores de la capa de integracion, con la forma que exige NFR-006:
// codigo, causa y accion.
//
// POR QUE LA ACCION ES OBLIGATORIA, Y AQUI MAS QUE EN NINGUN SITIO. Lo que
// falla en una integracion casi nunca esta en esta maquina: un puerto que otro
// proceso tomo, un contenedor que no arranco, una aplicacion OAuth con el
// redirect mal registrado, un PAT que caduco. Un error que solo dice "no se
// pudo conectar" manda al operador a revisar sus credenciales, que es justo el
// sitio donde no esta el problema.
//
// POR QUE EL MENSAJE NO LLEVA EL VALOR. Un error es texto que se persiste: va
// al log del servicio, al detalle de un evento y a la respuesta de la API. El
// principio IX nombra esos tres sitios entre los que el valor no puede tocar.
//
// POR QUE ESTA CLASE ESTA DUPLICADA Y NO IMPORTADA. Existe una igual en el
// paquete de la boveda. Este paquete viaja al escritorio como recurso suelto:
// un import que salga de aqui resuelve en el repositorio y muere en la
// aplicacion instalada. Treinta lineas repetidas cuestan menos que eso.

export class ErrorDeConexion extends Error {
  /**
   * @param {string} codigo identificador estable, el que se compara en las pruebas
   * @param {{ causa: string, accion: string }} detalle
   */
  constructor(codigo, { causa, accion }) {
    super(`${codigo}: ${causa}`);
    this.name = "ErrorDeConexion";
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
  throw new ErrorDeConexion(codigo, { causa, accion });
}
