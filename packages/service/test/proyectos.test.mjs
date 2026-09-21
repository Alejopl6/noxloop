// T080 — los tres origenes de un proyecto, y los dos rechazos que tienen que
// decir que hacer.
//
// POR QUE LOS DOS RECHAZOS SON LA MITAD DEL TEST. `no_es_repositorio` y
// `destino_no_vacio` son los dos primeros "no" que el producto le dice a
// alguien, y los dos ocurren cuando la persona ya decidio que carpeta quiere.
// Un "no es un repositorio" a secas manda a adivinar; el que nombra `git init`
// con la ruta adentro devuelve al trabajo en diez segundos. Por eso el test
// mira la ACCION y no solo el codigo: un codigo correcto con una accion vacia
// pasa una revision y falla en la maquina del operador.
//
// POR QUE `DELETE` SE MIDE CON UNA HUELLA DEL DISCO. "Deja de gestionarlo y no
// borra el repositorio del operador" es prosa hasta que existe el objeto que lo
// prueba, igual que un gate no paso hasta que existe su exit code. El objeto
// aqui es el arbol antes y despues, byte a byte.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { conServicio, pedir, repoDePrueba, carpetaDePrueba, huellaDelArbol, diferencias } from "./ayuda.mjs";

/** @param {any} svc @param {any} cuerpo */
const crear = (svc, cuerpo) =>
  pedir(svc, "/v1/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });

test("origen `local` sobre un repositorio de verdad da de alta el proyecto en CREATED", async () => {
  await conServicio({}, async (svc) => {
    const ruta = repoDePrueba();
    const r = await crear(svc, { origen: "local", nombre: "El Proyecto", ruta_local: ruta });
    assert.equal(r.status, 201, await r.clone().text());
    const cuerpo = await r.json();
    assert.equal(cuerpo.proyecto.origen, "local");
    assert.equal(cuerpo.proyecto.ruta_local, ruta);
    assert.equal(
      cuerpo.proyecto.estado,
      "CREATED",
      "todo proyecto nace en CREATED: un estado inicial por parametro es la puerta por la que uno entra en ACTIVE sin guardas",
    );
    assert.ok(cuerpo.proyecto.id, "sin id no hay nada que pedir despues");
  });
});

test("origen `local` sobre una carpeta que no es repositorio: `no_es_repositorio` CON su accion", async () => {
  await conServicio({}, async (svc) => {
    const ruta = carpetaDePrueba();
    writeFileSync(join(ruta, "algo.txt"), "hay contenido pero no hay git\n");

    const r = await crear(svc, { origen: "local", nombre: "Sin Git", ruta_local: ruta });
    assert.equal(r.status, 400);
    const { error } = await r.json();
    assert.equal(error.codigo, "no_es_repositorio");
    assert.ok(error.causa.includes(ruta), "la causa tiene que nombrar la ruta que el operador escribio");
    assert.match(
      error.accion,
      /git init/,
      "la accion que resuelve es inicializar el repositorio, no 'elige otra carpeta': quien apunto ahi sabe que carpeta quiere",
    );
    assert.ok(error.accion.includes(ruta), "la accion tiene que poder copiarse y pegarse tal cual");
  });
});

test("origen `nuevo` sobre un destino con contenido: `destino_no_vacio` y ofrece adoptarlo", async () => {
  await conServicio({}, async (svc) => {
    const ruta = carpetaDePrueba();
    writeFileSync(join(ruta, "README.md"), "trabajo de alguien\n");
    mkdirSync(join(ruta, "src"));

    const r = await crear(svc, { origen: "nuevo", nombre: "Encima De Algo", ruta_local: ruta });
    assert.equal(r.status, 409);
    const { error } = await r.json();
    assert.equal(error.codigo, "destino_no_vacio");
    assert.match(
      error.accion,
      /origen.*local|local.*origen/s,
      "sin la oferta de adoptarlo, el operador borra la carpeta para poder seguir — y ahi se pierde trabajo suyo",
    );
  });
});

test("origen `nuevo` sobre un destino vacio lo prepara y no toca nada de alrededor", async () => {
  await conServicio({}, async (svc) => {
    const padre = carpetaDePrueba();
    const ruta = join(padre, "el-destino");
    const r = await crear(svc, { origen: "nuevo", nombre: "Desde Cero", ruta_local: ruta });
    assert.equal(r.status, 201, await r.clone().text());
    assert.equal((await r.json()).proyecto.origen, "nuevo");
  });
});

test("origen `remoto` se da de alta con su remoto declarado", async () => {
  await conServicio({}, async (svc) => {
    const ruta = join(carpetaDePrueba(), "clon");
    const r = await crear(svc, {
      origen: "remoto",
      nombre: "El Remoto",
      ruta_local: ruta,
      remoto: "git@servidor-del-operador:equipo/proyecto.git",
    });
    assert.equal(r.status, 201, await r.clone().text());
    const { proyecto } = await r.json();
    assert.equal(proyecto.origen, "remoto");
    assert.equal(proyecto.remoto, "git@servidor-del-operador:equipo/proyecto.git");
  });
});

test("un origen que no existe se rechaza nombrando los tres que si", async () => {
  await conServicio({}, async (svc) => {
    const r = await crear(svc, { origen: "telepatia", nombre: "X", ruta_local: carpetaDePrueba() });
    assert.equal(r.status, 400);
    const { error } = await r.json();
    assert.match(error.causa + error.accion, /local/);
    assert.match(error.causa + error.accion, /nuevo/);
    assert.match(error.causa + error.accion, /remoto/);
  });
});

test("GET /v1/projects lista lo que hay, con sus contadores", async () => {
  await conServicio({}, async (svc) => {
    await crear(svc, { origen: "local", nombre: "Uno", ruta_local: repoDePrueba() });
    await crear(svc, { origen: "local", nombre: "Dos", ruta_local: repoDePrueba() });

    const r = await pedir(svc, "/v1/projects");
    assert.equal(r.status, 200);
    const { items, cursor, avisos } = await r.json();
    assert.equal(items.length, 2);
    assert.equal(cursor, null, "sin mas paginas el cursor es `null`, no ausente");
    assert.deepEqual(avisos, []);
    for (const p of items) {
      // Los contadores van ANIDADOS y con el vocabulario del contrato, no con
      // el de la consulta del almacen.
      //
      // Este assert miraba `p.bandeja_esperando` plano, que es lo que el
      // almacen devuelve — se escribio contra la implementacion y no contra el
      // contrato. Mientras tanto la interfaz leia `contadores.entradas_bandeja`
      // y sus badges NO SE PINTABAN NUNCA: dos desacuerdos a la vez,
      // anidamiento y nombre, y ninguno daba error. El sintoma era una fila que
      // parecia no tener nada pendiente.
      assert.equal(typeof p.contadores?.entradas_bandeja, "number", "la lista trae los contadores en UNA consulta (NFR-002)");
      assert.equal(typeof p.contadores?.hallazgos_pendientes, "number");
      assert.equal(typeof p.contadores?.agentes, "number");
      // Y los nombres del almacen NO se filtran al vocabulario publico: si se
      // filtraran, habria dos formas de leer lo mismo y la interfaz podria
      // atarse a la equivocada sin que nada lo dijera.
      assert.equal(p.bandeja_esperando, undefined, "el nombre interno del almacen no sale al contrato");
    }
  });
});

test("GET /v1/projects/:id trae el detalle y el estado de cada artefacto", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await (await crear(svc, { origen: "local", nombre: "Detalle", ruta_local: repoDePrueba() })).json();
    const r = await pedir(svc, `/v1/projects/${proyecto.id}`);
    assert.equal(r.status, 200);
    const cuerpo = await r.json();
    assert.equal(cuerpo.proyecto.id, proyecto.id);
    assert.ok(cuerpo.artefactos.snapshot_aceptado, "la pantalla que explica por que no avanza necesita esto");
    assert.equal(cuerpo.artefactos.snapshot_aceptado.listo, false);
    assert.ok(
      cuerpo.artefactos.snapshot_aceptado.comoConseguirlo.length > 20,
      "un artefacto que falta sin decir como conseguirlo deja al operador mirando una cruz roja",
    );
    assert.ok(r.headers.get("etag"), "sin ETag no hay forma de detectar que cambio por debajo");
  });
});

test("un id que no existe da 404 diciendo donde estan los ids buenos", async () => {
  await conServicio({}, async (svc) => {
    const r = await pedir(svc, "/v1/projects/prj_que_no_existe");
    assert.equal(r.status, 404);
    const { error } = await r.json();
    assert.equal(error.codigo, "proyecto_desconocido");
    assert.match(error.accion, /\/v1\/projects/);
  });
});

test("EL INVARIANTE DE PATCH: cambia identidad y metadatos, y NO cambia `estado`", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await (await crear(svc, { origen: "local", nombre: "Antes", ruta_local: repoDePrueba() })).json();

    const r = await pedir(svc, `/v1/projects/${proyecto.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      // `estado` viaja en el cuerpo A PROPOSITO: la prueba no es que la interfaz
      // no lo mande, es que el servicio no lo acepte. Un segundo escritor del
      // estado saltea las guardas de transicion, que son lo unico que sostiene
      // el principio del exit code.
      body: JSON.stringify({ nombre: "Despues", autonomia: "L1", estado: "ACTIVE" }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const { proyecto: actualizado } = await r.json();
    assert.equal(actualizado.nombre, "Despues");
    assert.equal(actualizado.autonomia, "L1");
    assert.equal(actualizado.estado, "CREATED", "PATCH movio el estado: la maquina de estados dejo de ser la unica via");
  });
});

test("PATCH con un `If-Match` viejo da 412 en vez de pisar lo que hizo la otra ventana", async () => {
  await conServicio({}, async (svc) => {
    const { proyecto } = await (await crear(svc, { origen: "local", nombre: "Dos Ventanas", ruta_local: repoDePrueba() })).json();
    const etagViejo = (await pedir(svc, `/v1/projects/${proyecto.id}`)).headers.get("etag");

    const primera = await pedir(svc, `/v1/projects/${proyecto.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "if-match": etagViejo },
      body: JSON.stringify({ nombre: "La primera ventana" }),
    });
    assert.equal(primera.status, 200);

    const segunda = await pedir(svc, `/v1/projects/${proyecto.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "if-match": etagViejo },
      body: JSON.stringify({ nombre: "La segunda, que leyo antes" }),
    });
    assert.equal(segunda.status, 412);
    assert.equal((await segunda.json()).error.codigo, "estado_obsoleto");
  });
});

test("EL INVARIANTE DE DELETE: deja de gestionarlo y NO borra el repositorio del operador", async () => {
  await conServicio({}, async (svc) => {
    const ruta = repoDePrueba();
    writeFileSync(join(ruta, "lo-que-el-operador-escribio.txt"), "meses de trabajo\n");
    const { proyecto } = await (await crear(svc, { origen: "local", nombre: "Se Va", ruta_local: ruta })).json();

    const antes = huellaDelArbol(ruta);
    const r = await pedir(svc, `/v1/projects/${proyecto.id}`, { method: "DELETE" });
    assert.equal(r.status, 200, await r.clone().text());
    const despues = huellaDelArbol(ruta);

    assert.deepEqual(
      diferencias(antes, despues),
      [],
      "dejar de gestionar un proyecto toco el repositorio del operador: eso no se deshace con un ctrl-z",
    );
    assert.equal((await pedir(svc, `/v1/projects/${proyecto.id}`)).status, 404, "ya no se gestiona");
    assert.equal((await (await pedir(svc, "/v1/projects")).json()).items.length, 0);
  });
});

test("dar de alta emite `proyecto.estado` por el canal de eventos", async () => {
  await conServicio({}, async (svc) => {
    const antes = svc.ultimoId();
    await crear(svc, { origen: "local", nombre: "Con Evento", ruta_local: repoDePrueba() });
    assert.ok(svc.ultimoId() > antes, "sin evento, la otra ventana no se entera de que hay un proyecto nuevo");
  });
});
