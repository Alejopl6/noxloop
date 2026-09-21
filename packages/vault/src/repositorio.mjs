// `RepositorioDeBoveda`: la unica via por la que el inventario, los grants y la
// auditoria tocan un almacen.
//
// POR QUE HAY UNA INTERFAZ Y UNA IMPLEMENTACION EN MEMORIA, Y NINGUN ESQUEMA.
// El almacen persistente de esta feature todavia esta en decision. Escribir aqui
// un esquema SQL con sus tablas, sus indices y su migracion es comprometer esa
// decision desde el sitio equivocado, y hay que rehacerlo entero cuando se tome.
// Lo que si se puede fijar ahora —y es lo que de verdad importa— son las
// operaciones: que se pregunta, que se devuelve y que no se devuelve nunca.
//
// TODO(persistencia): implementar `RepositorioDeBoveda` contra el almacen cuando
// se decida cual es. Las pruebas de este paquete corren contra la version en
// memoria y valen igual para la persistente: no miran el almacenamiento, miran
// que el valor no aparezca y que la vigencia se respete.

import { estadoDelGrant } from "./modelo.mjs";

/**
 * @typedef {object} RepositorioDeBoveda
 * @property {(c: any) => void} guardarCredencial
 * @property {(ref: string) => any|null} credencialPorRef
 * @property {(id: string) => any|null} credencialPorId
 * @property {() => any[]} credenciales
 * @property {(ref: string) => void} borrarCredencial
 * @property {(g: any) => void} guardarGrant
 * @property {(id: string) => any|null} grantPorId
 * @property {() => any[]} grants
 * @property {(criterio: any, ahora: number) => any} alcance
 * @property {() => any} instantanea
 */

/** Congela en profundidad: lo que sale del repositorio no se puede mutar por la espalda. */
function congelar(valor) {
  if (valor === null || typeof valor !== "object") return valor;
  for (const v of Object.values(valor)) congelar(v);
  return Object.freeze(valor);
}

const copia = (o) => (o === null || o === undefined ? o : congelar(JSON.parse(JSON.stringify(o))));

/**
 * @returns {RepositorioDeBoveda}
 */
export function repositorioEnMemoria() {
  /** @type {Map<string, any>} */
  const credenciales = new Map();
  /** @type {Map<string, any>} */
  const grants = new Map();

  return {
    guardarCredencial(c) {
      credenciales.set(c.ref_boveda, { ...c });
    },
    credencialPorRef(ref) {
      return copia(credenciales.get(ref) ?? null);
    },
    credencialPorId(id) {
      for (const c of credenciales.values()) if (c.id === id) return copia(c);
      return null;
    },
    credenciales() {
      return [...credenciales.values()].map((c) => copia(c));
    },
    borrarCredencial(ref) {
      credenciales.delete(ref);
    },
    guardarGrant(g) {
      grants.set(g.id, { ...g });
    },
    grantPorId(id) {
      return copia(grants.get(id) ?? null);
    },
    grants() {
      return [...grants.values()].map((g) => copia(g));
    },

    /**
     * La vista inversa (FR-045): que alcanza que, contando solo lo vigente.
     *
     * EL FALLO QUE EVITA. "Que puede tocar esta credencial" respondido con los
     * grants revocados incluidos convierte la pantalla en ruido, y el operador
     * deja de mirarla. Peor: si la revocacion no se ve reflejada, nadie sabe si
     * revocar sirvio.
     */
    alcance(criterio, ahora) {
      const vigentes = [...grants.values()].filter((g) => estadoDelGrant(g, ahora).vigente);
      const filtrados = vigentes.filter((g) =>
        Object.entries(criterio).every(([campo, valor]) => g[campo] === valor),
      );
      return congelar({
        grants: filtrados.map((g) => ({ ...g })),
        proyectos: [...new Set(filtrados.map((g) => g.project_id))],
        agentes: [...new Set(filtrados.map((g) => g.agent_id))],
        credenciales: [...new Set(filtrados.map((g) => g.credential_id))],
      });
    },

    instantanea() {
      return congelar({
        credenciales: [...credenciales.values()].map((c) => ({ ...c })),
        grants: [...grants.values()].map((g) => ({ ...g })),
      });
    },
  };
}
