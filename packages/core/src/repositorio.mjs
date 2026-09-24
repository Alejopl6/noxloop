// `RepositorioDeNucleo`: la unica via por la que las etapas 02-05 tocan un
// almacen.
//
// POR QUE HAY UNA INTERFAZ Y UNA IMPLEMENTACION EN MEMORIA, Y NINGUN ESQUEMA.
// Por lo mismo que en la boveda: el almacen consultable lo esta construyendo
// otro paquete en paralelo, y escribir aqui tablas, indices y migraciones es
// comprometer esa decision desde el sitio equivocado — hay que rehacerlo entero
// cuando se tome, y mientras tanto hay dos esquemas que se contradicen. Lo que
// si se puede fijar ahora, y es lo que de verdad importa, son las operaciones:
// que se pregunta, que se devuelve y que garantias tiene.
//
// TODO(persistencia): implementar `RepositorioDeNucleo` contra el almacen
// consultable cuando exista. Las pruebas de este paquete corren contra la
// version en memoria y valen igual para la persistente: no miran el
// almacenamiento, miran que la version anterior se recupere, que haya una sola
// constitution vigente y que ninguna transicion ocurra sin su artefacto.
//
// TODO(estado): la maquina de estados del proyecto la implementa tambien el
// almacen (es su escritor unico). La guarda que hay aqui es la del doble de
// prueba, y esta escrita para que la version persistente pueda copiarla tal
// cual: la tabla `TRANSICIONES` es datos, no codigo.

import { proyectoDesconocido, transicionInvalida } from "./errores.mjs";

/** @type {readonly string[]} */
export const ESTADOS = Object.freeze([
  "CREATED",
  "DISCOVERED",
  "CONSTITUTED",
  "BOOTSTRAPPED",
  "CONNECTED",
  "ACTIVE",
]);

/**
 * La maquina de estados del proyecto, como tabla.
 *
 * `artefacto` es lo que tiene que existir para que la transicion sea legitima.
 * Sin el, el proyecto diria que una etapa esta resuelta cuando no lo esta, y
 * eso es exactamente lo que el principio del exit code prohibe: un estado
 * escrito a partir de una afirmacion en vez de a partir de la evidencia.
 *
 * @type {ReadonlyArray<{desde: string, hasta: string, artefacto: string, solo_si?: (p: any) => boolean, porque?: string}>}
 */
export const TRANSICIONES = Object.freeze([
  { desde: "CREATED", hasta: "DISCOVERED", artefacto: "snapshot" },
  {
    desde: "CREATED",
    hasta: "CONSTITUTED",
    artefacto: "constitution",
    // La unica transicion que salta un estado, y solo para un proyecto nuevo:
    // no hay codigo que escanear, asi que no hay snapshot que aceptar.
    solo_si: (p) => p.origen === "nuevo",
    porque: "solo un proyecto de origen `nuevo` puede saltarse el descubrimiento, porque no hay codigo que leer",
  },
  { desde: "DISCOVERED", hasta: "CONSTITUTED", artefacto: "constitution" },
  { desde: "CONSTITUTED", hasta: "BOOTSTRAPPED", artefacto: "bootstrap" },
  { desde: "BOOTSTRAPPED", hasta: "CONNECTED", artefacto: "conexion" },
  { desde: "CONNECTED", hasta: "ACTIVE", artefacto: "flota" },
  // Reconfigurar no retrocede: se reabre la etapa sin cambiar el estado.
  { desde: "ACTIVE", hasta: "ACTIVE", artefacto: "flota" },
]);

/**
 * @typedef {object} RepositorioDeNucleo
 * @property {(p: any) => void} guardarProyecto
 * @property {(id: string) => any|null} proyecto
 * @property {(id: string, hasta: string, artefacto: any) => any} transicionar
 * @property {(c: any) => void} guardarConstitution
 * @property {(project_id: string) => any|null} constitutionVigente
 * @property {(project_id: string) => any[]} constituciones
 * @property {(a: any) => void} guardarEnmienda
 * @property {(project_id: string) => any[]} enmiendas
 * @property {(g: any) => void} guardarGuideline
 * @property {(project_id: string, area: string) => any|null} guideline
 * @property {(project_id: string) => any[]} guidelines
 * @property {(r: any) => void} guardarRecomendacion
 * @property {(id: string) => any|null} recomendacion
 * @property {(project_id: string) => any[]} recomendaciones
 * @property {(e: any) => void} registrarDecision
 * @property {(project_id: string) => any[]} decisiones
 */

/** Congela en profundidad: lo que sale del repositorio no se muta por la espalda. */
function congelar(/** @type {any} */ valor) {
  if (valor === null || typeof valor !== "object") return valor;
  for (const v of Object.values(valor)) congelar(v);
  return Object.freeze(valor);
}

const copia = (/** @type {any} */ o) => (o === null || o === undefined ? o : congelar(JSON.parse(JSON.stringify(o))));

/**
 * @returns {RepositorioDeNucleo}
 */
export function repositorioEnMemoria() {
  /** @type {Map<string, any>} */
  const proyectos = new Map();
  /** @type {any[]} */
  const constituciones = [];
  /** @type {any[]} */
  const enmiendas = [];
  /** @type {Map<string, any>} */
  const guidelines = new Map();
  /** @type {Map<string, any>} */
  const recomendaciones = new Map();
  /** @type {any[]} */
  const decisiones = [];

  return {
    guardarProyecto(p) {
      proyectos.set(p.id, { ...p });
    },
    proyecto(id) {
      return copia(proyectos.get(id) ?? null);
    },

    transicionar(id, hasta, artefacto) {
      const actual = proyectos.get(id);
      if (!actual) throw proyectoDesconocido(id);
      const desde = actual.estado;
      const regla = TRANSICIONES.find((t) => t.desde === desde && t.hasta === hasta);
      if (!regla) {
        throw transicionInvalida(
          desde,
          hasta,
          `esa transicion no esta en la maquina de estados (desde \`${desde}\` solo se puede ir a ` +
            `${TRANSICIONES.filter((t) => t.desde === desde).map((t) => `\`${t.hasta}\``).join(", ") || "ningun sitio"})`,
        );
      }
      if (regla.solo_si && !regla.solo_si(actual)) {
        throw transicionInvalida(desde, hasta, regla.porque ?? "no se cumple la condicion de esa transicion");
      }
      if (artefacto === null || artefacto === undefined) {
        throw transicionInvalida(desde, hasta, `falta el artefacto \`${regla.artefacto}\` que la respalda`);
      }
      const siguiente = { ...actual, estado: hasta, actualizado: new Date().toISOString() };
      proyectos.set(id, siguiente);
      return copia(siguiente);
    },

    guardarConstitution(c) {
      const i = constituciones.findIndex((x) => x.id === c.id);
      if (i >= 0) constituciones[i] = { ...c };
      else constituciones.push({ ...c });
    },
    constitutionVigente(project_id) {
      return copia(constituciones.find((c) => c.project_id === project_id && c.vigente) ?? null);
    },
    constituciones(project_id) {
      return constituciones.filter((c) => c.project_id === project_id).map((c) => copia(c));
    },

    guardarEnmienda(a) {
      enmiendas.push({ ...a });
    },
    enmiendas(project_id) {
      return enmiendas.filter((a) => a.project_id === project_id).map((a) => copia(a));
    },

    guardarGuideline(g) {
      guidelines.set(`${g.project_id}:${g.area}`, { ...g });
    },
    guideline(project_id, area) {
      return copia(guidelines.get(`${project_id}:${area}`) ?? null);
    },
    guidelines(project_id) {
      return [...guidelines.values()].filter((g) => g.project_id === project_id).map((g) => copia(g));
    },

    guardarRecomendacion(r) {
      recomendaciones.set(r.id, { ...r });
    },
    recomendacion(id) {
      return copia(recomendaciones.get(id) ?? null);
    },
    recomendaciones(project_id) {
      return [...recomendaciones.values()].filter((r) => r.project_id === project_id).map((r) => copia(r));
    },

    registrarDecision(e) {
      decisiones.push({ ...e });
    },
    decisiones(project_id) {
      return decisiones.filter((d) => d.project_id === project_id).map((d) => copia(d));
    },
  };
}
