// El emparejador de rutas. Es el unico sitio del servicio donde un fallo se
// ve como "esa ruta no existe" y no como lo que es.
//
// POR QUE LO LITERAL TIENE QUE GANARLE A LO PARAMETRICO. El dia que exista
// `/v1/projects/nuevo`, `/v1/projects/:id` tambien empareja, y el orden de
// declaracion decidiria cual gana. Decidido por orden, el sintoma es que la
// ruta nueva "no funciona" y quien la escribio busca el fallo dentro de su
// manejador, que nunca se llamo.

import { test } from "node:test";
import assert from "node:assert/strict";

import { compilar, concretar, crearTabla, emparejar } from "../src/rutas.mjs";
import { TABLA } from "../src/tabla.mjs";

const manejar = () => ({ cuerpo: {} });

test("compilar saca los segmentos y los nombres de los parametros", () => {
  const c = compilar("/v1/snapshots/:id/findings/:finding_id");
  assert.deepEqual(c.segmentos, ["v1", "snapshots", ":id", "findings", ":finding_id"]);
  assert.deepEqual(c.parametros, ["id", "finding_id"]);
  assert.equal(c.literales, 3);
});

test("empareja capturando los parametros, y respeta los literales de en medio", () => {
  const tabla = crearTabla([
    { patron: "/v1/projects/:id/scan", metodos: ["POST"], manejar },
    { patron: "/v1/projects/:id/runs", metodos: ["GET"], manejar },
  ]);
  assert.equal(emparejar(tabla, "/v1/projects/abc/scan").entrada.patron, "/v1/projects/:id/scan");
  assert.equal(emparejar(tabla, "/v1/projects/abc/scan").parametros.id, "abc");
  assert.equal(emparejar(tabla, "/v1/projects/abc/runs").entrada.patron, "/v1/projects/:id/runs");
  assert.equal(emparejar(tabla, "/v1/projects/abc/otra-cosa"), null);
});

test("lo literal le gana a lo parametrico aunque se declare despues", () => {
  const tabla = crearTabla([
    { patron: "/v1/projects/:id", metodos: ["GET"], manejar },
    { patron: "/v1/projects/plantillas", metodos: ["GET"], manejar },
  ]);
  assert.equal(emparejar(tabla, "/v1/projects/plantillas").entrada.patron, "/v1/projects/plantillas");
  assert.equal(emparejar(tabla, "/v1/projects/abc").entrada.patron, "/v1/projects/:id");
});

test("un parametro vacio NO empareja: un id vacio es un 404 que no dice lo que pasa", () => {
  const tabla = crearTabla([{ patron: "/v1/projects/:id", metodos: ["GET"], manejar }]);
  assert.equal(emparejar(tabla, "/v1/projects/"), null);
  assert.equal(emparejar(tabla, "/v1/projects//"), null);
});

test("el parametro llega decodificado: un id con `/` codificado no parte la ruta", () => {
  const tabla = crearTabla([{ patron: "/v1/runs/:id", metodos: ["GET"], manejar }]);
  assert.equal(emparejar(tabla, "/v1/runs/T-1%2Fa").parametros.id, "T-1/a");
});

test("declarar la misma ruta dos veces revienta AL MONTAR, no al servir", () => {
  assert.throws(
    () =>
      crearTabla([
        { patron: "/v1/projects", metodos: ["GET"], manejar },
        { patron: "/v1/projects", metodos: ["POST"], manejar },
      ]),
    /dos veces/,
    "la segunda no se alcanzaria nunca y su metodo daria 405 sin que nadie entienda por que",
  );
});

test("una ruta sin manejador o sin metodos tampoco monta", () => {
  assert.throws(() => crearTabla([{ patron: "/v1/x", metodos: ["GET"], manejar: null }]), /manejador/);
  assert.throws(() => crearTabla([{ patron: "/v1/x", metodos: [], manejar }]), /metodos/);
});

test("`concretar` fabrica una URL pedible: es lo que deja que la prueba del centinela se enumere sola", () => {
  assert.equal(
    concretar("/v1/snapshots/:id/findings/:finding_id", { id: "sn1", finding_id: "hl2" }),
    "/v1/snapshots/sn1/findings/hl2",
  );
  // Un parametro que no se da cae en su propio nombre en vez de dejar `:id`
  // crudo: una URL con dos puntos adentro se pide igual y el 404 que devuelve
  // no dice que el test se olvido de un parametro.
  assert.equal(concretar("/v1/projects/:id", {}), "/v1/projects/id");
});

test("LA TABLA REAL: cada patron es unico, empareja consigo mismo y no deja metodos raros", () => {
  const METODOS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];
  const vistos = new Set();
  for (const entrada of TABLA) {
    assert.ok(!vistos.has(entrada.patron), `la tabla real declara \`${entrada.patron}\` dos veces`);
    vistos.add(entrada.patron);
    assert.match(entrada.patron, /^\/v1\//, `\`${entrada.patron}\` esta fuera de /v1: un cambio de version parte a los clientes`);
    for (const m of entrada.metodos) assert.ok(METODOS.includes(m), `\`${entrada.patron}\` declara el metodo \`${m}\``);

    const concreta = concretar(entrada.patron, {});
    const hallada = emparejar(TABLA, concreta);
    assert.ok(hallada, `\`${entrada.patron}\` no empareja con su propia URL concreta \`${concreta}\``);
  }
});
