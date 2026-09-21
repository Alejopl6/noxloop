// El catalogo consultable: lo que convierte 1012 proveedores en algo que una
// pantalla puede enseñar.
//
// LAS DOS PREGUNTAS QUE ESTE ARCHIVO CONTESTA, Y POR QUE NO CONTESTARLAS CUESTA.
//
//   1. «¿QUE ADAPTADOR LO VA A ATENDER?» — y no es un detalle de implementacion:
//      cambia lo que el operador tiene que hacer. `nango` significa levantar
//      tres contenedores y registrar a mano una aplicacion OAuth propia con el
//      proveedor. `local` significa pegar un token en una casilla. Son dos
//      tardes distintas, y hoy eso es invisible hasta que se pulsa conectar.
//      Peor: `azure-devops` y `vercel` PARECEN OAuth como los demas y no lo son.
//
//   2. «¿QUE ENSEÑO PRIMERO?» — una lista de mil elementos no es una interfaz,
//      es el problema trasladado al operador. Este producto necesita tres
//      conexiones para el ciclo 00-07: el tracker, el SCM y la infraestructura.
//      Eso va delante. El resto existe, se alcanza buscando, y no ocupa la
//      pantalla.
//
// EL MAPEO ES TOTAL Y NO TIENE DEFAULT, Y ESA ES LA REGLA QUE MAS PESA AQUI.
// Nango publica 17 modos de autenticacion distintos; este contrato tiene cinco.
// Un `?? "oauth2"` para lo que sobra convertiria 228 proveedores en 228
// pestañas de navegador que no llevan a ningun sitio — que es exactamente el
// fallo que este paquete entero documenta, multiplicado. Lo que no se sabe
// atender se declara apagado Y CON MOTIVO; el operador lee por que, en vez de
// ver una fila gris.
//
// POR QUE SE CONSERVA EL MODO CRUDO DE NANGO EN CADA ENTRADA. Porque el dia que
// alguien agregue el soporte de `TWO_STEP` va a necesitar saber cuantos son y
// cuales; y porque cuando Nango le cambie el modo a un proveedor, la diferencia
// entre lo que dice el origen y lo que esta capa hizo con el tiene que ser
// legible sin abrir el generador.

import { CATALOGO_POR_DEFECTO } from "./catalogo.mjs";
import { PROVEEDORES_DE_NANGO } from "./catalogo-nango.mjs";
import { congelar } from "./modelo.mjs";

/** @param {object} obj @param {string} clave */
const tiene = (obj, clave) => Object.prototype.hasOwnProperty.call(obj, clave);

/**
 * De cada modo de Nango al modo de ESTE contrato, o `null` si ningun adaptador
 * lo atiende. Es TOTAL sobre lo que publica el origen: hay una prueba que
 * recorre las 1012 filas y exige que cada valor que aparece tenga aqui una
 * entrada propia. La clave `""` es la fila que el origen publica SIN modo.
 *
 * @type {Readonly<Record<string, string|null>>}
 */
export const MODO_POR_MODO_DE_NANGO = Object.freeze({
  OAUTH2: "oauth2",
  API_KEY: "api_key",
  BASIC: "basic",
  APP: "app",

  // --- Lo que NO se atiende, y el motivo de cada uno -----------------------
  "": null,
  OAUTH1: null,
  OAUTH2_CC: null,
  MCP_OAUTH2: null,
  MCP_OAUTH2_GENERIC: null,
  TWO_STEP: null,
  JWT: null,
  NONE: null,
  BILL: null,
  TBA: null,
  SIGNATURE: null,
  INSTALL_PLUGIN: null,
  CUSTOM: null,
  AWS_SIGV4: null,
});

/**
 * Por que cada modo no atendido no lo esta. Va en la respuesta, no en un
 * comentario: una fila apagada sin explicacion se lee como un producto roto, y
 * el operador termina probando a ver si funciona.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const MOTIVO_DEL_MODO_NO_ATENDIDO = Object.freeze({
  "": "el catalogo de Nango publica este proveedor sin declarar su modo de autenticacion, y suponerle uno es abrir un flujo a ciegas",
  OAUTH1:
    "usa OAuth 1.0a, que firma cada peticion en vez de llevar un token: no es el flujo de oauth2 y el contrato de esta capa no lo declara",
  OAUTH2_CC:
    "usa client credentials: no hay nada que autorizar en un navegador, sino un identificador y un secreto de aplicacion que esta capa todavia no sabe pedir",
  MCP_OAUTH2:
    "es un servidor MCP y no una API: lo que se establece es una sesion MCP, no una credencial que se inyecte a un subproceso",
  MCP_OAUTH2_GENERIC:
    "es un servidor MCP y no una API: lo que se establece es una sesion MCP, no una credencial que se inyecte a un subproceso",
  TWO_STEP:
    "pide dos pasos encadenados —unas credenciales que se canjean por un token de vida corta— y ese canje no esta implementado en ningun adaptador",
  JWT: "exige firmar un JWT con una clave privada del operador, y esta capa no guarda ni usa claves privadas todavia",
  NONE: "la API no pide autenticacion: no hay ninguna credencial que conectar ni que guardar",
  BILL: "usa un esquema de sesion propio del proveedor, que ningun adaptador implementa",
  TBA: "usa token-based authentication de NetSuite, que firma cada peticion con secretos de cuenta y de consumidor",
  SIGNATURE: "firma cada peticion con un secreto compartido, en vez de llevar una credencial en la cabecera",
  INSTALL_PLUGIN: "se conecta instalando un plugin en el producto del proveedor, no registrando una credencial",
  CUSTOM: "Nango lo marca como flujo a medida: lo que pide depende del proveedor y no se puede derivar del catalogo",
  AWS_SIGV4: "firma cada peticion con SigV4, que necesita clave, secreto y region y un calculo por peticion",
});

/**
 * Que adaptador atiende cada modo. NO es una opcion del operador: es una
 * consecuencia del modo, y por eso vive en una tabla y no en un `if`.
 *
 * `oauth2` es lo unico que gana algo yendo por la capa alojada —refresco de
 * tokens y cifrado en reposo—. Para un PAT o una clave de API, levantar tres
 * contenedores es coste sin contrapartida.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const ADAPTADOR_POR_MODO = Object.freeze({
  oauth2: "nango",
  api_key: "local",
  basic: "local",
  pat: "local",
  app: "local",
});

/**
 * @param {string|null} modo
 * @returns {string|null}
 */
export function adaptadorDe(modo) {
  if (typeof modo !== "string") return null;
  return tiene(ADAPTADOR_POR_MODO, modo) ? ADAPTADOR_POR_MODO[modo] : null;
}

/**
 * SCM NO ES UNA CATEGORIA DE NANGO, y por eso esta lista existe.
 *
 * Nango mete GitHub, GitLab, Bitbucket y Gerrit en `dev-tools`, junto con
 * Datadog, Vercel y Cursor. No hay forma de derivar «esto es una forja» de esa
 * categoria. Asi que la lista es NUESTRA y se declara como tal, en vez de
 * fingir que sale del origen.
 *
 * Lo que la sostiene es una prueba: cada slug de aqui tiene que existir en el
 * catalogo empotrado. Un slug que Nango renombro es una regla que ya no se
 * aplica a nadie y que nadie notaria.
 *
 * @type {readonly string[]}
 */
export const SCM_DECLARADO = Object.freeze([
  "bitbucket",
  "gerrit",
  "github",
  "github-app",
  "github-app-oauth",
  "github-pat",
  "gitlab",
  "gitlab-group-token",
  "gitlab-pat",
]);

/**
 * De las categorias de Nango a las cuatro clases del contrato, EN ORDEN: gana
 * la primera que encaja.
 *
 * El orden importa y no es arbitrario. `github` viene con `dev-tools` y
 * `ticketing` a la vez; `jira-basic` con `productivity` y `ticketing`. Un
 * gestor de tickets es un tracker aunque ademas sea una herramienta de
 * desarrollo, asi que `ticketing` va primero.
 *
 * @type {readonly (readonly string[])[]}
 */
export const CLASE_POR_CATEGORIA = Object.freeze([
  Object.freeze(["ticketing", "tracker"]),
  Object.freeze(["dev-tools", "infra"]),
]);

/** Donde cae lo que ninguna categoria reclama. */
export const CLASE_POR_DEFECTO = "integracion";

/**
 * Las clases que el ciclo 00-07 necesita de verdad: sin tracker no hay ticket
 * de entrada, sin SCM no hay pull request de salida, y sin infraestructura no
 * hay donde mirar si lo que salio funciona.
 */
export const CLASES_DEL_CICLO = Object.freeze(["tracker", "scm", "infra"]);

/**
 * Las baldas en las que se reparte el catalogo. El numero ES el orden.
 *
 * POR QUE HAY BALDAS Y NO UN ORDEN ALFABETICO A SECAS. Con mil elementos, el
 * orden alfabetico pone `1Password` delante de `GitHub` y entierra las tres
 * conexiones que el producto necesita en algun sitio de la mitad de la lista.
 */
export const ESTANTES = Object.freeze({
  /** Hay entrada propia: se puede conectar hoy, con su formulario ya declarado. */
  CURADO: 0,
  /** Lo que el ciclo necesita —tracker, SCM, infraestructura— y algun adaptador atiende. */
  DEL_CICLO: 1,
  /** El resto de lo conectable. Existe, se busca, no ocupa la pantalla. */
  RESTO: 2,
  /** Lo que ningun adaptador atiende todavia. Se enseña apagado y con motivo. */
  NO_ATENDIDO: 3,
});

/** Los dos prefijos bajo los que Nango publica documentacion. Elegir el que no es da un 404. */
const PREFIJO_DE_DOCS = Object.freeze({
  api: "https://nango.dev/docs/api-integrations/",
  all: "https://nango.dev/docs/integrations/all/",
});

/**
 * La URL de la documentacion del proveedor, o `null` si no la tiene.
 *
 * @param {{slug: string, docs?: string|null}} entrada
 * @returns {string|null}
 */
export function urlDeDocs(entrada) {
  if (!entrada || typeof entrada.slug !== "string") return null;
  const marca = entrada.docs;
  if (typeof marca !== "string" || !tiene(PREFIJO_DE_DOCS, marca)) return null;
  return `${PREFIJO_DE_DOCS[marca]}${entrada.slug}.md`;
}

/**
 * Texto comparable: sin mayusculas y sin acentos.
 *
 * Sin quitar los acentos, buscar "atlassian" encuentra y buscar "Séverin" no
 * — y el operador no sabe que el que falla es su teclado.
 *
 * @param {string} texto
 */
function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * @param {readonly string[]} categorias
 * @param {string} slug
 * @returns {string}
 */
function claseDe(categorias, slug) {
  if (SCM_DECLARADO.includes(slug)) return "scm";
  for (const [categoria, clase] of CLASE_POR_CATEGORIA) {
    if (categorias.includes(categoria)) return clase;
  }
  return CLASE_POR_DEFECTO;
}

/** @param {{curado: boolean, soportado: boolean, clase: string}} e */
function estanteDe(e) {
  if (e.curado) return ESTANTES.CURADO;
  if (!e.soportado) return ESTANTES.NO_ATENDIDO;
  return CLASES_DEL_CICLO.includes(e.clase) ? ESTANTES.DEL_CICLO : ESTANTES.RESTO;
}

/**
 * @typedef {object} EntradaConsultable
 * @property {string} slug
 * @property {string} nombre
 * @property {string|null} modo        el modo de ESTE contrato, o null si no se atiende
 * @property {string|null} nango       el modo crudo que declara el catalogo de Nango
 * @property {string} clase
 * @property {readonly string[]} categorias  las de Nango, sin traducir
 * @property {string|null} adaptador   `nango`, `local`, o null
 * @property {boolean} soportado
 * @property {string|null} motivo      por que no se atiende, cuando no se atiende
 * @property {boolean} curado          hay entrada propia: se puede conectar hoy
 * @property {boolean} en_nango
 * @property {any[]|null} campos       lo que hay que pedirle al operador, si lo hay
 * @property {string|null} docs
 * @property {string|null} url_docs
 * @property {number} estante
 */

/**
 * Junta el catalogo de Nango con el propio y deja una entrada por proveedor.
 *
 * LO PROPIO MANDA, Y ES LA REGLA IMPORTANTE. Las siete entradas de
 * `CATALOGO_POR_DEFECTO` estan verificadas contra la documentacion oficial y
 * traen lo unico que el catalogo de Nango NO tiene: que campos pedirle al
 * operador, con que variable se inyecta cada valor, y contra que direccion se
 * llama. Si lo derivado sobreescribiera lo propio, `azure-devops` pasaria a ser
 * lo que diga el origen el dia que el origen cambie — y ese es justo el dato
 * que costo verificar.
 *
 * @param {{nango?: readonly any[], curados?: readonly any[]}} [piezas]
 * @returns {readonly EntradaConsultable[]}
 */
export function construirCatalogoConsultable(piezas = {}) {
  const deNango = piezas.nango ?? PROVEEDORES_DE_NANGO;
  const curados = piezas.curados ?? CATALOGO_POR_DEFECTO;

  /** @type {Map<string, any>} */
  const porSlug = new Map();

  for (const p of deNango) {
    const clave = p.nango ?? "";
    const modo = tiene(MODO_POR_MODO_DE_NANGO, clave) ? MODO_POR_MODO_DE_NANGO[clave] : null;
    const categorias = [...(p.categorias ?? [])];
    porSlug.set(p.slug, {
      slug: p.slug,
      nombre: p.nombre,
      modo,
      nango: p.nango ?? null,
      clase: claseDe(categorias, p.slug),
      categorias,
      curado: false,
      en_nango: true,
      campos: null,
      docs: p.docs ?? null,
      // Un modo que el mapeo no conoce no se queda sin explicacion: se dice que
      // el origen trae un valor que esta capa no sabe leer, que es distinto de
      // un modo conocido y no atendido.
      motivo: modo
        ? null
        : (tiene(MOTIVO_DEL_MODO_NO_ATENDIDO, clave) && MOTIVO_DEL_MODO_NO_ATENDIDO[clave]) ||
          `el catalogo de Nango lo declara como '${clave}', un modo que esta capa todavia no sabe leer`,
    });
  }

  for (const c of curados) {
    const previa = porSlug.get(c.slug);
    porSlug.set(c.slug, {
      slug: c.slug,
      nombre: c.nombre,
      modo: c.modo,
      nango: previa?.nango ?? null,
      clase: c.clase,
      categorias: previa ? [...previa.categorias] : [],
      curado: true,
      en_nango: Boolean(previa),
      // Los campos viajan porque son lo que la pantalla dibuja. Son
      // DECLARACIONES —nombre, etiqueta, si es secreto— y ninguna trae valores:
      // la estructura no tiene donde ponerlos.
      campos: Array.isArray(c.campos) ? c.campos.map((campo) => ({ ...campo })) : null,
      docs: previa?.docs ?? null,
      motivo: null,
    });
  }

  const entradas = [...porSlug.values()].map((e) => {
    const adaptador = adaptadorDe(e.modo);
    const completa = { ...e, adaptador, soportado: adaptador !== null, url_docs: urlDeDocs(e) };
    if (completa.soportado) completa.motivo = null;
    return { ...completa, estante: estanteDe(completa) };
  });

  // DENTRO DE UNA BALDA, LO CONOCIDO PRIMERO.
  //
  // El orden era `estante` y despues alfabetico, y eso dejaba la primera
  // pantalla abriendo con `accelo` y `amazon`. Las baldas resuelven "que clase
  // de cosa va antes"; no resuelven que dentro de la clase correcta lo primero
  // que se ve sea reconocible.
  //
  // El desempate sale de la categoria `popular` que el PROPIO catalogo de
  // Nango publica (36 de 1012). Es curacion de quien ve como se usan mil
  // integraciones a diario, y reusarla es mejor que inventarse una lista de
  // favoritos aqui: la nuestra envejeceria con nuestros sesgos y sin datos
  // detras.
  //
  // No cambia QUE se enseña —eso lo deciden las baldas— solo el orden dentro
  // de cada una. Y el alfabetico sigue siendo el ultimo desempate, para que el
  // resultado sea estable entre consultas.
  const conocido = (e) => ((e.categorias ?? []).includes("popular") ? 0 : 1);
  entradas.sort(
    (a, b) =>
      a.estante - b.estante ||
      conocido(a) - conocido(b) ||
      a.nombre.localeCompare(b.nombre, "es"),
  );
  return congelar(entradas);
}

/**
 * @typedef {object} Consulta
 * @property {string} [texto]
 * @property {string|null} [clase]
 * @property {string|null} [modo]
 * @property {string|null} [adaptador]
 * @property {boolean|null} [soportado]
 * @property {number} [limite]
 * @property {boolean} [todos]  salta la regla de la vista por defecto a proposito
 */

/** Cuanto se devuelve cuando nadie pide otra cosa. Una pantalla, no un catalogo. */
export const LIMITE_POR_DEFECTO = 60;

/**
 * Consulta el catalogo.
 *
 * LA REGLA DE LOS 1012, Y ES LO UNICO NO OBVIO DE ESTA FUNCION. Sin texto de
 * busqueda y sin ningun filtro explicito, NO se devuelve el catalogo entero:
 * se devuelven las baldas del ciclo —lo propio, y lo que atiende algun
 * adaptador en tracker, SCM o infraestructura—. El resto no esta escondido:
 * `total` sigue diciendo cuantos hay de verdad, las facetas los cuentan, y
 * cualquier filtro o cualquier busqueda los alcanza.
 *
 * POR QUE LA REGLA SE LEVANTA CON CUALQUIER FILTRO EXPLICITO. Porque pedir la
 * clase `integracion` a proposito y no recibir nada es una pantalla rota, y la
 * persona que la mira no tiene forma de saber que la lista se recorto sola.
 *
 * @param {readonly EntradaConsultable[]} catalogo
 * @param {Consulta} [consulta]
 */
export function consultar(catalogo, consulta = {}) {
  const texto = normalizar(consulta.texto ?? "").trim();
  const clase = consulta.clase ?? null;
  const modo = consulta.modo ?? null;
  const adaptador = consulta.adaptador ?? null;
  const soportado = consulta.soportado ?? null;
  const pedido = consulta.limite;
  const limite = typeof pedido === "number" && Number.isInteger(pedido) && pedido > 0 ? pedido : LIMITE_POR_DEFECTO;

  const hayFiltro = Boolean(texto) || clase !== null || modo !== null || adaptador !== null || soportado !== null;
  const soloElCiclo = !hayFiltro && consulta.todos !== true;

  const filtradas = catalogo.filter((e) => {
    if (clase !== null && e.clase !== clase) return false;
    if (modo !== null && e.modo !== modo) return false;
    // `ninguno` es el nombre que la faceta le da a la ausencia de adaptador:
    // pedir por el nombre que la faceta enseña tiene que funcionar.
    if (adaptador !== null && (adaptador === "ninguno" ? e.adaptador !== null : e.adaptador !== adaptador)) return false;
    if (soportado !== null && e.soportado !== soportado) return false;
    if (texto && !normalizar(e.nombre).includes(texto) && !normalizar(e.slug).includes(texto)) return false;
    if (soloElCiclo && e.estante > ESTANTES.DEL_CICLO) return false;
    return true;
  });

  const items = filtradas.slice(0, limite);

  return congelar({
    // `total` es el de la consulta ENTERA, no el de la pagina. Una pantalla que
    // dice "60" cuando hay 400 hace que el operador deje de buscar.
    total: filtradas.length,
    // Y `total_catalogo` es cuantos proveedores hay, pase lo que pase con los
    // filtros. Los dos numeros viajan porque con uno solo la pantalla miente en
    // alguna direccion: o el operador cree que el catalogo son 138, o no
    // entiende por que de 1012 le salieron 60. Que la vista por defecto recorte
    // esta bien; que lo recortado sea invisible, no.
    total_catalogo: catalogo.length,
    mostrados: items.length,
    hay_mas: filtradas.length > items.length,
    limite,
    // Que regla se aplico, dicho en la respuesta: si la lista se recorto sola,
    // la pantalla tiene que poder decirlo en vez de que parezca todo lo que hay.
    criterio: soloElCiclo ? "baldas_del_ciclo" : "consulta",
    items,
    facetas: facetasDe(filtradas),
  });
}

/**
 * Las cuentas por dimension sobre el resultado de la consulta.
 *
 * SON LO QUE HACE QUE MIL SEA UNA INTERFAZ. Nadie dibuja mil filas: se dibujan
 * cuatro clases con su numero al lado y el operador elige. Se cuentan sobre lo
 * FILTRADO y antes del `limite`, que es lo que el operador esta mirando — no
 * sobre la pagina, que daria numeros que cambian al pasar de pagina.
 *
 * @param {readonly EntradaConsultable[]} entradas
 */
function facetasDe(entradas) {
  const clase = { tracker: 0, scm: 0, infra: 0, integracion: 0 };
  const adaptador = { nango: 0, local: 0, ninguno: 0 };
  /** @type {Record<string, number>} */
  const modo = { oauth2: 0, api_key: 0, basic: 0, pat: 0, app: 0, ninguno: 0 };
  const soportado = { si: 0, no: 0 };

  for (const e of entradas) {
    if (tiene(clase, e.clase)) clase[e.clase] += 1;
    adaptador[e.adaptador === null ? "ninguno" : e.adaptador] += 1;
    const m = e.modo === null ? "ninguno" : e.modo;
    if (tiene(modo, m)) modo[m] += 1;
    soportado[e.soportado ? "si" : "no"] += 1;
  }

  return { clase, adaptador, modo, soportado };
}
