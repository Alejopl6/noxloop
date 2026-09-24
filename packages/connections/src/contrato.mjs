// La suite de contrato: las nueve pruebas que un adaptador tiene que pasar
// para declararse listo.
//
// POR QUE LA MISMA SUITE CORRE CONTRA TODOS, INCLUIDO EL FALSO. Es el mismo
// patron que usa la capa de gestores de tickets de este repositorio, y por el
// mismo motivo: la prueba de que la costura funciona es que la MISMA suite
// corre contra todos. Si cada adaptador trajera sus pruebas, "¿cumplen el
// contrato?" tendria tantas respuestas como adaptadores.
//
// POR QUE LOS CHEQUEOS MONTAN SU PROPIA INSTANCIA. Revocar corta, y una
// instancia compartida arrastraria el corte al chequeo siguiente. Cada uno pide
// un montaje nuevo a los fixtures, y de paso eso obliga a que montar un
// adaptador sea barato: uno que necesite una cuenta para montarse no lo puede
// correr quien adopte el proyecto.

import { ErrorDeConexion } from "./errores.mjs";
import { MODOS_AUTH, CLASES, MODOS_SIN_AUTORIZACION, validarEntradaDeCatalogo } from "./modelo.mjs";
import { VIGENCIA_MAXIMA_MS } from "./vigencia.mjs";
import { arrancar } from "./arranque.mjs";

/** Los ocho metodos del contrato. */
export const METODOS_DEL_CONTRATO = [
  "preflight",
  "catalogo",
  "conectar",
  "esperarConexion",
  "credenciales",
  "llamar",
  "revocar",
  "listar",
];

/**
 * @param {any} proveedor
 * @returns {{ok: boolean, problemas: string[]}}
 */
export function validarProveedorDeConexiones(proveedor) {
  const problemas = [];
  if (!proveedor || typeof proveedor !== "object") return { ok: false, problemas: ["no es un objeto"] };
  if (typeof proveedor.id !== "string" || !proveedor.id) problemas.push("falta `id` (string)");
  for (const metodo of METODOS_DEL_CONTRATO) {
    if (typeof proveedor[metodo] !== "function") problemas.push(`falta \`${metodo}()\``);
  }
  return { ok: problemas.length === 0, problemas };
}

/**
 * @typedef {object} MontajeDePrueba
 * @property {any} proveedor
 * @property {(ms: number) => void} avanzar        mueve el reloj inyectado
 * @property {() => number} lecturas               cuantas veces se fue a buscar un valor al deposito
 * @property {(causa?: string) => void} caer       tira el adaptador
 * @property {() => void} levantar
 */

/**
 * @typedef {object} FixturesDeConexiones
 * @property {(opciones?: {puertoOcupado?: boolean}) => MontajeDePrueba|Promise<MontajeDePrueba>} montar
 * @property {string} projectId
 * @property {string} slugSinOauth
 * @property {Record<string,string>} valores    los valores del proveedor sin oauth, con el centinela dentro
 * @property {string} centinela                 el valor que no puede aparecer en ninguna salida
 * @property {boolean} sinContenedores          si el adaptador afirma no necesitar contenedores
 * @property {{metodo: string, ruta: string}} llamada
 */

/**
 * @param {FixturesDeConexiones} fx
 * @returns {Array<{name: string, run: () => Promise<void>}>}
 */
export function chequeosDeContrato(fx) {
  const assert = (cond, mensaje) => {
    if (!cond) throw new Error(mensaje);
  };

  const montar = async (opciones) => await fx.montar(opciones);

  /** Conecta el proveedor que no usa oauth y devuelve la conexion ya lista. */
  const conectado = async (proveedor) => {
    const alta = await proveedor.conectar({ projectId: fx.projectId, slug: fx.slugSinOauth, valores: fx.valores });
    assert(alta.conexion, "conectar un modo sin autorizacion no devolvio la conexion lista");
    return alta.conexion;
  };

  return [
    {
      name: "1. catalogo-declara-modo",
      run: async () => {
        const { proveedor } = await montar();
        const r = validarProveedorDeConexiones(proveedor);
        assert(r.ok, `el adaptador no implementa el contrato:\n  - ${r.problemas.join("\n  - ")}`);

        const catalogo = await proveedor.catalogo();
        assert(Array.isArray(catalogo) && catalogo.length > 0, "el catalogo vino vacio");
        for (const entrada of catalogo) {
          const v = validarEntradaDeCatalogo(entrada);
          assert(v.ok, `${entrada?.slug ?? "(sin slug)"}: ${v.problemas.join("; ")}`);
          assert(MODOS_AUTH.includes(entrada.modo), `${entrada.slug}: modo ${entrada.modo}`);
          assert(CLASES.includes(entrada.clase), `${entrada.slug}: clase ${entrada.clase}`);
        }
      },
    },
    {
      name: "2. no-asume-oauth",
      run: async () => {
        const { proveedor } = await montar();
        const catalogo = await proveedor.catalogo();
        const entrada = catalogo.find((p) => p.slug === fx.slugSinOauth);
        assert(entrada, `los fixtures declaran '${fx.slugSinOauth}', que no esta en el catalogo`);
        assert(
          MODOS_SIN_AUTORIZACION.includes(entrada.modo),
          `'${fx.slugSinOauth}' es de modo ${entrada.modo}: este chequeo necesita uno que NO sea oauth2`,
        );

        const alta = await proveedor.conectar({ projectId: fx.projectId, slug: fx.slugSinOauth, valores: fx.valores });
        assert(!("url" in alta), `conectar un modo ${entrada.modo} devolvio una URL de autorizacion`);
        assert(alta.handle, "conectar no devolvio handle");
        assert(alta.conexion?.estado === "conectada", "un modo sin autorizacion tiene que quedar listo de inmediato");
      },
    },
    {
      name: "3. preflight-diagnostica-puerto",
      run: async () => {
        const { proveedor } = await montar();
        const catalogo = await proveedor.catalogo();
        const hayOauth = catalogo.some((p) => p.modo === "oauth2");
        const estado = await proveedor.preflight();
        assert(Array.isArray(estado.requisitos), "el preflight no declara sus requisitos");
        const requisitoPuerto = estado.requisitos.find((r) => r.tipo === "puerto");

        if (!hayOauth) {
          // Sin oauth2 en el catalogo no hay callback que registrar, y exigir
          // el puerto seria impedir arrancar por un contrato que no se firmo.
          assert(!requisitoPuerto, "declara el puerto del callback sin tener ningun proveedor oauth2");
          return;
        }

        assert(requisitoPuerto, "hay proveedores oauth2 y el preflight no declara el puerto del callback");
        const { proveedor: conPuertoTomado } = await montar({ puertoOcupado: true });
        const roto = await conPuertoTomado.preflight();
        assert(roto.ok === false, "con el puerto del callback ocupado el preflight dijo que todo bien");
        const problema = roto.problemas.find((p) => p.codigo === "puerto_ocupado");
        assert(problema, `ningun problema habla del puerto: ${JSON.stringify(roto.problemas)}`);
        assert(problema.causa && problema.accion, "el problema del puerto no trae causa y accion");

        let lanzo = null;
        try {
          await arrancar(conPuertoTomado);
        } catch (e) {
          lanzo = e;
        }
        assert(lanzo?.codigo === "preflight_fallido", "arrancar siguio adelante con el puerto del callback ocupado");
      },
    },
    {
      name: "4. credencial-vigencia-acotada",
      run: async () => {
        const { proveedor } = await montar();
        const conexion = await conectado(proveedor);
        const viva = await proveedor.credenciales(conexion.id);
        assert(typeof viva.vigencia_ms === "number", "la credencial viva no declara `vigencia_ms`");
        assert(viva.vigencia_ms > 0, "una vigencia de cero no se puede sostener");
        assert(
          viva.vigencia_ms <= VIGENCIA_MAXIMA_MS,
          `vigencia_ms = ${viva.vigencia_ms}, y el tope del contrato son ${VIGENCIA_MAXIMA_MS}`,
        );
        assert(viva.valores && Object.keys(viva.valores).length > 0, "la credencial viva no trae nada que inyectar");
      },
    },
    {
      name: "5. credencial-no-cacheada",
      run: async () => {
        const montaje = await montar();
        const conexion = await conectado(montaje.proveedor);
        const primera = await montaje.proveedor.credenciales(conexion.id);
        const antes = montaje.lecturas();
        montaje.avanzar(primera.vigencia_ms + 1);
        await montaje.proveedor.credenciales(conexion.id);
        assert(
          montaje.lecturas() > antes,
          "la segunda llamada no fue a buscar el valor: quedo cacheado mas alla de su vigencia",
        );
      },
    },
    {
      name: "6. revocar-corta",
      run: async () => {
        const { proveedor } = await montar();
        const conexion = await conectado(proveedor);
        await proveedor.revocar(conexion.id);

        let lanzo = null;
        try {
          await proveedor.credenciales(conexion.id);
        } catch (e) {
          lanzo = e;
        }
        assert(lanzo, "despues de revocar, `credenciales` siguio entregando el valor");
        assert(
          lanzo instanceof ErrorDeConexion,
          `tras revocar, pedir la credencial lanzo un ${lanzo?.name} sin forma: un error sin causa se propaga como caida`,
        );
        assert(typeof lanzo.causa === "string" && lanzo.causa.length > 0, "el corte no dice por que");
        assert(typeof lanzo.accion === "string" && lanzo.accion.length > 0, "el corte no dice que hacer");

        const listado = await proveedor.listar(fx.projectId);
        const fila = listado.find((c) => c.id === conexion.id);
        assert(!fila || fila.estado === "revocada", "la conexion revocada sigue figurando como viva");
      },
    },
    {
      name: "7. sin-proveedor-degrada",
      run: async () => {
        const montaje = await montar();
        const conexion = await conectado(montaje.proveedor);
        montaje.caer("el adaptador no responde");

        const listado = await montaje.proveedor.listar(fx.projectId);
        assert(
          listado.some((c) => c.id === conexion.id),
          "con el adaptador caido se perdio el inventario de lo que ya estaba conectado",
        );
        const catalogo = await montaje.proveedor.catalogo();
        assert(catalogo.length > 0, "con el adaptador caido dejo de responder hasta el catalogo, que es dato declarado");

        let lanzo = null;
        try {
          await montaje.proveedor.conectar({ projectId: fx.projectId, slug: fx.slugSinOauth, valores: fx.valores });
        } catch (e) {
          lanzo = e;
        }
        assert(lanzo instanceof ErrorDeConexion, `una conexion nueva con el adaptador caido lanzo un ${lanzo?.name}`);
        assert(typeof lanzo.causa === "string" && lanzo.causa.length > 0, "el fallo no dice que se cayo");
        assert(typeof lanzo.accion === "string" && lanzo.accion.length > 0, "el fallo no dice que hacer");

        montaje.levantar();
        const otra = await montaje.proveedor.conectar({
          projectId: fx.projectId,
          slug: fx.slugSinOauth,
          valores: fx.valores,
        });
        assert(otra.conexion?.estado === "conectada", "cuando el adaptador volvio, conectar siguio roto");
      },
    },
    {
      name: "8. secreto-no-en-listar",
      run: async () => {
        const { proveedor } = await montar();
        const conexion = await conectado(proveedor);
        const listado = await proveedor.listar(fx.projectId);
        assert(listado.some((c) => c.id === conexion.id), "la conexion recien creada no figura en el inventario");

        const enListar = JSON.stringify(listado);
        assert(!enListar.includes(fx.centinela), "`listar` devolvio el valor de una credencial");
        const enCatalogo = JSON.stringify(await proveedor.catalogo());
        assert(!enCatalogo.includes(fx.centinela), "`catalogo` devolvio el valor de una credencial");
      },
    },
    {
      name: "9. local-sin-contenedores",
      run: async () => {
        const { proveedor } = await montar();
        const estado = await proveedor.preflight();
        const contenedores = estado.requisitos.filter((r) => r.tipo === "contenedor");

        if (!fx.sinContenedores) {
          // La honestidad va en las dos direcciones: un adaptador que necesita
          // contenedores tiene que declararlos. Si no los declara, el operador
          // descubre el coste cuando ya adopto el producto.
          assert(
            contenedores.length > 0,
            "los fixtures no declaran `sinContenedores` y el preflight no declara ningun contenedor: uno de los dos miente",
          );
          return;
        }

        assert(
          contenedores.length === 0,
          `declara no necesitar contenedores y el preflight pide ${contenedores.length}`,
        );

        // Y el ciclo entero, que es lo que de verdad prueba que se puede sin
        // levantar nada: alta, credencial, llamada y corte.
        const conexion = await conectado(proveedor);
        const viva = await proveedor.credenciales(conexion.id);
        assert(Object.keys(viva.valores).length > 0, "el ciclo llego a la credencial y vino vacia");
        const respuesta = await proveedor.llamar({
          conexionId: conexion.id,
          metodo: fx.llamada.metodo,
          ruta: fx.llamada.ruta,
        });
        assert(typeof respuesta.estado === "number", "`llamar` no devolvio un estado");
        assert(!JSON.stringify(respuesta).includes(fx.centinela), "`llamar` devolvio el token con el que llamo");
        await proveedor.revocar(conexion.id);
      },
    },
  ];
}
