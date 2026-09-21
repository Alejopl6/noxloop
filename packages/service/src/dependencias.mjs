// El cableado: donde los seis paquetes se convierten en un servicio.
//
// LO QUE ESTE ARCHIVO RESUELVE, Y ESTABA ESCRITO COMO UN `TODO` EN DOS SITIOS.
// `packages/vault/src/repositorio.mjs` y `packages/core/src/repositorio.mjs`
// declararon su persistencia INYECTADA y dejaron una implementacion en memoria
// con un TODO que dice, palabra por palabra, "implementar cuando se decida cual
// es el almacen". Ya se decidio: es `packages/store`. Esto es la sustitucion.
//
// POR QUE LOS IMPORTS SON RELATIVOS Y SALEN DEL PAQUETE. Es la unica cosa de
// este archivo que esta MAL a proposito y con fecha de arreglo. `packages/store`,
// `packages/vault`, `packages/scanner`, `packages/core` y `packages/connections`
// viajan al escritorio como recursos sueltos del sidecar, igual que este
// paquete; un import relativo que sale de aqui resuelve en el repositorio y
// muere con `ERR_MODULE_NOT_FOUND` en la aplicacion instalada. Ya paso una vez
// con el lock. Lo que lo cierra no es codigo de aqui: es declarar esos cinco
// paquetes como recursos del sidecar en la configuracion del escritorio, y esta
// escrito en el informe de esta tarea en vez de escondido en un comentario.
//
// POR QUE HAY PIEZAS QUE PUEDEN FALTAR Y NO SE INVENTAN. La boveda necesita una
// frase de paso que este servicio no tiene de donde sacar, y el proveedor de
// conexiones necesita un adaptador que todavia nadie monto aqui. Lo que NO se
// hace es fabricar una frase de paso y guardarla al lado del archivo cifrado
// —que es cifrar y dejar la llave pegada— ni declarar un proveedor que manda al
// operador a un flujo que no existe. La pieza que falta se declara con su
// causa y con como conseguirla: es el principio X, y aqui el precio de
// inventarla es que alguien guarde un secreto creyendo que esta protegido.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { abrirAlmacen } from "../../store/src/index.mjs";
import { crearBoveda, crearRedactor, crearBackendDeArchivo, elegirBackend } from "../../vault/src/index.mjs";

import { ErrorDeServicio } from "./errores.mjs";
import { repositorioDeNucleoSobreAlmacen } from "./nucleo-repositorio.mjs";

/** El nombre del archivo del almacen dentro del home. Uno por home, como el lock. */
export const ARCHIVO_DEL_ALMACEN = "almacen.sqlite";

/** Donde queda el respaldo cifrado cuando el backend es el de archivo. */
export const ARCHIVO_DE_LA_BOVEDA = "boveda-cifrada.json";

/** La variable de entorno con la frase de paso del respaldo cifrado. */
export const VARIABLE_DE_FRASE = "NOXLOOP_BOVEDA_FRASE";

/**
 * La sal de las huellas, persistida.
 *
 * POR QUE NO SE GENERA EN CADA ARRANQUE. `packages/vault/src/huella.mjs` lo
 * deja escrito en su propio TODO: con una sal por proceso, la huella del MISMO
 * valor cambia entre arranques, y entonces "la huella cambio" deja de
 * significar "alguien roto la credencial" — que es lo unico para lo que la
 * huella sirve. Vive junto al almacen, que es donde ese TODO pedia ponerla.
 *
 * @param {string} home
 */
function salDelHome(home) {
  const dir = join(home, "servicio");
  mkdirSync(dir, { recursive: true });
  const destino = join(dir, "boveda.sal");
  if (existsSync(destino)) return readFileSync(destino, "utf8").trim();
  const sal = randomBytes(32).toString("hex");
  const tmp = `${destino}.tmp-${process.pid}`;
  // `mode` en la CREACION y no en un chmod posterior, igual que el archivo de
  // sesion: entre el open y el chmod el archivo existe legible para todo el
  // sistema, y un instante alcanza.
  writeFileSync(tmp, sal + "\n", { mode: 0o600 });
  renameSync(tmp, destino);
  return sal;
}

/**
 * El workspace de este home. Se busca por `home` y se crea si no esta.
 *
 * POR QUE POR `home` Y NO POR UN ID GUARDADO EN OTRO SITIO. El home ES la
 * identidad del workspace: el lock se toma sobre el home, el almacen vive en el
 * home, y dos servicios sobre el mismo home ya se rechazan entre si. Un id
 * guardado aparte es una segunda fuente de verdad que se puede desincronizar.
 *
 * @param {any} almacen
 * @param {string} home
 */
function workspaceDelHome(almacen, home) {
  const existente = almacen.workspaces.todos().find((/** @type {any} */ w) => w.home === home);
  return existente ?? almacen.workspaces.crear({ home });
}

/**
 * La auditoria de la boveda, escrita en la del almacen.
 *
 * POR QUE NO SE USA `crearAuditoria` DE LA BOVEDA. La suya vive en memoria y
 * muere con el proceso: sirve para las pruebas del paquete, no para responder
 * "quien saco esta credencial el martes". La del almacen es append-only por
 * disparador Y encadenada por hash, que son dos mecanismos contra dos atacantes
 * distintos. FR-049 exige la segunda.
 *
 * POR QUE LOS DOS VOCABULARIOS SE TRADUCEN EN UN SOLO SITIO. La boveda habla de
 * `{tipo, resultado, ref, motivo}` y el modelo de datos de
 * `{accion, objeto_tipo, objeto_id, resultado}`. Repartida, la traduccion es
 * donde se pierde el invariante el dia que alguien mapea `denegado` a
 * `permitido` porque el campo se llamaba distinto.
 *
 * @param {any} almacen
 */
export function auditoriaSobreAlmacen(almacen) {
  /** @param {any} datos */
  const resultadoDe = (datos) => {
    if (datos.resultado === "denegado") return "denegado";
    if (datos.resultado === "ok" || datos.resultado === "concedido") return "permitido";
    return "error";
  };

  return {
    /** @param {any} datos */
    registrar(datos) {
      const { tipo, resultado, ref, motivo, grant_id, credential_id, ...resto } = datos;
      const objeto_tipo = grant_id ? "grant" : ref || credential_id ? "credential" : "vault";
      return almacen.auditoria.registrar({
        // El actor es quien pidio, no este proceso. Cuando la operacion trae un
        // motivo, el agente esta ahi; cuando no, fue el servicio por su cuenta y
        // se dice asi en vez de atribuirselo a una persona que no decidio nada.
        actor: motivo?.agent_id ?? datos.actor ?? "servicio-de-control",
        accion: String(tipo ?? "vault.desconocido"),
        objeto_tipo,
        objeto_id: String(grant_id ?? ref ?? credential_id ?? "-"),
        resultado: resultadoDe(datos),
        detalle: { ...resto, ...(motivo ? { motivo } : {}), ...(ref ? { ref } : {}) },
      });
    },
    listar() {
      return almacen.auditoria.eventos({ limite: 1000 });
    },
    verificar() {
      const v = almacen.auditoria.verificarCadena();
      return { ok: v.intacta, desde: v.roto ? v.roto.id : null };
    },
  };
}

/**
 * La boveda que usa la CAPA DE CONEXIONES, y por que no puede ser la misma.
 *
 * EL FALLO, MEDIDO CONTRA EL SERVICIO CORRIENDO. Conectar un proveedor pegando
 * un token moria con:
 *
 *     el deposito de secretos no pudo autorizar el uso de 'token':
 *     FOREIGN KEY constraint failed
 *
 * La clave foranea es `grant.agent_id REFERENCES agent(id)`. La capa de
 * conexiones pide el permiso a nombre de si misma —no hay ningun agente de la
 * flota todavia, y normalmente no lo habra: el operador conecta su cuenta antes
 * de tener ningun agente— asi que la fila no tiene a quien apuntar.
 *
 * POR QUE NO SE FABRICA UN AGENTE PARA QUE LA CLAVE CIERRE. Porque `agent` es
 * la FLOTA: sus filas salen en la pantalla de agentes, entran en la sugerencia
 * de flota y tienen un `rol` de un enum cerrado —implementador, revisor,
 * planificador, verificador— del que ninguno describe a un plano de control.
 * Un agente inventado para satisfacer una clave foranea es una fila que alguien
 * va a leer como flota real.
 *
 * QUE SE HACE EN SU LUGAR, Y QUE CUESTA. El permiso de la capa de conexiones
 * vive en memoria; todo lo demas es el mismo camino de siempre: el mismo
 * backend cifrado, el MISMO inventario de credenciales del almacen —la
 * credencial aparece con su huella en `GET /v1/credentials`— y la MISMA
 * auditoria encadenada, que sigue registrando cada acceso al valor.
 *
 * Lo que cuesta es que ese permiso no sobrevive a un reinicio. Y eso no es una
 * degradacion nueva: el repositorio de `packages/connections` tambien vive en
 * memoria —lo declara su propio `TODO(persistencia)`— asi que la conexion a la
 * que ese permiso sirve muere en el mismo reinicio. El dia que las conexiones
 * se persistan, este permiso tiene que persistirse con ellas, y entonces hara
 * falta decidir a nombre de QUE se concede. Va en el informe.
 *
 * LOS GRANTS DE LA FLOTA NO SE TOCAN: `POST /v1/grants` sigue escribiendo en la
 * tabla, con su agente y su autor, que es donde tienen que estar.
 *
 * @param {{backend: any, repositorio: any, auditoria: any, sal: string, reloj: () => number}} piezas
 */
export function bovedaDeLaCapaDeConexiones({ backend, repositorio, auditoria, sal, reloj }) {
  /** @type {Map<string, any>} */
  const permisos = new Map();
  return crearBoveda({
    backend,
    auditoria,
    sal,
    reloj,
    repositorio: {
      ...repositorio,
      // Las credenciales siguen yendo al almacen: son inventario del operador y
      // tienen que verse, rotarse y revocarse desde la pantalla como cualquier
      // otra. Lo unico que se desvia es el permiso.
      guardarGrant(grant) {
        permisos.set(grant.id, grant);
        return grant;
      },
      grantPorId(id) {
        return permisos.get(id) ?? null;
      },
      grants() {
        return [...permisos.values()];
      },
    },
  });
}

/**
 * El backend de secretos, o la constancia de por que no hay ninguno.
 *
 * @param {{home: string, frase?: string|null}} opts
 * @returns {{backend: any, ausencia: null}|{backend: null, ausencia: {porque: string, comoConseguirlo: string}}}
 */
function backendDeSecretos({ home, frase }) {
  // El sondeo del llavero del sistema todavia no existe en este servicio, y
  // `elegirBackend` esta hecho justamente para que esa ausencia se declare en
  // vez de caerse callada al archivo cifrado: el operador cree que lo protege
  // el sistema operativo y en realidad lo protege una frase de paso.
  const eleccion = elegirBackend({
    llavero: {
      disponible: false,
      causa:
        "este servicio todavia no sondea el llavero del sistema operativo; la deteccion llega con la etapa de " +
        "credenciales y declarar el llavero sin haberlo ejercido seria prometer una proteccion que nadie probo",
    },
  });

  if (!frase) {
    return {
      backend: null,
      ausencia: {
        porque:
          "no hay backend de secretos montado: el llavero del sistema no se sondea todavia y el respaldo " +
          "cifrado no tiene frase de paso.",
        comoConseguirlo:
          `Arranca el servicio con \`${VARIABLE_DE_FRASE}\` en el entorno —la frase con la que se cifra ` +
          `\`<home>/${ARCHIVO_DE_LA_BOVEDA}\`— y vuelve a intentarlo. No se genera una sola: una frase ` +
          "guardada junto al archivo que cifra no protege de nadie, y el operador creeria que si.",
      },
    };
  }

  return {
    backend: crearBackendDeArchivo({
      ruta: join(home, ARCHIVO_DE_LA_BOVEDA),
      passphrase: frase,
      motivo: eleccion.motivo,
    }),
    ausencia: null,
  };
}

/**
 * El repositorio del almacen, visto por la boveda.
 *
 * LO UNICO QUE CAMBIA ES `guardarGrant`, Y ES POR UNA COSTURA REAL ENTRE LOS
 * DOS PAQUETES. `data-model.md` exige `concedido_por` en todo grant —siempre
 * una persona, porque un grant concedido por el sistema no se le puede
 * preguntar a nadie— y el `Grant` de `packages/vault` no tiene ese campo:
 * `crearGrant` devuelve un objeto congelado de siete campos fijos y descarta lo
 * que no reconoce. Asi que cada vez que la boveda reescribe un grant —al
 * otorgarlo, al revocarlo— la fila que le llega al almacen viene sin autor y el
 * almacen la rechaza, con razon.
 *
 * Lo que hace esto es CONSERVAR el autor que ya estaba en la fila, no
 * inventarlo. Si no hay fila previa, no hay autor que conservar y el almacen
 * sigue rechazando — que es exactamente lo que tiene que pasar: un grant sin
 * dueño no se guarda. El arreglo de fondo es que `crearGrant` acepte el campo,
 * y va en el informe con su diff.
 *
 * @param {any} almacen
 */
export function bovedaDelAlmacenParaLaBoveda(almacen) {
  return {
    ...almacen.boveda,
    /** @param {any} grant */
    guardarGrant(grant) {
      if (grant && !grant.concedido_por && grant.id) {
        const previo = almacen.boveda.grantPorId(grant.id);
        if (previo && previo.concedido_por) {
          return almacen.boveda.guardarGrant({ ...grant, concedido_por: previo.concedido_por });
        }
      }
      return almacen.boveda.guardarGrant(grant);
    },

    /**
     * La fila del grant, TRADUCIDA al vocabulario en el que la boveda mira la
     * vigencia.
     *
     * EL FALLO QUE CIERRA, Y ES UNA PUERTA ABIERTA, NO UN DETALLE DE NOMBRES.
     * `estadoDelGrant` de `packages/vault` lee `revocadoEn` y `vigenciaHasta`;
     * la fila que devuelve el almacen trae `revocado_en` y `vigencia_hasta`,
     * porque las columnas llevan los nombres del modelo de datos. Sobre una
     * fila del almacen, esos dos campos son `undefined`, asi que la
     * comprobacion de vigencia de `recuperar` devuelve «vigente» SIEMPRE:
     *
     *   estadoDelGrant({..., revocado_en: "2020-01-01", vigencia_hasta: "2020-01-02"}, Date.now())
     *   -> { vigente: true, causa: null }
     *
     * Es decir: un grant revocado hace meses seguia autorizando a sacar el
     * valor de una credencial, y el evento de auditoria se escribia como
     * `concedido`. No se nota desde fuera —el acceso funciona, que es lo que se
     * esperaba— y por eso lleva ahi desde que este archivo cableo los dos
     * paquetes.
     *
     * La traduccion vive AQUI porque este objeto existe exactamente para eso:
     * es la costura entre el vocabulario del almacen y el de la boveda, y ya
     * traducia en la otra direccion al guardar. Los dos nombres se aceptan: si
     * algun dia el almacen empieza a devolver el vocabulario de la boveda, esto
     * sigue siendo correcto.
     *
     * @param {string} id
     */
    grantPorId(id) {
      const fila = almacen.boveda.grantPorId(id);
      if (!fila) return fila;
      return {
        ...fila,
        revocadoEn: fila.revocadoEn ?? fila.revocado_en ?? null,
        vigenciaHasta: fila.vigenciaHasta ?? fila.vigencia_hasta ?? null,
        otorgadoEn: fila.otorgadoEn ?? fila.concedido_en ?? null,
      };
    },
  };
}

/**
 * Monta todo lo que las rutas necesitan, sobre un home.
 *
 * @param {{
 *   home: string,
 *   frase?: string|null,
 *   backendDeSecretos?: any,
 *   proveedorDeConexiones?: any|((piezas: {boveda: any, home: string, workspace: any}) => any),
 *   adaptadores?: any,
 *   fabricaDeModelo?: ((conf: {clave: string, modelo?: string}) => any)|null,
 *   reloj?: () => number,
 * }} opts
 */
export async function abrirDependencias(opts) {
  const home = opts.home;
  const reloj = opts.reloj ?? (() => Date.now());

  // La eleccion del backend va ANTES de abrir el almacen aunque no dependa de
  // el: `redactar` nombra su ausencia en el error, y una constante declarada
  // despues de la funcion que la lee es un `ReferenceError` esperando al primer
  // evento de auditoria — o sea, al peor momento.
  const eleccion = opts.backendDeSecretos
    ? { backend: opts.backendDeSecretos, ausencia: null }
    : backendDeSecretos({ home, frase: opts.frase ?? null });
  const ausenciaDeLaBoveda = eleccion.ausencia;

  /** @type {any} */
  let redactorDeLaBoveda = null;

  // El redactor se resuelve TARDE a proposito, y no es un rodeo: el almacen lo
  // exige al abrirse y el redactor necesita el repositorio del almacen para
  // saber contra que comparar. La alternativa —un redactor identidad por
  // defecto— convierte el principio IX en una recomendacion: el dia que nadie
  // lo inyecta, la auditoria sigue escribiendo y el detalle sale crudo.
  const redactar = (/** @type {any} */ detalle) => {
    if (redactorDeLaBoveda) return redactorDeLaBoveda.redactarObjeto(detalle);

    // SIN BOVEDA NO HAY SECRETOS QUE REDACTAR, y eso es una conclusion, no un
    // atajo: el unico camino por el que un valor entra a este servicio es
    // `boveda.registrar`. Sin backend de secretos, esa ruta devuelve 503 antes
    // de tocar nada, asi que el inventario esta vacio por construccion y el
    // conjunto contra el que redactar es demostrablemente el vacio.
    //
    // EL FALLO QUE ESTA RAMA EVITA, y aparecio al auditar las transiciones de
    // estado: antes, CUALQUIER evento de auditoria sin boveda montada
    // devolvia 503. Cuando las transiciones empezaron a dejar rastro, eso
    // significo que aceptar un snapshot o fijar la constitution exigia una
    // frase de cifrado — pedirle al operador que configure credenciales para
    // avanzar una etapa que no usa ninguna. Catorce pruebas lo demostraron de
    // golpe.
    //
    // Lo que NO se hace es devolver el detalle tal cual. Eso seria el redactor
    // identidad por defecto que el almacen rechaza con razon: el dia que
    // alguien monte la boveda despues de arrancar, esta rama seguiria activa y
    // el detalle saldria crudo. Se rompe a proposito si aparece algo que
    // parezca un secreto, porque en ese caso la premisa —"no hay secretos"— es
    // falsa y el silencio seria la fuga.
    const texto = JSON.stringify(detalle ?? {});
    if (/[A-Za-z0-9_\-]{32,}/.test(texto)) {
      throw new ErrorDeServicio("pieza_ausente", {
        pieza: "el redactor de la boveda",
        porque:
          "el detalle de este evento contiene algo con forma de secreto y no hay boveda montada con que " +
          "redactarlo. Sin poder redactar, no se persiste: la redaccion es previa a la escritura.",
        comoConseguirlo: ausenciaDeLaBoveda?.comoConseguirlo ?? "Monta la boveda antes de auditar esto.",
      });
    }
    return detalle ?? {};
  };

  const almacen = abrirAlmacen({ ruta: join(home, ARCHIVO_DEL_ALMACEN), redactor: redactar });
  const workspace = workspaceDelHome(almacen, home);

  const auditoria = auditoriaSobreAlmacen(almacen);
  const repositorioDeLaBoveda = bovedaDelAlmacenParaLaBoveda(almacen);
  /** @type {any} */
  let boveda = null;

  if (eleccion.backend) {
    boveda = crearBoveda({
      backend: eleccion.backend,
      repositorio: repositorioDeLaBoveda,
      auditoria,
      sal: salDelHome(home),
      reloj,
    });
    redactorDeLaBoveda = crearRedactor({
      backend: eleccion.backend,
      repositorio: almacen.boveda,
      auditoria,
    });
    // Se carga al arrancar y no en el primer uso: `redactar` sin cargar LANZA,
    // y el sitio donde lanzaria seria la primera escritura de auditoria — o
    // sea, el peor momento posible para descubrirlo.
    await redactorDeLaBoveda.cargarHuellas();
  }

  const nucleo = repositorioDeNucleoSobreAlmacen(almacen, { actor: "servicio-de-control" });

  // EL PROVEEDOR DE CONEXIONES SE ACEPTA COMO FABRICA, Y ESE ERA EL NUDO.
  //
  // Construir el adaptador decide donde queda el valor de la credencial, y eso
  // no lo sabe este archivo: lo decide quien monta el servicio. Pero el
  // adaptador que guarda tokens necesita LA BOVEDA, y la boveda nace aqui, doce
  // lineas mas arriba, a partir del home y de la frase. Quien arranca el
  // servicio no la tiene: le pasa una fabrica y la recibe ya montada.
  //
  // EL FALLO CONCRETO QUE ESTO CIERRA, medido contra el servicio corriendo: el
  // ejecutable nunca inyectaba ningun proveedor porque no tenia con que
  // construirlo, asi que TODAS las rutas de conexiones —listar, autorizar,
  // revocar, el callback— contestaban 503 `pieza_ausente`. El mensaje era
  // impecable y la pantalla de conexiones era decorado: ninguna accion hacia
  // nada.
  const proveedorDeConexiones =
    typeof opts.proveedorDeConexiones === "function"
      ? opts.proveedorDeConexiones({
          boveda: boveda
            ? bovedaDeLaCapaDeConexiones({
                backend: eleccion.backend,
                repositorio: repositorioDeLaBoveda,
                auditoria,
                sal: salDelHome(home),
                reloj,
              })
            : null,
          home,
          workspace,
        })
      : (opts.proveedorDeConexiones ?? null);


  return {
    home,
    almacen,
    workspace,
    nucleo,
    auditoria,
    boveda,

    /**
     * Los escaneos EN VUELO, por `snapshot_id`.
     *
     * Vive en memoria y no en el almacen a proposito: un `AbortController` no
     * se persiste, y una fila que dijera "en curso" tras un reinicio describiria
     * un recorrido que ya no existe. Un escaneo que no termino no deja
     * snapshot, que es exactamente lo que FR-015 pide.
     *
     * @type {Map<string, {project_id: string, hilo: import("node:worker_threads").Worker, arrancado: number, cancelado: boolean}>}
     */
    escaneos: new Map(),
    ausenciaDeLaBoveda,
    backend: eleccion.backend,
    /**
     * El registro de runtimes de agente, INYECTADO.
     *
     * POR QUE NO SE CONSTRUYE AQUI. Construir un adaptador es donde se deciden
     * el binario, los hooks y el home — cosas que este servicio no sabe y que
     * dependen de la maquina del operador. Un registro armado aqui con valores
     * supuestos prometeria runtimes que nadie arranco, que es exactamente lo
     * que `/v1/capabilities` declara hoy que NO hace.
     *
     * Y SU AUSENCIA SE DECLARA en vez de sustituirse por un registro vacio: uno
     * vacio hace que la sugerencia de flota devuelva «no se puede sugerir
     * ningun rol», que se lee como «este proyecto no puede tener agentes» — una
     * conclusion que nadie saco.
     */
    /**
     * La fabrica del proveedor de modelo, INYECTABLE y con un defecto real.
     *
     * POR QUE TIENE DEFECTO Y LOS ADAPTADORES NO. Porque aqui no hay nada que
     * decidir sobre la maquina del operador: el proveedor se construye con la
     * clave que sale de la boveda y nada mas, asi que un defecto no promete
     * nada que no se pueda cumplir. La ausencia que si se declara es la otra
     * —la de la credencial— y la calcula `asistencia.mjs`.
     *
     * POR QUE SE PUEDE INYECTAR. Para que ninguna prueba de este repositorio
     * llame a un modelo de verdad. Una suite que necesita red tarda, cuesta,
     * falla cuando no hay red —y lo que falla cuando no hay red se acaba
     * desactivando— y ademas no seria determinista: el fallo aparece el dia que
     * el modelo devuelve algo distinto, sin que nadie haya tocado nada.
     *
     * `null` significa «usa la de verdad», que es la del AI SDK.
     */
    fabricaDeModelo: opts.fabricaDeModelo ?? null,

    adaptadores: opts.adaptadores ?? null,
    ausenciaDeAdaptadores: opts.adaptadores
      ? null
      : {
          porque:
            "no hay ningun registro de runtimes de agente montado en este servicio: los adaptadores se " +
            "inyectan al arrancar, porque construirlos decide el binario, los hooks y el home de cada uno, y " +
            "eso depende de la maquina del operador y no de este proceso.",
          comoConseguirlo:
            "Arranca el servicio con el registro de adaptadores inyectado (`arrancar({ adaptadores })`). " +
            "Mientras tanto puedes dar de alta los agentes a mano por `POST /v1/projects/:id/agents`.",
        },

    conexiones: proveedorDeConexiones,
    // LA AUSENCIA DISTINGUE SUS DOS MOTIVOS, y mandan a sitios distintos.
    //
    // Antes habia uno solo —"aqui no se eligio ninguno"— y desde que el
    // ejecutable SI elige uno, ese texto seria falso en el caso que de verdad
    // ocurre: el adaptador que guarda tokens necesita la boveda, la boveda
    // necesita una frase de paso, y sin frase no hay adaptador. El operador que
    // lee "no se eligio ninguno" va a buscar una bandera de arranque que no
    // existe, cuando lo que le falta es la frase.
    ausenciaDeConexiones: proveedorDeConexiones
      ? null
      : !boveda && typeof opts.proveedorDeConexiones === "function"
        ? {
            porque:
              "este servicio elige el proveedor de conexiones al arrancar, y el adaptador que guarda tokens " +
              "personales necesita la boveda: " +
              (ausenciaDeLaBoveda?.porque ?? "y la boveda no esta montada."),
            comoConseguirlo:
              ausenciaDeLaBoveda?.comoConseguirlo ??
              "Monta la boveda: sin donde guardar el valor, conectar un proveedor seria pedir un token y tirarlo.",
          }
        : {
            porque:
              "no hay proveedor de conexiones montado en este servicio: el adaptador se inyecta al arrancar y " +
              "aqui no se eligio ninguno.",
            comoConseguirlo:
              "Arranca el servicio pasandole un `ConnectionProvider` construido con el adaptador que corresponda " +
              "a esta instalacion. Declarar uno de mas manda al operador a un flujo de autorizacion que no existe.",
          },

    /** Vuelve a indexar lo que hay que redactar. Obligatorio tras un alta o una rotacion. */
    async recargarRedaccion() {
      if (redactorDeLaBoveda) await redactorDeLaBoveda.cargarHuellas();
    },

    /**
     * LA ULTIMA PUERTA ANTES DEL CABLE. Todo lo que sale de este servicio pasa
     * por aqui: respuestas correctas, errores, y los eventos del canal.
     *
     * POR QUE EN UN SOLO SITIO Y NO RUTA POR RUTA. NFR-004 dice que NINGUNA
     * respuesta de NINGUN endpoint contiene el valor de una credencial, y una
     * garantia con esa forma no se sostiene revisando cuarenta manejadores: se
     * sostiene si hay un unico punto por el que todos pasan. Los dos caminos
     * que lo obligaron salieron de la prueba del centinela y ninguno de los dos
     * es rebuscado:
     *
     *   1. El operador pega una credencial en el texto de una guideline y la
     *      ruta se lo devuelve tal cual, porque devolver lo que se guardo es lo
     *      correcto en cualquier otro caso.
     *   2. La credencial viaja en la URL y el 404 la repite dentro de su causa,
     *      porque nombrar la ruta que no existe es lo que hace util a ese 404.
     *
     * Los dos son razonables y los dos filtran. Redactar a la salida los cierra
     * sin tener que elegir entre un error util y un error seguro.
     *
     * POR QUE NO FALLA CUANDO NO HAY BOVEDA. Si no hay boveda no hay ninguna
     * credencial registrada, asi que no hay ningun valor que pueda escaparse:
     * devolver el objeto tal cual no es un agujero, es el conjunto vacio. La
     * ausencia ya esta declarada en `/v1/capabilities` y en cada ruta que la
     * necesita.
     *
     * @template T
     * @param {T} valor
     * @returns {T}
     */
    redactarSalida(valor) {
      if (!redactorDeLaBoveda) return valor;
      try {
        return redactorDeLaBoveda.redactarObjeto(valor);
      } catch {
        // El redactor solo lanza si nunca se cargo, y se carga al arrancar. Si
        // aun asi pasara, lo que NO se puede hacer es devolver el objeto sin
        // redactar: eso convierte un fallo del redactor en una fuga. Se
        // devuelve la constancia de que no se pudo, que es visible y no filtra.
        return /** @type {any} */ ({
          error: {
            codigo: "redaccion_no_disponible",
            causa:
              "la respuesta no se pudo redactar contra la boveda, asi que no se envia: no hay forma de " +
              "garantizar que no lleve el valor de una credencial adentro.",
            accion:
              "Reinicia el servicio para que el redactor vuelva a cargar las huellas de la boveda, y repite la peticion.",
          },
        });
      }
    },

    /** La pieza o el error que dice por que no esta. Nunca `null` callado. */
    exigirBoveda() {
      if (boveda) return boveda;
      throw new ErrorDeServicio("pieza_ausente", { pieza: "la boveda de credenciales", ...ausenciaDeLaBoveda });
    },

    cerrar() {
      almacen.cerrar();
    },
  };
}
