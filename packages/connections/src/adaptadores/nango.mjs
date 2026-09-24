// T154 · el adaptador alojado: OAuth de verdad contra una instancia propia del
// servidor de integraciones.
//
// -----------------------------------------------------------------------------
// LO QUE ESTE ARCHIVO ERA HASTA HOY, Y POR QUE YA NO
// -----------------------------------------------------------------------------
//
// Era un hueco declarado que fallaba al construirse. La decision de dejarlo
// asi fue pragmatica y tenia un coste concreto: el UNICO camino que funcionaba
// era pegar un token personal, que es justo lo que el operador eligio no hacer
// cuando eligio una capa de integracion con OAuth. El hueco esta lleno.
//
// -----------------------------------------------------------------------------
// EL HECHO QUE DECIDE LA FORMA DE TODO ESTO: NO HAY APLICACIONES COMPARTIDAS
// -----------------------------------------------------------------------------
//
// La pregunta era si un operador con el servidor autoalojado puede autorizar
// con GitHub SIN registrar su propia aplicacion OAuth. La respuesta, medida
// contra Nango 0.71.10 levantado con el compose de este paquete, es NO:
//
//   - `GET /api/v1/providers` → 1013 proveedores, `preConfigured: false` en los
//     1013.
//   - `select count(*) from providers_shared_credentials` → 0.
//   - `POST /api/v1/integrations {"provider":"github","useSharedCredentials":
//     true}` → 400 `failed_to_create_preprovisioned_provider`.
//
// La evidencia completa, con las cinco comprobaciones, vive en
// `aplicacion-oauth.mjs` y VIAJA EN LA RESPUESTA de `aplicaciones()`: la
// primera pregunta del operador fue «¿por que debo poner token?», y una
// pantalla que conteste sin decir como se supo obliga a repetir la
// investigacion.
//
// Asi que registrar la aplicacion es un paso del operador, y lo que este
// adaptador construye es que sea el UNICO: `aplicaciones()` dice cuales faltan
// y trae el recorrido con la redirect URI ya calculada; `registrarAplicacion()`
// la deja lista; a partir de ahi `conectar()` devuelve una URL, el operador
// autoriza en su navegador y el sondeo cierra el flujo.
//
// -----------------------------------------------------------------------------
// POR QUE LA PETICION LLEGA INYECTADA
// -----------------------------------------------------------------------------
//
// Igual que en `local` con el deposito de secretos: este paquete viaja al
// escritorio como recurso suelto y sus pruebas tienen que correr sin red y sin
// contenedores. `@nangohq/node` se usa para construir el cliente por defecto
// —es el que conoce la forma de la API y sus cabeceras— y `peticion` es lo que
// permite ejercitar el adaptador entero sin levantar nada.
//
// -----------------------------------------------------------------------------
// LA LICENCIA
// -----------------------------------------------------------------------------
//
// `@nangohq/node` es Elastic License 2.0: no esta aprobada por la OSI y no es
// compatible con GPL/AGPL. La decision esta tomada y declarada en `LICENSE`, en
// el `README` y en `docs/licencia-de-integraciones.md`. Lo que no puede pasar es
// que sea una sorpresa para quien redistribuya.

// El cliente oficial. Dos cosas que SI sabe y que no queremos duplicar:
// `prodHost`, que es la direccion de la nube ajena —y por tanto la que este
// adaptador tiene que rechazar—, y `getUserAgent()`, que se identifica con la
// version exacta del cliente en los registros del servidor.
import { getUserAgent, prodHost } from "@nangohq/node";

import { fallar } from "../errores.mjs";
import { crearProveedorDeConexiones } from "../proveedor.mjs";
import { CATALOGO_POR_DEFECTO, catalogoPorModo } from "../catalogo.mjs";
import { VIGENCIA_MAXIMA_MS } from "../vigencia.mjs";
import {
  SERVIDOR_POR_DEFECTO,
  SIN_APLICACIONES_COMPARTIDAS,
  recorridoDeRegistro,
  redirectUriDe,
} from "../aplicacion-oauth.mjs";

/**
 * Los modos que este adaptador sabe atender.
 *
 * POR QUE NO ES SOLO `oauth2`, QUE ES SU RAZON DE EXISTIR. El servicio monta UN
 * proveedor de conexiones. Si el alojado solo supiera oauth2, levantar los
 * contenedores dejaria al operador sin poder conectar Azure DevOps ni Vercel
 * —que no usan OAuth— y el remedio seria peor que la enfermedad. Nango crea
 * esas conexiones de verdad: `POST /api-auth/api-key/:key` y
 * `POST /auth/basic/:key`, las dos medidas contra la instancia.
 *
 * El CATALOGO por defecto sigue siendo solo oauth2: el reparto no cambia por
 * levantar contenedores, y guardar un token personal en el llavero del sistema
 * sigue siendo mas barato que guardarlo en un Postgres en Docker.
 */
export const MODOS_DEL_ADAPTADOR_NANGO = ["oauth2", "api_key", "basic"];

/** Lo que este adaptador ofrece si nadie le pasa otro catalogo. */
export const CATALOGO_POR_DEFECTO_DE_NANGO = Object.freeze(catalogoPorModo(CATALOGO_POR_DEFECTO, ["oauth2"]));

/**
 * Lo que hace falta para que esto funcione. Esta declarado porque el reparto
 * entre adaptadores es una consecuencia del coste, y el coste solo se puede
 * comparar si esta escrito: levantar tres contenedores para guardar un token
 * personal es coste sin contrapartida.
 */
export const REQUISITOS_DE_NANGO = Object.freeze([
  { nombre: "base de datos", tipo: "contenedor", detalle: "almacena conexiones y credenciales cifradas" },
  { nombre: "cache", tipo: "contenedor", detalle: "requerido por el servidor" },
  { nombre: "servidor de integraciones", tipo: "contenedor", detalle: "necesita SERVER_PORT=3003 explicito" },
  {
    nombre: "puerto del callback de OAuth",
    tipo: "puerto",
    puerto: 3003,
    detalle: "registrado como redirect URI en la aplicacion OAuth de cada proveedor: no se puede reasignar",
  },
  {
    nombre: "clave de cifrado en reposo",
    tipo: "secreto",
    detalle: "no rota: cambiarla rompe el descifrado, y sin ella las credenciales quedan en claro",
  },
  {
    nombre: "aplicacion OAuth propia por proveedor",
    tipo: "registro",
    detalle:
      "el servidor autoalojado NO trae aplicaciones compartidas: la tabla providers_shared_credentials se crea " +
      "vacia y solo la escribe la API interna de Nango. Es el unico paso que el producto no puede dar solo",
  },
]);

/**
 * El alta sincrona de cada modo que no es oauth2: que ruta y como se llama el
 * campo del valor. Son las rutas que respondieron contra la instancia; la del
 * modo de clave de API NO cuelga de `/auth/` sino de `/api-auth/`, y eso costo
 * un 404 que decia `Cannot POST /auth/api-key/github-pat`.
 *
 * @type {Readonly<Record<string, {ruta: (slug: string) => string, cuerpo: (valores: Record<string,string>, entrada: any) => any}>>}
 */
const ALTA_SINCRONA = Object.freeze({
  api_key: Object.freeze({
    ruta: (slug) => `/api-auth/api-key/${encodeURIComponent(slug)}`,
    cuerpo: (valores, entrada) => ({ apiKey: valores[campoSecretoDe(entrada)] }),
  }),
  basic: Object.freeze({
    ruta: (slug) => `/auth/basic/${encodeURIComponent(slug)}`,
    cuerpo: (valores, entrada) => ({
      username: entrada.api?.auth?.usuario ?? "",
      password: valores[campoSecretoDe(entrada)],
    }),
  }),
});

/** El campo declarado secreto de una entrada, que es el que lleva el valor. */
function campoSecretoDe(entrada) {
  const campo = (entrada.campos ?? []).find((c) => c.secreto);
  if (!campo) {
    fallar(
      "entrada_sin_campo_secreto",
      `'${entrada.slug}' se conecta por ${entrada.modo} y su entrada del catalogo no declara ningun campo secreto`,
      "declara el campo con `secreto: true` en su entrada del catalogo: sin el no hay valor que mandar al servidor de integraciones",
    );
  }
  return campo.nombre;
}

/**
 * @param {{
 *   servidor?: string,
 *   claveSecreta: string,
 *   entorno?: string,
 *   catalogo?: readonly any[],
 *   peticion?: (url: string, init: any) => Promise<any>,
 *   repositorio?: any,
 *   reloj?: () => number,
 *   dormir?: (ms: number) => Promise<any>,
 *   sondearPuerto?: (p: number) => Promise<{libre: boolean, causa?: string}>,
 *   nuevoId?: () => string,
 * }} opciones
 */
export function crearAdaptadorNango({
  servidor = SERVIDOR_POR_DEFECTO,
  claveSecreta,
  entorno = "dev",
  catalogo = CATALOGO_POR_DEFECTO_DE_NANGO,
  peticion = (url, init) => fetch(url, init),
  ...resto
} = /** @type {any} */ ({})) {
  // LA CLAVE SE EXIGE AL MONTAR, y no cuando alguien pulsa conectar. Sin ella
  // toda llamada vuelve con `invalid_env` —medido: 401 con ese codigo exacto—
  // y ese mensaje no menciona ninguna clave, ningun entorno y ningun archivo.
  // El operador leeria "entorno invalido" y se iria a revisar el compose.
  if (typeof claveSecreta !== "string" || claveSecreta.length === 0) {
    fallar(
      "clave_secreta_ausente",
      "el adaptador alojado se monto sin la clave secreta del entorno del servidor de integraciones, y sin ella cada llamada vuelve con un 401 `invalid_env` que no menciona ninguna clave",
      "pasa `claveSecreta` al construirlo. Sale del panel del servidor en `http://localhost:3003` (Environment Settings) " +
        "o de su base de datos: `select secret_key from _nango_environments where name = 'dev'`",
    );
  }

  const base = String(servidor).replace(/\/+$/, "");

  // EL SERVIDOR TIENE QUE SER PROPIO, Y ESTO NO ES CELO. `NANGO_SERVER_URL`
  // sale del entorno del operador, y toda la documentacion publica del
  // proveedor esta escrita para su nube. Apuntado ahi, este adaptador mandaria
  // la clave secreta del entorno, los tokens de todas las conexiones y el
  // inventario entero a un servidor de otra empresa — y funcionaria: no hay
  // ningun error que lo delate, porque desde el punto de vista del codigo no
  // pasa nada raro. La direccion no esta escrita a mano: sale de `prodHost`
  // del cliente oficial, que es quien la conoce y quien la va a actualizar.
  if (base === String(prodHost).replace(/\/+$/, "")) {
    fallar(
      "servidor_no_es_propio",
      `el adaptador alojado se apunto a ${prodHost}, que es la nube del proveedor de integraciones y no una instancia propia: ahi la clave secreta, los tokens de todas las conexiones y el inventario quedan en un servidor de otra empresa`,
      `apuntalo a tu instancia —por defecto \`${SERVIDOR_POR_DEFECTO}\`, que es la que levanta el compose de ` +
        "`packages/connections/nango/`— o, si de verdad quieres la nube, esa decision se toma fuera de este producto",
    );
  }

  const redirect = redirectUriDe(base);

  // LO QUE SE SABE DE LA SALUD, Y DE DONDE SALE. Solo lo escribe
  // `comprobarServidor()`, que es una sonda explicita que alguien pide al
  // arrancar. Un fallo de una llamada cualquiera NO se guarda aqui, y esa
  // decision se tomo contra un fallo medido: guardarlo dejaba al adaptador
  // marcado como caido para siempre, porque la guarda de la fachada corta
  // ANTES de intentar la llamada que habria descubierto que ya volvio. La
  // caida de una llamada se declara en esa llamada, con su causa y su accion
  // — igual que hace el adaptador `local` con el deposito del sistema.
  const estado = { caida: /** @type {string|null} */ (null) };

  /** Las cabeceras que autorizan contra el servidor. El valor NO sale de aqui. */
  const autorizado = (extra = {}) => ({
    Authorization: `Bearer ${claveSecreta}`,
    "Content-Type": "application/json",
    // Que los registros del servidor atribuyan la peticion a un cliente
    // conocido con su version, en vez de a un agente anonimo. Lo construye el
    // cliente oficial: la version sale de su propio manifiesto.
    "User-Agent": getUserAgent("noxloop"),
    ...extra,
  });

  /**
   * Una llamada al servidor de integraciones, con la caida traducida.
   *
   * POR QUE UN FALLO DE RED SE CONVIERTE EN `adaptador_caido` Y NO SE PROPAGA.
   * Lo que sale de `fetch` cuando no hay nadie escuchando es
   * `TypeError: fetch failed`, que no dice que servidor, que puerto ni que
   * hacer. El contrato exige causa y accion, y aqui mas que en ningun sitio: lo
   * que falla casi nunca esta en esta maquina.
   *
   * @param {string} ruta
   * @param {{metodo?: string, cuerpo?: any, busqueda?: Record<string,string>}} [opciones]
   */
  async function contraElServidor(ruta, opciones = {}) {
    const url = new URL(`${base}${ruta}`);
    for (const [clave, valor] of Object.entries(opciones.busqueda ?? {})) {
      if (valor !== undefined && valor !== null) url.searchParams.set(clave, String(valor));
    }
    let respuesta;
    try {
      respuesta = await peticion(url.toString(), {
        method: opciones.metodo ?? "GET",
        headers: autorizado(),
        body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
      });
      estado.caida = null;
    } catch (e) {
      // NO SE GUARDA LA CAIDA AQUI. Ver el comentario de `estado`: guardarla
      // dejaba al adaptador marcado como caido para siempre, porque la guarda
      // de la fachada corta antes de intentar la llamada que habria descubierto
      // que ya volvio. Lo midio el chequeo 7 de la suite de contrato.
      fallar(
        "adaptador_caido",
        `el servidor de integraciones en ${base} no responde: ${e?.message ?? e}`,
        `levantalo con \`docker compose up -d\` en \`packages/connections/nango/\` y comprueba que \`SERVER_PORT=3003\` ` +
          `esta en su \`.env\`: sin esa linea el servidor escucha en 8080 mientras el compose expone 3003. ` +
          "Las conexiones que ya existen siguen en el inventario; mientras tanto, los proveedores que se conectan " +
          "con un token personal siguen disponibles por el adaptador `local`",
      );
    }

    const texto = await respuesta.text();
    let cuerpo = null;
    try {
      cuerpo = texto ? JSON.parse(texto) : null;
    } catch {
      // Un cuerpo que no es JSON se conserva crudo: es lo unico util que hay
      // cuando el que contesta no es el servidor sino algo delante.
      cuerpo = texto;
    }
    return { estado: respuesta.status, cuerpo };
  }

  /** El mensaje de error del servidor, que es el unico dato util cuando falla. */
  const mensajeDe = (cuerpo) =>
    (cuerpo && typeof cuerpo === "object" && (cuerpo.error?.message || cuerpo.error?.code || cuerpo.message)) ||
    (typeof cuerpo === "string" ? cuerpo : "") ||
    "sin mensaje";

  /** ¿Esta registrada la aplicacion OAuth de este proveedor? */
  async function integracionRegistrada(slug) {
    const r = await contraElServidor(`/api/v1/integrations/${encodeURIComponent(slug)}`, { busqueda: { env: entorno } });
    if (r.estado === 200) return true;
    if (r.estado === 404) return false;
    fallar(
      "servidor_de_integraciones_rechazo",
      `el servidor de integraciones contesto ${r.estado} al preguntar por la aplicacion de '${slug}': ${mensajeDe(r.cuerpo)}`,
      "comprueba que la clave secreta del entorno es la de este servidor y que el entorno declarado existe",
    );
  }

  /** El error que se lee mas veces, con el recorrido dentro. */
  function exigirAplicacionRegistrada(entrada) {
    const recorrido = recorridoDeRegistro(entrada.slug, { servidor: base, catalogo });
    // EL 404 DEL SERVIDOR NO SE PROPAGA TAL CUAL. Dice que el servidor no
    // conoce esa integracion, y manda a mirar el servidor; lo que falta es una
    // aplicacion registrada en el proveedor, que es otro sitio y otra tarde.
    fallar(
      "aplicacion_oauth_sin_registrar",
      `'${entrada.nombre ?? entrada.slug}' se conecta por OAuth y todavia no hay una aplicacion registrada para el. ` +
        "El servidor autoalojado no trae aplicaciones compartidas: su tabla de credenciales compartidas se crea vacia " +
        "y solo la escribe la API interna de quien opera la nube.",
      recorrido
        ? `Registra la aplicacion en ${recorrido.url_de_registro} (${recorrido.pasos[0].detalle}), pega ` +
          `\`${recorrido.redirect_uri}\` en el campo «${recorrido.pasos[1].titulo.replace(/^Pega esto en «|»$/g, "")}», ` +
          "y trae de vuelta el Client ID y el Client Secret. Es el unico paso que este producto no puede dar solo."
        : `Registra una aplicacion OAuth con '${entrada.slug}' usando \`${redirect}\` como redirect URI, y registra ` +
          "aqui su Client ID y su Client Secret.",
    );
  }

  const motor = {
    requisitos: () => [...REQUISITOS_DE_NANGO],

    // La salud refleja la ULTIMA llamada, no un ping inventado. Un `arriba:
    // true` fijo seria peor que no tener sonda: la pantalla diria que todo esta
    // bien mientras cada conexion nueva falla.
    salud: () => (estado.caida ? { arriba: false, causa: estado.caida } : { arriba: true }),

    /**
     * Abre el flujo de autorizacion.
     *
     * EL `handle` ES EL IDENTIFICADOR DE USUARIO FINAL DE LA SESION, y esa
     * eleccion es lo que hace que el sondeo funcione. El servidor genera el
     * `connection_id` por su cuenta y no lo devuelve hasta que la autorizacion
     * termina; el unico dato que viaja de ida y se puede consultar de vuelta es
     * el `end_user.id`. Medido: `GET /connection?endUserId=<handle>` devuelve
     * exactamente la conexion que nacio de esa sesion, y ninguna otra.
     */
    async iniciar({ entrada, handle }) {
      if (!(await integracionRegistrada(entrada.slug))) exigirAplicacionRegistrada(entrada);

      const sesion = await contraElServidor("/connect/sessions", {
        metodo: "POST",
        cuerpo: {
          end_user: { id: handle, display_name: entrada.nombre ?? entrada.slug },
          allowed_integrations: [entrada.slug],
        },
      });
      if (sesion.estado >= 400) {
        fallar(
          "sesion_de_conexion_rechazada",
          `el servidor de integraciones rechazo abrir la sesion de '${entrada.slug}' con estado ${sesion.estado}: ${mensajeDe(sesion.cuerpo)}`,
          "comprueba que la aplicacion OAuth de este proveedor sigue registrada en el servidor: si la borraste, vuelve a registrarla desde la pantalla de conexiones",
        );
      }
      const token = sesion.cuerpo?.data?.token;
      if (!token) {
        fallar(
          "sesion_sin_token",
          `el servidor de integraciones acepto abrir la sesion de '${entrada.slug}' y no devolvio ningun token`,
          "comprueba la version del servidor: este adaptador espera la forma `{data:{token, expires_at}}` que devuelve la 0.71",
        );
      }

      // LA URL ES LA DEL FLUJO DIRECTO, NO LA DEL PANEL DE CONEXION. El
      // servidor tambien devuelve un `connect_link` a su propia interfaz en el
      // puerto 3009, que es una pantalla mas entre el boton y el proveedor.
      // Esta ruta redirige (302 medido) directo a la pagina de autorizacion del
      // proveedor, con `redirect_uri=http://localhost:3003/oauth/callback`
      // dentro. Una pantalla menos, y una que ademas no se puede traducir.
      return {
        handle,
        url: `${base}/oauth/connect/${encodeURIComponent(entrada.slug)}?connect_session_token=${encodeURIComponent(token)}`,
        expira: sesion.cuerpo?.data?.expires_at ?? null,
      };
    },

    /** El alta de los modos que no abren navegador: el servidor las crea en el acto. */
    async guardar({ entrada, valores, handle }) {
      const alta = ALTA_SINCRONA[entrada.modo];
      if (!alta) {
        fallar(
          "modo_no_atendido_por_el_alojado",
          `'${entrada.slug}' se conecta por ${entrada.modo}, y el adaptador alojado atiende ${MODOS_DEL_ADAPTADOR_NANGO.join(", ")}`,
          "conectalo por el adaptador `local`, que guarda el valor en el deposito de secretos del sistema sin levantar ningun contenedor",
        );
      }
      if (!(await integracionRegistrada(entrada.slug))) {
        // Sin OAuth no hay aplicacion que registrar, pero SI hace falta que la
        // integracion exista en el servidor. Se crea sola: no pide credenciales.
        const creada = await contraElServidor("/api/v1/integrations", {
          metodo: "POST",
          busqueda: { env: entorno },
          cuerpo: { provider: entrada.slug, integrationId: entrada.slug, useSharedCredentials: false },
        });
        if (creada.estado >= 400) {
          fallar(
            "integracion_no_creada",
            `el servidor de integraciones rechazo crear la integracion de '${entrada.slug}' con estado ${creada.estado}: ${mensajeDe(creada.cuerpo)}`,
            "comprueba que el slug existe en el catalogo del servidor: `GET /api/v1/providers` los lista",
          );
        }
      }

      const sesion = await contraElServidor("/connect/sessions", {
        metodo: "POST",
        cuerpo: { end_user: { id: handle }, allowed_integrations: [entrada.slug] },
      });
      const token = sesion.cuerpo?.data?.token;
      if (!token) {
        fallar(
          "sesion_sin_token",
          `el servidor de integraciones no devolvio token para el alta de '${entrada.slug}'`,
          "comprueba que el servidor responde en /connect/sessions y que la clave secreta es la de su entorno",
        );
      }

      // EL TOKEN DE SESION VA EN LA BUSQUEDA Y NO EN UNA CABECERA, y eso costo
      // un 401 que decia «missing a valid public key parameter» — un mensaje
      // sobre una clave publica que este flujo no usa. El middleware del
      // servidor lo lee de `req.query['connect_session_token']`.
      const creada = await contraElServidor(alta.ruta(entrada.slug), {
        metodo: "POST",
        busqueda: { connect_session_token: token },
        cuerpo: alta.cuerpo(valores, entrada),
      });
      if (creada.estado >= 400) {
        fallar(
          "credencial_rechazada",
          `el servidor de integraciones rechazo la credencial de '${entrada.slug}' con estado ${creada.estado}: ${mensajeDe(creada.cuerpo)}`,
          "el servidor comprueba la credencial contra el proveedor antes de guardarla: revisa que el valor sea correcto y que su permiso alcance",
        );
      }

      // En el deposito de la fila va la REFERENCIA con la que se le pide el
      // valor al servidor, nunca el valor. Hay una guarda en la fachada que lo
      // mide sobre esta misma fila.
      // Los campos NO secretos se quedan en la fila: son datos —la
      // organizacion de Azure DevOps, por ejemplo— que la direccion de la API
      // necesita para armarse y que el servidor de integraciones no devuelve
      // entre las credenciales. Guardarlos aqui es lo mismo que ya hace
      // `local`, y por el mismo motivo.
      const datos = {};
      for (const campo of entrada.campos ?? []) {
        if (!campo.secreto && valores[campo.nombre] !== undefined) datos[campo.nombre] = valores[campo.nombre];
      }

      return {
        deposito: { connection_id: creada.cuerpo?.connectionId, provider_config_key: entrada.slug, datos },
        etiqueta: creada.cuerpo?.connectionId ?? null,
      };
    },

    /**
     * ¿Ya autorizo? Sondeo, y no por gusto: los avisos no estan garantizados en
     * la edicion gratuita del servidor y ademas exigirian un servidor
     * escuchando en la maquina del operador — que es justo el puerto que ya
     * esta ocupado por el callback.
     */
    async sondear(handle) {
      const r = await contraElServidor("/connection", { busqueda: { endUserId: handle } });
      if (r.estado >= 400) {
        fallar(
          "sondeo_rechazado",
          `el servidor de integraciones contesto ${r.estado} al buscar la conexion del handle '${handle}': ${mensajeDe(r.cuerpo)}`,
          "comprueba que la clave secreta sigue siendo valida; la autorizacion en el navegador puede haber terminado bien y esto seguir fallando",
        );
      }
      const conexiones = r.cuerpo?.connections ?? [];
      if (conexiones.length === 0) return null;

      const primera = conexiones[0];
      return {
        deposito: { connection_id: primera.connection_id, provider_config_key: primera.provider_config_key },
        etiqueta: primera.end_user?.display_name ?? primera.connection_id ?? null,
        expira: null,
      };
    },

    /**
     * El valor, pedido justo antes de inyectarlo y nunca cacheado aqui.
     *
     * `force_refresh` A PROPOSITO: el servidor guarda el refresh token y sabe
     * renovar. Pedir el valor sin refrescar devolveria un access token caducado
     * con toda la cara de estar bien, y el fallo aparecería en el subproceso,
     * con un 401 del proveedor que no menciona ninguna conexion.
     */
    async leer(conexion, entradaDelCatalogo) {
      const { connection_id: id, provider_config_key: clave } = conexion.deposito ?? {};
      if (!id || !clave) {
        fallar(
          "conexion_sin_referencia",
          `la conexion ${conexion.id} no apunta a ninguna conexion del servidor de integraciones`,
          "vuelve a conectar el proveedor: la fila quedo sin la referencia con la que se le pide el valor al servidor",
        );
      }

      const r = await contraElServidor(`/connection/${encodeURIComponent(id)}`, {
        busqueda: { provider_config_key: clave, force_refresh: "true" },
      });
      if (r.estado >= 400) {
        fallar(
          "credencial_no_entregada",
          `el servidor de integraciones contesto ${r.estado} al pedir la credencial de la conexion ${conexion.id}: ${mensajeDe(r.cuerpo)}`,
          "vuelve a conectar el proveedor desde la pantalla de conexiones: si la autorizacion fue revocada del lado del proveedor, el servidor ya no puede renovar el valor",
        );
      }

      const credenciales = r.cuerpo?.credentials ?? {};

      // SE TRADUCE, Y NO SE DEVUELVE LO QUE VINO. El servidor de integraciones
      // nombra los campos a su manera —`apiKey` donde el catalogo dice
      // `api_key`, `password` donde dice `pat`— y ademas devuelve metadatos
      // que no son credenciales: `type`, `expires_at`, `refresh_token`.
      //
      // EL FALLO QUE ESTO CIERRA, medido por la suite de contrato: devolver el
      // objeto entero hacia que la fachada fallara con `valor_sin_variable`
      // —«'github' devolvio el campo 'expires_at' y el catalogo no declara con
      // que variable se inyecta»—, que es un error correcto sobre un campo que
      // nunca tuvo que salir de aqui. Y el `refresh_token` es peor: es el valor
      // que permite pedir mas tokens, y no tiene nada que hacer en el entorno
      // de un subproceso.
      const valores = { ...(conexion.deposito?.datos ?? {}) };
      const campoDeSalida =
        entradaDelCatalogo?.modo === "oauth2"
          ? (entradaDelCatalogo.api?.auth?.campo ?? "access_token")
          : entradaDelCatalogo
            ? campoSecretoDe(entradaDelCatalogo)
            : null;
      const claveEnElServidor = { oauth2: "access_token", api_key: "apiKey", basic: "password" }[
        entradaDelCatalogo?.modo
      ];
      if (campoDeSalida && claveEnElServidor) {
        const valor = credenciales[claveEnElServidor];
        if (typeof valor !== "string" || valor.length === 0) {
          fallar(
            "credencial_vacia",
            `el servidor de integraciones entrego la conexion ${conexion.id} sin ningun valor en '${claveEnElServidor}'`,
            "vuelve a conectar el proveedor: la autorizacion existe pero el valor no, lo que suele significar que el proveedor la revoco de su lado",
          );
        }
        valores[campoDeSalida] = valor;
      }

      // La vigencia que propone el proveedor se recorta en la fachada, que es
      // donde vive el tope. Aqui solo se traduce: `expires_at` es un instante,
      // `vigencia_ms` es cuanto puede sostenerse quien ya tiene el valor.
      const expira = credenciales.expires_at ?? null;
      const propuesta = expira ? Date.parse(expira) - Date.now() : undefined;
      return {
        valores,
        expira,
        vigenciaPropuestaMs:
          typeof propuesta === "number" && Number.isFinite(propuesta) && propuesta > 0
            ? Math.min(propuesta, VIGENCIA_MAXIMA_MS)
            : undefined,
      };
    },

    async olvidar(conexion) {
      const { connection_id: id, provider_config_key: clave } = conexion.deposito ?? {};
      if (!id || !clave) return;
      const r = await contraElServidor(`/connection/${encodeURIComponent(id)}`, {
        metodo: "DELETE",
        busqueda: { provider_config_key: clave },
      });
      if (r.estado >= 400 && r.estado !== 404) {
        fallar(
          "revocacion_rechazada",
          `el servidor de integraciones contesto ${r.estado} al borrar la conexion ${conexion.id}: ${mensajeDe(r.cuerpo)}`,
          "la conexion ya no entrega credenciales desde aqui; borrala tambien en el panel del servidor cuando vuelva a responder",
        );
      }
    },

    /**
     * La llamada a la API del proveedor.
     *
     * VA DIRECTA Y NO POR EL PROXY DEL SERVIDOR, y es una decision con su
     * motivo: por el proxy, cada respuesta pasa por un servicio mas que puede
     * estar caido, y el token igualmente se materializa del lado de la fachada
     * —es ella quien arma la cabecera de autorizacion, para todos los
     * adaptadores por igual—. Ir directo no expone nada que no estuviera ya
     * expuesto y quita un salto que puede fallar.
     */
    async llamar({ entrada, conexion, ruta, metodo, cuerpo, cabeceras }) {
      const directa = String(entrada.api?.base ?? "").replace(/\{(\w+)\}/g, (_, clave) => {
        const valor = conexion.deposito?.datos?.[clave];
        if (!valor) {
          fallar(
            "dato_ausente_en_la_url",
            `la direccion de '${entrada.slug}' necesita '${clave}' y la conexion ${conexion.id} no lo tiene`,
            `vuelve a conectar el proveedor rellenando '${clave}'`,
          );
        }
        return String(valor);
      });

      let respuesta;
      try {
        respuesta = await peticion(`${directa}${ruta}`, {
          method: metodo,
          headers: cabeceras,
          body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        });
      } catch (e) {
        fallar(
          "proveedor_inalcanzable",
          `no se pudo alcanzar la API de '${entrada.slug}' en ${directa}: ${e?.message ?? e}`,
          "comprueba la conexion a internet de esta maquina: esta llamada sale directa al proveedor, no pasa por el servidor de integraciones",
        );
      }

      const texto = await respuesta.text();
      let leido = texto;
      try {
        leido = texto ? JSON.parse(texto) : null;
      } catch {
        // Un cuerpo que no es JSON se devuelve tal cual: convertirlo en error
        // perderia el mensaje del proveedor, que suele ser el unico dato util.
      }
      return {
        estado: respuesta.status,
        cuerpo: leido,
        cabeceras: Object.fromEntries(respuesta.headers ?? []),
      };
    },
  };

  const proveedor = crearProveedorDeConexiones({ id: "nango", catalogo, motor, ...resto });

  /**
   * Que aplicaciones OAuth faltan por registrar, con el recorrido de cada una.
   *
   * POR QUE ESTA EN EL ADAPTADOR Y NO EN LA PANTALLA. La respuesta depende de
   * lo que el servidor tenga registrado AQUI Y AHORA, y eso solo lo sabe quien
   * le puede preguntar. Una pantalla que lo dedujera del catalogo enseñaria los
   * mismos cuatro pasos a quien ya los dio.
   */
  async function aplicaciones() {
    const oauth2 = (await proveedor.catalogo()).filter((e) => e.modo === "oauth2");
    const items = [];
    for (const entrada of oauth2) {
      const registrada = await integracionRegistrada(entrada.slug);
      items.push({
        slug: entrada.slug,
        nombre: entrada.nombre ?? entrada.slug,
        clase: entrada.clase,
        registrada,
        // El recorrido viaja SIEMPRE, tambien para las ya registradas: el
        // operador que tiene que cambiar el Client Secret necesita la misma
        // lista, y esconderla le obliga a buscarla fuera del producto.
        recorrido: recorridoDeRegistro(entrada.slug, { servidor: base, catalogo }),
      });
    }
    return {
      servidor: base,
      redirect_uri: redirect,
      items,
      // La pregunta que llego primera, contestada con su evidencia. Sin esto
      // la pantalla dice «registra una aplicacion» sin decir por que, y eso se
      // vuelve a discutir.
      aplicaciones_compartidas: SIN_APLICACIONES_COMPARTIDAS,
    };
  }

  /**
   * Registra la aplicacion OAuth de un proveedor en el servidor de
   * integraciones.
   *
   * EL SECRETO ATRAVIESA ESTE SERVICIO Y NO SE QUEDA. Va del formulario al
   * servidor de integraciones, que lo cifra con su clave en reposo. No se
   * guarda aqui, no entra en el inventario de credenciales y NO VUELVE EN LA
   * RESPUESTA — el servidor devuelve el `oauth_client_id` en claro y el secreto
   * cifrado en su propia respuesta, y eso es justo lo que no se reenvia.
   *
   * @param {{slug: string, client_id: string, client_secret: string, scopes?: string}} datos
   */
  async function registrarAplicacion({ slug, client_id: clientId, client_secret: clientSecret, scopes }) {
    const entrada = (await proveedor.catalogo()).find((e) => e.slug === slug);
    if (!entrada) {
      fallar(
        "proveedor_desconocido",
        `el adaptador 'nango' no conoce ningun proveedor con el slug '${slug}'`,
        `usa uno de los que declara su catalogo: ${(await proveedor.catalogo()).map((e) => e.slug).join(", ")}`,
      );
    }
    if (entrada.modo !== "oauth2") {
      fallar(
        "sin_aplicacion_que_registrar",
        `'${slug}' se conecta por ${entrada.modo}: no hay ninguna aplicacion OAuth que registrar`,
        "conectalo directamente: los modos sin autorizacion no tienen redirect URI ni Client ID",
      );
    }
    for (const [nombre, valor] of [["client_id", clientId], ["client_secret", clientSecret]]) {
      if (typeof valor !== "string" || valor.length === 0) {
        fallar(
          "aplicacion_incompleta",
          `falta '${nombre}' para registrar la aplicacion OAuth de '${slug}'`,
          "los dos valores salen de la pagina de la aplicacion en el proveedor: el Client ID se ve siempre, el Client Secret solo cuando se genera",
        );
      }
    }

    // SI YA ESTA REGISTRADA, SE REEMPLAZA. Crear otra con el mismo slug choca:
    // el servidor contesta 400 `integrationId is already used`, y el operador
    // con unas credenciales equivocadas —o de prueba— no tenia como poner las
    // buenas desde el producto. El reemplazo va por PATCH y con el cuerpo
    // PLANO (`authType`, `clientId`...), no dentro de `auth` como al crear:
    // medido en `patchIntegration.js` de la 0.71.10.
    const yaRegistrada = await integracionRegistrada(slug);
    const r = yaRegistrada
      ? await contraElServidor(`/api/v1/integrations/${encodeURIComponent(slug)}`, {
          metodo: "PATCH",
          busqueda: { env: entorno },
          cuerpo: { authType: "OAUTH2", clientId, clientSecret, ...(scopes ? { scopes } : {}) },
        })
      : await contraElServidor("/api/v1/integrations", {
          metodo: "POST",
          busqueda: { env: entorno },
          cuerpo: {
            provider: slug,
            integrationId: slug,
            displayName: entrada.nombre ?? slug,
            // `useSharedCredentials: false` es OBLIGATORIO en el cuerpo y no
            // opcional: sin el, el servidor contesta 400 diciendo
            // `expected boolean, received undefined`. Medido.
            useSharedCredentials: false,
            auth: {
              authType: "OAUTH2",
              clientId,
              clientSecret,
              ...(scopes ? { scopes } : {}),
            },
          },
        });

    if (r.estado >= 400) {
      // EL MENSAJE DEL SERVIDOR VIAJA, EL CUERPO NO. El cuerpo de un error de
      // validacion repite lo que se le mando, y lo que se le mando incluye el
      // secreto.
      fallar(
        "aplicacion_rechazada",
        `el servidor de integraciones rechazo registrar la aplicacion de '${slug}' con estado ${r.estado}: ${mensajeDe(r.cuerpo)}`,
        "comprueba que el Client ID y el Client Secret son los de la aplicacion recien creada y que el slug del proveedor es el correcto",
      );
    }

    // La respuesta del servidor trae `oauth_client_id` en claro y
    // `oauth_client_secret` cifrado. Ni uno ni otro se reenvian: lo unico que
    // quien llamo necesita saber es que quedo registrada.
    return { slug, nombre: entrada.nombre ?? slug, registrada: true, redirect_uri: redirect };
  }

  return Object.assign(proveedor, { aplicaciones, registrarAplicacion, servidor: base });
}
