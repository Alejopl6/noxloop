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
    // EL `repos` QUE FALTABA, Y ERA UN FINAL SIN SALIDA. Esta entrada no lo
    // declaraba porque hasta ahora nadie podia conectarse por ella: oauth2 lo
    // atiende el adaptador alojado, que era un hueco. Con el adaptador lleno,
    // el operador autorizaba en su navegador, la conexion quedaba viva, y al
    // llegar al selector de repositorios la fachada fallaba con
    // `sin_listado_de_repositorios` — despues de haber autorizado, que es el
    // momento en que menos se entiende.
    //
    // Es el MISMO bloque que `github-pat`, y eso no es duplicacion accidental:
    // la pregunta «¿que repositorios alcanza esta conexion?» se le hace igual a
    // la misma forja tenga detras un token personal o una autorizacion
    // delegada. Lo que cambia es quien guarda la credencial.
    repos: {
      ruta: "/user/repos?per_page={por_pagina}&page={pagina}&sort=updated&affiliation=owner,collaborator,organization_member",
      lista: null,
      campos: {
        id: "id",
        nombre: "name",
        nombre_completo: "full_name",
        descripcion: "description",
        privado: "private",
        rama_por_defecto: "default_branch",
        url_clon: "clone_url",
        url_ssh: "ssh_url",
        url_web: "html_url",
        actualizado: "updated_at",
      },
    },
  },
  {
    // VERIFICADO: la misma forja publica DOS formas de conectarse, y la
    // diferencia no es cosmetica. `github` de arriba es oauth2 y necesita una
    // aplicacion registrada por el operador; esta se conecta pegando un token
    // personal, que es lo que se puede hacer HOY sin registrar nada ni levantar
    // ningun contenedor.
    //
    // EL FALLO CONCRETO QUE ESTA ENTRADA CIERRA. El unico proveedor de codigo
    // del catalogo propio era oauth2, y oauth2 lo atiende el adaptador alojado,
    // que es un hueco declarado. Resultado medido: no habia NINGUN camino por
    // el que un operador conectara su cuenta de codigo y eligiera un
    // repositorio — el boton existia, el flujo no.
    //
    // POR QUE `api_key` Y NO `pat`. El modo sale del catalogo del origen, que
    // declara esta integracion como clave de API, y los dos van por el mismo
    // adaptador. Inventarle un modo distinto aqui seria la unica diferencia
    // entre lo que dice el origen y lo que esta capa hizo con el, y esa
    // diferencia tiene que ser legible.
    slug: "github-pat",
    nombre: "GitHub (token personal)",
    modo: "api_key",
    clase: "scm",
    campos: [
      {
        nombre: "token",
        etiqueta: "Token personal",
        secreto: true,
        requerido: true,
        ayuda:
          "Un token classic con el permiso `repo`, o uno fine-grained con lectura de contenido y metadatos. " +
          "Se guarda en el deposito de secretos del sistema y no vuelve a salir de ahi.",
        alcance: "leer los repositorios que la cuenta alcanza",
      },
    ],
    entorno: { token: "GITHUB_TOKEN" },
    api: { base: "https://api.github.com", auth: { tipo: "bearer", campo: "token" } },
    // Como se le pregunta a este proveedor por los repositorios que la conexion
    // alcanza. Es DECLARACION, no codigo: la ruta con sus huecos y de que campo
    // crudo sale cada campo del contrato. Quien agregue otra forja escribe esto
    // y no toca la fachada.
    repos: {
      ruta: "/user/repos?per_page={por_pagina}&page={pagina}&sort=updated&affiliation=owner,collaborator,organization_member",
      // La respuesta ES la lista. Una forja que la envuelva declara aqui el
      // nombre de la propiedad que la contiene.
      lista: null,
      campos: {
        id: "id",
        nombre: "name",
        nombre_completo: "full_name",
        descripcion: "description",
        privado: "private",
        rama_por_defecto: "default_branch",
        url_clon: "clone_url",
        url_ssh: "ssh_url",
        url_web: "html_url",
        actualizado: "updated_at",
      },
    },
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
      {
        nombre: "pat",
        etiqueta: "Personal Access Token",
        secreto: true,
        requerido: true,
        alcance: "leer y actualizar los work items de la organizacion",
      },
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
    campos: [
      {
        nombre: "api_key",
        etiqueta: "Clave de API",
        secreto: true,
        requerido: true,
        alcance: "consultar los despliegues y su estado",
      },
    ],
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
