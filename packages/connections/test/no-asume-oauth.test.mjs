// T151 · con un proveedor de modo `pat`, `conectar` NO devuelve URL de
// autorizacion.
//
// EL FALLO QUE EVITA, Y QUE NO ES HIPOTETICO. Si la interfaz fuera
// `OAuthProvider`, `conectar` devolveria siempre una URL y la aplicacion la
// abriria siempre en el navegador. Con Azure DevOps —que se conecta con un PAT—
// eso abre una pestana que no lleva a ningun sitio y deja la conexion esperando
// una autorizacion que nadie va a dar. El operador ve "conectando..." para
// siempre y ningun log dice que el modo era otro.
//
// Por eso la regla se mide sobre la FORMA del resultado: no basta con que la
// URL sea nula, la propiedad no puede estar.

import { test } from "node:test";
import assert from "node:assert/strict";

import { crearAdaptadorFalso, CATALOGO_FALSO } from "../src/adaptadores/fake.mjs";
import { MODOS_SIN_AUTORIZACION } from "../src/modelo.mjs";

test("EL INVARIANTE: con modo `pat`, conectar no devuelve URL de autorizacion", async () => {
  const proveedor = crearAdaptadorFalso();
  const pat = CATALOGO_FALSO.find((p) => p.modo === "pat");
  assert.ok(pat, "el catalogo falso dejo de tener un proveedor de modo pat: esta prueba no mide nada");

  const resultado = await proveedor.conectar({
    projectId: "proyecto-1",
    slug: pat.slug,
    valores: { pat: "un-pat-cualquiera" },
  });

  assert.ok(!("url" in resultado), `conectar devolvio una URL para un modo ${pat.modo}: ${resultado.url}`);
  assert.ok(!("abrir_en" in resultado), "conectar dijo donde abrir algo que no hay que abrir");
  assert.ok(resultado.handle, "sin handle no hay forma de seguir la conexion");
  assert.equal(resultado.conexion.estado, "conectada", "un PAT no espera a nadie: queda listo de inmediato");
});

test("ningun modo sin autorizacion devuelve URL, y todos quedan listos de inmediato", async () => {
  const proveedor = crearAdaptadorFalso();
  for (const entrada of CATALOGO_FALSO.filter((p) => MODOS_SIN_AUTORIZACION.includes(p.modo))) {
    const valores = Object.fromEntries(entrada.campos.map((c) => [c.nombre, `valor-de-${c.nombre}`]));
    const resultado = await proveedor.conectar({ projectId: "proyecto-1", slug: entrada.slug, valores });
    assert.ok(!("url" in resultado), `${entrada.slug} (${entrada.modo}) devolvio URL`);
    assert.equal(resultado.conexion.estado, "conectada", `${entrada.slug} quedo pendiente sin nada que esperar`);
  }
});

test("con modo oauth2 SI hay URL: la regla no es 'nunca hay URL', es que la decide el catalogo", async () => {
  const proveedor = crearAdaptadorFalso();
  const oauth = CATALOGO_FALSO.find((p) => p.modo === "oauth2");
  const resultado = await proveedor.conectar({ projectId: "proyecto-1", slug: oauth.slug });
  assert.ok(resultado.url, "sin URL el operador no tiene como autorizar");
  assert.equal(resultado.conexion, undefined, "una conexion oauth2 no puede estar lista antes de que nadie autorice");
});

test("quien llama no puede imponer el modo: el catalogo es quien manda", async () => {
  // El camino por el que la regla se pierde en silencio: alguien agrega
  // `modo` al request "para el caso raro", y a partir de ahi hay dos fuentes de
  // verdad. La que gana es la del que llama, que es la que no sabe.
  const proveedor = crearAdaptadorFalso();
  const pat = CATALOGO_FALSO.find((p) => p.modo === "pat");
  await assert.rejects(
    () => proveedor.conectar({ projectId: "p", slug: pat.slug, modo: "oauth2", valores: { pat: "x" } }),
    (e) => {
      assert.equal(e.codigo, "modo_impuesto");
      assert.ok(e.accion, "rechazar sin decir que hacer empuja a que el siguiente lo intente de otra forma");
      return true;
    },
  );
});

test("a un proveedor oauth2 no se le pasan valores: no hay ningun campo que rellenar", async () => {
  const proveedor = crearAdaptadorFalso();
  const oauth = CATALOGO_FALSO.find((p) => p.modo === "oauth2");
  await assert.rejects(
    () => proveedor.conectar({ projectId: "p", slug: oauth.slug, valores: { token: "pegado-a-mano" } }),
    (e) => e.codigo === "valores_inesperados" && Boolean(e.accion),
  );
});

test("a un modo que no es oauth2 le faltan campos: lo dice nombrandolos", async () => {
  const proveedor = crearAdaptadorFalso();
  const pat = CATALOGO_FALSO.find((p) => p.modo === "pat");
  await assert.rejects(
    () => proveedor.conectar({ projectId: "p", slug: pat.slug, valores: {} }),
    (e) => {
      assert.equal(e.codigo, "campos_incompletos");
      assert.match(e.causa, /pat/, "el error no nombra el campo que falta: el operador tiene que adivinarlo");
      return true;
    },
  );
});
