// La boveda de credenciales de noxloop.
//
// El valor de una credencial existe en exactamente dos sitios: el backend de
// secretos del sistema operativo, y el entorno del subproceso que tiene grant
// vigente, mientras ese subproceso vive. Este paquete es el unico camino entre
// los dos.
//
// POR QUE NO IMPORTA NADA DE FUERA DE `packages/vault/`. Al escritorio viaja
// como recurso suelto, igual que el servicio: un import relativo que salga del
// paquete resuelve en el repositorio y muere en la aplicacion instalada. Hay una
// prueba que lo prohibe (`test/paquete-cerrado.test.mjs`).

export { ErrorDeBoveda } from "./errores.mjs";
export { crearBoveda } from "./boveda.mjs";
export { repositorioEnMemoria } from "./repositorio.mjs";
export { crearAuditoria } from "./auditoria.mjs";
export { crearCredencial, crearGrant, estadoDelGrant, PROPOSITOS, BACKENDS } from "./modelo.mjs";
export { construirRef, partirRef, nuevoIdDeCredencial } from "./referencia.mjs";
export { huellaDe, salPorDefecto } from "./huella.mjs";
export { elegirBackend, descripcionParaCapacidades, esBackendConocido } from "./backends/seleccion.mjs";
export { crearBackendDeArchivo } from "./backends/archivo.mjs";
export { crearBackendDeLlavero } from "./backends/llavero.mjs";
export { crearRedactor } from "./redactor.mjs";
export { construirEntorno, prepararLanzamiento, lanzar } from "./entorno.mjs";
export { crearSesionSsh, ALLOWLIST_DE_LECTURA } from "./ssh.mjs";
