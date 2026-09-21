// T110 / FR-024 — el bootstrap detecta lo existente ANTES de proponer nada.
//
// EL FALLO QUE EVITA, Y ES LA RECOMENDACION MAS MOLESTA QUE ESTE PRODUCTO PUEDE
// DAR: proponerle a alguien lo que ya hizo. Un equipo que tiene sus hooks, sus
// skills y su integracion continua escritos y ve una lista de propuestas para
// instalar hooks, skills e integracion continua aprende en un segundo que la
// herramienta no miro su repositorio. A partir de ahi no lee la siguiente
// lista, y las propuestas buenas se pierden con las malas.
//
// POR QUE "ANTES" ES UNA PROPIEDAD MECANICA Y NO UN ORDEN EN EL CODIGO. Porque
// un orden se puede invertir sin que nada se caiga. Lo que esta prueba afirma
// es mas fuerte: para una capacidad que ya existe, el generador de cambios NO
// SE LLAMA. No es que se llame y se descarte el resultado — es que no hay nada
// que descartar, y por eso no puede colarse en la lista.

import { test } from "node:test";
import assert from "node:assert/strict";

import { analizar, detectarExistente, CAPACIDADES, arbolEnMemoria, repositorioEnMemoria } from "../src/index.mjs";
import { hallazgo, hueco, snapshotDe, MOTIVO_LARGO } from "./ayuda.mjs";

const AHORA = Date.parse("2026-09-20T10:00:00.000Z");

const CON_HOOKS = snapshotDe([
  hallazgo("agentes.hooks", ["configuracion/hooks.json"], { evidencia: [{ ruta: "configuracion/hooks.json" }] }),
  hallazgo("agentes.skills", ["configuracion/skills/una"], { evidencia: [{ ruta: "configuracion/skills/una/SKILL.md" }] }),
  hueco("agentes.mcp", MOTIVO_LARGO, []),
  hueco("agentes.instrucciones", MOTIVO_LARGO, []),
]);

test("una capacidad con hallazgo con sustancia sale presente, con la ruta que lo respalda", () => {
  const d = detectarExistente(CON_HOOKS);
  assert.equal(d.capacidades.hooks.presente, true);
  assert.ok(d.capacidades.hooks.evidencia.some((/** @type {any} */ e) => e.ruta === "configuracion/hooks.json"));
  assert.ok(d.presentes.includes("hooks"));
});

test("un hueco declarado por el scanner no cuenta como presente, y se queda con su motivo", () => {
  // `agentes.mcp` viene del scanner con `origen: detectado` y `motivo`, que es
  // como declara "se busco y no habia". Contarlo como presente seria leer un
  // hueco como un hallazgo.
  const d = detectarExistente(CON_HOOKS);
  assert.equal(d.capacidades.servidores_mcp.presente, false);
  assert.equal(d.capacidades.servidores_mcp.motivo, MOTIVO_LARGO);
  assert.ok(d.ausentes.includes("servidores_mcp"));
});

test("un hueco con valor no vacio sigue siendo un hueco: manda el `motivo`, no la forma del valor", () => {
  // POR QUE ESTA PRUEBA EXISTE APARTE DE LA ANTERIOR. La de arriba pasa incluso
  // sin la regla del `motivo`, porque los huecos que emite el scanner hoy
  // llevan `[]` o `null` y eso ya los descarta por otra via. Dos mecanismos que
  // tapan el mismo caso son un mecanismo sin prueba: el dia que uno se caiga,
  // nadie se entera hasta que aparece un hueco con forma de hallazgo.
  //
  // Y la forma es legitima: `vacio()` del scanner acepta un `valor`, asi que un
  // detector puede declarar "se busco en estas rutas y ninguna lo declara"
  // llevando esas rutas dentro. Contarlo como presente seria leer la lista de
  // sitios donde NO estaba como si fuera la lista de sitios donde esta.
  const conHuecoConValor = snapshotDe([
    {
      categoria: "agentes",
      clave: "agentes.hooks",
      valor: ["configuracion/", "automatizacion/"],
      origen: "detectado",
      evidencia: [{ ruta: "." }],
      confianza: "alta",
      motivo: "se busco una definicion de hooks en esos dos directorios y ninguno la declara",
    },
  ]);
  const d = detectarExistente(conHuecoConValor);
  assert.equal(d.capacidades.hooks.presente, false, "un hueco con valor no vacio se conto como capacidad presente");
  assert.ok(d.ausentes.includes("hooks"));
});

test("una capacidad sobre la que el snapshot no dijo nada sale ausente, y lo dice", () => {
  const d = detectarExistente(snapshotDe([]));
  assert.equal(d.capacidades.hooks.presente, false);
  assert.ok(d.capacidades.hooks.motivo.length > 20, "un ausente sin motivo no se distingue de un detector que no miro");
  assert.equal(d.presentes.length, 0);
  assert.equal(d.ausentes.length, CAPACIDADES.length);
});

test("para una capacidad que ya existe, el generador de cambios NO se llama", () => {
  const llamadas = [];
  const catalogo = [
    {
      id: "hook_de_prueba",
      tipo: "hook",
      capacidad: "hooks",
      titulo: "Un hook",
      justificacion: "porque si",
      efectos: [],
      cambios: (/** @type {any} */ ctx) => {
        llamadas.push({ entrada: "hook_de_prueba", deteccion: ctx.deteccion });
        return { cambios: [{ ruta: "hooks.json", contenido: "{}" }] };
      },
    },
    {
      id: "mcp_de_prueba",
      tipo: "mcp",
      capacidad: "servidores_mcp",
      titulo: "Servidores MCP",
      justificacion: "porque si",
      efectos: [],
      cambios: (/** @type {any} */ ctx) => {
        llamadas.push({ entrada: "mcp_de_prueba", deteccion: ctx.deteccion });
        return { cambios: [{ ruta: ".mcp.json", contenido: "{}" }] };
      },
    },
  ];

  const salida = analizar({
    snapshot: CON_HOOKS,
    arbol: arbolEnMemoria(),
    catalogo,
    project_id: "prj_1",
    ahora: AHORA,
  });

  assert.deepEqual(llamadas.map((l) => l.entrada), ["mcp_de_prueba"], "se calculo una propuesta para algo que ya existe");
  assert.ok(salida.ya_presentes.some((/** @type {any} */ p) => p.capacidad === "hooks"));
  assert.deepEqual(salida.recomendaciones.map((/** @type {any} */ r) => r.capacidad), ["servidores_mcp"]);
});

test("cuando el generador se llama, la deteccion ya esta hecha y viaja con el", () => {
  // Es la otra mitad de "antes": el generador puede mirar lo detectado para
  // derivar su contenido, asi que la deteccion no puede ser posterior.
  let visto = null;
  analizar({
    snapshot: CON_HOOKS,
    arbol: arbolEnMemoria(),
    catalogo: [
      {
        id: "x",
        tipo: "mcp",
        capacidad: "servidores_mcp",
        titulo: "t",
        justificacion: "j",
        efectos: [],
        cambios: (/** @type {any} */ ctx) => {
          visto = ctx.deteccion;
          return { pregunta: { texto: "que servidor", falta: ["servidor"] } };
        },
      },
    ],
    project_id: "prj_1",
    ahora: AHORA,
  });
  assert.ok(visto, "el generador no recibio la deteccion");
  assert.ok(/** @type {any} */ (visto).presentes.includes("hooks"));
});

test("lo que ya esta presente se declara con su evidencia, no se calla", () => {
  // Que no se proponga no basta: el operador tiene que poder ver que la
  // herramienta lo vio, o no distingue "lo detecte" de "no se me ocurrio".
  const salida = analizar({
    snapshot: CON_HOOKS,
    arbol: arbolEnMemoria(),
    catalogo: [
      { id: "a", tipo: "hook", capacidad: "hooks", titulo: "t", justificacion: "j", efectos: [], cambios: () => ({ cambios: [] }) },
    ],
    project_id: "prj_1",
    ahora: AHORA,
  });
  const presente = salida.ya_presentes[0];
  assert.equal(presente.capacidad, "hooks");
  assert.ok(presente.evidencia.length > 0);
  assert.ok(presente.motivo.length > 20);
});

test("una entrada que no puede derivar su cambio sale como pregunta, no como recomendacion sin diff", () => {
  // Una recomendacion sin diff calculado no es una recomendacion: es una
  // intencion, y FR-026 exige el diff exacto ANTES de proponer. Lo que no se
  // puede derivar se pregunta.
  const salida = analizar({
    snapshot: CON_HOOKS,
    arbol: arbolEnMemoria(),
    catalogo: [
      {
        id: "x",
        tipo: "mcp",
        capacidad: "servidores_mcp",
        titulo: "t",
        justificacion: "j",
        efectos: [],
        cambios: () => ({ pregunta: { texto: "que servidores MCP usa este proyecto?", falta: ["servidor"] } }),
      },
    ],
    project_id: "prj_1",
    ahora: AHORA,
  });
  assert.equal(salida.recomendaciones.length, 0);
  assert.equal(salida.preguntas.length, 1);
  assert.match(salida.preguntas[0].texto, /MCP/);
});

test("un snapshot que no esta completo no se analiza", () => {
  assert.throws(
    () => analizar({ snapshot: snapshotDe([], { estado: "cancelado" }), arbol: arbolEnMemoria(), project_id: "prj_1" }),
    (/** @type {any} */ e) => e.codigo === "snapshot_incompleto",
  );
});

test("analizar no escribe nada en el arbol del proyecto", () => {
  // FR-026: ninguna recomendacion escribe sin aprobacion. La forma de que no se
  // escape una escritura no es leer el codigo: es que el arbol se queje.
  const arbol = arbolEnMemoria();
  const antes = JSON.stringify(arbol.archivos());
  analizar({ snapshot: CON_HOOKS, arbol, project_id: "prj_1", ahora: AHORA, repositorio: repositorioEnMemoria() });
  assert.equal(JSON.stringify(arbol.archivos()), antes);
});
