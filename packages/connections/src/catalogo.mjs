// El catalogo: que proveedores externos se conocen y como se autentica cada
// uno.
//
// ESTE ARCHIVO ES DATO, NO LOGICA, Y ESTA SEPARADO POR ESO. Es el unico sitio
// del paquete donde hay nombres propios de productos ajenos; el resto del
// codigo no sabe de ninguno. Agregar un proveedor es agregar una entrada aqui.
//
// EL HALLAZGO QUE GOBIERNA LA TABLA. Verificado el 2026-09-20: los gestores de
// tickets y el SCM se conectan por OAuth2, pero DOS de los objetivos declarados
// no. Uno se conecta con un token personal por autenticacion basica y el otro
// con una clave de API. No son casos raros: son dos de los cinco proveedores
// que hay que soportar. Si alguien "ordena" la tabla poniendolos en oauth2
// porque queda mas prolijo, el reparto de adaptadores se rompe y el fallo
// aparece recien al conectarlos, con una pestana del navegador que no lleva a
// ningun sitio.
//
// El `entorno` de cada entrada es con que nombre se inyecta cada valor al
// subproceso. Sin el, el valor no tiene nombre y acaba pasandose por argv, que
// es la unica forma de filtrarlo a todo el sistema (principio IX).

/** @type {readonly any[]} */
export const CATALOGO_POR_DEFECTO = Object.freeze([
  {
    slug: "linear",
    nombre: "Linear",
    modo: "oauth2",
    clase: "tracker",
    entorno: { access_token: "LINEAR_API_KEY" },
    api: { base: "https://api.linear.app", auth: { tipo: "bearer", campo: "access_token" } },
  },
  {
    slug: "jira",
    nombre: "Jira",
    modo: "oauth2",
    clase: "tracker",
    entorno: { access_token: "JIRA_TOKEN" },
    api: { base: "https://api.atlassian.com", auth: { tipo: "bearer", campo: "access_token" } },
  },
  {
    slug: "github",
    nombre: "GitHub",
    modo: "oauth2",
    clase: "scm",
    entorno: { access_token: "GITHUB_TOKEN" },
    api: { base: "https://api.github.com", auth: { tipo: "bearer", campo: "access_token" } },
  },
  {
    slug: "slack",
    nombre: "Slack",
    modo: "oauth2",
    clase: "integracion",
    entorno: { access_token: "SLACK_TOKEN" },
    api: { base: "https://slack.com/api", auth: { tipo: "bearer", campo: "access_token" } },
  },
  {
    slug: "notion",
    nombre: "Notion",
    modo: "oauth2",
    clase: "integracion",
    entorno: { access_token: "NOTION_TOKEN" },
    api: { base: "https://api.notion.com", auth: { tipo: "bearer", campo: "access_token" } },
  },
  {
    // VERIFICADO: no usa OAuth. Se conecta con un token personal por
    // autenticacion basica, con el usuario vacio y el token como contrasena.
    slug: "azure-devops",
    nombre: "Azure DevOps",
    modo: "basic",
    clase: "tracker",
    campos: [
      { nombre: "organizacion", etiqueta: "Organizacion", secreto: false, requerido: true },
      { nombre: "pat", etiqueta: "Personal Access Token", secreto: true, requerido: true },
    ],
    entorno: { organizacion: "AZURE_DEVOPS_ORG", pat: "AZURE_DEVOPS_PAT" },
    api: {
      base: "https://dev.azure.com/{organizacion}",
      auth: { tipo: "basic", usuario: "", campo: "pat" },
    },
  },
  {
    // VERIFICADO: no usa OAuth. Clave de API, en cabecera Bearer.
    slug: "vercel",
    nombre: "Vercel",
    modo: "api_key",
    clase: "infra",
    campos: [{ nombre: "api_key", etiqueta: "Clave de API", secreto: true, requerido: true }],
    entorno: { api_key: "VERCEL_TOKEN" },
    api: { base: "https://api.vercel.com", auth: { tipo: "bearer", campo: "api_key" } },
  },
]);

/**
 * Reparte el catalogo por modo. Es lo que hace que la eleccion de adaptador sea
 * una consecuencia del modo y no una opcion del operador: si es oauth2 va por
 * el adaptador que sabe refrescar tokens; si es un token pegado a mano, por el
 * que lo guarda en el deposito del sistema operativo. Levantar tres
 * contenedores para guardar un PAT es coste sin contrapartida.
 *
 * @param {readonly any[]} catalogo
 * @param {string[]} modos
 * @returns {any[]}
 */
export function catalogoPorModo(catalogo, modos) {
  return catalogo.filter((entrada) => modos.includes(entrada.modo)).map((entrada) => ({ ...entrada }));
}
