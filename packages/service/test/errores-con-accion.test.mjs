// El formato unico de error, y la guarda que lo sostiene.
//
// POR QUE ESTE TEST RECORRE EL CATALOGO ENTERO EN VEZ DE MIRAR TRES ERRORES.
// NFR-006 exige que todo error nombre la causa y la accion siguiente. Un test
// que comprueba los errores que alguien se acordo de listar deja de cubrir el
// septimo error el dia que alguien agrega el septimo error — y ese es siempre
// el que aparece en la maquina del operador. Aca el catalogo es la fuente: si
// hay un codigo sin forma de provocarlo, o uno que se provoca y sale sin
// `accion`, el test falla nombrando cual.
//
// La `accion` no es cortesia. Un servicio local que dice "no autorizado" y se
// calla deja al operador reinstalando la aplicacion; uno que dice donde esta el
// token lo devuelve al trabajo en diez segundos.

import { test } from "node:test";
import assert from "node:assert/strict";

import { chmodSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CATALOGO, deExcepcion } from "../src/errores.mjs";
import { arrancar } from "../src/servidor.mjs";
import { carpetaDePrueba, homeTemporal, ORIGEN, repoDePrueba, TOKEN } from "./ayuda.mjs";
import { proyectoActivo, repoConRemoto, runEnDisco } from "./ayuda-motor.mjs";

/**
 * Como se provoca cada error del catalogo, de verdad. No se fabrica el objeto:
 * se ejerce el camino que lo emite y se mira lo que sale por el cable.
 *
 * @type {Record<string, (svc: any) => Promise<any>>}
 */
const PROVOCADORES = {
  falta_token: async (svc) =>
    (await (await fetch(`${svc.url}/v1/capabilities`, { headers: { origin: ORIGEN } })).json()).error,

  token_invalido: async (svc) =>
    (await (await fetch(`${svc.url}/v1/capabilities`, {
      headers: { origin: ORIGEN, "x-noxloop-token": "el que no es" },
    })).json()).error,

  origen_no_permitido: async (svc) =>
    (await (await fetch(`${svc.url}/v1/capabilities`, {
      headers: { origin: "https://otra-pestana.invalid", "x-noxloop-token": TOKEN },
    })).json()).error,

  ruta_desconocida: async (svc) =>
    (await (await fetch(`${svc.url}/v1/lo-que-no-existe`, {
      headers: { "x-noxloop-token": TOKEN },
    })).json()).error,

  metodo_no_permitido: async (svc) =>
    (await (await fetch(`${svc.url}/v1/health`, {
      method: "DELETE",
      headers: { "x-noxloop-token": TOKEN },
    })).json()).error,

  home_bloqueado: async (svc) => {
    // El segundo servicio sobre el mismo home. No llega a escuchar: el error
    // sale del arranque, y tiene la misma obligacion que uno de HTTP.
    try {
      const otro = await arrancar({ home: svc.home, token: TOKEN });
      await otro.detener();
      throw new Error("arranco un segundo servicio sobre el mismo home");
    } catch (e) {
      return e.cuerpo ? e.cuerpo.error : null;
    }
  },

  cuerpo_invalido: async (svc) =>
    (await (await pedirJson(svc, "/v1/projects", "POST", "{ esto no es json")).json()).error,

  no_es_repositorio: async (svc) => {
    const ruta = carpetaDePrueba();
    const r = await pedirJson(svc, "/v1/projects", "POST", { origen: "local", nombre: "Sin Git", ruta_local: ruta });
    return (await r.json()).error;
  },

  ruta_relativa: async (svc) => {
    const r = await pedirJson(svc, "/v1/projects", "POST", { origen: "local", nombre: "Relativo", ruta_local: "relativa" });
    return (await r.json()).error;
  },

  destino_no_vacio: async (svc) => {
    const ruta = carpetaDePrueba();
    writeFileSync(join(ruta, "algo.txt"), "trabajo de alguien\n");
    const r = await pedirJson(svc, "/v1/projects", "POST", { origen: "nuevo", nombre: "Encima", ruta_local: ruta });
    return (await r.json()).error;
  },

  // Los tres del explorador de carpetas, por el camino real. El primero es el
  // que importa: `/` no es una raiz de este servicio, y el rechazo tiene que
  // decir por donde SI se puede navegar o el operador prueba rutas a ciegas.
  ruta_fuera_del_alcance: async (svc) =>
    (await (await pedirJson(svc, "/v1/folders?ruta=%2F", "GET")).json()).error,

  carpeta_inexistente: async (svc) => {
    const dentroDelHome = join(svc.home, "esta-carpeta-no-existe");
    return (await (await pedirJson(svc, `/v1/folders?ruta=${encodeURIComponent(dentroDelHome)}`, "GET")).json())
      .error;
  },

  carpeta_ilegible: async (svc) => {
    // Una carpeta sin permiso de lectura, dentro de una raiz. `chmod 0` es la
    // unica forma de ejercer el camino de verdad: fabricar el error a mano
    // probaria el catalogo y no el manejador.
    const raiz = carpetaDePrueba();
    const cerrada = join(raiz, "sin-permiso");
    mkdirSync(cerrada);
    chmodSync(cerrada, 0o000);
    const otro = await arrancar({ home: homeTemporal(), token: TOKEN, raicesDeExploracion: [raiz] });
    try {
      const r = await fetch(`${otro.url}/v1/folders?ruta=${encodeURIComponent(realpathSync(cerrada))}`, {
        headers: { "x-noxloop-token": TOKEN },
      });
      return (await r.json()).error;
    } finally {
      chmodSync(cerrada, 0o700);
      await otro.detener();
    }
  },

  proyecto_desconocido: async (svc) =>
    (await (await pedirJson(svc, "/v1/projects/no-existe", "GET")).json()).error,

  recurso_desconocido: async (svc) =>
    (await (await pedirJson(svc, "/v1/scans/no-existe", "DELETE")).json()).error,

  // Se provoca por el camino REAL: dos agentes del mismo proyecto, el revisor
  // con el runtime del implementador. FR-034 lo corta al guardar.
  revisor_comparte_runtime: async (svc) => {
    const proyecto = await proyectoDePrueba(svc, "Revisor Duplicado");
    const agente = (rol, runtime) => ({ nombre: `el ${rol}`, rol, runtime, modelo: "un-modelo" });
    await pedirJson(svc, `/v1/projects/${proyecto.id}/agents`, "POST", agente("implementador", "compartido"));
    const r = await pedirJson(svc, `/v1/projects/${proyecto.id}/agents`, "POST", agente("revisor", "compartido"));
    return (await r.json()).error;
  },

  proyecto_no_activo: async (svc) => {
    const proyecto = await proyectoDePrueba(svc, "Sin Activar");
    const r = await pedirJson(svc, `/v1/projects/${proyecto.id}/runs`, "POST", { item: "T-1" });
    return (await r.json()).error;
  },

  // Sin frase de paso no hay boveda, y registrar una credencial lo dice en vez
  // de inventar una frase y guardarla junto al archivo que cifra.
  pieza_ausente: async (svc) => {
    const r = await pedirJson(svc, "/v1/credentials", "POST", {
      nombre: "x",
      proveedor: "y",
      tipo: "api_token",
      alcance_declarado: "z",
      valor: "un valor cualquiera",
    });
    return (await r.json()).error;
  },

  estado_obsoleto: async (svc) => {
    const proyecto = await proyectoDePrueba(svc, "Dos Ventanas");
    const r = await fetch(`${svc.url}/v1/projects/${proyecto.id}`, {
      method: "PATCH",
      headers: {
        "x-noxloop-token": TOKEN,
        "content-type": "application/json",
        "if-match": '"un-etag-de-otra-lectura"',
      },
      body: JSON.stringify({ nombre: "La segunda ventana" }),
    });
    return (await r.json()).error;
  },

  // Un filtro con un valor que no existe. Va por el camino real —la ruta del
  // catalogo de conexiones— porque es donde el fallo importa: aceptarlo
  // devolveria los 1012 proveedores con 200 y quien lo mira creeria que filtro.
  parametro_invalido: async (svc) =>
    (await (await pedirJson(svc, "/v1/connections/catalog?clase=trackr", "GET")).json()).error,

  // ---- El puente proyecto-motor (spec 003) --------------------------------
  // Los cuatro por la ruta de verdad: un proyecto ACTIVE al que le falta UNA
  // cosa, y `POST /runs`. Ninguno llega a lanzar el motor: la validacion va
  // antes, que es justo lo que se afirma.
  sin_repo: async (svc) => {
    const proyecto = await proyectoActivo(svc, { nombre: "Sin Remoto", ruta: repoConRemoto({ remoto: null }).repo });
    return (await (await pedirJson(svc, `/v1/projects/${proyecto.id}/runs`, "POST", { itemId: "2" })).json()).error;
  },

  sin_gate: async (svc) => {
    const proyecto = await proyectoActivo(svc, { nombre: "Sin Runner", runner: null });
    return (await (await pedirJson(svc, `/v1/projects/${proyecto.id}/runs`, "POST", { itemId: "2" })).json()).error;
  },

  // Desde la spec 003 un proyecto SIN conexiones usa el gestor local (sus
  // tareas propias), asi que `sin_gestor` es ahora un tracker DECLARADO que el
  // motor no sabe usar: no se cambia por el local sin avisar.
  sin_gestor: async (svc) => {
    const proyecto = await proyectoActivo(svc, { nombre: "Sin Gestor", conexiones: [{ clase: "tracker", proveedor: "jira" }] });
    return (await (await pedirJson(svc, `/v1/projects/${proyecto.id}/runs`, "POST", { itemId: "2" })).json()).error;
  },

  // Borrar una tarea local que ya tiene run en disco.
  tarea_con_run: async (svc) => {
    const proyecto = await proyectoActivo(svc, { nombre: "Tarea Con Run", conexiones: [] });
    const tarea = (await (await pedirJson(svc, `/v1/projects/${proyecto.id}/tasks`, "POST", { titulo: "con run" })).json()).tarea;
    runEnDisco(svc.home, tarea.id, { projectId: proyecto.id });
    return (await (await pedirJson(svc, `/v1/tasks/${tarea.id}`, "DELETE")).json()).error;
  },

  // Run sobre una tarea local cuyo ejecutor el motor no monta como implementador.
  ejecutor_sin_soporte: async (svc) => {
    const proyecto = await proyectoActivo(svc, { nombre: "Con Codex", conexiones: [] });
    const tarea = (
      await (await pedirJson(svc, `/v1/projects/${proyecto.id}/tasks`, "POST", { titulo: "x", ejecutor: { runtime: "codex" } })).json()
    ).tarea;
    return (await (await pedirJson(svc, `/v1/projects/${proyecto.id}/runs`, "POST", { itemId: tarea.id })).json()).error;
  },

  // Run sobre una tarea local que pide terminar sin PR.
  termino_sin_soporte: async (svc) => {
    const proyecto = await proyectoActivo(svc, { nombre: "Solo Commit", conexiones: [] });
    const tarea = (
      await (await pedirJson(svc, `/v1/projects/${proyecto.id}/tasks`, "POST", { titulo: "x", termino: "commit" })).json()
    ).tarea;
    return (await (await pedirJson(svc, `/v1/projects/${proyecto.id}/runs`, "POST", { itemId: tarea.id })).json()).error;
  },

  // Las opciones del gestor sobre una conexion del ESPACIO de trabajo. Va en
  // un servicio propio: la conexion del espacio alcanzaria a los proyectos de
  // los demas provocadores y les cambiaria el gestor.
  gestor_compartido: async () => {
    const otro = await arrancar({ home: homeTemporal(), token: TOKEN });
    try {
      const proyecto = await proyectoActivo(otro, {
        nombre: "Del Espacio",
        conexiones: [{ clase: "tracker", proveedor: "linear", delEspacio: true }],
      });
      return (await (await pedirJson(otro, `/v1/projects/${proyecto.id}/tracker`, "PATCH", { opciones: {} })).json()).error;
    } finally {
      await otro.detener();
    }
  },

  // Un gestor que pide token (el de la forja, por la cuenta de codigo) y una
  // conexion sin credencial en la boveda: el motor NO se lanza a morir en
  // `loadProvider` con «falta la variable».
  sin_credencial_del_gestor: async (svc) => {
    const proyecto = await proyectoActivo(svc, {
      nombre: "Sin Token",
      ruta: repoConRemoto({ remoto: "https://forja.test/acme/app.git" }).repo,
      conexiones: [{ clase: "scm", proveedor: "github" }],
    });
    return (await (await pedirJson(svc, `/v1/projects/${proyecto.id}/runs`, "POST", { itemId: "2" })).json()).error;
  },

  // Aprobar un run que ya tiene PR: no hay plan que aprobar.
  run_sin_esa_accion: async (svc) => {
    runEnDisco(svc.home, "con-pr", { item: { id: "con-pr", title: "t", pr: "https://forja.test/pr/1" } });
    return (await (await pedirJson(svc, "/v1/runs/con-pr/approve", "POST")).json()).error;
  },

  fallo_interno: async () => deExcepcion(new Error("una excepcion que nadie previo")).error,
};

/** Una peticion con token, sin origen: como la hace la CLI. */
function pedirJson(svc, ruta, metodo, cuerpo) {
  return fetch(`${svc.url}${ruta}`, {
    method: metodo,
    headers: { "x-noxloop-token": TOKEN, "content-type": "application/json" },
    ...(cuerpo === undefined ? {} : { body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) }),
  });
}

/** Un proyecto local dado de alta, para los provocadores que necesitan uno. */
async function proyectoDePrueba(svc, nombre) {
  const r = await pedirJson(svc, "/v1/projects", "POST", {
    origen: "local",
    nombre,
    ruta_local: repoDePrueba(),
  });
  return (await r.json()).proyecto;
}

test("todo codigo del catalogo tiene una forma de provocarlo", () => {
  const sinProvocador = Object.keys(CATALOGO).filter((c) => !PROVOCADORES[c]);
  assert.deepEqual(
    sinProvocador,
    [],
    `hay errores declarados que ningun camino del servicio emite: ${sinProvocador.join(", ")}`,
  );
});

test("EL INVARIANTE: ningun error del servicio sale sin causa y sin accion", async (t) => {
  const svc = await arrancar({ home: homeTemporal(), token: TOKEN });
  t.after(() => svc.detener());

  for (const codigo of Object.keys(CATALOGO)) {
    const error = await PROVOCADORES[codigo](svc);
    assert.ok(error, `${codigo}: no salio ningun error`);
    assert.equal(error.codigo, codigo, `${codigo}: el provocador emitio ${error.codigo}`);

    // La causa es texto completo, no un resumen: el contrato lo dice asi.
    assert.equal(typeof error.causa, "string", `${codigo}: la causa no es texto`);
    assert.ok(error.causa.length > 30, `${codigo}: la causa es demasiado corta para explicar nada`);

    assert.equal(typeof error.accion, "string", `${codigo}: no trae accion`);
    assert.ok(error.accion.length > 20, `${codigo}: la accion no nombra ninguna operacion concreta`);
    assert.ok(
      /[A-Za-z]/.test(error.accion) && !/^(reintenta|intenta de nuevo)\.?$/i.test(error.accion.trim()),
      `${codigo}: "${error.accion}" no es una accion, es un encogimiento de hombros`,
    );
  }
});

test("la respuesta de error no trae nada mas que el sobre: { error: {...} }", async () => {
  const svc = await arrancar({ home: homeTemporal(), token: TOKEN });
  try {
    const r = await fetch(`${svc.url}/v1/lo-que-no-existe`, { headers: { "x-noxloop-token": TOKEN } });
    assert.equal(r.status, 404);
    assert.match(r.headers.get("content-type"), /application\/json/);
    const cuerpo = await r.json();
    assert.deepEqual(Object.keys(cuerpo), ["error"], "un segundo campo arriba parte a los clientes en dos");
    for (const clave of Object.keys(cuerpo.error)) {
      assert.ok(
        ["codigo", "causa", "accion", "objeto"].includes(clave),
        `el error trae un campo que el contrato no declara: ${clave}`,
      );
    }
  } finally {
    await svc.detener();
  }
});

test("el codigo HTTP acompania al codigo del error, no lo contradice", async () => {
  const svc = await arrancar({ home: homeTemporal(), token: TOKEN });
  try {
    const casos = [
      ["/v1/capabilities", {}, 401],
      ["/v1/lo-que-no-existe", { "x-noxloop-token": TOKEN }, 404],
    ];
    for (const [ruta, headers, esperado] of casos) {
      const r = await fetch(`${svc.url}${ruta}`, { headers: /** @type {any} */ (headers) });
      assert.equal(r.status, esperado, `${ruta} contesto ${r.status}`);
    }
  } finally {
    await svc.detener();
  }
});
