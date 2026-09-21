// La enmienda: los tres campos obligatorios, la version que sube sola y el
// historial con la version anterior recuperable.
//
// EL FALLO QUE MOTIVA LOS TRES CAMPOS. Esta escrito en la constitution de este
// repositorio, en su seccion de gobernanza: "Una enmienda sin un fallo detras
// no es una enmienda: es una preferencia". Lo que exigimos de nosotros lo exige
// el producto, y no como una etiqueta de formulario.
//
// Lo que ocurre sin el campo se ve en cualquier guia de estilo con años encima:
// la regla entro porque a alguien le parecio mejor, nadie recuerda por que, y
// nadie se atreve a quitarla porque tampoco sabe que se rompe si la quita. El
// resultado no es una regla: es sedimento. `fallo_que_motiva` y
// `que_se_rompe_si_no` son lo unico que permite retirar un principio el dia que
// el fallo que lo motivaba deja de existir.
//
// POR QUE HAY UN MINIMO DE LONGITUD Y NO SOLO "NO VACIO". Porque `porque si`
// cumple "el campo no esta vacio" y no cumple nada de lo que el campo existe
// para conseguir. Un obligatorio que se satisface con dos palabras se convierte
// en un tramite, y el tramite entrena a saltarselo. El minimo es el mismo que
// el scanner exige para declarar un hueco, por la misma razon.

import { randomUUID } from "node:crypto";

import { enmiendaIncompleta } from "../errores.mjs";
import { subir, TIPOS_DE_CAMBIO } from "../semver.mjs";
import { sellarPie } from "./modelo.mjs";

/** @type {readonly string[]} */
export const CAMPOS_DE_ENMIENDA = Object.freeze(["principio", "fallo_que_motiva", "que_se_rompe_si_no"]);

/** Cuantos caracteres hacen falta en cada campo para que diga algo. */
export const MINIMOS = Object.freeze({
  // El principio puede ser un titulo: `El test primero` son quince caracteres y
  // dice exactamente lo que tiene que decir.
  principio: 3,
  // Los otros dos no pueden serlo: nombrar un fallo concreto —que paso, cuando,
  // que costo— no cabe en una frase de tres palabras.
  fallo_que_motiva: 20,
  que_se_rompe_si_no: 20,
});

/** Cuando el tipo de cambio no se declara. Redefinir es lo que hace una enmienda por defecto. */
export const TIPO_POR_DEFECTO = "principio_redefinido";

/**
 * @param {any} datos
 * @returns {{principio: string, fallo_que_motiva: string, que_se_rompe_si_no: string}}
 */
export function validarEnmienda(datos) {
  /** @type {string[]} */
  const ausentes = [];
  /** @type {Array<{campo: string, largo: number, minimo: number}>} */
  const breves = [];
  /** @type {any} */
  const limpio = {};

  for (const campo of CAMPOS_DE_ENMIENDA) {
    const valor = typeof datos?.[campo] === "string" ? datos[campo].trim() : "";
    if (valor.length === 0) {
      ausentes.push(campo);
      continue;
    }
    const minimo = /** @type {any} */ (MINIMOS)[campo];
    if (valor.length < minimo) {
      breves.push({ campo, largo: valor.length, minimo });
      continue;
    }
    limpio[campo] = valor;
  }

  if (ausentes.length > 0 || breves.length > 0) throw enmiendaIncompleta(ausentes, breves);
  return limpio;
}

/**
 * @param {any} vigente
 * @param {any} datos
 * @param {{ahora?: number}} [opts]
 * @returns {{constitution: any, enmienda: any}}
 */
export function enmendar(vigente, datos, opts = {}) {
  const ahora = opts.ahora ?? Date.now();
  const campos = validarEnmienda(datos);
  const tipo_de_cambio = datos?.tipo_de_cambio ?? TIPO_POR_DEFECTO;
  const version_nueva = subir(vigente.version, tipo_de_cambio);

  const constitution = Object.freeze({
    id: `con_${randomUUID()}`,
    project_id: vigente.project_id,
    version: version_nueva,
    ruta_en_repo: vigente.ruta_en_repo,
    contenido: sellarPie(typeof datos?.contenido === "string" && datos.contenido.trim() ? datos.contenido : vigente.contenido, {
      version: version_nueva,
      ratificada: vigente.ratificada,
      enmendada: ahora,
    }),
    ratificada: vigente.ratificada,
    enmendada: new Date(ahora).toISOString(),
    vigente: true,
    invariantes: Object.freeze([...(datos?.invariantes ?? vigente.invariantes ?? [])]),
  });

  const enmienda = Object.freeze({
    id: `enm_${randomUUID()}`,
    project_id: vigente.project_id,
    constitution_id: constitution.id,
    version_anterior: vigente.version,
    version_nueva,
    tipo_de_cambio,
    ...campos,
    fecha: new Date(ahora).toISOString(),
  });

  return { constitution, enmienda };
}

/**
 * Deja la anterior archivada y la nueva vigente. Una sola vigente por proyecto.
 *
 * @param {import("../repositorio.mjs").RepositorioDeNucleo} repositorio
 * @param {{anterior: any, constitution: any, enmienda: any}} datos
 */
export function registrarEnmienda(repositorio, { anterior, constitution, enmienda }) {
  repositorio.guardarConstitution({ ...anterior, vigente: false });
  repositorio.guardarConstitution(constitution);
  repositorio.guardarEnmienda(enmienda);
}

/**
 * La version anterior, recuperable (FR-022).
 *
 * @param {import("../repositorio.mjs").RepositorioDeNucleo} repositorio
 * @param {string} project_id
 * @param {string} version
 */
export function recuperarVersion(repositorio, project_id, version) {
  return repositorio.constituciones(project_id).find((/** @type {any} */ c) => c.version === version) ?? null;
}

export { TIPOS_DE_CAMBIO };
