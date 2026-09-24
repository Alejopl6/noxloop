// El formato unico de error del servicio de control.
//
// POR QUE UN CATALOGO Y NO UN `throw new Error` EN CADA SITIO. NFR-006 exige
// que todo error nombre la causa completa y la accion siguiente. Un mensaje
// escrito en el lugar donde se detecta el fallo sale con lo que sabia quien lo
// escribio ese dia, y la mitad de las veces sale como "no autorizado": tecnica-
// mente cierto, y deja al operador reinstalando la aplicacion. Con el catalogo
// separado hay UN sitio donde mirar que errores existen, y un test que los
// recorre todos y falla si alguno no dice que hacer despues.
//
// `causa` es texto completo, no un resumen. `accion` nombra una operacion o una
// pantalla concreta — nunca "reintenta".

/** Version del sobre de error. Un cambio de forma sube la version de la API. */
export const CABECERAS_JSON = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
});

/**
 * @typedef {object} EntradaDeCatalogo
 * @property {number} estado codigo HTTP que le corresponde
 * @property {(datos: any) => string} causa
 * @property {(datos: any) => string} accion
 */

/** @type {Record<string, EntradaDeCatalogo>} */
export const CATALOGO = {
  falta_token: {
    estado: 401,
    causa: () =>
      "La peticion no trae el token de sesion. Este servicio lo exige en todas las rutas menos " +
      "`/v1/health`, porque cualquier pagina abierta en el navegador puede hacer peticiones a 127.0.0.1.",
    accion: () =>
      "Manda el token en la cabecera `x-noxloop-token` o como `Authorization: Bearer <token>`. " +
      "El escritorio lo entrega al abrir la ventana; fuera de el esta en `<home>/servicio/sesion.json`.",
  },

  token_invalido: {
    estado: 401,
    causa: () =>
      "El token de sesion que trae la peticion no es el de este servicio. Un token de una sesion " +
      "anterior deja de valer en cuanto el servicio se reinicia: se genera uno nuevo en cada arranque.",
    accion: () =>
      "Vuelve a pedir el token de la sesion en curso —el escritorio lo hace solo al reabrir la ventana— " +
      "o leelo de `<home>/servicio/sesion.json`.",
  },

  origen_no_permitido: {
    estado: 403,
    causa: (d) =>
      `El origen \`${d.origen}\` no esta en la allowlist de este servicio (${(d.permitidos || []).join(", ")}). ` +
      "La lista existe porque el token viaja en una cabecera que una pagina cualquiera podria copiar si " +
      "alguna vez se filtra, y un origen que no esta declarado no recibe ni la cabecera de CORS.",
    accion: (d) =>
      `Si \`${d.origen}\` es tuyo, declaralo al arrancar el servicio con \`--origen ${d.origen}\`. ` +
      "Si no lo es, no hay nada que hacer: la peticion no era tuya.",
  },

  ruta_desconocida: {
    estado: 404,
    causa: (d) =>
      `Este servicio no expone \`${d.metodo} ${d.ruta}\`. Las rutas de la version 1 estan en el ` +
      "contrato de la API de control, y una ruta que no existe suele ser una version de la interfaz " +
      "mas nueva que el servicio que tiene delante.",
    accion: () =>
      "Comprueba `/v1/health` para ver la version del servicio: si no es la que la interfaz espera, " +
      "cierra la aplicacion y vuelve a abrirla para que levante el servicio que le corresponde.",
  },

  metodo_no_permitido: {
    estado: 405,
    causa: (d) =>
      `\`${d.ruta}\` no acepta \`${d.metodo}\`; acepta ${(d.permitidos || []).join(", ")}. ` +
      "El servicio es el unico escritor del almacen, asi que cada ruta declara exactamente con que " +
      "metodos se la puede tocar en vez de aceptar cualquiera y decidir despues.",
    accion: (d) => `Repite la peticion con ${(d.permitidos || []).join(" o ")} sobre \`${d.ruta}\`.`,
  },

  home_bloqueado: {
    estado: 409,
    causa: (d) =>
      `Ya hay un servicio de control sobre \`${d.home}\`: ${d.razon}. Dos servicios sobre el mismo home ` +
      "son dos escritores del mismo almacen, y eso rompe el principio VIII sin que nadie lo note hasta " +
      "que el estado esta corrupto.",
    accion: (d) =>
      d.pid
        ? `Usa la ventana que ya esta abierta, o termina el proceso ${d.pid} si quedo huerfano ` +
          `(\`kill ${d.pid}\`) y vuelve a arrancar.`
        : "Cierra la aplicacion que ya esta usando ese home, o arranca este servicio con otro `--home`.",
  },

  cuerpo_invalido: {
    estado: 400,
    causa: (d) =>
      `El cuerpo de la peticion no sirve: ${d.detalle || "no se pudo leer"}. Este servicio es el unico ` +
      "escritor del almacen, asi que valida la forma ANTES de escribir nada: una fila a medias se lee " +
      "despues como un dato verificado y no hay forma de distinguirla.",
    // La accion repite las OPCIONES cuando el campo es un enum, aunque la causa
    // ya las diga. No es redundancia: quien recibe el error lee la accion —es
    // lo que la interfaz pone en el boton— y "vuelve a mandarlo con `area`" no
    // dice cuales valen, asi que el siguiente intento es otra adivinanza.
    accion: (d) => {
      if (d.opciones && d.opciones.length) {
        return (
          `Repite la peticion con \`${d.campos?.[0] ?? "el campo"}\` en uno de estos valores: ` +
          `${d.opciones.map((/** @type {string} */ o) => `\`${o}\``).join(", ")}.`
        );
      }
      return d.campos && d.campos.length
        ? `Vuelve a mandar la peticion con ${d.campos.map((/** @type {string} */ c) => `\`${c}\``).join(", ")}.`
        : "Vuelve a mandar la peticion con un cuerpo JSON valido; el contrato de la API de control declara la " +
          "forma que espera cada ruta.";
    },
  },

  // EL HERMANO DE `cuerpo_invalido` PARA LA QUERY, Y NO ES DUPLICACION. Un
  // filtro no se manda en el cuerpo, se manda en la URL: un error que dice "el
  // cuerpo de la peticion no sirve" manda a quien lo lee a revisar un cuerpo
  // que no existe. Y el fallo de fondo es peor que el mensaje: un `?clase=trackr`
  // ACEPTADO devuelve la lista entera con un 200 y con aspecto de respuesta
  // buena. Quien la mira cree que filtro, lee lo que no pidio, y no hay nada en
  // la respuesta que le permita darse cuenta.
  parametro_invalido: {
    estado: 400,
    causa: (d) =>
      `El parametro de consulta \`${d.parametro}\` vale \`${d.valor}\`, que no es ninguno de los valores que ` +
      "existen. Se rechaza en vez de ignorarse: un filtro ignorado devuelve otra lista, con 200 y sin ninguna " +
      "senal de que el filtro no se aplico.",
    accion: (d) =>
      `Repite la peticion con \`${d.parametro}\` en uno de estos valores: ` +
      `${(d.opciones || []).map((/** @type {string} */ o) => `\`${o}\``).join(", ")}.`,
  },

  // Escenario 4 de US1. La accion es LA que resuelve —inicializar el
  // repositorio— y no "elige otra carpeta": quien apunto ahi sabe que carpeta
  // quiere, lo que no sabe es que le falta `git init`.
  no_es_repositorio: {
    estado: 400,
    causa: (d) =>
      `\`${d.ruta}\` existe pero no es un repositorio git: no se encontro \`.git\` dentro. Un proyecto de ` +
      "origen `local` se adopta tal como esta, y todo lo que viene despues —la constitution versionada, el " +
      "diff del bootstrap, el worktree de cada tarea— necesita un repositorio debajo.",
    accion: (d) =>
      `Inicializa el repositorio con \`git init ${d.ruta}\` y vuelve a darlo de alta, o declara el proyecto ` +
      "con `origen: \"nuevo\"` para que el servicio lo prepare desde cero.",
  },

  // Escenario 3 de US2. Ofrecer adoptarlo es la mitad que importa: sin eso, el
  // operador borra la carpeta para poder seguir, y ahi se pierde trabajo suyo.
  ruta_relativa: {
    estado: 400,
    causa: (d) =>
      `\`${d.ruta}\` es una ruta relativa, y este servicio no tiene un directorio que el operador vea contra el ` +
      "cual resolverla: se resolveria contra donde se arranco el proceso, que puede ser cualquier sitio.",
    accion: (d) =>
      `Escribe la ruta absoluta, por ejemplo \`${d.ejemplo}\`, o elige la carpeta con el explorador de la ` +
      "pantalla de alta.",
  },

  destino_no_vacio: {
    estado: 409,
    causa: (d) =>
      `\`${d.ruta}\` ya tiene contenido (${d.cuantas} entrada(s), entre ellas ${d.muestra}). Un proyecto de ` +
      "origen `nuevo` escribe el andamiaje ahi dentro, y hacerlo sobre lo que ya hay es la forma exacta de " +
      "pisar trabajo que nadie volvio a ver.",
    accion: (d) =>
      `Da de alta \`${d.ruta}\` con \`origen: "local"\` para adoptarlo como esta —es lo que suele querer ` +
      "decir una carpeta con contenido— o apunta `ruta_local` a un destino vacio.",
  },

  // LOS TRES DEL EXPLORADOR DE CARPETAS. El primero es el unico que es una
  // decision de diseño y no un accidente del disco, y por eso su causa nombra
  // las raices: un limite que no dice donde SI se puede navegar se lee como un
  // fallo del producto, y el operador prueba otra ruta, y otra.
  ruta_fuera_del_alcance: {
    estado: 403,
    causa: (d) =>
      `\`${d.ruta}\` esta fuera de lo que este servicio deja explorar. Se puede navegar dentro de ` +
      `${(d.raices || []).map((/** @type {any} */ r) => `\`${r.ruta}\``).join(", ")} y nada mas. El explorador ` +
      "se acota a proposito: convertir «se una ruta» en «enumerame el disco» es la capacidad que merece un " +
      "limite, y el dia que la puerta de este servicio tenga un fallo, ese limite es la diferencia entre " +
      "filtrar las carpetas del home y filtrar el equipo entero.",
    accion: () =>
      "Navega desde una de las raices que la respuesta lista, o escribe la ruta absoluta en el campo de la " +
      "pantalla de alta: dar de alta un proyecto acepta cualquier ruta, y su carpeta queda explorable desde " +
      "ese momento.",
  },

  carpeta_inexistente: {
    estado: 404,
    causa: (d) =>
      d.es_archivo
        ? `\`${d.ruta}\` existe pero es un archivo, no una carpeta. Un proyecto se apunta a un directorio: es ` +
          "donde van el repositorio, el worktree de cada tarea y los archivos que el bootstrap escribe."
        : `\`${d.ruta}\` no existe en el disco de esta maquina. Puede haberse movido o borrado fuera de la ` +
          "aplicacion —este servicio no vigila el sistema de archivos— o puede ser la ruta de otro equipo.",
    accion: () =>
      "Vuelve a pedir la carpeta que la contiene para ver lo que hay ahora mismo, o empieza desde una de las " +
      "raices que esa respuesta lista.",
  },

  carpeta_ilegible: {
    estado: 403,
    causa: (d) =>
      `\`${d.ruta}\` existe y este proceso no la puede leer: ${d.detalle || "el sistema nego el acceso"}. No se ` +
      "devuelve como carpeta vacia a proposito: una lista vacia haria concluir que el proyecto no esta ahi, " +
      "cuando lo que pasa es que faltan permisos.",
    accion: () =>
      "Dale permiso de lectura al usuario que corre este servicio, o elige otra carpeta. `/v1/health` dice " +
      "sobre que home esta corriendo, que es el del mismo usuario.",
  },

  proyecto_desconocido: {
    estado: 404,
    causa: (d) =>
      `No hay ningun proyecto con el id \`${d.id}\` en este home. Puede ser de otro home —la interfaz y la ` +
      "CLI miran el mismo `--home` a proposito— o puede haberse dejado de gestionar desde otra ventana.",
    accion: () =>
      "Pide `/v1/projects` para ver los que este servicio gestiona y usa uno de esos ids; `/v1/health` dice " +
      "sobre que home esta corriendo.",
  },

  // UN codigo para todos los recursos de segundo nivel, con `tipo` adentro. Uno
  // por entidad multiplica el catalogo por diez y hace que el error del septimo
  // —el que nadie se acuerda de declarar— salga como `fallo_interno`.
  recurso_desconocido: {
    estado: 404,
    causa: (d) =>
      `No hay ningun ${d.tipo} con el id \`${d.id}\`${d.de ? ` en ${d.de}` : ""}. ` +
      "Los ids de este servicio no sobreviven a que el recurso se borre, y otra ventana sobre el mismo home " +
      "pudo borrarlo entre que lo leiste y lo pediste.",
    accion: (d) => `Vuelve a pedir la lista de ${d.tipo}(s) —${d.donde}— y usa un id de los que salgan ahi.`,
  },

  // FR-034. Se valida al guardar y no al ejecutar: un error de configuracion
  // descubierto a mitad de un run cuesta el run entero.
  revisor_comparte_runtime: {
    estado: 409,
    causa: (d) =>
      `El revisor \`${d.revisor}\` y el implementador \`${d.implementador}\` corren sobre el mismo runtime ` +
      `\`${d.runtime}\`. Una revision hecha por el mismo runtime que escribio el codigo aprueba sus propios ` +
      "puntos ciegos: no es una segunda opinion, es la primera repetida.",
    accion: (d) =>
      `Cambia el runtime de \`${d.revisor}\` a uno distinto de \`${d.runtime}\` en la pantalla de flota del ` +
      "proyecto, y vuelve a activar.",
  },

  // FR-064. La etapa que falta va en la causa a proposito: "no esta activo" sin
  // decir que falta deja al operador recorriendo las seis etapas a mano.
  proyecto_no_activo: {
    estado: 409,
    causa: (d) =>
      `El proyecto \`${d.nombre}\` esta en \`${d.estado}\` y un run solo se lanza desde \`ACTIVE\`. La etapa ` +
      `que falta es \`${d.etapa}\`: ${d.hallado}.`,
    accion: (d) => d.comoConseguirlo,
  },

  // ---- El puente proyecto-motor (spec 003) --------------------------------
  //
  // TRES CODIGOS Y NO UNO, porque cada uno manda a un sitio distinto. Un
  // `no_se_puede_lanzar` generico obligaria a la pantalla a leer la causa para
  // decidir a que pantalla de Settings mandar al operador, y leer prosa para
  // decidir es como se rompe una interfaz el dia que alguien reescribe la frase.
  // Los tres son 409: la peticion esta bien escrita, lo que falta es un dato del
  // proyecto.
  sin_repo: {
    estado: 409,
    causa: (d) =>
      `El proyecto \`${d.nombre}\` no tiene un repositorio remoto: ni el proyecto declara \`remoto\` ni ` +
      `\`${d.ruta}\` tiene un \`origin\`. El motor trabaja en ramas que empuja al remoto y abre el PR contra el; ` +
      "sin remoto no hay donde dejar el trabajo.",
    accion: (d) =>
      `Declara el remoto del proyecto con \`PATCH /v1/projects/${d.id}\` (\`{"remoto": "..."}\`) desde Settings del ` +
      "proyecto, o agrega un `origin` al repositorio local, y vuelve a pulsar Run.",
  },

  sin_gate: {
    estado: 409,
    causa: (d) =>
      `El proyecto \`${d.nombre}\` no tiene un gate: el comando cuyo exit code decide si una tarea cumple. ` +
      `${d.hallado}. Un run sin gate integraria codigo que nadie verifico, y el motor no lo arranca.`,
    accion: (d) =>
      `Vuelve a escanear el proyecto (\`POST /v1/projects/${d.id}/scan\`) despues de declarar el script \`test\` ` +
      "en el manifiesto, o corrige el hallazgo `testing.runner` del snapshot en Settings del proyecto.",
  },

  sin_gestor: {
    estado: 409,
    causa: (d) =>
      `El proyecto \`${d.nombre}\` no tiene un gestor de tickets que el motor sepa usar: ${d.hallado}. El motor ` +
      "lee el ticket, escribe su estado y deja el enlace al PR a traves de un proveedor; sin uno no hay ticket " +
      "que ejecutar.",
    accion: () =>
      "Conecta el gestor del proyecto —uno con proveedor en `providers/`— en Settings del proyecto -> Conexiones, " +
      "y vuelve a pulsar Run.",
  },

  // Principio IX: la credencial del gestor viaja al subproceso por el entorno y
  // solo con grant. Si no hay de donde sacarla, el motor NO se lanza: lanzarlo
  // igual lo haria morir en `loadProvider` con «falta la variable», que es un
  // mensaje del motor en el stderr de un proceso que nadie mira.
  sin_credencial_del_gestor: {
    estado: 409,
    causa: (d) =>
      `El gestor \`${d.gestor}\` del proyecto \`${d.nombre}\` necesita ${d.variables} en el entorno del motor, ` +
      `y no se puede entregar: ${d.porque}. La credencial solo llega al subproceso desde la boveda y con un ` +
      "grant vigente; nunca por la linea de comandos.",
    accion: () =>
      "Guarda el token del gestor en Settings -> Credenciales y concede un grant sobre ella a un agente del " +
      "proyecto (`POST /v1/grants`); despues vuelve a pulsar Run.",
  },

  // Aprobar un plan que no esta esperando aprobacion, o reintentar un run que
  // no fallo. UN codigo con la accion pedida y el estado adentro, porque lo que
  // el operador necesita saber es lo mismo en los dos casos: en que esta el run
  // y que acciones tiene de verdad.
  run_sin_esa_accion: {
    estado: 409,
    causa: (d) =>
      `El run del ticket \`${d.itemId}\` esta en \`${d.estado}\`, y \`${d.accion}\` solo tiene sentido ` +
      `${d.cuando}. Hacerlo igual ${d.riesgo}.`,
    accion: (d) =>
      `Pide \`GET /v1/runs?project=${d.projectId ?? ""}\` para ver el estado actual del run; ` +
      `${d.disponible ? `lo que si se puede hacer ahora es \`${d.disponible}\`.` : "ahora no tiene ninguna accion pendiente."}`,
  },

  // Principio X aplicado a las costuras que todavia no estan montadas. UN
  // codigo, con la pieza adentro: declarar el hueco es el contrato, y un
  // `fallo_interno` en su lugar manda al operador a leer una traza que no es suya.
  pieza_ausente: {
    estado: 503,
    causa: (d) => `${d.porque} Sin \`${d.pieza}\`, esta ruta no puede hacer lo que promete y no lo va a fingir.`,
    accion: (d) => d.comoConseguirlo,
  },

  // La otra mitad del compare-and-set del contrato: `ETag`/`If-Match` en `PUT`
  // y `PATCH`, y `412` si cambio por debajo.
  estado_obsoleto: {
    estado: 412,
    causa: (d) =>
      `La peticion declaro \`If-Match: ${d.esperado}\` y el ${d.tipo} \`${d.id}\` esta hoy en \`${d.actual}\`. ` +
      "Cambio por debajo entre que lo leiste y lo mandaste — con dos ventanas abiertas sobre el mismo home " +
      "eso pasa, y escribir encima es como se pierde lo que hizo la otra.",
    accion: () =>
      "Vuelve a pedir el recurso, mira que cambio, y repite la operacion con el `ETag` nuevo. Si lo que " +
      "querias sigue teniendo sentido sobre el estado de ahora, sale igual.",
  },

  fallo_interno: {
    estado: 500,
    causa: (d) =>
      `El servicio no pudo completar la peticion por un fallo suyo: ${d.detalle || "sin detalle"}. ` +
      "No es un error de lo que pediste: es un camino que este servicio no previo.",
    accion: () =>
      "Mira la salida de error del servicio, que trae la traza completa, y abre el fallo con esa traza. " +
      "Mientras tanto, `/v1/health` dice si el servicio sigue en pie.",
  },
};

/**
 * Un error que ya sabe decir su causa y su accion. Se usa igual en el arranque
 * —donde no hay respuesta HTTP que devolver— que dentro de una peticion.
 */
export class ErrorDeServicio extends Error {
  /**
   * @param {string} codigo clave del CATALOGO
   * @param {Record<string, any>} [datos] lo que las plantillas necesitan
   */
  constructor(codigo, datos = {}) {
    const cuerpo = problema(codigo, datos);
    super(cuerpo.error.causa);
    this.name = "ErrorDeServicio";
    this.codigo = cuerpo.error.codigo;
    this.causa = cuerpo.error.causa;
    this.accion = cuerpo.error.accion;
    this.estado = (CATALOGO[codigo] || CATALOGO.fallo_interno).estado;
    this.datos = datos;
    this.cuerpo = cuerpo;
  }
}

/**
 * El sobre que sale por el cable. Nada mas que `error` arriba: un segundo campo
 * al lado parte a los clientes en dos, los que lo leen y los que no.
 *
 * @param {string} codigo
 * @param {Record<string, any>} [datos]
 * @returns {{error: {codigo: string, causa: string, accion: string, objeto?: any}}}
 */
export function problema(codigo, datos = {}) {
  const entrada = CATALOGO[codigo];
  if (!entrada) {
    // Un codigo que no esta en el catalogo es un fallo del servicio, no del
    // cliente: se dice asi en vez de devolver un sobre a medias.
    return problema("fallo_interno", { detalle: `codigo de error no declarado: ${codigo}` });
  }
  const error = /** @type {any} */ ({
    codigo,
    causa: entrada.causa(datos),
    accion: entrada.accion(datos),
  });
  if (datos.objeto) error.objeto = datos.objeto;
  return { error };
}

/**
 * Un error que YA viene con causa y accion desde el paquete que lo emitio.
 *
 * POR QUE SE MIRA LA FORMA Y NO `instanceof`. Los cinco paquetes que este
 * servicio cablea declaran su propia clase de error —`ErrorDeNucleo`,
 * `ErrorDeAlmacen`, `ErrorDeBoveda`, `ErrorDeConexion`, `ErrorDeScanner`— y
 * ninguna importa a las otras a proposito: cada paquete viaja al escritorio como
 * recurso suelto. Con `instanceof` habria que importar las cinco clases aqui, y
 * la sexta que aparezca saldria como `fallo_interno` sin que nadie lo note. La
 * forma —codigo, causa y accion— es el contrato que NFR-006 les exige a todas.
 *
 * @param {any} e
 */
export function esDeDominio(e) {
  return Boolean(e) && typeof e.codigo === "string" && typeof e.causa === "string" && typeof e.accion === "string";
}

/**
 * El codigo HTTP de un error de dominio que no lo trae puesto.
 *
 * POR QUE ESTA TABLA EXISTE, Y POR QUE ES CORTA. `ErrorDeNucleo` trae su propio
 * `estado` porque el contrato de la API fija codigos concretos para sus casos
 * —el 400 de la enmienda incompleta, el 409 del diff obsoleto— y el dominio es
 * quien sabe cual corresponde. Los otros cuatro paquetes no saben de HTTP a
 * proposito: `packages/store` no importa nada de fuera de si mismo, y meterle
 * un campo `estado` seria meterle el protocolo del servicio adentro.
 *
 * Asi que la traduccion vive aqui, que es el unico sitio que conoce a los dos.
 * Solo se listan los que NO son 400: un error de dominio es, por defecto, algo
 * que la peticion pidio y no se pudo dar. Lo que esta tabla evita es que un
 * conflicto real —una transicion sin su artefacto, un grant revocado— salga
 * como `400 Bad Request` y el cliente lo trate como un error de formato suyo y
 * deje de reintentar lo que si tenia sentido reintentar.
 *
 * @type {Record<string, number>}
 */
const ESTADO_DE_DOMINIO = {
  // `packages/store` — la maquina de estados y sus guardas.
  proyecto_desconocido: 404,
  transicion_no_declarada: 409,
  retroceso_no_existe: 409,
  atajo_solo_para_proyecto_nuevo: 409,
  transicion_sin_artefacto: 409,
  escritor_concurrente: 409,
  auditoria_sin_redactor: 503,

  // `packages/vault`. Denegar por defecto: un acceso sin grant vigente es un
  // 403 y no un 400 — lo que se pidio esta bien escrito, lo que falta es el
  // permiso, y la accion del error dice como pedirlo.
  credencial_ausente: 404,
  grant_ausente: 404,
  sin_grant: 403,
  grant_no_vigente: 403,
  redactor_sin_cargar: 503,
  backend_sin_motivo: 503,
  backend_desconocido: 503,

  // `packages/connections`.
  proveedor_desconocido: 404,
  conexion_desconocida: 404,
  handle_desconocido: 404,
  conexion_revocada: 409,
  conexion_pendiente: 409,
  adaptador_caido: 503,
  espera_agotada: 504,
  // El proveedor externo contesto, y contesto que no. La peticion de quien
  // llamo estaba bien escrita: lo que fallo esta del otro lado del cable —un
  // token sin el permiso que hace falta, o caducado— y un 400 haria que la
  // pantalla lo tratara como un error de formato suyo y dejara de ofrecer la
  // salida que si sirve, que es volver a conectar el proveedor.
  listado_rechazado: 502,
  respuesta_inesperada: 502,
  sin_listado_de_repositorios: 409,
  // Una fuga detectada es un fallo DE ESTE SERVICIO, no de quien llamo: la
  // peticion era correcta y el que se equivoco fue el adaptador al devolver un
  // valor donde iba una referencia.
  fuga_de_valor: 500,

  // `packages/scanner`.
  ruta_inaccesible: 404,
  no_es_directorio: 400,
};

/**
 * Cualquier excepcion convertida al unico formato. Lo que entra por aqui es lo
 * que nadie previo, y sale igual de accionable que lo previsto.
 *
 * @param {any} e
 */
export function deExcepcion(e) {
  return describir(e).cuerpo;
}

/**
 * El sobre Y el codigo HTTP, juntos.
 *
 * POR QUE LOS DOS A LA VEZ. Un error del nucleo trae su propio `estado` —el 400
 * de la enmienda sin sus tres campos, el 409 del diff obsoleto son decisiones
 * del contrato, no de este archivo— y el catalogo de aqui no lo conoce.
 * Calcular el estado aparte, mirando solo el codigo, devolvia 500 para todos
 * ellos: el cliente veia "fallo del servicio" donde el servicio habia dicho
 * exactamente que estaba mal en la peticion.
 *
 * @param {any} e
 * @returns {{cuerpo: {error: any}, estado: number}}
 */
export function describir(e) {
  if (e instanceof ErrorDeServicio) return { cuerpo: e.cuerpo, estado: e.estado };
  if (esDeDominio(e)) {
    const error = /** @type {any} */ ({ codigo: e.codigo, causa: e.causa, accion: e.accion });
    if (e.objeto) error.objeto = e.objeto;
    // `estado` solo lo trae el nucleo. Para los demas esta la tabla de arriba,
    // y lo que no aparece en ninguna de las dos es un 400: lo que llego no se
    // pudo aceptar, y no es una caida de este servicio.
    const estado = typeof e.estado === "number" ? e.estado : (ESTADO_DE_DOMINIO[e.codigo] ?? 400);
    return { cuerpo: { error }, estado };
  }
  const cuerpo = problema("fallo_interno", { detalle: e && e.message ? e.message : String(e) });
  return { cuerpo, estado: 500 };
}

/** El estado HTTP que le toca a un sobre ya construido. */
export function estadoDe(cuerpo) {
  const entrada = CATALOGO[cuerpo?.error?.codigo];
  return entrada ? entrada.estado : 500;
}
