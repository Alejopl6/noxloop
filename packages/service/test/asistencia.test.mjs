// La asistencia con IA, cableada al servicio: la clave es una credencial, el
// acceso pasa por un grant, y sin nada de eso el producto sigue entero.
//
// LAS TRES COSAS QUE ESTE ARCHIVO SOSTIENE, Y NINGUNA ES DE ESTILO:
//
//   1. SIN CLAVE NO SE ROMPE NADA. La asistencia es una mejora. Si no hay
//      credencial de modelo, la ruta declara la ausencia con su causa y su
//      accion —igual que la boveda y las conexiones— y ninguna pantalla se
//      queda sin salida. Lo que NO se hace es devolver una sugerencia vacia,
//      que se lee como «no hay nada que sugerir para este proyecto».
//   2. LA CLAVE ES UNA CREDENCIAL, NO UNA VARIABLE. Va a la boveda con su
//      grant, se recupera con un motivo, y el acceso queda en la auditoria. No
//      hay un `process.env` en el camino: una clave en el entorno del servicio
//      alcanza a todo lo que el servicio hace, y no deja rastro de quien la
//      uso ni para que.
//   3. EL MODELO NO SE LLAMA DESDE UN TEST. La fabrica del proveedor se
//      inyecta, como los adaptadores de runtime. La de estas pruebas devuelve
//      un objeto fijo y ademas APUNTA la clave que recibio, que es como se
//      comprueba que la clave llega donde tiene que llegar y no sale por donde
//      no debe.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { conServicio, diferencias, huellaDelArbol, pedir, repoDePrueba, FRASE } from "./ayuda.mjs";

/** El valor de la credencial del modelo en estas pruebas. Improbable a proposito. */
const CLAVE = "sk-ant-CENTINELA-DE-LA-CLAVE-DEL-MODELO-7b3e1f";

/** Una sugerencia que el esquema acepta y cuyas citas existen en el snapshot. */
function sugerenciaValida(claves) {
  return {
    borrador: "En este proyecto los tests se corren con el runner que declara el escaneo.",
    se_apoya_en: [claves[0]],
    reglas: [
      {
        enunciado: "La suite entera pasa antes de abrir un pull request",
        comprobacion: { tipo: "comando", comando: "npm test" },
        se_apoya_en: [claves[0]],
      },
    ],
  };
}

/**
 * Una fabrica de proveedor que no llama a nada. Apunta la clave que recibio y
 * la instruccion que le llego, para poder afirmar sobre las dos.
 *
 * @param {(peticion: any) => any} responder
 */
function fabricaEspia(responder) {
  const visto = { claves: /** @type {string[]} */ ([]), peticiones: /** @type {any[]} */ ([]) };
  /** @param {{clave: string}} conf */
  const fabrica = ({ clave }) => {
    visto.claves.push(clave);
    return async (/** @type {any} */ peticion) => {
      visto.peticiones.push(peticion);
      return { objeto: responder(peticion), modelo: "modelo-de-prueba", proveedor: "proveedor-de-prueba" };
    };
  };
  return Object.assign(fabrica, { visto });
}

/** Un proyecto escaneado de verdad, con su snapshot completo y sus hallazgos. */
async function proyectoEscaneado(svc) {
  const ruta = repoDePrueba();
  writeFileSync(join(ruta, "package.json"), JSON.stringify({ name: "x", version: "1.0.0", scripts: { test: "node --test" } }));
  const proyecto = (
    await (
      await pedir(svc, "/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ origen: "local", nombre: "Con Asistencia", ruta_local: ruta }),
      })
    ).json()
  ).proyecto;

  await pedir(svc, `/v1/projects/${proyecto.id}/scan`, { method: "POST" });
  for (let i = 0; i < 400; i++) {
    const r = await pedir(svc, `/v1/projects/${proyecto.id}/snapshot`);
    if (r.status === 200) {
      const c = await r.json();
      if (c.snapshot && c.snapshot.estado !== "en_curso") return { proyecto, ruta, hallazgos: c.items };
    } else {
      await r.text();
    }
    await new Promise((listo) => setTimeout(listo, 25));
  }
  throw new Error("el snapshot no termino a tiempo");
}

/** La credencial del modelo, el agente y el grant. El camino completo del producto. */
let cuantas = 0;
async function credencialDeModelo(svc, proyecto, { valor = CLAVE } = {}) {
  const sufijo = ++cuantas;
  const alta = await (
    await pedir(svc, "/v1/credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nombre: `clave-del-modelo-${sufijo}`,
        proveedor: "anthropic",
        tipo: "modelo",
        alcance_declarado: "redactar borradores de guidelines e invariantes",
        valor,
      }),
    })
  ).json();
  assert.ok(alta.credencial, `no se pudo registrar la credencial: ${JSON.stringify(alta)}`);

  const agente = (
    await (
      await pedir(svc, `/v1/projects/${proyecto.id}/agents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nombre: `asistente-${sufijo}`, rol: "implementador", runtime: "runtime-a", modelo: "m" }),
      })
    ).json()
  ).agente;
  assert.ok(agente, "no se pudo dar de alta el agente que sostiene el grant");

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

  return { credencial: alta.credencial, agente, grant };
}

/* -------------------------------------------------------------------------- */
/* Sin clave, el producto sigue entero                                        */
/* -------------------------------------------------------------------------- */

test("sin credencial de modelo la asistencia se declara AUSENTE, con causa y con accion", async () => {
  await conServicio({ frase: FRASE }, async (svc) => {
    const { proyecto } = await proyectoEscaneado(svc);

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/assistance/suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tarea: "guideline", area: "testing" }),
    });

    assert.equal(r.status, 503, "una pieza que falta es 503, no un 200 con una sugerencia vacia");
    const { error } = await r.json();
    assert.equal(error.codigo, "pieza_ausente");
    assert.ok(error.causa.length > 60, "la causa no explica por que no hay asistencia");
    assert.match(error.accion, /\/v1\/credentials/, "la accion no dice DONDE se da de alta la clave");
    assert.match(error.accion, /modelo/, "la accion no dice de que tipo tiene que ser la credencial");
  });
});

test("`GET /v1/assistance` dice que sabe proponer y por que hoy no puede: nunca una lista muda", async () => {
  await conServicio({ frase: FRASE }, async (svc) => {
    const r = await pedir(svc, "/v1/assistance");
    assert.equal(r.status, 200, "esta ruta contesta SIEMPRE: es la que la pantalla usa para saber si ofrecer el boton");
    const cuerpo = await r.json();

    assert.ok(cuerpo.tareas.length >= 2, "la lista de tareas viene vacia");
    for (const tarea of cuerpo.tareas) {
      assert.ok(tarea.clave && tarea.titulo);
      assert.ok(
        tarea.por_que_no_es_determinista.length > 40,
        `\`${tarea.clave}\` no dice por que no se puede calcular: sin eso, nadie puede juzgar si vale la pena`,
      );
    }

    assert.equal(cuerpo.disponible, false);
    assert.ok(cuerpo.ausencia.porque.length > 60);
    assert.ok(cuerpo.ausencia.como_conseguirlo.length > 40);
  });
});

test("el resto del producto no se entera de que no hay asistencia", async () => {
  // La comprobacion de que esto es una mejora y no un requisito: se recorren
  // las rutas de siempre sin ninguna credencial de modelo montada.
  await conServicio({ frase: FRASE }, async (svc) => {
    const { proyecto } = await proyectoEscaneado(svc);
    for (const ruta of [
      "/v1/health",
      "/v1/capabilities",
      "/v1/projects",
      `/v1/projects/${proyecto.id}/snapshot`,
      `/v1/projects/${proyecto.id}/constitution/propose`,
    ]) {
      const r = await pedir(svc, ruta, { method: ruta.endsWith("propose") ? "POST" : "GET" });
      assert.ok(r.status < 400, `${ruta} contesto ${r.status} sin asistencia montada`);
      await r.text();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Con clave: el camino entero                                                */
/* -------------------------------------------------------------------------- */

test("con credencial y grant vigente, la sugerencia llega marcada y con sus apoyos reales", async () => {
  const fabrica = fabricaEspia((/** @type {any} */ p) => {
    // Se citan claves que existen de verdad: las saca de la instruccion, que
    // es lo unico que el modelo tiene delante.
    const claves = [...p.instruccion.matchAll(/^- clave: (.+)$/gm)].map((m) => m[1]);
    return sugerenciaValida(claves);
  });

  await conServicio({ frase: FRASE, fabricaDeModelo: fabrica }, async (svc) => {
    const { proyecto } = await proyectoEscaneado(svc);
    await credencialDeModelo(svc, proyecto);

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/assistance/suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tarea: "guideline", area: "testing" }),
    });
    const cuerpo = await r.json();
    assert.equal(r.status, 200, `la sugerencia fallo: ${JSON.stringify(cuerpo)}`);

    assert.equal(cuerpo.sugerencia.origen, "sugerido");
    assert.match(cuerpo.sugerencia.advertencia, /no es un hallazgo/i);
    assert.ok(cuerpo.sugerencia.apoyos.length > 0, "la sugerencia no cito ningun hallazgo");
    for (const apoyo of cuerpo.sugerencia.apoyos) {
      assert.ok(["detectado", "inferido"].includes(apoyo.origen));
    }

    // LA VERIFICABILIDAD LA DECIDE EL NUCLEO, NO EL MODELO. Cada regla
    // propuesta viene clasificada por `motivoDeNoVerificable`: si el modelo
    // pudiera decidirlo, la pantalla enseñaria como verificable una regla que
    // ningun runtime sabe correr.
    for (const regla of cuerpo.sugerencia.sugerencia.reglas) {
      assert.equal(regla.origen, "sugerido");
      assert.equal(typeof regla.verificable, "boolean");
      if (!regla.verificable) assert.ok(regla.motivo_de_no_verificable.length > 20);
    }
  });
});

test("LA CLAVE LLEGA AL PROVEEDOR Y NO VUELVE POR EL CABLE", async () => {
  const fabrica = fabricaEspia((/** @type {any} */ p) => {
    const claves = [...p.instruccion.matchAll(/^- clave: (.+)$/gm)].map((m) => m[1]);
    return sugerenciaValida(claves);
  });

  await conServicio({ frase: FRASE, fabricaDeModelo: fabrica }, async (svc) => {
    const { proyecto } = await proyectoEscaneado(svc);
    await credencialDeModelo(svc, proyecto);

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/assistance/suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tarea: "guideline", area: "testing" }),
    });

    const cabeceras = {};
    for (const [k, v] of r.headers) cabeceras[k] = v;
    const todoLoQueSalio = JSON.stringify({ estado: r.status, cabeceras, cuerpo: await r.text() });

    // La mitad que prueba que la prueba prueba algo: si la clave nunca hubiera
    // llegado al proveedor, «no sale» seria trivialmente cierto.
    assert.deepEqual(fabrica.visto.claves, [CLAVE], "la clave no llego al proveedor, asi que no salir no significa nada");
    for (const trozo of [CLAVE, CLAVE.slice(0, 24), CLAVE.slice(-16)]) {
      assert.ok(!todoLoQueSalio.includes(trozo), `la clave (o un trozo de ella) salio por el cable:\n${todoLoQueSalio.slice(0, 1200)}`);
    }
  });
});

test("el acceso a la clave queda en la auditoria, con el grant y el proposito", async () => {
  const fabrica = fabricaEspia((/** @type {any} */ p) => {
    const claves = [...p.instruccion.matchAll(/^- clave: (.+)$/gm)].map((m) => m[1]);
    return sugerenciaValida(claves);
  });

  await conServicio({ frase: FRASE, fabricaDeModelo: fabrica }, async (svc) => {
    const { proyecto } = await proyectoEscaneado(svc);
    const { grant } = await credencialDeModelo(svc, proyecto);

    await pedir(svc, `/v1/projects/${proyecto.id}/assistance/suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tarea: "guideline", area: "testing" }),
    });

    const { items } = await (await pedir(svc, "/v1/audit")).json();
    const accesos = items.filter((/** @type {any} */ e) => e.accion === "acceso" && e.resultado === "permitido");
    assert.ok(accesos.length > 0, "sacar la clave del modelo no dejo ningun rastro en la auditoria");
    const texto = JSON.stringify(accesos);
    assert.match(texto, /llamar_api/, "el motivo del acceso no viajo a la auditoria");
    assert.match(texto, new RegExp(grant.id), "la auditoria no dice QUE grant autorizo el acceso");
  });
});

test("sugerir no escribe ni un byte en el arbol del proyecto: propone, y proponer no toca el disco", async () => {
  const fabrica = fabricaEspia((/** @type {any} */ p) => {
    const claves = [...p.instruccion.matchAll(/^- clave: (.+)$/gm)].map((m) => m[1]);
    return sugerenciaValida(claves);
  });

  await conServicio({ frase: FRASE, fabricaDeModelo: fabrica }, async (svc) => {
    const { proyecto, ruta } = await proyectoEscaneado(svc);
    await credencialDeModelo(svc, proyecto);

    const antes = huellaDelArbol(ruta);
    await pedir(svc, `/v1/projects/${proyecto.id}/assistance/suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tarea: "guideline", area: "testing" }),
    });
    const cambios = diferencias(antes, huellaDelArbol(ruta));

    assert.deepEqual(
      cambios,
      [],
      `sugerir toco el arbol del proyecto:\n${cambios.join("\n")}\nUna sugerencia que escribe ya decidio.`,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* El grant es la puerta, y esta cerrada por defecto                          */
/* -------------------------------------------------------------------------- */

test("con el grant revocado no se saca la clave, y el proveedor no llega a construirse", async () => {
  const fabrica = fabricaEspia(() => ({}));

  await conServicio({ frase: FRASE, fabricaDeModelo: fabrica }, async (svc) => {
    const { proyecto } = await proyectoEscaneado(svc);
    const { grant } = await credencialDeModelo(svc, proyecto);

    await pedir(svc, `/v1/grants/${grant.id}`, { method: "DELETE" });

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/assistance/suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tarea: "guideline", area: "testing" }),
    });

    assert.ok(r.status >= 400, `un grant revocado devolvio ${r.status}`);
    const { error } = await r.json();
    assert.ok(error.accion.length > 20);
    assert.deepEqual(
      fabrica.visto.claves,
      [],
      "se construyo el proveedor con la clave aunque el grant estaba revocado: revocar no sirvio de nada",
    );
  });
});

test("con dos grants vigentes se pregunta cual, en vez de elegir uno", async () => {
  const fabrica = fabricaEspia(() => ({}));

  await conServicio({ frase: FRASE, fabricaDeModelo: fabrica }, async (svc) => {
    const { proyecto } = await proyectoEscaneado(svc);
    const primero = await credencialDeModelo(svc, proyecto);
    const segundo = await credencialDeModelo(svc, proyecto, { valor: `${CLAVE}-otra` });

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/assistance/suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tarea: "guideline", area: "testing" }),
    });

    assert.equal(r.status, 400, "con dos claves posibles se eligio una sola: la sugerencia saldria de la que no era");
    const { error } = await r.json();
    assert.match(error.accion, new RegExp(primero.grant.id));
    assert.match(error.accion, new RegExp(segundo.grant.id));
    assert.deepEqual(fabrica.visto.claves, []);
  });
});

test("con `grant_id` se usa ESE, y tiene que ser de este proyecto", async () => {
  const fabrica = fabricaEspia((/** @type {any} */ p) => {
    const claves = [...p.instruccion.matchAll(/^- clave: (.+)$/gm)].map((m) => m[1]);
    return sugerenciaValida(claves);
  });

  await conServicio({ frase: FRASE, fabricaDeModelo: fabrica }, async (svc) => {
    const { proyecto } = await proyectoEscaneado(svc);
    await credencialDeModelo(svc, proyecto);
    const segundo = await credencialDeModelo(svc, proyecto, { valor: `${CLAVE}-otra` });

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/assistance/suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tarea: "guideline", area: "testing", grant_id: segundo.grant.id }),
    });
    assert.equal(r.status, 200, `${JSON.stringify(await r.json())}`);
    assert.deepEqual(fabrica.visto.claves, [`${CLAVE}-otra`], "se uso un grant distinto del que se pidio");
  });
});

/* -------------------------------------------------------------------------- */
/* Lo que el modelo devuelve no manda                                         */
/* -------------------------------------------------------------------------- */

test("una sugerencia que cita un hallazgo inventado no llega a la pantalla", async () => {
  const fabrica = fabricaEspia(() => ({
    borrador: "Este proyecto usa un framework que el escaneo no vio.",
    se_apoya_en: ["lo.que.no.existe"],
    reglas: [],
  }));

  await conServicio({ frase: FRASE, fabricaDeModelo: fabrica }, async (svc) => {
    const { proyecto } = await proyectoEscaneado(svc);
    await credencialDeModelo(svc, proyecto);

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/assistance/suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tarea: "guideline", area: "testing" }),
    });

    assert.equal(r.status, 502, "una cita inventada salio con otro codigo: no es un error de lo que pidio el operador");
    const { error } = await r.json();
    assert.equal(error.codigo, "cita_inventada");
    assert.match(error.causa, /lo\.que\.no\.existe/);
  });
});

test("un `origen: detectado` que venga del modelo no sobrevive al viaje", async () => {
  const fabrica = fabricaEspia((/** @type {any} */ p) => {
    const claves = [...p.instruccion.matchAll(/^- clave: (.+)$/gm)].map((m) => m[1]);
    return {
      ...sugerenciaValida(claves),
      origen: "detectado",
      evidencia: [{ ruta: "lo-que-el-modelo-se-invento.md" }],
    };
  });

  await conServicio({ frase: FRASE, fabricaDeModelo: fabrica }, async (svc) => {
    const { proyecto } = await proyectoEscaneado(svc);
    await credencialDeModelo(svc, proyecto);

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/assistance/suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tarea: "guideline", area: "testing" }),
    });
    const cuerpo = await r.json();
    assert.equal(r.status, 200);

    const { apoyos, ...loSugerido } = cuerpo.sugerencia;
    const texto = JSON.stringify(loSugerido);
    assert.ok(!texto.includes('"origen":"detectado"'), `lo sugerido salio como detectado:\n${texto}`);
    assert.ok(!texto.includes("lo-que-el-modelo-se-invento.md"), "la evidencia inventada llego a la respuesta");
  });
});

test("un area que ningun hallazgo toca se dice, en vez de sugerirse a ciegas", async () => {
  const fabrica = fabricaEspia((/** @type {any} */ p) => {
    const claves = [...p.instruccion.matchAll(/^- clave: (.+)$/gm)].map((m) => m[1]);
    return sugerenciaValida(claves);
  });

  await conServicio({ frase: FRASE, fabricaDeModelo: fabrica }, async (svc) => {
    const { proyecto } = await proyectoEscaneado(svc);
    await credencialDeModelo(svc, proyecto);

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/assistance/suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tarea: "guideline", area: "diseno" }),
    });

    const cuerpo = await r.json();
    if (r.status === 200) {
      // Si el escaneo de este repositorio de prueba llegara a tocar el area, la
      // sugerencia es legitima: lo que no puede pasar es que salga vacia.
      assert.ok(cuerpo.sugerencia.apoyos.length > 0);
      return;
    }
    assert.equal(cuerpo.error.codigo, "insumo_incompleto");
    assert.ok(cuerpo.error.accion.length > 20);
  });
});

test("una tarea que no existe se rechaza nombrando las que si", async () => {
  await conServicio({ frase: FRASE, fabricaDeModelo: fabricaEspia(() => ({})) }, async (svc) => {
    const { proyecto } = await proyectoEscaneado(svc);
    await credencialDeModelo(svc, proyecto);

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/assistance/suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tarea: "lo-que-sea" }),
    });
    assert.equal(r.status, 400);
    const { error } = await r.json();
    assert.equal(error.codigo, "tarea_desconocida");
    assert.match(error.accion, /guideline/);
    assert.match(error.accion, /invariantes/);
  });
});

test("sin snapshot no se sugiere: el insumo del modelo es el escaneo y no hay otro", async () => {
  await conServicio({ frase: FRASE, fabricaDeModelo: fabricaEspia(() => ({})) }, async (svc) => {
    const ruta = repoDePrueba();
    const proyecto = (
      await (
        await pedir(svc, "/v1/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ origen: "local", nombre: "Sin Escanear", ruta_local: ruta }),
        })
      ).json()
    ).proyecto;
    await credencialDeModelo(svc, proyecto);

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/assistance/suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tarea: "invariantes" }),
    });
    assert.equal(r.status, 404);
    const { error } = await r.json();
    assert.match(error.accion, /scan/);
  });
});

/* -------------------------------------------------------------------------- */
/* La costura entre los dos vocabularios del grant                            */
/* -------------------------------------------------------------------------- */

test("LA PUERTA QUE ESTABA ABIERTA: un grant revocado ya no autoriza a `boveda.recuperar`", async () => {
  // Esto NO es de la asistencia, y se prueba aqui porque es lo que la
  // asistencia destapo al ser el primer consumidor que saca una credencial
  // desde una ruta HTTP.
  //
  // `estadoDelGrant` de `packages/vault` mira `revocadoEn`/`vigenciaHasta`; la
  // fila del almacen trae `revocado_en`/`vigencia_hasta`. Sobre una fila del
  // almacen los dos campos son `undefined` y la comprobacion decia «vigente»
  // siempre: un grant revocado hace meses seguia entregando el valor, y la
  // auditoria lo escribia como `concedido`. No se nota desde fuera —el acceso
  // funciona, que es lo que quien lo pide espera— y por eso duro.
  //
  // Se prueba contra `boveda.recuperar` directamente, que es el unico camino
  // que devuelve un valor: comprobarlo por la ruta de asistencia probaria la
  // guarda de la ruta, no la de la boveda.
  await conServicio({ frase: FRASE }, async (svc) => {
    const { proyecto } = await proyectoEscaneado(svc);
    const { credencial, grant, agente } = await credencialDeModelo(svc, proyecto);

    const motivo = {
      grant_id: grant.id,
      project_id: proyecto.id,
      agent_id: agente.id,
      proposito: "llamar_api",
    };

    // El control: con el grant vivo, el valor sale. Sin esto, «no sale cuando
    // esta revocado» podria significar «no sale nunca».
    assert.equal(await svc.dep.boveda.recuperar(credencial.ref_boveda, motivo), CLAVE);

    await pedir(svc, `/v1/grants/${grant.id}`, { method: "DELETE" });

    await assert.rejects(
      () => svc.dep.boveda.recuperar(credencial.ref_boveda, motivo),
      (/** @type {any} */ e) => {
        assert.equal(e.codigo, "grant_no_vigente", `salio \`${e.codigo}\`: revocar el grant no impidio el acceso`);
        return true;
      },
    );
  });
});

test("la clave no esta en la respuesta ANTES del redactor, no solo despues", async () => {
  // POR QUE ESTE TEST EXISTE, Y LO DESCUBRIO UNA MUTACION. Se metio la clave a
  // mano en el cuerpo de la respuesta de `sugerir` y la prueba de arriba —la
  // que mira lo que sale por el cable— NO CAYO: el redactor de la boveda la
  // sustituye por `[redactado:...]` en la ultima puerta, porque esa credencial
  // esta en el inventario y sus huellas estan cargadas.
  //
  // Que el redactor la atrape es exactamente lo que el redactor existe para
  // hacer, y es una buena noticia. Pero deja a la prueba anterior diciendo algo
  // mas fuerte de lo que prueba: demuestra que la ULTIMA puerta funciona, no
  // que esta ruta no filtre. Las dos cosas hacen falta —si la ruta filtra y
  // solo la tapa el redactor, cualquier camino que no pase por el, un log o un
  // `console.error`, la deja salir— asi que aqui se mira lo que el manejador
  // devuelve, antes de que nada lo redacte.
  const fabrica = fabricaEspia((/** @type {any} */ p) => {
    const claves = [...p.instruccion.matchAll(/^- clave: (.+)$/gm)].map((m) => m[1]);
    return sugerenciaValida(claves);
  });

  await conServicio({ frase: FRASE, fabricaDeModelo: fabrica }, async (svc) => {
    const { proyecto } = await proyectoEscaneado(svc);
    await credencialDeModelo(svc, proyecto);

    const { sugerir } = await import("../src/asistencia.mjs");
    const crudo = await sugerir({
      dep: svc.dep,
      estado: svc,
      parametros: { id: proyecto.id },
      url: new URL(`http://127.0.0.1/v1/projects/${proyecto.id}/assistance/suggest`),
      metodo: "POST",
      cuerpo: async () => ({ tarea: "guideline", area: "testing" }),
      req: /** @type {any} */ (null),
      res: /** @type {any} */ (null),
      cors: {},
    });

    assert.deepEqual(fabrica.visto.claves, [CLAVE], "la clave no llego al proveedor: no hay nada que comprobar");
    const serializado = JSON.stringify(crudo);
    for (const trozo of [CLAVE, CLAVE.slice(0, 24), CLAVE.slice(-16)]) {
      assert.ok(
        !serializado.includes(trozo),
        `el manejador metio la clave en su respuesta y solo la tapa el redactor:\n${serializado.slice(0, 800)}`,
      );
    }
  });
});
