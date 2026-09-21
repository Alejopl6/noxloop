// T159 · `vigencia_ms` nunca supera los 5 minutos, y no hay cache mas alla de
// la vigencia.
//
// DE DONDE SALE EL LIMITE. Es la recomendacion del propio proveedor de la capa
// de integracion, y el motivo es concreto: un token que vive en memoria del
// servicio es un token que aparece en un volcado, en un `heapdump` de
// diagnostico y en el estado de un proceso que alguien dejo corriendo tres
// semanas. La credencial se pide justo antes de lanzar el subproceso, se
// inyecta y se descarta.
//
// EL FALLO QUE EVITA LA SEGUNDA PARTE. "No cachear" es de las cosas que se
// pierden en la primera optimizacion: alguien ve que se pide la credencial en
// cada lanzamiento, mete un Map "por rendimiento", y a partir de ahi la
// revocacion tarda en surtir efecto lo que tarde en vencer una entrada que
// nadie mira.

import { test } from "node:test";
import assert from "node:assert/strict";

import { crearAdaptadorFalso, CATALOGO_FALSO } from "../src/adaptadores/fake.mjs";
import { VIGENCIA_MAXIMA_MS, acotarVigencia } from "../src/vigencia.mjs";
import { relojDePrueba, centinela } from "./ayuda.mjs";

const PAT = CATALOGO_FALSO.find((p) => p.modo === "pat").slug;

function montar(opciones = {}) {
  const { reloj, avanzar } = relojDePrueba();
  const proveedor = crearAdaptadorFalso({ reloj, dormir: async (ms) => avanzar(ms), ...opciones });
  return { proveedor, avanzar };
}

async function conectado(proveedor, valor) {
  const r = await proveedor.conectar({ projectId: "p", slug: PAT, valores: { pat: valor } });
  return r.conexion.id;
}

test("EL INVARIANTE: vigencia_ms nunca supera los cinco minutos", async () => {
  assert.equal(VIGENCIA_MAXIMA_MS, 5 * 60 * 1000);

  const { proveedor } = montar();
  const id = await conectado(proveedor, centinela("vigencia"));
  const viva = await proveedor.credenciales(id);
  assert.ok(typeof viva.vigencia_ms === "number" && viva.vigencia_ms > 0, "una vigencia de cero no se puede sostener");
  assert.ok(viva.vigencia_ms <= VIGENCIA_MAXIMA_MS, `vigencia_ms = ${viva.vigencia_ms}`);
});

test("un motor que propone una vigencia mas larga queda acotado igual", async () => {
  // El caso real: el proveedor externo devuelve `expires_in: 3600` y el
  // adaptador lo copia tal cual. El tope no es del motor, es del contrato.
  const { proveedor } = montar({ vigenciaPropuestaMs: 60 * 60 * 1000 });
  const id = await conectado(proveedor, centinela("acotada"));
  const viva = await proveedor.credenciales(id);
  assert.equal(viva.vigencia_ms, VIGENCIA_MAXIMA_MS);

  assert.equal(acotarVigencia(60 * 60 * 1000), VIGENCIA_MAXIMA_MS);
  assert.equal(acotarVigencia(1_000), 1_000);
  assert.throws(() => acotarVigencia(0), /vigencia/);
  assert.throws(() => acotarVigencia(-1), /vigencia/);
});

test("EL INVARIANTE: dos llamadas separadas por mas de la vigencia piden de nuevo", async () => {
  const { proveedor, avanzar } = montar();
  const id = await conectado(proveedor, centinela("no-cache"));

  const primera = await proveedor.credenciales(id);
  const lecturasTrasLaPrimera = proveedor.lecturasDePrueba();
  avanzar(primera.vigencia_ms + 1);
  await proveedor.credenciales(id);

  assert.ok(
    proveedor.lecturasDePrueba() > lecturasTrasLaPrimera,
    "la segunda llamada no fue a buscar el valor: quedo cacheado mas alla de su vigencia",
  );
});

test("tampoco hay cache DENTRO de la vigencia: no hay ningun valor esperando en memoria", async () => {
  // La vigencia no es "cuanto se puede cachear": es cuanto puede sostener el
  // valor quien ya lo tiene en la mano, fuera del servicio. En el servicio no
  // queda nada entre una llamada y la siguiente.
  const { proveedor } = montar();
  const id = await conectado(proveedor, centinela("sin-cache"));

  const antes = proveedor.lecturasDePrueba();
  await proveedor.credenciales(id);
  await proveedor.credenciales(id);
  assert.equal(proveedor.lecturasDePrueba() - antes, 2, "una de las dos llamadas se sirvio de memoria");
});

test("la credencial viva se congela: quien la recibe no la puede guardar mutandola", async () => {
  const { proveedor } = montar();
  const id = await conectado(proveedor, centinela("congelada"));
  const viva = await proveedor.credenciales(id);
  assert.throws(() => {
    viva.vigencia_ms = 60 * 60 * 1000;
  }, TypeError);
});

test("pedir credenciales de una conexion que no existe, o que sigue pendiente, lo dice", async () => {
  const { proveedor } = montar({ sondeosAntesDeAutorizar: Infinity });
  await assert.rejects(
    () => proveedor.credenciales("conexion-inventada"),
    (e) => e.codigo === "conexion_desconocida" && Boolean(e.accion),
  );

  const oauth = CATALOGO_FALSO.find((p) => p.modo === "oauth2").slug;
  const r = await proveedor.conectar({ projectId: "p", slug: oauth });
  const pendiente = (await proveedor.listar("p")).find((c) => c.handle === r.handle);
  await assert.rejects(
    () => proveedor.credenciales(pendiente.id),
    (e) => e.codigo === "conexion_pendiente" && Boolean(e.accion),
  );
});
