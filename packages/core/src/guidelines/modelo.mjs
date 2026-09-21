// Guidelines por area, versionadas junto al codigo, con lo que el runtime
// puede VERIFICAR separado de lo que solo puede leer.
//
// POR QUE ESA SEPARACION ES EL PUNTO. Es la diferencia que el producto declara
// entre constitution y guidelines: la constitution son invariantes que se
// discuten entre personas; las guidelines son documentacion que ADEMAS lleva
// reglas comprobables por una maquina. Si todo entra en el mismo saco, el
// runtime acaba "aplicando" parrafos —o sea, pidiendole a un modelo que decida
// si un texto se cumplio— y eso es el verde inventado del principio II con otro
// disfraz: una afirmacion sin exit code detras.
//
// POR QUE UNA REGLA SIN COMPROBACION SE DEGRADA EN VEZ DE FILTRARSE. Porque
// filtrarla en silencio es inventar contexto hacia quien la escribio: se queda
// creyendo que el runtime la vigila, y descubre que no el dia que algo pasa el
// gate violandola. Degradada CON su motivo, sigue en el documento —que es donde
// sirve— y ademas dice por que no se puede comprobar sola.

import { randomUUID } from "node:crypto";

import { areaDesconocida } from "../errores.mjs";

/** @type {readonly string[]} */
export const AREAS = Object.freeze(["frontend", "backend", "testing", "git", "seguridad", "agentes", "diseno"]);

/**
 * Las formas de comprobacion que un runtime puede correr sin preguntarle a
 * nadie. Es una tabla: una forma mas es una fila, y su requisito al lado.
 *
 * Todas terminan en algo binario y observable —un exit code, un archivo que
 * esta o no esta, un patron que coincide o no— porque el criterio de exito de
 * este proyecto es un exit code y nunca una frase.
 *
 * @type {Readonly<Record<string, {requiere: readonly string[], describe: (c: any) => string}>>}
 */
export const FORMAS_DE_COMPROBACION = Object.freeze({
  comando: {
    requiere: ["comando"],
    describe: (c) => `corre \`${c.comando}\` y exige exit code 0`,
  },
  archivo_existe: {
    requiere: ["ruta"],
    describe: (c) => `exige que exista \`${c.ruta}\``,
  },
  archivo_ausente: {
    requiere: ["ruta"],
    describe: (c) => `exige que NO exista \`${c.ruta}\``,
  },
  contenido_coincide: {
    requiere: ["ruta", "patron"],
    describe: (c) => `exige que \`${c.ruta}\` contenga \`${c.patron}\``,
  },
  ruta_prohibida: {
    requiere: ["patron"],
    describe: (c) => `rechaza cualquier ruta que coincida con \`${c.patron}\``,
  },
});

/** @type {readonly string[]} */
export const COMPROBACIONES = Object.freeze(Object.keys(FORMAS_DE_COMPROBACION));

/**
 * @param {any} regla
 * @returns {string|null} el motivo por el que el runtime no puede verificarla, o `null` si puede
 */
export function motivoDeNoVerificable(regla) {
  const c = regla?.comprobacion;
  if (!c || typeof c !== "object") {
    return (
      "no declara ninguna `comprobacion`, asi que el runtime no tiene nada que correr: queda como " +
      `documentacion. Para que la verifique, dale una de estas formas: ${COMPROBACIONES.join(", ")}.`
    );
  }
  const forma = /** @type {any} */ (FORMAS_DE_COMPROBACION)[c.tipo];
  if (!forma) {
    return (
      `\`${c.tipo}\` no es una forma de comprobacion que el runtime sepa correr. Las que existen son ` +
      `${COMPROBACIONES.join(", ")}; todas terminan en algo observable, que es la condicion para que el ` +
      "resultado no dependa de la opinion de un modelo."
    );
  }
  const faltan = forma.requiere.filter((/** @type {string} */ campo) => {
    const v = c[campo];
    return typeof v !== "string" || v.trim().length === 0;
  });
  if (faltan.length > 0) {
    return (
      `la comprobacion \`${c.tipo}\` no trae ${faltan.map((/** @type {string} */ f) => `\`${f}\``).join(", ")}. ` +
      "Sin eso no hay nada concreto que correr, y una regla que se verifica 'mas o menos' no se verifica."
    );
  }
  return null;
}

/**
 * @param {any} guideline
 * @returns {string}
 */
export function renderGuideline(guideline) {
  const lineas = [];
  lineas.push(`# Guidelines de ${guideline.area}`);
  lineas.push("");
  if (guideline.contenido.trim().length > 0) {
    lineas.push(guideline.contenido.trim());
    lineas.push("");
  }

  lineas.push("## Reglas que el runtime verifica");
  lineas.push("");
  if (guideline.reglas_aplicables.length === 0) {
    lineas.push("[vacio] Ninguna regla de esta area se puede comprobar sola todavia.");
  } else {
    for (const r of guideline.reglas_aplicables) {
      const forma = /** @type {any} */ (FORMAS_DE_COMPROBACION)[r.comprobacion.tipo];
      lineas.push(`- **${r.enunciado}** (\`${r.id}\`) — ${forma.describe(r.comprobacion)}`);
    }
  }
  lineas.push("");

  lineas.push("## Documentacion");
  lineas.push("");
  lineas.push(
    "Lo de aqui abajo **no la verifica el runtime**: se lee. Cada entrada dice por que no se puede comprobar " +
      "sola, para que nadie la de por vigilada.",
  );
  lineas.push("");
  if (guideline.documentacion.length === 0) {
    lineas.push("[vacio] Todas las reglas de esta area son comprobables.");
  } else {
    for (const d of guideline.documentacion) {
      lineas.push(`- **${d.enunciado}** (\`${d.id}\`) — ${d.motivo}`);
    }
  }
  lineas.push("");

  return lineas.join("\n");
}

/**
 * @param {{project_id: string, area: string, contenido?: string, reglas?: any[], ruta_en_repo?: string, ahora?: number, id?: string}} datos
 */
export function crearGuideline({
  project_id,
  area,
  contenido = "",
  reglas = [],
  ruta_en_repo = "",
  ahora = Date.now(),
  id,
}) {
  if (!AREAS.includes(area)) throw areaDesconocida(area, AREAS);

  /** @type {any[]} */
  const aplicables = [];
  /** @type {any[]} */
  const documentacion = [];

  reglas.forEach((regla, i) => {
    const identificador = typeof regla?.id === "string" && regla.id ? regla.id : `regla-${i + 1}`;
    const enunciado = String(regla?.enunciado ?? "").trim();
    const motivo = motivoDeNoVerificable(regla);
    if (motivo === null) {
      aplicables.push(Object.freeze({ id: identificador, enunciado, comprobacion: Object.freeze({ ...regla.comprobacion }) }));
    } else {
      documentacion.push(Object.freeze({ id: identificador, enunciado, motivo }));
    }
  });

  const guideline = {
    id: id ?? `gdl_${randomUUID()}`,
    project_id,
    area,
    ruta_en_repo,
    contenido,
    reglas_aplicables: Object.freeze(aplicables),
    documentacion: Object.freeze(documentacion),
    actualizada: new Date(ahora).toISOString(),
    documento: "",
  };
  guideline.documento = renderGuideline(guideline);
  return Object.freeze(guideline);
}

/**
 * Donde se escribe la guideline de un area.
 *
 * Cuelga de donde vive la constitution porque las dos son el contexto del
 * proyecto y tienen que viajar juntas en un `git clone`. Si la constitution
 * esta en la raiz, las guidelines van a `guidelines/`; si esta dentro de un
 * directorio, van dentro de ese.
 *
 * @param {string} area
 * @param {string} rutaDeLaConstitution
 */
export function rutaDeGuideline(area, rutaDeLaConstitution) {
  const i = String(rutaDeLaConstitution ?? "").lastIndexOf("/");
  const directorio = i < 0 ? "" : rutaDeLaConstitution.slice(0, i + 1);
  return `${directorio}guidelines/${area}.md`;
}

/**
 * @param {{guideline: any, arbol: import("../arbol.mjs").Arbol, repositorio: import("../repositorio.mjs").RepositorioDeNucleo, ruta_en_repo?: string}} datos
 */
export function guardarGuideline({ guideline, arbol, repositorio, ruta_en_repo }) {
  const ruta = ruta_en_repo ?? guideline.ruta_en_repo;
  const conRuta = Object.freeze({ ...guideline, ruta_en_repo: ruta });
  arbol.escribir(ruta, conRuta.documento);
  repositorio.guardarGuideline(conRuta);
  return { guideline: conRuta, escrituras: [ruta] };
}
