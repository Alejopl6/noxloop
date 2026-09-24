// El proveedor de Linear.
//
// Linear tiene UNA ruta: todo es `POST https://api.linear.app/graphql` con
// `{query, variables}`. No hay endpoint por operacion, asi que lo que cambia
// entre una lectura y una escritura es el documento, no la URL.
//
// Lo que este proveedor resuelve y el motor no tiene que saber:
//   - los ids son UUID, y el `id` canonico es string (hay un chequeo de la
//     suite que lo verifica: un gestor con ids numericos que devuelva numeros
//     rompe toda comparacion contra el estado persistido en disco);
//   - los estados son estados de workflow POR EQUIPO con UUID propio, asi que
//     el `stateMap` guarda el NOMBRE destino y este archivo lo resuelve;
//   - Linear NO tiene modelo de tipos de issue, asi que el "tipo nativo" del
//     que sale el nivel es el NOMBRE DE ETIQUETA.
//
// Las pruebas corren contra respuestas grabadas en ./fixtures.mjs: sin red, sin
// API key y sin workspace. Ese archivo NO se importa desde aca a proposito —
// produccion no carga datos de prueba.
//
// SOBRE LOS IDS QUE ACEPTA CADA OPERACION. `issue(id:)` y el argumento `id` de
// las mutaciones aceptan UUID o identificador humano ("ENG-123"). Para los
// campos `issueId` de los inputs (commentCreate, attachmentLink*) no encontre
// documentado si aceptan el identificador; no nos toca, porque el motor pasa
// siempre `item.id`, que es el UUID. Confirmarlo requiere una cuenta real.

// Los niveles canonicos se IMPORTAN del contrato, no se copian aca: un
// proveedor que escriba la lista de memoria queda con una lista vieja el dia
// que el enum cambie, y el sintoma es un Item rechazado sin explicacion.
import { LEVELS, listQuery } from "../contract.mjs";

export const meta = { name: "linear", version: "1.0.0" };

// El nombre de la variable lo elige el proveedor: Linear documenta el header
// `Authorization`, no una variable de entorno. El motor la exige antes de
// arrancar y la inyecta en `ctx.env`; este archivo nunca lee `process.env`.
export const requiredEnv = ["LINEAR_API_KEY"];

const ENDPOINT = "https://api.linear.app/graphql";

/**
 * Lo que Linear sabe hacer. Se declara TODO, aunque sea false: una capacidad
 * sin declarar es una capacidad que el motor no sabe si puede usar.
 */
export function capabilities() {
  return {
    children: true, // Issue.parent / Issue.children son nativos
    dependencies: true, // IssueRelation con el enum `blocks`: el motor no serializa
    createChild: true, // issueCreate con parentId (y teamId, que no se hereda)
    setState: true, // issueUpdate con stateId
    comment: true, // commentCreate
    linkUrl: true, // attachmentLinkURL, y el adjunto rico para un PR de GitHub
    labels: true, // issueAddLabel
    searchAssigned: true, // notifications con category `assignments`
    // POR QUE ARRANCA EN FALSE. El corte de menciones sale de `category:
    // "mentions"`, que si es un enum documentado, pero es la unica senial que
    // depende de una pieza del inbox cuyos valores de `Notification.type` no
    // estan documentados y que NotificationFilter no deja filtrar del lado del
    // servidor. Declararla en true sin poder verificarla contra una cuenta
    // seria afirmar un disparo que no probamos. El daemon igual arranca, porque
    // el motor solo se niega si las dos busquedas estan en false.
    // PARA PASARLA A TRUE: contra un workspace real, mencionar al bot en un
    // comentario y comprobar que `notifications` trae ese nodo con
    // `category == "mentions"` y con `issue` poblado.
    searchMentioned: false,
    // Linear tiene campos de tablero heredables y IssueCreateInput los acepta
    // al crear el hijo: cycleId, projectId, projectMilestoneId, assigneeId,
    // estimate. Declararlo true es honesto porque `createChild` los pasa.
    boardFields: true,
    identityAssignee: false, // assignee: { isMe: { eq: true } } es del token; pedir otro exige otra consulta
    listItems: true, // issues(filter: { team, state.type }) con pageInfo
  };
}

/**
 * Lo que este proveedor acepta en `provider.options`. Ver T114 y el
 * `optionsSchema` de los otros dos: una clave mal escrita tiene que fallar al
 * cargar, no a mitad de un recorrido.
 */
export const optionsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    teamId: {
      type: "string",
      description: "El UUID del equipo: donde se crean las hijas, y el espacio que lista el board (gana sobre teamKey).",
    },
    teamKey: {
      type: "string",
      description: "La clave corta del equipo (ENG), para resolver identificadores humanos y listar el board.",
    },
    acceptanceHeading: { type: "string", description: "El encabezado de la descripcion donde viven los criterios." },
  },
};

/**
 * El mapa de tipos nativos a niveles canonicos, con `default` EXPLICITO.
 *
 * EL FALLO QUE EVITA. Linear no tiene tipos de issue: `type Issue` no expone
 * ningun campo de tipo, no hay query `issueTypes`, y la jerarquia de producto
 * (Initiative > Project > Milestone > Issue > sub-issue) no pasa por issues.
 * Entonces el nivel podria salir de dos lugares: de una etiqueta declarada, o
 * de la estructura (`parent == null` -> epic). Lo segundo es la misma deduccion
 * que el contrato prohibe con otro disfraz: un sub-issue de un sub-issue queda
 * "task" por accidente, y un issue suelto que es una historia pasa a "epic" sin
 * que nadie lo haya declarado. Sale de la etiqueta, que alguien escribio.
 *
 * Consecuencia de alcance, que es correcta y no una falla: un workspace que no
 * etiquete sus issues solo produce items de nivel `story`/`task`, porque en
 * Linear las epicas y features viven como Initiative/Project, que no son
 * issues.
 */
const NIVELES = {
  Epic: "epic",
  Feature: "feature",
  Story: "story",
  Task: "task",
  default: "story",
};

/**
 * `state.type` -> estado canonico. Es el UNICO lugar donde mirar un valor
 * nativo es legitimo: `type` es un enum del gestor
 * (triage/backlog/unstarted/started/completed/canceled/duplicate), no el nombre
 * que el equipo le puso a la columna. `canceled` y `duplicate` no tienen
 * equivalente canonico y se quedan en null: inventar uno haria que el motor
 * crea que un ticket cancelado esta por hacer.
 */
const TIPOS_DE_ESTADO = {
  triage: "todo",
  backlog: "todo",
  unstarted: "todo",
  started: "in_progress",
  completed: "done",
  canceled: null,
  duplicate: null,
};

/** La seleccion de campos de un Issue. Una sola, para que todo camino que
 * devuelva un Item tenga de donde sacar el nivel, el estado y la URL. */
const CAMPOS_ISSUE = `
      id identifier title description url estimate
      state { id name type }
      parent { id identifier }
      assignee { id name displayName }
      labels { nodes { id name } }
      team { id key }
      project { id name }
      projectMilestone { id name }
      cycle { id number }`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTIFICADOR = /^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/;

/**
 * El unico viaje a la API.
 *
 * POR QUE MIRA EL CUERPO Y NO SOLO EL STATUS. Un error de GraphQL llega con
 * HTTP 200 y `errors[]` adentro: un cliente que confia en el status lo toma
 * como exito y sigue con `data: null`, y el fallo aparece tres pasos despues
 * como "no se pudo leer una propiedad de null". Ademas Linear manda el limite
 * de tasa como HTTP 400 con `errors[].code == "RATELIMITED"`, que el
 * `ctx.fetch` del motor —que reintenta 429 y 5xx— no reintenta: acá se propaga
 * el texto del gestor y el motor detiene el recorrido con la causa real.
 */
async function gql(ctx, query, variables = {}) {
  const r = await ctx.fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // La API key personal va TAL CUAL, sin `Bearer`. El prefijo es solo para
      // access tokens de OAuth2, y con una key personal devuelve 401: el fallo
      // se lee como "credencial mala" cuando la credencial esta bien.
      Authorization: ctx.env?.LINEAR_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });

  let cuerpo = null;
  try {
    cuerpo = await r.json();
  } catch {
    cuerpo = null;
  }

  const errores = Array.isArray(cuerpo?.errors) ? cuerpo.errors : [];
  if (errores.length > 0) throw new Error(`Linear: ${mensajeDeError(errores)}`);
  if (!r.ok) throw new Error(`Linear respondio HTTP ${r.status} sin errors[] en el cuerpo`);
  if (!cuerpo || cuerpo.data == null) throw new Error("Linear respondio sin `data` y sin `errors[]`");
  return cuerpo.data;
}

/**
 * El mensaje TEXTUAL del gestor, en el orden que Linear documenta para
 * mostrarselo a una persona. Nunca se resume a "no se pudo": el resumen borra
 * exactamente el dato que hace falta para arreglarlo.
 */
function mensajeDeError(errores) {
  return errores
    .map((e) => e?.extensions?.userPresentableMessage || e?.message || e?.extensions?.type || "error sin mensaje")
    .join("; ");
}

/**
 * El filtro con el que se pregunta si un issue existe.
 *
 * POR QUE NO SE USA `issue(id:)`. El campo es `issue(id: String!): Issue!`, NO
 * nulable: un id inexistente devuelve `errors[]`, nunca null. Devolver null
 * desde ahi obligaria a leer el TEXTO del error —que no esta documentado y que
 * cambia sin aviso— para distinguir "no existe" de "no tengo permiso". Con
 * `issues(filter:)`, `nodes: []` significa que no existe, y es un dato de forma
 * y no de prosa.
 *
 * `IssueFilter.id` es un IssueIDComparator con `eq: ID`, o sea solo UUID; para
 * un identificador humano hay que filtrar por `team.key` + `number`.
 */
function filtroDeId(id) {
  const s = String(id ?? "");
  if (UUID.test(s)) return { id: { eq: s } };
  const m = IDENTIFICADOR.exec(s);
  // La clave del equipo va tal como Linear la imprime en el identificador: no
  // se normaliza, porque normalizar es inventar un dato del gestor.
  if (m) return { team: { key: { eq: m[1] } }, number: { eq: Number(m[2]) } };
  return null;
}

/** Item canonico a partir de un Issue crudo. */
function aItem(crudo, ctx) {
  return {
    // string SIEMPRE: los ids de Linear son UUID.
    id: String(crudo.id),
    key: crudo.identifier ?? null,
    title: crudo.title ?? "",
    body: crudo.description ?? "",
    acceptance: criteriosDe(crudo.description, ctx),
    level: nivelDe(crudo, ctx),
    state: crudo.state?.name ?? null,
    canonicalState: estadoCanonico(crudo.state, ctx),
    assignee: crudo.assignee?.displayName || crudo.assignee?.name || null,
    parentId: crudo.parent?.id ? String(crudo.parent.id) : null,
    labels: etiquetasDe(crudo).map((l) => l?.name).filter(Boolean),
    // HUECO DECLARADO. `Issue.url` es `String!` en el esquema, asi que si no
    // viene, la respuesta esta rota. No se rellena: armar
    // `https://linear.app/<algo>/issue/ENG-123` necesita el slug del workspace,
    // que este proveedor no tiene. El Item vuelve sin url y `validateItem` lo
    // rechaza con "url: tiene que ser un string no vacio", que es un mensaje
    // exacto; inventar la URL seria peor que el hueco.
    url: crudo.url,
    boardFields: camposDeTablero(crudo),
    raw: crudo,
  };
}

/**
 * Las etiquetas de un issue, siempre como lista.
 *
 * `labels` es una IssueLabelConnection y `nodes` es una lista, pero lo que
 * llega puede no serlo: una cache, un proxy o una version futura del esquema
 * alcanzan para que venga `null` o un objeto suelto, y un `for...of` sobre eso
 * revienta con "object is not iterable" desde dentro de getItem — un mensaje
 * que no nombra ni el gestor ni el ticket.
 */
function etiquetasDe(crudo) {
  const nodos = crudo?.labels?.nodes;
  return Array.isArray(nodos) ? nodos : [];
}

/**
 * El nivel sale del MAPA de etiquetas. El mapa de la configuracion gana sobre
 * el declarado aca, pero se fusiona encima del declarado para que `default`
 * exista siempre: una configuracion que se olvide de `default` dejaria todo
 * issue sin etiqueta conocida sin nivel, y `validateItem` lo rechazaria a mitad
 * del recorrido.
 *
 * DOS FALLOS QUE ESTO EVITA, los dos observados en la sonda del proveedor:
 *
 *   1. `mapa[nombre]` con una etiqueta llamada "constructor" o "toString"
 *      devuelve algo HEREDADO del prototipo de Object —una funcion— y el Item
 *      vuelve con `level: [Function]`. Los nombres de etiqueta en Linear son
 *      texto libre: en un repo de JS alguien los usa sin pensarlo, y el ticket
 *      queda descartado por "level invalido" sin que nadie entienda por que.
 *      De ahi `Object.hasOwn`.
 *   2. Un valor del mapa que no es un nivel canonico —"defecto" en vez de
 *      "task", que es un tipeo en la configuracion— pasaba tal cual al Item.
 *      Se ignora y se cae en el default: el nivel que se escribio mal no puede
 *      valer mas que el default declarado.
 */
function nivelDe(crudo, ctx) {
  const mapa = { ...NIVELES, ...(ctx.options?.levelMap || {}) };
  const porDefecto = LEVELS.includes(mapa.default) ? mapa.default : NIVELES.default;

  for (const l of etiquetasDe(crudo)) {
    const nombre = l?.name;
    if (!nombre || nombre === "default" || !Object.hasOwn(mapa, nombre)) continue;
    if (LEVELS.includes(mapa[nombre])) return mapa[nombre];
    ctx.log?.warn?.(
      `Linear: levelMap["${nombre}"] = ${JSON.stringify(mapa[nombre])} no es un nivel canonico (${LEVELS.join(", ")}); ` +
        `se usa el default "${porDefecto}"`,
    );
  }
  return porDefecto;
}

/**
 * Busqueda INVERSA en el stateMap por nombre; si el nombre no esta en el mapa,
 * cae en `state.type`. Los nombres son configurables por equipo y el mapa vive
 * en la configuracion, asi que ningun nombre nativo se escribe aca de memoria.
 */
function estadoCanonico(state, ctx) {
  if (!state) return null;
  const mapa = ctx.options?.stateMap || {};
  for (const [canonico, nativo] of Object.entries(mapa)) {
    if (nativo && nativo === state.name) return canonico;
  }
  // `Object.hasOwn` por lo mismo que en `nivelDe`: `TIPOS_DE_ESTADO["constructor"]`
  // devuelve una funcion heredada y `?? null` no la atrapa —una funcion no es
  // nullish—, asi que el Item volveria con `canonicalState: [Function]`. Hace
  // falta que Linear agregue o renombre un valor del enum para llegar aca, y el
  // guard cuesta una linea.
  return Object.hasOwn(TIPOS_DE_ESTADO, state.type) ? TIPOS_DE_ESTADO[state.type] : null;
}

/** Los campos de tablero heredables: es lo que `createChild` le pasa al hijo. */
function camposDeTablero(crudo) {
  return {
    teamId: crudo.team?.id ?? null,
    teamKey: crudo.team?.key ?? null,
    projectId: crudo.project?.id ?? null,
    projectMilestoneId: crudo.projectMilestone?.id ?? null,
    cycleId: crudo.cycle?.id ?? null,
    assigneeId: crudo.assignee?.id ?? null,
    estimate: crudo.estimate ?? null,
  };
}

const ENCABEZADO_CRITERIOS = /criterios?\s+de\s+aceptaci[oó]n|acceptance\s+criteria/i;
const VINETA = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/;
const CASILLA = /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s*(.+?)\s*$/;

/**
 * Los criterios de aceptacion, sacados de la descripcion markdown.
 *
 * Linear no tiene un campo de criterios, asi que hay que leerlos del cuerpo. Se
 * toman las viñetas que estan BAJO el encabezado de criterios y se corta en el
 * encabezado siguiente: sin ese corte, las "Notas" y los "Pendientes" entran
 * como criterios y el planificador arma tareas para verificar una nota.
 *
 * Si no hay encabezado, se toman solo las casillas (`- [ ]`), que es la unica
 * viñeta que en un ticket significa "esto se verifica". Si no hay ninguna, la
 * lista vuelve vacia y el motor pregunta: un criterio inventado es peor que una
 * pregunta.
 */
function criteriosDe(descripcion, ctx) {
  const texto = String(descripcion || "");
  if (!texto.trim()) return [];

  // El encabezado configurable se compila con red: `new RegExp("criterios(")`
  // lanza un `SyntaxError: Invalid regular expression` desde dentro de getItem,
  // y el error no nombra la opcion ni el proveedor — parece un bug del motor
  // cuando es un tipeo en la configuracion.
  let encabezado = ENCABEZADO_CRITERIOS;
  if (ctx.options?.acceptanceHeading) {
    try {
      encabezado = new RegExp(ctx.options.acceptanceHeading, "i");
    } catch (e) {
      throw new Error(
        `options.acceptanceHeading de Linear no es una expresion regular valida ` +
          `(${JSON.stringify(ctx.options.acceptanceHeading)}): ${e.message}`,
      );
    }
  }

  const lineas = texto.split(/\r?\n/);
  const desde = lineas.findIndex((l) => /^\s{0,3}#{1,6}\s/.test(l) && encabezado.test(l));
  if (desde < 0) {
    return lineas.map((l) => CASILLA.exec(l)?.[1]).filter((c) => Boolean(c && c.trim()));
  }

  const criterios = [];
  for (const linea of lineas.slice(desde + 1)) {
    if (/^\s{0,3}#{1,6}\s/.test(linea)) break;
    const m = VINETA.exec(linea);
    if (m && m[1].trim()) criterios.push(m[1].trim());
  }
  return criterios;
}

// --------------------------------------------------------------- lecturas

export async function getItem(id, ctx) {
  const filtro = filtroDeId(id);
  // Un id que no es UUID ni identificador no puede existir en Linear, y no hay
  // filtro con el que preguntarlo: "no existe" es una RESPUESTA, no un fallo.
  if (!filtro) return null;

  const data = await gql(
    ctx,
    `query($filtro: IssueFilter!) { issues(filter: $filtro, first: 1) { nodes {${CAMPOS_ISSUE} } } }`,
    { filtro },
  );
  const crudo = data?.issues?.nodes?.[0];
  if (!crudo) return null;
  return aItem(crudo, ctx);
}

/**
 * Los sub-issues. `children(first: N)` tiene 50 por defecto y devuelve una
 * IssueConnection: sin seguir `pageInfo.endCursor`, un hito con 51 hijos pierde
 * el ultimo EN SILENCIO, que es la peor forma de perderlo — el plan queda
 * incompleto y nada falla.
 *
 * Nota: usa `issue(id:)`, que es Issue! — un id inexistente lanza con el
 * mensaje del gestor. El motor solo llega aca despues de un `getItem` que
 * devolvio el item, asi que ese camino no es el normal.
 */
export async function children(id, ctx) {
  const consulta = `query($id: String!, $after: String) {
    issue(id: $id) {
      children(first: 50, after: $after) {
        nodes {${CAMPOS_ISSUE} }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;

  const items = [];
  let after = null;
  // El tope corta un bucle si el gestor contestara `hasNextPage: true` con el
  // mismo cursor: girar en falso contra una API con limite de tasa consume la
  // cuota horaria entera antes de que alguien lo note.
  for (let pagina = 0; pagina < 200; pagina++) {
    const data = await gql(ctx, consulta, { id: String(id), after });
    const conexion = data?.issue?.children;
    if (!conexion) break;
    for (const nodo of Array.isArray(conexion.nodes) ? conexion.nodes : []) {
      // Un null en la lista reventaba en `String(crudo.id)` con "Cannot read
      // properties of null (reading 'id')", y un nodo sin id produce un Item
      // que `validateItem` rechaza y que no se puede comparar contra el estado
      // en disco. Se saltea y se anota: un hijo de menos en el plan se ve;
      // un recorrido muerto a mitad de camino cuesta la invocacion entera.
      if (!nodo?.id) {
        ctx.log?.warn?.(`Linear: un hijo de ${id} vino sin id en la respuesta y se saltea`);
        continue;
      }
      items.push(aItem(nodo, ctx));
    }
    if (!conexion.pageInfo?.hasNextPage || !conexion.pageInfo?.endCursor) break;
    after = conexion.pageInfo.endCursor;
  }
  return items;
}

/**
 * Precedencia, en un solo viaje y sin deducir nada.
 *
 * En Linear no existe un tipo `blocked_by`: es la INVERSA de `blocks`. De ahi
 * que hagan falta las dos direcciones — `relations` y `inverseRelations` — y
 * que los otros tipos del enum (`related`, `similar`, `duplicate`) queden
 * afuera: no afirman precedencia, y tratarlos como dependencia serializa
 * trabajo que el gestor nunca ordeno.
 */
export async function dependencies(id, ctx) {
  const data = await gql(
    ctx,
    `query($id: String!) {
      issue(id: $id) {
        relations { nodes { id type relatedIssue { id identifier } } }
        inverseRelations { nodes { id type issue { id identifier } } }
      }
    }`,
    { id: String(id) },
  );

  const salientes = data?.issue?.relations?.nodes || [];
  const entrantes = data?.issue?.inverseRelations?.nodes || [];
  return {
    predecessors: entrantes.filter((r) => r?.type === "blocks" && r.issue?.id).map((r) => String(r.issue.id)),
    successors: salientes.filter((r) => r?.type === "blocks" && r.relatedIssue?.id).map((r) => String(r.relatedIssue.id)),
  };
}

// -------------------------------------------------------------- escrituras

/**
 * Mueve el ticket.
 *
 * LA TRAMPA QUE ESTO RESUELVE. `IssueUpdateInput.stateId` es un UUID de
 * workflow state POR EQUIPO, no un nombre. El `stateMap` guarda el NOMBRE
 * destino —porque dos equipos del mismo workspace pueden tener plantillas
 * distintas— y el proveedor resuelve el UUID contra el equipo del issue. Un
 * proveedor que mandara el nombre en `stateId` recibe un input invalido, y uno
 * que cacheara el UUID de un equipo lo aplicaria a otro.
 */
export async function setState(id, canonicalState, ctx) {
  const nativo = ctx.options?.stateMap?.[canonicalState];
  // Un estado canonico que este proyecto no tiene NO se escribe, y tampoco se
  // pregunta: el mapa ya dijo que no existe. Inventar el nombre nativo es como
  // se mueve un ticket a un estado que no existe.
  if (!nativo) return { written: null, skipped: canonicalState };

  const equipo = ctx.options?.teamKey || (await equipoDe(id, ctx)).key;
  const estado = await estadoDelEquipo(equipo, nativo, ctx);
  if (!estado) {
    // Error de configuracion, no de la API: el mapa promete un estado que la
    // plantilla del equipo no tiene. Callarlo deja el tablero quieto sin que
    // nadie se entere de por que.
    throw new Error(
      `el equipo ${equipo} de Linear no tiene un estado de workflow llamado "${nativo}" ` +
        `(stateMap.${canonicalState}); los estados son por equipo y se crean en Linear, no desde aca`,
    );
  }
  // Un estado sin id mandaba `stateId: undefined` en la mutacion y la respuesta
  // se leia como exito: el recorrido anotaba el estado escrito y el ticket no
  // se movia. Si no hay UUID no hay escritura posible, y hay que decirlo.
  if (!estado.id) {
    throw new Error(
      `Linear devolvio el estado "${nativo}" del equipo ${equipo} sin id: no se puede escribir un stateId indefinido`,
    );
  }

  const data = await gql(
    ctx,
    `mutation($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) { success issue { id state { id name type } } }
    }`,
    { id: String(id), stateId: estado.id },
  );
  if (!data?.issueUpdate?.success) throw new Error(`Linear no aplico el cambio de estado de ${id} a "${nativo}"`);
  return { written: data.issueUpdate.issue?.state?.name || nativo, stateId: estado.id };
}

export async function comment(id, text, ctx) {
  const data = await gql(
    ctx,
    `mutation($id: String!, $body: String!) {
      commentCreate(input: { issueId: $id, body: $body }) { success comment { id url } }
    }`,
    { id: String(id), body: String(text ?? "") },
  );
  const c = data?.commentCreate?.comment;
  if (!data?.commentCreate?.success || !c) throw new Error(`Linear no creo el comentario en ${id}`);
  return { id: String(c.id), url: c.url ?? null };
}

const PR_DE_GITHUB = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;

/**
 * Adjunta una URL al ticket.
 *
 * Para el caso del encargo —un PR— usa `attachmentLinkGitHubPR`, que crea el
 * adjunto rico del integrador y sincroniza el estado del PR en el ticket.
 * Mandar el PR por el adjunto generico funciona pero pierde esa sincronizacion,
 * y despues el ticket muestra un enlace muerto cuando el PR se cierra.
 *
 * SIN CONFIRMAR: `attachmentCreate` documenta que es idempotente por (url,
 * issueId) —"creates a new attachment, or updates existing if the same url and
 * issueId is used"—, pero no encontre esa garantia escrita para
 * `attachmentLinkURL` ni para `attachmentLinkGitHubPR`. Si un reintento
 * duplicara el adjunto, el arreglo es pasar el generico por `attachmentCreate`.
 * Confirmarlo requiere una cuenta real: adjuntar dos veces la misma URL y
 * contar los adjuntos.
 */
export async function linkUrl(id, url, title, ctx) {
  const esPr = PR_DE_GITHUB.test(String(url || ""));
  const mutacion = esPr
    ? `mutation($id: String!, $url: String!, $title: String) {
        attachmentLinkGitHubPR(issueId: $id, url: $url, title: $title) { success attachment { id } }
      }`
    : `mutation($id: String!, $url: String!, $title: String) {
        attachmentLinkURL(issueId: $id, url: $url, title: $title) { success attachment { id } }
      }`;

  const data = await gql(ctx, mutacion, { id: String(id), url: String(url), title: title ?? null });
  const payload = esPr ? data?.attachmentLinkGitHubPR : data?.attachmentLinkURL;
  if (!payload?.success) throw new Error(`Linear no adjunto ${url} a ${id}`);
  return { ok: true, id: payload.attachment?.id ? String(payload.attachment.id) : null, kind: esPr ? "github-pr" : "url" };
}

/**
 * Agrega una etiqueta.
 *
 * `labelId` es un UUID, asi que hay que resolver el nombre primero. Se usa
 * `issueAddLabel` y no `issueUpdate(input: { labelIds })`: `labelIds` REEMPLAZA
 * las etiquetas del issue entero, y una etiqueta de progreso no puede borrar
 * las que el equipo puso.
 */
export async function addLabel(id, label, ctx) {
  const etiqueta = await etiquetaPorNombre(label, ctx);
  if (!etiqueta) {
    throw new Error(
      `Linear no tiene una etiqueta llamada "${label}": las etiquetas se crean en el workspace o en el equipo, ` +
        `y este proveedor no las crea al pasar (crearlas en silencio ensucia el tablero de cualquiera que adopte esto)`,
    );
  }
  // Sin id se mandaba el string "undefined" como labelId y la respuesta volvia
  // `{ok: true}`: el recorrido cree que el ticket quedo etiquetado y el tablero
  // no muestra nada. Una escritura que no puede escribir no dice "listo".
  if (!etiqueta.id) {
    throw new Error(`Linear devolvio la etiqueta "${label}" sin id: no se puede agregar una etiqueta sin UUID`);
  }

  const data = await gql(
    ctx,
    `mutation($id: String!, $labelId: String!) { issueAddLabel(id: $id, labelId: $labelId) { success } }`,
    { id: String(id), labelId: String(etiqueta.id) },
  );
  if (!data?.issueAddLabel?.success) throw new Error(`Linear no agrego la etiqueta "${label}" a ${id}`);
  return { ok: true, labelId: String(etiqueta.id) };
}

/**
 * Materializa una tarea como sub-issue.
 *
 * `IssueCreateInput.teamId` es OBLIGATORIO y `parentId` NO lo implica: sin el,
 * la creacion falla por input invalido a mitad de la planificacion, cuando ya
 * se gasto la invocacion del modelo. Se toma de `spec.boardFields.teamId` o de
 * `options.teamId` si vinieron, y si no se lee del padre.
 */
export async function createChild(parentId, spec, ctx) {
  const tablero = spec?.boardFields || {};
  const teamId = tablero.teamId || ctx.options?.teamId || (await equipoDe(parentId, ctx)).id;

  const input = {
    teamId: String(teamId),
    parentId: String(parentId),
    title: spec?.title ? String(spec.title) : "(tarea sin titulo)",
    description: descripcionDe(spec),
  };

  // Los campos de tablero se heredan del padre: una hija sin ciclo ni proyecto
  // no aparece en ningun taskboard, y el tablero queda mudo aunque el ticket
  // exista.
  for (const campo of ["projectId", "projectMilestoneId", "cycleId", "assigneeId"]) {
    if (tablero[campo]) input[campo] = String(tablero[campo]);
  }
  if (typeof tablero.estimate === "number") input.estimate = tablero.estimate;

  // La etiqueta del nivel `task`, si el workspace la tiene: el nivel sale de
  // las etiquetas, asi que un hijo sin etiqueta vuelve del gestor como `story`
  // y el tablero miente sobre lo que es.
  // Se exige el id: `labelIds: ["undefined"]` no es una etiqueta, es un input
  // invalido que tira abajo la creacion del ticket entero por un adorno.
  const etiquetaTarea = await etiquetaDelNivel("task", ctx);
  if (etiquetaTarea?.id) input.labelIds = [String(etiquetaTarea.id)];

  const data = await gql(
    ctx,
    `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue {${CAMPOS_ISSUE} } } }`,
    { input },
  );
  const hijo = data?.issueCreate?.issue;
  if (!data?.issueCreate?.success || !hijo) throw new Error(`Linear no creo el ticket hijo de ${parentId}`);
  return aItem(hijo, ctx);
}

/**
 * El disparo. Un solo viaje trae las dos seniales, porque son dos cortes de la
 * misma consulta: `NotificationFilter` solo expone `type: StringComparator`, y
 * `Notification.type` es String! sin valores documentados, asi que el corte va
 * por `category` (enum) y de este lado.
 *
 * `mentioned` vuelve vacio a proposito mientras `searchMentioned` este en
 * false: devolver menciones con la capacidad declarada en false le daria al
 * motor un disparo que el proveedor le dijo que no tenia.
 *
 * Ruta alternativa confirmada, si el inbox resulta ruidoso:
 * `issues(filter: { assignee: { isMe: { eq: true } }, state: { type: { nin:
 * ["completed","canceled"] } } }, first: 50)` — devuelve lo asignado y abierto
 * en vez de lo notificado.
 */
export async function searchInbox(ctx) {
  const data = await gql(
    ctx,
    `query {
      notifications(first: 50) {
        nodes {
          id type category readAt
          ... on IssueNotification { issue {${CAMPOS_ISSUE} } }
        }
      }
    }`,
  );

  // Por issue y no por notificacion: dos notificaciones del mismo ticket son un
  // item, y despacharlo dos veces arranca dos recorridos sobre el mismo ticket.
  const asignados = new Map();
  for (const n of Array.isArray(data?.notifications?.nodes) ? data.notifications.nodes : []) {
    if (n?.category !== "assignments" || !n.issue?.id) continue;
    // La clave es el id CANONICO (string), no el crudo: si el gestor mandara
    // el mismo id como numero en una notificacion y como string en otra, un Map
    // con el crudo las cuenta como dos items y el motor arranca dos recorridos
    // sobre el mismo ticket — dos ramas y dos PR para una historia.
    const clave = String(n.issue.id);
    if (!asignados.has(clave)) asignados.set(clave, aItem(n.issue, ctx));
  }

  return { assigned: [...asignados.values()], mentioned: [] };
}

// -------------------------------------------------------------- resoluciones

/** El equipo del issue: `createChild` lo exige y `setState` lo necesita. */
async function equipoDe(id, ctx) {
  const data = await gql(ctx, `query($id: String!) { issue(id: $id) { id team { id key } } }`, { id: String(id) });
  const equipo = data?.issue?.team;
  if (!equipo?.id) throw new Error(`no se pudo leer el equipo del issue ${id} de Linear`);
  return { id: String(equipo.id), key: String(equipo.key) };
}

/** El workflow state de ese equipo con ese nombre exacto. */
async function estadoDelEquipo(teamKey, nombre, ctx) {
  const data = await gql(
    ctx,
    `query($team: String!, $name: String!) {
      workflowStates(filter: { team: { key: { eq: $team } }, name: { eq: $name } }, first: 1) {
        nodes { id name type }
      }
    }`,
    { team: String(teamKey), name: String(nombre) },
  );
  return data?.workflowStates?.nodes?.[0] || null;
}

/**
 * La etiqueta con ese nombre.
 *
 * Filtra solo por nombre. `IssueLabelFilter` tambien expone `team`, y un
 * workspace con dos etiquetas homonimas en equipos distintos podria resolver la
 * del equipo equivocado; acotarlo cuesta un viaje extra para leer el equipo del
 * issue. Cuando aparezca ese caso se acota, y el sintoma es visible: la
 * etiqueta se agrega y no se ve en el tablero del equipo.
 */
async function etiquetaPorNombre(nombre, ctx) {
  const data = await gql(
    ctx,
    `query($name: String!) { issueLabels(filter: { name: { eq: $name } }, first: 1) { nodes { id name } } }`,
    { name: String(nombre) },
  );
  return data?.issueLabels?.nodes?.[0] || null;
}

/** La etiqueta que el mapa de niveles traduce a ese nivel canonico. */
async function etiquetaDelNivel(nivel, ctx) {
  const mapa = { ...NIVELES, ...(ctx.options?.levelMap || {}) };
  const entrada = Object.entries(mapa).find(([nombre, v]) => nombre !== "default" && v === nivel);
  if (!entrada) return null;
  const etiqueta = await etiquetaPorNombre(entrada[0], ctx);
  if (!etiqueta) {
    // No es un fallo: el workspace puede no usar etiquetas de nivel. Se anota
    // porque explica por que el hijo vuelve con el nivel por defecto.
    ctx.log?.info?.(`Linear: no existe la etiqueta "${entrada[0]}"; el ticket hijo queda sin etiqueta de nivel`);
  }
  return etiqueta;
}

/**
 * La descripcion del sub-issue.
 *
 * Los criterios se escriben como casillas bajo el encabezado que `criteriosDe`
 * sabe leer: asi el ticket hijo vuelve del gestor con sus criterios y el
 * recorrido es retomable desde el tablero, no solo desde el estado en disco.
 */
function descripcionDe(spec) {
  const criterios = Array.isArray(spec?.acceptance)
    ? spec.acceptance
    : spec?.acceptance
      ? [spec.acceptance]
      : [];

  const partes = [];
  if (spec?.body) partes.push(String(spec.body));
  if (spec?.id || spec?.repo) {
    partes.push(`Tarea ${spec.id ?? "?"}${spec.repo ? ` · repo \`${spec.repo}\`` : ""} (creada por noxloop).`);
  }
  if (criterios.length > 0) {
    partes.push(["## Criterios de aceptación", ...criterios.map((c) => `- [ ] ${String(c).trim()}`)].join("\n"));
  }
  return partes.join("\n\n");
}

// ------------------------------------------------ el listado del board (003)

/**
 * La seleccion del listado: la de siempre mas lo que pinta la tarjeta.
 *
 * Aparte de `CAMPOS_ISSUE` y no sumada a ella: `getItem`, `children` y
 * `createChild` no necesitan prioridad, fecha, nombre de equipo ni avatar, y
 * cada campo de mas es complejidad de consulta que Linear cobra contra el
 * limite de tasa en CADA lectura del motor.
 */
const CAMPOS_LISTADO = `
      id identifier title description url estimate priority updatedAt
      state { id name type }
      parent { id identifier }
      assignee { id name displayName avatarUrl }
      labels { nodes { id name } }
      team { id key name }
      project { id name }
      projectMilestone { id name }
      cycle { id number }`;

/** Tipos de estado que NO son trabajo abierto. `completed` entra con includeDone. */
const TIPOS_CERRADOS = ["completed", "canceled", "duplicate"];

/**
 * La prioridad del board a partir de la de Linear.
 *
 * Linear: 0 sin prioridad, 1 urgente, 2 alta, 3 media, 4 baja.
 * Board:  0 urgente … 4 baja, y null sin dato.
 *
 * Se CORRE un lugar (1->0, 2->1, 3->2, 4->3) y el 0 de Linear va a null. El
 * error que evita es el obvio y el peor: pasar el numero tal cual convierte todo
 * ticket sin prioridad —el caso mas comun en Linear— en URGENTE, y el board se
 * llena de rojo por tickets que nadie priorizo. El 4 del board queda sin usar:
 * Linear tiene cuatro niveles y el board cinco, y estirarlos seria inventar
 * una distancia que el gestor no afirma. Azure DevOps usa el mismo corrimiento,
 * asi que "la mas alta del gestor" es 0 en los dos.
 */
function prioridadDelBoard(p) {
  if (!Number.isInteger(p) || p < 1 || p > 4) return null;
  return p - 1;
}

/**
 * El estado del board. `backlog` sale del TIPO de estado (`state.type ==
 * "backlog"`), que es el enum del gestor y no el nombre que el equipo le puso
 * a la columna; el resto sigue la misma regla que `getItem` (el stateMap por
 * nombre y, si no nombra el estado, su tipo). Un tipo sin canonico devuelve
 * null y el ticket se saltea: sin columna no hay tarjeta que pintar.
 */
function estadoDelBoard(state, ctx) {
  if (state?.type === "backlog") return "backlog";
  return estadoCanonico(state, ctx);
}

/** El espacio del proyecto: un equipo, por UUID (estable) o por clave. */
function filtroDeEquipo(ctx) {
  const id = ctx.options?.teamId;
  if (id) return { id: { eq: String(id) } };
  const key = ctx.options?.teamKey;
  if (key) return { key: { eq: String(key) } };
  throw new Error(
    "listItems de Linear necesita `teamId` o `teamKey` en provider.options: el board lista el espacio de UN " +
      "equipo, y listar el workspace entero mezclaria tickets de otros proyectos en este board",
  );
}

/**
 * Los tickets abiertos del equipo, para el board.
 *
 * Se pide `first` EXACTAMENTE igual a lo que falta para el limite (tope 250 por
 * pagina, el de Linear): el cursor que devuelve Linear apunta despues del ultimo
 * nodo recibido, asi que pedir de mas y recortar perderia los recortados en
 * silencio. `total` es null: IssueConnection no expone una cuenta.
 *
 * @param {{limit?: number, cursor?: string|null, includeDone?: boolean}} query
 */
export async function listItems(query, ctx) {
  const { limit, cursor, includeDone } = listQuery(query);
  const listado = {
    team: filtroDeEquipo(ctx),
    state: { type: { nin: includeDone ? TIPOS_CERRADOS.filter((t) => t !== "completed") : TIPOS_CERRADOS } },
  };
  const consulta = `query($listado: IssueFilter!, $first: Int!, $after: String) {
    issues(filter: $listado, first: $first, after: $after, orderBy: updatedAt) {
      nodes {${CAMPOS_LISTADO} }
      pageInfo { hasNextPage endCursor }
    }
  }`;

  const items = [];
  let after = cursor;
  /** @type {string|null} */
  let nextCursor = null;
  // El mismo tope que `children`, y por lo mismo: un `hasNextPage: true` con el
  // mismo cursor giraria contra la cuota.
  for (let pagina = 0; pagina < 200 && items.length < limit; pagina++) {
    const data = await gql(ctx, consulta, { listado, first: Math.min(250, limit - items.length), after });
    const conexion = data?.issues;
    for (const nodo of Array.isArray(conexion?.nodes) ? conexion.nodes : []) {
      if (!nodo?.id) {
        ctx.log?.warn?.("Linear: un ticket del listado vino sin id y se saltea");
        continue;
      }
      const estado = estadoDelBoard(nodo.state, ctx);
      if (!estado) {
        ctx.log?.warn?.(`Linear: ${nodo.identifier ?? nodo.id} esta en un estado sin columna (${nodo.state?.type}) y se saltea`);
        continue;
      }
      const quien = nodo.assignee;
      items.push({
        ...aItem(nodo, ctx),
        canonicalState: estado,
        priority: prioridadDelBoard(nodo.priority),
        assignee: quien?.id
          ? {
              id: String(quien.id),
              name: String(quien.displayName || quien.name || quien.id),
              ...(quien.avatarUrl ? { avatarUrl: String(quien.avatarUrl) } : {}),
            }
          : null,
        team: nodo.team?.name ?? nodo.team?.key ?? null,
        updatedAt: nodo.updatedAt ?? null,
      });
    }
    const hay = conexion?.pageInfo?.hasNextPage && conexion?.pageInfo?.endCursor;
    if (!hay) {
      nextCursor = null;
      break;
    }
    after = conexion.pageInfo.endCursor;
    nextCursor = after;
  }
  return { items, nextCursor, total: null };
}

// Nada mas se exporta, y es a proposito: una capacidad en `false` no expone una
// funcion a medias. El dia que se exporte una funcion para una capacidad
// declarada en false, tiene que lanzar `NotSupportedError` —como hace el
// proveedor falso— para que el motor no la llame creyendo que anda.
// `searchMentioned` es el unico false de este proveedor y comparte `searchInbox`
// con `searchAssigned`, que esta en true: por eso `searchInbox` existe, no lanza
// y devuelve `mentioned: []`.
