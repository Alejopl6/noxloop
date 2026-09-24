// FR-028 — una recomendacion que contradice la constitution del proyecto no se
// propone sin declarar el conflicto.
//
// EL FALLO QUE EVITA. Una propuesta que viola las reglas del propio proyecto es
// ruido, y el ruido entrena a ignorar las propuestas. Es la misma medida que se
// aplica a la revision automatica: un revisor con precision baja no es medio
// util, es inutil, porque leer sus hallazgos cuesta mas que lo que encuentra.
// Una lista de recomendaciones con una que contradice la constitution se lee
// entera con desconfianza.
//
// POR QUE SE MARCA Y NO SE ESCONDE. Porque a veces la contradiccion es el
// punto: el proyecto declaro "sin dependencias nuevas" hace un año y hoy la
// dependencia es la respuesta correcta. Esconder la propuesta le quita al
// operador la decision; marcarla con el conflicto se la da junto con la
// informacion para tomarla.
//
// POR QUE LOS INVARIANTES SE DECLARAN Y NO SE DEDUCEN DE LA PROSA. Porque
// deducir "este proyecto prohibe dependencias nuevas" leyendo un markdown es
// exactamente el contexto inventado que el principio X prohibe: no hay forma de
// distinguir un invariante de un ejemplo, y un falso positivo aqui marca como
// conflictiva una recomendacion buena, que es la otra forma de perder la lista.
// Los invariantes son datos que el operador escribe al fijar la constitution.
//
// El unico implicito es el que no hace falta que nadie escriba: una
// recomendacion del bootstrap que reescribe la constitution del proyecto esta
// cambiando las reglas desde dentro del instalador.

/** Lo que una recomendacion puede hacer, en el vocabulario que los invariantes prohiben. */
export const EFECTOS = Object.freeze([
  "crear_archivo",
  "modificar_archivo",
  "agregar_dependencia",
  "ejecutar_en_ci",
  "habilitar_capacidad",
]);

/**
 * @param {any} constitution
 * @returns {any[]}
 */
export function invariantesDe(constitution) {
  if (!constitution) return [];
  const declarados = Array.isArray(constitution.invariantes) ? [...constitution.invariantes] : [];
  if (typeof constitution.ruta_en_repo === "string" && constitution.ruta_en_repo.length > 0) {
    declarados.push({
      id: "la_constitution_no_la_reescribe_el_bootstrap",
      enunciado:
        "La constitution del proyecto la escribe el operador en su etapa. Una recomendacion que la reescribe " +
        "esta cambiando las reglas desde dentro del instalador que esas reglas gobiernan",
      prohibe: { efecto: "*", rutas: [constitution.ruta_en_repo] },
    });
  }
  return declarados;
}

/**
 * Lo que una recomendacion hace, en efectos comparables.
 *
 * Los efectos de escritura se derivan de sus cambios en vez de declararse: un
 * efecto declarado a mano se olvida, y el que se olvida es el que pasa la
 * comprobacion sin que nadie lo vea.
 *
 * @param {any} recomendacion
 * @returns {Array<{efecto: string, valor: string}>}
 */
export function efectosDe(recomendacion) {
  const declarados = (recomendacion.efectos ?? []).map((/** @type {any} */ e) => ({
    efecto: e.efecto,
    valor: String(e.valor ?? ""),
  }));
  const deEscritura = (recomendacion.cambios ?? []).map((/** @type {any} */ c) => ({
    efecto: c.accion === "crear" ? "crear_archivo" : "modificar_archivo",
    valor: c.ruta,
  }));
  return [...declarados, ...deEscritura];
}

/**
 * @param {any} prohibe
 * @param {{efecto: string, valor: string}} efecto
 */
function choca(prohibe, efecto) {
  if (!prohibe) return false;
  if (prohibe.efecto !== "*" && prohibe.efecto !== efecto.efecto) return false;
  if (Array.isArray(prohibe.rutas) && prohibe.rutas.length > 0) {
    return prohibe.rutas.some((/** @type {string} */ r) => efecto.valor === r || efecto.valor.startsWith(r));
  }
  if (Array.isArray(prohibe.valores) && prohibe.valores.length > 0) {
    return prohibe.valores.includes(efecto.valor);
  }
  return true;
}

/**
 * @param {any} recomendacion
 * @param {any[]} invariantes
 * @returns {string|null} el conflicto, con el invariante que lo declara y lo que la recomendacion hace
 */
export function conflictoDe(recomendacion, invariantes) {
  const efectos = efectosDe(recomendacion);
  /** @type {string[]} */
  const choques = [];

  for (const invariante of invariantes) {
    for (const efecto of efectos) {
      if (!choca(invariante.prohibe, efecto)) continue;
      choques.push(
        `\`${invariante.id}\` — ${invariante.enunciado}. Esta recomendacion hace \`${efecto.efecto}\`` +
          (efecto.valor ? ` sobre \`${efecto.valor}\`` : "") +
          ".",
      );
      break;
    }
  }

  return choques.length === 0 ? null : choques.join(" ");
}
