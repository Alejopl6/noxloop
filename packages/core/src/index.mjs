// La superficie publica del nucleo: el dominio de las etapas 02-05.
//
// Lo que sale de aqui es lo que el servicio de control consume, y nada mas.
// Cuanto mas corta es esta lista, mas barato es cambiar lo de dentro sin romper
// a quien lo usa — y este paquete es el que mas va a cambiar, porque las etapas
// 02-05 son donde el producto todavia esta aprendiendo que hace falta.

export { ErrorDeNucleo } from "./errores.mjs";

export { arbolDeDisco, arbolEnMemoria, rutaSegura } from "./arbol.mjs";
export { repositorioEnMemoria, ESTADOS, TRANSICIONES } from "./repositorio.mjs";
export { TIPOS_DE_CAMBIO, SALTOS, subir, comparar } from "./semver.mjs";

export { crearConstitution, sellarPie, rutaDeConstitution, RUTA_POR_DEFECTO } from "./constitution/modelo.mjs";
export {
  enmendar,
  validarEnmienda,
  registrarEnmienda,
  recuperarVersion,
  CAMPOS_DE_ENMIENDA,
  MINIMOS,
} from "./constitution/enmienda.mjs";
export { proponerConstitution, derivarApartado, APARTADOS, VERSION_DE_BORRADOR } from "./constitution/propuesta.mjs";
export { fijarConstitution, aplicarEnmienda, rutaDeArchivo, rutaDeRegistro } from "./constitution/fijar.mjs";

export {
  crearGuideline,
  guardarGuideline,
  renderGuideline,
  rutaDeGuideline,
  motivoDeNoVerificable,
  AREAS,
  COMPROBACIONES,
  FORMAS_DE_COMPROBACION,
} from "./guidelines/modelo.mjs";
export { etapaDeDiseno, omitirDiseno, definirDiseno } from "./guidelines/diseno.mjs";

export { detectarExistente, valoresDe, tieneSustancia, CAPACIDADES } from "./bootstrap/deteccion.mjs";
export { huellaDe, diffDeArchivo, calcularCambios } from "./bootstrap/diff.mjs";
export { conflictoDe, invariantesDe, efectosDe, EFECTOS } from "./bootstrap/conflicto.mjs";
export { CATALOGO_POR_DEFECTO, TIPOS } from "./bootstrap/catalogo.mjs";
export { analizar } from "./bootstrap/motor.mjs";
export { aplicar, personalizar, omitir, DECISIONES } from "./bootstrap/decision.mjs";
