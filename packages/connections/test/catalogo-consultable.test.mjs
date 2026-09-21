// El catalogo consultable: lo que hace que 1012 proveedores sean una interfaz
// y no una lista de mil elementos.
//
// LAS DOS COSAS QUE ESTE ARCHIVO SOSTIENE, Y LAS DOS SON FALLOS DE VERDAD.
//
//   1. QUE ADAPTADOR LO ATIENDE, ANTES DE ELEGIR. `nango` pide tres
//      contenedores levantados y una aplicacion OAuth registrada a mano con el
//      proveedor; `local` pide pegar un token. Son dos tardes distintas. Un
//      catalogo que no lo dice deja al operador eligiendo a ciegas y
//      descubriendolo cuando pulsa conectar — y peor: `azure-devops` y
//      `vercel` PARECEN OAuth como el resto y no lo son.
//   2. QUE UNA LISTA DE MIL NO SE ENSENA. Devolver los 1012 de golpe es
//      trasladarle el problema al operador. Lo que el ciclo 00-07 necesita son
//      tres conexiones —tracker, SCM e infraestructura— y eso es lo que va
//      delante. El resto existe, se encuentra buscando, y no ocupa la pantalla.

import { test } from "node:test";
import assert from "node:assert/strict";

import { PROVEEDORES_DE_NANGO } from "../src/catalogo-nango.mjs";
import { CATALOGO_POR_DEFECTO } from "../src/catalogo.mjs";
import {
  construirCatalogoConsultable,
  consultar,
  adaptadorDe,
  ESTANTES,
  SCM_DECLARADO,
} from "../src/catalogo-consultable.mjs";

const CATALOGO = construirCatalogoConsultable();
const porSlug = Object.fromEntries(CATALOGO.map((e) => [e.slug, e]));

test("el catalogo consultable cubre TODO el catalogo de Nango, no una seleccion", () => {
  assert.ok(CATALOGO.length >= PROVEEDORES_DE_NANGO.length, "se perdieron proveedores al construirlo");
  for (const p of PROVEEDORES_DE_NANGO) {
    assert.ok(porSlug[p.slug], `'${p.slug}' esta en el catalogo de Nango y no en el consultable`);
  }
});

test("los siete proveedores propios quedan marcados como conectables aqui y ahora", () => {
  for (const propio of CATALOGO_POR_DEFECTO) {
    const e = porSlug[propio.slug];
    assert.ok(e, `'${propio.slug}' es un proveedor propio y no aparece en el catalogo consultable`);
    assert.equal(e.curado, true, `'${propio.slug}' es propio y no esta marcado como tal`);
    assert.equal(e.modo, propio.modo, "la entrada propia manda sobre lo derivado: es la que ya esta verificada");
    assert.equal(e.clase, propio.clase, "la clase declarada a mano gana a la derivada de las categorias de Nango");
    assert.ok(Array.isArray(e.campos) || propio.modo === "oauth2", "sin campos no hay formulario que dibujar");
  }
});

test("EL INVARIANTE QUE MAS CUESTA SI FALTA: cada entrada dice que adaptador la atiende", () => {
  // `azure-devops` y `vercel` son los dos que rompen el supuesto. Si alguno
  // apareciera con adaptador `nango`, el operador levantaria tres contenedores
  // para guardar un token que cabe en el llavero — y el flujo no existiria.
  assert.equal(porSlug["azure-devops"].adaptador, "local");
  assert.equal(porSlug["azure-devops"].modo, "basic");
  assert.equal(porSlug.vercel.adaptador, "local");
  assert.equal(porSlug.vercel.modo, "api_key");

  assert.equal(porSlug.linear.adaptador, "nango");
  assert.equal(porSlug.jira.adaptador, "nango");
  assert.equal(porSlug.github.adaptador, "nango");
  assert.equal(porSlug.slack.adaptador, "nango");
  assert.equal(porSlug.notion.adaptador, "nango");
});

test("el reparto de adaptadores es una consecuencia del modo y de nada mas", () => {
  assert.equal(adaptadorDe("oauth2"), "nango");
  assert.equal(adaptadorDe("api_key"), "local");
  assert.equal(adaptadorDe("basic"), "local");
  assert.equal(adaptadorDe("pat"), "local");
  assert.equal(adaptadorDe("app"), "local");
  assert.equal(adaptadorDe(null), null, "sin modo no hay adaptador, y decir uno seria mandar al operador a la nada");

  for (const e of CATALOGO) {
    assert.equal(e.adaptador, adaptadorDe(e.modo), `'${e.slug}' dice '${e.adaptador}' y su modo '${e.modo}' pide otro`);
    assert.equal(e.soportado, e.adaptador !== null);
  }
});

test("lo que ningun adaptador atiende se marca apagado y DICE POR QUE", () => {
  const apagados = CATALOGO.filter((e) => !e.soportado);
  assert.ok(apagados.length > 100, `solo ${apagados.length} apagados: el mapeo se volvio permisivo`);
  for (const e of apagados) {
    assert.equal(e.adaptador, null);
    assert.ok(e.motivo && e.motivo.length > 10, `'${e.slug}' esta apagado sin motivo: una fila gris sin explicacion`);
  }
  // Y ninguno de los atendidos arrastra un motivo: un motivo en algo que
  // funciona es ruido que la pantalla tiene que aprender a ignorar.
  for (const e of CATALOGO.filter((x) => x.soportado)) assert.equal(e.motivo, null);
});

test("SCM no es una categoria de Nango: la lista es nuestra y se declara como tal", () => {
  // Nango mete GitHub, GitLab, Bitbucket y Gerrit en `dev-tools`, junto con
  // Datadog y Vercel. Derivar `scm` de las categorias es imposible, asi que la
  // lista se declara a mano — y entonces hay que comprobar que no se pudre:
  // un slug que ya no existe en el origen es una regla que no se aplica a nadie.
  const enNango = new Set(PROVEEDORES_DE_NANGO.map((p) => p.slug));
  const fantasmas = SCM_DECLARADO.filter((s) => !enNango.has(s));
  assert.deepEqual(fantasmas, [], "hay slugs declarados como SCM que ya no estan en el catalogo de Nango");
  for (const slug of SCM_DECLARADO) {
    const e = porSlug[slug];
    if (CATALOGO_POR_DEFECTO.some((c) => c.slug === slug)) continue;
    assert.equal(e.clase, "scm", `'${slug}' esta declarado SCM y salio como '${e.clase}'`);
  }
  assert.ok(SCM_DECLARADO.includes("gitlab") && SCM_DECLARADO.includes("bitbucket"));
});

test("las categorias de Nango se traducen a las cuatro clases del contrato", () => {
  const clases = new Set(CATALOGO.map((e) => e.clase));
  assert.deepEqual([...clases].sort(), ["infra", "integracion", "scm", "tracker"]);
  // `ticketing` gana a `dev-tools`: un gestor de tickets es un tracker aunque
  // ademas sea una herramienta de desarrollo.
  assert.equal(porSlug["jira-basic"].clase, "tracker");
  assert.equal(porSlug.sentry.clase, "infra");
});

// ---------------------------------------------------------------------------
// La consulta
// ---------------------------------------------------------------------------

test("LA REGLA DE LOS 1012: la vista por defecto NO devuelve mil elementos, Y NO LO ESCONDE", () => {
  const r = consultar(CATALOGO, {});
  assert.ok(r.items.length < 200, `la vista por defecto devolvio ${r.items.length} elementos, que no es una interfaz`);
  assert.ok(r.items.length > 0);
  assert.ok(r.total < CATALOGO.length, "la vista por defecto no recorto nada: entonces no hay regla");

  // LOS DOS NUMEROS, Y POR QUE HACEN FALTA LOS DOS. `total` es lo que encaja
  // con lo que se pidio; `total_catalogo` es cuantos hay en total. Con uno
  // solo, o la pantalla dice 138 y el operador cree que eso es todo lo que
  // existe, o dice 1012 y no entiende por que ve 60. Y `criterio` es lo que le
  // permite decir en voz alta que la lista se recorto sola.
  assert.equal(r.total_catalogo, CATALOGO.length, "la respuesta no dice cuantos proveedores hay de verdad");
  assert.equal(r.criterio, "baldas_del_ciclo");
});

test("delante va lo que el ciclo 00-07 necesita: tracker, SCM e infraestructura", () => {
  const r = consultar(CATALOGO, {});
  for (const e of r.items) {
    assert.ok(e.soportado, `'${e.slug}' sale en la vista por defecto y ningun adaptador lo atiende`);
    // Las integraciones van detras de una busqueda, SALVO las propias: Slack y
    // Notion son de clase `integracion` y estan entre los siete que se pueden
    // conectar hoy. Esconderlas por su clase seria esconder producto terminado.
    assert.ok(
      e.curado || e.clase !== "integracion",
      `'${e.slug}' es una integracion ajena al ciclo y sale en la vista por defecto`,
    );
  }
  // Y los propios van primero de todo: son los unicos donde pulsar conectar
  // hace algo hoy.
  assert.equal(r.items[0].curado, true);
  assert.equal(r.items[0].estante, ESTANTES.CURADO);
});

test("lo que no sale por defecto se encuentra buscando: existe, no esta escondido", () => {
  const porDefecto = consultar(CATALOGO, {});
  assert.ok(!porDefecto.items.some((e) => e.slug === "google-mail"), "Gmail no es del ciclo: no va delante");

  const buscado = consultar(CATALOGO, { texto: "gmail" });
  assert.ok(
    buscado.items.some((e) => e.slug === "google-mail"),
    "buscar 'gmail' no encuentra Gmail: el resto del catalogo quedaria inalcanzable",
  );
});

test("la busqueda mira el nombre Y el slug, y no distingue mayusculas", () => {
  for (const texto of ["VERCEL", "vercel", "Vercel"]) {
    const r = consultar(CATALOGO, { texto });
    assert.ok(r.items.some((e) => e.slug === "vercel"), `buscar '${texto}' no encuentra Vercel`);
  }
  // Por slug: el operador que copia un slug de la documentacion de Nango.
  const porSlugBuscado = consultar(CATALOGO, { texto: "azure-devops" });
  assert.ok(porSlugBuscado.items.some((e) => e.slug === "azure-devops"));
});

test("buscar tambien alcanza lo que ningun adaptador atiende, y lo devuelve apagado", () => {
  // Esconder lo no soportado seria peor que mostrarlo: el operador busca
  // Snowflake, no lo encuentra, y concluye que no existe en vez de leer por que
  // no se puede conectar todavia.
  const r = consultar(CATALOGO, { texto: "snowflake" });
  assert.ok(r.items.length > 0, "buscar un proveedor que existe y no se atiende no devuelve nada");
  const jwt = r.items.find((e) => e.nango === "JWT");
  assert.ok(jwt, "el proveedor con modo JWT no aparece al buscarlo");
  assert.equal(jwt.soportado, false);
  assert.ok(jwt.motivo);
});

test("se filtra por clase, por modo y por adaptador, y los tres se combinan", () => {
  const scm = consultar(CATALOGO, { clase: "scm" });
  assert.ok(scm.items.length > 1);
  for (const e of scm.items) assert.equal(e.clase, "scm");

  const local = consultar(CATALOGO, { adaptador: "local" });
  assert.ok(local.items.length > 1);
  for (const e of local.items) assert.equal(e.adaptador, "local");

  const basic = consultar(CATALOGO, { modo: "basic" });
  for (const e of basic.items) assert.equal(e.modo, "basic");

  const combinado = consultar(CATALOGO, { clase: "scm", adaptador: "local" });
  assert.ok(combinado.total <= scm.total);
  for (const e of combinado.items) assert.ok(e.clase === "scm" && e.adaptador === "local");
});

test("un filtro explicito levanta la regla de la vista por defecto: pedir integraciones las trae", () => {
  const r = consultar(CATALOGO, { clase: "integracion" });
  assert.ok(r.items.length > 0, "pedir la clase `integracion` a proposito y no recibir nada es una pantalla rota");
  for (const e of r.items) assert.equal(e.clase, "integracion");
});

test("las facetas son lo que convierte mil en una interfaz: se cuentan, no se dibujan", () => {
  const r = consultar(CATALOGO, { texto: "" , clase: null, todos: true });
  assert.equal(r.total, CATALOGO.length);
  assert.ok(r.facetas.clase.tracker > 0 && r.facetas.clase.integracion > 0);
  assert.ok(r.facetas.adaptador.nango > 0 && r.facetas.adaptador.local > 0);
  assert.ok(r.facetas.adaptador.ninguno > 0, "sin contar los que no se atienden, el total de facetas no cuadra");
  const suma = Object.values(r.facetas.clase).reduce((a, b) => a + b, 0);
  assert.equal(suma, CATALOGO.length, "las facetas de clase no suman el total: hay entradas que no se cuentan");
});

test("`limite` acota lo que sale, y `hay_mas` dice que quedo fuera SIN mentir sobre el total", () => {
  const r = consultar(CATALOGO, { texto: "a", limite: 5 });
  assert.equal(r.items.length, 5);
  assert.equal(r.hay_mas, true);
  assert.ok(r.total > 5, "el total tiene que seguir siendo el de la consulta entera, no el de la pagina");
  assert.equal(r.mostrados, 5);

  const grande = consultar(CATALOGO, { texto: "a", limite: 100000 });
  assert.equal(grande.hay_mas, false);
  assert.ok(grande.items.length <= grande.total);
});

test("una consulta que no encuentra nada lo dice con ceros, no con un error", () => {
  const r = consultar(CATALOGO, { texto: "zzzz-no-existe-ningun-proveedor-asi" });
  assert.equal(r.total, 0);
  assert.deepEqual(r.items, []);
  assert.equal(r.hay_mas, false);
});

test("lo que sale de la consulta esta congelado y no lleva credenciales de nadie", () => {
  const r = consultar(CATALOGO, { texto: "vercel" });
  assert.throws(() => {
    r.items[0].adaptador = "nango";
  }, TypeError);
  const texto = JSON.stringify(r);
  for (const prohibido of ["ref_boveda", "grant_id", "valor\":", "passphrase"]) {
    assert.ok(!texto.includes(prohibido), `la consulta devolvio '${prohibido}'`);
  }
});

test("construir con un catalogo de Nango vacio sigue devolviendo lo propio: la interfaz no se queda en blanco", () => {
  // El dato empotrado envejece y algun dia alguien lo va a regenerar mal. Lo
  // que NO puede pasar es que la pantalla de conexiones se quede vacia: los
  // siete propios no dependen de Nango para existir.
  const soloPropios = construirCatalogoConsultable({ nango: [] });
  assert.equal(soloPropios.length, CATALOGO_POR_DEFECTO.length);
  for (const e of soloPropios) {
    assert.equal(e.curado, true);
    assert.equal(e.en_nango, false);
  }
  assert.ok(consultar(soloPropios, {}).items.length > 0);
});
