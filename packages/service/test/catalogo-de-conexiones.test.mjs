// `GET /v1/connections/catalog` — que se puede conectar, y quien lo va a
// atender.
//
// EL FALLO QUE EVITA, Y ES EL MOTIVO DE QUE ESTA RUTA EXISTA APARTE. Hoy el
// catalogo solo sale por `GET /v1/projects/:id/connections`, que exige un
// proyecto Y un proveedor de conexiones montado. O sea: para contestar «¿que
// puedo conectar?» —una pregunta de solo lectura— hacia falta tener ya elegido
// el adaptador. Y el adaptador de OAuth pide tres contenedores levantados. El
// operador que no puede o no quiere levantar Docker es justo aquel para el que
// existe el adaptador `local`, y no podia ni MIRAR la lista.
//
// LO OTRO QUE SE MIDE AQUI: que la respuesta no son mil elementos. El catalogo
// de Nango trae 1012 proveedores. Devolverlos de golpe es trasladarle el
// problema a quien dibuje la pantalla.

import { test } from "node:test";
import assert from "node:assert/strict";

import { conServicio, pedir, FRASE } from "./ayuda.mjs";
import { TABLA } from "../src/tabla.mjs";

const RUTA = "/v1/connections/catalog";

/** @param {any} svc @param {string} query */
async function catalogo(svc, query = "") {
  const r = await pedir(svc, `${RUTA}${query}`);
  const cuerpo = await r.json();
  return { estado: r.status, cuerpo };
}

test("la ruta esta en LA tabla: si no, la prueba del centinela no la recorre", () => {
  const entrada = TABLA.find((e) => e.patron === RUTA);
  assert.ok(entrada, "la ruta del catalogo no esta declarada en la tabla, asi que NFR-004 no la cubre");
  assert.deepEqual(entrada.metodos, ["GET", "HEAD"], "el catalogo se lee y nada mas: no hay nada que escribir aqui");
});

test("EL INVARIANTE: el catalogo se lee SIN proveedor de conexiones montado", async () => {
  // Sin `proveedorDeConexiones`: es el arranque por defecto de este servicio, y
  // es exactamente la situacion del operador que todavia no eligio adaptador.
  await conServicio({}, async (svc) => {
    const { estado, cuerpo } = await catalogo(svc);
    assert.equal(estado, 200, `el catalogo devolvio ${estado} sin adaptador montado: la pregunta era de solo lectura`);
    assert.ok(cuerpo.items.length > 0);
    assert.equal(cuerpo.adaptadores.montado, null);
    assert.ok(
      cuerpo.adaptadores.ausencia?.comoConseguirlo,
      "no hay adaptador y la respuesta no dice como conseguir uno: el operador ve una lista y no sabe que le falta",
    );
  });
});

test("la respuesta dice de donde salio el dato y cuando: es dato de otra empresa", async () => {
  await conServicio({}, async (svc) => {
    const { cuerpo } = await catalogo(svc);
    assert.match(cuerpo.procedencia.fuente, /nango\.dev/);
    assert.match(cuerpo.procedencia.descargado, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(cuerpo.procedencia.aviso, "sin el aviso, la pantalla presenta un dato copiado como si fuera en vivo");
  });
});

test("LA REGLA DE LOS 1012: la vista por defecto no devuelve mil, y avisa de que recorto", async () => {
  await conServicio({}, async (svc) => {
    const { cuerpo } = await catalogo(svc);
    assert.ok(cuerpo.items.length < 200, `devolvio ${cuerpo.items.length} elementos, que no es una interfaz`);
    assert.ok(cuerpo.total_catalogo > 900, "la respuesta no dice cuantos proveedores hay de verdad");
    assert.ok(cuerpo.total < cuerpo.total_catalogo);
    assert.equal(cuerpo.criterio, "baldas_del_ciclo");

    const aviso = cuerpo.avisos.find((/** @type {any} */ a) => a.codigo === "catalogo_recortado");
    assert.ok(aviso, "la lista se recorto sola y la respuesta no lo dice en ningun sitio");
    assert.match(aviso.accion, /q=|todos=/, "el aviso no dice como ver el resto: entonces el resto esta escondido");
  });
});

test("cada entrada dice QUE ADAPTADOR la atiende, que es lo que cambia el trabajo del operador", async () => {
  await conServicio({}, async (svc) => {
    const { cuerpo } = await catalogo(svc, "?q=vercel");
    const vercel = cuerpo.items.find((/** @type {any} */ e) => e.slug === "vercel");
    assert.ok(vercel);
    // Verificado contra el catalogo oficial: Vercel NO es OAuth. Si saliera con
    // adaptador `nango`, el operador levantaria tres contenedores y registraria
    // una aplicacion OAuth para guardar una clave de API.
    assert.equal(vercel.modo, "api_key");
    assert.equal(vercel.adaptador, "local");

    const ado = (await catalogo(svc, "?q=azure-devops")).cuerpo.items.find((/** @type {any} */ e) => e.slug === "azure-devops");
    assert.equal(ado.modo, "basic");
    assert.equal(ado.adaptador, "local");

    const linear = (await catalogo(svc, "?q=linear")).cuerpo.items.find((/** @type {any} */ e) => e.slug === "linear");
    assert.equal(linear.adaptador, "nango");
  });
});

test("se busca por nombre y se filtra por clase, modo y adaptador", async () => {
  await conServicio({}, async (svc) => {
    const buscado = await catalogo(svc, "?q=gmail");
    assert.ok(buscado.cuerpo.items.some((/** @type {any} */ e) => e.slug === "google-mail"));

    const scm = await catalogo(svc, "?clase=scm");
    assert.ok(scm.cuerpo.items.length > 1);
    for (const e of scm.cuerpo.items) assert.equal(e.clase, "scm");

    const local = await catalogo(svc, "?adaptador=local");
    for (const e of local.cuerpo.items) assert.equal(e.adaptador, "local");

    const basic = await catalogo(svc, "?modo=basic");
    for (const e of basic.cuerpo.items) assert.equal(e.modo, "basic");
  });
});

test("las facetas vienen contadas: es lo que convierte mil filas en cuatro botones", async () => {
  await conServicio({}, async (svc) => {
    const { cuerpo } = await catalogo(svc, "?todos=si");
    assert.equal(cuerpo.total, cuerpo.total_catalogo, "`todos=si` tiene que levantar el recorte a proposito");
    assert.ok(cuerpo.facetas.clase.tracker > 0 && cuerpo.facetas.clase.integracion > 0);
    assert.ok(cuerpo.facetas.adaptador.nango > 0 && cuerpo.facetas.adaptador.local > 0);
    assert.ok(cuerpo.facetas.adaptador.ninguno > 0);
  });
});

test("un filtro con un valor que no existe se rechaza diciendo cuales valen", async () => {
  // Aceptarlo y devolver el catalogo entero seria contestar otra pregunta. El
  // operador leeria la lista creyendo que filtro, y concluiria lo que no es.
  await conServicio({}, async (svc) => {
    const { estado, cuerpo } = await catalogo(svc, "?clase=trackr");
    assert.equal(estado, 400);
    assert.match(cuerpo.error.causa, /trackr/);
    assert.match(cuerpo.error.accion, /tracker/, "rechazar sin decir que valores existen deja al que llama adivinando");
  });
});

test("`limite` acota la pagina sin mentir sobre el total", async () => {
  await conServicio({}, async (svc) => {
    const { cuerpo } = await catalogo(svc, "?q=a&limite=5");
    assert.equal(cuerpo.items.length, 5);
    assert.equal(cuerpo.hay_mas, true);
    assert.ok(cuerpo.total > 5);
  });
});

test("el catalogo no lleva NINGUN valor de credencial, ni un sitio donde pudiera caber", async () => {
  // El centinela de NFR-004 ya recorre esta ruta por estar en la tabla. Esto
  // mide lo otro: que la forma de la respuesta no tenga campos donde alguien
  // pueda poner un valor mañana. Los `campos` que si viajan son DECLARACIONES
  // —nombre, etiqueta, si es secreto— y son lo que la pantalla dibuja.
  await conServicio({ frase: FRASE }, async (svc) => {
    const { cuerpo } = await catalogo(svc, "?todos=si&limite=1000");
    const texto = JSON.stringify(cuerpo);
    for (const prohibido of ['"valor"', "ref_boveda", "grant_id", "passphrase", "NOXLOOP_BOVEDA_FRASE"]) {
      assert.ok(!texto.includes(prohibido), `el catalogo devolvio \`${prohibido}\``);
    }
    const ado = cuerpo.items.find((/** @type {any} */ e) => e.slug === "azure-devops");
    assert.ok(
      ado.campos.some((/** @type {any} */ c) => c.nombre === "pat" && c.secreto === true),
      "sin los campos declarados, la pantalla no sabe que pedirle al operador ni cual es secreto",
    );
  });
});
