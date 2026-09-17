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
];

export const CANONICAL_STATES = ["todo", "in_progress", "blocked", "in_review", "done"];
export const LEVELS = ["epic", "feature", "story", "task"];

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
    if (!(k in caps)) problems.push(`capabilities() no declara "${k}" (hay que declararla, aunque sea false)`);
    else if (typeof caps[k] !== "boolean") problems.push(`capabilities().${k} tiene que ser boolean`);
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
 * @param {{ctx: object, defaultLevel: string, knownItemId: string, unknownItemId: string, unknownTypeItemId: string, sourceUrl: URL}} fx
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
      name: "7. el mapa de estados es total y no inventa nativos",
      run: async () => {
        const mapa = fx.ctx.options?.stateMap;
        assert(mapa, "los fixtures no traen stateMap en ctx.options");
        for (const s of CANONICAL_STATES) {
          assert(s in mapa, `el mapa de estados no declara "${s}" (null es una respuesta valida)`);
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
  ];
}
