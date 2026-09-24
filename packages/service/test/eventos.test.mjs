// El canal de eventos, que es lo que hace que la interfaz no recargue.
//
// POR QUE EL TOKEN VA POR QUERY STRING Y SOLO AQUI. `EventSource` no acepta
// cabeceras: no hay forma de mandarle `Authorization` ni `x-noxloop-token`. La
// alternativa era mantener una segunda forma de autenticar (una cookie de
// sesion) solo para este canal, con su propio CSRF. El token en la query es
// peor en un sentido conocido —queda en el historial del navegador y en
// cualquier log de acceso— y aqui no hay proxy ni log de acceso: es loopback y
// el token muere con el proceso. Se documenta porque la proxima persona va a
// querer copiarlo a un endpoint que no tiene esa excusa.
//
// POR QUE EL BUFFER ES ACOTADO Y EL HUECO SE DECLARA. Guardar todo es una fuga
// de memoria con forma de feature. Reenviar solo lo que hay y callarse el hueco
// es peor: la interfaz se queda con un estado al que le faltan transiciones y
// no tiene forma de saberlo, que es exactamente el estado rancio que FR-005
// prohibe. Por eso, cuando el hueco excede el buffer, el servicio dice
// `sincronizar_completo` en vez de mandar lo que le queda.

import { test } from "node:test";
import assert from "node:assert/strict";

import { arrancar } from "../src/servidor.mjs";
import { conServicio, homeTemporal, leerFrames, eventos, TOKEN } from "./ayuda.mjs";

const abrir = (svc, extra = {}) =>
  fetch(`${svc.url}/v1/events?token=${encodeURIComponent(svc.token)}`, { headers: /** @type {any} */ (extra) });

test("/v1/events entrega los eventos que se emiten mientras esta conectado", async () => {
  await conServicio({}, async (svc) => {
    const r = await abrir(svc);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/event-stream/);

    svc.emitir("bandeja.entrada", { id: "inb_1" });
    svc.emitir("proyecto.estado", { estado: "DISCOVERED" }, { project_id: "p1" });

    const frames = await leerFrames(r, (f) => eventos(f).length >= 2);
    const evs = eventos(frames);
    assert.equal(evs[0].tipo, "bandeja.entrada");
    assert.deepEqual(evs[0].datos.datos, { id: "inb_1" });
    assert.equal(evs[1].tipo, "proyecto.estado");
    assert.equal(evs[1].datos.project_id, "p1");
    assert.ok(Number(evs[1].id) > Number(evs[0].id), "los id tienen que crecer para poder retomar");
  });
});

test("reconectar con Last-Event-ID recupera exactamente lo perdido", async () => {
  await conServicio({}, async (svc) => {
    // Tres eventos con nadie escuchando: es el caso real, la ventana se cerro o
    // la maquina durmio.
    svc.emitir("scan.progreso", { archivos_vistos: 1 });
    svc.emitir("scan.progreso", { archivos_vistos: 2 });
    svc.emitir("scan.terminado", {});

    const r = await abrir(svc, { "last-event-id": "1" });
    const evs = eventos(await leerFrames(r, (f) => eventos(f).length >= 2));
    assert.equal(evs.length, 2, "se reenvia lo que falta, ni uno mas");
    assert.equal(evs[0].id, "2");
    assert.deepEqual(evs[0].datos.datos, { archivos_vistos: 2 });
    assert.equal(evs[1].tipo, "scan.terminado");
  });
});

test("al dia no se reenvia nada: reconectar no duplica lo que la interfaz ya pinto", async () => {
  await conServicio({}, async (svc) => {
    svc.emitir("bandeja.entrada", { id: "inb_1" });
    const r = await abrir(svc, { "last-event-id": String(svc.ultimoId()) });
    svc.emitir("bandeja.resuelta", { id: "inb_1" });
    const evs = eventos(await leerFrames(r, (f) => eventos(f).length >= 1));
    assert.equal(evs.length, 1);
    assert.equal(evs[0].tipo, "bandeja.resuelta");
  });
});

test("EL INVARIANTE: un hueco mayor que el buffer se declara con sincronizar_completo", async () => {
  await conServicio({ capacidadEventos: 3 }, async (svc) => {
    for (let i = 0; i < 10; i++) svc.emitir("scan.progreso", { archivos_vistos: i });

    const r = await abrir(svc, { "last-event-id": "1" });
    const evs = eventos(await leerFrames(r, (f) => eventos(f).length >= 1));
    assert.equal(
      evs[0].tipo,
      "sincronizar_completo",
      "mandar lo que quedo en el buffer es mostrar estado al que le faltan transiciones",
    );
    // El cursor del cliente tiene que quedar al dia, o pide la sincronizacion
    // completa en cada reconexion para siempre.
    assert.equal(evs[0].id, String(svc.ultimoId()));
  });
});

test("un id que no se entiende se trata como hueco, no como si estuviera al dia", async () => {
  await conServicio({}, async (svc) => {
    svc.emitir("bandeja.entrada", { id: "inb_1" });
    const r = await abrir(svc, { "last-event-id": "no-soy-un-numero" });
    const evs = eventos(await leerFrames(r, (f) => eventos(f).length >= 1));
    assert.equal(evs[0].tipo, "sincronizar_completo");
  });
});

test("hay latido: un proxy o un NAT que corta conexiones calladas no mata el canal", async () => {
  await conServicio({ latidoMs: 20 }, async (svc) => {
    const r = await abrir(svc);
    const frames = await leerFrames(r, (f) => f.filter((x) => x.comentario).length >= 2, 2000);
    assert.ok(frames.filter((f) => f.comentario).length >= 2, "no llego ningun latido");
  });
});

test("el cierre limpio se anuncia: una caida y un apagado no se parecen desde la interfaz", async () => {
  const svc = await arrancar({ home: homeTemporal(), token: TOKEN });
  const r = await fetch(`${svc.url}/v1/events?token=${encodeURIComponent(svc.token)}`);
  const leyendo = leerFrames(r, (f) => eventos(f).some((e) => e.tipo === "servicio.parando"));
  await svc.detener();
  const evs = eventos(await leyendo);
  assert.ok(evs.some((e) => e.tipo === "servicio.parando"), "el servicio se fue sin avisar");
});

test("el canal exige token, y el de la query es el unico que EventSource puede mandar", async () => {
  await conServicio({}, async (svc) => {
    const sin = await fetch(`${svc.url}/v1/events`);
    assert.equal(sin.status, 401);
    await sin.body?.cancel();

    const malo = await fetch(`${svc.url}/v1/events?token=el-que-no-es`);
    assert.equal(malo.status, 401);
    await malo.body?.cancel();

    const cabecera = await fetch(`${svc.url}/v1/events`, { headers: { "x-noxloop-token": svc.token } });
    assert.equal(cabecera.status, 200, "el que puede mandar cabeceras no deberia pagar por EventSource");
    await cabecera.body?.cancel();
  });
});
