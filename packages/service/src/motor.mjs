// El puente proyecto-motor: la configuracion del motor, DERIVADA del proyecto.
//
// -----------------------------------------------------------------------------
// EL HUECO QUE CIERRA
// -----------------------------------------------------------------------------
//
// Hasta la spec 003 ningun camino del producto llevaba de un proyecto del
// Studio a una configuracion del motor. El test de punta a punta la armaba a
// mano, y `POST /v1/projects/:id/runs` contestaba `pieza_ausente`. Todo lo que
// el board promete —el boton Run, la tarjeta que pasa a En curso— cuelga de
// esta pieza.
//
// -----------------------------------------------------------------------------
// POR QUE DERIVADA Y NO GUARDADA
// -----------------------------------------------------------------------------
//
// La configuracion del motor NO es un dato nuevo: es otra forma de decir cosas
// que el almacen y el repositorio ya saben. El remoto esta en el proyecto o en
// `.git/config`; el gate es el runner que el snapshot detecto; el gestor es la
// conexion viva del proyecto. Guardarla seria una segunda copia de esos hechos,
// y la primera vez que el operador corrija el runner en Settings las dos copias
// dirian cosas distintas — con el motor leyendo la vieja. Se compone en cada
// lanzamiento y se escribe a `<home>/motor/<proyecto>.config.json` solo porque
// la CLI del motor lee un archivo; ese archivo es un transporte, no una fuente.
//
// -----------------------------------------------------------------------------
// LO QUE NO SE SABE NO SE RELLENA (principio X)
// -----------------------------------------------------------------------------
//
// Sin remoto, `sin_repo`. Sin runner detectado, `sin_gate`. Con un gestor
// DECLARADO que el motor no sabe usar, `sin_gestor`. Cada uno con lo que se busco y lo que se
// encontro. La tentacion es poner `npm test` porque casi todos los proyectos de
// Node lo tienen: el dia que no, el gate falla en cada tarea, el run entero se
// bloquea, y la causa aparece tres pantallas despues como «tests rotos».
//
// -----------------------------------------------------------------------------
// POR QUE ESTE MODULO NO IMPORTA EL MOTOR NI LOS PROVEEDORES
// -----------------------------------------------------------------------------
//
// Lo que se compone es un JSON; quien lo carga es el subproceso. Importar el
// motor aqui invitaria a llamarlo en proceso —y un motor en el proceso del
// servicio es un segundo escritor del estado del run con el mismo pid—. Los
// proveedores se cargan por ruta y SOLO para preguntarles que variables piden y
// que tickets tienen (`cargarGestor`), nunca para ejecutar el recorrido.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

import { slugDe } from "./comun.mjs";
import { ErrorDeServicio } from "./errores.mjs";

/**
 * Donde viven los proveedores del motor, por defecto: `providers/` en la raiz
 * del repositorio. Inyectable, porque en el escritorio el arbol es otro.
 */
export const RAIZ_DE_PROVEEDORES = new URL("../../../providers/", import.meta.url).pathname;

/**
 * El tope de runs simultaneos por proyecto cuando nadie declaro otro. Es el
 * `default` de `limits.maxParallelItems` en el esquema del motor: dos valores
 * por defecto distintos para el mismo limite serian dos respuestas a «cuantos
 * corren a la vez».
 */
export const MAX_PARALELO_POR_DEFECTO = 2;

/**
 * El `stateMap` que se usa cuando la conexion no declara uno, por gestor.
 *
 * Solo el falso lo necesita: es el mismo mapa que declaran sus fixtures, y sin
 * el no sabe escribir el estado del ticket. Los gestores reales traen el suyo o
 * lo reciben de la conexion (`capacidades.stateMap`): este archivo no conoce
 * los nombres de estado de nadie.
 *
 * @type {Record<string, Record<string, string|null>>}
 */
const ESTADOS_POR_DEFECTO = Object.freeze({
  fake: Object.freeze({ todo: "Nuevo", in_progress: "En curso", blocked: "Bloqueado", in_review: null, done: null }),
  // El gestor local: su nativo ES el canonico. `done` en `null` a proposito:
  // el motor no cierra tareas, la autonomia termina en el PR (principio IV).
  local: Object.freeze({ todo: "todo", in_progress: "in_progress", blocked: "blocked", in_review: "in_review", done: null }),
});

/**
 * El nombre del gestor local (`providers/local/`). Es el gestor de un proyecto
 * que no conecto ninguno: sus tareas viven en el almacen de este servicio.
 */
export const GESTOR_LOCAL = "local";

/**
 * De la conexion del almacen al proveedor del motor.
 *
 * LA REGLA ES DE DATOS, NO UNA TABLA DE GESTORES: el `proveedor` de la conexion
 * es el slug del catalogo de `packages/connections`, y los proveedores del
 * motor viven en `providers/<slug>/index.mjs` con ese mismo nombre. Si el
 * archivo existe, ese es el gestor; si no, no hay proveedor para el y se dice
 * (`sin_gestor`) en vez de sustituirlo por otro. Agregar un gestor sigue siendo
 * agregar un directorio en `providers/` (principio VI), sin tocar este archivo.
 *
 * El unico alias es el del doble sin red: `falso-oauth2` es el tracker del
 * adaptador falso de conexiones y va al proveedor falso del motor. Es lo que
 * deja recorrer de punta a punta sin la cuenta de nadie.
 */
const ALIAS_DE_GESTOR = Object.freeze({ "falso-oauth2": "fake" });

/**
 * El nombre del proveedor del motor para el slug de una conexion, o `null`.
 *
 * @param {string} slug
 * @param {string} [raiz]
 */
export function gestorDelSlug(slug, raiz = RAIZ_DE_PROVEEDORES) {
  const nombre = /** @type {any} */ (ALIAS_DE_GESTOR)[slug] ?? slug;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(nombre)) return null;
  return existsSync(join(raiz, nombre, "index.mjs")) ? nombre : null;
}

/**
 * El comando del gate para cada runner que el scanner sabe nombrar.
 *
 * Solo los que tienen UNA forma canonica de invocarse. Un runner que se lanza
 * de tres maneras segun el proyecto (karma, cypress) no entra: elegir una seria
 * suponer, y un gate supuesto es peor que ninguno.
 */
const GATE_POR_RUNNER = Object.freeze({
  pytest: "pytest",
  tox: "tox",
  unittest: "python -m unittest",
  "cargo test": "cargo test",
  "go test": "go test ./...",
  rspec: "bundle exec rspec",
  phpunit: "vendor/bin/phpunit",
  "dotnet test": "dotnet test",
  maven: "mvn test",
  jest: "npx jest",
  vitest: "npx vitest run",
});

/**
 * Como correr UN test suelto con cada runner, para el bucle RED/GREEN del
 * motor (`repos.<x>.runners`). Sin esto el motor no puede verificar que el
 * test se vio fallar antes de implementar, y la tarea se bloquea. Solo los
 * runners que aceptan un archivo como argumento, sin mas.
 */
const SUELTO_POR_RUNNER = Object.freeze({
  "node --test": "node --test {file}",
  jest: "npx jest {file}",
  vitest: "npx vitest run {file}",
  mocha: "npx mocha {file}",
  pytest: "pytest {file}",
  rspec: "bundle exec rspec {file}",
  phpunit: "vendor/bin/phpunit {file}",
});

/**
 * El gate a partir del hallazgo `testing.runner`.
 *
 * SI LA EVIDENCIA ES EL `package.json`, EL GATE ES `npm test` sea cual sea el
 * runner. No es un atajo: el scanner lo detecto leyendo `scripts.test`, y
 * `npm test` corre EXACTAMENTE ese script — con sus banderas, su cobertura y su
 * preparacion. Traducirlo a `node --test` perderia todo lo que el proyecto puso
 * alrededor.
 *
 * @param {any} valor
 * @param {any[]} [evidencia]
 * @returns {{comando: string, de: string, suelto: string|null}|null}
 */
export function gateDelRunner(valor, evidencia = []) {
  if (typeof valor !== "string" || !valor.trim()) return null;
  const rutas = (Array.isArray(evidencia) ? evidencia : []).map((e) => e && e.ruta).filter(Boolean);
  const suelto = /** @type {any} */ (SUELTO_POR_RUNNER)[valor.trim()] ?? null;
  if (rutas.includes("package.json")) {
    return { comando: "npm test", de: `\`testing.runner = ${valor}\`, leido de \`scripts.test\` en package.json`, suelto };
  }
  const comando = /** @type {any} */ (GATE_POR_RUNNER)[valor.trim()];
  if (!comando) return null;
  return { comando, de: `\`testing.runner = ${valor}\`${rutas.length ? ` (${rutas.join(", ")})` : ""}`, suelto };
}

/**
 * `owner/repo` de un remoto, o `null`.
 *
 * GENERICO A PROPOSITO: el host no se compara contra ningun nombre (principio
 * VII, y la guarda de nombres propios lo comprueba). Lo que se exige es la
 * FORMA de un remoto de forja —`usuario@host:owner/repo` o
 * `esquema://host/owner/repo`—: una ruta local (`/srv/origin.git`) no la tiene,
 * y sacarle un `owner` seria inventarlo. Que el gestor sea el de ese host lo
 * decide la conexion, no esta funcion.
 *
 * @param {string|null|undefined} remoto
 * @returns {{host: string, owner: string, repo: string}|null}
 */
export function repoDelRemoto(remoto) {
  if (typeof remoto !== "string") return null;
  const t = remoto.trim();
  const m =
    /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(t) ??
    /^[^@\s/]+@([^:/\s]+):([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(t);
  return m ? { host: m[1], owner: m[2], repo: m[3] } : null;
}

/**
 * El remoto `origin` y la rama actual, LEIDOS A MANO de `.git/`.
 *
 * POR QUE NO `git remote get-url`. Por lo mismo que `commitDe` del escaneo lee
 * `.git/HEAD` a mano: el board llama a esto en cada pintada, y hay comandos de
 * git que escriben con solo consultarlos (`git status` refresca el indice). Un
 * lector que escribe en el repositorio del operador rompe el invariante del
 * board (SC-007), y leer dos archivos de texto no puede escribir nada.
 *
 * @param {string} ruta
 * @returns {{remoto: string|null, rama: string|null}}
 */
export function leerGit(ruta) {
  let remoto = null;
  let rama = null;
  try {
    const config = readFileSync(join(ruta, ".git", "config"), "utf8");
    const bloque = /\[remote "origin"\]([^[]*)/.exec(config);
    const url = bloque ? /^\s*url\s*=\s*(.+?)\s*$/m.exec(bloque[1]) : null;
    remoto = url ? url[1] : null;
  } catch {
    /* sin `.git/config` no hay remoto que leer: se dice `null`, no se inventa */
  }
  try {
    const head = readFileSync(join(ruta, ".git", "HEAD"), "utf8").trim();
    const m = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    rama = m ? m[1] : null;
  } catch {
    /* idem */
  }
  return { remoto, rama };
}

/**
 * El hallazgo `testing.runner` vigente del proyecto, o por que no lo hay.
 *
 * `valor_corregido` GANA, igual que en la flota y en el nucleo: lo que vale es
 * lo que el operador corrigio. Un hallazgo DESCARTADO no da gate: el operador
 * dijo que eso no es verdad, y usarlo igual seria ignorar la unica correccion
 * humana del recorrido.
 *
 * @param {any} dep
 * @param {any} proyecto
 */
function gateDelSnapshot(dep, proyecto) {
  const snapshot = dep.almacen.base.consultarUno(
    "SELECT * FROM project_snapshot WHERE project_id = ? AND estado = 'completo' ORDER BY creado DESC LIMIT 1",
    [proyecto.id],
  );
  if (!snapshot) return { gate: null, hallado: "el proyecto no tiene ningun snapshot completo del que sacar el runner" };

  const hallazgo = dep.almacen.snapshots
    .hallazgos(snapshot.id)
    .find((/** @type {any} */ h) => h.clave === "testing.runner");
  if (!hallazgo) return { gate: null, hallado: "el ultimo snapshot no trae el hallazgo `testing.runner`" };
  if (hallazgo.decision === "descartado") {
    return { gate: null, hallado: "el hallazgo `testing.runner` del ultimo snapshot fue descartado por el operador" };
  }

  const leer = (/** @type {any} */ t) => {
    try {
      return JSON.parse(String(t));
    } catch {
      return null;
    }
  };
  const valor = hallazgo.valor_corregido !== null && hallazgo.valor_corregido !== undefined
    ? leer(hallazgo.valor_corregido)
    : leer(hallazgo.valor);
  // Si el operador CORRIGIO el valor, la evidencia original ya no lo respalda:
  // era evidencia de lo que el scanner creyo, no de la correccion.
  const evidencia = hallazgo.valor_corregido !== null && hallazgo.valor_corregido !== undefined ? [] : leer(hallazgo.evidencia);
  if (valor === null) {
    return { gate: null, hallado: "el snapshot busco el runner de tests y no encontro ninguno (`testing.runner = null`)" };
  }
  const gate = gateDelRunner(valor, evidencia ?? []);
  if (!gate) {
    return {
      gate: null,
      hallado: `el runner detectado es \`${valor}\`, y no tiene una forma canonica de invocarse que no sea suponerla`,
    };
  }
  return { gate, hallado: gate.de };
}

/**
 * El gestor del proyecto, de sus conexiones vivas.
 *
 * EL ORDEN: un `tracker` vivo del PROYECTO manda, porque es lo que el operador
 * conecto como gestor de ESTE proyecto. Si es uno que el motor no sabe usar, NO
 * se cae a otro: seria ejecutar tickets de un sitio distinto del que el
 * operador declaro. Solo sin tracker, una cuenta de codigo (`scm`, del proyecto
 * o del espacio de trabajo) cuyo slug tiene proveedor hace de gestor: es el
 * caso de la forja que ademas lleva los issues, y lo decide que exista
 * `providers/<slug>/`, no un nombre escrito aqui.
 *
 * @param {any} dep
 * @param {any} proyecto
 * @param {string} raiz donde estan los proveedores
 * @returns {{gestor: {nombre: string, slug: string, conexion: string|null, origen: string, credencial: string|null, stateMap?: any, opciones?: any}|null, hallado: string}}
 */
function gestorDelProyecto(dep, proyecto, raiz) {
  const vivas = dep.almacen.base.consultar(
    "SELECT * FROM connection WHERE estado = 'viva' AND (project_id = ? OR (project_id IS NULL AND workspace_id = ?)) " +
      "ORDER BY project_id IS NULL, id",
    [proyecto.id, proyecto.workspace_id],
  );
  const nombreDe = (/** @type {any} */ c) => gestorDelSlug(String(c.proveedor), raiz);
  const aGestor = (/** @type {any} */ c, /** @type {string} */ origen) => {
    const nombre = /** @type {string} */ (nombreDe(c));
    /** @type {any} */
    let capacidades = {};
    try {
      capacidades = JSON.parse(String(c.capacidades || "{}")) ?? {};
    } catch {
      /* una columna con JSON roto no da opciones; tampoco tumba el board */
    }
    return {
      nombre,
      slug: String(c.proveedor),
      conexion: String(c.id),
      origen,
      credencial: c.credential_id ? String(c.credential_id) : null,
      // El `stateMap` y las opciones del proveedor (organizacion, equipo...)
      // vienen de la conexion y no de este archivo: el servicio no conoce los
      // nombres de estado ni las organizaciones de nadie (principio VII).
      stateMap: capacidades.stateMap ?? /** @type {any} */ (ESTADOS_POR_DEFECTO)[nombre],
      opciones: capacidades.opcionesDelGestor,
    };
  };

  const tracker = vivas.find((/** @type {any} */ c) => c.clase === "tracker" && c.project_id);
  if (tracker) {
    if (!nombreDe(tracker)) {
      return {
        gestor: null,
        hallado:
          `el tracker conectado es \`${tracker.proveedor}\` y el motor no tiene proveedor para el ` +
          `(no existe \`providers/${tracker.proveedor}/index.mjs\`)`,
      };
    }
    return { gestor: aGestor(tracker, "tracker"), hallado: `la conexion tracker \`${tracker.proveedor}\`` };
  }

  const forja = vivas.find((/** @type {any} */ c) => c.clase === "scm" && nombreDe(c));
  if (forja) {
    return { gestor: aGestor(forja, "scm"), hallado: `la cuenta de codigo \`${forja.proveedor}\`, que lleva los issues` };
  }

  // Un tracker del espacio de trabajo tambien vale si el motor lo sabe usar.
  const delEspacio = vivas.find((/** @type {any} */ c) => c.clase === "tracker" && nombreDe(c));
  if (delEspacio) {
    return {
      gestor: aGestor(delEspacio, "tracker"),
      hallado: `la conexion tracker \`${delEspacio.proveedor}\` del espacio de trabajo`,
    };
  }

  // SIN GESTOR EXTERNO, EL LOCAL (spec 003, FR-030). Hasta aqui un proyecto
  // sin tracker ni forja con issues era `sin_gestor` y su board quedaba vacio
  // hasta conectar Linear. Ahora sus tareas son las que el operador crea en
  // noxloop. Solo aqui, al final: si el operador DECLARO un tracker —aunque el
  // motor no sepa usarlo— se le dice arriba, y no se cambia por el local sin
  // avisar: serian tickets de otro sitio del que declaro.
  if (gestorDelSlug(GESTOR_LOCAL, raiz)) {
    return {
      gestor: {
        nombre: GESTOR_LOCAL,
        slug: GESTOR_LOCAL,
        conexion: null,
        origen: "local",
        credencial: null,
        stateMap: /** @type {any} */ (ESTADOS_POR_DEFECTO)[GESTOR_LOCAL],
        // Las opciones del gestor local las sabe el servicio: de que proyecto
        // son las tareas. No hay conexion de la que leerlas.
        opciones: { projectId: String(proyecto.id) },
      },
      hallado: vivas.length
        ? `ninguna de las conexiones vivas (${vivas.map((/** @type {any} */ c) => `${c.clase}:${c.proveedor}`).join(", ")}) ` +
          "es un gestor de tickets: se usan las tareas propias del proyecto"
        : "el proyecto no conecto ningun gestor: se usan sus tareas propias",
    };
  }

  return {
    gestor: null,
    hallado: vivas.length
      ? `las conexiones vivas del proyecto (${vivas.map((/** @type {any} */ c) => `${c.clase}:${c.proveedor}`).join(", ")}) ` +
        "no incluyen un gestor de tickets con proveedor en el motor, y el gestor local no esta instalado"
      : "el proyecto no tiene ninguna conexion viva, y el gestor local no esta instalado",
  };
}

/**
 * Todo lo que el motor necesita saber del proyecto, LEIDO. No escribe nada, no
 * lanza nunca: lo que falta vuelve como `null` con el motivo al lado.
 *
 * @param {any} dep
 * @param {any} proyecto
 * @param {{raizDeProveedores?: string}} [opts]
 */
export function datosDelProyecto(dep, proyecto, opts = {}) {
  const git = leerGit(String(proyecto.ruta_local));
  const remoto = proyecto.remoto ? String(proyecto.remoto) : git.remoto;
  const { gate, hallado: gateHallado } = gateDelSnapshot(dep, proyecto);
  const { gestor, hallado: gestorHallado } = gestorDelProyecto(dep, proyecto, opts.raizDeProveedores ?? RAIZ_DE_PROVEEDORES);
  return { proyecto, remoto, ramaBase: git.rama ?? "main", gate, gateHallado, gestor, gestorHallado };
}

/**
 * Las opciones del proveedor para este proyecto: las que declara la conexion,
 * mas `owner/repo` del remoto si el esquema del proveedor las pide. Lanza
 * `sin_gestor` si el esquema EXIGE algo que nadie declara.
 *
 * Aparte de `componerConfig` porque el board la necesita sola: para listar los
 * tickets de un proyecto hacen falta las opciones del gestor aunque el proyecto
 * no se pueda lanzar (sin gate, por ejemplo). Un board que no muestra tickets
 * porque falta el gate confundiria «no hay trabajo» con «no se puede correr».
 *
 * @param {{proyecto: any, remoto: string|null, gestor: any, esquemaDeOpciones?: any}} e
 * @returns {Record<string, any>}
 */
export function opcionesDelGestor({ proyecto, remoto, gestor, esquemaDeOpciones }) {
  // LAS OPCIONES DEL PROVEEDOR, CONTRA EL ESQUEMA QUE EL PROVEEDOR DECLARA.
  // Lo que el esquema pide y el remoto sabe (`owner`, `repo`) se deriva del
  // remoto; lo que pide y nadie sabe se dice ahora, al pulsar Run, y no en el
  // stderr de un subproceso que el motor valida al cargar.
  /** @type {Record<string, any>} */
  const opciones = { ...(gestor.opciones ?? {}) };
  const esquema = esquemaDeOpciones && typeof esquemaDeOpciones === "object" ? esquemaDeOpciones : null;
  const propiedades = esquema?.properties ?? {};
  if (propiedades.owner && propiedades.repo && !(opciones.owner && opciones.repo)) {
    const repo = repoDelRemoto(remoto);
    if (!repo) {
      throw new ErrorDeServicio("sin_gestor", {
        nombre: proyecto.nombre,
        hallado:
          `el gestor \`${gestor.nombre}\` necesita \`owner\` y \`repo\`, y el remoto \`${remoto}\` no tiene la ` +
          "forma de un repositorio de forja de la que sacarlos sin inventarlos",
      });
    }
    opciones.owner = opciones.owner ?? repo.owner;
    opciones.repo = opciones.repo ?? repo.repo;
  }
  const faltan = (Array.isArray(esquema?.required) ? esquema.required : []).filter(
    (/** @type {string} */ k) => opciones[k] === undefined || opciones[k] === "",
  );
  if (faltan.length) {
    throw new ErrorDeServicio("sin_gestor", {
      nombre: proyecto.nombre,
      hallado:
        `el gestor \`${gestor.nombre}\` necesita ${faltan.map((/** @type {string} */ k) => `\`${k}\``).join(" y ")}, ` +
        "y la conexion no los declara (`capacidades.opcionesDelGestor`)",
    });
  }
  return opciones;
}

/**
 * La configuracion del motor. PURA: mismos datos, misma configuracion.
 *
 * @param {{
 *   proyecto: any, home: string, remoto: string|null, ramaBase?: string,
 *   gate: {comando: string, de: string, suelto?: string|null}|null, gateHallado?: string,
 *   gestor: any, gestorHallado?: string,
 *   raizDeProveedores?: string, maxParallelItems?: number,
 *   esquemaDeOpciones?: any,
 *   ejecutor?: {runtime: string, agente: string|null, de?: string}|null,
 * }} e el `optionsSchema` del proveedor va en `esquemaDeOpciones`; `ejecutor`, el ya resuelto en cascada
 */
export function componerConfig(e) {
  const { proyecto } = e;
  if (!e.remoto) {
    throw new ErrorDeServicio("sin_repo", { nombre: proyecto.nombre, ruta: proyecto.ruta_local, id: proyecto.id });
  }
  if (!e.gate) {
    throw new ErrorDeServicio("sin_gate", {
      nombre: proyecto.nombre,
      id: proyecto.id,
      hallado: e.gateHallado ?? "no se encontro el runner de tests del proyecto",
    });
  }
  if (!e.gestor) {
    throw new ErrorDeServicio("sin_gestor", {
      nombre: proyecto.nombre,
      hallado: e.gestorHallado ?? "el proyecto no tiene ninguna conexion de gestor viva",
    });
  }

  const opciones = opcionesDelGestor({
    proyecto,
    remoto: e.remoto,
    gestor: e.gestor,
    esquemaDeOpciones: e.esquemaDeOpciones,
  });

  const raiz = e.raizDeProveedores ?? RAIZ_DE_PROVEEDORES;
  const clave = slugDe(proyecto.slug || proyecto.nombre || basename(String(proyecto.ruta_local)));

  return {
    version: 1,
    home: e.home,
    // EL EJECUTOR RESUELTO (FR-031) llega al motor por aqui: el motor monta ese
    // runtime y no el primero de su registro. Sin ejecutor, el motor decide
    // (el de referencia), y la configuracion no finge una eleccion.
    ...(e.ejecutor?.runtime ? { runtime: e.ejecutor.runtime } : {}),
    provider: {
      name: e.gestor.nombre,
      module: join(raiz, e.gestor.nombre, "index.mjs"),
      ...(Object.keys(opciones).length ? { options: opciones } : {}),
      ...(e.gestor.stateMap ? { stateMap: { ...e.gestor.stateMap } } : {}),
    },
    repos: {
      [clave]: {
        path: String(proyecto.ruta_local),
        remote: e.remoto,
        baseBranch: e.ramaBase ?? "main",
        gate: e.gate.comando,
        fastGate: e.gate.comando,
        ...(e.gate.suelto ? { runners: { test: e.gate.suelto } } : {}),
        // Lo que este gate NO cubre, dicho: el PR lo repite, y un hueco
        // declarado no se confunde con un verde real.
        gaps: [
          `gate derivado del snapshot: ${e.gate.de}`,
          ...(e.gate.suelto
            ? []
            : ["sin runner para un test suelto: el runner detectado no tiene una forma conocida de correr un archivo"]),
          // EL AGENTE QUE EL MOTOR NO SABE ENTREGAR, DICHO (principio X). La
          // tarea eligio un agente con nombre y el motor todavia no tiene por
          // donde pasarselo al runtime: corre con el runtime a secas. El PR lo
          // repite, en vez de que el operador crea que lo hizo ese agente.
          ...(e.ejecutor?.agente
            ? [
                `la tarea pidio el agente \`${e.ejecutor.agente}\` y el motor todavia no sabe entregarle un agente al ` +
                  `runtime: corrio con \`${e.ejecutor.runtime}\` sin ese agente`,
              ]
            : []),
        ],
      },
    },
    limits: { maxParallelItems: e.maxParallelItems ?? MAX_PARALELO_POR_DEFECTO },
  };
}

/**
 * @typedef {object} OpcionesDelMotor
 * @property {string} [raizDeProveedores]
 * @property {(nombre: string) => Promise<any>} [cargarGestor] inyectable: el board de los tests lo usa
 * @property {number} [maxParallelItems]
 */

/**
 * El modulo del gestor, o `null`. Nunca lanza: un proveedor que no carga es un
 * gestor que no se puede usar, y eso se dice como `sin_gestor`.
 *
 * @param {any} gestor
 * @param {OpcionesDelMotor} opts
 */
async function moduloDe(gestor, opts) {
  if (!gestor) return { modulo: null, fallo: null };
  try {
    const cargar = opts.cargarGestor ?? ((/** @type {string} */ n) => cargarGestor(n, opts.raizDeProveedores));
    return { modulo: await cargar(gestor.nombre), fallo: null };
  } catch (e) {
    return { modulo: null, fallo: `el proveedor \`${gestor.nombre}\` no se pudo cargar: ${e.message}` };
  }
}

/**
 * Si el proyecto se puede lanzar, y si no, por que. NO LANZA NUNCA: lo usa el
 * board en cada pintada, y un board que se cae por un proyecto mal configurado
 * deja de mostrar los otros diecinueve. Y NO ESCRIBE: compone en memoria.
 *
 * @param {any} dep
 * @param {any} proyecto
 * @param {OpcionesDelMotor} [opts]
 */
export async function diagnosticar(dep, proyecto, opts = {}) {
  const datos = datosDelProyecto(dep, proyecto, opts);
  const { modulo, fallo } = await moduloDe(datos.gestor, opts);
  /** @type {{codigo: string, causa: string, accion: string}|null} */
  let problema = null;
  try {
    componerConfig({
      ...datos,
      ...(fallo ? { gestor: null, gestorHallado: fallo } : {}),
      home: "/diagnostico",
      esquemaDeOpciones: modulo?.optionsSchema,
    });
  } catch (e) {
    problema = e && e.codigo ? { codigo: e.codigo, causa: e.causa, accion: e.accion } : null;
    if (!problema) throw e;
  }
  /** @type {Record<string, any>|null} */
  let opciones = null;
  if (datos.gestor && modulo) {
    try {
      opciones = opcionesDelGestor({ ...datos, esquemaDeOpciones: modulo.optionsSchema });
    } catch {
      /* sin opciones no se listan tickets; `problema` ya dice por que */
    }
  }
  return {
    lanzable: problema === null,
    tieneRepo: Boolean(datos.remoto),
    gate: datos.gate,
    gestor: fallo ? null : datos.gestor,
    modulo,
    opciones,
    problema,
    datos,
  };
}

/**
 * Compone y ESCRIBE la configuracion para lanzar. Es la unica escritura de este
 * modulo, y va al home del servicio —fuera del repositorio del operador,
 * principio III— con temporal + rename: un subproceso que lee el archivo a
 * medio escribir arranca con una configuracion truncada.
 *
 * @param {any} dep
 * @param {any} proyecto
 * @param {OpcionesDelMotor & {home: string, ejecutor?: {runtime: string, agente: string|null}|null}} opts
 */
export async function prepararMotor(dep, proyecto, opts) {
  const datos = datosDelProyecto(dep, proyecto, opts);
  const { modulo, fallo } = await moduloDe(datos.gestor, opts);
  const config = componerConfig({
    ...datos,
    ...(fallo || (datos.gestor && !modulo)
      ? { gestor: null, gestorHallado: fallo ?? `no existe el proveedor \`${datos.gestor?.nombre}\` del motor` }
      : {}),
    home: opts.home,
    raizDeProveedores: opts.raizDeProveedores,
    maxParallelItems: opts.maxParallelItems,
    esquemaDeOpciones: modulo?.optionsSchema,
    ejecutor: opts.ejecutor ?? null,
  });
  const dir = join(opts.home, "motor");
  mkdirSync(dir, { recursive: true });
  const ruta = join(dir, `${proyecto.id}.config.json`);
  const tmp = `${ruta}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, ruta);
  return { ruta, config, gestor: datos.gestor, modulo };
}

/**
 * Carga el modulo de un proveedor del motor por ruta, o `null` si no esta.
 *
 * `null` y no una excepcion: en el escritorio `providers/` puede no viajar, y
 * eso es un board degradado con su nota, no un board caido.
 *
 * @param {string} nombre
 * @param {string} [raiz]
 */
export async function cargarGestor(nombre, raiz = RAIZ_DE_PROVEEDORES) {
  const ruta = join(raiz, nombre, "index.mjs");
  if (!existsSync(ruta)) return null;
  return await import(pathToFileURL(ruta).href);
}

/**
 * Las credenciales que el gestor pide, desde la boveda y con grant.
 *
 * EL CAMINO ES EL QUE YA EXISTE (principio IX): la credencial de la conexion
 * del gestor, un grant vigente del proyecto sobre ella, y `boveda.recuperar`
 * con su motivo — que deja el acceso en la auditoria ANTES de devolver el
 * valor. El valor sale de aqui hacia `construirEntorno` y de ahi al entorno del
 * subproceso; no se guarda, no se devuelve por HTTP y no pasa por `argv`.
 *
 * @param {any} dep
 * @param {any} proyecto
 * @param {any} gestor
 * @param {string[]} requeridas los nombres que el proveedor declara en `requiredEnv`
 * @param {"lanzar_runner"|"llamar_api"} proposito
 * @returns {Promise<Record<string, string>>}
 */
export async function secretosDelGestor(dep, proyecto, gestor, requeridas, proposito) {
  // El gestor local no tiene credencial en la boveda: dentro del servicio
  // recibe la interfaz del almacen, y dentro del motor el token de sesion que
  // le pone el lanzador (ver `runs.mjs`). No hay nada que sacar de aqui.
  if (gestor?.origen === "local") return {};
  if (!requeridas || requeridas.length === 0) return {};
  const variables = requeridas.map((n) => `\`${n}\``).join(", ");
  const negar = (/** @type {string} */ porque) =>
    new ErrorDeServicio("sin_credencial_del_gestor", { gestor: gestor.nombre, nombre: proyecto.nombre, variables, porque });

  if (requeridas.length > 1) {
    throw negar(`la conexion del gestor trae UNA credencial y el proveedor pide ${requeridas.length} variables`);
  }
  if (!gestor.credencial) throw negar("la conexion del gestor no tiene ninguna credencial guardada en la boveda");
  if (!dep.boveda) {
    throw new ErrorDeServicio("pieza_ausente", { pieza: "la boveda", ...dep.ausenciaDeLaBoveda });
  }
  const credencial = dep.almacen.base.consultarUno("SELECT * FROM credential WHERE id = ?", [gestor.credencial]);
  if (!credencial) throw negar("la credencial de la conexion ya no esta en el inventario");
  const grant = dep.almacen.base.consultarUno(
    'SELECT * FROM "grant" WHERE credential_id = ? AND project_id = ? AND revocado_en IS NULL ' +
      "ORDER BY concedido_en DESC LIMIT 1",
    [credencial.id, proyecto.id],
  );
  if (!grant) throw negar("ningun agente del proyecto tiene un grant sobre esa credencial");

  const valor = await dep.boveda.recuperar(String(credencial.ref_boveda), {
    grant_id: String(grant.id),
    project_id: proyecto.id,
    agent_id: String(grant.agent_id),
    proposito,
  });
  return { [requeridas[0]]: valor };
}
