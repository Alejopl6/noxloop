// El recorrido para registrar la aplicacion OAuth, que es el UNICO paso que el
// producto no puede dar por el operador.
//
// EL HECHO QUE OBLIGA A QUE ESTO EXISTA, medido contra una instancia propia de
// Nango 0.71.10 levantada con el compose de este repositorio:
//
//   - `GET /api/v1/providers` devuelve 1013 proveedores y `preConfigured:
//     false` en LOS 1013.
//   - `select count(*) from providers_shared_credentials` devuelve 0.
//   - `POST /api/v1/integrations {"provider":"github","useSharedCredentials":
//     true}` devuelve 400 `failed_to_create_preprovisioned_provider`.
//
// Las aplicaciones OAuth compartidas que Nango ofrece "con cero configuracion"
// viven en una tabla que la migracion crea VACIA y que solo escribe la API
// interna de Nango (`internalApi.route('/shared-credentials').post(...)`). En
// una instancia propia esa tabla no tiene filas y nunca las va a tener. Ademas
// la documentacion del propio Nango dice que sus aplicaciones compartidas
// "use Nango's callback" — el de `api.nango.dev`, que una instancia en
// `localhost:3003` no puede usar.
//
// Conclusion: registrar la aplicacion es un paso del operador. Lo que se puede
// construir —y es lo que hay aqui— es que ese paso sea CORTO y este guiado
// dentro del producto, con la URL que hay que abrir y la redirect URI que hay
// que pegar ya calculada. No un parrafo: una lista de pasos con datos dentro.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  REDIRECT_URI_POR_DEFECTO,
  SIN_APLICACIONES_COMPARTIDAS,
  recorridoDeRegistro,
  redirectUriDe,
} from "../src/aplicacion-oauth.mjs";
import { CATALOGO_POR_DEFECTO } from "../src/catalogo.mjs";

test("EL INVARIANTE: cada proveedor oauth2 del catalogo tiene su recorrido, con la URL que hay que abrir", () => {
  const oauth2 = CATALOGO_POR_DEFECTO.filter((e) => e.modo === "oauth2");
  assert.ok(oauth2.length >= 5, `el catalogo trae ${oauth2.length} proveedores oauth2: cambio de forma`);

  for (const entrada of oauth2) {
    const recorrido = recorridoDeRegistro(entrada.slug);
    assert.ok(recorrido, `'${entrada.slug}' es oauth2 y no tiene recorrido de registro`);
    assert.match(
      recorrido.url_de_registro,
      /^https:\/\//,
      `'${entrada.slug}': la URL donde se registra la aplicacion tiene que ser una direccion abrible`,
    );
    assert.ok(
      recorrido.pasos.length >= 3,
      `'${entrada.slug}': un recorrido de ${recorrido.pasos.length} pasos no es un recorrido`,
    );
    for (const paso of recorrido.pasos) {
      assert.ok(paso.titulo && paso.detalle, `'${entrada.slug}': un paso sin titulo o sin detalle no guia nada`);
    }
    assert.deepEqual(
      recorrido.campos_que_devuelve,
      ["client_id", "client_secret"],
      `'${entrada.slug}': lo que el operador trae de vuelta son esos dos valores y ningun otro`,
    );
  }
});

test("la redirect URI es la de ESTA instancia, no la de la nube del proveedor de integraciones", () => {
  // EL FALLO CONCRETO QUE ESTO CIERRA. La guia oficial de Nango para registrar
  // una aplicacion de GitHub dice, literal: «Enter `https://api.nango.dev/
  // oauth/callback`». Ese es el callback de SU nube. Un operador que sigue esa
  // guia con su instancia propia registra la redirect URI equivocada, y el
  // fallo no aparece al registrar: aparece al autorizar, con un error del
  // proveedor que habla de un `redirect_uri` que no coincide y no menciona
  // ninguna instancia ni ningun puerto.
  assert.equal(REDIRECT_URI_POR_DEFECTO, "http://localhost:3003/oauth/callback");
  assert.equal(redirectUriDe("http://localhost:3003"), "http://localhost:3003/oauth/callback");
  assert.equal(redirectUriDe("http://localhost:3003/"), "http://localhost:3003/oauth/callback");

  const recorrido = recorridoDeRegistro("github");
  const pegado = recorrido.pasos.map((p) => `${p.titulo} ${p.detalle} ${p.pegar ?? ""}`).join("\n");
  assert.ok(
    pegado.includes(REDIRECT_URI_POR_DEFECTO),
    "el recorrido no dice, con el valor dentro, que redirect URI hay que pegar",
  );
  assert.ok(
    !pegado.includes("api.nango.dev"),
    "el recorrido repite la redirect URI de la nube ajena, que es justo la que no funciona aqui",
  );
});

test("el paso que hay que pegar viaja como dato, no dentro de una frase", () => {
  // Una instruccion que dice «pega la direccion del callback» obliga a
  // construirla a mano. El valor exacto va en `pegar`, que es lo que la
  // pantalla pone detras de un boton de copiar.
  const recorrido = recorridoDeRegistro("github", { servidor: "http://localhost:3003" });
  const conPegar = recorrido.pasos.filter((p) => typeof p.pegar === "string" && p.pegar.length > 0);
  assert.ok(conPegar.length >= 1, "ningun paso trae el valor que hay que pegar como dato aparte");
  assert.ok(
    conPegar.some((p) => p.pegar === "http://localhost:3003/oauth/callback"),
    `ningun paso trae la redirect URI como valor copiable: ${JSON.stringify(conPegar)}`,
  );
});

test("el recorrido se recalcula con el servidor que de verdad esta escuchando", () => {
  const recorrido = recorridoDeRegistro("github", { servidor: "http://127.0.0.1:4003" });
  const pegado = recorrido.pasos.map((p) => p.pegar).filter(Boolean);
  assert.ok(
    pegado.includes("http://127.0.0.1:4003/oauth/callback"),
    `con otro servidor la redirect URI sigue siendo la de siempre: ${JSON.stringify(pegado)}`,
  );
});

test("un proveedor que no es oauth2 no tiene recorrido: no hay nada que registrar", () => {
  // Y NO ES UN HUECO. `github-pat` se conecta pegando un token personal: no
  // hay aplicacion OAuth, no hay redirect URI y no hay nada que registrar.
  // Devolver un recorrido vacio invitaria a la pantalla a dibujar tres pasos
  // que no llevan a ningun sitio.
  assert.equal(recorridoDeRegistro("github-pat"), null);
  assert.equal(recorridoDeRegistro("azure-devops"), null);
  assert.equal(recorridoDeRegistro("no-existe-este-proveedor"), null);
});

test("la constancia de que no hay aplicaciones compartidas viaja con su evidencia", () => {
  // Esto no es un comentario: es lo que la pantalla enseña cuando el operador
  // pregunta «¿por que tengo que registrar nada?». Sin la evidencia es una
  // afirmacion, y una afirmacion sin evidencia se discute cada seis meses.
  assert.equal(SIN_APLICACIONES_COMPARTIDAS.hay, false);
  assert.ok(
    SIN_APLICACIONES_COMPARTIDAS.evidencia.length >= 3,
    "la constancia trae menos de tres pruebas: una sola se explica con un error de configuracion",
  );
  for (const prueba of SIN_APLICACIONES_COMPARTIDAS.evidencia) {
    assert.ok(prueba.comprobacion && prueba.resultado, "una evidencia sin comprobacion ni resultado no prueba nada");
  }
  assert.ok(SIN_APLICACIONES_COMPARTIDAS.version, "sin la version de la instancia, la evidencia no caduca nunca");
});
