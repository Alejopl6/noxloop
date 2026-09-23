// T154 · el adaptador alojado: el flujo OAuth de verdad, contra una instancia
// propia del servidor de integraciones.
//
// POR QUE LA PETICION LLEGA INYECTADA Y NO HAY RED AQUI. Es la misma regla que
// ya cumple `local`: una prueba que necesite tres contenedores levantados no la
// puede correr quien adopte el proyecto, y una que necesite una cuenta en
// GitHub, menos. Lo que se inyecta no es un doble inventado: las rutas, los
// codigos y la FORMA de cada respuesta estan copiados de lo que devolvio Nango
// 0.71.10 levantado con el compose de este repositorio, medido con curl. Si
// Nango cambia una ruta, lo que falla es el adaptador contra la instancia real;
// lo que esta prueba sostiene es que el adaptador hace las llamadas correctas y
// trata bien lo que vuelve.
//
// LAS RESPUESTAS MEDIDAS, para que se pueda auditar de donde salieron:
//
//   POST /connect/sessions
//     → {"data":{"token":"nango_connect_session_839e...","connect_link":
//        "http://localhost:3009/?session_token=...","expires_at":"2026-09-21T15:13:47.993Z"}}
//   GET  /oauth/connect/github?connect_session_token=...
//     → 302 Location: https://github.com/login/oauth/authorize?...&redirect_uri=
//        http%3A%2F%2Flocalhost%3A3003%2Foauth%2Fcallback&...
//   GET  /connection?endUserId=handle-de-prueba-1
//     → {"connections":[{"id":1,"connection_id":"053ece17-...","provider_config_key":
//        "prueba-sin-auth","end_user":{"id":"handle-de-prueba-1",...},...}]}
//   GET  /connection/053ece17-...?provider_config_key=prueba-sin-auth
//     → {"connection_id":"...","credentials":{},"created_at":"...",...}
//   DELETE /connection/053ece17-...?provider_config_key=prueba-sin-auth
//     → {"success":true}

import { test } from "node:test";
import assert from "node:assert/strict";

import { chequeosDeContrato } from "../src/contrato.mjs";
import {
  crearAdaptadorNango,
  MODOS_DEL_ADAPTADOR_NANGO,
  CATALOGO_POR_DEFECTO_DE_NANGO,
} from "../src/adaptadores/nango.mjs";
import { CATALOGO_POR_DEFECTO, catalogoPorModo } from "../src/catalogo.mjs";
import { ErrorDeConexion } from "../src/errores.mjs";
import { centinela, relojDePrueba, trozoDelCentinela } from "./ayuda.mjs";

const TOKEN = centinela("token-de-nango");
const CLAVE = centinela("clave-secreta-de-nango");
const SERVIDOR = "http://localhost:3003";

/**
 * El servidor de integraciones, con las rutas y las formas que se midieron.
 *
 * POR QUE GUARDA ESTADO EN VEZ DE DEVOLVER SIEMPRE LO MISMO. El chequeo 5 del
 * contrato cuenta cuantas veces el adaptador fue a buscar el valor, y el 6
 * exige que despues de revocar deje de entregarlo. Un doble sin estado pasaria
 * los dos sin medir nada.
 */
function nangoDePrueba({ integracionesRegistradas = ["github", "linear", "jira", "slack", "notion", "vercel", "azure-devops", "github-pat"] } = {}) {
  const estado = {
    caida: /** @type {string|null} */ (null),
    lecturas: 0,
    /** Las sesiones abiertas, por token. */
    sesiones: new Map(),
    /** Las conexiones vivas, por connection_id. */
    conexiones: new Map(),
    /** Cuantos sondeos faltan para que una autorizacion aparezca, por endUserId. */
    sondeosPendientes: new Map(),
    llamadas: [],
    integraciones: new Set(integracionesRegistradas),
  };

  /** @param {any} cuerpo @param {number} [estado] */
  const json = (cuerpo, codigo = 200) =>
    new Response(JSON.stringify(cuerpo), { status: codigo, headers: { "content-type": "application/json" } });

  /** @type {(url: string, init?: any) => Promise<Response>} */
  const peticion = async (crudo, init = {}) => {
    if (estado.caida) throw new Error(estado.caida);
    const url = new URL(crudo);
    const metodo = (init.method ?? "GET").toUpperCase();
    const ruta = url.pathname;
    estado.llamadas.push({ metodo, ruta, buscar: url.search, cabeceras: init.headers ?? {} });

    // La API del proveedor externo, no la de Nango: `llamar` va directo.
    if (url.host !== "localhost:3003") {
      return json({
        alcanzado: `${url.origin}${ruta}`,
        // Se declara el TIPO de la cabecera, nunca su valor: si esta prueba
        // devolviera el token, el chequeo 8 pasaria verde midiendo el doble.
        autorizacion: typeof init.headers?.Authorization,
      });
    }

    if (ruta === "/health") return json({ ok: true });

    // ¿Esta registrada la aplicacion OAuth de este proveedor?
    const integracion = ruta.match(/^\/api\/v1\/integrations\/([^/]+)$/);
    if (integracion && metodo === "GET") {
      return estado.integraciones.has(integracion[1])
        ? json({ data: { unique_key: integracion[1], provider: integracion[1] } })
        : json({ error: { code: "not_found" } }, 404);
    }
    if (ruta === "/api/v1/integrations" && metodo === "POST") {
      const cuerpo = JSON.parse(init.body);
      estado.integraciones.add(cuerpo.integrationId ?? cuerpo.provider);
      return json({ data: { unique_key: cuerpo.integrationId ?? cuerpo.provider } });
    }

    if (ruta === "/connect/sessions" && metodo === "POST") {
      const cuerpo = JSON.parse(init.body);
      const token = `nango_connect_session_${cuerpo.end_user.id}`;
      estado.sesiones.set(token, cuerpo);
      return json({
        data: {
          token,
          connect_link: `http://localhost:3009/?session_token=${token}`,
          expires_at: "2026-09-21T15:13:47.993Z",
        },
      });
    }

    // Alta sincrona: clave de API y basica. Nango las crea en el acto.
    const alta = ruta.match(/^\/(?:api-auth\/api-key|auth\/basic)\/([^/]+)$/);
    if (alta && metodo === "POST") {
      const token = url.searchParams.get("connect_session_token");
      const sesion = estado.sesiones.get(token);
      if (!sesion) return json({ error: { code: "missing_public_key" } }, 401);
      const connectionId = `conexion-de-${sesion.end_user.id}`;
      estado.conexiones.set(connectionId, {
        connection_id: connectionId,
        provider_config_key: alta[1],
        end_user: { id: sesion.end_user.id },
        credenciales: JSON.parse(init.body),
      });
      return json({ connectionId, providerConfigKey: alta[1] });
    }

    if (ruta === "/connection" && metodo === "GET") {
      const endUserId = url.searchParams.get("endUserId");
      const faltan = estado.sondeosPendientes.get(endUserId) ?? 0;
      if (faltan > 0) {
        estado.sondeosPendientes.set(endUserId, faltan - 1);
        return json({ connections: [] });
      }
      const suyas = [...estado.conexiones.values()].filter((c) => c.end_user.id === endUserId);
      return json({ connections: suyas.map((c) => ({ ...c, credenciales: undefined })) });
    }

    const una = ruta.match(/^\/connection\/([^/]+)$/);
    if (una && metodo === "GET") {
      const conexion = estado.conexiones.get(una[1]);
      if (!conexion) return json({ error: { code: "unknown_connection" } }, 404);
      estado.lecturas += 1;
      return json({
        connection_id: conexion.connection_id,
        provider_config_key: conexion.provider_config_key,
        credentials: conexion.credenciales,
        created_at: "2026-09-21T14:45:35.843+00:00",
      });
    }
    if (una && metodo === "DELETE") {
      estado.conexiones.delete(una[1]);
      return json({ success: true });
    }

    return json({ error: { code: "ruta_no_emulada", ruta, metodo } }, 404);
  };

  return { estado, peticion };
}

/**
 * Los fixtures de la suite de contrato.
 *
 * `slugSinOauth` es `vercel` Y NO ES UN ATAJO DE PRUEBA. El adaptador alojado
 * sabe crear conexiones de clave de API y de autenticacion basica porque Nango
 * las crea de verdad —`POST /api-auth/api-key/:key` y `POST /auth/basic/:key`,
 * las dos medidas contra la instancia—, y eso importa por un motivo de
 * producto: el servicio monta UN proveedor de conexiones, asi que si el alojado
 * solo supiera oauth2, levantar los contenedores dejaria al operador sin poder
 * conectar Azure DevOps ni Vercel. El CATALOGO por defecto sigue siendo solo
 * oauth2 —el reparto no cambia— y quien quiera mas se lo pasa al montar.
 */
function fixturesDeNango(opciones = {}) {
  return {
    projectId: "proyecto-de-contrato",
    slugSinOauth: "vercel",
    valores: { api_key: TOKEN },
    centinela: TOKEN,
    sinContenedores: false,
    llamada: { metodo: "GET", ruta: "/v2/deployments" },
    montar(config = {}) {
      const { estado, peticion } = nangoDePrueba();
      const { reloj, avanzar } = relojDePrueba();
      const proveedor = crearAdaptadorNango({
        servidor: SERVIDOR,
        claveSecreta: CLAVE,
        catalogo: catalogoPorModo(CATALOGO_POR_DEFECTO, MODOS_DEL_ADAPTADOR_NANGO),
        peticion,
        reloj,
        dormir: async (ms) => avanzar(ms),
        sondearPuerto: async () =>
          config.puertoOcupado
            ? { libre: false, causa: "EADDRINUSE al intentar escuchar en 127.0.0.1:3003" }
            : { libre: true, evidencia: "el sondeo llega inyectado: esta prueba no abre ningun puerto" },
        ...opciones,
      });
      return {
        proveedor,
        estado,
        avanzar,
        lecturas: () => estado.lecturas,
        caer: (causa = "el servidor de integraciones no responde") => {
          estado.caida = causa;
        },
        levantar: () => {
          estado.caida = null;
        },
      };
    },
  };
}

test("el adaptador alojado pasa la suite de contrato", async (t) => {
  const fx = fixturesDeNango();
  for (const chequeo of chequeosDeContrato(fx)) {
    await t.test(chequeo.name, async () => {
      await chequeo.run();
    });
  }
});

test("EL INVARIANTE: conectar por oauth2 devuelve la URL que abre el navegador, y el sondeo cierra el flujo", async () => {
  const fx = fixturesDeNango();
  const { proveedor, estado } = fx.montar();

  // Dos sondeos en blanco antes de que la conexion aparezca: es lo que pasa de
  // verdad mientras el operador autoriza en su navegador. Con cero, la prueba
  // pasaria aunque el adaptador no supiera esperar.
  estado.sondeosPendientes.set("handle-github", 2);

  const alta = await proveedor.conectar({ projectId: null, slug: "github" });
  assert.ok(alta.url, "conectar un oauth2 no devolvio la URL de autorizacion");
  assert.equal(
    alta.abrir_en,
    "navegador_del_sistema",
    "la URL salio sin decir donde abrirla: varios proveedores bloquean los webviews embebidos",
  );
  assert.match(
    alta.url,
    /^http:\/\/localhost:3003\/oauth\/connect\/github\?connect_session_token=/,
    `la URL no es la del flujo de autorizacion del servidor de integraciones: ${alta.url}`,
  );

  // Y la conexion aparece cuando el proveedor contesta. El identificador de
  // usuario final que se le pasa a la sesion ES el handle: es lo unico por lo
  // que se puede volver a encontrar esta conexion y solo esta.
  const conexionId = `conexion-de-${alta.handle}`;
  estado.conexiones.set(conexionId, {
    connection_id: conexionId,
    provider_config_key: "github",
    end_user: { id: alta.handle },
    credenciales: { access_token: TOKEN, expires_at: "2026-09-21T16:00:00.000Z" },
  });
  estado.sondeosPendientes.set(alta.handle, 2);

  const conexion = await proveedor.esperarConexion(alta.handle, { timeoutMs: 60_000, intervaloMs: 10 });
  assert.equal(conexion.estado, "conectada");

  const viva = await proveedor.credenciales(conexion.id);
  assert.equal(viva.valores.GITHUB_TOKEN, TOKEN, "la credencial no volvio con el token que guardo el proveedor");
  assert.ok(viva.vigencia_ms > 0 && viva.vigencia_ms <= 5 * 60 * 1000);

  const listado = await proveedor.listar(null);
  assert.equal(trozoDelCentinela(listado, TOKEN), null, "`listar` devolvio el valor de la credencial");
});

test("sin la aplicacion OAuth registrada, conectar dice QUE falta y DONDE se registra", async () => {
  // ESTE ES EL MENSAJE QUE EL OPERADOR VA A LEER MAS VECES, y por eso se mide.
  // Un `404 not found` del servidor de integraciones, propagado tal cual, manda
  // a mirar el servidor — y lo que falta es una aplicacion registrada en
  // GitHub. Son dos sitios distintos y el segundo no se adivina desde el
  // primero.
  const fx = fixturesDeNango();
  const { proveedor, estado } = fx.montar();
  estado.integraciones.delete("github");

  await assert.rejects(
    () => proveedor.conectar({ projectId: null, slug: "github" }),
    (e) => {
      assert.ok(e instanceof ErrorDeConexion);
      assert.equal(e.codigo, "aplicacion_oauth_sin_registrar");
      assert.match(e.accion, /github\.com\/settings\/applications\/new/, "no dice donde se registra");
      assert.match(e.accion, /localhost:3003\/oauth\/callback/, "no dice que redirect URI hay que pegar");
      return true;
    },
  );
});

test("registrar la aplicacion deja el proveedor conectable, y la respuesta no lleva el secreto", async () => {
  const fx = fixturesDeNango();
  const { proveedor, estado } = fx.montar();
  estado.integraciones.delete("linear");

  const secreto = centinela("client-secret");
  const registrada = await proveedor.registrarAplicacion({
    slug: "linear",
    client_id: "un-client-id",
    client_secret: secreto,
    scopes: "read,write",
  });

  assert.equal(registrada.slug, "linear");
  assert.equal(registrada.registrada, true);
  assert.equal(
    trozoDelCentinela(registrada, secreto),
    null,
    "la respuesta de registrar la aplicacion devolvio el client secret",
  );
  assert.ok(estado.integraciones.has("linear"), "la aplicacion no quedo registrada en el servidor de integraciones");

  // Y ahora si conecta.
  const alta = await proveedor.conectar({ projectId: null, slug: "linear" });
  assert.ok(alta.url);
});

test("`aplicaciones()` dice cuales faltan y trae el recorrido de cada una", async () => {
  const fx = fixturesDeNango();
  const { proveedor, estado } = fx.montar();
  estado.integraciones.delete("github");
  estado.integraciones.delete("jira");

  const estadoDeLasApps = await proveedor.aplicaciones();
  const porSlug = Object.fromEntries(estadoDeLasApps.items.map((a) => [a.slug, a]));

  assert.equal(porSlug.github.registrada, false);
  assert.equal(porSlug.linear.registrada, true);
  assert.ok(porSlug.github.recorrido, "un proveedor sin aplicacion registrada vino sin recorrido: no guia nada");
  assert.equal(porSlug.github.recorrido.redirect_uri, "http://localhost:3003/oauth/callback");
  assert.equal(
    estadoDeLasApps.aplicaciones_compartidas.hay,
    false,
    "la respuesta no declara que no hay aplicaciones compartidas, que es la pregunta que llego primero",
  );
  assert.ok(
    estadoDeLasApps.aplicaciones_compartidas.evidencia.length >= 3,
    "la constancia viaja sin evidencia: eso se vuelve a discutir dentro de seis meses",
  );
});

test("el catalogo por defecto es solo oauth2: el reparto no cambia por levantar contenedores", async () => {
  const modos = new Set(CATALOGO_POR_DEFECTO_DE_NANGO.map((e) => e.modo));
  assert.deepEqual([...modos], ["oauth2"], `el catalogo por defecto del alojado trae modos ${[...modos].join(", ")}`);
  assert.ok(CATALOGO_POR_DEFECTO_DE_NANGO.length >= 5);
});

test("ninguna respuesta del adaptador lleva la clave secreta del servidor de integraciones", async () => {
  // La clave secreta del entorno autoriza contra TODO el servidor de
  // integraciones: lista conexiones, lee credenciales y borra lo que quiera.
  // Viaja en una cabecera y no puede volver por ninguna salida.
  const fx = fixturesDeNango();
  const { proveedor, estado } = fx.montar();

  const alta = await proveedor.conectar({ projectId: null, slug: "github" });
  const conexionId = `conexion-de-${alta.handle}`;
  estado.conexiones.set(conexionId, {
    connection_id: conexionId,
    provider_config_key: "github",
    end_user: { id: alta.handle },
    credenciales: { access_token: TOKEN },
  });
  const conexion = await proveedor.esperarConexion(alta.handle, { timeoutMs: 1000, intervaloMs: 1 });

  const salidas = [
    alta,
    conexion,
    await proveedor.catalogo(),
    await proveedor.listar(null),
    await proveedor.preflight(),
    await proveedor.aplicaciones(),
  ];
  for (const salida of salidas) {
    assert.equal(trozoDelCentinela(salida, CLAVE), null, `una salida del adaptador lleva la clave secreta`);
  }
});

test("sin `claveSecreta` no monta, y lo dice antes de que nadie pegue nada", async () => {
  assert.throws(
    () => crearAdaptadorNango({ servidor: SERVIDOR, peticion: async () => new Response("{}") }),
    (e) => {
      assert.equal(e.codigo, "clave_secreta_ausente");
      assert.ok(e.causa.length > 40);
      assert.ok(e.accion);
      return true;
    },
  );
});

test("apuntar el adaptador a la nube ajena se rechaza: ahi la clave secreta no es tuya", async () => {
  // EL FALLO QUE ESTO IMPIDE, y es de los caros. `NANGO_SERVER_URL` sale del
  // entorno del operador. Puesto a `https://api.nango.dev` —que es lo que dice
  // la documentacion publica, porque esta escrita para la nube— este adaptador
  // mandaria la clave secreta del entorno, los tokens y el inventario entero de
  // conexiones a un servidor de otra empresa, y todo funcionaria: no hay ningun
  // error que lo delate.
  //
  // La direccion de esa nube no esta escrita a mano aqui: sale de `prodHost`
  // del cliente oficial, que es quien la sabe.
  const { prodHost } = await import("@nangohq/node");
  assert.throws(
    () => crearAdaptadorNango({ servidor: prodHost, claveSecreta: CLAVE, peticion: async () => new Response("{}") }),
    (e) => {
      assert.equal(e.codigo, "servidor_no_es_propio");
      assert.match(e.causa, /api\.nango\.dev/);
      assert.ok(e.accion.includes("localhost:3003"), "no dice cual es la direccion correcta");
      return true;
    },
  );
});

test("las llamadas se identifican con el agente del cliente oficial", async () => {
  // Para que los registros del servidor de integraciones atribuyan las
  // peticiones a un cliente conocido y su version, en vez de a un `node-fetch`
  // anonimo. Sale de `getUserAgent()`, que es quien conoce la version.
  const fx = fixturesDeNango();
  const { proveedor, estado } = fx.montar();
  await proveedor.conectar({ projectId: null, slug: "github" });
  const conCabecera = estado.llamadas.filter((l) => l.cabeceras?.["User-Agent"]);
  assert.ok(conCabecera.length > 0, "ninguna llamada al servidor de integraciones se identifico");
  assert.match(conCabecera[0].cabeceras["User-Agent"], /nango/i);
});
