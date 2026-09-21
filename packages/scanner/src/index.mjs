// La superficie publica del scanner.
//
// Lo que sale de aqui es lo que el servicio de control consume, y nada mas: el
// recorrido, el registro de detectores, las fases y los constructores de
// hallazgo. Todo lo demas —el matcher de gitignore, el contexto de lectura, la
// redaccion— es interno a proposito. Cuanto mas pequeña es esta lista, mas
// barato es cambiar lo de dentro sin romper a quien lo usa.

export { escanear } from "./scanner.mjs";
export { FASES, CATEGORIAS } from "./fases.mjs";
export { DETECTORES } from "./detectores/index.mjs";
export { detectado, inferido, vacio, motivoDeRechazo, ErrorDeHallazgo } from "./hallazgo.mjs";
export { ErrorDeScanner } from "./errores.mjs";
export { EXCLUIDOS_POR_DEFECTO } from "./ignorados.mjs";
