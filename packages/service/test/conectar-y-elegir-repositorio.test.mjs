// Conectar un proveedor de codigo y elegir el repositorio de una lista, por
// HTTP y contra la boveda de verdad.
//
// POR QUE ESTA PRUEBA MONTA EL ADAPTADOR REAL Y NO EL FALSO. El adaptador falso
// no toca la boveda, y lo que fallaba estaba EXACTAMENTE ahi: contra el almacen
// con sus claves foraneas, guardar el token y autorizar su uso morian con
// `FOREIGN KEY constraint failed` envuelto en un "comprueba tu llavero". Las
// pruebas del paquete de conexiones no lo veian porque su boveda de prueba vive
// en memoria y no comprueba nada. Salio de pegarle con curl al servicio
// corriendo; esto lo deja atrapado.
//
// LA RED NO SE TOCA: la peticion al proveedor llega inyectada al adaptador.

import { test } from "node:test";
import assert from "node:assert/strict";

import { crearAdaptadorLocal } from "../../connections/src/adaptadores/local.mjs";
import { CATALOGO_POR_DEFECTO } from "../../connections/src/catalogo.mjs";
import { conServicio, pedir, repoDePrueba, FRASE } from "./ayuda.mjs";

/** El proveedor de codigo que se conecta pegando un token. */
const SCM = CATALOGO_POR_DEFECTO.find((e) => e.clase === "scm" && e.modo !== "oauth2");

/** Un valor que no puede aparecer en ninguna respuesta. */
const TOKEN = "centinela-token-de-forja-9f3b7a21c4e8d6";

const REPOS_DE_LA_FORJA = [
  {
    id: 11,
    name: "el-de-la-organizacion",
    full_name: "una-organizacion/el-de-la-organizacion",
    description: "el que se quiere clonar",
    private: false,
    default_branch: "main",
    clone_url: "https://forja.ejemplo/una-organizacion/el-de-la-organizacion.git",
    ssh_url: "git@forja.ejemplo:una-organizacion/el-de-la-organizacion.git",
    html_url: "https://forja.ejemplo/una-organizacion/el-de-la-organizacion",
    updated_at: "2026-09-20T10:00:00Z",
  },
  {
    id: 12,
    name: "el-personal",
    full_name: "una-persona/el-personal",
    description: null,
    private: true,
    default_branch: "main",
    clone_url: "https://forja.ejemplo/una-persona/el-personal.git",
    ssh_url: "git@forja.ejemplo:una-persona/el-personal.git",
    html_url: "https://forja.ejemplo/una-persona/el-personal",
    updated_at: "2026-09-19T10:00:00Z",
  },
];

/**
 * El servicio con el adaptador `local` montado igual que lo monta el
 * ejecutable: por fabrica, con la boveda que nace del cableado.
 */
const conElAdaptadorLocal = () => ({
  frase: FRASE,
  proveedorDeConexiones: ({ boveda, workspace }) =>
    crearAdaptadorLocal({
      boveda,
      workspaceId: workspace.id,
      peticion: async () =>
        new Response(JSON.stringify(REPOS_DE_LA_FORJA), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    }),
});

const json = (cuerpo) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });

async function proyecto(svc) {
  const r = await pedir(svc, "/v1/projects", {
    method: "POST",
    ...json({ origen: "local", nombre: "Con Forja", ruta_local: repoDePrueba() }),
  });
  return (await r.json()).proyecto;
}

async function conectado(svc, p) {
  const r = await pedir(svc, `/v1/projects/${p.id}/connections/authorize`, {
    method: "POST",
    ...json({ proveedor: SCM.slug, valores: { [SCM.campos.find((c) => c.secreto).nombre]: TOKEN } }),
  });
  const texto = await r.clone().text();
  assert.equal(r.status, 201, `conectar por HTTP no llego a 201: ${texto}`);
  assert.ok(!texto.includes(TOKEN), "la respuesta de conectar devolvio el valor del token");
  return (await r.json()).conexion;
}

test("EL CAMINO ENTERO: se pega el token, la credencial entra a la boveda con su grant y la conexion queda viva", async () => {
  await conServicio(conElAdaptadorLocal(), async (svc) => {
    const p = await proyecto(svc);
    const conexion = await conectado(svc, p);

    // 1. La fila donde mira la guarda, con el vocabulario del almacen.
    const filas = svc.dep.almacen.conexiones.porProyecto(p.id);
    assert.equal(filas.length, 1, "conectar no dejo fila en `connection`");
    assert.equal(filas[0].estado, "viva");
    assert.equal(filas[0].clase, "scm");
    assert.equal(filas[0].proveedor, SCM.slug);
    assert.equal(filas[0].id_externo, null, "FR-032: una conexion scm no lleva identificador de la capa de integracion");
    assert.equal(
      filas[0].credential_id,
      svc.dep.almacen.boveda.credenciales()[0].id,
      "la fila de la conexion no apunta a la credencial que acaba de entrar al inventario: la pantalla dice " +
        "'sin credencial asociada' justo despues de que el operador pegue su token",
    );

    // 2. La credencial en el inventario, con huella y sin valor.
    const inventario = await (await pedir(svc, "/v1/credentials")).json();
    assert.equal(inventario.items.length, 1, "el token no entro al inventario de credenciales");
    assert.ok(inventario.items[0].huella, "la credencial entro sin huella: no hay con que detectar una rotacion");
    assert.ok(!JSON.stringify(inventario).includes(TOKEN), "el inventario devolvio el valor");

    // 3. Y el grant, que es lo que hace que el valor se pueda volver a pedir.
    //    Sin el, la conexion se crea bien y falla recien al usarla.
    const listado = await (await pedir(svc, `/v1/projects/${p.id}/connections`)).json();
    assert.equal(listado.items.length, 1);
    assert.equal(listado.items[0].id, conexion.id);
    assert.equal(
      listado.items[0].estado,
      "viva",
      "el listado devolvio el vocabulario de `packages/connections` (`conectada`), que la pantalla no sabe pintar",
    );
    assert.ok(listado.items[0].proveedor, "el listado no dice de que proveedor es la conexion");
    assert.ok(listado.items[0].clase, "el listado no dice de que clase es la conexion");
  });
});

test("los repositorios que la conexion alcanza se listan por HTTP, y se pueden buscar", async () => {
  await conServicio(conElAdaptadorLocal(), async (svc) => {
    const p = await proyecto(svc);
    const conexion = await conectado(svc, p);

    const r = await pedir(svc, `/v1/connections/${conexion.id}/repos`);
    const texto = await r.clone().text();
    assert.equal(r.status, 200, texto);
    const cuerpo = await r.json();

    assert.equal(cuerpo.items.length, 2, "el listado de repositorios vino vacio");
    assert.equal(cuerpo.items[0].nombre_completo, "una-organizacion/el-de-la-organizacion");
    assert.equal(cuerpo.items[0].url_clon, "https://forja.ejemplo/una-organizacion/el-de-la-organizacion.git");
    assert.equal(cuerpo.items[0].rama_por_defecto, "main");
    assert.equal(cuerpo.total, 2);

    assert.ok(!texto.includes(TOKEN), "el listado de repositorios devolvio el token con el que llamo");

    const buscado = await (await pedir(svc, `/v1/connections/${conexion.id}/repos?q=personal`)).json();
    assert.deepEqual(buscado.items.map((/** @type {any} */ x) => x.nombre), ["el-personal"]);
    assert.equal(buscado.total, 1);
  });
});

test("pedir repositorios de una conexion que no existe no se cae: lo dice con causa y accion", async () => {
  await conServicio(conElAdaptadorLocal(), async (svc) => {
    const r = await pedir(svc, "/v1/connections/no-existe/repos");
    assert.ok(r.status >= 400, "una conexion inventada devolvio una lista de repositorios");
    const { error } = await r.json();
    assert.ok(error.causa && error.accion, `el fallo no trae causa y accion: ${JSON.stringify(error)}`);
  });
});

test("revocar la conexion corta de verdad: la fila queda revocada y el valor se va del deposito", async () => {
  // EL FALLO QUE ESTO ATRAPA, y solo aparece contra el almacen de verdad. La
  // fila de `connection` apunta a su credencial con una clave foranea
  // `ON DELETE RESTRICT`: revocar borra el valor del deposito y su fila del
  // inventario, y el almacen se niega mientras la conexion siga apuntando ahi.
  // Medido con curl: el primer `DELETE` devolvia 400 y dejaba la conexion
  // `viva` — o sea, revocar no revocaba nada.
  await conServicio(conElAdaptadorLocal(), async (svc) => {
    const p = await proyecto(svc);
    const conexion = await conectado(svc, p);
    assert.equal(svc.dep.almacen.boveda.credenciales().length, 1);

    const r = await pedir(svc, `/v1/connections/${conexion.id}`, { method: "DELETE" });
    assert.equal(r.status, 200, `revocar no llego a 200: ${await r.clone().text()}`);

    const filas = svc.dep.almacen.conexiones.porProyecto(p.id);
    assert.equal(
      filas[0].estado,
      "revocada",
      "la fila de la conexion sigue viva despues de revocarla: el proyecto queda apoyado en una conexion que ya no entrega credenciales",
    );
    assert.equal(
      svc.dep.almacen.boveda.credenciales().length,
      0,
      "la credencial sigue en el inventario despues de revocar la conexion que la trajo",
    );
  });
});
