// La capa de integracion de noxloop: una fachada propia delante de la capa de
// integracion alojada, y dos adaptadores que no la necesitan.
//
// SE LLAMA `ConnectionProvider` Y NO `OAuthProvider` POR UN MOTIVO VERIFICADO.
// De los cinco proveedores objetivo, dos no usan OAuth: uno se conecta con un
// token personal y el otro con una clave de API. Si la interfaz asumiera un
// flujo de autorizacion, el error habria aparecido al implementarlos, con todo
// construido alrededor. El modo lo decide el catalogo, no quien llama.
//
// POR QUE NO IMPORTA NADA DE FUERA DE `packages/connections/`. Viaja al
// escritorio como recurso suelto, igual que la boveda y el escaner: un import
// relativo que salga del paquete resuelve en el repositorio y muere en la
// aplicacion instalada. El deposito de secretos y la persistencia llegan
// inyectados, y hay una prueba que lo prohibe
// (`test/paquete-autocontenido.test.mjs`).

export { ErrorDeConexion, fallar } from "./errores.mjs";
export {
  MODOS_AUTH,
  MODOS_SIN_AUTORIZACION,
  CLASES,
  ESTADOS,
  crearConexion,
  validarEntradaDeCatalogo,
  congelar,
} from "./modelo.mjs";
export { CATALOGO_POR_DEFECTO, catalogoPorModo } from "./catalogo.mjs";
export { VIGENCIA_MAXIMA_MS, VIGENCIA_POR_DEFECTO_MS, acotarVigencia } from "./vigencia.mjs";
export { PUERTO_DE_CALLBACK, HOST_DE_CALLBACK, sondearPuertoConNet, problemaDePuertoOcupado } from "./preflight.mjs";
export { arrancar } from "./arranque.mjs";
export { repositorioEnMemoria } from "./repositorio.mjs";
export { crearProveedorDeConexiones } from "./proveedor.mjs";
export { chequeosDeContrato, validarProveedorDeConexiones, METODOS_DEL_CONTRATO } from "./contrato.mjs";
export { crearAdaptadorFalso, CATALOGO_FALSO, fixturesDeContrato } from "./adaptadores/fake.mjs";
export { crearAdaptadorLocal, MODOS_DEL_ADAPTADOR_LOCAL } from "./adaptadores/local.mjs";
export { crearAdaptadorNango, REQUISITOS_DE_NANGO } from "./adaptadores/nango.mjs";
