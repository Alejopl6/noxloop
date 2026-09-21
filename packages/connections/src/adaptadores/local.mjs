// T153 · el adaptador local: tokens personales y claves de API contra el
// deposito de secretos del sistema operativo.
//
// NO ES UN PLAN B. Dos de los proveedores objetivo no usan OAuth: uno se
// conecta con un token personal y el otro con una clave de API. En esos casos
// el adaptador alojado no aporta nada que este no haga —no hay flujo de
// autorizacion que delegar ni token que refrescar— y levantar tres contenedores
// para guardar un token que cabe en el llavero es coste sin contrapartida.
//
// POR QUE EL DEPOSITO LLEGA INYECTADO. Este paquete viaja al escritorio como
// recurso suelto: un import que salga de aqui resuelve dentro del repositorio y
// muere en la aplicacion instalada. Lo que se le pide al deposito esta escrito
// en el typedef de abajo, y el paquete que lo implementa se lo pasa al montar.
//
// POR QUE PIDE UN GRANT Y NO SOLO GUARDA EL VALOR. El deposito deniega por
// defecto: sin un permiso vigente no entrega nada. Si este adaptador guardara
// el valor sin pedir el permiso, la conexion se crearia bien y fallaria recien
// al lanzar el primer subproceso, con un "denegado" que no menciona ninguna
// conexion.

import { fallar } from "../errores.mjs";
import { crearProveedorDeConexiones } from "../proveedor.mjs";
import { CATALOGO_POR_DEFECTO, catalogoPorModo } from "../catalogo.mjs";

/** Los modos que este adaptador atiende. El resto no es suyo, y por eso no estan en su catalogo. */
export const MODOS_DEL_ADAPTADOR_LOCAL = ["pat", "api_key", "basic", "app"];

/**
 * Lo que este adaptador necesita del deposito de secretos. Es la interfaz
 * minima: nada de esto devuelve un valor salvo `recuperar`, que es la unica
 * puerta y exige un motivo auditable.
 *
 * @typedef {object} DepositoDeSecretos
 * @property {(datos: {workspace: string, nombre: string, tipo?: string, valor: string}) => Promise<{credencial: {id: string, ref_boveda: string}}>} registrar
 * @property {(datos: {project_id: string, agent_id: string, credential_id: string}) => Promise<{id: string}>} otorgar
 * @property {(ref: string, motivo: {grant_id: string, project_id: string, agent_id: string, proposito: string}) => Promise<string>} recuperar
 * @property {(ref: string) => Promise<any>} borrar
 * @property {(grantId: string) => Promise<any>} revocar
 */

/**
 * @param {{
 *   boveda: DepositoDeSecretos,
 *   catalogo?: readonly any[],
 *   agenteId?: string,
 *   peticion?: (url: string, init: any) => Promise<any>,
 *   repositorio?: any,
 *   reloj?: () => number,
 *   dormir?: (ms: number) => Promise<any>,
 * }} opciones
 */
export function crearAdaptadorLocal({
  boveda,
  catalogo = catalogoPorModo(CATALOGO_POR_DEFECTO, MODOS_DEL_ADAPTADOR_LOCAL),
  agenteId = "capa-de-conexiones",
  peticion = (url, init) => fetch(url, init),
  ...resto
}) {
  if (!boveda || typeof boveda.registrar !== "function" || typeof boveda.recuperar !== "function") {
    fallar(
      "deposito_ausente",
      "el adaptador local se monto sin deposito de secretos",
      "pasale el deposito al construirlo: este adaptador no implementa uno propio a proposito, porque el valor tiene que quedar donde lo protege el sistema operativo",
    );
  }

  /** Envuelve un fallo del deposito para que salga con causa y accion, y no como una caida. */
  async function contraElDeposito(que, fn) {
    try {
      return await fn();
    } catch (e) {
      // Un fallo que YA viene con causa y accion se respeta: es el propio
      // deposito diciendo que denego, y reescribirlo perderia el motivo.
      if (e?.name === "ErrorDeConexion" || (e?.codigo && e?.accion)) throw e;
      fallar(
        "adaptador_caido",
        `el deposito de secretos no pudo ${que}: ${e?.message ?? e}`,
        "comprueba que el llavero del sistema esta desbloqueado y que la sesion tiene acceso; las conexiones que ya existen siguen en el inventario",
      );
    }
  }

  /** @param {any} conexion */
  function referenciasDe(conexion) {
    const refs = conexion.deposito?.refs ?? {};
    if (Object.keys(refs).length === 0) {
      fallar(
        "conexion_sin_referencia",
        `la conexion ${conexion.id} no apunta a ningun valor del deposito`,
        "vuelve a conectar el proveedor: la fila quedo sin la referencia con la que se pide el valor",
      );
    }
    return refs;
  }

  const motor = {
    requisitos: () => [
      {
        nombre: "deposito de secretos del sistema operativo",
        tipo: "deposito",
        detalle: "el llavero del sistema, o el archivo cifrado si el llavero no esta disponible",
      },
    ],

    // Este adaptador no tiene sonda: el deposito del sistema no responde a un
    // ping barato, y uno falso —devolver siempre `arriba`— seria peor que no
    // tenerlo. La caida se descubre al usarlo y se declara ahi, con causa.
    salud: () => ({ arriba: true }),

    async iniciar({ entrada }) {
      return fallar(
        "sin_flujo_de_autorizacion",
        `'${entrada.slug}' se conecta por ${entrada.modo}, que no tiene flujo de autorizacion que abrir`,
        "conectalo pasando sus campos; si lo que necesitas es oauth2, ese reparto es del adaptador alojado",
      );
    },

    async guardar({ entrada, projectId, valores, conexionId }) {
      const refs = {};
      const datos = {};
      for (const campo of entrada.campos ?? []) {
        const valor = valores[campo.nombre];
        if (valor === undefined) continue;
        if (!campo.secreto) {
          datos[campo.nombre] = valor;
          continue;
        }
        const { credencial } = await contraElDeposito(`guardar '${campo.nombre}' de ${entrada.slug}`, () =>
          boveda.registrar({
            workspace: projectId,
            nombre: `${entrada.slug}-${campo.nombre}`,
            tipo: campo.nombre,
            valor,
          }),
        );
        const grant = await contraElDeposito(`autorizar el uso de '${campo.nombre}'`, () =>
          boveda.otorgar({ project_id: projectId, agent_id: agenteId, credential_id: credencial.id }),
        );
        refs[campo.nombre] = { ref: credencial.ref_boveda, grant_id: grant.id };
      }
      return { deposito: { refs, datos, conexionId } };
    },

    async sondear() {
      // No hay nada que sondear: la conexion queda lista al guardar el valor.
      return null;
    },

    async leer(conexion) {
      const refs = referenciasDe(conexion);
      const valores = { ...(conexion.deposito?.datos ?? {}) };
      for (const [campo, { ref, grant_id }] of Object.entries(refs)) {
        valores[campo] = await contraElDeposito(`entregar '${campo}'`, () =>
          boveda.recuperar(ref, {
            grant_id,
            project_id: conexion.project_id,
            agent_id: agenteId,
            proposito: "llamar_api",
          }),
        );
      }
      return { valores };
    },

    async olvidar(conexion) {
      const refs = conexion.deposito?.refs ?? {};
      for (const { ref, grant_id } of Object.values(refs)) {
        // Primero el permiso y despues el valor: si el borrado fallara, lo que
        // queda es una credencial que ya no autoriza a nadie, y no al reves.
        await contraElDeposito("revocar el permiso", () => boveda.revocar(grant_id));
        await contraElDeposito("borrar el valor", () => boveda.borrar(ref));
      }
    },

    async llamar({ entrada, conexion, ruta, metodo, cuerpo, cabeceras }) {
      const base = String(entrada.api?.base ?? "").replace(/\{(\w+)\}/g, (_, clave) => {
        const valor = conexion.deposito?.datos?.[clave];
        if (!valor) {
          fallar(
            "dato_ausente_en_la_url",
            `la direccion de '${entrada.slug}' necesita '${clave}' y la conexion ${conexion.id} no lo tiene`,
            `vuelve a conectar el proveedor rellenando '${clave}'`,
          );
        }
        return String(valor);
      });

      const respuesta = await peticion(`${base}${ruta}`, {
        method: metodo,
        headers: cabeceras,
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      });

      const texto = await respuesta.text();
      let leido = texto;
      try {
        leido = texto ? JSON.parse(texto) : null;
      } catch {
        // Un cuerpo que no es JSON se devuelve tal cual: convertirlo en un
        // error perderia el mensaje del proveedor, que suele ser el unico dato
        // util cuando algo falla del otro lado.
      }
      return {
        estado: respuesta.status,
        cuerpo: leido,
        cabeceras: Object.fromEntries(respuesta.headers ?? []),
      };
    },
  };

  return crearProveedorDeConexiones({ id: "local", catalogo, motor, ...resto });
}
