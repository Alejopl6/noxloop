// La superficie publica de la capa de runtimes.
//
// Lo que sale de aqui es lo que el servicio de control y el cableado del motor
// consumen, y nada mas. Cuanto mas corta es esta lista, mas barato es cambiar lo
// de dentro sin romper a quien lo usa.

export { ErrorDeAdaptador } from "./errores.mjs";

export {
  CLAVES_DE_CAPACIDAD,
  CAPACIDADES_OPCIONALES,
  adaptarADriver,
  esRevision,
  normalizarPeticion,
  resultadoDeFase,
  validarAdaptador,
  validarPeticion,
  validarResultado,
} from "./contrato.mjs";

export { PRUEBAS_DEL_CONTRATO, pruebasDelContrato } from "./suite.mjs";
export { registroDeAdaptadores } from "./registro.mjs";
export { lanzar, leerLanzamiento, secretoEnArgv } from "./proceso.mjs";
export { esCorteDePresupuesto, leerResultadoJson, leerResultadoJsonl } from "./salida.mjs";

// Si un runtime tiene con que invocar al modelo (sesion local o API key), para
// el preflight y para la pantalla de modelos.
export {
  RUNTIMES_CON_SESION,
  ejecutorDeProceso,
  entornoDeclarado,
  estadoDeAutenticacion,
} from "./autenticacion.mjs";

export { crearAdaptadorFake } from "./adaptadores/fake.mjs";
export { crearAdaptadorClaude, sdkDisponible, HERRAMIENTAS_POR_DEFECTO } from "./adaptadores/claude-agent-sdk.mjs";
export { crearAdaptadorCodex } from "./adaptadores/codex.mjs";

export { ROLES, activarFlota, crearAgente, guardarAgente, validarFlota } from "./flota/agente.mjs";
export { repositorioDeFlotaEnMemoria } from "./flota/repositorio.mjs";
export { CAMPOS, ORIGENES, sugerirFlota } from "./flota/sugerencia.mjs";

export {
  ESTADOS_DE_ENTRADA,
  TIPOS_DE_ENTRADA,
  crearEntrada,
  resolverEntrada,
  tiempoDeBloqueoAResp,
} from "./bandeja/entrada.mjs";

export { PRECEDENCIA, compilarContexto, fuenteQueGana } from "./contexto/compilador.mjs";
