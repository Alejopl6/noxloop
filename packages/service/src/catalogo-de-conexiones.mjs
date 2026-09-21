// El catalogo de lo que se puede conectar, consultable desde la interfaz.
//
// POR QUE ES UNA RUTA APARTE Y NO UN CAMPO MAS DE `/v1/projects/:id/connections`.
// Porque esa ruta exige DOS cosas que la pregunta no necesita: un proyecto dado
// de alta y un proveedor de conexiones montado. Y el proveedor de OAuth pide
// tres contenedores levantados en la maquina del operador. O sea: para
// contestar «¿que puedo conectar?» —que es de solo lectura— hacia falta tener
// ya resuelto lo que se estaba intentando decidir.
//
// El operador que no puede o no quiere levantar Docker es exactamente aquel
// para el que existe el adaptador `local`. Que ese operador no pueda ni MIRAR
// la lista es el fallo concreto que esta ruta cierra.
//
// POR QUE EL IMPORT SALE DEL PAQUETE. Igual que `dependencias.mjs` con el
// almacen y la boveda, y por el mismo motivo escrito alli: `packages/connections`
// viaja al escritorio como recurso suelto del sidecar. Esta ruta no monta
// ningun adaptador —lee dato empotrado— asi que no arrastra nada mas.
//
// LO QUE ESTA RUTA HACE VISIBLE, Y HOY NO LO ES. Que adaptador va a atender
// cada proveedor. No es un detalle interno: uno de los dos significa levantar
// tres contenedores y registrar a mano una aplicacion OAuth propia con el
// proveedor; el otro significa pegar un token en una casilla. Y dos de los
// objetivos declarados PARECEN autorizarse como el resto y no lo hacen —el
// catalogo lo sabe, esta ruta lo dice, y por eso los nombres propios viven en
// `packages/connections/src/catalogo.mjs` y no aqui—. Saberlo ANTES de elegir
// es la diferencia entre una tarde y cinco minutos.

import {
  CLASES,
  MODOS_AUTH,
  PROCEDENCIA,
  LIMITE_POR_DEFECTO,
  construirCatalogoConsultable,
  consultar,
} from "../../connections/src/index.mjs";

import { coleccion, limiteDe } from "./comun.mjs";
import { ErrorDeServicio } from "./errores.mjs";

/** Los nombres con los que se puede filtrar por adaptador. `ninguno` es el que enseña la faceta. */
const ADAPTADORES = ["nango", "local", "ninguno"];

/**
 * El catalogo se construye UNA vez por proceso.
 *
 * Es dato empotrado y congelado: no depende del home, ni del proyecto, ni de
 * quien pregunta. Rehacerlo en cada peticion serian 1012 entradas normalizadas
 * y congeladas por cada tecla que el operador escribe en el buscador.
 *
 * @type {readonly any[]|null}
 */
let catalogo = null;

/** @returns {readonly any[]} */
function catalogoDeProveedores() {
  if (!catalogo) catalogo = construirCatalogoConsultable();
  return catalogo;
}

/**
 * Un parametro de query que solo admite ciertos valores.
 *
 * POR QUE SE RECHAZA EN VEZ DE IGNORARSE. Un `?clase=trackr` ignorado devuelve
 * el catalogo entero, con 200 y con aspecto de respuesta buena. El operador lee
 * esa lista creyendo que filtro por trackers y concluye lo que no es — y no hay
 * nada en la respuesta que le permita descubrirlo.
 *
 * @param {URL} url
 * @param {string} nombre
 * @param {readonly string[]} opciones
 * @returns {string|null}
 */
function deLaQuery(url, nombre, opciones) {
  const crudo = url.searchParams.get(nombre);
  if (crudo === null || crudo === "") return null;
  if (!opciones.includes(crudo)) {
    throw new ErrorDeServicio("parametro_invalido", { parametro: nombre, valor: crudo, opciones: [...opciones] });
  }
  return crudo;
}

/**
 * `GET /v1/connections/catalog`
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function catalogoDeConexiones(p) {
  const entradas = catalogoDeProveedores();

  const resultado = consultar(entradas, {
    texto: p.url.searchParams.get("q") ?? "",
    clase: deLaQuery(p.url, "clase", CLASES),
    modo: deLaQuery(p.url, "modo", MODOS_AUTH),
    adaptador: deLaQuery(p.url, "adaptador", ADAPTADORES),
    // `limiteDe` acota arriba: pedir `limite=999999` no convierte una pantalla
    // en una descarga del catalogo entero por accidente.
    limite: limiteDe(p.url, LIMITE_POR_DEFECTO, entradas.length),
    todos: p.url.searchParams.get("todos") === "si",
  });

  const avisos = [];
  if (resultado.criterio === "baldas_del_ciclo") {
    // EL AVISO NO ES CORTESIA. La lista se recorto sola, y sin decirlo la
    // pantalla presenta 138 proveedores como si fueran todos los que hay. El
    // que sobra no esta escondido —hay forma de alcanzarlo— pero hace falta
    // saber que esta ahi.
    avisos.push({
      codigo: "catalogo_recortado",
      causa:
        `Se devolvieron las ${resultado.total} conexiones que este producto necesita para su ciclo —tracker, SCM e ` +
        `infraestructura, mas las que ya tienen formulario propio— de las ${resultado.total_catalogo} del catalogo. ` +
        "Una lista de mil elementos no es una interfaz: es el problema trasladado a quien la mira.",
      accion:
        "Busca por nombre con `?q=`, acota con `?clase=`, `?modo=` o `?adaptador=`, o pide el catalogo entero con " +
        "`?todos=si`. El resto de los proveedores existe y se alcanza: lo que no hace es ocupar la pantalla.",
    });
  }

  return {
    cuerpo: coleccion(resultado.items, { avisos }, {
      total: resultado.total,
      total_catalogo: resultado.total_catalogo,
      mostrados: resultado.mostrados,
      hay_mas: resultado.hay_mas,
      limite: resultado.limite,
      criterio: resultado.criterio,
      facetas: resultado.facetas,

      // De donde salio el dato y cuando. Va en la RESPUESTA y no solo en un
      // comentario del codigo porque quien lo mira es quien tiene que decidir
      // si se fia: es el catalogo publico de otra empresa, copiado en una
      // fecha, sin contrato de estabilidad. El precedente es la cabecera de
      // procedencia de los tokens de Geist en `globals.css`, que existe porque
      // escribirlos de memoria salio caro.
      procedencia: PROCEDENCIA,

      // Y la otra mitad de la verdad: cada entrada dice que adaptador la
      // atenderia, pero aqui y ahora puede no haber ninguno montado. Sin esto,
      // el operador lee `adaptador: "local"` y cree que ya puede conectar.
      adaptadores: {
        montado: p.dep.conexiones ? p.dep.conexiones.id : null,
        ausencia: p.dep.conexiones ? null : p.dep.ausenciaDeConexiones,
      },
    }),
  };
}
