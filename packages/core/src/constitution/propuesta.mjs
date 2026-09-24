// FR-020 — la propuesta se deriva del snapshot, y cada apartado sale marcado
// `detectado`, `inferido` o `vacio` con su evidencia.
//
// EL FALLO QUE EVITA, Y POR QUE ES EL PEOR DE ESTA ETAPA. Un apartado inferido
// presentado como detectado convierte una suposicion del modelo en la regla del
// proyecto. El verde inventado se cae en cuanto el codigo falla; este no se
// descubre nunca: el operador lo aprueba porque la pantalla decia "detectado",
// el runtime lo aplica durante meses, y cada tarea hereda la suposicion como si
// fuera un hecho verificado.
//
// POR QUE LA MARCA SE CALCULA Y NO SE ESCRIBE. Porque escribirla es acordarse
// de escribirla, y eso funciona hasta el tercer apartado. La marca sale del
// origen de los hallazgos que respaldan al apartado, con una regla mecanica: un
// hallazgo con `motivo` es un hueco declarado por el scanner —"se busco y no
// habia"— y no respalda nada. Es la distincion que el contrato del scanner ya
// hace; aqui solo se respeta.
//
// POR QUE HAY APARTADOS SIN NINGUNA CLAVE. Porque la politica de ramas, la de
// revision, la de despliegue y el nivel de autonomia no estan en el arbol de
// nadie. Un scanner que igualmente propusiera "trunk-based, revision por pares,
// despliegue continuo" estaria escribiendo la constitution de otro proyecto.
// Salen vacios, con su pregunta, y el operador los responde.

import { snapshotIncompleto } from "../errores.mjs";
import { resumir } from "../formato.mjs";
import { rutaDeConstitution } from "./modelo.mjs";
import { renderPropuesta } from "./documento.mjs";

/** La version de un borrador. Por debajo de 1.0.0 a proposito: no esta fijada. */
export const VERSION_DE_BORRADOR = "0.1.0";

/**
 * Los apartados de una constitution y de donde sale cada uno.
 *
 * Es una tabla: un apartado mas es una fila. Los `prefijos` son claves de
 * hallazgo del scanner, no rutas ni nombres de archivo — si el scanner cambia
 * como encuentra el dato, esto sigue valiendo.
 *
 * @type {ReadonlyArray<{id: string, titulo: string, prefijos: readonly string[], pregunta: string}>}
 */
export const APARTADOS = Object.freeze([
  {
    id: "stack",
    titulo: "Stack y runtime",
    prefijos: ["stack.", "runtime."],
    pregunta: "Que ecosistema y que version de runtime fija este proyecto, y que se hace con el codigo que no los respeta?",
  },
  {
    id: "arquitectura",
    titulo: "Arquitectura y limites de modulo",
    prefijos: ["arquitectura.", "patrones."],
    pregunta: "Que limites de modulo son invariantes y cuales son convenciones que se pueden discutir en un PR?",
  },
  {
    id: "testing",
    titulo: "Politica de testing",
    prefijos: ["testing."],
    pregunta: "El test va antes que la implementacion? Que umbral de cobertura gatea, y sobre que — el diff o el total?",
  },
  {
    id: "integracion_continua",
    titulo: "Integracion continua y gate de merge",
    prefijos: ["ci."],
    pregunta: "Que comandos tienen que pasar para mergear, y quien puede saltarselos — si es que alguien puede?",
  },
  {
    id: "dependencias",
    titulo: "Dependencias",
    prefijos: ["dependencias."],
    pregunta: "Que hace falta para aceptar una dependencia nueva, y que se permite en el camino critico de ejecucion?",
  },
  {
    id: "seguridad",
    titulo: "Seguridad",
    prefijos: ["riesgos."],
    pregunta: "Donde viven los secretos de este proyecto, y que pasa exactamente cuando aparece uno en claro en el arbol?",
  },
  {
    id: "agentes",
    titulo: "Agentes",
    prefijos: ["agentes."],
    pregunta: "Que puede hacer un agente en este proyecto sin preguntar, y donde termina su autonomia?",
  },
  {
    id: "documentacion",
    titulo: "Documentacion y guias",
    prefijos: ["guidelines."],
    pregunta: "Que documento manda cuando dos se contradicen, y que hay que actualizar para que un cambio se considere hecho?",
  },
  {
    id: "git",
    titulo: "Convenciones de git",
    prefijos: [],
    pregunta: "Como se nombran las ramas, de donde nacen, que formato tienen los commits y cual es el tamaño maximo de un PR?",
  },
  {
    id: "revision",
    titulo: "Revision",
    prefijos: [],
    pregunta: "Quien revisa, con que criterio, y que hallazgo bloquea un merge frente a cual es una sugerencia?",
  },
  {
    id: "despliegue",
    titulo: "Despliegue",
    prefijos: [],
    pregunta: "Quien despliega, a que entornos, con que aprobacion y con que camino de vuelta si sale mal?",
  },
  {
    id: "autonomia",
    titulo: "Nivel de autonomia",
    prefijos: [],
    pregunta: "Hasta donde llega la automatizacion sin una persona delante: propuesta, PR abierto, merge, despliegue?",
  },
]);

const ORDEN_DE_CONFIANZA = { alta: 3, media: 2, baja: 1 };

/**
 * @param {any[]} evidencias
 * @returns {any[]}
 */
function unir(evidencias) {
  /** @type {Map<string, any>} */
  const vistas = new Map();
  for (const e of evidencias) {
    if (!e || typeof e.ruta !== "string") continue;
    const llave = `${e.ruta}:${e.linea ?? ""}`;
    if (!vistas.has(llave)) vistas.set(llave, e.linea ? { ruta: e.ruta, linea: e.linea } : { ruta: e.ruta });
  }
  return [...vistas.values()].slice(0, 12);
}

/**
 * Un apartado, derivado de los hallazgos que lo respaldan.
 *
 * @param {{id: string, titulo: string, prefijos: readonly string[], pregunta: string}} definicion
 * @param {any[]} hallazgos
 */
export function derivarApartado(definicion, hallazgos) {
  const suyos = hallazgos.filter((h) => definicion.prefijos.some((p) => String(h.clave ?? "").startsWith(p)));
  // La regla mecanica: un hallazgo con `motivo` es un hueco que el scanner ya
  // declaro. No respalda nada, pero SI deja constancia de donde se busco.
  const conSustancia = suyos.filter((h) => !h.motivo);
  const huecos = suyos.filter((h) => h.motivo);

  const base = {
    id: definicion.id,
    titulo: definicion.titulo,
    // El fallo que motiva un principio no esta en el arbol. Se declara hueco
    // aqui y lo escribe el operador; es la union de este principio con la regla
    // de las enmiendas.
    fallo_que_motiva: /** @type {string|null} */ (null),
    claves: suyos.map((h) => h.clave),
    pregunta: definicion.pregunta,
  };

  if (conSustancia.length > 0) {
    const detectados = conSustancia.filter((h) => h.origen === "detectado");
    const respaldan = detectados.length > 0 ? detectados : conSustancia;
    const origen = detectados.length > 0 ? "detectado" : "inferido";
    const confianza = respaldan
      .map((h) => h.confianza ?? "media")
      .reduce((peor, c) => (/** @type {any} */ (ORDEN_DE_CONFIANZA)[c] < /** @type {any} */ (ORDEN_DE_CONFIANZA)[peor] ? c : peor), "alta");
    const evidencia = unir(respaldan.flatMap((h) => h.evidencia ?? []));

    // La misma guarda que el scanner aplica a sus hallazgos, aplicada aqui: un
    // apartado detectado sin la ruta que lo respalda no sale. Sin esto, un
    // detector que emitiera evidencia vacia colaria un "detectado" por la
    // puerta de atras.
    if (origen === "detectado" && evidencia.length === 0) {
      return {
        ...base,
        origen: "vacio",
        confianza: "alta",
        contenido: null,
        evidencia: [],
        motivo:
          `hay hallazgos bajo \`${definicion.prefijos.join("`, `")}\` pero ninguno trae la ruta que lo ` +
          "respalda, asi que no se puede presentar como detectado.",
      };
    }

    return {
      ...base,
      origen,
      // Un inferido nunca sale con confianza alta: quien lo lee en pantalla ve
      // `alta` y deja de mirar el `inferido` de al lado.
      confianza: origen === "inferido" && confianza === "alta" ? "media" : confianza,
      contenido: respaldan
        .map((h) => {
          const cita = (h.evidencia ?? [])[0];
          const donde = cita ? ` (${cita.linea ? `\`${cita.ruta}:${cita.linea}\`` : `\`${cita.ruta}\``})` : "";
          return `- \`${h.clave}\`: ${resumir(h.valor)}${donde}`;
        })
        .join("\n"),
      evidencia,
      motivo: "",
    };
  }

  const motivo =
    huecos.length > 0
      ? huecos.map((h) => `\`${h.clave}\`: ${h.motivo}`).join(" ")
      : definicion.prefijos.length === 0
        ? "ningun detector produce este dato porque no esta en el arbol: no se deduce del codigo, se decide."
        : `el snapshot no emitio ningun hallazgo bajo \`${definicion.prefijos.join("`, `")}\`, asi que no hay ` +
          "nada detectado ni inferido que poner aqui.";

  return {
    ...base,
    origen: "vacio",
    confianza: "alta",
    contenido: null,
    evidencia: unir(huecos.flatMap((h) => h.evidencia ?? [])),
    motivo,
  };
}

/**
 * @param {{snapshot: any, proyecto: any, ahora?: number, apartados?: readonly any[]}} datos
 */
export function proponerConstitution({ snapshot, proyecto, ahora = Date.now(), apartados = APARTADOS }) {
  if (snapshot?.estado !== "completo") throw snapshotIncompleto(snapshot?.estado ?? "desconocido");

  const hallazgos = Array.isArray(snapshot.hallazgos) ? snapshot.hallazgos : [];
  const derivados = apartados.map((d) => derivarApartado(d, hallazgos));
  const ruta = rutaDeConstitution(snapshot);

  const preguntas = derivados
    .filter((a) => a.origen === "vacio")
    .map((a) => ({ apartado: a.id, titulo: a.titulo, pregunta: a.pregunta, motivo: a.motivo }));

  return Object.freeze({
    project_id: proyecto?.id ?? null,
    version: VERSION_DE_BORRADOR,
    ruta_en_repo: ruta.ruta,
    ruta: Object.freeze(ruta),
    apartados: Object.freeze(derivados),
    preguntas: Object.freeze(preguntas),
    derivada_de: Object.freeze({
      snapshot_id: snapshot.id,
      commit: snapshot.commit ?? null,
      creado: snapshot.creado ?? null,
    }),
    documento: renderPropuesta({ proyecto, apartados: derivados, version: VERSION_DE_BORRADOR, snapshot, ahora, ruta }),
  });
}
