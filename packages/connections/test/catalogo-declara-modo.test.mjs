// T150 · ningun proveedor del catalogo sin modo declarado.
//
// EL FALLO QUE EVITA. Un proveedor sin `modo` no falla al cargar: falla cuando
// alguien lo conecta, y falla en la rama equivocada —el codigo asume oauth2
// porque es lo que hace la mayoria— asi que el sintoma es una ventana del
// navegador que se abre para un PAT y una conexion que queda pendiente para
// siempre. La comprobacion va en la construccion del proveedor: un catalogo
// incompleto no llega a existir.

import { test } from "node:test";
import assert from "node:assert/strict";

import { CATALOGO_POR_DEFECTO, catalogoPorModo } from "../src/catalogo.mjs";
import { MODOS_AUTH, CLASES, validarEntradaDeCatalogo } from "../src/modelo.mjs";
import { crearProveedorDeConexiones } from "../src/proveedor.mjs";
import { crearAdaptadorFalso } from "../src/adaptadores/fake.mjs";
import { ErrorDeConexion } from "../src/errores.mjs";

test("EL INVARIANTE: cada entrada del catalogo por defecto declara su modo, y el modo es uno de los del contrato", () => {
  assert.ok(CATALOGO_POR_DEFECTO.length > 0, "el catalogo por defecto esta vacio");
  const sinModo = [];
  for (const entrada of CATALOGO_POR_DEFECTO) {
    const r = validarEntradaDeCatalogo(entrada);
    if (!r.ok) sinModo.push(`${entrada.slug ?? "?"}: ${r.problemas.join(", ")}`);
  }
  assert.deepEqual(sinModo, [], `hay entradas del catalogo sin declarar lo suyo:\n${sinModo.join("\n")}`);

  for (const entrada of CATALOGO_POR_DEFECTO) {
    assert.ok(MODOS_AUTH.includes(entrada.modo), `${entrada.slug} declara el modo ${entrada.modo}`);
    assert.ok(CLASES.includes(entrada.clase), `${entrada.slug} declara la clase ${entrada.clase}`);
  }
});

test("los dos objetivos que NO son oauth estan en el catalogo, y declarados como lo que son", () => {
  // Esto no es decoracion: es el hallazgo que gobierna el diseno. Si alguien
  // "corrige" el catalogo poniendolos en oauth2 porque le parece mas prolijo,
  // se rompe el reparto de adaptadores y el fallo aparece al conectarlos.
  const porSlug = Object.fromEntries(CATALOGO_POR_DEFECTO.map((p) => [p.slug, p]));
  assert.equal(porSlug["azure-devops"].modo, "basic", "verificado: se conecta con PAT por basic, no por oauth2");
  assert.equal(porSlug["vercel"].modo, "api_key", "verificado: se conecta con clave de API, no por oauth2");
  assert.notEqual(porSlug["azure-devops"].campos?.length, 0, "un modo que no es oauth2 necesita declarar sus campos");
  assert.notEqual(porSlug["vercel"].campos?.length, 0, "un modo que no es oauth2 necesita declarar sus campos");
});

test("una entrada sin modo no llega a construir un proveedor: falla al montar, no al conectar", () => {
  // La entrada esta COMPLETA salvo por el modo, a proposito: si le faltara
  // ademas el entorno o los campos, el rechazo podria venir de cualquiera de
  // las tres reglas y esta prueba no mediria la del modo. Se comprobo rompiendo
  // solo la comprobacion del modo: sin este cuidado, la prueba seguia en verde.
  const roto = [
    {
      slug: "sin-modo",
      nombre: "Sin modo",
      clase: "tracker",
      campos: [{ nombre: "pat", etiqueta: "Token", secreto: true, requerido: true }],
      entorno: { pat: "SIN_MODO_PAT" },
    },
  ];
  assert.throws(
    () => crearProveedorDeConexiones({ id: "roto", catalogo: roto, motor: motorInerte() }),
    (e) => {
      assert.ok(e instanceof ErrorDeConexion);
      assert.equal(e.codigo, "catalogo_invalido");
      assert.match(e.causa, /sin-modo/);
      assert.ok(e.accion, "rechazar el catalogo sin decir que declarar deja al que lo escribe adivinando");
      return true;
    },
  );
});

test("un modo que no es oauth2 sin campos tampoco monta: no habria nada que pedirle al operador", () => {
  const roto = [{ slug: "pat-sin-campos", nombre: "PAT sin campos", modo: "pat", clase: "scm" }];
  assert.throws(
    () => crearProveedorDeConexiones({ id: "roto", catalogo: roto, motor: motorInerte() }),
    (e) => e.codigo === "catalogo_invalido" && /pat-sin-campos/.test(e.causa),
  );
});

test("catalogoPorModo reparte por modo y no pierde a nadie", () => {
  const oauth = catalogoPorModo(CATALOGO_POR_DEFECTO, ["oauth2"]);
  const resto = catalogoPorModo(CATALOGO_POR_DEFECTO, ["pat", "api_key", "basic", "app"]);
  assert.equal(oauth.length + resto.length, CATALOGO_POR_DEFECTO.length, "hay proveedores que no caen en ningun reparto");
  assert.ok(oauth.length > 0 && resto.length > 0);
});

test("el catalogo que devuelve el proveedor no es el mismo objeto: nadie lo edita por la espalda", async () => {
  const proveedor = crearAdaptadorFalso();
  const primero = await proveedor.catalogo();
  const modoOriginal = primero[0].modo;
  assert.throws(
    () => {
      primero[0].modo = "modo-cambiado-en-caliente";
    },
    TypeError,
    "el catalogo salio mutable: quien lo recibe puede cambiar el camino de autenticacion de un proveedor",
  );
  const segundo = await proveedor.catalogo();
  assert.equal(segundo[0].modo, modoOriginal);
});

function motorInerte() {
  return {
    requisitos: () => [],
    salud: () => ({ arriba: true }),
    iniciar: async () => ({ handle: "h" }),
    guardar: async () => ({}),
    leer: async () => ({ valores: {} }),
    olvidar: async () => {},
    sondear: async () => null,
    llamar: async () => ({ estado: 200, cuerpo: null, cabeceras: {} }),
  };
}
