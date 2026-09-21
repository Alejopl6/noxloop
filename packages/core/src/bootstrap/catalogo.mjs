// El catalogo por defecto del bootstrap: que se puede proponer, y con que
// contenido exacto.
//
// POR QUE EL CATALOGO ES DATOS Y SE PUEDE SUSTITUIR. Es el principio VII y el
// VI a la vez: una entrada nueva es una fila, no un `if` en el motor. El
// servicio puede pasar el suyo; este es el que vale cuando nadie pasa ninguno.
//
// POR QUE LA MITAD DE LAS ENTRADAS PREGUNTAN EN VEZ DE PROPONER, Y NO ES UNA
// LIMITACION QUE HAYA QUE ARREGLAR. Un hook, una skill o un subagente se
// escriben en el formato del runtime de agente que gobierne el proyecto, y eso
// NO esta en el arbol: el snapshot ve que hay un directorio de configuracion,
// no ve que herramienta lo lee ni con que esquema. Proponer un archivo en un
// formato supuesto produce un archivo que nadie carga —y que el operador cree
// activo— o, peor, uno que rompe la configuracion que ya tenia. Es el principio
// X aplicado a lo que se escribe en vez de a lo que se lee: el hueco se declara
// hueco, y aqui declararlo es preguntar.
//
// Lo que si se deriva entero del snapshot son los documentos: cada linea sale
// de un hallazgo y cita su ruta, y lo que el snapshot no supo queda marcado
// `[vacio]` dentro del propio documento generado.

import { resumir, cita } from "../formato.mjs";

/**
 * Los tipos de recomendacion.
 *
 * DECISION QUE LA SPEC NO CUBRE: `data-model.md` declara siete tipos
 * (`hook`, `skill`, `mcp`, `tool`, `subagente`, `validacion`, `ci`) y ninguno
 * describe un documento. Las dos entradas derivables de este catalogo producen
 * exactamente eso: instrucciones para agentes y una guia de contribucion.
 * Meterlas en `tool` las etiquetaria mal en la pantalla y en el registro que
 * alimenta la evolucion continua, asi que aqui se añaden `instrucciones` y
 * `documentacion`. Es una ampliacion del enum del modelo de datos y esta
 * reportada como tal: cambiar `data-model.md` no es de este paquete.
 */
export const TIPOS = Object.freeze([
  "hook",
  "skill",
  "mcp",
  "tool",
  "subagente",
  "validacion",
  "ci",
  "instrucciones",
  "documentacion",
]);

/**
 * Donde se escriben las instrucciones de agente cuando no hay ninguna.
 *
 * Es un archivo en mayusculas en la raiz, como `README` o `CONTRIBUTING`: la
 * FORMA que se encuentra sin saber nada del proyecto, y que el detector de
 * agentes ya busca entre otras. No se elige la convencion de ninguna
 * herramienta concreta — si el proyecto ya tiene la suya, el detector la
 * encuentra y esta entrada no se propone.
 */
export const RUTA_DE_INSTRUCCIONES = "AGENTS.md";
export const RUTA_DE_CONTRIBUCION = "CONTRIBUTING.md";

/**
 * @param {Map<string, any>} valores
 * @param {string} clave
 * @param {string} etiqueta
 */
function dato(valores, clave, etiqueta) {
  const h = valores.get(clave);
  if (!h) {
    return `- ${etiqueta}: [vacio] el snapshot no lo encontro en el arbol. No se rellena con lo probable.`;
  }
  const donde = cita((h.evidencia ?? [])[0]);
  const marca = h.origen === "inferido" ? ` _(inferido, confianza ${h.confianza})_` : "";
  return `- ${etiqueta}: ${resumir(h.valor)}${donde ? ` (${donde})` : ""}${marca}`;
}

/**
 * Los comandos de la integracion continua, uno por linea y con su linea de
 * origen: son los unicos comandos de los que se sabe que alguien decidio que
 * tenian que pasar antes de mergear.
 *
 * @param {Map<string, any>} valores
 */
function comandosDeCi(valores) {
  const h = valores.get("ci.comandos");
  if (!h || !Array.isArray(h.valor) || h.valor.length === 0) {
    return ["- [vacio] no se detecto ningun comando de integracion continua en el arbol."];
  }
  return h.valor
    .slice(0, 20)
    .map((/** @type {any} */ c) => `- \`${c.comando}\` (\`${c.ruta}${c.linea ? `:${c.linea}` : ""}\`)`);
}

/** @param {any} snapshot */
function procedencia(snapshot) {
  return (
    `Derivado del snapshot \`${snapshot.id}\` sobre el commit \`${snapshot.commit ?? "sin commit"}\`. Cada linea ` +
    "cita el archivo del que sale; lo que no se pudo leer del arbol queda marcado `[vacio]` en vez de rellenarse " +
    "con lo probable."
  );
}

/**
 * @param {{snapshot: any, valores: Map<string, any>}} ctx
 */
function instruccionesDeAgente({ snapshot, valores }) {
  const lineas = [
    "# Instrucciones para agentes",
    "",
    procedencia(snapshot),
    "",
    "## Como es este proyecto",
    "",
    dato(valores, "stack.ecosistemas", "Ecosistemas"),
    dato(valores, "stack.modulos", "Sistema de modulos"),
    dato(valores, "stack.gestor_paquetes", "Gestor de paquetes"),
    dato(valores, "arquitectura.monorepo", "Monorepo y workspaces"),
    dato(valores, "arquitectura.puntos_de_extension", "Puntos de extension"),
    "",
    "## Como se verifica un cambio",
    "",
    dato(valores, "testing.runner", "Runner de tests"),
    dato(valores, "testing.ubicacion", "Donde viven los tests"),
    dato(valores, "testing.umbral_cobertura", "Umbral de cobertura declarado"),
    "",
    "Comandos que corre la integracion continua:",
    "",
    ...comandosDeCi(valores),
    "",
    "El criterio de exito es el exit code de esos comandos. Una afirmacion sobre ellos —\"deberia pasar\", \"lo " +
      "verifique\"— no es evidencia de nada.",
    "",
    "## Que gobierna este proyecto",
    "",
    dato(valores, "guidelines.constitution", "Constitution"),
    dato(valores, "guidelines.contributing", "Guia de contribucion"),
    dato(valores, "guidelines.estilo", "Estilo declarado"),
    "",
    "## Lo que este documento no sabe",
    "",
    "- [vacio] Convenciones de git: como se nombran las ramas, de donde nacen y que formato tienen los commits. " +
      "Ningun detector lo lee del arbol — preguntalo antes de asumirlo.",
    "- [vacio] Politica de revision y de despliegue: quien aprueba, con que criterio y hasta donde llega la " +
      "automatizacion sin una persona delante.",
    "",
    "Estos huecos estan aqui a proposito. Un documento que los rellenara con lo probable se leeria igual de bien " +
      "y estaria inventando las reglas del proyecto.",
    "",
  ];
  return lineas.join("\n");
}

/**
 * @param {{snapshot: any, valores: Map<string, any>}} ctx
 */
function guiaDeContribucion({ snapshot, valores }) {
  return [
    "# Como contribuir",
    "",
    procedencia(snapshot),
    "",
    "## Antes de abrir un pull request",
    "",
    ...comandosDeCi(valores),
    "",
    "Son los comandos que la integracion continua corre. Si alguno falla en tu maquina, va a fallar en el gate.",
    "",
    "## Tests",
    "",
    dato(valores, "testing.runner", "Runner"),
    dato(valores, "testing.ubicacion", "Donde van los tests nuevos"),
    "",
    "## Lo que esta guia no fija todavia",
    "",
    "- [vacio] Nombres de rama, formato de commit y tamaño maximo de un pull request.",
    "- [vacio] Quien revisa y que hallazgo bloquea un merge frente a cual es una sugerencia.",
    "",
  ].join("\n");
}

/**
 * @param {string} texto
 * @param {string[]} falta
 */
const pregunta = (texto, falta) => () => ({ pregunta: { texto, falta } });

/**
 * @type {ReadonlyArray<{id: string, tipo: string, capacidad: string, titulo: string, justificacion: string, efectos: any[], cambios: (ctx: any) => any}>}
 */
export const CATALOGO_POR_DEFECTO = Object.freeze([
  {
    id: "instrucciones_de_agente",
    tipo: "instrucciones",
    capacidad: "instrucciones_de_agente",
    titulo: "Instrucciones para agentes, derivadas del proyecto",
    justificacion:
      "El proyecto no le dice nada a ningun agente todavia, asi que cada sesion empieza explicando lo mismo " +
      "que se explico ayer. El documento sale del snapshot: cada afirmacion cita el archivo que la respalda.",
    efectos: [],
    cambios: (ctx) => ({ cambios: [{ ruta: RUTA_DE_INSTRUCCIONES, contenido: instruccionesDeAgente(ctx) }] }),
  },
  {
    id: "guia_de_contribucion",
    tipo: "documentacion",
    capacidad: "guia_de_contribucion",
    titulo: "Guia de contribucion con los comandos que gatean el merge",
    justificacion:
      "Quien llega al proyecto descubre que comandos tiene que pasar cuando el gate se los rechaza. Los " +
      "comandos ya estan detectados en la definicion de la integracion continua; esto los pone donde se buscan.",
    efectos: [],
    cambios: (ctx) => ({ cambios: [{ ruta: RUTA_DE_CONTRIBUCION, contenido: guiaDeContribucion(ctx) }] }),
  },
  {
    id: "hook_de_test_primero",
    tipo: "hook",
    capacidad: "hooks",
    titulo: "Un hook que bloquee la escritura de produccion sin un test en rojo",
    justificacion:
      "Un prompt que pide escribir el test primero funciona dos iteraciones y deja de funcionar en la tercera. " +
      "Un hook no se cansa. Pero su formato depende del runtime de agente, y eso el arbol no lo dice.",
    efectos: [],
    cambios: pregunta(
      "Que runtime de agente gobierna este proyecto, y donde se declaran sus hooks? El formato de un hook no " +
        "esta en el arbol: proponer uno en un esquema supuesto produce un archivo que nadie carga y que el " +
        "operador cree activo.",
      ["runtime_de_agente", "ruta_de_hooks"],
    ),
  },
  {
    id: "skill_de_contexto",
    tipo: "skill",
    capacidad: "skills",
    titulo: "Una skill con el contexto del proyecto",
    justificacion:
      "Lo que el proyecto da por sabido es lo que un agente nuevo no sabe. Una skill lo deja escrito una vez.",
    efectos: [],
    cambios: pregunta(
      "Que runtime de agente carga las skills de este proyecto, y con que formato de archivo? Sin eso, el " +
        "documento se escribe en un sitio donde nada lo lee.",
      ["runtime_de_agente", "ruta_de_skills"],
    ),
  },
  {
    id: "subagente_revisor",
    tipo: "subagente",
    capacidad: "subagentes",
    titulo: "Un subagente revisor con runtime distinto del implementador",
    justificacion:
      "Un revisor que comparte runtime y contexto con el implementador aprueba su propio razonamiento. Que sea " +
      "otro runtime es lo que hace que la revision sea una segunda opinion y no una firma.",
    efectos: [],
    cambios: pregunta(
      "Que runtimes de agente hay disponibles para este proyecto, y cual va a implementar y cual a revisar? La " +
        "regla exige que no sean el mismo, y el arbol no dice cuales hay.",
      ["runtime_de_implementador", "runtime_de_revisor"],
    ),
  },
  {
    id: "servidores_mcp",
    tipo: "mcp",
    capacidad: "servidores_mcp",
    titulo: "Declarar los servidores de contexto del proyecto",
    justificacion:
      "Los servidores de contexto que un proyecto usa no estan en su codigo: se declaran. Un bootstrap que " +
      "propusiera unos estaria eligiendo por el operador.",
    efectos: [],
    cambios: pregunta(
      "Que servidores de contexto usa este proyecto, y con que alcance? No se deducen del arbol, y conectar " +
        "uno da acceso a datos que nadie autorizo.",
      ["servidores", "alcance"],
    ),
  },
]);
