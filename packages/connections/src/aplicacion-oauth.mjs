// El recorrido para registrar la aplicacion OAuth: el unico paso del flujo que
// el producto no puede dar por el operador, dicho como una lista de pasos con
// los valores dentro y no como un parrafo.
//
// -----------------------------------------------------------------------------
// POR QUE ESTE ARCHIVO EXISTE: NO HAY APLICACIONES COMPARTIDAS EN AUTOALOJADO
// -----------------------------------------------------------------------------
//
// Nango anuncia aplicaciones OAuth compartidas «para probar con cero
// configuracion». Eso es cierto EN SU NUBE. En una instancia propia no existen,
// y esta comprobado de cuatro formas independientes contra Nango 0.71.10
// levantado con el compose de `packages/connections/nango/`:
//
//   1. `GET /api/v1/providers` devuelve 1013 proveedores y `preConfigured:
//      false` en los 1013. El campo lo calcula `getProvidersList` buscando el
//      nombre del proveedor en la tabla `providers_shared_credentials`.
//   2. `select count(*) from providers_shared_credentials` devuelve 0. La
//      migracion `20250728111830_create_providers_shared_credentials_table.cjs`
//      crea la tabla VACIA y no hay ninguna siembra en el repositorio publico.
//   3. `POST /api/v1/integrations {"provider":"github","useSharedCredentials":
//      true}` devuelve 400 `failed_to_create_preprovisioned_provider`, que es
//      como `createPreprovisionedProvider` envuelve su
//      `shared_credentials_not_found`.
//   4. Las filas de esa tabla SOLO se escriben por la API interna de Nango
//      —`internalApi.route('/shared-credentials').post(...)`, detras de su
//      middleware `internal`—, que es la que opera Nango, no quien se autoaloja.
//
// Y hay un quinto motivo que no depende de ninguna tabla: la propia
// documentacion de Nango dice que sus aplicaciones compartidas «use Nango's
// callback». Ese callback es `https://api.nango.dev/oauth/callback`. Una
// instancia en `localhost:3003` no puede recibir nada ahi.
//
// Asi que el paso queda, y lo que se construye es que sea corto.
//
// -----------------------------------------------------------------------------
// EL FALLO CONCRETO QUE CADA RECORRIDO EVITA
// -----------------------------------------------------------------------------
//
// La guia oficial de Nango para registrar una aplicacion de GitHub dice, con
// estas palabras: «Enter `https://api.nango.dev/oauth/callback`». Un operador
// que la sigue con su instancia propia registra la redirect URI de una nube que
// no es la suya. El fallo NO aparece al registrar: aparece al autorizar, con un
// error del proveedor que habla de un `redirect_uri` que no coincide y que no
// menciona ninguna instancia, ningun puerto y ninguna pantalla de este producto.
//
// Por eso la redirect URI viaja como DATO en el paso (`pegar`) y se calcula
// desde el servidor que de verdad esta escuchando, en vez de estar escrita
// dentro de una frase que hay que leer y transcribir.

import { PUERTO_DE_CALLBACK } from "./preflight.mjs";
import { CATALOGO_POR_DEFECTO } from "./catalogo.mjs";

/** El servidor de integraciones por defecto: el del compose de este paquete. */
export const SERVIDOR_POR_DEFECTO = `http://localhost:${PUERTO_DE_CALLBACK}`;

/**
 * La redirect URI de un servidor dado. La ruta `/oauth/callback` no es una
 * eleccion de este paquete: es la que el propio servidor de integraciones
 * imprime al arrancar («OAuth callback URL: http://localhost:3003/oauth/
 * callback») y la que sirve.
 *
 * @param {string} servidor
 * @returns {string}
 */
export function redirectUriDe(servidor) {
  return `${String(servidor).replace(/\/+$/, "")}/oauth/callback`;
}

/** La redirect URI que hay que registrar cuando nadie cambio el servidor. */
export const REDIRECT_URI_POR_DEFECTO = redirectUriDe(SERVIDOR_POR_DEFECTO);

/**
 * La constancia de que las aplicaciones compartidas no estan, CON su evidencia.
 *
 * POR QUE VIAJA EN LA RESPUESTA Y NO SOLO EN UN COMENTARIO. La primera pregunta
 * del operador fue «¿por que debo poner token? ¿no sirven las integraciones con
 * OAuth?», y es la pregunta correcta. Una pantalla que conteste «hay que
 * registrar una aplicacion» sin decir COMO SE SUPO se discute otra vez dentro
 * de seis meses, y la segunda vez ya nadie se acuerda de contra que version se
 * midio.
 */
export const SIN_APLICACIONES_COMPARTIDAS = Object.freeze({
  hay: false,
  version: "0.71.10",
  medido_el: "2026-09-21",
  porque:
    "las aplicaciones OAuth compartidas de Nango viven en su nube. En una instancia propia la tabla que las " +
    "guarda se crea vacia, solo la escribe la API interna de Nango, y el callback de esas aplicaciones apunta a " +
    "api.nango.dev, que una instancia en localhost no puede recibir.",
  evidencia: Object.freeze([
    Object.freeze({
      comprobacion: "GET /api/v1/providers sobre la instancia propia",
      resultado: "1013 proveedores, y `preConfigured: false` en los 1013",
    }),
    Object.freeze({
      comprobacion: "select count(*) from providers_shared_credentials",
      resultado: "0 filas: la migracion crea la tabla vacia y nada en el repositorio publico la siembra",
    }),
    Object.freeze({
      comprobacion: 'POST /api/v1/integrations {"provider":"github","useSharedCredentials":true}',
      resultado: "400 failed_to_create_preprovisioned_provider, que envuelve shared_credentials_not_found",
    }),
    Object.freeze({
      comprobacion: "quien puede escribir esa tabla, leido en routes.internal.ts de Nango",
      resultado: "solo la API interna, detras del middleware `internal`: la opera Nango, no quien se autoaloja",
    }),
    Object.freeze({
      comprobacion: "la documentacion de Nango sobre sus aplicaciones compartidas",
      resultado: "«Nango developer apps use Nango's callback» — el de api.nango.dev, inalcanzable desde localhost",
    }),
  ]),
});

/**
 * Donde se registra la aplicacion de cada proveedor, y como se llama ahi el
 * campo de la redirect URI.
 *
 * EL NOMBRE DEL CAMPO ES DATO Y NO ADORNO. Cada proveedor lo llama distinto
 * —GitHub «Authorization callback URL», Slack «Redirect URL»— y un paso que
 * diga «pega esto en el campo del callback» obliga a buscar cual es. Con el
 * nombre dentro, el operador lo encuentra a la primera.
 *
 * @type {Readonly<Record<string, {url: string, donde: string, campo: string, secreto: string, nota?: string}>>}
 */
const REGISTRO_POR_PROVEEDOR = Object.freeze({
  github: Object.freeze({
    url: "https://github.com/settings/applications/new",
    donde: "Settings → Developer settings → OAuth Apps → New OAuth App",
    campo: "Authorization callback URL",
    secreto: "Generate a new client secret",
    nota:
      "El Client ID se ve arriba en la pagina de la aplicacion en cuanto la creas. El Client Secret solo se " +
      "enseña UNA vez, justo despues de generarlo: si cierras la pestaña sin copiarlo hay que generar otro.",
  }),
  linear: Object.freeze({
    url: "https://linear.app/settings/api/applications/new",
    donde: "Settings → API → Applications → Create new application",
    campo: "Callback URLs",
    secreto: "Client secret",
  }),
  jira: Object.freeze({
    url: "https://developer.atlassian.com/console/myapps/",
    donde: "Developer console → Create → OAuth 2.0 integration → Authorization → Configure",
    campo: "Callback URL",
    secreto: "Settings → Authentication details → Secret",
  }),
  slack: Object.freeze({
    url: "https://api.slack.com/apps/new",
    donde: "Your Apps → Create New App → From scratch → OAuth & Permissions",
    campo: "Redirect URLs",
    secreto: "Basic Information → App Credentials → Client Secret",
  }),
  notion: Object.freeze({
    url: "https://www.notion.so/my-integrations",
    donde: "My integrations → New integration → tipo Public",
    campo: "Redirect URIs",
    secreto: "Secrets → OAuth client secret",
  }),
});

/**
 * El recorrido para registrar la aplicacion OAuth de un proveedor, con la
 * redirect URI de ESTA instancia ya calculada dentro.
 *
 * Devuelve `null` cuando el proveedor no se conecta por oauth2: no es un hueco,
 * es que no hay aplicacion que registrar. `github-pat` se conecta pegando un
 * token personal y no tiene redirect URI ninguna; devolverle un recorrido vacio
 * invitaria a la pantalla a dibujar pasos que no llevan a ningun sitio.
 *
 * @param {string} slug
 * @param {{servidor?: string, catalogo?: readonly any[]}} [opciones]
 * @returns {null | {
 *   slug: string,
 *   nombre: string,
 *   url_de_registro: string,
 *   redirect_uri: string,
 *   campos_que_devuelve: string[],
 *   pasos: Array<{titulo: string, detalle: string, pegar?: string, abrir?: string}>,
 * }}
 */
export function recorridoDeRegistro(slug, opciones = {}) {
  const catalogo = opciones.catalogo ?? CATALOGO_POR_DEFECTO;
  const entrada = catalogo.find((e) => e.slug === slug);
  if (!entrada || entrada.modo !== "oauth2") return null;

  const registro = REGISTRO_POR_PROVEEDOR[slug];
  if (!registro) return null;

  const servidor = opciones.servidor ?? SERVIDOR_POR_DEFECTO;
  const redirect = redirectUriDe(servidor);

  return {
    slug,
    nombre: entrada.nombre ?? slug,
    url_de_registro: registro.url,
    redirect_uri: redirect,
    // Lo que el operador trae de vuelta, y nada mas. Declararlo aqui es lo que
    // permite que la pantalla dibuje exactamente dos casillas en vez de un
    // formulario generico donde caben campos que nadie va a leer.
    campos_que_devuelve: ["client_id", "client_secret"],
    pasos: [
      {
        titulo: `Abre el registro de aplicaciones de ${entrada.nombre ?? slug}`,
        detalle: `${registro.donde}. Se abre en el navegador del sistema, no aqui dentro.`,
        abrir: registro.url,
      },
      {
        titulo: `Pega esto en «${registro.campo}»`,
        detalle:
          `Es la direccion de TU instancia, no la de ninguna nube. La guia del proveedor de integraciones ` +
          `dice que pegues la suya; con una instancia propia esa es justo la que no funciona, y el fallo no ` +
          `aparece al registrar sino al autorizar, con un error sobre un redirect_uri que no coincide.`,
        pegar: redirect,
      },
      {
        titulo: "Copia el Client ID y genera el Client Secret",
        detalle:
          registro.nota ??
          `El Client ID esta en la pagina de la aplicacion. El Client Secret sale de «${registro.secreto}».`,
      },
      {
        titulo: "Pega los dos valores aqui abajo",
        detalle:
          "Van directos al servidor de integraciones, cifrados con su clave en reposo. No se guardan en este " +
          "servicio, no aparecen en ninguna respuesta y no vuelven a salir por esta pantalla.",
      },
    ],
  };
}

/**
 * Todos los recorridos que este catalogo necesita, indexados por slug. Es lo
 * que una pantalla pide de una vez para saber que le falta al operador.
 *
 * @param {{servidor?: string, catalogo?: readonly any[]}} [opciones]
 * @returns {Record<string, any>}
 */
export function recorridosDeRegistro(opciones = {}) {
  const catalogo = opciones.catalogo ?? CATALOGO_POR_DEFECTO;
  /** @type {Record<string, any>} */
  const todos = {};
  for (const entrada of catalogo) {
    const recorrido = recorridoDeRegistro(entrada.slug, opciones);
    if (recorrido) todos[entrada.slug] = recorrido;
  }
  return todos;
}
