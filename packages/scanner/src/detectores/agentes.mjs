// Detector de agentes: instrucciones, configuracion, servidores MCP, hooks,
// skills, subagentes, comandos y plugins.
//
// POR QUE ESTA FASE EXISTE, Y POR QUE NO LA TIENE NINGUN OTRO SCANNER. Porque
// el producto que lee este snapshot va a poner agentes a trabajar sobre este
// mismo repositorio, y lo que el proyecto YA tiene configurado manda sobre lo
// que el producto traiga por defecto. Un repositorio con instrucciones de
// agente escritas por su equipo y un hook que fuerza TDD no necesita que nadie
// le proponga los suyos: necesita que se los respeten. Detectarlos mal —o no
// detectarlos— produce la recomendacion mas molesta que este producto puede
// dar, que es proponerle a alguien lo que ya hizo.
//
// POR QUE LA BUSQUEDA ES POR FORMA Y EN TODO EL ARBOL. Porque en un monorepo la
// configuracion de agente no esta en la raiz: esta dentro del paquete que la
// define, y un detector que solo mire la raiz devuelve "no hay nada" sobre un
// repositorio que tiene un plugin entero dentro.

import { detectado, vacio } from "../hallazgo.mjs";

/** Archivos que son instrucciones para un agente. Nombre exacto, en minuscula. */
const INSTRUCCIONES = new Set([
  "claude.md",
  "agents.md",
  "agent.md",
  ".cursorrules",
  ".windsurfrules",
  ".clinerules",
  "copilot-instructions.md",
  "gemini.md",
  "conventions.md",
]);

/** Directorios de configuracion de agente. */
const CONFIGURACION = new Set([".claude", ".cursor", ".aider", ".continue", ".windsurf", ".opencode"]);

/** Archivos que declaran servidores MCP. */
const MANIFIESTOS_MCP = new Set([".mcp.json", "mcp.json", "mcp_servers.json"]);

/** @typedef {import("../contexto.mjs").Contexto} Contexto */

/**
 * @param {Contexto} ctx
 * @param {string} clave
 * @param {string[]} rutas
 * @param {string} motivo
 * @param {unknown} [valor]
 */
function hallazgoDe(ctx, clave, rutas, motivo, valor) {
  if (rutas.length === 0) return vacio("agentes", clave, [{ ruta: "." }], motivo, []);
  return detectado("agentes", clave, valor ?? rutas, rutas.slice(0, 10).map((ruta) => ({ ruta })));
}

/**
 * @param {Contexto} ctx
 */
function detectar(ctx) {
  const hallazgos = [];

  // --- Instrucciones -------------------------------------------------------
  const instrucciones = ctx.archivos.filter((a) => INSTRUCCIONES.has(a.nombre.toLowerCase())).map((a) => a.ruta).sort();
  hallazgos.push(
    hallazgoDe(
      ctx,
      "agentes.instrucciones",
      instrucciones,
      "Se recorrio el arbol buscando archivos de instrucciones para agentes " +
        `(${[...INSTRUCCIONES].slice(0, 5).join(", ")}, entre otros) y no hay ninguno. El proyecto no le dice ` +
        "nada a ningun agente todavia.",
    ),
  );

  // --- Configuracion -------------------------------------------------------
  const configuracion = ctx.directorios
    .filter((d) => CONFIGURACION.has(d.slice(d.lastIndexOf("/") + 1)))
    .sort();
  // Un directorio vacio no es configuracion: se cita el archivo de dentro.
  const evidenciaConfiguracion = /** @type {string[]} */ (
    configuracion.map((d) => ctx.archivos.find((a) => a.ruta.startsWith(`${d}/`))?.ruta).filter((r) => !!r)
  );
  if (configuracion.length > 0 && evidenciaConfiguracion.length > 0) {
    hallazgos.push(
      detectado("agentes", "agentes.configuracion", configuracion, evidenciaConfiguracion.slice(0, 10).map((ruta) => ({ ruta }))),
    );
  } else {
    hallazgos.push(
      vacio(
        "agentes",
        "agentes.configuracion",
        [{ ruta: "." }],
        `Se busco un directorio de configuracion de agente (${[...CONFIGURACION].join(", ")}) con algo dentro y ` +
          "no hay ninguno. El proyecto no lleva configuracion de agente versionada.",
        [],
      ),
    );
  }

  // --- Servidores MCP ------------------------------------------------------
  /** @type {string[]} */
  const mcp = ctx.archivos.filter((a) => MANIFIESTOS_MCP.has(a.nombre.toLowerCase())).map((a) => a.ruta);
  for (const archivo of ctx.archivos) {
    if (!archivo.nombre.endsWith(".json")) continue;
    if (!archivo.ruta.includes("settings") && !CONFIGURACION.has(archivo.ruta.split("/")[0])) continue;
    if (ctx.buscar(archivo.ruta, /"mcp[_-]?[sS]ervers"\s*:/)) mcp.push(archivo.ruta);
  }
  hallazgos.push(
    hallazgoDe(
      ctx,
      "agentes.mcp",
      [...new Set(mcp)].sort(),
      "Se buscaron manifiestos de servidores MCP y claves `mcpServers` en la configuracion de agente, y no hay " +
        "ninguno. El proyecto no declara herramientas MCP en el repositorio.",
    ),
  );

  // --- Hooks ---------------------------------------------------------------
  /** @type {string[]} */
  const hooks = ctx.porNombre("hooks.json");
  for (const archivo of ctx.archivos) {
    if (!archivo.nombre.startsWith("settings") || !archivo.nombre.endsWith(".json")) continue;
    if (ctx.buscar(archivo.ruta, /"hooks"\s*:/)) hooks.push(archivo.ruta);
  }
  hallazgos.push(
    hallazgoDe(
      ctx,
      "agentes.hooks",
      [...new Set(hooks)].sort(),
      "Se busco un `hooks.json` y claves `hooks` en la configuracion de agente, y no hay ninguno. Nada intercepta " +
        "las operaciones de un agente en este repositorio.",
    ),
  );

  // --- Skills --------------------------------------------------------------
  const skills = ctx
    .porNombre("skill.md")
    .map((ruta) => (ruta.includes("/") ? ruta.slice(0, ruta.lastIndexOf("/")) : ruta))
    .sort();
  if (skills.length > 0) {
    hallazgos.push(
      detectado("agentes", "agentes.skills", skills, ctx.porNombre("skill.md").slice(0, 10).map((ruta) => ({ ruta }))),
    );
  } else {
    hallazgos.push(
      vacio(
        "agentes",
        "agentes.skills",
        [{ ruta: "." }],
        "Se recorrio el arbol buscando archivos `SKILL.md` y no hay ninguno. El proyecto no empaqueta ninguna " +
          "habilidad para agentes.",
        [],
      ),
    );
  }

  // --- Subagentes y comandos ----------------------------------------------
  const subagentes = ctx.rutasComo(/(?:^|\/)(?:agents|subagents|subagentes)\/[^/]+\.md$/).sort();
  hallazgos.push(
    hallazgoDe(
      ctx,
      "agentes.subagentes",
      subagentes,
      "Se busco un directorio `agents/` con definiciones en markdown y no hay ninguno. El proyecto no define " +
        "subagentes propios.",
    ),
  );

  const comandos = ctx.rutasComo(/(?:^|\/)commands\/[^/]+\.md$/).sort();
  hallazgos.push(
    hallazgoDe(
      ctx,
      "agentes.comandos",
      comandos,
      "Se busco un directorio `commands/` con definiciones en markdown y no hay ninguno. El proyecto no define " +
        "comandos de agente propios.",
    ),
  );

  // --- Plugin --------------------------------------------------------------
  const plugins = ctx.rutasComo(/(?:^|\/)\.[a-z-]*plugin\/plugin\.json$/).sort();
  if (plugins.length > 0) {
    const valor = plugins.map((ruta) => {
      const manifiesto = ctx.json(ruta) ?? {};
      return { ruta, nombre: manifiesto.name ?? null, version: manifiesto.version ?? null };
    });
    hallazgos.push(detectado("agentes", "agentes.plugin", valor, plugins.map((ruta) => ({ ruta }))));
  } else {
    hallazgos.push(
      vacio(
        "agentes",
        "agentes.plugin",
        [{ ruta: "." }],
        "Se busco un manifiesto de plugin de agente (un `plugin.json` dentro de un directorio de plugin) y no hay " +
          "ninguno. El proyecto no empaqueta su configuracion de agente como plugin instalable.",
        [],
      ),
    );
  }

  return hallazgos;
}

/** @type {import("../scanner.mjs").Detector} */
const detector = { nombre: "agentes", fase: "agentes", detectar };
export default detector;
