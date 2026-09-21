// `ConnectionProvider`: la fachada, y las seis reglas del contrato en UN sitio.
//
// POR QUE LAS REGLAS VIVEN AQUI Y NO EN CADA ADAPTADOR. Son seis, y las seis se
// pierden igual: escribiendo el segundo adaptador y copiando el primero a
// medias. Si cada adaptador repitiera la comprobacion del modo, el recorte de
// la vigencia y la busqueda del valor en la fila, la pregunta "¿los adaptadores
// cumplen las reglas?" tendria tantas respuestas como adaptadores. Aqui tiene
// una, y lo que cada adaptador aporta es lo unico que de verdad cambia: donde
// se guarda el valor y como se pide.
//
// LA REGLA QUE GOBIERNA EL DISENO. El modo de autenticacion lo decide el
// catalogo, no quien llama. Esta verificado que dos de los proveedores
// objetivo no usan OAuth: uno se conecta con un PAT y otro con una clave de
// API. Si esta interfaz asumiera un flujo de autorizacion, el error habria
// aparecido al implementarlos, con todo construido alrededor.

import { randomUUID } from "node:crypto";

import { fallar } from "./errores.mjs";
import { congelar, crearConexion, validarEntradaDeCatalogo, MODOS_SIN_AUTORIZACION } from "./modelo.mjs";
import { repositorioEnMemoria } from "./repositorio.mjs";
import { acotarVigencia, VIGENCIA_POR_DEFECTO_MS } from "./vigencia.mjs";
import { PUERTO_DE_CALLBACK, problemaDePuertoOcupado, sondearPuertoConNet } from "./preflight.mjs";
import {
  LIMITE_DE_REPOSITORIOS,
  POR_PAGINA_POR_DEFECTO,
  filtrar,
  listaCruda,
  proyectar,
  rellenarRuta,
} from "./repositorios.mjs";

/** Las funciones que un motor de adaptador tiene que traer. Sin una, no monta. */
const FUNCIONES_DEL_MOTOR = ["requisitos", "salud", "iniciar", "guardar", "leer", "olvidar", "sondear", "llamar"];

const espera = (ms) => new Promise((listo) => setTimeout(listo, ms));

/**
 * @typedef {object} MotorDeAdaptador
 * @property {() => Array<{nombre: string, tipo: string, detalle?: string, puerto?: number}>} requisitos
 * @property {() => {arriba: boolean, causa?: string}} salud
 * @property {(ctx: any) => Promise<{handle: string, url: string, expira?: string|null, deposito?: object}>} iniciar
 * @property {(ctx: any) => Promise<{deposito?: object, etiqueta?: string|null}>} guardar
 * @property {(conexion: any, entrada: any) => Promise<{valores: Record<string,string>, expira?: string|null, vigenciaPropuestaMs?: number}>} leer
 * @property {(conexion: any) => Promise<void>} olvidar
 * @property {(handle: string, ctx: any) => Promise<null|{deposito?: object, etiqueta?: string|null, expira?: string|null}>} sondear
 * @property {(ctx: any) => Promise<{estado: number, cuerpo: any, cabeceras?: Record<string,string>}>} llamar
 */

/**
 * @param {{
 *   id: string,
 *   catalogo: readonly any[],
 *   motor: MotorDeAdaptador,
 *   repositorio?: any,
 *   reloj?: () => number,
 *   dormir?: (ms: number) => Promise<any>,
 *   puertoDeCallback?: number,
 *   sondearPuerto?: (puerto: number) => Promise<{libre: boolean, causa?: string, evidencia?: string}>,
 *   nuevoId?: () => string,
 * }} piezas
 */
export function crearProveedorDeConexiones({
  id,
  catalogo,
  motor,
  repositorio = repositorioEnMemoria(),
  reloj = () => Date.now(),
  dormir = espera,
  puertoDeCallback = PUERTO_DE_CALLBACK,
  sondearPuerto = sondearPuertoConNet,
  nuevoId = () => randomUUID(),
}) {
  if (!Array.isArray(catalogo) || catalogo.length === 0) {
    fallar(
      "catalogo_invalido",
      `el adaptador '${id}' no trae catalogo, y sin catalogo no hay forma de saber como se autentica nadie`,
      "declara al menos un proveedor externo con su modo",
    );
  }
  const problemas = [];
  for (const entrada of catalogo) {
    const r = validarEntradaDeCatalogo(entrada);
    if (!r.ok) problemas.push(`${entrada?.slug ?? "(sin slug)"}: ${r.problemas.join("; ")}`);
  }
  if (problemas.length > 0) {
    fallar(
      "catalogo_invalido",
      `el catalogo de '${id}' tiene entradas incompletas — ${problemas.join(" | ")}`,
      "completa la declaracion de esas entradas: un proveedor sin modo no falla al cargar, falla cuando alguien lo conecta y por la rama equivocada",
    );
  }
  const faltan = FUNCIONES_DEL_MOTOR.filter((f) => typeof (/** @type {any} */ (motor)?.[f]) !== "function");
  if (faltan.length > 0) {
    fallar(
      "motor_incompleto",
      `al motor del adaptador '${id}' le faltan funciones: ${faltan.join(", ")}`,
      "un motor a medias no falla al montar sino a mitad de una conexion: implementalas, aunque sea para negarse con causa",
    );
  }

  const entradas = congelar(catalogo.map((e) => ({ ...e })));
  const hayOauth2 = entradas.some((e) => e.modo === "oauth2");

  /** @param {string} slug */
  function entradaDe(slug) {
    const entrada = entradas.find((e) => e.slug === slug);
    if (!entrada) {
      fallar(
        "proveedor_desconocido",
        `el adaptador '${id}' no conoce ningun proveedor con el slug '${slug}'`,
        `usa uno de los que declara su catalogo: ${entradas.map((e) => e.slug).join(", ")}`,
      );
    }
    return entrada;
  }

  /** Corta cuando el adaptador esta caido: las conexiones nuevas fallan, las viejas no se tocan. */
  function exigirAdaptadorArriba(que) {
    const salud = motor.salud();
    if (!salud.arriba) {
      fallar(
        "adaptador_caido",
        `el adaptador '${id}' no puede ${que}: ${salud.causa ?? "no dijo por que"}`,
        "las conexiones que ya existen siguen en el inventario y se siguen viendo; para crear una nueva hay que levantar el adaptador primero",
      );
    }
  }

  /**
   * La guarda que hace que el `deposito` no sea un agujero. Es metadato opaco
   * del adaptador —referencias, identificadores— y por eso es el sitio mas
   * comodo para que se cuele un valor sin que nadie lo note: de ahi sale por
   * `listar` a una pantalla.
   *
   * @param {any} fila
   * @param {string[]} secretos
   */
  function exigirFilaSinValores(fila, secretos) {
    const texto = JSON.stringify(fila);
    for (const valor of secretos) {
      if (typeof valor === "string" && valor.length > 0 && texto.includes(valor)) {
        fallar(
          "fuga_de_valor",
          `la fila de la conexion a '${fila.slug}' contiene el valor de un campo declarado secreto`,
          "el valor va al deposito de secretos y la fila guarda solo su referencia: revisa que devuelve el motor en `deposito`",
        );
      }
    }
  }

  /**
   * @param {any} entrada
   * @param {Record<string,string>} valores
   */
  function exigirCampos(entrada, valores) {
    const declarados = entrada.campos ?? [];
    const faltantes = declarados
      .filter((c) => c.requerido !== false)
      .filter((c) => typeof valores[c.nombre] !== "string" || valores[c.nombre].length === 0)
      .map((c) => c.nombre);
    if (faltantes.length > 0) {
      fallar(
        "campos_incompletos",
        `para conectar '${entrada.slug}' faltan campos: ${faltantes.join(", ")}`,
        `completa ${faltantes.join(", ")}: el modo ${entrada.modo} no tiene flujo de autorizacion, asi que no hay de donde sacarlos`,
      );
    }
    const desconocidos = Object.keys(valores).filter((n) => !declarados.some((c) => c.nombre === n));
    if (desconocidos.length > 0) {
      fallar(
        "campos_desconocidos",
        `'${entrada.slug}' no declara estos campos: ${desconocidos.join(", ")}`,
        "un valor pegado en un campo que el proveedor no pide no llega a ningun sitio: revisa el nombre del campo",
      );
    }
  }

  /** @param {any} entrada @param {Record<string,string>} valores */
  function cabeceraDeAutorizacion(entrada, valores) {
    const auth = entrada.api?.auth;
    if (!auth) {
      fallar(
        "sin_forma_de_autorizar",
        `'${entrada.slug}' no declara como se autoriza una llamada a su API`,
        "declara `api.auth` en el catalogo, o no uses `llamar` con este proveedor",
      );
    }
    const valor = valores[auth.campo];
    if (typeof valor !== "string" || valor.length === 0) {
      fallar(
        "credencial_incompleta",
        `la conexion a '${entrada.slug}' no tiene el campo '${auth.campo}' con el que se autoriza`,
        "vuelve a conectar el proveedor: el deposito de secretos no devolvio ese campo",
      );
    }
    if (auth.tipo === "bearer") return { Authorization: `Bearer ${valor}` };
    if (auth.tipo === "basic") {
      return { Authorization: `Basic ${Buffer.from(`${auth.usuario ?? ""}:${valor}`).toString("base64")}` };
    }
    if (auth.tipo === "cabecera") return { [auth.cabecera]: valor };
    return fallar(
      "forma_de_autorizar_desconocida",
      `'${entrada.slug}' declara el tipo de autorizacion '${auth.tipo}', que no es ninguno de bearer, basic o cabecera`,
      "usa uno de los tres, o agrega el nuevo aqui y en la suite de contrato",
    );
  }

  /** Las cabeceras que vuelven a quien llamo, sin lo que las autorizo. */
  function cabecerasSinSecretos(cabeceras) {
    const limpias = {};
    for (const [k, v] of Object.entries(cabeceras ?? {})) {
      if (/authorization|cookie|token|api-key/i.test(k)) continue;
      limpias[k] = v;
    }
    return limpias;
  }

  const proveedor = {
    id,

    /**
     * Que hace falta para que esto funcione aqui y ahora. Se llama al arrancar,
     * no a mitad de una conexion.
     */
    async preflight() {
      const requisitos = [...motor.requisitos()];
      const problemasDelArranque = [];

      const salud = motor.salud();
      if (!salud.arriba) {
        problemasDelArranque.push({
          codigo: "adaptador_caido",
          causa: `el adaptador '${id}' no responde: ${salud.causa ?? "no dijo por que"}`,
          accion: "levanta el adaptador; mientras tanto las conexiones que ya existen se siguen viendo, pero no se pueden crear nuevas",
        });
      }

      // El puerto solo es un requisito si hay algun proveedor oauth2 en el
      // catalogo. Exigirselo a un adaptador que no hace OAuth seria impedirle
      // arrancar por un contrato externo que no firmo — y es justo el adaptador
      // que existe para el operador que no puede levantar la infraestructura.
      if (hayOauth2) {
        requisitos.push({
          nombre: "puerto del callback de OAuth",
          tipo: "puerto",
          puerto: puertoDeCallback,
          detalle: "registrado como redirect URI en la aplicacion OAuth de cada proveedor: no se puede reasignar",
        });
        const sondeo = await sondearPuerto(puertoDeCallback);
        if (!sondeo.libre) {
          problemasDelArranque.push(problemaDePuertoOcupado(puertoDeCallback, sondeo.causa ?? "no se pudo escuchar"));
        }
      }

      return congelar({ ok: problemasDelArranque.length === 0, requisitos, problemas: problemasDelArranque });
    },

    /** Que proveedores conoce y como se autentica cada uno. Nunca lleva valores. */
    async catalogo() {
      return entradas;
    },

    /**
     * Arranca una conexion. El modo lo decide el catalogo.
     *
     * `projectId` ADMITE `null`, Y ESO ES EL ALCANCE. `null` significa «del
     * espacio de trabajo»: la cuenta de codigo del operador es una sola, se
     * conecta una vez —incluso desde el alta de un proyecto, cuando ese
     * proyecto todavia no existe— y todos sus proyectos eligen de ahi. Mientras
     * esto no se pudo decir, la pantalla del alta remataba en un boton «Ir a un
     * proyecto y conectar»: salir a otro proyecto para poder crear este.
     *
     * OMITIRLO NO ES LO MISMO QUE PASARLO NULO, y por eso se exige declararlo.
     * `null` es una decision sobre el alcance; `undefined` es un olvido de
     * quien llama, y tratarlos igual convierte cada olvido en una conexion
     * compartida por todo el espacio de trabajo — mas alcance del que nadie
     * pidio, que es la direccion en la que un error de este tipo duele.
     *
     * @param {{projectId: string|null, slug: string, valores?: Record<string,string>}} req
     */
    async conectar(req) {
      if (!req || !("projectId" in req) || req.projectId === undefined) {
        fallar(
          "alcance_sin_declarar",
          "la peticion de conectar no dice a que pertenece la conexion",
          "pasa `projectId` con el proyecto, o `projectId: null` si es la cuenta del espacio de trabajo: `null` " +
            "es una decision sobre el alcance y omitirlo es un olvido, y no se pueden tratar igual",
        );
      }
      if (req && "modo" in req) {
        fallar(
          "modo_impuesto",
          "la peticion de conectar trae un `modo`, y el modo lo decide el catalogo",
          "quita el `modo` de la peticion: dos fuentes de verdad para el modo acaban ganando la del que llama, que es la que no sabe",
        );
      }
      const entrada = entradaDe(req.slug);
      const valores = req.valores ?? {};
      exigirAdaptadorArriba(`conectar '${req.slug}'`);

      const handle = nuevoId();
      const conexionId = nuevoId();

      if (entrada.modo === "oauth2") {
        if (Object.keys(valores).length > 0) {
          fallar(
            "valores_inesperados",
            `'${entrada.slug}' se conecta por oauth2 y la peticion trae valores pegados a mano`,
            "en oauth2 no hay campos que rellenar: el valor lo devuelve el proveedor al terminar la autorizacion",
          );
        }
        const inicio = await motor.iniciar({ entrada, projectId: req.projectId, handle, conexionId });
        const conexion = crearConexion({
          id: conexionId,
          project_id: req.projectId,
          slug: entrada.slug,
          modo: entrada.modo,
          handle: inicio.handle ?? handle,
          estado: "pendiente",
          deposito: inicio.deposito ?? {},
          expira: inicio.expira ?? null,
          ahora: reloj(),
        });
        repositorio.guardar(conexion);
        // La URL se abre en el navegador del SISTEMA, no en el webview: varios
        // proveedores bloquean webviews embebidos por politica, y una URL a
        // secas no dice donde abrirla.
        return congelar({
          handle: conexion.handle,
          url: inicio.url,
          abrir_en: "navegador_del_sistema",
          expira: inicio.expira ?? null,
        });
      }

      exigirCampos(entrada, valores);
      const secretos = (entrada.campos ?? []).filter((c) => c.secreto).map((c) => valores[c.nombre]);
      const guardado = await motor.guardar({ entrada, projectId: req.projectId, valores, conexionId, handle });

      const primerNoSecreto = (entrada.campos ?? []).find((c) => !c.secreto && valores[c.nombre]);
      const conexion = crearConexion({
        id: conexionId,
        project_id: req.projectId,
        slug: entrada.slug,
        modo: entrada.modo,
        handle,
        estado: "conectada",
        etiqueta: guardado.etiqueta ?? (primerNoSecreto ? valores[primerNoSecreto.nombre] : null),
        deposito: guardado.deposito ?? {},
        ahora: reloj(),
      });
      exigirFilaSinValores(conexion, secretos);
      repositorio.guardar(conexion);

      // Sin `url` y sin `abrir_en`: no es que sean nulos, es que no estan. Un
      // `url: null` invita a que alguien lo abra igual "por si acaso".
      return congelar({ handle, conexion });
    },

    /**
     * Espera a que la conexion se complete. Sondeo, y no por gusto: la
     * disponibilidad de avisos en la edicion gratuita del adaptador alojado
     * lleva meses sin aclararse, y ademas exigirian un servidor escuchando en
     * la maquina del operador.
     *
     * @param {string} handle
     * @param {{timeoutMs?: number, intervaloMs?: number}} [opts]
     */
    async esperarConexion(handle, opts = {}) {
      const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
      const intervaloMs = opts.intervaloMs ?? 1000;
      const inicio = reloj();

      for (;;) {
        const conexion = repositorio.porHandle(handle);
        if (!conexion) {
          fallar(
            "handle_desconocido",
            `no hay ninguna conexion en curso con el handle '${handle}'`,
            "vuelve a llamar a `conectar`: el handle sale de ahi y no sobrevive a un reinicio del servicio",
          );
        }
        if (conexion.estado === "conectada") return conexion;
        if (conexion.estado === "revocada") {
          fallar(
            "conexion_revocada",
            `la conexion ${conexion.id} fue revocada mientras se esperaba su autorizacion`,
            "vuelve a conectarla desde la pantalla de conexiones",
          );
        }

        const novedad = await motor.sondear(handle, { entrada: entradaDe(conexion.slug), conexion });
        if (novedad) {
          const lista = congelar({
            ...conexion,
            estado: "conectada",
            conectadaEn: new Date(reloj()).toISOString(),
            etiqueta: novedad.etiqueta ?? conexion.etiqueta,
            deposito: novedad.deposito ?? conexion.deposito,
            expira: novedad.expira ?? conexion.expira,
          });
          repositorio.guardar(lista);
          return lista;
        }

        if (reloj() - inicio >= timeoutMs) {
          fallar(
            "espera_agotada",
            `pasaron ${Math.round(timeoutMs / 1000)}s y el handle '${handle}' sigue sin autorizar`,
            "abre otra vez el enlace en el navegador del sistema y completa la autorizacion; si el navegador no llego a abrirse, copia la URL a mano",
          );
        }
        await dormir(intervaloMs);
      }
    },

    /**
     * Credenciales para inyectar a un subproceso. Se piden justo antes de
     * lanzar, y no se cachean: lo que se sostiene es el valor que ya esta fuera
     * del servicio, durante `vigencia_ms`. Aqui no queda nada.
     *
     * @param {string} conexionId
     */
    async credenciales(conexionId) {
      const conexion = exigirConectada(conexionId);
      const entrada = entradaDe(conexion.slug);
      const lectura = await motor.leer(conexion, entrada);

      const valores = {};
      for (const [campo, valor] of Object.entries(lectura.valores ?? {})) {
        const variable = entrada.entorno[campo];
        if (!variable) {
          fallar(
            "valor_sin_variable",
            `'${entrada.slug}' devolvio el campo '${campo}' y el catalogo no declara con que variable se inyecta`,
            "declara la variable en `entorno`, o deja de devolver ese campo: un valor sin nombre no se puede inyectar y se acaba pasando por argv",
          );
        }
        valores[variable] = valor;
      }

      return congelar({
        valores,
        vigencia_ms: acotarVigencia(lectura.vigenciaPropuestaMs ?? VIGENCIA_POR_DEFECTO_MS),
        expira: lectura.expira ?? conexion.expira ?? null,
      });
    },

    /**
     * Llamada a la API del proveedor sin materializar el token del lado de
     * quien llama: el valor entra en la cabecera y no vuelve en la respuesta.
     *
     * @param {{conexionId: string, metodo?: string, ruta: string, cuerpo?: any, cabeceras?: Record<string,string>}} req
     */
    async llamar(req) {
      const conexion = exigirConectada(req.conexionId);
      const entrada = entradaDe(conexion.slug);
      const lectura = await motor.leer(conexion, entrada);

      const respuesta = await motor.llamar({
        entrada,
        conexion,
        metodo: req.metodo ?? "GET",
        ruta: req.ruta,
        cuerpo: req.cuerpo,
        cabeceras: { ...(req.cabeceras ?? {}), ...cabeceraDeAutorizacion(entrada, lectura.valores ?? {}) },
      });

      return congelar({
        estado: respuesta.estado,
        cuerpo: respuesta.cuerpo,
        cabeceras: cabecerasSinSecretos(respuesta.cabeceras),
      });
    },

    /**
     * Los repositorios que esta conexion alcanza.
     *
     * POR QUE VIVE EN LA FACHADA Y NO EN UN MODULO QUE HABLE CON LA FORJA. La
     * pregunta es la misma tenga detras un token personal o una autorizacion
     * delegada: cambia QUIEN guarda la credencial, no que repositorios alcanza.
     * Con el listado aqui, el dia que entre el adaptador alojado la MISMA
     * pantalla sirve; con el listado pegado a la forja, ese dia se reescribe.
     *
     * Y LO QUE ESTO PROTEGE DE PASO. Va por `llamar`, que es el camino que mete
     * la credencial en la cabecera y no la devuelve. Si el listado lo hiciera
     * quien dibuja la pantalla, necesitaria el valor del token del lado del
     * cliente — y esa es la regla que este paquete no rompe.
     *
     * @param {string} conexionId
     * @param {{texto?: string, limite?: number, pagina?: number, porPagina?: number}} [opciones]
     */
    async repositorios(conexionId, opciones = {}) {
      const conexion = exigirConectada(conexionId);
      const entrada = entradaDe(conexion.slug);
      const declaracion = entrada.repos;
      if (!declaracion || typeof declaracion.ruta !== "string") {
        fallar(
          "sin_listado_de_repositorios",
          `'${entrada.slug}' no declara como se listan los repositorios que alcanza`,
          "declara `repos` en su entrada del catalogo —la ruta y de que campo crudo sale cada campo del contrato—, o elige el repositorio en un proveedor que si lo declare",
        );
      }

      /** Un entero positivo, o el valor por defecto. */
      const entero = (valor, porDefecto) =>
        typeof valor === "number" && Number.isInteger(valor) && valor > 0 ? valor : porDefecto;

      const pagina = entero(opciones.pagina, 1);
      const porPagina = Math.min(entero(opciones.porPagina, POR_PAGINA_POR_DEFECTO), POR_PAGINA_POR_DEFECTO);
      const limite = entero(opciones.limite, LIMITE_DE_REPOSITORIOS);

      const respuesta = await proveedor.llamar({
        conexionId,
        metodo: "GET",
        ruta: rellenarRuta(declaracion.ruta, { pagina, por_pagina: porPagina }),
      });

      if (respuesta.estado >= 400) {
        // EL MENSAJE DEL PROVEEDOR VIAJA DENTRO DE LA CAUSA, y es lo unico util
        // que hay cuando falla del otro lado: un 401 que solo dice "no se pudo
        // listar" manda a revisar la red, y lo que pasa es que el token no
        // tiene el permiso de leer repositorios. El valor de la credencial no
        // esta aqui: `llamar` lo pone en la cabecera y no lo devuelve.
        const mensaje =
          (respuesta.cuerpo && typeof respuesta.cuerpo === "object" && respuesta.cuerpo.message) ||
          (typeof respuesta.cuerpo === "string" ? respuesta.cuerpo : "") ||
          "sin mensaje";
        fallar(
          "listado_rechazado",
          `'${entrada.slug}' rechazo el listado de repositorios con estado ${respuesta.estado}: ${mensaje}`,
          "comprueba que la credencial de esta conexion sigue vigente y que su permiso alcanza a leer repositorios; si caduco, vuelve a conectarla desde la pantalla de conexiones",
        );
      }

      const crudos = listaCruda(respuesta.cuerpo, declaracion.lista, entrada.slug);
      const filtrados = filtrar(crudos.map((r) => proyectar(r, declaracion.campos ?? {})), opciones.texto ?? "");
      const items = filtrados.slice(0, limite);

      return congelar({
        // `total` es el del filtro entero y no el de la pagina: una pantalla
        // que dice "50" cuando hay 120 hace que el operador deje de buscar el
        // suyo y lo escriba a mano, que es de lo que veniamos.
        total: filtrados.length,
        mostrados: items.length,
        hay_mas: filtrados.length > items.length,
        limite,
        pagina,
        por_pagina: porPagina,
        items,
      });
    },

    /** @param {string} conexionId */
    async revocar(conexionId) {
      const conexion = repositorio.porId(conexionId);
      if (!conexion) {
        fallar(
          "conexion_desconocida",
          `no hay ninguna conexion con el id ${conexionId}`,
          "comprueba el id en la pantalla de conexiones",
        );
      }
      if (conexion.estado === "revocada") return;

      // La fila se marca ANTES de borrar el valor. Si se hiciera al reves y el
      // borrado fallara, quedaria una conexion que la pantalla muestra como
      // viva y que sigue entregando credenciales.
      const revocada = congelar({ ...conexion, estado: "revocada", revocadaEn: new Date(reloj()).toISOString() });
      repositorio.guardar(revocada);

      try {
        await motor.olvidar(conexion);
      } catch (e) {
        fallar(
          "revocacion_incompleta",
          `la conexion ${conexionId} quedo revocada, pero el valor no se pudo borrar del deposito: ${e?.message ?? e}`,
          "la conexion ya no entrega credenciales; borra el valor a mano del deposito de secretos cuando vuelva a responder",
        );
      }
    },

    /**
     * Inventario del proyecto. Nunca lleva valores: hay una prueba que lo mide.
     *
     * `listar(null)` devuelve las del ESPACIO DE TRABAJO, no todas. Es la misma
     * pregunta con el mismo alcance que se le paso a `conectar`, y mezclarlas
     * aqui haria que la pantalla del alta enseñara como suyas las cuentas de
     * otros proyectos.
     */
    async listar(projectId = undefined) {
      if (projectId === undefined) {
        fallar(
          "alcance_sin_declarar",
          "listar no dice de que alcance quiere las conexiones",
          "pasa el `projectId`, o `null` para las del espacio de trabajo",
        );
      }
      return congelar(repositorio.porProyecto(projectId));
    },
  };

  /** @param {string} conexionId */
  function exigirConectada(conexionId) {
    const conexion = repositorio.porId(conexionId);
    if (!conexion) {
      fallar(
        "conexion_desconocida",
        `no hay ninguna conexion con el id ${conexionId}`,
        "comprueba el id en la pantalla de conexiones: pudo borrarse, o ser de otro proyecto",
      );
    }
    if (conexion.estado === "revocada") {
      fallar(
        "conexion_revocada",
        `la conexion ${conexionId} a '${conexion.slug}' fue revocada el ${conexion.revocadaEn}`,
        "vuelve a conectar el proveedor desde la pantalla de conexiones",
      );
    }
    if (conexion.estado !== "conectada") {
      fallar(
        "conexion_pendiente",
        `la conexion ${conexionId} a '${conexion.slug}' sigue esperando que alguien complete la autorizacion`,
        "termina la autorizacion en el navegador del sistema, o espera con `esperarConexion` antes de pedir la credencial",
      );
    }
    return conexion;
  }

  return proveedor;
}
