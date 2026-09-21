// Credenciales, grants, auditoria y conexiones.
//
// LA REGLA QUE ATRAVIESA TODO ESTE ARCHIVO. Ninguna respuesta de ninguna ruta
// —ni siquiera un mensaje de error, ni una traza— contiene el valor de una
// credencial. No se cumple con disciplina: se cumple porque el unico camino que
// devuelve un valor es `boveda.recuperar`, y este archivo NO LA LLAMA. Recuperar
// es para inyectar en el entorno de un subproceso, y eso lo hace el motor
// cuando lanza. La prueba no se escribe sobre la intencion: hay una que recorre
// todas las rutas con un centinela dentro y busca el centinela en la respuesta
// serializada.
//
// POR QUE LA AUDITORIA SOLO SE LEE. FR-049: no existe `POST`, ni `PATCH`, ni
// `DELETE`. La tabla de rutas lo declara con un solo metodo, y ahi es donde el
// invariante vive — no en un `if` que deniega. Una ruta que existe y deniega es
// una ruta que alguien puede hacer que no deniegue.
//
// POR QUE LOS GRANTS PIDEN `concedido_por`. Siempre una persona. Un grant
// concedido "por el sistema" no se le puede preguntar a nadie cuando haya que
// explicar por que ese agente tenia acceso a esa credencial.

import { randomUUID } from "node:crypto";

import { coleccion, exigir, exigirProyecto, limiteDe, noEsta } from "./comun.mjs";
import { ErrorDeServicio } from "./errores.mjs";

/** Lo que este servicio NO tiene, dicho con su causa y su accion. */
function exigirConexiones(dep) {
  if (dep.conexiones) return dep.conexiones;
  throw new ErrorDeServicio("pieza_ausente", { pieza: "el proveedor de conexiones", ...dep.ausenciaDeConexiones });
}

// ---------------------------------------------------------------------------
// Credenciales
// ---------------------------------------------------------------------------

/** @param {import("./rutas.mjs").Peticion} p */
export async function inventario(p) {
  if (p.metodo === "GET") {
    // Sale del almacen y no de la boveda a proposito: la fila del inventario
    // NO TIENE campo para el valor —la estructura no lo declara— asi que este
    // camino no puede filtrarlo ni por descuido.
    return { cuerpo: coleccion(p.dep.almacen.boveda.credenciales()) };
  }

  const boveda = p.dep.exigirBoveda();
  const cuerpo = await p.cuerpo();
  exigir(
    cuerpo,
    ["nombre", "proveedor", "tipo", "alcance_declarado", "valor"],
    "`alcance_declarado` es lo que el operador DICE que esta credencial permite hacer: sin eso, la vista " +
      "inversa muestra quien la alcanza y nadie sabe que significa alcanzarla.",
  );

  const { credencial, huella } = await boveda.registrar({
    workspace: p.dep.workspace.id,
    nombre: cuerpo.nombre,
    proveedor: cuerpo.proveedor,
    tipo: cuerpo.tipo,
    ambito: cuerpo.ambito ?? (cuerpo.project_id ? "proyecto" : "global"),
    project_id: cuerpo.project_id ?? null,
    alcance_declarado: cuerpo.alcance_declarado,
    valor: cuerpo.valor,
  });

  // El redactor tiene que conocer el valor nuevo ANTES de que nada mas se
  // persista: si no, el primer evento de auditoria que lo mencione sale crudo.
  await p.dep.recargarRedaccion();

  // La respuesta lleva la HUELLA y la fila del inventario. La fila no tiene
  // campo `valor`: no es que se omita, es que no existe.
  return { codigo: 201, cuerpo: { credencial, huella } };
}

/**
 * @param {any} dep
 * @param {string} id
 */
function credencialPorId(dep, id) {
  const credencial = dep.almacen.boveda.credencialPorId(id);
  if (!credencial) throw noEsta("credencial", id, "`GET /v1/credentials`");
  return credencial;
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function rotar(p) {
  const boveda = p.dep.exigirBoveda();
  const credencial = credencialPorId(p.dep, p.parametros.id);
  const cuerpo = await p.cuerpo();
  exigir(cuerpo, ["valor"]);

  // FR-047: rotar es guardar un valor nuevo sobre la MISMA fila. Implementarlo
  // como borrar + registrar se lleva los grants por delante, y el efecto
  // medible de eso no es que se pierdan permisos: es que nadie rota.
  const { huella } = await boveda.rotar(credencial.ref_boveda, cuerpo.valor);
  await p.dep.recargarRedaccion();

  const actualizada = p.dep.almacen.boveda.credencialPorId(credencial.id);
  return { cuerpo: { credencial: actualizada, huella, grants_conservados: true } };
}

/**
 * Un grant con el agente, el proyecto y la credencial DENTRO.
 *
 * POR QUE COMPLETO Y NO UNA LISTA DE IDENTIFICADORES CON TABLAS AL LADO. A la
 * escala de este producto —un operador, veinte proyectos— normalizar la
 * respuesta no ahorra nada: traslada el trabajo de unir al cliente, y lo hace
 * en doce sitios en vez de en uno. Y la pregunta que esta ruta responde no se
 * puede contestar con ids: "quien puede tocar esta credencial" leido en una
 * pantalla con seis UUID no es una respuesta.
 *
 * La credencial va sin su valor, como todo en este archivo: la fila del
 * inventario NO TIENE campo para el valor.
 *
 * @param {any} dep
 * @param {any} grant
 */
function completar(dep, grant) {
  return {
    ...grant,
    agente: dep.almacen.agentes.porId(grant.agent_id),
    proyecto: dep.almacen.proyectos.porId(grant.project_id),
    credencial: dep.almacen.boveda.credencialPorId(grant.credential_id),
  };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function reach(p) {
  const credencial = credencialPorId(p.dep, p.parametros.id);
  // FR-045, la vista INVERSA: dada una credencial, que agentes y que proyectos
  // la alcanzan HOY. La vigencia se mira en este instante y no al conceder:
  // entre una cosa y la otra pudo haber una revocacion, y una pantalla que
  // muestra los grants revocados como vivos es ruido — el operador deja de
  // mirarla, que es peor que no tenerla.
  const alcance = p.dep.almacen.boveda.alcance({ credential_id: credencial.id }, Date.now());
  return {
    cuerpo: coleccion(
      alcance.grants.map((/** @type {any} */ g) => completar(p.dep, g)),
      {},
      { credencial: { id: credencial.id, nombre: credencial.nombre, huella: credencial.huella } },
    ),
  };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function revocarCredencial(p) {
  const boveda = p.dep.exigirBoveda();
  const credencial = credencialPorId(p.dep, p.parametros.id);

  // Se borra del backend y del inventario. Los grants se van por cascada: un
  // grant que sobrevive a su credencial autoriza contra nada y aparece en la
  // vista inversa de un id que ya no existe. El RASTRO no se pierde — vive en
  // la auditoria, que no cuelga de ninguna clave foranea justo por esto.
  await boveda.borrar(credencial.ref_boveda);
  await p.dep.recargarRedaccion();

  return { cuerpo: { revocada: credencial.id, nombre: credencial.nombre, rastro: "en `GET /v1/audit`" } };
}

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

/** @param {import("./rutas.mjs").Peticion} p */
export async function grants(p) {
  if (p.metodo === "GET") {
    const criterio = {};
    for (const campo of ["credential_id", "project_id", "agent_id"]) {
      const valor = p.url.searchParams.get(campo);
      if (valor) criterio[campo] = valor;
    }
    const soloVigentes = p.url.searchParams.get("vigentes") !== "no";
    const crudos = soloVigentes
      ? p.dep.almacen.boveda.alcance(criterio, Date.now()).grants
      : p.dep.almacen.boveda.grants().filter((/** @type {any} */ g) =>
          Object.entries(criterio).every(([campo, valor]) => g[campo] === valor),
        );

    return { cuerpo: coleccion(crudos.map((/** @type {any} */ g) => completar(p.dep, g)), {}, { vigentes: soloVigentes }) };
  }

  const boveda = p.dep.exigirBoveda();
  const cuerpo = await p.cuerpo();
  exigir(
    cuerpo,
    ["project_id", "agent_id", "credential_id", "concedido_por"],
    "`concedido_por` es siempre una persona: un grant concedido por el sistema no se le puede preguntar a nadie.",
  );

  exigirProyecto(p.dep, cuerpo.project_id);
  if (!p.dep.almacen.agentes.porId(cuerpo.agent_id)) {
    throw noEsta("agente", cuerpo.agent_id, "`GET /v1/projects/:id/agents`");
  }
  credencialPorId(p.dep, cuerpo.credential_id);

  // LA COSTURA ENTRE LOS DOS PAQUETES, Y ES UN HUECO REAL. `data-model.md`
  // exige `concedido_por` en todo grant —siempre una persona, porque un grant
  // concedido por el sistema no se le puede preguntar a nadie— y el `Grant` de
  // `packages/vault` no tiene ese campo: `crearGrant` construye un objeto
  // congelado con siete campos fijos y descarta lo que no reconoce. Pasarselo a
  // `otorgar` no sirve de nada: se pierde antes de llegar al repositorio.
  //
  // Asi que la fila se escribe primero desde aqui, CON su autor, y despues se
  // llama a `otorgar` con el mismo `id`. El repositorio del almacen hace
  // `UPSERT` por `id` y solo actualiza la vigencia, asi que el autor sobrevive
  // — y la llamada a `otorgar` sigue siendo la que escribe el evento de
  // auditoria, que es lo que no se puede saltar.
  //
  // Lo correcto es que `crearGrant` acepte el campo. Va en el informe con su
  // diff; mientras tanto, esto no inventa ningun dato.
  const id = randomUUID();
  const ahora = new Date().toISOString();
  p.dep.almacen.boveda.guardarGrant({
    id,
    project_id: cuerpo.project_id,
    agent_id: cuerpo.agent_id,
    credential_id: cuerpo.credential_id,
    vigencia_desde: ahora,
    vigencia_hasta: cuerpo.vigencia_hasta ?? null,
    concedido_por: cuerpo.concedido_por,
    concedido_en: ahora,
    revocado_en: null,
  });

  const otorgado = await boveda.otorgar({
    id,
    project_id: cuerpo.project_id,
    agent_id: cuerpo.agent_id,
    credential_id: cuerpo.credential_id,
    // `crearGrant` descartaba este campo en silencio: no estaba en sus
    // parametros, asi que quien lo mandaba lo veia desaparecer. Ya lo acepta y
    // lo exige, asi que el autor viaja hasta la fila y el envoltorio de abajo
    // deja de hacer falta para conservarlo.
    concedido_por: cuerpo.concedido_por,
    vigenciaHasta: cuerpo.vigencia_hasta ?? null,
  });

  return { codigo: 201, cuerpo: { grant: p.dep.almacen.boveda.grantPorId(otorgado.id) } };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function revocarGrant(p) {
  const boveda = p.dep.exigirBoveda();
  if (!p.dep.almacen.boveda.grantPorId(p.parametros.id)) {
    throw noEsta("grant", p.parametros.id, "`GET /v1/grants`");
  }
  const revocado = await boveda.revocar(p.parametros.id);
  return { cuerpo: { grant: revocado } };
}

// ---------------------------------------------------------------------------
// Auditoria — SOLO LECTURA (FR-049)
// ---------------------------------------------------------------------------

/**
 * Los filtros que `/v1/audit` sabe honrar, y como se traduce cada uno.
 *
 * POR QUE SE DECLARAN EN UNA TABLA Y NO EN UNA CADENA DE `if`. Porque la
 * respuesta tiene que decir CUALES honro, y eso no se reconstruye desde una
 * cadena de condiciones que ya decidio. Un parametro que el servicio no
 * reconoce se IGNORA —no falla— y por eso hace falta declararlo: sin
 * `filtros_aplicados`, la interfaz enseñaria filas que no cumplen el filtro
 * recien escrito y el operador creeria estar viendo un subconjunto que no es.
 * En una pantalla de auditoria eso es peor que no filtrar.
 *
 * @type {Record<string, {sql: string, valor: (v: string) => any}>}
 */
const FILTROS_DE_AUDITORIA = {
  desde: { sql: "instante >= ?", valor: (v) => v },
  hasta: { sql: "instante <= ?", valor: (v) => v },
  actor: { sql: "actor = ?", valor: (v) => v },
  // Prefijo a proposito: `accion=grant.` trae todas las de grants sin que la
  // interfaz tenga que conocer la lista de acciones que existen.
  accion: { sql: "accion LIKE ?", valor: (v) => `${v}%` },
  objeto_tipo: { sql: "objeto_tipo = ?", valor: (v) => v },
  objeto_id: { sql: "objeto_id = ?", valor: (v) => v },
  resultado: { sql: "resultado = ?", valor: (v) => v },
};

/** @param {import("./rutas.mjs").Peticion} p */
export async function auditoria(p) {
  const condiciones = [];
  const parametros = [];
  /** @type {Record<string, string>} */
  const aplicados = {};

  for (const [nombre, filtro] of Object.entries(FILTROS_DE_AUDITORIA)) {
    const crudo = p.url.searchParams.get(nombre);
    if (!crudo) continue;
    condiciones.push(filtro.sql);
    parametros.push(filtro.valor(crudo));
    aplicados[nombre] = crudo;
  }

  // El cursor es el `id` del ultimo evento devuelto. Va hacia atras porque la
  // pagina se lee de lo mas nuevo a lo mas viejo, y el id de esta tabla solo
  // crece: no hay forma de que una pagina se salte una fila insertada en medio.
  const cursor = p.url.searchParams.get("cursor");
  if (cursor && /^\d+$/.test(cursor)) {
    condiciones.push("id < ?");
    parametros.push(Number(cursor));
    aplicados.cursor = cursor;
  }

  const limite = limiteDe(p.url, 200);
  const donde = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  // Se piden `limite + 1` para saber si hay pagina siguiente sin contar la
  // tabla entera: la fila de mas se descarta y su existencia ES la respuesta.
  const filas = p.dep.almacen.base.consultar(`SELECT * FROM audit_event ${donde} ORDER BY id DESC LIMIT ?`, [
    ...parametros,
    limite + 1,
  ]);

  const hayMas = filas.length > limite;
  const pagina = hayMas ? filas.slice(0, limite) : filas;
  const items = pagina.map((/** @type {any} */ e) => ({ ...e, detalle: JSON.parse(String(e.detalle)) }));

  return {
    cuerpo: coleccion(
      items,
      { cursor: hayMas ? String(pagina[pagina.length - 1].id) : null },
      {
        // Los parametros que el servicio NO reconoce no estan aqui, y esa
        // ausencia es el dato: quien filtro por algo que no existe lo ve.
        filtros_aplicados: aplicados,
        filtros_disponibles: [...Object.keys(FILTROS_DE_AUDITORIA), "cursor", "limite"],
        // La verificacion viaja con la lectura y no en una ruta aparte: una
        // auditoria que hay que acordarse de verificar no se verifica. Si la
        // cadena esta rota, la pantalla que muestra los eventos tiene que poder
        // decirlo en el mismo sitio donde los muestra.
        cadena: p.dep.almacen.auditoria.verificarCadena(),
        limite,
      },
    ),
  };
}

// ---------------------------------------------------------------------------
// Conexiones
// ---------------------------------------------------------------------------
//
// LA COSTURA DE LA ETAPA 06, Y POR QUE SE TRADUCE AQUI.
//
// `packages/connections` guarda sus conexiones en un repositorio EN MEMORIA y
// las llama `pendiente | conectada | revocada`. La guarda `conexion_viva` de
// `packages/store` cuenta filas de la tabla `connection` con `estado = 'viva'`.
// Son dos vocabularios y dos almacenes, y hasta que esto existio el resultado
// medido era: `authorize` + `callback` devolvian 201 y 200, la conexion
// funcionaba, y `artefactos().conexion_viva` seguia diciendo "este proyecto no
// tiene ninguna conexion" — el proyecto se quedaba en `BOOTSTRAPPED` sin que
// nada fallara, que es la peor forma de fallar.
//
// POR QUE EN EL SERVICIO Y NO EN UN ADAPTADOR DE ALMACEN DENTRO DE
// `packages/connections`. Ese sitio es mas limpio de nombrar —hasta hay un
// `TODO(persistencia)` en su `repositorio.mjs` pidiendolo— y esta CERRADO por
// tres cosas medibles, no por gusto:
//
//   1. `packages/connections/test/paquete-autocontenido.test.mjs` prohibe que
//      una fuente de `src/` importe fuera del paquete Y prohibe `INSERT INTO`,
//      `CREATE TABLE` y `node:sqlite` dentro. El paquete viaja solo al
//      escritorio: un adaptador de almacen ahi dentro lo rompe.
//   2. Su repositorio se escribe en CADA `conectar`, incluida la conexion
//      `pendiente` de un proyecto que no existe en el almacen: su propia suite
//      de contrato conecta contra `projectId: "proyecto-de-contrato"`, que no
//      es fila de `project`. Con un repositorio sobre el almacen, la clave
//      foranea tumba las pruebas del paquete — y esas pruebas existen para
//      correrse sin base de datos.
//   3. El proveedor llega ya CONSTRUIDO a `arrancar({ proveedorDeConexiones })`.
//      El servicio no tiene por donde inyectarle un repositorio sin cambiar
//      todos los sitios que lo montan.
//
// Asi que se traduce aqui, que es el unico sitio que ya conoce los dos
// paquetes, Y EN UNA SOLA FUNCION. Es el mismo criterio con el que
// `dependencias.mjs` traduce el vocabulario de la boveda al del modelo de
// datos: repartida, la traduccion es donde se pierde el invariante el dia que
// alguien mapea un estado a otro porque el campo se llamaba distinto.

/**
 * Los dos vocabularios de estado, en UNA tabla.
 *
 * No es un renombre cosmetico: `conectada` -> `viva` es lo que la guarda cuenta,
 * y un estado que no este aqui tiene que hacer ruido en vez de guardarse como
 * `pendiente` por defecto — una conexion rota archivada como "esperando" deja al
 * operador esperando con ella.
 */
const ESTADO_EN_EL_ALMACEN = Object.freeze({ pendiente: "pendiente", conectada: "viva", revocada: "revocada" });

/**
 * La credencial del inventario que esta conexion dejo en la boveda, si dejo
 * alguna.
 *
 * EL FALLO QUE CIERRA. La columna `credential_id` de `connection` quedaba
 * siempre en `null`, y la pantalla de conexiones pintaba "Sin credencial
 * asociada" JUSTO DESPUES de que el operador pegara su token y la credencial
 * entrara al inventario con su huella. El operador leia que no habia
 * credencial y volvia a pegarla.
 *
 * El puente es la `ref` del deposito: `packages/connections` guarda en la fila
 * de la conexion la REFERENCIA con la que se le pide el valor a la boveda
 * —nunca el valor— y el inventario indexa por esa misma referencia. Una
 * conexion de modo `oauth2` todavia no deja ninguna, y entonces esto devuelve
 * `null`, que es la verdad.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} conexion
 * @returns {string|null}
 */
function credencialDeLaConexion(p, conexion) {
  const refs = Object.values(conexion.deposito?.refs ?? {});
  for (const entrada of refs) {
    const ref = /** @type {any} */ (entrada)?.ref;
    if (typeof ref !== "string") continue;
    const credencial = p.dep.almacen.boveda.credencialPorRef(ref);
    if (credencial) return credencial.id;
  }
  return null;
}

/**
 * Escribe la conexion en la tabla que mira la guarda y, si con ella el proyecto
 * ya tiene una viva, lo lleva a `CONNECTED`.
 *
 * LA FILA COMPARTE EL `id` CON LA CONEXION, y es la correspondencia entre las
 * dos mitades — no un atajo. `DELETE /v1/connections/:id` recibe el id de
 * `packages/connections` y tiene que poder marcar revocada la fila del almacen:
 * sin id compartido no hay forma de encontrarla. Es lo mismo que ya se hace con
 * los grants unas lineas mas arriba.
 *
 * `id_externo` lleva el `handle`, que es por lo que se le pregunta a la capa de
 * integracion por esta conexion — EXCEPTO cuando la clase es `scm`, donde va
 * `null` por FR-032. No es un rodeo al `CHECK (clase <> 'scm' OR id_externo IS
 * NULL)` del esquema: es lo que el CHECK dice. `scm` no es una integracion, git
 * y la forja se hablan directo, y un identificador de esa capa en esa fila es la
 * señal de que a partir de ese dia clonar depende de que el proveedor conteste.
 * Y no es un caso del adaptador falso: `github` es `clase: "scm"` en el catalogo
 * por defecto de `packages/connections`.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} conexion la conexion tal como la devuelve `packages/connections`
 * @returns {Promise<any|null>} el proyecto, si esta conexion lo hizo avanzar
 */
async function reflejarConexion(p, conexion) {
  const proveedor = exigirConexiones(p.dep);
  const estado = ESTADO_EN_EL_ALMACEN[conexion.estado];
  if (!estado) {
    throw new ErrorDeServicio("estado_de_conexion_desconocido", {
      estado: conexion.estado,
      traducidos: Object.keys(ESTADO_EN_EL_ALMACEN).join(", "),
    });
  }

  const entrada = (await proveedor.catalogo()).find((/** @type {any} */ e) => e.slug === conexion.slug);
  if (!entrada) {
    throw new ErrorDeServicio("proveedor_fuera_del_catalogo", {
      proveedor: conexion.slug,
      detalle:
        "la conexion dice ser de un proveedor que el catalogo del adaptador ya no declara, y la `clase` de la " +
        "fila sale de ahi: inventarla la clasificaria mal en la pantalla y en la guarda",
    });
  }

  // LA BUSQUEDA ES POR ALCANCE, y el alcance lo dice `project_id`. Una conexion
  // del espacio de trabajo (`project_id: null`) no esta en la lista de ningun
  // proyecto: buscarla ahi la daba siempre por nueva y el segundo `INSERT` con
  // el mismo id moria contra la clave primaria.
  const existentes = conexion.project_id
    ? p.dep.almacen.conexiones.porProyecto(conexion.project_id)
    : p.dep.almacen.conexiones.delEspacioDeTrabajo(p.dep.workspace.id);
  const yaEsta = existentes.some((/** @type {any} */ f) => f.id === conexion.id);

  if (yaEsta) p.dep.almacen.conexiones.cambiarEstado(conexion.id, estado);
  else {
    p.dep.almacen.conexiones.crear({
      id: conexion.id,
      // Los dos campos, siempre. `project_id` en `null` es el alcance del
      // espacio de trabajo, no un hueco; `workspace_id` es lo que impide que
      // esa fila valga para los proyectos de otro espacio.
      project_id: conexion.project_id ?? null,
      workspace_id: p.dep.workspace.id,
      clase: entrada.clase,
      proveedor: conexion.slug,
      id_externo: entrada.clase === "scm" ? null : conexion.handle,
      estado,
      credential_id: credencialDeLaConexion(p, conexion),
    });
  }

  // SIN PROYECTO NO SE MUEVE NINGUN ESTADO, y es la contracara de la decision
  // sobre la guarda. `conexion_viva` da por buena una conexion del espacio de
  // trabajo —el proyecto alcanza la forja de verdad— pero eso no puede
  // significar que pegar un token empuje de etapa a los veinte proyectos del
  // espacio a la vez. Avanzar sigue siendo una transicion pedida sobre UN
  // proyecto, y aqui no hay ninguno sobre el que se haya actuado.
  return conexion.project_id ? avanzarSiHayConexionViva(p, conexion.project_id) : null;
}

/**
 * El alcance de una fila, dicho para quien la pinta.
 *
 * NO SE DEDUCE EN LA PANTALLA de que `project_id` sea nulo, y la diferencia es
 * la que el operador vio: «del espacio de trabajo» y «de este proyecto» son dos
 * cosas distintas —una la comparten todos los proyectos, la otra no— y
 * mezclarlas confunde sobre que alcanza que. Un nombre explicito es lo que
 * permite que la pantalla las separe sin inventarse la regla.
 *
 * @param {any} fila
 */
const conAlcance = (fila) => ({ ...fila, alcance: fila.project_id ? "proyecto" : "espacio_de_trabajo" });

/**
 * La transicion a `CONNECTED`, y la unica que hay.
 *
 * POR QUE SE COMPRUEBA EL ESTADO ANTES DE LLAMAR, EN VEZ DE INTENTAR Y ATRAPAR.
 * Conectar un proveedor es legitimo en cualquier etapa —el operador puede
 * hacerlo antes de aceptar el snapshot— y en ese caso NO pasa nada: la unica
 * arista que llega a `CONNECTED` sale de `BOOTSTRAPPED`. Intentar la transicion
 * siempre convertiria ese caso normal en un error que la pantalla de conexiones
 * tendria que aprender a ignorar, y una pantalla que ignora errores termina
 * ignorando el que importaba.
 *
 * La guarda NO se replica aqui: se le pregunta al almacen, que va a buscar la
 * fila. Comprobarlo en los dos sitios serian dos verdades que se pueden separar.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {string} projectId
 */
function avanzarSiHayConexionViva(p, projectId) {
  const proyecto = p.dep.almacen.proyectos.porId(projectId);
  if (!proyecto || proyecto.estado !== "BOOTSTRAPPED") return null;
  if (!p.dep.almacen.proyectos.artefactos(projectId).conexion_viva.listo) return null;

  const actualizado = p.dep.almacen.proyectos.transicionar(projectId, "CONNECTED", { actor: "operador" });
  p.estado.bus.emitir(
    "proyecto.estado",
    { estado: actualizado.estado, motivo: "hay al menos una conexion viva" },
    { project_id: projectId },
  );
  return actualizado;
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function conexionesDelProyecto(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  const proveedor = exigirConexiones(p.dep);

  // LAS FILAS SALEN DEL ALMACEN Y NO DE `listar`, Y ESO ERA UN FALLO MEDIDO.
  //
  // `listar` devuelve el vocabulario de `packages/connections`: `slug`, `modo`,
  // `handle`, y el estado `conectada`. La pantalla —y `data-model.md`— hablan
  // de `proveedor`, `clase` y el estado `viva`. Resultado en la interfaz: cada
  // conexion se dibujaba con el nombre del proveedor vacio, sin icono de clase
  // —`ICONO_DE_CLASE[undefined]`— y con la insignia de estado en blanco, porque
  // ninguna tabla de traduccion tiene una entrada para `conectada`.
  //
  // La traduccion entre los dos vocabularios ya existe unas lineas mas arriba,
  // en `reflejarConexion`, y escribe la fila del almacen con el MISMO id. Leer
  // de ahi no agrega una segunda verdad: lee la que ya se escribio, que ademas
  // es la que mira la guarda `conexion_viva`.
  //
  // Ninguna de las dos lleva valores: la fila de `connection` no tiene columna
  // donde quepa uno, y hay una prueba de centinela que lo vuelve a medir sobre
  // la respuesta HTTP.
  // LO QUE EL PROYECTO ALCANZA, Y NO SOLO LO QUE ES SUYO. La cuenta de codigo
  // se conecta una vez para todo el espacio de trabajo, asi que un proyecto que
  // va a clonar con ella tiene que verla en su pantalla de conexiones: si no,
  // la pantalla dice «Sin conexiones todavia» sobre un proyecto que alcanza su
  // forja perfectamente, y es la misma clase de mentira que el boton que
  // mandaba a otra pantalla.
  //
  // Van CON SU ALCANCE y en un solo listado ordenado —lo propio primero— para
  // que la pantalla las separe en dos grupos. Mezclarlas sin decir cual es cual
  // seria el otro error.
  const filas = p.dep.almacen.conexiones.alAlcanceDe(proyecto.id).map(conAlcance);

  return {
    cuerpo: coleccion(filas, {}, { catalogo: await proveedor.catalogo() }),
  };
}

/**
 * `GET /v1/connections` — las conexiones del ESPACIO DE TRABAJO, de los dos
 * alcances y en una sola peticion.
 *
 * POR QUE EXISTE. El selector de repositorios del alta averiguaba que cuentas
 * de codigo hay recorriendo los proyectos y pidiendo las conexiones de cada
 * uno: N+1 peticiones, y su propia cabecera ya lo declaraba como deuda. Pero el
 * problema no era el numero de viajes: en el alta NO HAY PROYECTO todavia, asi
 * que ese recorrido no alcanzaba a la unica conexion que importa —la que el
 * operador acaba de crear sin proyecto— y la pantalla remataba en «Sin cuenta
 * de codigo conectada» con un boton a otra pantalla.
 *
 * `GET` y nada mas: preguntar que cuentas hay no cambia nada.
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function conexionesDelEspacioDeTrabajo(p) {
  const proveedor = exigirConexiones(p.dep);

  const crudo = p.url.searchParams.get("alcance");
  if (crudo !== null && crudo !== "espacio_de_trabajo" && crudo !== "proyecto") {
    throw new ErrorDeServicio("parametro_invalido", {
      parametro: "alcance",
      valor: crudo,
      opciones: ["espacio_de_trabajo", "proyecto"],
    });
  }

  const filas = p.dep.almacen.conexiones
    .todasDelEspacioDeTrabajo(p.dep.workspace.id)
    .map(conAlcance)
    .filter((/** @type {any} */ f) => crudo === null || f.alcance === crudo);

  return {
    cuerpo: coleccion(filas, {}, {
      // El catalogo viaja con la lista por el mismo motivo que en la pantalla
      // del proyecto: quien ve «no hay ninguna cuenta» necesita, en el mismo
      // sitio, con que conectarla. Separarlo en otra ruta es lo que convierte
      // un estado vacio en un boton que lleva a otro lado.
      catalogo: await proveedor.catalogo(),
      workspace_id: p.dep.workspace.id,
    }),
  };
}

/**
 * `GET /v1/connections/:id/repos` — los repositorios que una conexion alcanza.
 *
 * POR QUE ESTA RUTA EXISTE, Y QUE DEJA DE PASAR CUANDO EXISTE. El alta de
 * proyecto con origen remoto pedia la direccion del repositorio en una casilla
 * de texto libre, teniendo el producto la credencial del operador guardada con
 * su grant. El operador iba al navegador, abria la forja, copiaba la direccion
 * y la pegaba; una letra de mas y el fallo aparecia despues, al clonar, con un
 * mensaje de git que no menciona ninguna pantalla.
 *
 * POR QUE LA RUTA NO SABE DE NINGUNA FORJA. Le pregunta a la fachada, que sabe
 * por el catalogo como se le pregunta a cada proveedor. El valor de la
 * credencial no pasa por aqui en ningun momento: viaja en la cabecera de la
 * llamada que hace la capa de conexiones, y lo que vuelve son fichas de
 * repositorio.
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function repositoriosDeConexion(p) {
  const proveedor = exigirConexiones(p.dep);

  const crudo = p.url.searchParams.get("limite");
  const pedido = crudo === null || crudo === "" ? undefined : Number(crudo);
  if (pedido !== undefined && (!Number.isInteger(pedido) || pedido <= 0)) {
    throw new ErrorDeServicio("parametro_invalido", {
      parametro: "limite",
      valor: crudo,
      opciones: ["un entero mayor que cero"],
    });
  }

  const resultado = await proveedor.repositorios(p.parametros.id, {
    texto: p.url.searchParams.get("q") ?? "",
    ...(pedido === undefined ? {} : { limite: pedido }),
  });

  // EL RECORTE SE DICE, Y NO POR CORTESIA. Quien no encuentra el suyo en la
  // lista vuelve a escribir la direccion a mano, que es de lo que veniamos. El
  // aviso viaja en el sobre de la coleccion —el mismo sitio donde el catalogo
  // de proveedores avisa de lo suyo— asi que la pantalla ya sabe pintarlo.
  const avisos = resultado.hay_mas
    ? [
        {
          codigo: "repositorios_recortados",
          causa:
            `Se enseñan ${resultado.mostrados} de los ${resultado.total} repositorios que esta conexion alcanza.`,
          accion: "Escribe parte del nombre para acotar la lista: la busqueda mira el nombre y la cuenta a la que pertenece.",
        },
      ]
    : [];

  return {
    cuerpo: coleccion(resultado.items, { avisos }, {
      // Los dos numeros viajan por el mismo motivo que en el catalogo de
      // proveedores: con uno solo la pantalla miente en alguna direccion. Que
      // la lista se recorte esta bien; que el recorte sea invisible, no.
      total: resultado.total,
      mostrados: resultado.mostrados,
      hay_mas: resultado.hay_mas,
      limite: resultado.limite,
    }),
  };
}

/**
 * Conectar un proveedor, con el ALCANCE que le pase quien llama.
 *
 * POR QUE UNA SOLA FUNCION PARA LOS DOS ALCANCES. Lo que cambia entre
 * «conectar el tracker de este proyecto» y «conectar la cuenta de codigo del
 * espacio de trabajo» es exactamente un valor: a que pertenece la conexion.
 * Todo lo demas —que el modo lo decide el catalogo, que en oauth2 hay que
 * buscar la conexion pendiente por su handle, que la fila se refleja en el
 * almacen, que la respuesta nunca lleva el valor— es identico. Dos copias de
 * esto es como una de las dos se queda sin la comprobacion del `modo` el dia
 * que alguien toca una sola.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {string|null} projectId `null` = la conexion es del espacio de trabajo
 */
async function conectarConAlcance(p, projectId) {
  const proveedor = exigirConexiones(p.dep);
  const cuerpo = await p.cuerpo();
  exigir(
    cuerpo,
    ["proveedor"],
    "El `slug` del proveedor externo; `GET /v1/connections` y `GET /v1/projects/:id/connections` traen el catalogo.",
  );

  if ("modo" in cuerpo) {
    throw new ErrorDeServicio("cuerpo_invalido", {
      detalle:
        "la peticion trae un `modo`, y el modo lo decide el catalogo. Dos fuentes de verdad para el modo acaban " +
        "ganando la de quien llama, que es justo la que no sabe si ese proveedor usa OAuth o una clave de API",
      campos: ["proveedor", "valores"],
    });
  }

  const salida = await proveedor.conectar({
    // Se pasa SIEMPRE, `null` incluido: la capa de conexiones distingue «del
    // espacio de trabajo» de «alguien se olvido de decir el alcance», y solo lo
    // primero se acepta.
    projectId,
    slug: cuerpo.proveedor,
    valores: cuerpo.valores ?? {},
  });

  // La conexion que hay que reflejar. En los modos sin autorizacion viene en la
  // salida; en oauth2 no, porque lo que vuelve es una URL — y la fila hay que
  // escribirla igual, `pendiente`: la guarda distingue "no hay conexiones" de
  // "hay una esperando" y mandan al operador a sitios distintos.
  const conexion = salida.conexion ?? (await proveedor.listar(projectId)).find((c) => c.handle === salida.handle);
  const avanzado = conexion ? await reflejarConexion(p, conexion) : null;

  p.estado.bus.emitir(
    "conexion.estado",
    { proveedor: cuerpo.proveedor, handle: salida.handle, estado: salida.url ? "pendiente" : "conectada" },
    // Sin proyecto el evento no lleva `project_id`: inventarle uno haria que la
    // pantalla de ese proyecto releyera por una conexion que no es suya.
    projectId ? { project_id: projectId } : {},
  );

  return {
    codigo: 201,
    cuerpo: salida.url
      ? {
          url_autorizacion: salida.url,
          session_token: salida.handle,
          expira: salida.expira,
          // La URL se abre en el navegador del SISTEMA, no en el webview:
          // varios proveedores bloquean webviews embebidos por politica, y una
          // URL a secas no dice donde abrirla.
          abrir_en: salida.abrir_en,
        }
      : // El proyecto va SOLO si esta conexion lo hizo avanzar de etapa. Un
        // campo que viaja siempre obliga a comparar contra el estado anterior
        // para saber si paso algo, y la pantalla no lo tiene a mano.
        { session_token: salida.handle, conexion: salida.conexion, ...(avanzado ? { proyecto: avanzado } : {}) },
  };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function autorizarConexion(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  return conectarConAlcance(p, proyecto.id);
}

/**
 * `POST /v1/connections/authorize` — conectar la cuenta del ESPACIO DE TRABAJO.
 *
 * ESTA RUTA ES EL ARREGLO. Sin ella, conectar una cuenta de codigo exigia un
 * proyecto, y en el alta de un proyecto —que es donde el operador esta cuando
 * necesita elegir un repositorio— todavia no hay ninguno. La pantalla resolvia
 * el conflicto mandandolo fuera: «Ir a un proyecto y conectar». Con esta ruta
 * el token se pega ahi mismo y la lista de repositorios sale a continuacion.
 *
 * NO PIDE `:id` Y NO ES UNA OMISION: es la diferencia entera. El alcance de la
 * conexion lo decide POR QUE RUTA entro, no un campo del cuerpo que quien llama
 * podria poner mal.
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function autorizarConexionDelEspacioDeTrabajo(p) {
  return conectarConAlcance(p, null);
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function callbackDeConexion(p) {
  const proveedor = exigirConexiones(p.dep);
  // El `:id` de esta ruta es el `handle` que devolvio `authorize`: es lo que el
  // flujo de autorizacion lleva y trae, y no sobrevive a un reinicio del
  // servicio a proposito.
  // LA ESPERA ES CORTA PERO NO INSTANTANEA, y la diferencia es una carrera real.
  //
  // Estaba en `timeoutMs: 1`, que hace depender el exito de que el PRIMER
  // sondeo del adaptador conteste en menos de un milisegundo. Con el adaptador
  // falso pasa siempre; contra un servicio de verdad, el callback devolveria
  // `espera_agotada` con la autorizacion a punto de llegar — y el operador ve
  // "no se pudo conectar" justo despues de haber autorizado en su navegador,
  // que es el momento en que menos se entiende.
  //
  // No se espera mas porque no hace falta: cuando el navegador llega a esta
  // ruta, el proveedor YA registro la conexion. Este margen cubre el viaje
  // entre los dos, no el flujo entero.
  const conexion = await proveedor.esperarConexion(p.parametros.id, {
    timeoutMs: p.dep.esperaDelCallbackMs ?? 2000,
    intervaloMs: 25,
  });

  // AQUI ES DONDE LA ETAPA 06 SE CIERRA en el camino de oauth2: la fila que
  // `authorize` dejo `pendiente` pasa a `viva` —misma fila, mismo id— y con ella
  // el proyecto avanza si estaba esperando esto.
  const avanzado = await reflejarConexion(p, conexion);

  p.estado.bus.emitir(
    "conexion.estado",
    { handle: p.parametros.id, estado: conexion.estado, proveedor: conexion.slug },
    { project_id: conexion.project_id },
  );

  return { cuerpo: { conexion, ...(avanzado ? { proyecto: avanzado } : {}) } };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function revocarConexion(p) {
  const proveedor = exigirConexiones(p.dep);

  // EL VINCULO SE SUELTA ANTES DE PEDIR QUE OLVIDEN EL VALOR, y el orden es el
  // arreglo entero. `connection.credential_id` apunta con `ON DELETE RESTRICT`:
  // mientras la fila de la conexion senale a la credencial, el almacen se niega
  // a borrarla — con razon, porque una conexion viva apoyada en una credencial
  // que ya no esta falla recien al usarse. Pero revocar es justamente borrar el
  // valor que la sostenia.
  //
  // Medido con curl contra el servicio corriendo: el `DELETE` devolvia 400 con
  // `revocacion_incompleta` —"el valor no se pudo borrar: FOREIGN KEY
  // constraint failed"— y dejaba la fila `viva`. El operador leia un error
  // sobre una clave foranea y su conexion seguia entregando credenciales.
  //
  // Soltar el vinculo no borra nada: la fila de la conexion sigue con su
  // historia, y lo que se va es el valor.
  p.dep.almacen.conexiones.desasociarCredencial(p.parametros.id);

  await proveedor.revocar(p.parametros.id);

  // Y LA MISMA TRADUCCION EN LA OTRA DIRECCION, que es la que mas duele si
  // falta: una fila `viva` que sobrevive a la revocacion deja al proyecto en
  // `CONNECTED` apoyado en una conexion que ya no entrega credenciales. La fila
  // comparte el `id` con la conexion, asi que se encuentra con el mismo que
  // trajo la ruta; si no hay fila, el `UPDATE` no toca nada y no hay que
  // distinguir el caso.
  p.dep.almacen.conexiones.cambiarEstado(p.parametros.id, "revocada");

  p.estado.bus.emitir("conexion.estado", { conexion_id: p.parametros.id, estado: "revocada" });
  return { cuerpo: { revocada: p.parametros.id } };
}
