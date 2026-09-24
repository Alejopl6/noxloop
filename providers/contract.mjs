// La interfaz que todo gestor de tickets implementa, su validador, y la suite
// que cualquier proveedor tiene que pasar.
//
// POR QUE EXISTE ESTE ARCHIVO Y NO UN `if` EN EL MOTOR. El motor no conoce
// ningun gestor: pregunta capacidades y actua sobre lo que hay. Un proveedor
// nuevo es un archivo, y la prueba de que la costura funciona es que la MISMA
// suite corre contra todos — incluido el falso, que es el ejemplo minimo.
//
// EL FALLO QUE EVITA EL VALIDADOR. Una capacidad declarada en `true` sin su
// funcion no falla al cargar: falla a mitad de un recorrido, como una capacidad
// que no esta. `validateProvider` lo detecta ANTES de arrancar.

export const CAPABILITY_KEYS = [
  "children",
  "dependencies",
  "createChild",
  "setState",
  "comment",
  "linkUrl",
  "labels",
  "searchAssigned",
  "searchMentioned",
  "boardFields",
  // Si el gestor puede buscar por un responsable DECLARADO y no solo por el
  // dueño del token. Azure DevOps puede (WIQL acepta cualquier valor en
  // System.AssignedTo); GitHub y Linear no, y sin esta capacidad declarar un
  // responsable se ignoraba en silencio.
  "identityAssignee",
  // Si el gestor sabe LISTAR los tickets abiertos del espacio del proyecto (spec
  // 003, contracts/board-api.md §1). Es lo que llena Backlog y Todo del board.
  // Sin ella el board no queda vacio: muestra lo que el motor ya conoce del
  // proyecto y una nota que nombra al proveedor y la capacidad que le falta.
  "listItems",
  // Si el gestor sabe LISTAR sus estados de workflow (spec 005, FR-002). Es lo
  // que llena el editor visual del `stateMap`: una fila por estado REAL, con su
  // selector canonico. Sin ella el editor no inventa la lista: ofrece los
  // nombres que el mapa vigente ya declara, deja escribir uno a mano, y dice
  // por que (specs/005-linear-cola-y-handoffs/contracts/gestor-api.md §2).
  "listStates",
];

/**
 * Las capacidades que llegaron DESPUES de que existieran proveedores, y que por
 * eso se pueden omitir: ausente vale `false`.
 *
 * POR QUE NO SE EXIGEN COMO LAS DEMAS. Hacer obligatoria una clave nueva rompe
 * al cargar a todo proveedor escrito contra el contrato anterior —incluidos los
 * que viven fuera de este repositorio, que el motor carga por configuracion—, y
 * los rompe por algo que no usan. Omitirla es exactamente la degradacion
 * declarada: `can(mod, "listItems")` devuelve `available: false` con el motivo.
 * Lo que SI se exige es que, si se declara, sea boolean, y que en `true` venga
 * con su funcion. Los cuatro proveedores de este repositorio declaran
 * `listItems` explicita; `listStates` (spec 005) solo la declara Linear, y los
 * demas quedan en la degradacion declarada hasta que alguien la implemente.
 */
export const OPTIONAL_CAPABILITY_KEYS = ["listItems", "listStates"];

export const CANONICAL_STATES = ["todo", "in_progress", "blocked", "in_review", "done"];
export const LEVELS = ["epic", "feature", "story", "task"];

/**
 * Los estados en que puede venir un ticket LISTADO: los cinco canonicos mas
 * `backlog`.
 *
 * POR QUE `backlog` NO ENTRA EN CANONICAL_STATES. Los cinco de arriba son los
 * que `setState` sabe escribir y los que el `stateMap` de todo proyecto declara
 * (el chequeo 7 lo exige). `backlog` es solo de LECTURA: el board lo usa para
 * separar lo que todavia no se planifico de lo que esta por hacer, y solo
 * cuando el gestor lo distingue de verdad (Linear: tipo de estado `backlog`;
 * Azure DevOps: estado propuesto sin iteracion o mapeo explicito; GitHub: solo
 * con `stateMap.backlog` por etiqueta). Meterlo en el enum de escritura
 * obligaria a todo proyecto a declararlo, y un gestor que no lo tiene
 * terminaria inventando un nombre nativo para algo que no existe.
 */
export const LISTED_STATES = ["backlog", "todo", "in_progress", "blocked", "in_review", "done"];

/** Limites de `listItems`, del contrato: default 100, tope 500. */
export const LIST_DEFAULT_LIMIT = 100;
export const LIST_MAX_LIMIT = 500;

// Que funcion respalda cada capacidad. `searchAssigned` y `searchMentioned`
// comparten `searchInbox` a proposito: son dos senales de la misma consulta, y
// separarlas obligaria a dos viajes a la API para lo mismo.
export const CAPABILITY_FUNCTIONS = {
  children: "children",
  dependencies: "dependencies",
  createChild: "createChild",
  setState: "setState",
  comment: "comment",
  linkUrl: "linkUrl",
  labels: "addLabel",
  searchAssigned: "searchInbox",
  searchMentioned: "searchInbox",
  boardFields: null, // no es una funcion: es un campo del Item
  listItems: "listItems",
  listStates: "listStates",
  // NO tiene funcion propia, igual que `boardFields`: no es una operacion
  // nueva, es COMO se llama a `searchInbox`. Mapearla a `searchInbox` obligaba
  // a exportarla a un gestor con los dos disparos en false — que es legitimo:
  // se usa a mano, con el id del ticket. Lo cacho el test de esa fila.
  identityAssignee: null,
};

export class NotSupportedError extends Error {
  constructor(capacidad, proveedor) {
    super(`el proveedor ${proveedor} no soporta "${capacidad}"`);
    this.name = "NotSupportedError";
    this.capability = capacidad;
  }
}

/**
 * @param {object} mod el modulo del proveedor
 * @returns {{ok: boolean, problems: string[]}}
 */
export function validateProvider(mod) {
  const problems = [];
  if (!mod || typeof mod !== "object") return { ok: false, problems: ["el modulo no exporta nada"] };

  if (!mod.meta || typeof mod.meta.name !== "string") {
    problems.push("falta `meta` con un `name` (string)");
  }
  if (typeof mod.capabilities !== "function") {
    problems.push("falta `capabilities()`");
    return { ok: false, problems };
  }
  if (typeof mod.getItem !== "function") {
    problems.push("falta `getItem(id, ctx)`, que es obligatoria");
  }

  const caps = mod.capabilities() || {};
  for (const k of CAPABILITY_KEYS) {
    if (!(k in caps)) {
      // Una opcional ausente es la degradacion declarada, no un olvido: ver
      // OPTIONAL_CAPABILITY_KEYS.
      if (OPTIONAL_CAPABILITY_KEYS.includes(k)) continue;
      problems.push(`capabilities() no declara "${k}" (hay que declararla, aunque sea false)`);
    } else if (typeof caps[k] !== "boolean") problems.push(`capabilities().${k} tiene que ser boolean`);
  }
  for (const k of Object.keys(caps)) {
    if (!CAPABILITY_KEYS.includes(k)) problems.push(`capabilities() declara "${k}", que no es una capacidad conocida`);
  }

  for (const [cap, fn] of Object.entries(CAPABILITY_FUNCTIONS)) {
    if (!fn || !(cap in caps)) continue;
    if (caps[cap] === true && typeof mod[fn] !== "function") {
      problems.push(`declara "${cap}": true pero no exporta \`${fn}()\``);
    }
  }

  return { ok: problems.length === 0, problems };
}

/** @returns {{ok: boolean, problems: string[]}} */
export function validateItem(item) {
  const problems = [];
  if (!item || typeof item !== "object") return { ok: false, problems: ["el item no es un objeto"] };
  // `id` es string y no numero: Linear usa UUID y un gestor con ids numericos
  // que devuelva numeros rompe toda comparacion contra el estado persistido.
  if (typeof item.id !== "string" || !item.id) problems.push("id: tiene que ser un string no vacio");
  if (typeof item.title !== "string") problems.push("title: tiene que ser un string");
  if (!LEVELS.includes(item.level)) problems.push(`level: tiene que ser uno de ${LEVELS.join(", ")}, llego ${JSON.stringify(item.level)}`);
  if (typeof item.url !== "string" || !item.url) problems.push("url: tiene que ser un string no vacio");
  if (item.acceptance != null && !Array.isArray(item.acceptance)) problems.push("acceptance: tiene que ser un array de strings");
  if (item.canonicalState != null && !CANONICAL_STATES.includes(item.canonicalState)) {
    problems.push(`canonicalState: ${JSON.stringify(item.canonicalState)} no es canonico`);
  }
  return { ok: problems.length === 0, problems };
}

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Un ticket LISTADO: el `Item` de siempre mas lo que el board pinta en la
 * tarjeta (contracts/board-api.md §1).
 *
 * No se llama a `validateItem` tal cual por dos diferencias que son del
 * contrato y no descuidos: `canonicalState` admite `backlog` y es OBLIGATORIO
 * (un ticket sin columna no se puede pintar), y `assignee` es un objeto
 * `{id, name, avatarUrl?}` y no el string del `Item` —el board muestra nombre
 * y avatar, y un string no alcanza para las dos cosas—.
 *
 * `priority` es obligatoria como CLAVE y puede valer `null`: la diferencia entre
 * "este gestor no tiene prioridad" (null) y "el proveedor se olvido del campo"
 * (undefined) es la que evita que el board invente una.
 *
 * @returns {{ok: boolean, problems: string[]}}
 */
export function validateListedItem(item) {
  if (!item || typeof item !== "object") return { ok: false, problems: ["el item no es un objeto"] };
  const { canonicalState: _estado, assignee: _asignado, ...base } = item;
  const problems = [...validateItem(base).problems];

  if (!LISTED_STATES.includes(item.canonicalState)) {
    problems.push(`canonicalState: tiene que ser uno de ${LISTED_STATES.join(", ")}, llego ${JSON.stringify(item.canonicalState)}`);
  }
  if (!("priority" in item) || (item.priority !== null && !(Number.isInteger(item.priority) && item.priority >= 0 && item.priority <= 4))) {
    problems.push(`priority: tiene que ser un entero 0..4 o null (sin dato), llego ${JSON.stringify(item.priority)}`);
  }
  if (item.assignee !== null) {
    const a = item.assignee;
    const ok =
      a && typeof a === "object" && typeof a.id === "string" && a.id && typeof a.name === "string" &&
      (a.avatarUrl === undefined || a.avatarUrl === null || typeof a.avatarUrl === "string");
    if (!ok) problems.push(`assignee: tiene que ser {id, name, avatarUrl?} o null, llego ${JSON.stringify(a)}`);
  }
  if (item.team !== null && typeof item.team !== "string") {
    problems.push(`team: tiene que ser un string o null, llego ${JSON.stringify(item.team)}`);
  }
  if (!Array.isArray(item.labels) || item.labels.some((l) => typeof l !== "string")) {
    problems.push(`labels: tiene que ser un array de strings, llego ${JSON.stringify(item.labels)}`);
  }
  if (typeof item.updatedAt !== "string" || !ISO_8601.test(item.updatedAt) || Number.isNaN(Date.parse(item.updatedAt))) {
    problems.push(`updatedAt: tiene que ser una fecha ISO 8601, llego ${JSON.stringify(item.updatedAt)}`);
  }
  return { ok: problems.length === 0, problems };
}

/**
 * La consulta de `listItems`, normalizada: la misma para todo proveedor.
 *
 * Un limite que no es numero NO se interpreta (`"7"` cae en el default): el
 * servicio lo manda como numero, y adivinar en el proveedor es como dos gestores
 * terminan entendiendo cosas distintas por la misma consulta.
 *
 * @param {{limit?: number, cursor?: string|null, includeDone?: boolean}} [query]
 * @returns {{limit: number, cursor: string|null, includeDone: boolean}}
 */
export function listQuery(query) {
  const q = query && typeof query === "object" ? query : {};
  let limit = LIST_DEFAULT_LIMIT;
  if (typeof q.limit === "number" && Number.isFinite(q.limit)) {
    limit = Math.min(LIST_MAX_LIMIT, Math.max(1, Math.floor(q.limit)));
  }
  const cursor = typeof q.cursor === "string" && q.cursor ? q.cursor : null;
  return { limit, cursor, includeDone: q.includeDone === true };
}

/**
 * La pagina que devuelve `listItems`: `{items, nextCursor, total}`, cada item
 * valido, sin repetidos, sin pasarse del limite, y sin `done` si no se pidio.
 *
 * @param {any} page
 * @param {{limit?: number, includeDone?: boolean}} [query] la consulta que la produjo
 * @returns {{ok: boolean, problems: string[]}}
 */
export function validateListPage(page, query = {}) {
  const problems = [];
  if (!page || typeof page !== "object") return { ok: false, problems: ["la pagina no es un objeto"] };
  if (!Array.isArray(page.items)) {
    problems.push(`items: tiene que ser un array, llego ${JSON.stringify(page.items)}`);
    return { ok: false, problems };
  }
  if (!("nextCursor" in page) || (page.nextCursor !== null && (typeof page.nextCursor !== "string" || !page.nextCursor))) {
    problems.push(`nextCursor: tiene que ser un string no vacio o null, llego ${JSON.stringify(page.nextCursor)}`);
  }
  if (!("total" in page) || (page.total !== null && !(Number.isInteger(page.total) && page.total >= 0))) {
    problems.push(`total: tiene que ser un entero >= 0 o null (el gestor no lo da), llego ${JSON.stringify(page.total)}`);
  }
  const { limit, includeDone } = listQuery(query);
  if (page.items.length > limit) problems.push(`items: vinieron ${page.items.length} con limit ${limit}`);
  const vistos = new Set();
  page.items.forEach((item, i) => {
    const r = validateListedItem(item);
    for (const p of r.problems) problems.push(`items[${i}] (${JSON.stringify(item?.id)}): ${p}`);
    if (item && vistos.has(item.id)) problems.push(`items[${i}]: el id ${JSON.stringify(item.id)} vino repetido`);
    if (item) vistos.add(item.id);
    if (item?.canonicalState === "done" && !includeDone) {
      problems.push(`items[${i}]: vino en done sin includeDone — el board lo volveria a ofrecer para correr`);
    }
  });
  return { ok: problems.length === 0, problems };
}

/**
 * La lista que devuelve `listStates(ctx)`: los estados de workflow del espacio
 * del proyecto, en el orden en que el gestor los muestra.
 *
 * Cada uno es `{id, name, category, suggested}`:
 *   - `name` es lo que el `stateMap` guarda (el mapa es por NOMBRE, porque el
 *     id de un estado suele ser por equipo) y por eso no se puede repetir: dos
 *     estados homonimos harian que el selector de uno escriba el del otro;
 *   - `category` es el enum del gestor si lo tiene (Linear: `type`), o null;
 *   - `suggested` es la columna en que el proveedor LEERIA ese estado sin mapa
 *     (uno de LISTED_STATES) o null si no tiene equivalente: el editor lo
 *     propone, nunca lo guarda solo.
 *
 * @param {any} lista
 * @returns {{ok: boolean, problems: string[]}}
 */
export function validateStateList(lista) {
  if (!Array.isArray(lista)) return { ok: false, problems: [`tiene que ser un array, llego ${JSON.stringify(lista)}`] };
  const problems = [];
  const vistos = new Set();
  lista.forEach((e, i) => {
    if (!e || typeof e !== "object") {
      problems.push(`[${i}]: no es un objeto`);
      return;
    }
    if (typeof e.id !== "string" || !e.id) problems.push(`[${i}].id: tiene que ser un string no vacio`);
    if (typeof e.name !== "string" || !e.name.trim()) problems.push(`[${i}].name: tiene que ser un string no vacio`);
    if (e.category != null && typeof e.category !== "string") problems.push(`[${i}].category: string o null`);
    if (e.suggested != null && !LISTED_STATES.includes(e.suggested)) {
      problems.push(`[${i}].suggested: tiene que ser uno de ${LISTED_STATES.join(", ")} o null, llego ${JSON.stringify(e.suggested)}`);
    }
    if (typeof e.name === "string") {
      if (vistos.has(e.name)) problems.push(`[${i}].name: ${JSON.stringify(e.name)} vino repetido`);
      vistos.add(e.name);
    }
  });
  return { ok: problems.length === 0, problems };
}

/**
 * Consulta una capacidad antes de usarla, y devuelve la degradacion declarada
 * en vez de reventar. Es la funcion que el motor usa en cada punto donde una
 * capacidad podria no estar.
 *
 * @returns {{available: boolean, reason?: string}}
 */
export function can(mod, capacidad) {
  const caps = mod.capabilities() || {};
  if (caps[capacidad] === true) return { available: true };
  return {
    available: false,
    reason: `el proveedor ${mod.meta?.name || "?"} no soporta "${capacidad}"`,
  };
}

/**
 * La suite de contrato. Devuelve una lista de chequeos con nombre para que cada
 * proveedor la recorra con el runner que quiera.
 *
 * @param {object} mod
 * @param {{ctx: object, defaultLevel: string, knownItemId: string, unknownItemId: string, unknownTypeItemId: string, sourceUrl: URL, listLimit?: number}} fx
 *   `listLimit` es el limite con que el chequeo 9 pide la primera pagina (2 por
 *   defecto, para que el cursor se ejercite con fixtures chicos).
 */
export function contractChecks(mod, fx) {
  const assert = (cond, mensaje) => {
    if (!cond) throw new Error(mensaje);
  };

  return [
    {
      name: "1. capabilities() declara exactamente las claves conocidas",
      run: async () => {
        const r = validateProvider(mod);
        assert(r.ok, `validateProvider fallo:\n  - ${r.problems.join("\n  - ")}`);
      },
    },
    {
      name: "2. cada capacidad en true tiene su funcion exportada",
      run: async () => {
        const caps = mod.capabilities();
        for (const [cap, fn] of Object.entries(CAPABILITY_FUNCTIONS)) {
          if (fn && caps[cap] === true) assert(typeof mod[fn] === "function", `${cap}: falta ${fn}()`);
        }
      },
    },
    {
      name: "3. una capacidad en false no expone una funcion a medias",
      run: async () => {
        const caps = mod.capabilities();
        for (const [cap, fn] of Object.entries(CAPABILITY_FUNCTIONS)) {
          if (!fn || caps[cap] !== false) continue;
          // Compartida por dos capacidades: solo cuenta si las dos estan en false.
          if (fn === "searchInbox" && (caps.searchAssigned || caps.searchMentioned)) continue;
          if (typeof mod[fn] !== "function") continue;
          let lanzo = false;
          try {
            await mod[fn](fx.knownItemId, fx.ctx, fx.ctx);
          } catch (e) {
            lanzo = e instanceof NotSupportedError;
          }
          assert(lanzo, `${cap} esta en false pero ${fn}() no lanza NotSupportedError: el motor la llamaria creyendo que anda`);
        }
      },
    },
    {
      name: "4. getItem de un id inexistente devuelve null, no lanza",
      run: async () => {
        const r = await mod.getItem(fx.unknownItemId, fx.ctx);
        assert(r === null, `devolvio ${JSON.stringify(r)} en vez de null`);
      },
    },
    {
      name: "5. todo Item devuelto valida contra el modelo canonico",
      run: async () => {
        const item = await mod.getItem(fx.knownItemId, fx.ctx);
        assert(item, "el item conocido de los fixtures no existe");
        const r = validateItem(item);
        assert(r.ok, `el item no valida:\n  - ${r.problems.join("\n  - ")}`);
      },
    },
    {
      name: "6. un tipo nativo desconocido cae en el nivel por defecto, sin fallar",
      run: async () => {
        const item = await mod.getItem(fx.unknownTypeItemId, fx.ctx);
        assert(item, "el item de tipo desconocido de los fixtures no existe");
        assert(
          item.level === fx.defaultLevel,
          `nivel ${item.level} en vez del default ${fx.defaultLevel}: el nivel se esta deduciendo del nombre del tipo`,
        );
      },
    },
    {
      name: "7. el mapa de estados es total, y el proveedor no inventa un nativo que no esta",
      run: async () => {
        const mapa = fx.ctx.options?.stateMap;
        assert(mapa, "los fixtures no traen stateMap en ctx.options");
        for (const s of CANONICAL_STATES) {
          assert(s in mapa, `el mapa de estados no declara "${s}" (null es una respuesta valida)`);
        }

        // LO DE ARRIBA VALIDA EL FIXTURE; ESTO VALIDA EL PROVEEDOR, y es la
        // diferencia que importa. La primera mitad la controla quien escribe el
        // fixture, asi que por si sola no prueba nada del codigo: un proveedor
        // que inventara el nombre nativo pasaria igual.
        //
        // Aca se le pasa un ctx con el mapa INCOMPLETO y se exige que no
        // escriba nada. Un nombre de estado inventado mueve un ticket a un
        // estado que el proyecto no tiene, y el gestor contesta un error que no
        // se lee como lo que es.
        if (!mod.capabilities().setState || typeof mod.setState !== "function") return;

        for (const canonico of CANONICAL_STATES) {
          const sinEse = { ...mapa };
          delete sinEse[canonico];
          const ctxParcial = { ...fx.ctx, options: { ...fx.ctx.options, stateMap: sinEse } };
          let r;
          try {
            r = await mod.setState(fx.knownItemId, canonico, ctxParcial);
          } catch (e) {
            // Negarse lanzando tambien es correcto: lo que no vale es escribir.
            continue;
          }
          assert(
            !r || r.written === null || r.written === undefined,
            `con "${canonico}" ausente del mapa, setState devolvio written=${JSON.stringify(r?.written)}: ` +
              `el nombre nativo se invento`,
          );
        }
      },
    },
    {
      name: "8. ninguna funcion lee process.env: el ctx no se puede saltear",
      run: async () => {
        const { readFileSync } = await import("node:fs");
        const fuente = readFileSync(fx.sourceUrl, "utf8");
        const sinComentarios = fuente.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
        assert(
          !/process\.env/.test(sinComentarios),
          "lee process.env directamente: las credenciales y opciones llegan por ctx",
        );
      },
    },
    {
      name: "9. listItems: en true lista paginas validas y el cursor avanza; en false la degradacion esta declarada",
      run: async () => {
        const caps = mod.capabilities() || {};
        if (caps.listItems !== true) {
          // Sin la capacidad no se llama NADA: la decision del board sale de
          // `can()`, y una llamada "a ver si anda" es un viaje a la API por
          // tarjeta que el gestor ya dijo que no puede contestar.
          const r = can(mod, "listItems");
          assert(!r.available, "listItems no esta en true pero can() la da por disponible");
          assert(/listItems/.test(String(r.reason)), `el motivo no nombra la capacidad: ${r.reason}`);
          return;
        }

        // Limite chico A PROPOSITO: con el default (100) ningun fixture llega a
        // la segunda pagina, y el cursor —que es donde los proveedores se
        // equivocan— quedaria sin probar.
        const limit = fx.listLimit ?? 2;
        const p1 = await mod.listItems({ limit }, fx.ctx);
        const v1 = validateListPage(p1, { limit });
        assert(v1.ok, `la primera pagina no valida:\n  - ${v1.problems.join("\n  - ")}`);
        assert(p1.items.length > 0, "los fixtures no traen ningun ticket abierto: el chequeo no prueba nada");

        if (p1.nextCursor) {
          const p2 = await mod.listItems({ limit, cursor: p1.nextCursor }, fx.ctx);
          const v2 = validateListPage(p2, { limit });
          assert(v2.ok, `la pagina del cursor no valida:\n  - ${v2.problems.join("\n  - ")}`);
          const antes = new Set(p1.items.map((/** @type {any} */ i) => i.id));
          const repetidos = p2.items.filter((/** @type {any} */ i) => antes.has(i.id)).map((/** @type {any} */ i) => i.id);
          assert(
            repetidos.length === 0,
            `el cursor ${JSON.stringify(p1.nextCursor)} devolvio otra vez ${repetidos.join(", ")}: ` +
              `un cursor que no avanza hace girar al board para siempre`,
          );
        }
      },
    },
    {
      name: "10. listStates: en true lista estados validos y no vacios; en false la degradacion esta declarada",
      run: async () => {
        const caps = mod.capabilities() || {};
        if (caps.listStates !== true) {
          const r = can(mod, "listStates");
          assert(!r.available, "listStates no esta en true pero can() la da por disponible");
          assert(/listStates/.test(String(r.reason)), `el motivo no nombra la capacidad: ${r.reason}`);
          return;
        }
        const estados = await mod.listStates(fx.ctx);
        const v = validateStateList(estados);
        assert(v.ok, `la lista de estados no valida:\n  - ${v.problems.join("\n  - ")}`);
        // Una lista vacia de un gestor que dice saber listar se leeria como «el
        // equipo no tiene estados»: el editor quedaria sin filas y sin motivo.
        assert(estados.length > 0, "listStates en true devolvio una lista vacia con los fixtures");
      },
    },
  ];
}
