// La superficie publica de la asistencia.
//
// Lo que sale de aqui es lo que el servicio de control consume, y nada mas.
// `proveedor-ai-sdk.mjs` NO se reexporta a proposito: es la frontera con el
// SDK, la unica pieza que nombra un paquete de terceros, y quien la quiera la
// importa por su ruta. Reexportarla desde aqui haria que cualquiera que importe
// este paquete arrastrase la resolucion del SDK, y entonces la asistencia ya no
// podria declarar su ausencia — el modulo que la declara no llegaria a
// cargarse.

export { ErrorDeAsistencia } from "./errores.mjs";
export { crearAsistencia } from "./asistencia.mjs";
export { TAREAS, tareaPorClave } from "./tareas.mjs";
export { ORIGEN_DE_LO_SUGERIDO, ADVERTENCIA, CAMPO_DE_CITA } from "./marca.mjs";
export { CATEGORIAS_POR_AREA, hallazgosDe } from "./insumo.mjs";
