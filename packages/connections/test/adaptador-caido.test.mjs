// T160 · con el adaptador caido, las conexiones existentes siguen y las nuevas
// fallan con causa. La aplicacion no se cae.
//
// EL CASO REAL. La capa de integracion son tres contenedores en la maquina del
// operador. Se caen: por una actualizacion, porque Docker no arranco con la
// sesion, porque el disco se lleno. Lo que NO puede pasar es que la pantalla de
// conexiones deje de dibujarse: el inventario de lo que ya esta conectado vive
// de este lado, y seguir viendolo es lo que distingue "no puedo conectar algo
// nuevo ahora" de "perdi mis conexiones".
//
// Y el error que sale tiene que decir QUE se cayo. "Error al conectar" manda al
// operador a revisar sus credenciales, que es el sitio donde no esta el
// problema.

import { test } from "node:test";
import assert from "node:assert/strict";

import { crearAdaptadorFalso, CATALOGO_FALSO } from "../src/adaptadores/fake.mjs";
import { crearProveedorDeConexiones } from "../src/proveedor.mjs";
import { ErrorDeConexion } from "../src/errores.mjs";
import { relojDePrueba, centinela } from "./ayuda.mjs";

const PAT = CATALOGO_FALSO.find((p) => p.modo === "pat").slug;
const OAUTH = CATALOGO_FALSO.find((p) => p.modo === "oauth2").slug;

function montar() {
  const { reloj, avanzar } = relojDePrueba();
  const proveedor = crearAdaptadorFalso({ reloj, dormir: async (ms) => avanzar(ms) });
  return { proveedor, avanzar };
}

test("EL INVARIANTE: caido el adaptador, lo que ya estaba conectado se sigue viendo", async () => {
  const { proveedor } = montar();
  const alta = await proveedor.conectar({ projectId: "p", slug: PAT, valores: { pat: centinela("caida") } });

  proveedor.caerDePrueba("el motor de integraciones no responde en localhost");

  const listado = await proveedor.listar("p");
  assert.equal(listado.length, 1, "la caida se llevo por delante el inventario");
  assert.equal(listado[0].id, alta.conexion.id);
  assert.equal(listado[0].estado, "conectada");

  // Y el catalogo tambien: es dato declarado, no algo que haya que ir a buscar.
  const catalogo = await proveedor.catalogo();
  assert.ok(catalogo.length > 0, "el catalogo dejo de responder porque se cayo el adaptador");
});

test("EL INVARIANTE: una conexion nueva falla con causa textual, y no tumba nada", async () => {
  const { proveedor } = montar();
  proveedor.caerDePrueba("el contenedor del motor de integraciones esta parado");

  await assert.rejects(
    () => proveedor.conectar({ projectId: "p", slug: PAT, valores: { pat: "x" } }),
    (e) => {
      assert.ok(e instanceof ErrorDeConexion, `salio un ${e?.name}: un error sin forma se propaga como caida`);
      assert.equal(e.codigo, "adaptador_caido");
      assert.match(e.causa, /contenedor del motor de integraciones esta parado/, "la causa no dice que se cayo");
      assert.ok(e.accion, "sin accion, el operador revisa sus credenciales, que es donde no esta el problema");
      return true;
    },
  );

  // La aplicacion sigue: el mismo proveedor contesta lo que no depende del caido.
  assert.equal((await proveedor.listar("p")).length, 0);
  const estado = await proveedor.preflight();
  assert.equal(estado.ok, false, "el preflight no reporto la caida");
  assert.ok(estado.problemas.some((p) => p.codigo === "adaptador_caido"));
});

test("con el adaptador caido, conectar no llega ni a tocar el motor", async () => {
  // La guarda vive en la fachada, y tiene que cortar ANTES de empezar. Sin
  // esto la prueba de arriba pasaba igual, porque el motor falso tambien se
  // niega cuando esta caido: se comprobo desactivando la guarda de la fachada y
  // el verde no se movio. Aqui el motor NO se niega —contesta que si a todo— y
  // lo unico que puede cortar es la fachada.
  //
  // Importa porque un motor que ya escribio la mitad de la conexion antes de
  // descubrir que el otro lado no esta deja una fila a medias que nadie limpia.
  const intentos = { iniciar: 0, guardar: 0 };
  const motorQueNoSeNiega = {
    requisitos: () => [],
    salud: () => ({ arriba: false, causa: "el motor de integraciones no responde" }),
    iniciar: async () => {
      intentos.iniciar += 1;
      return { handle: "h", url: "https://falso.invalido/autorizar" };
    },
    guardar: async () => {
      intentos.guardar += 1;
      return {};
    },
    leer: async () => ({ valores: {} }),
    olvidar: async () => {},
    sondear: async () => null,
    llamar: async () => ({ estado: 200, cuerpo: null }),
  };
  const proveedor = crearProveedorDeConexiones({
    id: "de-prueba",
    catalogo: CATALOGO_FALSO.map((e) => ({ ...e })),
    motor: motorQueNoSeNiega,
  });

  await assert.rejects(
    () => proveedor.conectar({ projectId: "p", slug: PAT, valores: { pat: "x" } }),
    (e) => e.codigo === "adaptador_caido" && /no responde/.test(e.causa),
  );
  await assert.rejects(
    () => proveedor.conectar({ projectId: "p", slug: OAUTH }),
    (e) => e.codigo === "adaptador_caido",
  );
  assert.deepEqual(intentos, { iniciar: 0, guardar: 0 }, "la fachada dejo entrar al motor con el adaptador caido");
  assert.deepEqual(await proveedor.listar("p"), [], "quedo una fila a medias de una conexion que nunca se hizo");
});

test("el flujo oauth2 tambien falla con causa, no con una URL rota", async () => {
  const { proveedor } = montar();
  proveedor.caerDePrueba("no hay respuesta del motor de integraciones");
  await assert.rejects(
    () => proveedor.conectar({ projectId: "p", slug: OAUTH }),
    (e) => e.codigo === "adaptador_caido" && Boolean(e.accion),
  );
});

test("pedir la credencial de una conexion existente con el adaptador caido falla sin perder la conexion", async () => {
  const { proveedor } = montar();
  const alta = await proveedor.conectar({ projectId: "p", slug: PAT, valores: { pat: centinela("viva") } });
  proveedor.caerDePrueba("el deposito de secretos no responde");

  await assert.rejects(
    () => proveedor.credenciales(alta.conexion.id),
    (e) => {
      assert.ok(e instanceof ErrorDeConexion);
      assert.ok(e.causa.includes("deposito de secretos"), `la causa no dice que fallo: ${e.causa}`);
      return true;
    },
  );

  const listado = await proveedor.listar("p");
  assert.equal(listado[0].estado, "conectada", "un fallo al leer el valor marco la conexion como rota");
});

test("cuando el adaptador vuelve, todo sigue donde estaba", async () => {
  const { proveedor } = montar();
  const valor = centinela("vuelve");
  const alta = await proveedor.conectar({ projectId: "p", slug: PAT, valores: { pat: valor } });
  proveedor.caerDePrueba("caida pasajera");
  await assert.rejects(() => proveedor.credenciales(alta.conexion.id));
  proveedor.levantarDePrueba();

  const viva = await proveedor.credenciales(alta.conexion.id);
  assert.equal(viva.valores.FALSO_PAT, valor, "la conexion no sobrevivio a la caida del adaptador");
});
