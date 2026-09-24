// Respuestas GRABADAS de la API de Linear, y el `ctx` falso que las sirve.
//
// POR QUE ESTE ARCHIVO EXISTE Y NO ESTA DENTRO DE index.mjs. El proveedor falso
// mete sus fixtures en el mismo archivo porque no hace red: su `ctx.fetch`
// lanza y listo. Este proveedor si habla HTTP, asi que sus fixtures son un
// servidor grabado de ~200 lineas. Dejarlas en index.mjs haria que el modulo de
// produccion cargue datos de prueba en cada arranque del motor, y que el
// chequeo 8 de la suite —que lee el fuente buscando `process.env`— tenga que
// leer un archivo mitad proveedor mitad fixture. Separadas, index.mjs es solo
// el proveedor y este archivo solo lo entra `node --test`.
//
// EL FALLO QUE EVITA QUE SEAN GRABADAS Y NO UNA CUENTA. Un test que necesita un
// workspace de Linear y una API key no lo puede correr quien adopte el
// proyecto: queda como un test que "anda en la maquina del que lo escribio".
// Todo lo que hay aca son cuerpos de respuesta tal como los devuelve
// api.linear.app, con los ids reemplazados por UUID de mentira.

const ENDPOINT = "https://api.linear.app/graphql";

/** UUID de mentira, con la forma exacta que valida el proveedor. */
export const IDS = {
  epica: "c9a4f7d2-0b1e-4a3c-9f52-1a2b3c4d5e02",
  historia: "c9a4f7d2-0b1e-4a3c-9f52-1a2b3c4d5e01",
  historia2: "c9a4f7d2-0b1e-4a3c-9f52-1a2b3c4d5e03",
  tipoRaro: "c9a4f7d2-0b1e-4a3c-9f52-1a2b3c4d5e04",
  etiquetaProto: "c9a4f7d2-0b1e-4a3c-9f52-1a2b3c4d5e08",
  sinEtiquetas: "c9a4f7d2-0b1e-4a3c-9f52-1a2b3c4d5e05",
  epicaHija: "c9a4f7d2-0b1e-4a3c-9f52-1a2b3c4d5e06",
  cancelada: "c9a4f7d2-0b1e-4a3c-9f52-1a2b3c4d5e07",
  hecha: "c9a4f7d2-0b1e-4a3c-9f52-1a2b3c4d5e09",
  inexistente: "00000000-0000-4000-8000-0000000000ff",
  equipo: "7a1e0000-0000-4000-8000-00000000eeee",
  proyecto: "7a1e0000-0000-4000-8000-00000000dddd",
  hito: "7a1e0000-0000-4000-8000-00000000aaaa",
  ciclo: "7a1e0000-0000-4000-8000-00000000cccc",
  persona: "7a1e0000-0000-4000-8000-00000000bbbb",
};

const EQUIPO = { id: IDS.equipo, key: "ENG", name: "Ingeniería" };

/**
 * Los estados de workflow del equipo ENG, tal como los devuelve
 * `workflowStates`. Es el set por defecto de un equipo nuevo de Linear:
 * Backlog > Todo > In Progress > Done > Canceled. NO hay "Blocked" ni
 * "In Review", y eso no es un descuido del fixture: es el motivo por el que el
 * stateMap de este proveedor los declara `null`.
 */
const ESTADOS = [
  { id: "st-backlog", name: "Backlog", type: "backlog" },
  { id: "st-todo", name: "Todo", type: "unstarted" },
  { id: "st-progress", name: "In Progress", type: "started" },
  { id: "st-qa", name: "Listo para QA", type: "started" },
  { id: "st-done", name: "Done", type: "completed" },
  { id: "st-canceled", name: "Canceled", type: "canceled" },
];

const ETIQUETAS = [
  { id: "lbl-epic", name: "Epic" },
  { id: "lbl-feature", name: "Feature" },
  { id: "lbl-story", name: "Story" },
  { id: "lbl-task", name: "Task" },
  { id: "lbl-noxloop", name: "noxloop" },
];

function estado(nombre) {
  return ESTADOS.find((e) => e.name === nombre) || ESTADOS[0];
}

function etiqueta(nombre) {
  return ETIQUETAS.find((l) => l.name === nombre) || null;
}

const DESCRIPCION_HISTORIA = [
  "Como operador quiero que el ticket viaje solo hasta el PR.",
  "",
  "## Criterios de aceptación",
  "- [ ] Dado un ticket asignado, cuando el daemon lo toma, entonces queda en curso",
  "- [ ] Dado un PR abierto, cuando se anota en el ticket, entonces el adjunto apunta al PR",
  "",
  "## Notas",
  "- esto no es un criterio y no tiene que salir en `acceptance`",
].join("\n");

/**
 * Los issues grabados, indexados por UUID. La forma es exactamente la del
 * `Issue` que devuelve la query del proveedor.
 * @type {Record<string, any>}
 */
const ISSUES = {
  [IDS.epica]: {
    id: IDS.epica,
    identifier: "ENG-100",
    title: "Unificar el inicio de sesión",
    description: "## Criterios de aceptación\n- [ ] Dado un hito, cuando se despacha, entonces sus hijos se planifican",
    url: "https://linear.app/acme/issue/ENG-100/unificar-el-inicio-de-sesion",
    estimate: null,
    state: estado("In Progress"),
    parent: null,
    assignee: null,
    labels: { nodes: [etiqueta("Epic")] },
    team: EQUIPO,
    project: { id: IDS.proyecto, name: "Plataforma" },
    projectMilestone: null,
    cycle: null,
  },
  [IDS.historia]: {
    id: IDS.historia,
    identifier: "ENG-123",
    title: "El daemon toma el ticket asignado",
    description: DESCRIPCION_HISTORIA,
    url: "https://linear.app/acme/issue/ENG-123/el-daemon-toma-el-ticket-asignado",
    estimate: 3,
    state: estado("Todo"),
    parent: { id: IDS.epica, identifier: "ENG-100" },
    assignee: {
      id: IDS.persona,
      name: "noxloop",
      displayName: "noxloop[bot]",
      avatarUrl: "https://public.linear.app/avatars/7a1e0000-bbbb.png",
    },
    labels: { nodes: [etiqueta("Story")] },
    team: EQUIPO,
    project: { id: IDS.proyecto, name: "Plataforma" },
    projectMilestone: { id: IDS.hito, name: "Hito 1" },
    cycle: { id: IDS.ciclo, number: 42 },
  },
  [IDS.historia2]: {
    id: IDS.historia2,
    identifier: "ENG-124",
    title: "El PR queda adjunto al ticket",
    description: "## Criterios de aceptación\n- [ ] Dado un PR, entonces el ticket lo muestra",
    url: "https://linear.app/acme/issue/ENG-124/el-pr-queda-adjunto-al-ticket",
    estimate: 2,
    state: estado("In Progress"),
    parent: { id: IDS.epica, identifier: "ENG-100" },
    assignee: null,
    labels: { nodes: [etiqueta("Story")] },
    team: EQUIPO,
    project: null,
    projectMilestone: null,
    cycle: null,
  },
  [IDS.tipoRaro]: {
    id: IDS.tipoRaro,
    identifier: "ENG-777",
    title: "Etiqueta que no está en el mapa de niveles",
    description: "",
    url: "https://linear.app/acme/issue/ENG-777/etiqueta-que-no-esta-en-el-mapa",
    estimate: null,
    state: estado("Backlog"),
    parent: null,
    assignee: null,
    labels: { nodes: [{ id: "lbl-chore", name: "Chore" }] },
    team: EQUIPO,
    project: null,
    projectMilestone: null,
    cycle: null,
  },
  // Una etiqueta llamada "constructor". No es un caso de laboratorio: los
  // nombres de etiqueta en Linear son texto libre, y en un repo de JS alguien
  // etiqueta issues con "constructor", "toString" o "__proto__ " sin pensarlo.
  // El nivel se busca en un objeto por clave, asi que estos nombres devuelven
  // algo heredado del prototipo de Object en vez de caer en el default.
  [IDS.etiquetaProto]: {
    id: IDS.etiquetaProto,
    identifier: "ENG-666",
    title: "Etiquetada con el nombre de una propiedad de Object",
    description: "",
    url: "https://linear.app/acme/issue/ENG-666/etiqueta-constructor",
    estimate: null,
    state: estado("Todo"),
    parent: null,
    assignee: null,
    labels: { nodes: [{ id: "lbl-proto", name: "constructor" }, { id: "lbl-proto2", name: "toString" }] },
    team: EQUIPO,
    project: null,
    projectMilestone: null,
    cycle: null,
  },
  [IDS.sinEtiquetas]: {
    id: IDS.sinEtiquetas,
    identifier: "ENG-500",
    title: "Sin etiquetas y en un estado que el mapa no nombra",
    description: "",
    url: "https://linear.app/acme/issue/ENG-500/sin-etiquetas",
    estimate: null,
    // "Listo para QA" no está en el stateMap: obliga a caer en `state.type`.
    state: estado("Listo para QA"),
    parent: null,
    assignee: null,
    labels: { nodes: [] },
    team: EQUIPO,
    project: null,
    projectMilestone: null,
    cycle: null,
  },
  [IDS.epicaHija]: {
    id: IDS.epicaHija,
    identifier: "ENG-900",
    title: "Etiquetada Epic y además es hija de otra",
    description: "",
    url: "https://linear.app/acme/issue/ENG-900/etiquetada-epic-y-es-hija",
    estimate: null,
    state: estado("Todo"),
    // Tiene padre Y etiqueta Epic: un proveedor que dedujera el nivel de la
    // estructura la llamaria "task". El nivel sale del mapa de etiquetas.
    parent: { id: IDS.epica, identifier: "ENG-100" },
    assignee: null,
    labels: { nodes: [etiqueta("Epic")] },
    team: EQUIPO,
    project: null,
    projectMilestone: null,
    cycle: null,
  },
  [IDS.cancelada]: {
    id: IDS.cancelada,
    identifier: "ENG-321",
    title: "Cancelada: no tiene equivalente canónico",
    description: "",
    url: "https://linear.app/acme/issue/ENG-321/cancelada",
    estimate: null,
    state: estado("Canceled"),
    parent: null,
    assignee: null,
    labels: { nodes: [etiqueta("Task")] },
    team: EQUIPO,
    project: null,
    projectMilestone: null,
    cycle: null,
  },
};

/**
 * Un ticket TERMINADO: solo aparece en el listado con includeDone. Los demás
 * caminos no lo tocan.
 */
ISSUES[IDS.hecha] = {
  id: IDS.hecha,
  identifier: "ENG-50",
  title: "Ya está hecho",
  description: "",
  url: "https://linear.app/acme/issue/ENG-50/ya-esta-hecho",
  estimate: null,
  state: estado("Done"),
  parent: null,
  assignee: null,
  labels: { nodes: [etiqueta("Task")] },
  team: EQUIPO,
  project: null,
  projectMilestone: null,
  cycle: null,
};

/**
 * `priority` y `updatedAt` de cada issue, tal como los devuelve Linear:
 * `priority` es 0 sin prioridad, 1 urgente, 2 alta, 3 media, 4 baja. Van aparte
 * para no repetir el bloque en cada issue; el valor 0 está a propósito en
 * varios, porque es el que un proveedor descuidado traduce a "urgente".
 * @type {Record<string, {priority: number, updatedAt: string}>}
 */
const LISTADO = {
  [IDS.epica]: { priority: 1, updatedAt: "2026-09-21T10:00:00.000Z" },
  [IDS.historia]: { priority: 2, updatedAt: "2026-09-20T10:00:00.000Z" },
  [IDS.historia2]: { priority: 0, updatedAt: "2026-09-19T10:00:00.000Z" },
  [IDS.tipoRaro]: { priority: 4, updatedAt: "2026-09-18T10:00:00.000Z" },
  [IDS.etiquetaProto]: { priority: 3, updatedAt: "2026-09-17T10:00:00.000Z" },
  [IDS.sinEtiquetas]: { priority: 0, updatedAt: "2026-09-16T10:00:00.000Z" },
  [IDS.epicaHija]: { priority: 0, updatedAt: "2026-09-15T10:00:00.000Z" },
  [IDS.cancelada]: { priority: 0, updatedAt: "2026-09-14T10:00:00.000Z" },
  [IDS.hecha]: { priority: 3, updatedAt: "2026-09-13T10:00:00.000Z" },
};
for (const [id, extra] of Object.entries(LISTADO)) Object.assign(ISSUES[id], extra);

/**
 * Los hijos de la épica, en DOS páginas. `children(first: 50)` pagina, y un
 * hito con más hijos que la página perdería los últimos en silencio: el fixture
 * fuerza el segundo viaje.
 * @type {Record<string, any>}
 */
const HIJOS = {
  [IDS.epica]: {
    inicio: {
      nodes: [ISSUES[IDS.historia]],
      pageInfo: { hasNextPage: true, endCursor: "cursor-pagina-2" },
    },
    "cursor-pagina-2": {
      nodes: [ISSUES[IDS.historia2]],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  },
};

/**
 * Relaciones grabadas. ENG-124 depende de ENG-123 y bloquea a ENG-900; el
 * `related` está a propósito, para comprobar que no se cuela como dependencia.
 * @type {Record<string, any>}
 */
const RELACIONES = {
  [IDS.historia2]: {
    relations: {
      nodes: [
        { id: "rel-1", type: "blocks", relatedIssue: { id: IDS.epicaHija, identifier: "ENG-900" } },
        { id: "rel-2", type: "related", relatedIssue: { id: IDS.tipoRaro, identifier: "ENG-777" } },
      ],
    },
    inverseRelations: {
      nodes: [
        { id: "rel-3", type: "blocks", issue: { id: IDS.historia, identifier: "ENG-123" } },
        { id: "rel-4", type: "duplicate", issue: { id: IDS.cancelada, identifier: "ENG-321" } },
      ],
    },
  },
};

/** Notificaciones grabadas: dos de asignación (una repetida) y una mención. */
const NOTIFICACIONES = [
  { id: "ntf-1", type: "issueAssignedToYou", category: "assignments", readAt: null, issue: ISSUES[IDS.historia] },
  { id: "ntf-2", type: "issueAssignedToYou", category: "assignments", readAt: "2026-09-16T10:00:00.000Z", issue: ISSUES[IDS.historia] },
  { id: "ntf-3", type: "issueAssignedToYou", category: "assignments", readAt: null, issue: ISSUES[IDS.historia2] },
  { id: "ntf-4", type: "issueMention", category: "mentions", readAt: null, issue: ISSUES[IDS.tipoRaro] },
  { id: "ntf-5", type: "issueNewComment", category: "comments", readAt: null, issue: ISSUES[IDS.cancelada] },
];

/** Ids con los que el fixture provoca cada camino de error de la API. */
export const DISPARADORES = {
  /** getItem: el gestor contesta HTTP 200 con `errors[]` en el cuerpo. */
  errorDeGraphql: "ERR-1",
  /** getItem: HTTP 400 con `errors[].code == "RATELIMITED"`. */
  limiteDeTasa: "RATE-1",
  /** Escrituras: rechazo por permisos, con userPresentableMessage. */
  sinPermiso: "ENG-403",
};

export const MENSAJES = {
  sinPermiso: "No tenés permiso para editar este issue.",
  limiteDeTasa: "Se excedió el límite de peticiones; probá de nuevo más tarde.",
};

function respuesta(cuerpo, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorDeGraphql(mensaje, extensions = {}) {
  return respuesta({ data: null, errors: [{ message: mensaje, extensions }] });
}

function porIdentificador(key, number) {
  return (
    Object.values(ISSUES).find(
      (i) => i.team.key === key && Number(String(i.identifier).split("-")[1]) === Number(number),
    ) || null
  );
}

/** Resuelve el id que llega en las variables de una mutación o de `issue(id:)`. */
function porId(id) {
  if (ISSUES[id]) return ISSUES[id];
  const m = /^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/.exec(String(id || ""));
  return m ? porIdentificador(m[1], m[2]) : null;
}

let creados = 0;

/**
 * El servidor grabado. Linear tiene UNA ruta para todo, así que el despacho va
 * por el contenido de la query y no por el path: es lo mismo que hace el
 * servidor de verdad.
 */
function responder(query, variables) {
  // --- el listado del board. Va ANTES que el de getItem, que también es
  // `issues(filter:`: lo distingue la variable `$listado`.
  if (query.includes("$listado")) {
    const f = variables.listado || {};
    const porEquipo = (i) =>
      (f.team?.id?.eq && i.team.id === f.team.id.eq) || (f.team?.key?.eq && i.team.key === f.team.key.eq);
    const fuera = f.state?.type?.nin || [];
    const todos = Object.values(ISSUES)
      .filter(porEquipo)
      .filter((i) => !fuera.includes(i.state.type))
      // orderBy: updatedAt, del más reciente al más viejo, como Linear.
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const desde = variables.after ? Number(String(variables.after).replace("cursor-listado-", "")) : 0;
    const hasta = desde + Number(variables.first);
    const nodes = todos.slice(desde, hasta);
    const hasNextPage = hasta < todos.length;
    return respuesta({
      data: {
        issues: {
          nodes,
          pageInfo: { hasNextPage, endCursor: nodes.length ? `cursor-listado-${desde + nodes.length}` : null },
        },
      },
    });
  }

  // --- lecturas
  if (query.includes("issues(filter:")) {
    const f = variables.filtro || {};
    const key = f.team?.key?.eq;
    if (key === "ERR") {
      return errorDeGraphql("Argument Validation Error", {
        type: "invalid input",
        userPresentableMessage: "Entity not found: Issue",
      });
    }
    if (key === "RATE") {
      return respuesta(
        { errors: [{ message: "Rate limit exceeded", extensions: { code: "RATELIMITED", userPresentableMessage: MENSAJES.limiteDeTasa } }] },
        400,
      );
    }
    const encontrado = f.id?.eq ? ISSUES[f.id.eq] || null : porIdentificador(key, f.number?.eq);
    return respuesta({ data: { issues: { nodes: encontrado ? [encontrado] : [] } } });
  }

  if (query.includes("children(")) {
    const padre = porId(variables.id);
    const paginas = padre ? HIJOS[padre.id] : null;
    if (!paginas) return respuesta({ data: { issue: { children: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } });
    const pagina = paginas[variables.after || "inicio"];
    return respuesta({ data: { issue: { children: pagina } } });
  }

  if (query.includes("inverseRelations")) {
    const issue = porId(variables.id);
    const rel = (issue && RELACIONES[issue.id]) || { relations: { nodes: [] }, inverseRelations: { nodes: [] } };
    return respuesta({ data: { issue: rel } });
  }

  if (query.includes("workflowStates(")) {
    const encontrado = variables.team === EQUIPO.key ? estadoExacto(variables.name) : null;
    return respuesta({ data: { workflowStates: { nodes: encontrado ? [encontrado] : [] } } });
  }

  if (query.includes("issueLabels(")) {
    const l = etiqueta(variables.name);
    return respuesta({ data: { issueLabels: { nodes: l ? [l] : [] } } });
  }

  if (query.includes("notifications(")) {
    return respuesta({ data: { notifications: { nodes: NOTIFICACIONES } } });
  }

  // --- escrituras
  if (String(variables.id || variables.input?.parentId || "") === DISPARADORES.sinPermiso) {
    return errorDeGraphql("Access denied", {
      type: "authentication error",
      userPresentableMessage: MENSAJES.sinPermiso,
    });
  }

  if (query.includes("issueUpdate(")) {
    const issue = porId(variables.id);
    const st = ESTADOS.find((e) => e.id === variables.stateId) || null;
    if (!issue || !st) return errorDeGraphql("Argument Validation Error", { type: "invalid input" });
    return respuesta({ data: { issueUpdate: { success: true, issue: { id: issue.id, state: st } } } });
  }

  if (query.includes("commentCreate(")) {
    return respuesta({
      data: { commentCreate: { success: true, comment: { id: "cmt-1", url: "https://linear.app/acme/issue/ENG-123#comment-cmt-1" } } },
    });
  }

  if (query.includes("attachmentLinkGitHubPR(")) {
    return respuesta({ data: { attachmentLinkGitHubPR: { success: true, attachment: { id: "att-pr-1" } } } });
  }

  if (query.includes("attachmentLinkURL(")) {
    return respuesta({ data: { attachmentLinkURL: { success: true, attachment: { id: "att-1" } } } });
  }

  if (query.includes("issueAddLabel(")) {
    return respuesta({ data: { issueAddLabel: { success: true } } });
  }

  if (query.includes("issueCreate(")) {
    const input = variables.input || {};
    creados += 1;
    const nuevo = {
      id: `c9a4f7d2-0b1e-4a3c-9f52-1a2b3c4d5f${String(creados).padStart(2, "0")}`,
      identifier: `ENG-${200 + creados}`,
      title: input.title,
      description: input.description || "",
      url: `https://linear.app/acme/issue/ENG-${200 + creados}/creado-por-noxloop`,
      estimate: input.estimate ?? null,
      state: estado("Todo"),
      parent: input.parentId ? { id: input.parentId, identifier: porId(input.parentId)?.identifier ?? null } : null,
      assignee: input.assigneeId ? { id: input.assigneeId, name: "noxloop", displayName: "noxloop[bot]" } : null,
      labels: { nodes: (input.labelIds || []).map((id) => ETIQUETAS.find((l) => l.id === id)).filter(Boolean) },
      team: EQUIPO,
      project: input.projectId ? { id: input.projectId, name: "Plataforma" } : null,
      projectMilestone: input.projectMilestoneId ? { id: input.projectMilestoneId, name: "Hito 1" } : null,
      cycle: input.cycleId ? { id: input.cycleId, number: 42 } : null,
    };
    return respuesta({ data: { issueCreate: { success: true, issue: nuevo } } });
  }

  if (query.includes("team { id key }")) {
    const issue = porId(variables.id);
    if (!issue) return errorDeGraphql("Argument Validation Error", { type: "invalid input", userPresentableMessage: "Entity not found: Issue" });
    return respuesta({ data: { issue: { id: issue.id, team: issue.team } } });
  }

  throw new Error(`el fixture no tiene grabada una respuesta para esta query:\n${query}`);
}

function estadoExacto(nombre) {
  return ESTADOS.find((e) => e.name === nombre) || null;
}

/** El mapa de estados de este gestor, total y con los nulos declarados. */
export const MAPA_ESTADOS = {
  todo: "Todo",
  in_progress: "In Progress",
  // Linear no tiene "Blocked" en ninguna plantilla: las categorías son
  // Backlog/Unstarted/Started/Completed/Canceled. Declararlo null es la verdad.
  blocked: null,
  // Tampoco "In Review", salvo que el equipo lo haya creado a mano.
  in_review: null,
  // El motor nunca pide `done`: cerrar el ticket dice que está integrado.
  done: null,
};

/** El mapa de niveles: en Linear el "tipo" es el NOMBRE DE ETIQUETA. */
export const MAPA_NIVELES = {
  Epic: "epic",
  Feature: "feature",
  Story: "story",
  Task: "task",
  default: "story",
};

/**
 * Un `ctx` nuevo, con su propia bitácora de llamadas. Uno por test: contar
 * viajes a la API es parte de lo que se verifica (que `children` pagine, que
 * `getItem` haga UN viaje, que un id imposible no haga ninguno).
 *
 * @param {{options?: object, env?: object}} [overrides]
 */
export function nuevoCtx(overrides = {}) {
  /** @type {Array<{url: string, method: string, headers: Record<string, string>, query: string, variables: any}>} */
  const llamadas = [];

  const ctx = {
    options: {
      stateMap: { ...MAPA_ESTADOS },
      levelMap: { ...MAPA_NIVELES },
      ...(overrides.options || {}),
    },
    env: { LINEAR_API_KEY: "lin_api_GRABADA", ...(overrides.env || {}) },
    log: { info() {}, warn() {}, error() {} },
    /**
     * El `ctx.fetch` falso. Mismo contrato que el del motor: devuelve una
     * Response y no interpreta el cuerpo — por eso el proveedor tiene que
     * mirar `errors[]` por su cuenta.
     */
    fetch: async (url, init = {}) => {
      const cuerpo = JSON.parse(String(init.body || "{}"));
      llamadas.push({
        url: String(url),
        method: String(init.method || "GET"),
        headers: init.headers || {},
        query: String(cuerpo.query || ""),
        variables: cuerpo.variables || {},
      });
      if (String(url) !== ENDPOINT) throw new Error(`el fixture solo conoce ${ENDPOINT}, llego ${url}`);
      return responder(String(cuerpo.query || ""), cuerpo.variables || {});
    },
  };

  return { ctx, llamadas };
}

/** Lo que la suite de contrato necesita para ejercitar este proveedor. */
export const fixtures = {
  // `teamKey` porque `listItems` lista el espacio de UN equipo y sin él se
  // niega: el chequeo 9 de la suite necesita un equipo que listar.
  ...nuevoCtx({ options: { teamKey: "ENG" } }),
  defaultLevel: "story",
  // A propósito un identificador humano y no un UUID: prueba que el camino de
  // `team.key + number` también devuelve un Item válido.
  knownItemId: "ENG-123",
  unknownItemId: IDS.inexistente,
  unknownTypeItemId: "ENG-777",
  sourceUrl: new URL("./index.mjs", import.meta.url),
};
