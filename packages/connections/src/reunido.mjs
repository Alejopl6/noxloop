// Los dos caminos montados a la vez, repartidos por el modo del catalogo.
//
// -----------------------------------------------------------------------------
// EL FALLO QUE ESTE ARCHIVO IMPIDE
// -----------------------------------------------------------------------------
//
// El servicio monta UN proveedor de conexiones —`dependencias.mjs` guarda uno,
// `capacidades` publica su `id`, y la pantalla compara
// `entrada.adaptador === adaptadorMontado` para decidir que se puede conectar.
//
// Con el adaptador alojado montado a secas, el operador que levanta los
// contenedores para poder usar OAuth PIERDE de la pantalla Azure DevOps, Vercel
// y el GitHub de token personal: tres de los ocho proveedores del catalogo, y
// los unicos que funcionaban hasta que el hueco del alojado se lleno.
//
// Eso convierte una mejora en una regresion, y contradice lo que se pidio con
// todas las letras: el token personal deja de ser el camino por DEFECTO y pasa
// a ser LA ALTERNATIVA para quien no quiera contenedores. Una alternativa que
// desaparece de la pantalla en cuanto llega la opcion principal no es una
// alternativa.
//
// -----------------------------------------------------------------------------
// POR QUE REPARTE POR EL MODO Y NO POR PREFERENCIA
// -----------------------------------------------------------------------------
//
// Es la misma regla que gobierna el paquete entero: el modo lo decide el
// catalogo, no quien llama. Cada adaptador declara que proveedores atiende; si
// dos declaran el mismo, gana el primero de la lista, y eso se decide al montar
// —una vez, por quien cablea— y no en cada llamada.
//
// -----------------------------------------------------------------------------
// POR QUE NO HAY UN REPOSITORIO COMPARTIDO
// -----------------------------------------------------------------------------
//
// Cada adaptador guarda sus conexiones en el suyo. El reunido no las copia: las
// junta al leer y, para las operaciones por identificador, busca en cual de los
// dos esta. Un repositorio comun obligaria a que los dos adaptadores lo
// aceptaran inyectado y a que nadie escribiera nunca por su cuenta, que es una
// disciplina que se pierde al tercer adaptador.

import { fallar } from "./errores.mjs";
import { congelar } from "./modelo.mjs";

/** Los metodos que se delegan tal cual al adaptador que atiende el slug. */
const POR_SLUG = ["conectar"];

/** Los metodos que se delegan al adaptador que TIENE esa conexion. */
const POR_ID = ["credenciales", "llamar", "revocar", "repositorios"];

/**
 * @param {{adaptadores: any[]}} piezas
 * @returns {any}
 */
export function crearProveedorReunido({ adaptadores }) {
  const montados = (adaptadores ?? []).filter(Boolean);
  if (montados.length === 0) {
    fallar(
      "sin_adaptadores",
      "el proveedor reunido se monto sin ningun adaptador, y sin adaptadores no hay ninguna conexion que se pueda crear ni mirar",
      "pasale al menos uno: el `local` no necesita nada levantado, y es el que hace que el producto siga entero sin contenedores",
    );
  }
  // REUNIR UNO SOLO NO APORTA NADA Y SI QUITA. El adaptador alojado trae
  // `aplicaciones()` y `registrarAplicacion()`, que no estan en el contrato;
  // un envoltorio generico se los comeria y la pantalla del registro se
  // quedaria sin datos sin que nada fallara.
  if (montados.length === 1) return montados[0];

  /** El catalogo de cada adaptador, cacheado: es dato declarado y no cambia. */
  let catalogoReunido = null;

  async function catalogoDe(adaptador) {
    return (await adaptador.catalogo()) ?? [];
  }

  /** Quien atiende cada slug. El primero que lo declara gana. */
  async function duenoDe(slug) {
    for (const adaptador of montados) {
      const catalogo = await catalogoDe(adaptador);
      if (catalogo.some((e) => e.slug === slug)) return adaptador;
    }
    const todos = [];
    for (const adaptador of montados) todos.push(...(await catalogoDe(adaptador)).map((e) => e.slug));
    fallar(
      "proveedor_desconocido",
      `ninguno de los adaptadores montados (${montados.map((a) => a.id).join(", ")}) conoce el slug '${slug}'`,
      `usa uno de los que declaran: ${[...new Set(todos)].join(", ")}`,
    );
  }

  /**
   * En cual de los adaptadores vive esta conexion.
   *
   * SE PREGUNTA EN VEZ DE RECORDARSE, y es a proposito: un indice de id a
   * adaptador seria un tercer sitio donde vive la verdad, y se desincroniza el
   * dia que una conexion se cree sin pasar por aqui.
   *
   * SE PREGUNTA CON `tiene()` Y NO CON `listar()`, y eso lo midio una prueba:
   * `listar(null)` solo devuelve las del espacio de trabajo, asi que buscar por
   * ahi daba `conexion_desconocida` sobre conexiones de PROYECTO que existian
   * perfectamente. Quien tiene un id no tiene el proyecto: si lo tuviera, no
   * haria falta buscar.
   */
  async function conLaConexion(conexionId) {
    for (const adaptador of montados) {
      if (typeof adaptador.tiene === "function" && adaptador.tiene(conexionId)) return adaptador;
    }
    return null;
  }

  const reunido = {
    // El principal es el primero de la lista: es el que la pantalla compara
    // contra `entrada.adaptador`, y por eso `ids` viaja tambien — con dos
    // montados, un solo nombre esconde la mitad de lo que se puede conectar.
    id: montados[0].id,
    ids: montados.map((a) => a.id),

    /** El catalogo de todos, cada entrada diciendo quien la atiende. */
    async catalogo() {
      if (catalogoReunido) return catalogoReunido;
      const vistos = new Set();
      const juntas = [];
      for (const adaptador of montados) {
        for (const entrada of await catalogoDe(adaptador)) {
          if (vistos.has(entrada.slug)) continue;
          vistos.add(entrada.slug);
          juntas.push({ ...entrada, adaptador: adaptador.id });
        }
      }
      catalogoReunido = congelar(juntas);
      return catalogoReunido;
    },

    /**
     * Los requisitos y los problemas de todos, con el nombre de a quien le
     * pasan. Sin ese nombre, «el puerto 3003 esta ocupado» con dos adaptadores
     * montados no dice a cual hay que arreglarle nada.
     */
    async preflight() {
      const requisitos = [];
      const problemas = [];
      for (const adaptador of montados) {
        const estado = await adaptador.preflight();
        for (const r of estado.requisitos ?? []) requisitos.push({ ...r, adaptador: adaptador.id });
        for (const p of estado.problemas ?? []) problemas.push({ ...p, adaptador: adaptador.id });
      }
      return congelar({ ok: problemas.length === 0, requisitos, problemas });
    },

    /** El inventario de todos, en una lista. */
    async listar(projectId = undefined) {
      if (projectId === undefined) {
        fallar(
          "alcance_sin_declarar",
          "listar no dice de que alcance quiere las conexiones",
          "pasa el `projectId`, o `null` para las del espacio de trabajo",
        );
      }
      const juntas = [];
      for (const adaptador of montados) juntas.push(...(await adaptador.listar(projectId)));
      return congelar(juntas);
    },

    /**
     * Espera a que una conexion se complete. Va por HANDLE, y el handle solo lo
     * conoce el adaptador que abrio el flujo: se pregunta a los dos y se queda
     * el que no diga `handle_desconocido`.
     */
    async esperarConexion(handle, opciones) {
      const fallos = [];
      for (const adaptador of montados) {
        try {
          return await adaptador.esperarConexion(handle, opciones);
        } catch (e) {
          if (e?.codigo === "handle_desconocido") {
            fallos.push(adaptador.id);
            continue;
          }
          // Cualquier otro fallo ES la respuesta: el adaptador reconocio el
          // handle y algo salio mal. Seguir preguntando al siguiente
          // convertiria «la autorizacion caduco» en «no existe ese handle».
          throw e;
        }
      }
      fallar(
        "handle_desconocido",
        `no hay ninguna conexion en curso con el handle '${handle}' en ninguno de los adaptadores montados (${fallos.join(", ")})`,
        "vuelve a llamar a `conectar`: el handle sale de ahi y no sobrevive a un reinicio del servicio",
      );
    },
  };

  for (const metodo of POR_SLUG) {
    reunido[metodo] = async (req) => {
      if (!req || typeof req.slug !== "string") {
        fallar(
          "proveedor_sin_declarar",
          `la peticion de ${metodo} no dice a que proveedor va`,
          "pasa el `slug` del proveedor: con dos adaptadores montados, es lo que decide cual lo atiende",
        );
      }
      const adaptador = await duenoDe(req.slug);
      return await adaptador[metodo](req);
    };
  }

  for (const metodo of POR_ID) {
    reunido[metodo] = async (primero, ...resto) => {
      // `llamar` recibe un objeto con `conexionId`; el resto, el id suelto.
      const conexionId = typeof primero === "string" ? primero : primero?.conexionId;
      const adaptador = await conLaConexion(conexionId);
      if (!adaptador) {
        fallar(
          "conexion_desconocida",
          `no hay ninguna conexion con el id ${conexionId} en ninguno de los adaptadores montados (${reunido.ids.join(", ")})`,
          "comprueba el id en la pantalla de conexiones: pudo borrarse, o ser de otro proyecto",
        );
      }
      return await adaptador[metodo](primero, ...resto);
    };
  }

  // Lo que solo trae el adaptador alojado —el registro de las aplicaciones
  // OAuth— se expone desde el que lo tenga. No es parte del contrato: es lo
  // que hace falta para que el unico paso manual este guiado, y esconderlo
  // detras del envoltorio dejaria la pantalla del registro sin datos.
  const conAplicaciones = montados.find((a) => typeof a.aplicaciones === "function");
  if (conAplicaciones) {
    reunido.aplicaciones = (...args) => conAplicaciones.aplicaciones(...args);
    reunido.registrarAplicacion = (...args) => conAplicaciones.registrarAplicacion(...args);
    reunido.servidor = conAplicaciones.servidor;
  }

  return reunido;
}
