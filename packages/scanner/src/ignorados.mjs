// Las exclusiones del recorrido: las fijas del contrato y las que declara el
// propio proyecto en sus `.gitignore`.
//
// POR QUE SE IMPLEMENTA EL MATCHER EN VEZ DE PREGUNTARLE A GIT. Porque
// `git check-ignore` es un proceso por consulta —o uno con la lista entera por
// entrada estandar— y el scanner no ejecuta nada: ni del proyecto, ni sobre el.
// El contrato lo prohibe sin matices, y un `git` invocado sobre el arbol ajeno
// es exactamente la clase de cosa que puede tocar `.git/index` sin que nadie lo
// pidiera. Ademas hay arboles sin `.git`, y esos tienen `.gitignore` igual.
//
// POR QUE IMPORTA LA NEGACION. El `.gitignore` de este mismo repositorio dice
// `/.specify/*` y despues `!/.specify/memory/`. Un matcher que ignore las
// negaciones se come la constitution del proyecto, que es justo el documento
// sin el cual no hay de donde partir. El caso no es teorico: es el arbol sobre
// el que corre el test de aceptacion.

/** Del contrato, literal. No se amplia: excluir de mas es esconder el proyecto. */
export const EXCLUIDOS_POR_DEFECTO = Object.freeze([
  ".git",
  "node_modules",
  "dist",
  "build",
  "target",
  "vendor",
]);

const POR_DEFECTO = new Set(EXCLUIDOS_POR_DEFECTO);

/** @param {string} nombre */
export function excluidoPorDefecto(nombre) {
  return POR_DEFECTO.has(nombre);
}

/**
 * @typedef {object} Regla
 * @property {RegExp} re
 * @property {boolean} negada
 * @property {boolean} soloDirectorio
 * @property {string} origen ruta del `.gitignore` que la declara
 * @property {string} patron
 */

/**
 * Traduce un patron de gitignore a una expresion regular.
 *
 * Las reglas que importan, y que un `String.includes` no da:
 *   - `*` no cruza `/`; `**` si.
 *   - un patron con `/` en medio esta anclado al directorio del `.gitignore`;
 *     uno sin `/` casa a cualquier profundidad.
 *   - el `/` final restringe la regla a directorios.
 *
 * @param {string} crudo
 * @returns {{cuerpo: string, anclado: boolean, soloDirectorio: boolean}}
 */
function traducir(crudo) {
  let patron = crudo;
  const soloDirectorio = patron.endsWith("/");
  if (soloDirectorio) patron = patron.slice(0, -1);
  const anclado = patron.startsWith("/") || patron.slice(0, -1).includes("/");
  if (patron.startsWith("/")) patron = patron.slice(1);

  let cuerpo = "";
  for (let i = 0; i < patron.length; i++) {
    const c = patron[i];
    if (c === "*") {
      if (patron[i + 1] === "*") {
        // `**/` se come cualquier numero de directorios, incluido ninguno.
        if (patron[i + 2] === "/") {
          cuerpo += "(?:[^/]+/)*";
          i += 2;
        } else {
          cuerpo += ".*";
          i += 1;
        }
      } else {
        cuerpo += "[^/]*";
      }
    } else if (c === "?") {
      cuerpo += "[^/]";
    } else if (c === "[") {
      const cierre = patron.indexOf("]", i + 1);
      if (cierre === -1) {
        cuerpo += "\\[";
      } else {
        let clase = patron.slice(i + 1, cierre);
        if (clase.startsWith("!")) clase = "^" + clase.slice(1);
        cuerpo += `[${clase}]`;
        i = cierre;
      }
    } else {
      cuerpo += c.replace(/[.+^${}()|\\\/\]]/g, "\\$&");
    }
  }
  return { cuerpo, anclado, soloDirectorio };
}

/**
 * @param {string} texto contenido de un `.gitignore`
 * @param {string} origen ruta relativa del archivo, para poder citarlo
 * @returns {Regla[]}
 */
export function compilar(texto, origen) {
  /** @type {Regla[]} */
  const reglas = [];
  for (const linea of texto.split(/\r?\n/)) {
    let patron = linea;
    if (!patron.trim() || patron.trimStart().startsWith("#")) continue;
    // Un espacio final se ignora salvo que vaya escapado; el escape no se usa
    // casi nunca y equivocarse aqui borra patrones legitimos.
    patron = patron.replace(/(?<!\\)\s+$/, "");
    if (!patron) continue;
    const negada = patron.startsWith("!");
    if (negada) patron = patron.slice(1);
    if (!patron) continue;
    const { cuerpo, anclado, soloDirectorio } = traducir(patron);
    const re = new RegExp(anclado ? `^${cuerpo}$` : `^(?:.*/)?${cuerpo}$`);
    reglas.push({ re, negada, soloDirectorio, origen, patron });
  }
  return reglas;
}

/**
 * @typedef {object} Grupo
 * @property {string} base directorio del `.gitignore`, relativo a la raiz ("" si es el de arriba)
 * @property {Regla[]} reglas
 */

/**
 * Gana la ULTIMA regla que casa, igual que en git: dentro de un archivo manda
 * la ultima linea, y entre archivos manda el mas profundo. Es lo que hace que
 * `!/.specify/memory/` despues de `/.specify/*` vuelva a incluir el directorio.
 *
 * @param {Grupo[]} grupos de fuera hacia dentro
 * @param {string} ruta relativa a la raiz del recorrido
 * @param {boolean} esDirectorio
 * @returns {Regla|null} la regla que decide excluir, o `null` si no se excluye
 */
export function decide(grupos, ruta, esDirectorio) {
  /** @type {Regla|null} */
  let ultima = null;
  for (const grupo of grupos) {
    if (grupo.base && !ruta.startsWith(grupo.base + "/")) continue;
    const relativa = grupo.base ? ruta.slice(grupo.base.length + 1) : ruta;
    for (const regla of grupo.reglas) {
      if (regla.soloDirectorio && !esDirectorio) continue;
      if (regla.re.test(relativa)) ultima = regla;
    }
  }
  if (!ultima || ultima.negada) return null;
  return ultima;
}
