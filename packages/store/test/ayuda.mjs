// Utilidades de las pruebas del almacen.
//
// EL CENTINELA, IGUAL QUE EN LA BOVEDA. Ninguna prueba de secreto verifica la
// intencion: se busca un valor improbable dentro de lo que de verdad quedo
// escrito. Aqui "lo que de verdad quedo escrito" es el volcado de la base y el
// texto de su esquema, no el objeto que el repositorio devuelve.

import { randomBytes, randomUUID } from "node:crypto";
import { abrirAlmacen } from "../src/index.mjs";

/**
 * Un valor que no puede aparecer en ningun sitio por casualidad.
 * @param {string} [etiqueta]
 * @returns {string}
 */
export function centinela(etiqueta = "x") {
  return `NOXLOOP-CENTINELA-${etiqueta}-${randomBytes(24).toString("hex")}`;
}

/** Un redactor de juguete: las pruebas que no ejercitan la redaccion necesitan uno igual. */
export const redactorDePrueba = (detalle) => detalle;

/**
 * Devuelve el error en vez de solo afirmar que hubo uno.
 *
 * POR QUE NO `assert.throws` A SECAS. La mitad de las pruebas de este paquete
 * no comprueban QUE fallo sino QUE DIJO al fallar: "se rechaza con causa
 * textual" es el requisito, y un `assert.throws` que solo mira la clase pasa
 * igual con un mensaje vacio.
 *
 * @param {() => any} fn
 * @returns {any}
 */
export function capturar(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("se esperaba un error y no lo hubo");
}

/**
 * Un almacen en memoria con su workspace ya creado.
 *
 * `"redactor" in opciones` y no `?? redactorDePrueba`: la prueba que ejercita
 * la AUSENCIA de redactor pasa `null` a proposito, y un `??` se lo cambiaba por
 * el de juguete. La prueba pasaba sin probar nada, y se descubrio porque no
 * fallaba cuando tenia que fallar.
 *
 * @param {{redactor?: ((d: any) => any)|null}} [opciones]
 */
export function almacenDePrueba(opciones = {}) {
  const redactor = "redactor" in opciones ? opciones.redactor : redactorDePrueba;
  const almacen = abrirAlmacen({ ruta: ":memory:", redactor });
  const workspace = almacen.workspaces.crear({ home: "/tmp/noxloop-prueba" });
  return { almacen, workspace };
}

/**
 * Un proyecto en `CREATED`, listo para que la prueba lo mueva.
 *
 * @param {any} almacen
 * @param {string} workspaceId
 * @param {Record<string, any>} [cambios]
 */
export function proyectoDePrueba(almacen, workspaceId, cambios = {}) {
  return almacen.proyectos.crear({
    workspace_id: workspaceId,
    nombre: "proyecto de prueba",
    slug: `p-${randomUUID().slice(0, 8)}`,
    origen: "local",
    ruta_local: "/tmp/arbol",
    ...cambios,
  });
}

/**
 * Lleva un proyecto hasta el estado pedido creando los artefactos DE VERDAD.
 * No hay atajo: cada transicion pasa por su guarda, que es lo que se esta
 * probando en el resto de los archivos.
 *
 * @param {any} almacen
 * @param {any} proyecto
 * @param {string} hasta
 */
export function llevarHasta(almacen, proyecto, hasta) {
  const actor = "operador de prueba";
  const pasos = ["DISCOVERED", "CONSTITUTED", "BOOTSTRAPPED", "CONNECTED", "ACTIVE"];
  let actual = proyecto;
  for (const paso of pasos) {
    if (pasos.indexOf(paso) > pasos.indexOf(hasta)) break;
    if (paso === "DISCOVERED") {
      const s = almacen.snapshots.crear({ project_id: actual.id, commit: "a".repeat(40) });
      almacen.snapshots.agregarHallazgo({
        snapshot_id: s.id,
        categoria: "stack",
        clave: "runtime.node",
        valor: { version: "22" },
        origen: "detectado",
        evidencia: [{ ruta: ".nvmrc", linea: 1 }],
        confianza: "alta",
      });
      almacen.snapshots.completar(s.id, { duracion_ms: 120 });
      for (const h of almacen.snapshots.hallazgos(s.id)) {
        almacen.snapshots.decidirHallazgo(h.id, { decision: "aceptado" });
      }
    }
    if (paso === "CONSTITUTED") {
      almacen.constituciones.fijar({
        project_id: actual.id,
        version: "1.0.0",
        ruta_en_repo: ".specify/memory/constitution.md",
        contenido: "# constitution",
      });
    }
    if (paso === "BOOTSTRAPPED") {
      const r = almacen.recomendaciones.crear({
        project_id: actual.id,
        tipo: "hook",
        titulo: "hook de rojo previo",
        justificacion: "principio I",
        diff: "--- a\n+++ b\n",
      });
      almacen.recomendaciones.decidir(r.id, { decision: "aplicada", motivo_decision: "prueba" });
    }
    if (paso === "CONNECTED") {
      almacen.conexiones.crear({
        project_id: actual.id,
        clase: "tracker",
        proveedor: "fake",
        id_externo: "ext-1",
        estado: "viva",
      });
    }
    if (paso === "ACTIVE") {
      almacen.agentes.crear({
        project_id: actual.id,
        nombre: "implementador",
        rol: "implementador",
        runtime: "runtime-a",
        modelo: "modelo-a",
      });
    }
    actual = almacen.proyectos.transicionar(actual.id, paso, { actor });
    if (paso === hasta) break;
  }
  return actual;
}

/**
 * Una credencial completa en el vocabulario del almacen.
 * @param {Record<string, any>} [cambios]
 */
export function credencialDePrueba(cambios = {}) {
  const id = randomUUID();
  return {
    id,
    nombre: "token del gestor",
    proveedor: "fake",
    tipo: "api_token",
    ambito: "global",
    project_id: null,
    alcance_declarado: "leer y comentar tickets",
    huella: "sha256:0000000000000000",
    ref_boveda: `noxloop://ws/${id}`,
    backend: "keychain_so",
    ...cambios,
  };
}
