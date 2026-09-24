// Las fases del recorrido, en el orden en el que ocurren.
//
// POR QUE EL ORDEN ESTA AQUI Y NO EN EL SCANNER. Porque es la unica cosa que
// el nucleo y los detectores tienen que compartir: un detector declara en que
// fase vive y no sabe nada mas del motor. Si el orden viviera dentro del
// scanner, agregar una fase seria tocar el nucleo, y el contrato dice
// exactamente lo contrario — si soportar algo nuevo exige cambiar el nucleo, la
// interfaz esta mal.
//
// POR QUE HAY FASES Y NO UNA PASADA UNICA. Porque el progreso es lo unico que
// el operador ve mientras esto trabaja, y una barra que no se mueve se lee como
// colgado. La fase le pone nombre a lo que esta pasando: "leyendo manifiestos"
// es informacion; "37%" sobre un total que nadie sabe, no.

/** @typedef {'inventario'|'manifiestos'|'estructura'|'testing'|'ci'|'agentes'|'guidelines'|'riesgos'} Fase */

/** @type {readonly Fase[]} */
export const FASES = Object.freeze([
  "inventario", // que archivos hay
  "manifiestos", // package.json, cargo.toml, go.mod, pyproject...
  "estructura", // capas, modulos, convenciones
  "testing", // runner, ubicacion, cobertura declarada
  "ci", // workflows, pipelines
  "agentes", // instrucciones de agente, MCP, hooks, skills
  "guidelines", // docs, guias de contribucion, ADRs
  "riesgos", // secretos en claro, dependencias sin fijar
]);

/** Las categorias validas de un hallazgo: las fases mas las tres transversales. */
export const CATEGORIAS = Object.freeze([...FASES, "stack", "arquitectura", "dependencias", "patrones"]);
