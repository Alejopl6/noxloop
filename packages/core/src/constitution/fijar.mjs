// FR-021 / FR-022 — fijar la constitution en el repositorio del proyecto, y
// enmendarla dejando la version anterior recuperable desde el propio arbol.
//
// POR QUE SE ESCRIBE EN EL REPOSITORIO Y NO SOLO EN EL ALMACEN. Porque un
// proyecto clonado en otra maquina tiene que traer su contexto sin traer la
// base de datos. El almacen guarda el puntero y la copia indexada; el
// repositorio guarda la verdad. Si la constitution vive solo en el almacen, el
// runtime que corre en CI —o en el portatil de otra persona— trabaja sin las
// reglas del proyecto y no hay sintoma: produce codigo que las ignora, y el
// primero que lo nota es quien revisa el PR, si lo nota.
//
// POR QUE LA VERSION ANTERIOR SE ARCHIVA TAMBIEN EN EL ARBOL. Porque
// "recuperable" no puede depender de que la base de datos siga existiendo ni de
// que el proyecto se haya gestionado siempre desde esta aplicacion. Archivada
// al lado del documento vigente, la version anterior viaja con el `git clone`.

import { constitutionVacia, constitutionYaExiste, proyectoDesconocido, constitutionAusente } from "../errores.mjs";
import { crearConstitution, comoFecha } from "./modelo.mjs";
import { enmendar, registrarEnmienda } from "./enmienda.mjs";

/** @param {string} ruta */
function directorioDe(ruta) {
  const i = ruta.lastIndexOf("/");
  return i < 0 ? "" : ruta.slice(0, i + 1);
}

/**
 * @param {string} ruta ruta del documento vigente
 * @param {string} version
 */
export function rutaDeArchivo(ruta, version) {
  return `${directorioDe(ruta)}historial/constitution-${version}.md`;
}

/**
 * @param {string} ruta
 * @param {string} version
 */
export function rutaDeRegistro(ruta, version) {
  return `${directorioDe(ruta)}historial/enmienda-${version}.md`;
}

/**
 * @param {any} enmienda
 * @param {string} rutaArchivada
 */
export function renderEnmienda(enmienda, rutaArchivada) {
  return [
    `# Enmienda ${enmienda.version_anterior} -> ${enmienda.version_nueva}`,
    "",
    `**Fecha**: ${comoFecha(enmienda.fecha)}`,
    "",
    `**Tipo de cambio**: ${enmienda.tipo_de_cambio}`,
    "",
    "## El principio que cambia",
    "",
    enmienda.principio,
    "",
    "## El fallo que motiva el cambio",
    "",
    enmienda.fallo_que_motiva,
    "",
    "## Lo que se rompe si no se hace",
    "",
    enmienda.que_se_rompe_si_no,
    "",
    `La version ${enmienda.version_anterior} queda archivada en \`${rutaArchivada}\`.`,
    "",
  ].join("\n");
}

/**
 * @param {{
 *   project_id: string,
 *   contenido: string,
 *   ruta_en_repo: string,
 *   arbol: import("../arbol.mjs").Arbol,
 *   repositorio: import("../repositorio.mjs").RepositorioDeNucleo,
 *   ahora?: number,
 *   version?: string,
 *   invariantes?: any[],
 *   sobreescribir?: boolean,
 * }} datos
 */
export function fijarConstitution({
  project_id,
  contenido,
  ruta_en_repo,
  arbol,
  repositorio,
  ahora = Date.now(),
  version = "1.0.0",
  invariantes = [],
  sobreescribir = false,
}) {
  const proyecto = repositorio.proyecto(project_id);
  if (!proyecto) throw proyectoDesconocido(project_id);
  if (typeof contenido !== "string" || contenido.trim().length === 0) throw constitutionVacia();

  const constitution = crearConstitution({ project_id, contenido, ruta_en_repo, version, invariantes, ahora });

  // Pisar lo que el equipo del proyecto ya habia escrito es la primera forma de
  // perder su confianza, y no se recupera: la siguiente propuesta no se lee, se
  // rechaza. Si el archivo es identico al que vamos a escribir no hay nada que
  // pisar, y fijar dos veces seguidas tiene que poder hacerse.
  const previo = arbol.leer(ruta_en_repo);
  if (previo !== null && previo !== constitution.contenido && !sobreescribir) {
    throw constitutionYaExiste(ruta_en_repo);
  }

  arbol.escribir(ruta_en_repo, constitution.contenido);
  repositorio.guardarConstitution(constitution);
  const actualizado = repositorio.transicionar(project_id, "CONSTITUTED", constitution);

  return { constitution, proyecto: actualizado, escrituras: [ruta_en_repo] };
}

/**
 * @param {{
 *   project_id: string,
 *   datos: any,
 *   arbol: import("../arbol.mjs").Arbol,
 *   repositorio: import("../repositorio.mjs").RepositorioDeNucleo,
 *   ahora?: number,
 * }} entrada
 */
export function aplicarEnmienda({ project_id, datos, arbol, repositorio, ahora = Date.now() }) {
  const vigente = repositorio.constitutionVigente(project_id);
  if (!vigente) throw constitutionAusente(project_id);

  const { constitution, enmienda } = enmendar(vigente, datos, { ahora });

  // Se archiva lo que HAY en el arbol, no lo que el almacen cree que hay. Si
  // alguien edito el archivo a mano —que es exactamente lo que pasa con un
  // documento versionado junto al codigo— la version anterior real es esa.
  const enDisco = arbol.leer(vigente.ruta_en_repo);
  const rutaArchivada = rutaDeArchivo(vigente.ruta_en_repo, vigente.version);
  const rutaRegistro = rutaDeRegistro(vigente.ruta_en_repo, constitution.version);

  arbol.escribir(rutaArchivada, enDisco ?? vigente.contenido);
  arbol.escribir(rutaRegistro, renderEnmienda(enmienda, rutaArchivada));
  arbol.escribir(constitution.ruta_en_repo, constitution.contenido);

  registrarEnmienda(repositorio, { anterior: vigente, constitution, enmienda });

  return {
    constitution,
    enmienda,
    escrituras: [constitution.ruta_en_repo, rutaArchivada, rutaRegistro],
  };
}
