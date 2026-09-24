// Conectar la cuenta de codigo DESDE EL ALTA de un proyecto, sin salir de ahi.
//
// EL FALLO, VISTO EN PANTALLA POR EL OPERADOR. En «Anadir proyecto» ->
// «Repositorio remoto», la pantalla decia «Sin cuenta de codigo conectada» y
// ofrecia un boton: «Ir a un proyecto y conectar». Sus palabras: "me dice ir a
// conectar, me deberia aparecer conectar la cuenta de GitHub, y que me muestre
// los repos, es decir ir integrado a Git desde aca".
//
// Y tenia razon. El producto mandaba a otro sitio a hacer algo que tiene que
// pasar ahi mismo, y no por descuido de la pantalla: conectar exigia un
// proyecto —`connection.project_id` era `NOT NULL`— y en el alta el proyecto
// todavia no existe.
//
// LO QUE ESTA PRUEBA EJERCE ES EL FLUJO ENTERO Y EN ESE ORDEN: se pega el
// token sin ningun proyecto, la lista de repositorios sale inmediatamente, y
// con uno elegido se crea el proyecto. Ninguno de los tres pasos toca otra
// pantalla.
//
// LA RED NO SE TOCA: la peticion al proveedor llega inyectada al adaptador.
// Y EL ADAPTADOR ES EL REAL, no el falso: lo que fallaba estaba en la boveda y
// en las claves foraneas del almacen, que el falso no ejerce.

import { test } from "node:test";
import assert from "node:assert/strict";

import { crearAdaptadorLocal } from "../../connections/src/adaptadores/local.mjs";
import { CATALOGO_POR_DEFECTO } from "../../connections/src/catalogo.mjs";
import { conServicio, pedir, repoDePrueba, FRASE } from "./ayuda.mjs";

/** El proveedor de codigo que se conecta pegando un token personal. */
const SCM = CATALOGO_POR_DEFECTO.find((e) => e.clase === "scm" && e.modo !== "oauth2");
const CAMPO_SECRETO = SCM.campos.find((c) => c.secreto).nombre;

/** Un valor que no puede aparecer en ninguna respuesta. */
const TOKEN = "centinela-cuenta-de-codigo-4d1f8b6e2a90";

const REPOS_DE_LA_FORJA = [
  {
    id: 21,
    name: "el-que-se-quiere",
    full_name: "una-organizacion/el-que-se-quiere",
    description: "el del alta",
    private: false,
    default_branch: "main",
    clone_url: "https://forja.ejemplo/una-organizacion/el-que-se-quiere.git",
    ssh_url: "git@forja.ejemplo:una-organizacion/el-que-se-quiere.git",
    html_url: "https://forja.ejemplo/una-organizacion/el-que-se-quiere",
    updated_at: "2026-09-20T10:00:00Z",
  },
  {
    id: 22,
    name: "el-otro",
    full_name: "una-persona/el-otro",
    description: null,
    private: true,
    default_branch: "main",
    clone_url: "https://forja.ejemplo/una-persona/el-otro.git",
    ssh_url: "git@forja.ejemplo:una-persona/el-otro.git",
    html_url: "https://forja.ejemplo/una-persona/el-otro",
    updated_at: "2026-09-19T10:00:00Z",
  },
];

const json = (cuerpo) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });

/**
 * El servicio con el adaptador `local` montado igual que lo monta el
 * ejecutable. `responder` decide que contesta la forja.
 */
const conElAdaptadorLocal = (responder = () => ({ estado: 200, cuerpo: REPOS_DE_LA_FORJA })) => ({
  frase: FRASE,
  proveedorDeConexiones: ({ boveda, workspace }) =>
    crearAdaptadorLocal({
      boveda,
      workspaceId: workspace.id,
      peticion: async () => {
        const r = responder();
        return new Response(JSON.stringify(r.cuerpo), {
          status: r.estado,
          headers: { "content-type": "application/json" },
        });
      },
    }),
});

/** Conecta la cuenta de codigo del ESPACIO DE TRABAJO, sin ningun proyecto. */
async function conectarLaCuenta(svc) {
  const r = await pedir(svc, "/v1/connections/authorize", {
    method: "POST",
    ...json({ proveedor: SCM.slug, valores: { [CAMPO_SECRETO]: TOKEN } }),
  });
  const texto = await r.clone().text();
  assert.equal(r.status, 201, `conectar la cuenta del espacio de trabajo no llego a 201: ${texto}`);
  assert.ok(!texto.includes(TOKEN), "la respuesta de conectar devolvio el valor del token");
  return (await r.json()).conexion;
}

test("EL FLUJO DEL ALTA, ENTERO: pegar el token, ver los repositorios y crear el proyecto con uno elegido", async () => {
  await conServicio(conElAdaptadorLocal(), async (svc) => {
    // 1. No hay ningun proyecto y no hace falta ninguno.
    assert.deepEqual((await (await pedir(svc, "/v1/projects")).json()).items, []);

    // 2. Se pega el token. Sin proyecto, sin salir a ninguna otra pantalla.
    const conexion = await conectarLaCuenta(svc);
    assert.equal(conexion.project_id, null, "la conexion quedo colgando de un proyecto que no existe");

    // 3. La fila queda en el almacen con el alcance del espacio de trabajo.
    const filas = svc.dep.almacen.conexiones.delEspacioDeTrabajo(svc.dep.workspace.id);
    assert.equal(filas.length, 1, "conectar no dejo fila de espacio de trabajo en `connection`");
    assert.equal(filas[0].estado, "viva");
    assert.equal(filas[0].clase, "scm");
    assert.equal(filas[0].project_id, null);
    assert.equal(filas[0].workspace_id, svc.dep.workspace.id);
    assert.equal(
      filas[0].id_externo,
      null,
      "FR-032: una conexion `scm` no lleva identificador de la capa de integracion, tambien cuando es del espacio",
    );

    // 4. LA LISTA DE REPOSITORIOS APARECE INMEDIATAMENTE. Esto es lo que el
    //    operador pidio y lo que no existia: el boton llevaba a otra pantalla.
    const repos = await pedir(svc, `/v1/connections/${conexion.id}/repos`);
    const textoRepos = await repos.clone().text();
    assert.equal(repos.status, 200, textoRepos);
    const listado = await repos.json();
    assert.deepEqual(
      listado.items.map((/** @type {any} */ x) => x.nombre_completo),
      ["una-organizacion/el-que-se-quiere", "una-persona/el-otro"],
    );
    assert.ok(!textoRepos.includes(TOKEN), "el listado de repositorios devolvio el token con el que llamo");

    // 5. Y se crea el proyecto con el repositorio elegido de esa lista.
    //
    //    `ruta_local` VIAJA TAMBIEN EN EL ORIGEN REMOTO, y esto estaba roto en
    //    la pantalla: el alta mandaba `origen: "remoto"` SIN ruta, y el
    //    servicio contestaba 400 `cuerpo_invalido` pidiendola. O sea, el boton
    //    «Crear proyecto» del origen remoto no podia funcionar nunca. El
    //    servicio tiene razon en exigirla —el clon tiene que vivir en algun
    //    sitio de esta maquina— asi que lo que se arregla es la pantalla.
    const alta = await pedir(svc, "/v1/projects", {
      method: "POST",
      ...json({
        origen: "remoto",
        nombre: "El Del Alta",
        remoto: listado.items[0].url_clon,
        ruta_local: `${repoDePrueba()}/el-que-se-quiere`,
      }),
    });
    assert.equal(alta.status, 201, `crear el proyecto con el repositorio elegido fallo: ${await alta.clone().text()}`);
    const proyecto = (await alta.json()).proyecto;
    assert.equal(proyecto.remoto, listado.items[0].url_clon);
  });
});

test("`GET /v1/connections` lista las cuentas del espacio de trabajo en UNA peticion, sin recorrer proyectos", async () => {
  // El selector de repositorios pedia las conexiones de CADA proyecto porque no
  // habia otra forma de saber que cuentas hay — y en el alta, donde no hay
  // proyecto, eso no alcanzaba a nada. Su propia cabecera ya pedia esta ruta.
  await conServicio(conElAdaptadorLocal(), async (svc) => {
    const conexion = await conectarLaCuenta(svc);

    const r = await pedir(svc, "/v1/connections");
    assert.equal(r.status, 200, await r.clone().text());
    const cuerpo = await r.json();

    assert.equal(cuerpo.items.length, 1);
    assert.equal(cuerpo.items[0].id, conexion.id);
    assert.equal(
      cuerpo.items[0].alcance,
      "espacio_de_trabajo",
      "la fila no dice de que alcance es: la pantalla no puede separar lo del espacio de lo del proyecto",
    );
    assert.equal(cuerpo.items[0].estado, "viva", "la ruta devolvio el vocabulario de `packages/connections`");
    assert.ok(cuerpo.catalogo, "la ruta no trae el catalogo, y la pantalla lo necesita para dibujar el formulario");
  });
});

test("las dos conexiones conviven y se distinguen: la del espacio y la del proyecto", async () => {
  await conServicio(conElAdaptadorLocal(), async (svc) => {
    const delEspacio = await conectarLaCuenta(svc);

    const alta = await pedir(svc, "/v1/projects", {
      method: "POST",
      ...json({ origen: "local", nombre: "Con Tracker", ruta_local: repoDePrueba() }),
    });
    const proyecto = (await alta.json()).proyecto;

    const tracker = CATALOGO_POR_DEFECTO.find((e) => e.clase === "tracker" && e.modo !== "oauth2");
    const campos = Object.fromEntries(tracker.campos.map((c) => [c.nombre, c.secreto ? "otro-valor" : "una-org"]));
    const r = await pedir(svc, `/v1/projects/${proyecto.id}/connections/authorize`, {
      method: "POST",
      ...json({ proveedor: tracker.slug, valores: campos }),
    });
    assert.equal(r.status, 201, await r.clone().text());

    const listado = await (await pedir(svc, `/v1/projects/${proyecto.id}/connections`)).json();
    const porAlcance = Object.fromEntries(listado.items.map((/** @type {any} */ c) => [c.alcance, c]));

    assert.ok(
      porAlcance.espacio_de_trabajo,
      "la pantalla del proyecto no ve la cuenta del espacio de trabajo, que es la que va a usar para clonar",
    );
    assert.equal(porAlcance.espacio_de_trabajo.id, delEspacio.id);
    assert.ok(porAlcance.proyecto, "la pantalla del proyecto no ve su propia conexion");
    assert.equal(porAlcance.proyecto.clase, "tracker");
  });
});

test("LA GUARDA DE LA ETAPA 06 por HTTP: la cuenta del espacio de trabajo la pone en verde y lo dice", async () => {
  await conServicio(conElAdaptadorLocal(), async (svc) => {
    const alta = await pedir(svc, "/v1/projects", {
      method: "POST",
      ...json({ origen: "local", nombre: "Sin Conexion Propia", ruta_local: repoDePrueba() }),
    });
    const proyecto = (await alta.json()).proyecto;

    assert.equal(svc.dep.almacen.proyectos.artefactos(proyecto.id).conexion_viva.listo, false);

    await conectarLaCuenta(svc);

    const guarda = svc.dep.almacen.proyectos.artefactos(proyecto.id).conexion_viva;
    assert.equal(guarda.listo, true, `la guarda sigue en rojo con la cuenta conectada: ${guarda.hallado}`);
    assert.match(
      guarda.hallado,
      /espacio de trabajo/i,
      `la guarda no dice que conto una conexion del espacio: ${guarda.hallado}`,
    );
  });
});

test("conectar la cuenta del espacio NO mueve el estado de ningun proyecto por su cuenta", async () => {
  // La contracara de la decision anterior. Que la guarda la de por buena no
  // significa que veinte proyectos salten de etapa porque alguien pego un
  // token: la unica via que mueve `project.estado` es una transicion pedida
  // sobre ESE proyecto.
  await conServicio(conElAdaptadorLocal(), async (svc) => {
    const alta = await pedir(svc, "/v1/projects", {
      method: "POST",
      ...json({ origen: "local", nombre: "Quieto", ruta_local: repoDePrueba() }),
    });
    const proyecto = (await alta.json()).proyecto;

    const respuesta = await pedir(svc, "/v1/connections/authorize", {
      method: "POST",
      ...json({ proveedor: SCM.slug, valores: { [CAMPO_SECRETO]: TOKEN } }),
    });
    const cuerpo = await respuesta.json();
    assert.equal(cuerpo.proyecto, undefined, "conectar la cuenta del espacio contesto sobre un proyecto cualquiera");

    const despues = await (await pedir(svc, `/v1/projects/${proyecto.id}`)).json();
    assert.equal(despues.proyecto.estado, "CREATED", "el proyecto avanzo solo al conectar la cuenta del espacio");
  });
});

test("con un token que la forja rechaza, el listado falla CON CAUSA Y ACCION, no con una traza", async () => {
  // El caso del operador que pega un token sin el permiso de leer
  // repositorios: la conexion se crea bien —el token existe— y la lista vuelve
  // vacia o rechazada. Un 500 con una traza ahi manda a revisar la red, que es
  // el unico sitio donde el problema no esta.
  await conServicio(
    conElAdaptadorLocal(() => ({ estado: 401, cuerpo: { message: "Bad credentials" } })),
    async (svc) => {
      const conexion = await conectarLaCuenta(svc);

      const r = await pedir(svc, `/v1/connections/${conexion.id}/repos`);
      const texto = await r.clone().text();
      assert.ok(r.status >= 400, `un token rechazado devolvio una lista de repositorios: ${texto}`);
      const { error } = await r.json();
      assert.ok(error.causa && error.accion, `el fallo no trae causa y accion: ${JSON.stringify(error)}`);
      assert.match(error.causa, /Bad credentials/, "la causa no lleva lo que dijo la forja, que es lo unico util");
      assert.ok(!texto.includes(TOKEN), "el error del listado devolvio el token");
    },
  );
});

test("revocar la cuenta del espacio corta de verdad, y la etapa 06 vuelve a rojo", async () => {
  await conServicio(conElAdaptadorLocal(), async (svc) => {
    const alta = await pedir(svc, "/v1/projects", {
      method: "POST",
      ...json({ origen: "local", nombre: "Apoyado", ruta_local: repoDePrueba() }),
    });
    const proyecto = (await alta.json()).proyecto;
    const conexion = await conectarLaCuenta(svc);
    assert.equal(svc.dep.almacen.proyectos.artefactos(proyecto.id).conexion_viva.listo, true);

    const r = await pedir(svc, `/v1/connections/${conexion.id}`, { method: "DELETE" });
    assert.equal(r.status, 200, `revocar no llego a 200: ${await r.clone().text()}`);

    assert.equal(svc.dep.almacen.conexiones.delEspacioDeTrabajo(svc.dep.workspace.id)[0].estado, "revocada");
    assert.equal(
      svc.dep.almacen.proyectos.artefactos(proyecto.id).conexion_viva.listo,
      false,
      "la etapa sigue en verde apoyada en una conexion que ya no entrega credenciales",
    );
    assert.equal(
      svc.dep.almacen.boveda.credenciales().length,
      0,
      "la credencial de la cuenta del espacio sigue en el inventario despues de revocarla",
    );
  });
});
