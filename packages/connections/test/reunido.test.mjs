// Los dos caminos a la vez, y por que hacen falta los dos.
//
// EL FALLO QUE ESTE ARCHIVO IMPIDE, Y SE VIO VENIR ANTES DE ESCRIBIRLO. El
// servicio monta UN proveedor de conexiones: `dependencias.mjs` guarda uno y la
// pantalla compara `entrada.adaptador === adaptadorMontado` para decidir que se
// puede conectar. Con el adaptador alojado montado a secas, el operador que
// levanta los contenedores para poder usar OAuth PIERDE de la pantalla Azure
// DevOps, Vercel y el GitHub de token personal — que son tres de los ocho
// proveedores del catalogo y los unicos que funcionaban hasta hoy.
//
// El encargo decia lo contrario con todas las letras: el token personal deja de
// ser el camino por defecto y pasa a ser LA ALTERNATIVA para quien no quiera
// contenedores. Una alternativa que desaparece de la pantalla al levantar los
// contenedores no es una alternativa.
//
// POR QUE REPARTE POR EL MODO Y NO POR PREFERENCIA. Es la misma regla que
// gobierna todo el paquete: el modo lo decide el catalogo. `oauth2` va al
// alojado porque es el unico que sabe abrir un flujo de autorizacion; todo lo
// demas va al local, porque guardar un token en el llavero del sistema no
// necesita un Postgres en Docker.

import { test } from "node:test";
import assert from "node:assert/strict";

import { crearProveedorReunido } from "../src/reunido.mjs";
import { crearAdaptadorFalso, CATALOGO_FALSO } from "../src/adaptadores/fake.mjs";
import { ErrorDeConexion } from "../src/errores.mjs";
import { centinela, trozoDelCentinela } from "./ayuda.mjs";

const SECRETO = centinela("pat-del-reunido");

/** Dos falsos: uno se queda con oauth2, el otro con el resto. */
function dosAdaptadores() {
  const soloOauth = CATALOGO_FALSO.filter((e) => e.modo === "oauth2");
  const sinOauth = CATALOGO_FALSO.filter((e) => e.modo !== "oauth2");
  const alojado = crearAdaptadorFalso({ catalogo: soloOauth });
  const local = crearAdaptadorFalso({ catalogo: sinOauth });
  // El identificador de cada uno se finge para que el reparto sea observable:
  // lo que la pantalla compara es ese nombre.
  return {
    alojado: Object.assign(alojado, { id: "nango" }),
    local: Object.assign(local, { id: "local" }),
  };
}

test("EL INVARIANTE: con los dos montados, el catalogo trae los dos caminos", async () => {
  const { alojado, local } = dosAdaptadores();
  const reunido = crearProveedorReunido({ adaptadores: [alojado, local] });

  const catalogo = await reunido.catalogo();
  const modos = new Set(catalogo.map((e) => e.modo));
  assert.ok(modos.has("oauth2"), "el catalogo reunido perdio el camino de OAuth");
  assert.ok(modos.size > 1, `el catalogo reunido solo trae ${[...modos]}: el otro camino desaparecio`);

  // Y cada entrada dice QUIEN la atiende. Sin esto, la pantalla no puede
  // distinguir «esto no se puede conectar» de «esto lo atiende el otro».
  for (const entrada of catalogo) {
    assert.ok(entrada.adaptador, `'${entrada.slug}' no dice que adaptador lo atiende`);
  }
  assert.equal(catalogo.find((e) => e.modo === "oauth2").adaptador, "nango");
  assert.equal(catalogo.find((e) => e.modo !== "oauth2").adaptador, "local");
});

test("conectar reparte por el modo del catalogo, no por preferencia de quien llama", async () => {
  const { alojado, local } = dosAdaptadores();
  const reunido = crearProveedorReunido({ adaptadores: [alojado, local] });

  const conOauth = await reunido.conectar({ projectId: null, slug: "falso-oauth2" });
  assert.ok(conOauth.url, "el proveedor oauth2 no fue al adaptador que abre navegador");
  assert.equal(conOauth.abrir_en, "navegador_del_sistema");

  const conToken = await reunido.conectar({
    projectId: null,
    slug: "falso-pat",
    valores: { pat: SECRETO, usuario: "alguien" },
  });
  assert.equal(conToken.url, undefined, "el proveedor de token personal abrio un navegador");
  assert.equal(conToken.conexion.estado, "conectada");
});

test("el inventario es UNO solo: una conexion no desaparece por estar en el otro adaptador", async () => {
  // EL FALLO QUE ESTO MIDE. `listar` de cada adaptador solo conoce sus propias
  // conexiones. Si el reunido delegara en uno, la pantalla enseñaria la mitad
  // del inventario y el operador creeria haber perdido la conexion que acaba
  // de crear.
  const { alojado, local } = dosAdaptadores();
  const reunido = crearProveedorReunido({ adaptadores: [alojado, local] });

  const a = await reunido.conectar({ projectId: "p1", slug: "falso-oauth2" });
  const b = await reunido.conectar({ projectId: "p1", slug: "falso-api-key", valores: { api_key: SECRETO } });

  const listado = await reunido.listar("p1");
  const handles = listado.map((c) => c.handle);
  assert.ok(handles.includes(a.handle), "la conexion del adaptador alojado no figura en el inventario");
  assert.ok(handles.includes(b.conexion.handle), "la conexion del adaptador local no figura en el inventario");
  assert.equal(trozoDelCentinela(listado, SECRETO), null, "el inventario reunido devolvio el valor de una credencial");
});

test("las operaciones por id encuentran la conexion en el adaptador que la tiene", async () => {
  const { alojado, local } = dosAdaptadores();
  const reunido = crearProveedorReunido({ adaptadores: [alojado, local] });

  const alta = await reunido.conectar({ projectId: "p1", slug: "falso-api-key", valores: { api_key: SECRETO } });
  const id = alta.conexion.id;

  const viva = await reunido.credenciales(id);
  assert.equal(viva.valores.FALSO_API_KEY, SECRETO);

  await reunido.revocar(id);
  await assert.rejects(() => reunido.credenciales(id), (e) => e instanceof ErrorDeConexion);
});

test("un id que no esta en ningun adaptador falla diciendo donde se mira, no con un `undefined`", async () => {
  const { alojado, local } = dosAdaptadores();
  const reunido = crearProveedorReunido({ adaptadores: [alojado, local] });
  await assert.rejects(
    () => reunido.credenciales("un-id-que-no-existe"),
    (e) => {
      assert.ok(e instanceof ErrorDeConexion);
      assert.equal(e.codigo, "conexion_desconocida");
      assert.ok(e.accion.length > 0);
      return true;
    },
  );
});

test("el preflight junta los requisitos y los problemas de los dos", async () => {
  const { alojado, local } = dosAdaptadores();
  const reunido = crearProveedorReunido({ adaptadores: [alojado, local] });
  const estado = await reunido.preflight();
  assert.ok(Array.isArray(estado.requisitos));
  assert.ok(Array.isArray(estado.problemas));
  assert.equal(typeof estado.ok, "boolean");

  // Y si uno de los dos no arranca, el reunido NO dice que todo esta bien.
  const caido = {
    id: "caido",
    catalogo: async () => [],
    preflight: async () => ({
      ok: false,
      requisitos: [],
      problemas: [{ codigo: "puerto_ocupado", causa: "el puerto 3003 esta ocupado", accion: "liberalo" }],
    }),
    listar: async () => [],
  };
  const conUnoCaido = crearProveedorReunido({ adaptadores: [caido, local] });
  const roto = await conUnoCaido.preflight();
  assert.equal(roto.ok, false, "un adaptador con el puerto ocupado y el preflight reunido dijo que todo bien");
  assert.ok(roto.problemas.some((p) => p.codigo === "puerto_ocupado"));
  // Y dice de CUAL de los dos es el problema: con dos adaptadores montados,
  // «puerto ocupado» a secas no dice a quien hay que arreglarle nada.
  assert.ok(roto.problemas.every((p) => p.adaptador), "un problema sin adaptador no dice a quien le pasa");
});

test("`id` declara los dos, y el principal es el primero: es lo que la pantalla compara", async () => {
  const { alojado, local } = dosAdaptadores();
  const reunido = crearProveedorReunido({ adaptadores: [alojado, local] });
  assert.equal(reunido.id, "nango");
  assert.deepEqual(reunido.ids, ["nango", "local"]);
});

test("montarlo con un solo adaptador devuelve ese adaptador, sin envoltorio", () => {
  // Reunir uno solo no aporta nada y si quita: el adaptador alojado trae
  // `aplicaciones()` y `registrarAplicacion()`, que no estan en el contrato y
  // que un envoltorio generico se comeria.
  const { local } = dosAdaptadores();
  assert.equal(crearProveedorReunido({ adaptadores: [local] }), local);
});

test("montarlo sin adaptadores falla al montar, no al conectar", () => {
  assert.throws(
    () => crearProveedorReunido({ adaptadores: [] }),
    (e) => {
      assert.equal(e.codigo, "sin_adaptadores");
      assert.ok(e.accion);
      return true;
    },
  );
});
