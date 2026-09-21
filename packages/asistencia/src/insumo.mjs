// El recorte del snapshot que se le pone delante al modelo.
//
// POR QUE HAY UN RECORTE Y NO SE MANDA EL SNAPSHOT ENTERO. Por dos motivos, y
// el segundo importa mas que el primero. El primero es el tamaño: cincuenta y
// siete hallazgos con sus extractos son mucho texto para una pregunta sobre el
// area de testing. El segundo es que el modelo tiene que citar por clave, y
// solo puede citar lo que se le enseño: si se le manda todo, las citas validas
// incluyen hallazgos que no tienen nada que ver con lo que se le pregunto, y la
// comprobacion de citas deja de significar «se apoya en esto» para significar
// «nombro algo que existe en alguna parte».
//
// POR QUE LOS HUECOS VIAJAN, Y ES LA PARTE QUE MAS SE OLVIDA. Un hallazgo con
// `valor: null` no es un campo que falta: es el scanner diciendo «busque y no
// habia», y esa es informacion de primera. Filtrarlo del insumo hace que el
// modelo no pueda proponer «configura cobertura, porque no hay ninguna» — que
// suele ser la sugerencia mas util que se puede dar sobre un area.
//
// POR QUE EL VALOR CORREGIDO GANA. Lo decide quien llama, que es el servicio, y
// es el mismo criterio que ya aplican el nucleo y la flota: lo que vale es lo
// que el operador corrigio. Derivar una sugerencia del valor original despues
// de que alguien lo arreglo a mano es ignorar la unica correccion humana que
// hubo en todo el recorrido.

/**
 * Que categorias del snapshot toca cada area de guideline.
 *
 * ESTO ES UNA TABLA DECLARADA, NO UNA DEDUCCION. Las areas las declara
 * `packages/core` y las categorias las declara `packages/scanner`: ninguno de
 * los dos dice como se corresponden, asi que la correspondencia se escribe aqui
 * donde se puede leer y discutir. La alternativa —dejar que el modelo decida
 * que hallazgos son del area— pone la decision en el sitio donde no se puede
 * revisar.
 *
 * Un area que no aparece aqui no se puede sugerir, y eso se dice en vez de
 * mandarle al modelo el snapshot entero y esperar que acierte.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const CATEGORIAS_POR_AREA = Object.freeze({
  testing: ["testing", "ci"],
  seguridad: ["riesgos", "dependencias"],
  agentes: ["agentes"],
  git: ["ci", "guidelines"],
  backend: ["arquitectura", "stack", "patrones", "dependencias"],
  frontend: ["stack", "patrones", "arquitectura"],
  diseno: ["stack", "patrones"],
});

/**
 * Los hallazgos que tocan un area, o todos cuando no se filtra por area.
 *
 * @param {any} snapshot
 * @param {string} [area]
 */
export function hallazgosDe(snapshot, area) {
  const todos = snapshot?.hallazgos ?? [];
  if (!area) return todos;
  const categorias = CATEGORIAS_POR_AREA[area];
  if (!categorias) return [];
  return todos.filter((/** @type {any} */ h) => categorias.includes(h.categoria));
}

/**
 * Un hallazgo escrito como lo que es, para que el modelo no pueda confundir un
 * hueco con un dato ni una lectura con un hecho.
 *
 * @param {any} h
 */
function comoTexto(h) {
  const valor = h.valor;
  const cuerpo =
    valor === null || valor === undefined
      ? "HUECO DECLARADO — el scanner busco y no habia nada"
      : JSON.stringify(valor);
  const rutas = (h.evidencia ?? []).map((/** @type {any} */ e) => e.ruta).filter(Boolean);
  const respaldo =
    h.origen === "detectado"
      ? `respaldado por ${rutas.length} archivo(s): ${rutas.join(", ") || "(sin rutas)"}`
      : `LECTURA del scanner, confianza ${h.confianza ?? "desconocida"}, ningun archivo lo afirma`;
  return `- clave: ${h.clave}\n  categoria: ${h.categoria}\n  valor: ${cuerpo}\n  origen: ${h.origen} (${respaldo})`;
}

/**
 * El texto con los hechos, listo para el modelo.
 *
 * @param {any[]} hallazgos
 */
export function hechosComoTexto(hallazgos) {
  return hallazgos.map(comoTexto).join("\n");
}
