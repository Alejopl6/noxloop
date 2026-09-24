// El `RepositorioDeBoveda` contra SQLite: la implementacion persistente de la
// interfaz que `packages/vault/src/repositorio.mjs` dejo inyectable con un TODO.
//
// LO QUE ESE TODO DICE, Y POR QUE SE PUEDE CUMPLIR SIN IMPORTARLO. "Las pruebas
// de este paquete corren contra la version en memoria y valen igual para la
// persistente: no miran el almacenamiento, miran que el valor no aparezca y que
// la vigencia se respete". Eso es el contrato: las diez operaciones, y las dos
// promesas. Aqui se implementan contra tablas, y no hay ni un import a
// `packages/vault` — este paquete viaja al escritorio como recurso suelto y un
// import que salga muere con `ERR_MODULE_NOT_FOUND` en el binario instalado.
//
// LOS DOS VOCABULARIOS. `data-model.md` nombra los campos de `Grant` como
// `vigencia_desde` / `vigencia_hasta` / `concedido_en` / `revocado_en`, y el
// modelo en memoria de la boveda los llama `otorgadoEn` / `vigenciaHasta` /
// `revocadoEn`. Las columnas llevan los nombres del modelo de datos, que es la
// especificacion, y aqui se traduce lo que llega en el otro vocabulario. La
// traduccion vive en UN sitio a proposito: repartida, es donde se pierden los
// invariantes el dia que alguien mapea `vigencia_hasta` a `expira` porque
// suenan parecido.
//
// LO QUE NO SE TRADUCE SOLO. `data-model.md` exige `proveedor`, `ambito` y
// `alcance_declarado` en toda credencial, y `concedido_por` en todo grant. El
// modelo en memoria de la boveda no los trae. El almacen los PIDE por su nombre
// en vez de rellenarlos con lo probable: un `proveedor` inventado aqui se lee
// despues como un dato verificado, que es el fallo entero del principio X.

import { fallar } from "./errores.mjs";
import { ENUMS } from "./esquema.mjs";

/** Congela en profundidad: lo que sale del repositorio no se muta por la espalda. */
function congelar(valor) {
  if (valor === null || typeof valor !== "object") return valor;
  for (const v of Object.values(valor)) congelar(v);
  return Object.freeze(valor);
}

/** Las columnas de `credential`, en el orden del esquema. La lista es la lista: nada que no este aqui llega a la base. */
const COLUMNAS_CREDENCIAL = [
  "id",
  "workspace_id",
  "nombre",
  "proveedor",
  "tipo",
  "ambito",
  "project_id",
  "alcance_declarado",
  "huella",
  "ref_boveda",
  "backend",
  "creada",
  "rotada",
  "expira",
  "aviso_dias_antes",
  "estado",
];

const COLUMNAS_GRANT = [
  "id",
  "project_id",
  "agent_id",
  "credential_id",
  "vigencia_desde",
  "vigencia_hasta",
  "concedido_por",
  "concedido_en",
  "revocado_en",
];

/** @param {any} valor @returns {string|null} */
const instante = (valor) => {
  if (valor === null || valor === undefined) return null;
  return typeof valor === "number" ? new Date(valor).toISOString() : String(valor);
};

/**
 * Traduce del vocabulario de la boveda al del modelo de datos.
 *
 * Solo traduce: no inventa. Lo que no llega por ninguno de los dos nombres se
 * reclama por el nombre del modelo de datos.
 */
function credencialACamposDeTabla(entrada) {
  const ambito = entrada.ambito ?? (entrada.project_id ? "proyecto" : "global");
  const fila = {
    id: entrada.id,
    workspace_id: entrada.workspace_id ?? entrada.workspace,
    nombre: entrada.nombre,
    proveedor: entrada.proveedor,
    tipo: entrada.tipo,
    ambito,
    project_id: entrada.project_id ?? null,
    alcance_declarado: entrada.alcance_declarado,
    huella: entrada.huella ?? null,
    ref_boveda: entrada.ref_boveda,
    backend: entrada.backend,
    creada: instante(entrada.creada ?? entrada.creadaEn) ?? new Date().toISOString(),
    rotada: instante(entrada.rotada ?? entrada.rotadaEn),
    expira: instante(entrada.expira),
    aviso_dias_antes: entrada.aviso_dias_antes ?? 14,
    estado: entrada.estado ?? "activa",
  };
  for (const campo of [
    "id",
    "workspace_id",
    "nombre",
    "proveedor",
    "tipo",
    "ambito",
    "alcance_declarado",
    "ref_boveda",
    "backend",
  ]) {
    if (fila[campo] === undefined || fila[campo] === null || fila[campo] === "") {
      fallar("campo_obligatorio_ausente", {
        tabla: "credential",
        campo,
        pista:
          campo === "proveedor"
            ? "La `Credential` de `packages/vault` no lo trae: lo declara quien da de alta la credencial."
            : "",
      });
    }
  }
  for (const campo of ["tipo", "ambito", "backend", "estado"]) {
    const permitidos = ENUMS[`credential.${campo}`];
    if (!permitidos.includes(fila[campo])) {
      fallar("valor_fuera_del_enum", { tabla: "credential", campo, valor: fila[campo], permitidos });
    }
  }
  return fila;
}

function grantACamposDeTabla(entrada) {
  const fila = {
    id: entrada.id,
    project_id: entrada.project_id,
    agent_id: entrada.agent_id,
    credential_id: entrada.credential_id,
    vigencia_desde: instante(entrada.vigencia_desde ?? entrada.otorgadoEn) ?? new Date().toISOString(),
    vigencia_hasta: instante(entrada.vigencia_hasta ?? entrada.vigenciaHasta),
    concedido_por: entrada.concedido_por,
    concedido_en: instante(entrada.concedido_en ?? entrada.otorgadoEn) ?? new Date().toISOString(),
    revocado_en: instante(entrada.revocado_en ?? entrada.revocadoEn),
  };
  for (const campo of ["id", "project_id", "agent_id", "credential_id", "concedido_por"]) {
    if (!fila[campo]) {
      fallar("campo_obligatorio_ausente", {
        tabla: "grant",
        campo,
        pista:
          campo === "concedido_por"
            ? "Siempre una persona: un grant concedido por el sistema no se le puede preguntar a nadie."
            : "",
      });
    }
  }
  return fila;
}

/**
 * @param {import("./sqlite.mjs").BaseSqlite} base
 */
export function repositorioDeBoveda(base) {
  /**
   * La definicion de "hoy" (FR-045), en UN solo sitio.
   *
   * La vigencia se filtra EN SQL y no en JavaScript. No es rendimiento: con el
   * filtro en memoria hay un momento en que las filas revocadas estan en un
   * array, y el primer `console.log` de depuracion o el primer `return` que se
   * olvida de filtrar las ensena.
   *
   * @param {Record<string, any>} criterio
   */
  function consultaDeAlcance(criterio) {
    const condiciones = [];
    const parametros = [];
    for (const campo of ["credential_id", "project_id", "agent_id"]) {
      if (criterio[campo] !== undefined) {
        condiciones.push(`g.${campo} = ?`);
        parametros.push(criterio[campo]);
      }
    }
    const sql =
      'SELECT g.* FROM "grant" g WHERE g.revocado_en IS NULL AND g.vigencia_desde <= ? ' +
      "AND (g.vigencia_hasta IS NULL OR g.vigencia_hasta > ?)" +
      (condiciones.length ? ` AND ${condiciones.join(" AND ")}` : "") +
      " ORDER BY g.concedido_en";
    return { sql, parametros: (ahora) => [ahora, ahora, ...parametros] };
  }

  return {
    guardarCredencial(credencial) {
      const fila = credencialACamposDeTabla(credencial);
      // `UPSERT` por `ref_boveda` y no por `id`: la referencia es la identidad
      // con la que la boveda habla del secreto, y rotar una credencial no crea
      // una segunda fila que luego aparece dos veces en la pantalla.
      base.escribir(
        `INSERT INTO credential (${COLUMNAS_CREDENCIAL.join(", ")}) VALUES (${COLUMNAS_CREDENCIAL.map(() => "?").join(", ")})
         ON CONFLICT(ref_boveda) DO UPDATE SET
           nombre = excluded.nombre,
           proveedor = excluded.proveedor,
           tipo = excluded.tipo,
           ambito = excluded.ambito,
           project_id = excluded.project_id,
           alcance_declarado = excluded.alcance_declarado,
           huella = excluded.huella,
           backend = excluded.backend,
           rotada = excluded.rotada,
           expira = excluded.expira,
           aviso_dias_antes = excluded.aviso_dias_antes,
           estado = excluded.estado`,
        COLUMNAS_CREDENCIAL.map((c) => fila[c]),
      );
      return this.credencialPorRef(fila.ref_boveda);
    },

    credencialPorRef(ref) {
      return congelar(base.consultarUno("SELECT * FROM credential WHERE ref_boveda = ?", [ref]));
    },

    credencialPorId(id) {
      return congelar(base.consultarUno("SELECT * FROM credential WHERE id = ?", [id]));
    },

    credenciales() {
      return congelar(base.consultar("SELECT * FROM credential ORDER BY nombre"));
    },

    /**
     * Borrar la credencial se lleva sus grants por `ON DELETE CASCADE`.
     *
     * EL FALLO QUE EVITA. Un grant que sobrevive a su credencial autoriza
     * contra nada: aparece en la vista inversa de un id que ya no existe, y la
     * pantalla muestra permisos vivos sobre un secreto borrado. El rastro de
     * quien lo tuvo no se pierde: vive en `audit_event`, que no cuelga de
     * ninguna clave foranea justamente por esto.
     */
    borrarCredencial(ref) {
      base.escribir("DELETE FROM credential WHERE ref_boveda = ?", [ref]);
    },

    guardarGrant(grant) {
      const fila = grantACamposDeTabla(grant);
      base.escribir(
        `INSERT INTO "grant" (${COLUMNAS_GRANT.join(", ")}) VALUES (${COLUMNAS_GRANT.map(() => "?").join(", ")})
         ON CONFLICT(id) DO UPDATE SET
           vigencia_desde = excluded.vigencia_desde,
           vigencia_hasta = excluded.vigencia_hasta,
           revocado_en = excluded.revocado_en`,
        COLUMNAS_GRANT.map((c) => fila[c]),
      );
      return this.grantPorId(fila.id);
    },

    grantPorId(id) {
      return congelar(base.consultarUno('SELECT * FROM "grant" WHERE id = ?', [id]));
    },

    grants() {
      return congelar(base.consultar('SELECT * FROM "grant" ORDER BY concedido_en'));
    },

    /**
     * LA VISTA INVERSA (FR-045): dada una credencial, que agentes y proyectos
     * la alcanzan HOY.
     *
     * EL FALLO QUE EVITA, Y YA ESTA ESCRITO EN EL REPOSITORIO EN MEMORIA DE LA
     * BOVEDA: "que puede tocar esta credencial" respondido con los grants
     * revocados incluidos convierte la pantalla en ruido y el operador deja de
     * mirarla; y si la revocacion no se ve reflejada, nadie sabe si revocar
     * sirvio.
     *
     * Se miran las TRES condiciones y no solo la revocacion: `vigencia_desde`
     * existe en el modelo, y una consulta que solo mira `hasta` deja que un
     * grant preparado para el lunes autorice el viernes.
     *
     * @param {{credential_id?: string, project_id?: string, agent_id?: string}} criterio
     * @param {number} ahora milisegundos; lo pasa quien llama para que la prueba pueda mover el reloj
     */
    alcance(criterio, ahora) {
      const { sql, parametros } = consultaDeAlcance(criterio);
      const cuando = new Date(ahora).toISOString();
      const filas = base.consultar(sql, parametros(cuando));
      return congelar({
        grants: filas.map((g) => ({ ...g })),
        proyectos: [...new Set(filas.map((g) => String(g.project_id)))],
        agentes: [...new Set(filas.map((g) => String(g.agent_id)))],
        credenciales: [...new Set(filas.map((g) => String(g.credential_id)))],
      });
    },

    /** El plan de la vista inversa, para la guarda de rendimiento. */
    planDeAlcance(criterio) {
      const { sql, parametros } = consultaDeAlcance(criterio);
      return base.plan(sql, parametros(new Date().toISOString()));
    },

    instantanea() {
      return congelar({
        credenciales: base.consultar("SELECT * FROM credential ORDER BY nombre").map((c) => ({ ...c })),
        grants: base.consultar('SELECT * FROM "grant" ORDER BY concedido_en').map((g) => ({ ...g })),
      });
    },
  };
}
