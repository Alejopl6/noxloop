// FR-024 — que hay YA configurado en este proyecto, leido del snapshot, antes
// de proponer nada.
//
// EL FALLO QUE EVITA, Y ES LA RECOMENDACION MAS MOLESTA QUE ESTE PRODUCTO PUEDE
// DAR: proponerle a alguien lo que ya hizo. Un equipo que tiene sus hooks, sus
// skills y su integracion continua escritos, y ve una lista de propuestas para
// instalar hooks, skills e integracion continua, aprende en un segundo que la
// herramienta no miro su repositorio. A partir de ahi no lee la siguiente
// lista, y las propuestas buenas se pierden junto con las malas.
//
// LA REGLA MECANICA, Y POR QUE ES ESTA. Una capacidad esta presente si algun
// hallazgo de sus claves trae sustancia. "Sustancia" tiene una definicion
// exacta que sale del contrato del scanner: un hallazgo con `motivo` es un
// hueco que el scanner ya declaro —"se busco aqui y no habia"— y no respalda
// nada, aunque su `origen` diga `detectado`. Confundir las dos cosas es leer un
// hueco como un hallazgo, que es el fallo del principio X en la direccion
// contraria.
//
// POR QUE LAS CAPACIDADES SE NOMBRAN POR LO QUE HACEN Y NO POR LA HERRAMIENTA
// QUE LAS TRAE. `hooks`, `subagentes`, `integracion_continua`. El dia que el
// proyecto use otro runtime de agente, el nombre sigue valiendo y el detector
// es quien cambia. Es el principio VII: el nombre propio no entra en el codigo.

/**
 * @type {ReadonlyArray<{id: string, titulo: string, claves: readonly string[]}>}
 */
export const CAPACIDADES = Object.freeze([
  { id: "instrucciones_de_agente", titulo: "Instrucciones para agentes", claves: ["agentes.instrucciones"] },
  { id: "configuracion_de_agente", titulo: "Configuracion de agente versionada", claves: ["agentes.configuracion"] },
  { id: "servidores_mcp", titulo: "Servidores de contexto declarados", claves: ["agentes.mcp"] },
  { id: "hooks", titulo: "Hooks que gobiernan al agente", claves: ["agentes.hooks"] },
  { id: "skills", titulo: "Skills del proyecto", claves: ["agentes.skills"] },
  { id: "subagentes", titulo: "Subagentes declarados", claves: ["agentes.subagentes"] },
  { id: "comandos_de_agente", titulo: "Comandos de agente", claves: ["agentes.comandos"] },
  { id: "plugin_de_agente", titulo: "Plugin de agente propio", claves: ["agentes.plugin"] },
  { id: "integracion_continua", titulo: "Integracion continua", claves: ["ci.workflows"] },
  { id: "gate_de_pull_request", titulo: "Gate sobre los pull requests", claves: ["ci.gatea_pr"] },
  { id: "comandos_de_verificacion", titulo: "Comandos de verificacion declarados", claves: ["ci.comandos"] },
  { id: "runner_de_tests", titulo: "Runner de tests", claves: ["testing.runner"] },
  { id: "suite_de_tests", titulo: "Suite de tests", claves: ["testing.ubicacion"] },
  { id: "umbral_de_cobertura", titulo: "Umbral de cobertura declarado", claves: ["testing.umbral_cobertura"] },
  { id: "constitution", titulo: "Constitution del proyecto", claves: ["guidelines.constitution"] },
  { id: "guia_de_contribucion", titulo: "Guia de contribucion", claves: ["guidelines.contributing"] },
  { id: "documentacion", titulo: "Documentacion", claves: ["guidelines.docs"] },
  { id: "registro_de_decisiones", titulo: "Registro de decisiones de arquitectura", claves: ["guidelines.adr"] },
  { id: "estilo_declarado", titulo: "Estilo de codigo declarado", claves: ["guidelines.estilo"] },
  { id: "licencia", titulo: "Licencia", claves: ["guidelines.licencia"] },
]);

/**
 * Un hallazgo con sustancia es uno que afirma algo. Un hueco declarado por el
 * scanner —con `motivo`— no lo es, ni tampoco un valor que no dice nada.
 *
 * @param {any} h
 */
export function tieneSustancia(h) {
  if (!h || h.motivo) return false;
  const v = h.valor;
  if (v === null || v === undefined) return false;
  if (Array.isArray(v) && v.length === 0) return false;
  if (typeof v === "string" && v.trim().length === 0) return false;
  // Un objeto SIN CLAVES esta tan vacio como un array sin elementos, y faltaba.
  //
  // El caso real que lo destapo: el scanner devuelve
  // `testing.umbral_cobertura: {}` cuando el proyecto no declara ninguno. Con
  // esta linea ausente, el bootstrap contaba esa capacidad como PRESENTE y no
  // la proponia — o sea, el operador nunca recibia la sugerencia de declarar un
  // umbral de cobertura, precisamente porque no tenia ninguno.
  //
  // Es el fallo de los huecos invertido: en vez de rellenar un hueco con lo
  // probable, se leia un hueco como si estuviera lleno. Las dos formas acaban
  // en lo mismo — una decision que el operador nunca llega a tomar.
  if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) return false;
  return true;
}

/**
 * Los hallazgos con sustancia, indexados por clave. Es lo que los generadores
 * del catalogo consultan para derivar contenido: si la clave no esta, el dato
 * no existe, y el documento generado lo declara hueco en vez de rellenarlo.
 *
 * @param {any} snapshot
 * @returns {Map<string, any>}
 */
export function valoresDe(snapshot) {
  /** @type {Map<string, any>} */
  const mapa = new Map();
  for (const h of snapshot?.hallazgos ?? []) {
    if (!tieneSustancia(h)) continue;
    if (!mapa.has(h.clave)) mapa.set(h.clave, h);
  }
  return mapa;
}

/**
 * @param {any} snapshot
 * @param {readonly any[]} [capacidades]
 */
export function detectarExistente(snapshot, capacidades = CAPACIDADES) {
  const hallazgos = Array.isArray(snapshot?.hallazgos) ? snapshot.hallazgos : [];

  /** @type {Record<string, any>} */
  const mapa = {};
  /** @type {string[]} */
  const presentes = [];
  /** @type {string[]} */
  const ausentes = [];

  for (const capacidad of capacidades) {
    const suyos = hallazgos.filter((/** @type {any} */ h) => capacidad.claves.includes(h.clave));
    const conSustancia = suyos.filter(tieneSustancia);

    if (conSustancia.length > 0) {
      mapa[capacidad.id] = Object.freeze({
        id: capacidad.id,
        titulo: capacidad.titulo,
        presente: true,
        claves: capacidad.claves,
        valor: conSustancia.length === 1 ? conSustancia[0].valor : conSustancia.map((/** @type {any} */ h) => h.valor),
        evidencia: Object.freeze(
          conSustancia
            .flatMap((/** @type {any} */ h) => h.evidencia ?? [])
            .filter((/** @type {any} */ e) => e && typeof e.ruta === "string")
            .slice(0, 12),
        ),
        motivo: "",
      });
      presentes.push(capacidad.id);
      continue;
    }

    const huecos = suyos.filter((/** @type {any} */ h) => h.motivo);
    mapa[capacidad.id] = Object.freeze({
      id: capacidad.id,
      titulo: capacidad.titulo,
      presente: false,
      claves: capacidad.claves,
      valor: null,
      evidencia: Object.freeze(huecos.flatMap((/** @type {any} */ h) => h.evidencia ?? []).slice(0, 6)),
      // Un ausente sin motivo no se distingue de un detector que no miro. La
      // diferencia importa: lo primero es una propuesta legitima, lo segundo es
      // un hueco del scanner que hay que arreglar en el scanner.
      motivo:
        huecos.length > 0
          ? huecos.map((/** @type {any} */ h) => h.motivo).join(" ")
          : `el snapshot no emitio ningun hallazgo bajo \`${capacidad.claves.join("`, `")}\`, asi que esta ` +
            "capacidad no consta en el arbol ni consta que se buscara.",
    });
    ausentes.push(capacidad.id);
  }

  return Object.freeze({
    snapshot_id: snapshot?.id ?? null,
    capacidades: Object.freeze(mapa),
    presentes: Object.freeze(presentes),
    ausentes: Object.freeze(ausentes),
  });
}
