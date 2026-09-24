// Conectar la cuenta de codigo SIN proyecto: la conexion del espacio de
// trabajo.
//
// EL FALLO QUE ESTO CIERRA, VISTO EN PANTALLA. En «Anadir proyecto» ->
// «Repositorio remoto» la pantalla decia «Sin cuenta de codigo conectada» y
// ofrecia un boton: «Ir a un proyecto y conectar». Conectar la cuenta exigia un
// proyecto, y en el alta el proyecto todavia no existe. Asi que para dar de
// alta un proyecto habia que salir a otro proyecto.
//
// LO QUE CAMBIA AQUI. `conectar` acepta `projectId: null`, y entonces la fila
// es del espacio de trabajo y su credencial es de ambito `global` —que es el
// caso que ese enum de la boveda existe para cubrir—. Un operador tiene UNA
// cuenta de codigo y muchos repositorios: la conecta una vez.
//
// LO QUE NO CAMBIA. Con proyecto, todo sigue igual: `ambito: "proyecto"` y el
// `project_id` en su campo. No es el mismo caso y no se unifican.
//
// LA RED NO SE TOCA: la peticion llega inyectada.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { crearAdaptadorLocal } from "../src/adaptadores/local.mjs";
import { CATALOGO_POR_DEFECTO } from "../src/catalogo.mjs";
import { centinela, trozoDelCentinela } from "./ayuda.mjs";

import { crearBoveda } from "../../vault/src/boveda.mjs";
import { repositorioEnMemoria as repositorioDeBoveda } from "../../vault/src/repositorio.mjs";
import { crearAuditoria } from "../../vault/src/auditoria.mjs";
import { crearBackendDeArchivo } from "../../vault/src/backends/archivo.mjs";

const SECRETO = centinela("cuenta-de-codigo");
const WORKSPACE = "espacio-de-trabajo-1";

/** El proveedor de codigo curado que se conecta pegando un token personal. */
const SCM_CON_TOKEN = CATALOGO_POR_DEFECTO.find((e) => e.clase === "scm" && e.modo !== "oauth2");

const CRUDOS = [
  {
    id: 1,
    name: "noxloop",
    full_name: "una-organizacion/noxloop",
    description: "el orquestador",
    private: false,
    default_branch: "main",
    clone_url: "https://forja.ejemplo/una-organizacion/noxloop.git",
    ssh_url: "git@forja.ejemplo:una-organizacion/noxloop.git",
    html_url: "https://forja.ejemplo/una-organizacion/noxloop",
    updated_at: "2026-09-20T10:00:00Z",
  },
];

function bovedaReal() {
  const dir = mkdtempSync(join(tmpdir(), "noxloop-espacio-"));
  const backend = crearBackendDeArchivo({
    ruta: join(dir, "credenciales.cifrado"),
    passphrase: "frase-de-prueba",
    motivo: "prueba: el llavero del sistema operativo no se ejercita en CI",
  });
  return crearBoveda({ backend, repositorio: repositorioDeBoveda(), auditoria: crearAuditoria() });
}

function montar(boveda = bovedaReal()) {
  const vistas = [];
  const proveedor = crearAdaptadorLocal({
    boveda,
    workspaceId: WORKSPACE,
    peticion: async (url, init) => {
      vistas.push({ url, autorizado: Boolean(init?.headers?.Authorization) });
      return new Response(JSON.stringify(CRUDOS), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { proveedor, vistas };
}

const valoresDelScm = () =>
  Object.fromEntries(SCM_CON_TOKEN.campos.map((c) => [c.nombre, c.secreto ? SECRETO : "un-valor"]));

test("EL CAMINO DEL ALTA: se conecta la cuenta de codigo sin ningun proyecto, y la conexion queda lista", async () => {
  const { proveedor } = montar();

  const alta = await proveedor.conectar({ projectId: null, slug: SCM_CON_TOKEN.slug, valores: valoresDelScm() });

  assert.equal(alta.conexion.estado, "conectada");
  assert.equal(
    alta.conexion.project_id,
    null,
    "la conexion del espacio de trabajo quedo colgando de algun proyecto: no hay ninguno todavia",
  );
  assert.equal(
    trozoDelCentinela(alta, SECRETO),
    null,
    "la salida de conectar llevaba el valor del token dentro",
  );
});

test("`conectar` sin `projectId` NI declararlo se rechaza: un alcance que nadie declaro no se adivina", async () => {
  // `null` es «del espacio de trabajo»; ausente es «me olvide». Tratarlos igual
  // convierte cada olvido en una conexion compartida por todo el espacio, que
  // es mas alcance del que nadie pidio.
  const { proveedor } = montar();
  await assert.rejects(
    () => proveedor.conectar({ slug: SCM_CON_TOKEN.slug, valores: valoresDelScm() }),
    (e) => {
      assert.equal(e.codigo, "alcance_sin_declarar");
      assert.ok(e.causa.length > 10, "no dice que falta");
      assert.ok(e.accion.length > 10, "no dice que hacer");
      return true;
    },
  );
});

test("la credencial de una conexion del espacio de trabajo es de ambito GLOBAL, y sin proyecto", async () => {
  const anotado = [];
  const deposito = {
    async registrar(datos) {
      anotado.push(datos);
      return { credencial: { id: "cred-1", ref_boveda: "ref-1" } };
    },
    async otorgar(datos) {
      anotado.push({ grant: datos });
      return { id: "grant-1" };
    },
    async recuperar() {
      return "un-valor";
    },
    async borrar() {},
    async revocar() {},
  };
  const proveedor = crearAdaptadorLocal({ boveda: deposito, workspaceId: WORKSPACE });

  await proveedor.conectar({ projectId: null, slug: SCM_CON_TOKEN.slug, valores: valoresDelScm() });

  const alta = anotado.find((a) => a.workspace !== undefined);
  assert.ok(alta, "el adaptador no registro ninguna credencial");
  assert.equal(alta.workspace, WORKSPACE);
  assert.equal(
    alta.ambito,
    "global",
    "la credencial de la cuenta del espacio de trabajo entro como de `proyecto`: el CHECK del almacen exige " +
      "entonces un `project_id` que no existe, y el alta muere con un error que habla de una columna",
  );
  assert.equal(alta.project_id, null);

  const grant = anotado.find((a) => a.grant)?.grant;
  assert.ok(grant, "el adaptador no pidio ningun permiso: el valor se guarda y despues no se puede volver a pedir");
  assert.equal(grant.project_id, null, "el permiso sobre una credencial global se otorgo a nombre de un proyecto");
  assert.ok(grant.concedido_por, "un permiso sin autor no se le puede preguntar a nadie");
});

test("los repositorios se listan desde la conexion del espacio de trabajo, que es para lo que existe", async () => {
  // Esta es la razon entera del cambio: pegar el token en el alta y que la
  // lista aparezca ahi mismo, sin salir a ninguna otra pantalla.
  const { proveedor, vistas } = montar();
  const alta = await proveedor.conectar({ projectId: null, slug: SCM_CON_TOKEN.slug, valores: valoresDelScm() });

  const r = await proveedor.repositorios(alta.conexion.id);

  assert.deepEqual(r.items.map((x) => x.nombre_completo), ["una-organizacion/noxloop"]);
  assert.equal(vistas[0].autorizado, true, "la llamada a la forja salio sin la cabecera que la autoriza");
  assert.equal(trozoDelCentinela(r, SECRETO), null, "el listado devolvio el valor del token");
});

test("`listar(null)` devuelve las del espacio de trabajo y NO las de los proyectos", async () => {
  const { proveedor } = montar();
  const delEspacio = await proveedor.conectar({
    projectId: null,
    slug: SCM_CON_TOKEN.slug,
    valores: valoresDelScm(),
  });
  const delProyecto = await proveedor.conectar({
    projectId: "proyecto-1",
    slug: SCM_CON_TOKEN.slug,
    valores: valoresDelScm(),
  });

  assert.deepEqual((await proveedor.listar(null)).map((c) => c.id), [delEspacio.conexion.id]);
  assert.deepEqual((await proveedor.listar("proyecto-1")).map((c) => c.id), [delProyecto.conexion.id]);
});

test("con proyecto no cambia nada: la credencial sigue siendo de ambito `proyecto`", async () => {
  // La mitad que no se toca. Un tracker SI puede ser por proyecto —dos
  // proyectos pueden vivir en dos Jira distintos— y unificar los dos alcances
  // habria convertido toda credencial en compartida.
  const anotado = [];
  const proveedor = crearAdaptadorLocal({
    boveda: {
      async registrar(datos) {
        anotado.push(datos);
        return { credencial: { id: "cred-1", ref_boveda: "ref-1" } };
      },
      async otorgar(datos) {
        anotado.push({ grant: datos });
        return { id: "grant-1" };
      },
      async recuperar() {
        return "un-valor";
      },
      async borrar() {},
      async revocar() {},
    },
    workspaceId: WORKSPACE,
  });

  await proveedor.conectar({ projectId: "proyecto-9", slug: SCM_CON_TOKEN.slug, valores: valoresDelScm() });

  const alta = anotado.find((a) => a.workspace !== undefined);
  assert.equal(alta.ambito, "proyecto");
  assert.equal(alta.project_id, "proyecto-9");
  assert.equal(anotado.find((a) => a.grant).grant.project_id, "proyecto-9");
});
