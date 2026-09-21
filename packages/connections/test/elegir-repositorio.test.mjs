// Elegir el repositorio de una lista, en vez de escribir una URL a mano.
//
// EL FALLO CONCRETO QUE ESTO CIERRA. El alta de proyecto con origen remoto
// pedia la direccion del repositorio en una casilla de texto libre. El operador
// que YA conecto su cuenta de codigo —el producto tiene su credencial, con su
// grant, en la boveda— tenia que ir al navegador, abrir la forja, copiar la
// direccion y pegarla. Una letra de mas y el clon falla mas tarde, en el
// servicio, con un error de git que no menciona ninguna pantalla.
//
// POR QUE EL LISTADO CUELGA DE LA FACHADA Y NO DE UN MODULO QUE HABLE CON LA
// FORJA. Porque la pregunta "que repositorios alcanza esta conexion" es la
// misma tenga detras un token personal o una autorizacion delegada, y el dia
// que el adaptador alojado entre, la MISMA pantalla tiene que servir. Si el
// selector hablara con la forja, ese dia habria que reescribirlo — y de paso
// necesitaria el valor del token en el cliente, que es justo lo que no puede
// pasar.
//
// LA RED NO SE TOCA AQUI. La peticion llega inyectada, como ya hace el
// adaptador `local` en su suite de contrato.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { crearAdaptadorLocal } from "../src/adaptadores/local.mjs";
import { CATALOGO_POR_DEFECTO } from "../src/catalogo.mjs";
import { ErrorDeConexion } from "../src/errores.mjs";
import { centinela, trozoDelCentinela } from "./ayuda.mjs";

import { crearBoveda } from "../../vault/src/boveda.mjs";
import { repositorioEnMemoria as repositorioDeBoveda } from "../../vault/src/repositorio.mjs";
import { crearAuditoria } from "../../vault/src/auditoria.mjs";
import { crearBackendDeArchivo } from "../../vault/src/backends/archivo.mjs";

const SECRETO = centinela("token-de-forja");

/** El slug curado de clase `scm` que se conecta pegando un token personal. */
const SCM_CON_TOKEN = CATALOGO_POR_DEFECTO.find((e) => e.clase === "scm" && e.modo !== "oauth2");

function bovedaReal() {
  const dir = mkdtempSync(join(tmpdir(), "noxloop-repos-"));
  const backend = crearBackendDeArchivo({
    ruta: join(dir, "credenciales.cifrado"),
    passphrase: "frase-de-prueba",
    motivo: "prueba: el llavero del sistema operativo no se ejercita en CI",
  });
  return crearBoveda({ backend, repositorio: repositorioDeBoveda(), auditoria: crearAuditoria() });
}

/** Lo que una forja devuelve, con los nombres crudos que trae su API. */
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
  {
    id: 2,
    name: "tienda-vertika",
    full_name: "una-persona/tienda-vertika",
    description: null,
    private: true,
    default_branch: "master",
    clone_url: "https://forja.ejemplo/una-persona/tienda-vertika.git",
    ssh_url: "git@forja.ejemplo:una-persona/tienda-vertika.git",
    html_url: "https://forja.ejemplo/una-persona/tienda-vertika",
    updated_at: "2026-09-19T10:00:00Z",
  },
];

/**
 * Monta el adaptador con una peticion grabada. `respuesta` decide que contesta
 * la forja; `vistas` acumula las URL pedidas y si llevaban autorizacion.
 */
function montar({ respuesta = () => ({ estado: 200, cuerpo: CRUDOS }) } = {}) {
  const vistas = [];
  const proveedor = crearAdaptadorLocal({
    boveda: bovedaReal(),
    workspaceId: "espacio-de-prueba",
    peticion: async (url, init) => {
      vistas.push({ url, autorizado: Boolean(init?.headers?.Authorization) });
      const r = respuesta(url);
      return new Response(JSON.stringify(r.cuerpo), {
        status: r.estado,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { proveedor, vistas };
}

/** Conecta el proveedor de codigo pegando el token, como haria el operador. */
async function conectado(proveedor) {
  const campoSecreto = SCM_CON_TOKEN.campos.find((c) => c.secreto);
  const valores = Object.fromEntries(
    SCM_CON_TOKEN.campos.map((c) => [c.nombre, c.secreto ? SECRETO : "un-valor"]),
  );
  assert.ok(campoSecreto, "el proveedor de codigo por token no declara ningun campo secreto");
  const alta = await proveedor.conectar({ projectId: "proyecto-1", slug: SCM_CON_TOKEN.slug, valores });
  return alta.conexion;
}

test("hay un proveedor de codigo que se conecta pegando un token, sin registrar ninguna aplicacion", () => {
  assert.ok(
    SCM_CON_TOKEN,
    "el catalogo propio no declara ningun proveedor de codigo que no sea oauth2: sin eso, elegir el " +
      "repositorio depende de que el operador registre una aplicacion con la forja, que es justo lo que no puede hacer hoy",
  );
  assert.ok(SCM_CON_TOKEN.repos, `'${SCM_CON_TOKEN.slug}' no declara como se listan sus repositorios`);
});

test("la conexion lista los repositorios que alcanza, con la forma del contrato y no la de la forja", async () => {
  const { proveedor, vistas } = montar();
  const conexion = await conectado(proveedor);

  const r = await proveedor.repositorios(conexion.id);

  assert.equal(r.items.length, 2, "el listado no devolvio los repositorios que la forja contesto");
  assert.deepEqual(
    r.items.map((x) => x.nombre_completo),
    ["una-organizacion/noxloop", "una-persona/tienda-vertika"],
  );

  const primero = r.items[0];
  assert.equal(primero.nombre, "noxloop");
  assert.equal(primero.privado, false);
  assert.equal(primero.rama_por_defecto, "main");
  assert.equal(primero.url_clon, "https://forja.ejemplo/una-organizacion/noxloop.git");
  assert.equal(primero.descripcion, "el orquestador");

  // Los nombres crudos de la forja NO viajan: si viajaran, la pantalla se
  // escribiria contra ellos y cambiar de adaptador la rompe.
  assert.equal(primero.full_name, undefined, "la forma cruda de la forja se filtro al contrato");
  assert.equal(primero.clone_url, undefined, "la forma cruda de la forja se filtro al contrato");

  assert.equal(vistas.length, 1, "listar repositorios no llamo exactamente una vez a la API del proveedor");
  assert.equal(vistas[0].autorizado, true, "la llamada salio sin la cabecera que la autoriza");
});

test("EL INVARIANTE: el listado de repositorios no lleva el valor del token por ninguna via", async () => {
  const { proveedor } = montar();
  const conexion = await conectado(proveedor);
  const r = await proveedor.repositorios(conexion.id);
  assert.equal(
    trozoDelCentinela(r, SECRETO),
    null,
    "el listado de repositorios devolvio el valor de la credencial con la que llamo",
  );
});

test("se busca por texto sin volver a pedirle nada al proveedor", async () => {
  const { proveedor, vistas } = montar();
  const conexion = await conectado(proveedor);

  const r = await proveedor.repositorios(conexion.id, { texto: "VERTIKA" });
  assert.deepEqual(r.items.map((x) => x.nombre), ["tienda-vertika"], "la busqueda no encontro por nombre");
  assert.equal(r.total, 1, "`total` tiene que contar lo que el filtro dejo, no la pagina");
  assert.equal(vistas.length, 1);

  // Y por la parte de la organizacion, que es como se busca cuando hay
  // veinte repositorios con nombres parecidos en cuentas distintas.
  const porCuenta = await proveedor.repositorios(conexion.id, { texto: "una-organizacion" });
  assert.deepEqual(porCuenta.items.map((x) => x.nombre), ["noxloop"]);
});

test("el limite recorta y lo DICE, en vez de dejar creer que eso es todo", async () => {
  const { proveedor } = montar();
  const conexion = await conectado(proveedor);
  const r = await proveedor.repositorios(conexion.id, { limite: 1 });
  assert.equal(r.items.length, 1);
  assert.equal(r.mostrados, 1);
  assert.equal(r.total, 2, "`total` se recorto con la pagina: la pantalla diria que hay uno solo");
  assert.equal(r.hay_mas, true);
});

test("un proveedor que no declara listado de repositorios lo dice con causa y accion", async () => {
  const { proveedor } = montar();
  const sinRepos = CATALOGO_POR_DEFECTO.find((e) => e.modo !== "oauth2" && !e.repos);
  assert.ok(sinRepos, "todos los proveedores curados declaran repositorios: este chequeo ya no mide nada");

  const valores = Object.fromEntries(sinRepos.campos.map((c) => [c.nombre, c.secreto ? SECRETO : "un-valor"]));
  const alta = await proveedor.conectar({ projectId: "proyecto-1", slug: sinRepos.slug, valores });

  await assert.rejects(
    () => proveedor.repositorios(alta.conexion.id),
    (e) => {
      assert.ok(e instanceof ErrorDeConexion, `lanzo un ${e?.name} sin forma`);
      assert.equal(e.codigo, "sin_listado_de_repositorios");
      assert.ok(e.causa.includes(sinRepos.slug), "la causa no nombra al proveedor");
      assert.ok(e.accion.length > 10, "no dice que hacer");
      return true;
    },
  );
});

test("cuando la forja rechaza, la causa lleva su estado y su mensaje —no un 'no se pudo'", async () => {
  const { proveedor } = montar({
    respuesta: () => ({ estado: 401, cuerpo: { message: "Bad credentials" } }),
  });
  const conexion = await conectado(proveedor);

  await assert.rejects(
    () => proveedor.repositorios(conexion.id),
    (e) => {
      assert.equal(e.codigo, "listado_rechazado");
      assert.ok(e.causa.includes("401"), `la causa no dice con que estado rechazo: ${e.causa}`);
      assert.ok(e.causa.includes("Bad credentials"), `la causa no repite el mensaje del proveedor: ${e.causa}`);
      assert.ok(e.accion.length > 10, "no dice que hacer");
      assert.equal(trozoDelCentinela(e, SECRETO), null, "el error de listado llevaba el token dentro");
      return true;
    },
  );
});

test("revocada la conexion, el listado corta: no queda una pantalla eligiendo repositorios de una cuenta que ya no se alcanza", async () => {
  const { proveedor } = montar();
  const conexion = await conectado(proveedor);
  await proveedor.revocar(conexion.id);

  await assert.rejects(
    () => proveedor.repositorios(conexion.id),
    (e) => e instanceof ErrorDeConexion && e.codigo === "conexion_revocada" && e.accion.length > 0,
  );
});
