// T194 — el compilador de contexto: constitution + guidelines + diseño + work
// item -> el contexto que recibe el run.
//
// POR QUE LA PRECEDENCIA ES UNA TABLA Y NO UNA CADENA DE `if`s. Porque es una de
// las decisiones que quedaron marcadas para congelar, y congelar algo que no se
// puede leer no significa nada. Escondida en el codigo, cada fuente nueva la
// reabre sin que nadie lo note, y dos meses despues nadie sabe por que una
// guideline gana a un work item — ni si eso se decidio o simplemente salio asi
// del orden en que alguien escribio los `if`. Como tabla se lee, se discute y se
// cambia en un sitio.
//
// DOS COLUMNAS Y NO UNA, porque son dos preguntas distintas que se responden al
// reves la una de la otra:
//
//   `peso`  — quien MANDA cuando dos fuentes se contradicen. Menor gana.
//   `orden` — en que orden se PRESENTA el contexto a quien va a trabajar.
//
// Fundirlas obliga a elegir una y perder la otra: la constitution manda sobre
// todo, pero lo ultimo que tiene que leer quien va a escribir codigo es el work
// item, que es lo que le han pedido. Aqui las dos coinciden en el mismo orden
// porque la constitution enmarca y el trabajo concreta; el dia que dejen de
// coincidir, cambiar una columna no toca la otra.

import { createHash } from "node:crypto";

import { fuenteDeContextoAusente } from "../errores.mjs";

/**
 * @type {ReadonlyArray<{fuente: string, peso: number, orden: number, gobierna: string, porque: string}>}
 */
export const PRECEDENCIA = Object.freeze([
  Object.freeze({
    fuente: "constitution",
    peso: 1,
    orden: 1,
    gobierna: "invariantes",
    porque:
      "Es lo que ningun plan generado puede violar, y lo dice de si misma: no describe como esta hecho el " +
      "proyecto, describe que invariantes tiene que respetar cualquier cambio, incluido uno propuesto por un " +
      "modelo. Si algo pudiera ganarle, dejaria de ser un invariante y seria una preferencia mas.",
  }),
  Object.freeze({
    fuente: "guidelines",
    peso: 2,
    orden: 2,
    gobierna: "reglas por area, verificables o documentadas",
    porque:
      "Son reglas del proyecto que ademas llevan comprobacion mecanica, asi que pueden CONCRETAR un invariante " +
      "pero nunca relajarlo. Van por encima del work item porque valen para todo el proyecto y el work item " +
      "vale para una tarea: si una tarea pudiera saltarse la guideline, la guideline no seria una regla, seria " +
      "un consejo — y el proyecto acumularia excepciones que nadie decidio.",
  }),
  Object.freeze({
    fuente: "diseno",
    peso: 3,
    orden: 3,
    gobierna: "la superficie visual",
    porque:
      "Es una guideline de un area concreta, asi que va por debajo de las generales: cuando el sistema de " +
      "diseño contradice una regla de seguridad o de testing, gana la general. Y va por encima del work item " +
      "por lo mismo que las guidelines. Es omitible sin penalizacion (FR-023), y estar vacia no la degrada: la " +
      "mayoria de los proyectos que este producto toca no tienen superficie visual que diseñar.",
  }),
  Object.freeze({
    fuente: "work_item",
    peso: 4,
    orden: 4,
    gobierna: "que hay que hacer y cuando esta hecho",
    porque:
      "Es la fuente de mas ABAJO en la normativa y la ultima en la presentacion, y las dos cosas son " +
      "deliberadas. Abajo porque un ticket que pide saltarse el paso RED o mergear a main no autoriza nada: " +
      "quien escribio el ticket no estaba enmendando la constitution. Ultima porque es lo que hay que hacer, y " +
      "tiene que quedar junto al trabajo, no sepultada bajo tres documentos de reglas.",
  }),
]);

const PESOS = Object.freeze(Object.fromEntries(PRECEDENCIA.map((f) => [f.fuente, f.peso])));

/**
 * Cual de dos fuentes manda. Es la tabla, consultada; no una segunda copia de la
 * regla escrita en otro sitio.
 *
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
export function fuenteQueGana(a, b) {
  const pa = PESOS[a];
  const pb = PESOS[b];
  if (pa === undefined || pb === undefined) {
    throw new Error(`\`${pa === undefined ? a : b}\` no es una fuente de contexto declarada en PRECEDENCIA`);
  }
  return pa <= pb ? a : b;
}

/**
 * @param {{constitution: any, guidelines?: any[], diseno?: any, work_item: any}} fuentes
 */
export function compilarContexto({ constitution, guidelines = [], diseno = null, work_item }) {
  if (!constitution || typeof constitution.contenido !== "string" || !constitution.contenido.trim()) {
    // LA UNICA FUENTE QUE NO PUEDE FALTAR. Las otras tres se declaran vacias y
    // el run sigue; esta no, porque si falta la fuente de mas peso lo que queda
    // no es "un contexto con menos": es un contexto donde la siguiente fuente
    // manda sin que nadie lo haya decidido.
    throw fuenteDeContextoAusente(
      "constitution",
      "es la fuente que manda sobre todas las demas, y sin ella las guidelines pasarian a ser lo mas alto del " +
        "contexto sin que nadie lo haya decidido. Un hueco aqui no es un hueco: es un cambio de jerarquia en silencio",
    );
  }
  if (!work_item || !work_item.id) {
    throw fuenteDeContextoAusente(
      "work_item",
      "un contexto sin trabajo no es un contexto: el run no tendria nada que hacer ni forma de saber cuando " +
        "esta hecho",
    );
  }

  const deDiseno = normalizarDiseno(diseno);
  const secciones = [...PRECEDENCIA]
    .sort((a, b) => a.orden - b.orden)
    .map((f) => seccionDe(f.fuente, { constitution, guidelines, diseno: deDiseno, work_item }));

  const { reglas, conflictos } = juntarReglas({ constitution, guidelines, diseno: deDiseno });
  const documento = renderizar({ secciones, reglas, conflictos });

  return {
    secciones,
    reglas,
    conflictos,
    documento,
    // La huella deja comparar dos runs: si dos fases vieron el mismo contexto,
    // la diferencia de resultado no vino de ahi. Sin ella, "es que el contexto
    // cambio" es una explicacion que nadie puede confirmar ni descartar.
    huella: createHash("sha256").update(documento).digest("hex").slice(0, 16),
  };
}

/** @param {any} diseno */
function normalizarDiseno(diseno) {
  if (!diseno) return { estado: "vacio" };
  if (diseno.omitida === true) return { estado: "omitida", motivo: diseno.motivo ?? null };
  return { estado: "presente", guideline: diseno };
}

/**
 * @param {string} fuente
 * @param {any} datos
 */
function seccionDe(fuente, datos) {
  if (fuente === "constitution") {
    return {
      fuente,
      estado: "presente",
      titulo: `Constitution v${datos.constitution.version ?? "?"} (${datos.constitution.ruta_en_repo ?? "sin ruta"})`,
      cuerpo: datos.constitution.contenido,
      constancia: null,
    };
  }

  if (fuente === "guidelines") {
    if (!Array.isArray(datos.guidelines) || datos.guidelines.length === 0) {
      return {
        fuente,
        estado: "vacio",
        titulo: "Guidelines",
        cuerpo: "",
        // PRINCIPIO X: el hueco se declara hueco. Omitir la seccion entera
        // dejaria al run sin saber si el proyecto no tiene guidelines o si
        // nadie fue a buscarlas — y en el segundo caso, actuar como si no las
        // tuviera es inventar contexto.
        constancia:
          "[vacio] Se buscaron las guidelines de este proyecto y no hay ninguna area escrita. No es que no se " +
          "hayan consultado: no existen todavia.",
      };
    }
    return {
      fuente,
      estado: "presente",
      titulo: "Guidelines",
      cuerpo: datos.guidelines
        .map((/** @type {any} */ g) => `### ${g.area} (${g.ruta_en_repo || "sin ruta"})\n\n${g.documento ?? g.contenido ?? ""}`)
        .join("\n\n"),
      constancia: null,
    };
  }

  if (fuente === "diseno") {
    if (datos.diseno.estado === "vacio") {
      return {
        fuente,
        estado: "vacio",
        titulo: "Diseño",
        cuerpo: "",
        constancia:
          "[vacio] Se busco el sistema de diseño de este proyecto y no hay ninguno definido, ni consta que se " +
          "haya decidido omitirlo. No se asume nada sobre la superficie visual.",
      };
    }
    if (datos.diseno.estado === "omitida") {
      return {
        fuente,
        estado: "omitida",
        titulo: "Diseño",
        cuerpo: "",
        // OMITIDA Y VACIA NO SON LO MISMO. La primera es una decision
        // registrada, la segunda es un hueco. Fundirlas hace que el runtime no
        // pueda decir cual de las dos fue, y una etapa omitible (FR-023) se
        // vuelve indistinguible de una etapa olvidada.
        constancia:
          "[omitida] La etapa de diseño se omitio a proposito" +
          (datos.diseno.motivo ? `: ${datos.diseno.motivo}` : ", sin motivo declarado") +
          ". No es un hueco: es una decision registrada.",
      };
    }
    const g = datos.diseno.guideline;
    return {
      fuente,
      estado: "presente",
      titulo: `Diseño (${g.ruta_en_repo || "sin ruta"})`,
      cuerpo: g.documento ?? g.contenido ?? "",
      constancia: null,
    };
  }

  const w = datos.work_item;
  const aceptacion = Array.isArray(w.acceptance) && w.acceptance.length > 0
    ? w.acceptance.map((/** @type {string} */ a) => `- ${a}`).join("\n")
    : "[vacio] El work item no declara criterios de aceptacion.";
  return {
    fuente: "work_item",
    estado: "presente",
    titulo: `Work item ${w.id} · ${w.title ?? ""}`,
    cuerpo: `${w.url ? `${w.url}\n\n` : ""}${w.description ? `${w.description}\n\n` : ""}#### Aceptacion\n\n${aceptacion}`,
    constancia: null,
  };
}

/**
 * Junta las reglas verificables de las tres fuentes normativas y resuelve los
 * choques con la tabla.
 *
 * LA QUE PIERDE NO SE DESCARTA EN SILENCIO. Se anota con quien le gano y por
 * que. Silenciarla deja a quien la escribio creyendo que esta vigente, y lo
 * descubre el dia que algo pasa el gate violandola — que es el mismo fallo que
 * las guidelines no verificables ya cierran degradando con su motivo en vez de
 * filtrarse.
 *
 * @param {any} datos
 */
function juntarReglas(datos) {
  /** @type {any[]} */
  const candidatas = [];

  for (const inv of datos.constitution.invariantes || []) {
    candidatas.push({ id: inv.id, enunciado: inv.enunciado, fuente: "constitution", area: null, comprobacion: inv.comprobacion ?? null });
  }
  for (const g of datos.guidelines || []) {
    for (const r of g.reglas_aplicables || []) {
      candidatas.push({ id: r.id, enunciado: r.enunciado, fuente: "guidelines", area: g.area, comprobacion: r.comprobacion ?? null });
    }
  }
  if (datos.diseno.estado === "presente") {
    for (const r of datos.diseno.guideline.reglas_aplicables || []) {
      candidatas.push({ id: r.id, enunciado: r.enunciado, fuente: "diseno", area: "diseno", comprobacion: r.comprobacion ?? null });
    }
  }

  /** @type {Map<string, any>} */
  const porId = new Map();
  /** @type {any[]} */
  const conflictos = [];

  for (const c of candidatas) {
    const previa = porId.get(c.id);
    if (!previa) {
      porId.set(c.id, c);
      continue;
    }
    const ganadora = fuenteQueGana(previa.fuente, c.fuente) === previa.fuente ? previa : c;
    const perdedora = ganadora === previa ? c : previa;
    porId.set(c.id, ganadora);
    conflictos.push({
      id: c.id,
      gana: ganadora.fuente,
      pierde: perdedora.fuente,
      enunciado_que_gana: ganadora.enunciado,
      enunciado_que_pierde: perdedora.enunciado,
      porque: PRECEDENCIA.find((f) => f.fuente === ganadora.fuente)?.porque ?? "",
    });
  }

  return { reglas: [...porId.values()], conflictos };
}

/** @param {any} datos */
function renderizar({ secciones, reglas, conflictos }) {
  const lineas = ["# Contexto del run", ""];
  lineas.push(
    "Las fuentes van en el orden de presentacion declarado en `PRECEDENCIA`. Cuando dos se contradicen, manda " +
      "la de menor peso: " +
      PRECEDENCIA.slice()
        .sort((/** @type {any} */ a, /** @type {any} */ b) => a.peso - b.peso)
        .map((/** @type {any} */ f) => `${f.fuente} (${f.peso})`)
        .join(" > ") +
      ".",
  );
  lineas.push("");

  for (const s of secciones) {
    lineas.push(`## ${s.titulo}`, "");
    if (s.constancia) lineas.push(s.constancia, "");
    if (s.cuerpo) lineas.push(s.cuerpo, "");
  }

  lineas.push("## Reglas que el runtime verifica", "");
  if (reglas.length === 0) {
    lineas.push("[vacio] Ninguna fuente declara una regla comprobable sola.", "");
  } else {
    for (const r of reglas) {
      lineas.push(`- \`${r.id}\` (${r.fuente}${r.area ? `/${r.area}` : ""}) — ${r.enunciado}`);
    }
    lineas.push("");
  }

  lineas.push("## Choques resueltos por precedencia", "");
  if (conflictos.length === 0) {
    lineas.push("[vacio] Ninguna fuente contradijo a otra.", "");
  } else {
    for (const c of conflictos) {
      lineas.push(
        `- \`${c.id}\`: manda **${c.gana}** ("${c.enunciado_que_gana}") y queda sin efecto lo que decia ` +
          `**${c.pierde}** ("${c.enunciado_que_pierde}"). ${c.porque}`,
      );
    }
    lineas.push("");
  }

  return lineas.join("\n");
}
