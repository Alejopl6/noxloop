// `listar` y `catalogo` no devuelven valores de credencial. Nunca.
//
// POR QUE SE MIDE SOBRE EL TEXTO SERIALIZADO Y NO SOBRE LOS CAMPOS. La fuga no
// llega por un campo que se llame `token`: llega por el campo de al lado —una
// etiqueta que guarda "la cuenta de fulano (pat: xxx)", un `deposito` donde el
// adaptador metio de mas, un error que se guardo entero en la fila—. Lo unico
// que atrapa todas esas formas es buscar el valor en todo lo que sale.
//
// Y el sitio donde importa es el de salida: `listar` alimenta una pantalla, y
// una pantalla es un sitio donde el valor no puede estar (principio IX).

import { test } from "node:test";
import assert from "node:assert/strict";

import { crearAdaptadorFalso, CATALOGO_FALSO } from "../src/adaptadores/fake.mjs";
import { centinela, trozoDelCentinela, relojDePrueba } from "./ayuda.mjs";

const PAT = CATALOGO_FALSO.find((p) => p.modo === "pat").slug;

function montar() {
  const { reloj, avanzar } = relojDePrueba();
  return crearAdaptadorFalso({ reloj, dormir: async (ms) => avanzar(ms) });
}

test("EL INVARIANTE: el valor que entro por conectar no sale por listar ni por catalogo", async () => {
  const secreto = centinela("listar");
  const proveedor = montar();
  await proveedor.conectar({
    projectId: "p",
    slug: PAT,
    valores: { pat: secreto, usuario: "una-cuenta" },
  });

  const listado = await proveedor.listar("p");
  assert.equal(listado.length, 1);
  assert.equal(trozoDelCentinela(listado, secreto), null, "el valor de la credencial salio por `listar`");
  assert.equal(trozoDelCentinela(await proveedor.catalogo(), secreto), null, "el valor salio por `catalogo`");

  // Lo que SI tiene que salir, porque es inventario: quien es y de que proyecto.
  assert.equal(listado[0].slug, PAT);
  assert.equal(listado[0].project_id, "p");
  assert.equal(listado[0].etiqueta, "una-cuenta", "sin etiqueta el operador no distingue dos conexiones del mismo sitio");
});

test("la fila de la conexion no tiene ningun campo donde quepa un valor", async () => {
  // Igual que en el inventario de la boveda: el campo que hoy esta a null es
  // una invitacion. Si no existe, agregarlo es una decision visible en el diff.
  const proveedor = montar();
  const alta = await proveedor.conectar({ projectId: "p", slug: PAT, valores: { pat: centinela("campos") } });
  const claves = Object.keys(alta.conexion);
  for (const prohibida of ["valor", "valores", "token", "secreto", "pat", "clave", "password"]) {
    assert.ok(!claves.includes(prohibida), `la conexion tiene un campo \`${prohibida}\``);
  }
});

test("un motor que intente colar el valor en el deposito queda atrapado", async () => {
  // El `deposito` es metadato opaco del adaptador —referencias, identificadores—
  // y es el sitio mas comodo para que se cuele un valor sin que nadie lo note.
  const secreto = centinela("deposito");
  const proveedor = crearAdaptadorFalso({ depositoFilonDePrueba: true });
  await assert.rejects(
    () => proveedor.conectar({ projectId: "p", slug: PAT, valores: { pat: secreto } }),
    (e) => {
      assert.equal(e.codigo, "fuga_de_valor");
      assert.equal(trozoDelCentinela(`${e.message} ${e.causa} ${e.accion}`, secreto), null, "el error lleva el valor");
      return true;
    },
  );
  const listado = await proveedor.listar("p");
  assert.deepEqual(listado, [], "la fila con el valor dentro llego a guardarse igual");
});

test("el error de una conexion que no existe no arrastra lo que le pasaron", async () => {
  const secreto = centinela("error");
  const proveedor = montar();
  await assert.rejects(
    () => proveedor.conectar({ projectId: "p", slug: "no-existe", valores: { pat: secreto } }),
    (e) => {
      assert.equal(trozoDelCentinela(`${e.message} ${e.causa} ${e.accion}`, secreto), null, "el error lleva el valor");
      return true;
    },
  );
});

test("la respuesta de `llamar` no devuelve el token con el que se llamo", async () => {
  const secreto = centinela("llamar");
  const proveedor = montar();
  const alta = await proveedor.conectar({ projectId: "p", slug: PAT, valores: { pat: secreto } });
  const respuesta = await proveedor.llamar({ conexionId: alta.conexion.id, metodo: "GET", ruta: "/perfil" });
  assert.equal(respuesta.estado, 200);
  assert.equal(trozoDelCentinela(respuesta, secreto), null, "la respuesta de `llamar` devolvio el token");
  assert.ok(
    !Object.keys(respuesta.cabeceras ?? {}).some((c) => /authorization/i.test(c)),
    "la cabecera de autorizacion volvio al que llamo",
  );
});
