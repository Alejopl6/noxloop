// El almacen consultable de noxloop.
//
// Guarda lo que se consulta —proyectos, snapshots, credenciales, grants,
// auditoria, recomendaciones, memoria— y NO guarda el estado del run, que vive
// en archivos atomicos fuera de los repositorios y lo escribe `state.mjs`. Un
// hook corre dentro de un worktree, sin dependencias y sin conexion abierta:
// tiene que leer un archivo y decidir en milisegundos, no abrir una base de
// datos. Una discrepancia entre los dos se resuelve siempre a favor del archivo.
//
// POR QUE NO IMPORTA NADA DE FUERA DE `packages/store/`. Al escritorio viaja
// como recurso suelto, igual que el servicio, la boveda y el scanner: un import
// relativo que salga del paquete resuelve en el repositorio y muere en la
// aplicacion instalada. Hay una prueba que lo prohibe
// (`test/paquete-autocontenido.test.mjs`), y aqui la tentacion tiene nombre:
// este paquete implementa la interfaz que declara `packages/vault`.

export { abrirAlmacen } from "./almacen.mjs";
export { ErrorDeAlmacen, CATALOGO, fallar } from "./errores.mjs";
export { MIGRACIONES, aplicarMigraciones, versionDeEsquema } from "./migraciones.mjs";
export { TABLAS, ENUMS } from "./esquema.mjs";
export { ESTADOS, TRANSICIONES, GUARDAS, transicionesDesde } from "./proyecto.mjs";
export { GENESIS, hashDeEvento } from "./auditoria.mjs";
export { abrirBase, esAdvertenciaExperimentalDeSqlite, sinLaAdvertenciaDeSqlite } from "./sqlite.mjs";
