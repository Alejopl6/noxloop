// Detector de guidelines: lo que el proyecto ya escribio sobre como se trabaja
// en el.
//
// POR QUE ES UNA FASE PROPIA Y NO UNA NOTA AL PIE. Porque estos documentos son
// lo unico del repositorio que declara intencion humana, y el producto que lee
// este snapshot va a proponer una constitution. Proponerle a alguien reglas que
// ya tiene escritas en su `CONTRIBUTING.md` —o peor, reglas que lo contradicen—
// es la forma mas rapida de que cierre la ventana. Lo que ya esta escrito manda
// sobre lo que el producto traiga por defecto, y para que mande hay que verlo.
//
// EL CASO QUE JUSTIFICA BUSCAR EN TODO EL ARBOL Y NO EN LA RAIZ. En este mismo
// repositorio la constitution no esta en la raiz: vive en `.specify/memory/`,
// dentro de un directorio que el `.gitignore` excluye entero y vuelve a incluir
// con una negacion. Un detector que mirara solo la raiz —o un recorrido que no
// implementara las negaciones de gitignore— se come justo el documento sin el
// cual el producto no tiene de donde partir.

import { detectado, vacio } from "../hallazgo.mjs";

/** Documentos de referencia, por nombre exacto en minuscula. */
const DOCUMENTOS = Object.freeze([
  {
    clave: "guidelines.contributing",
    nombres: ["contributing.md", "contributing.rst", "contributing.txt", "contribuir.md"],
    motivo:
      "Se recorrio el arbol buscando una guia de contribucion (`CONTRIBUTING.md` y sus variantes) y no hay " +
      "ninguna. El proyecto no tiene escrito como se trabaja en el.",
  },
  {
    clave: "guidelines.readme",
    nombres: ["readme.md", "readme.rst", "readme.txt", "readme", "leeme.md"],
    motivo:
      "No hay README en ninguna parte del arbol. Es el documento que casi todos los proyectos tienen, asi que " +
      "su ausencia es informacion por si sola.",
  },
  {
    clave: "guidelines.licencia",
    nombres: ["license", "license.md", "license.txt", "licence", "licencia.md", "copying"],
    motivo:
      "No hay archivo de licencia en el arbol. Sin el, nadie de fuera sabe que puede hacer con este codigo, y " +
      "eso condiciona a quien puede contribuir.",
  },
  {
    clave: "guidelines.codigo_de_conducta",
    nombres: ["code_of_conduct.md", "code-of-conduct.md", "codigo_de_conducta.md"],
    motivo:
      "No hay codigo de conducta en el arbol. Es informacion sobre como esta gobernado el proyecto, no una " +
      "carencia tecnica.",
  },
]);

/** Archivos que fijan estilo: son reglas con exit code detras, no recomendaciones. */
const ESTILO = Object.freeze([
  ".editorconfig",
  ".eslintrc",
  ".eslintrc.json",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.yml",
  "eslint.config.js",
  "eslint.config.mjs",
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yml",
  "prettier.config.js",
  "rustfmt.toml",
  ".rustfmt.toml",
  ".clang-format",
  "ruff.toml",
  ".ruff.toml",
  ".flake8",
  ".rubocop.yml",
  ".editorconfig-checker.json",
  "biome.json",
  "dprint.json",
]);

/** Directorios donde vive la documentacion. */
const DIRECTORIOS_DE_DOCS = new Set(["docs", "doc", "documentacion", "documentation"]);

/** Donde viven las decisiones de arquitectura, cuando se escriben. */
const DIRECTORIOS_DE_ADR = /(?:^|\/)(?:adrs?|decisions|decisiones|rfcs?)(?:\/|$)/i;
const NOMBRE_DE_ADR = /^(?:adr[-_]?\d+|\d{3,4}[-_])/i;

/**
 * @param {import("../contexto.mjs").Contexto} ctx
 */
function detectar(ctx) {
  const hallazgos = [];

  for (const documento of DOCUMENTOS) {
    const rutas = ctx.archivos
      .filter((a) => documento.nombres.includes(a.nombre.toLowerCase()))
      .map((a) => a.ruta)
      // La raiz manda: un `README.md` dentro de un paquete no es el del proyecto.
      .sort((a, b) => a.split("/").length - b.split("/").length);
    if (rutas.length > 0) {
      hallazgos.push(
        detectado("guidelines", documento.clave, rutas.slice(0, 20), rutas.slice(0, 5).map((ruta) => ({ ruta }))),
      );
    } else {
      hallazgos.push(vacio("guidelines", documento.clave, [{ ruta: "." }], documento.motivo, []));
    }
  }

  // --- Documentacion -------------------------------------------------------
  const directoriosDeDocs = ctx.directorios.filter((d) => DIRECTORIOS_DE_DOCS.has(d.slice(d.lastIndexOf("/") + 1)));
  const documentos = ctx.archivos.filter((a) => directoriosDeDocs.some((d) => a.ruta.startsWith(`${d}/`)));
  if (documentos.length > 0) {
    hallazgos.push(
      detectado(
        "guidelines",
        "guidelines.docs",
        { directorios: directoriosDeDocs.sort(), archivos: documentos.length },
        documentos.slice(0, 5).map((a) => ({ ruta: a.ruta })),
      ),
    );
  } else {
    hallazgos.push(
      vacio(
        "guidelines",
        "guidelines.docs",
        [{ ruta: "." }],
        `Se busco un directorio de documentacion (${[...DIRECTORIOS_DE_DOCS].join(", ")}) con archivos dentro y ` +
          "no hay ninguno. Lo que el proyecto explique estara en el README o en ningun sitio.",
        [],
      ),
    );
  }

  // --- Decisiones de arquitectura -----------------------------------------
  const adr = ctx.archivos
    .filter((a) => (DIRECTORIOS_DE_ADR.test(a.ruta) || NOMBRE_DE_ADR.test(a.nombre)) && a.ext === ".md")
    .map((a) => a.ruta)
    .sort();
  if (adr.length > 0) {
    hallazgos.push(detectado("guidelines", "guidelines.adr", adr.slice(0, 50), adr.slice(0, 5).map((ruta) => ({ ruta }))));
  } else {
    hallazgos.push(
      vacio(
        "guidelines",
        "guidelines.adr",
        [{ ruta: "." }],
        "Se busco un directorio de decisiones de arquitectura (`adr/`, `decisions/`, `rfc/`) y archivos con nombre " +
          "de ADR, y no hay ninguno. Las decisiones del proyecto no estan escritas, o estan en otro sitio.",
        [],
      ),
    );
  }

  // --- Reglas de estilo con exit code detras -------------------------------
  const estilo = ctx.archivos.filter((a) => ESTILO.includes(a.nombre.toLowerCase())).map((a) => a.ruta).sort();
  if (estilo.length > 0) {
    hallazgos.push(detectado("guidelines", "guidelines.estilo", estilo.slice(0, 30), estilo.slice(0, 5).map((ruta) => ({ ruta }))));
  } else {
    hallazgos.push(
      vacio(
        "guidelines",
        "guidelines.estilo",
        [{ ruta: "." }],
        "No hay ningun archivo de configuracion de formateador ni de linter en el arbol. El estilo del proyecto " +
          "no esta automatizado: sera convencion, y una convencion no tiene exit code.",
        [],
      ),
    );
  }

  // --- Constitution --------------------------------------------------------
  const constituciones = ctx.porNombre("constitution.md").concat(ctx.porNombre("constitucion.md")).sort();
  if (constituciones.length > 0) {
    const ruta = constituciones[0];
    const version = ctx.buscarTodas(ruta, /\*\*Version\*\*\s*:?\s*\*?\*?\s*([0-9]+\.[0-9]+\.[0-9]+)/i, 1)[0];
    hallazgos.push(
      detectado(
        "guidelines",
        "guidelines.constitution",
        { ruta, version: version ? version.captura[1] : null, otras: constituciones.slice(1) },
        [{ ruta, linea: version?.linea }],
      ),
    );
  } else {
    hallazgos.push(
      vacio(
        "guidelines",
        "guidelines.constitution",
        [{ ruta: "." }],
        "Se recorrio el arbol buscando un archivo `constitution.md` y no hay ninguno. El proyecto no tiene " +
          "invariantes escritos todavia — que es exactamente el hueco que este producto propone rellenar, y por " +
          "eso importa que se declare como hueco y no se rellene por cuenta propia.",
      ),
    );
  }

  return hallazgos;
}

/** @type {import("../scanner.mjs").Detector} */
const detector = { nombre: "guidelines", fase: "guidelines", detectar };
export default detector;
