// T146 / NFR-004 — el centinela no aparece en NINGUNA respuesta de NINGUN
// endpoint, errores incluidos.
//
// POR QUE ES UNA PRUEBA DE SUITE Y NO UNA POR ENDPOINT. Una prueba por endpoint
// cubre los endpoints que alguien se acordo de cubrir. El que filtra es siempre
// el otro: el que se agrego el martes, el camino de error que nadie ejercio, el
// `fallo_interno` que arrastra el mensaje de una excepcion que llevaba el valor
// adentro. Por eso esta prueba ENUMERA las rutas desde el router —no desde una
// lista escrita a mano, que se queda vieja— y las pide todas, con exito y con
// error, serializando la respuesta ENTERA y buscando el valor dentro.
//
// POR QUE SOBRE LA RESPUESTA SERIALIZADA Y NO SOBRE LA INTENCION. Porque es lo
// que la constitution exige en el principio IX, palabra por palabra: "como todo
// invariante de este proyecto, se prueba sobre el objeto serializado con un
// valor centinela, no sobre la intencion". Un campo que no se puso es una
// promesa; un `JSON.stringify` que no lo contiene es un hecho.
//
// POR QUE TAMBIEN SE BUSCAN TROZOS. Contra un token con prefijo fijo, treinta
// caracteres del principio son casi todo lo que hace falta. Un redactor que
// corta el valor a la mitad y deja la cola suelta pasaria una comparacion
// exacta y filtraria igual.
//
// ES EL UNICO INVARIANTE SIN SEGUNDO INTENTO. Un gate mal configurado se
// corrige en el ciclo siguiente. Un secreto filtrado se rota, se audita y se
// explica.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { TABLA } from "../src/tabla.mjs";
import { concretar } from "../src/rutas.mjs";
import { conServicio, pedir, repoDePrueba, FRASE, TOKEN } from "./ayuda.mjs";

/**
 * El valor centinela. Improbable a proposito: si apareciera por casualidad en
 * una respuesta, el test dejaria de significar nada.
 */
const CENTINELA = "zqx7-CENTINELA-DE-LA-BOVEDA-NO-DEBE-SALIR-NUNCA-4f2a9c1e8b";

/** Los trozos que tambien se buscan. Un redactor que parte el valor filtra igual. */
const TROZOS = [CENTINELA, CENTINELA.slice(0, 32), CENTINELA.slice(0, 16), CENTINELA.slice(-24)];

/**
 * Todo lo que salio por el cable: cuerpo, cabeceras y linea de estado.
 *
 * Las CABECERAS entran a proposito. Un valor que se escapa por un `ETag`
 * calculado sobre la fila entera, o por un `Location`, sale igual de filtrado
 * que uno en el cuerpo, y una prueba que solo mira el cuerpo no lo ve.
 *
 * @param {Response} r
 */
async function todoLoQueSalio(r) {
  const cabeceras = {};
  for (const [k, v] of r.headers) cabeceras[k] = v;
  return JSON.stringify({ estado: r.status, cabeceras, cuerpo: await r.text() });
}

/** @param {string} texto @param {string} donde */
function exigirSinCentinela(texto, donde) {
  for (const trozo of TROZOS) {
    assert.ok(
      !texto.includes(trozo),
      `${donde} devolvio el valor de una credencial (o un trozo de ${trozo.length} caracteres de el).\n` +
        "Es el unico fallo de este producto sin segundo intento: un secreto filtrado se rota, se audita y se " +
        `explica.\nLo que salio:\n${texto.slice(0, 2000)}`,
    );
  }
}

/** Deja el servicio con un centinela adentro y devuelve los ids para concretar rutas. */
async function servicioCargado(svc) {
  const ruta = repoDePrueba();
  // El centinela tambien en el ARBOL del proyecto: el scanner lo va a leer, y
  // si algun detector lo arrastrara hasta un hallazgo, el snapshot lo publica.
  writeFileSync(join(ruta, ".env"), `TOKEN_DEL_GESTOR=${CENTINELA}\n`);
  writeFileSync(join(ruta, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));

  const proyecto = (
    await (
      await pedir(svc, "/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ origen: "local", nombre: "Con Centinela", ruta_local: ruta }),
      })
    ).json()
  ).proyecto;

  const alta = await (
    await pedir(svc, "/v1/credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nombre: "token-del-gestor",
        proveedor: "un-gestor-de-tickets",
        tipo: "api_token",
        alcance_declarado: "leer tickets",
        valor: CENTINELA,
      }),
    })
  ).json();
  assert.ok(alta.credencial, `no se pudo registrar la credencial: ${JSON.stringify(alta)}`);

  const agente = (
    await (
      await pedir(svc, `/v1/projects/${proyecto.id}/agents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nombre: "implementador", rol: "implementador", runtime: "runtime-a", modelo: "m" }),
      })
    ).json()
  ).agente;

  const grant = (
    await (
      await pedir(svc, "/v1/grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: proyecto.id,
          agent_id: agente.id,
          credential_id: alta.credencial.id,
          concedido_por: "la persona que decidio",
        }),
      })
    ).json()
  ).grant;

  // Un escaneo de verdad, para que el snapshot y sus hallazgos existan de
  // verdad cuando la prueba pida `/snapshot`.
  const scan = await (await pedir(svc, `/v1/projects/${proyecto.id}/scan`, { method: "POST" })).json();
  for (let i = 0; i < 400; i++) {
    const r = await pedir(svc, `/v1/projects/${proyecto.id}/snapshot`);
    if (r.status === 200) {
      const c = await r.json();
      if (c.snapshot && c.snapshot.estado !== "en_curso") {
        return {
          proyecto,
          credencial: alta.credencial,
          agente,
          grant,
          snapshot: c.snapshot,
          hallazgo: c.items[0] ?? null,
          scan,
        };
      }
    } else {
      await r.text();
    }
    await new Promise((listo) => setTimeout(listo, 25));
  }
  throw new Error("el snapshot no termino a tiempo y la prueba se quedaria sin snapshot que pedir");
}

test("la tabla de rutas se puede enumerar sola: si no, esta prueba no cubre nada", () => {
  assert.ok(TABLA.length > 20, `la tabla trae ${TABLA.length} rutas: o el servicio encogio o dejo de declararlas`);
  for (const entrada of TABLA) {
    assert.equal(typeof entrada.patron, "string");
    assert.ok(Array.isArray(entrada.metodos) && entrada.metodos.length > 0);
    assert.ok(Array.isArray(entrada.parametros), "sin los parametros declarados no se puede fabricar la URL");
  }
});

test("T146 — EL INVARIANTE: el centinela no sale por NINGUNA ruta, ni con exito ni con error", async () => {
  await conServicio({ frase: FRASE }, async (svc) => {
    const ids = await servicioCargado(svc);

    // Dos juegos de parametros: los REALES —que dan las respuestas con datos
    // dentro— y unos inventados, que dan los caminos de 404 y de validacion.
    // Los segundos importan igual: el mensaje de un error es texto que se
    // persiste y que viaja, y el principio IX nombra los errores explicitamente
    // entre los sitios donde el valor no puede estar.
    const juegos = [
      {
        que: "con ids reales",
        valores: {
          id: ids.proyecto.id,
          snapshot_id: ids.scan.snapshot_id,
          finding_id: ids.hallazgo ? ids.hallazgo.id : "sin-hallazgos",
          area: "seguridad",
        },
      },
      {
        que: "con ids que no existen",
        // El centinela va EN EL PROPIO ID: si alguna ruta devuelve el id que le
        // llego dentro de su mensaje de error —que es lo normal y correcto—,
        // esta es la forma de comprobar que nadie lo confunde con un valor.
        valores: { id: "no-existe", snapshot_id: "no-existe", finding_id: "no-existe", area: "no-existe" },
      },
    ];

    // Cuerpos que tambien llevan el centinela: uno de los caminos por los que un
    // valor vuelve es el eco de lo que se mando en un error de validacion.
    const cuerpos = [
      "",
      JSON.stringify({ valor: CENTINELA, nombre: CENTINELA, motivo: CENTINELA, contenido: CENTINELA }),
      "{ esto no es json",
    ];

    let pedidas = 0;
    for (const juego of juegos) {
      for (const entrada of TABLA) {
        // El canal de eventos es un stream que no termina: se prueba aparte,
        // abajo, en vez de colgar este recorrido para siempre.
        if (entrada.crudo) continue;
        const ruta = concretar(entrada.patron, juego.valores);
        for (const metodo of entrada.metodos) {
          for (const cuerpo of metodo === "GET" || metodo === "HEAD" || metodo === "DELETE" ? [""] : cuerpos) {
            const r = await pedir(svc, ruta, {
              method: metodo,
              headers: { "content-type": "application/json" },
              ...(cuerpo ? { body: cuerpo } : {}),
            });
            exigirSinCentinela(await todoLoQueSalio(r), `${metodo} ${ruta} (${juego.que})`);
            pedidas++;
          }
        }
      }
    }

    assert.ok(pedidas > 100, `solo se pidieron ${pedidas} respuestas: el recorrido dejo de recorrer`);
  });
});

test("T146, los caminos de la puerta: 401, 403 y 404 tampoco lo llevan", async () => {
  await conServicio({ frase: FRASE }, async (svc) => {
    await servicioCargado(svc);

    const sinToken = await fetch(`${svc.url}/v1/credentials`, { headers: { origin: "tauri://localhost" } });
    exigirSinCentinela(await todoLoQueSalio(sinToken), "401 sin token");

    const otroOrigen = await fetch(`${svc.url}/v1/credentials`, {
      headers: { origin: "https://otra-pestana.invalid", "x-noxloop-token": TOKEN },
    });
    exigirSinCentinela(await todoLoQueSalio(otroOrigen), "403 origen no permitido");

    const noExiste = await pedir(svc, `/v1/lo-que-no-existe/${encodeURIComponent(CENTINELA)}`);
    exigirSinCentinela(await todoLoQueSalio(noExiste), "404 ruta desconocida");

    const metodoMalo = await pedir(svc, "/v1/audit", { method: "DELETE" });
    exigirSinCentinela(await todoLoQueSalio(metodoMalo), "405 metodo no permitido");
  });
});

test("T146, el canal de eventos: lo que se emite mientras corre un escaneo tampoco lo lleva", async () => {
  await conServicio({ frase: FRASE }, async (svc) => {
    const ruta = repoDePrueba();
    writeFileSync(join(ruta, ".env"), `TOKEN=${CENTINELA}\n`);
    const proyecto = (
      await (
        await pedir(svc, "/v1/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ origen: "local", nombre: "Eventos Con Centinela", ruta_local: ruta }),
        })
      ).json()
    ).proyecto;

    const canal = await pedir(svc, "/v1/events");
    await pedir(svc, `/v1/projects/${proyecto.id}/scan`, { method: "POST" });

    const { leerFrames, eventos } = await import("./ayuda.mjs");
    const frames = await leerFrames(canal, (f) => eventos(f).some((e) => e.tipo === "scan.terminado"), 20000);
    exigirSinCentinela(JSON.stringify(frames), "el canal de eventos durante un escaneo");
  });
});

test("la prueba discrimina: el mismo recorrido SI encuentra un centinela plantado", async () => {
  // El control. Sin el, "no aparece en ningun sitio" puede significar que el
  // recorrido no estaba mirando: una asercion que nunca falla y una que no se
  // ejecuta se ven igual desde el informe de tests.
  await conServicio({}, async (svc) => {
    const r = await pedir(svc, "/v1/health");
    const salida = await todoLoQueSalio(r);
    assert.throws(
      () => exigirSinCentinela(salida + CENTINELA, "un centinela plantado a mano"),
      /sin segundo intento/,
      "la comprobacion no detecta el centinela ni cuando esta: el recorrido entero no prueba nada",
    );
  });
});
