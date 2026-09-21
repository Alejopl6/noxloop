// La maquina de estados de `Project`: transiciones con guarda, escritor unico.
//
// EL FALLO QUE EVITA, Y ESTA MEDIDO EN LA CONSTITUTION. El principio VIII dice
// que la superficie de v2 se multiplica por diez y cada pantalla es candidata a
// segundo escritor, y que "un segundo escritor saltea las guardas de
// transicion, que son lo unico que sostiene el principio del exit code". Esto
// es esa guarda. Un proyecto que llega a `CONSTITUTED` sin constitution fijada
// arrastra el hueco hasta el final: el runtime aplica una constitution que no
// existe, y el sintoma aparece tres etapas despues sin forma de saber quien lo
// puso ahi.
//
// Por eso ninguna guarda pregunta "me dijeron que el snapshot esta aceptado":
// todas van a buscar el artefacto a la base. Es el principio II —el criterio
// es el objeto, no la frase— aplicado a las etapas.

import { test } from "node:test";
import assert from "node:assert/strict";

import { almacenDePrueba, capturar, llevarHasta, proyectoDePrueba } from "./ayuda.mjs";
import { ESTADOS, TRANSICIONES, transicionesDesde } from "../src/proyecto.mjs";
import { ErrorDeAlmacen } from "../src/errores.mjs";

test("EL INVARIANTE: una transicion sin su artefacto se rechaza CON CAUSA TEXTUAL que nombra lo que falta", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = proyectoDePrueba(almacen, workspace.id);

  const error = capturar(() => almacen.proyectos.transicionar(proyecto.id, "DISCOVERED", { actor: "operador" }));
  assert.ok(error instanceof ErrorDeAlmacen);
  assert.equal(error.codigo, "transicion_sin_artefacto");
  assert.match(error.causa, /snapshot/i, "la causa no nombra el artefacto que falta");
  assert.match(error.causa, /CREATED/);
  assert.match(error.causa, /DISCOVERED/);
  assert.ok(error.accion.length > 20, "un rechazo sin accion deja al operador sin saber que hacer");
  assert.equal(almacen.proyectos.porId(proyecto.id).estado, "CREATED", "el estado se movio pese al rechazo");
  almacen.cerrar();
});

test("cada transicion declarada nombra el artefacto que la habilita, y ninguna lo deja vacio", () => {
  // `ACTIVE -> ACTIVE` (reconfiguracion) es la unica sin artefacto nuevo: el
  // proyecto ya esta declarado entero y lo que cambia es la flota.
  for (const t of TRANSICIONES) {
    assert.ok(ESTADOS.includes(t.desde), `estado de origen desconocido: ${t.desde}`);
    assert.ok(ESTADOS.includes(t.hasta), `estado de destino desconocido: ${t.hasta}`);
    if (t.desde === "ACTIVE" && t.hasta === "ACTIVE") continue;
    assert.equal(typeof t.artefacto, "string");
    assert.ok(t.artefacto.length > 0, `la transicion ${t.desde} -> ${t.hasta} no declara artefacto`);
  }
});

test("ninguna transicion salta un estado, salvo la declarada `CREATED -> CONSTITUTED`", () => {
  const orden = (e) => ESTADOS.indexOf(e);
  const saltos = TRANSICIONES.filter((t) => orden(t.hasta) - orden(t.desde) > 1).map((t) => `${t.desde} -> ${t.hasta}`);
  assert.deepEqual(saltos, ["CREATED -> CONSTITUTED"]);
});

test("un salto no declarado se rechaza aunque los artefactos del destino existan", () => {
  // EL FALLO QUE EVITA. Es la tentacion evidente: "el proyecto ya tiene
  // conexiones vivas, muevelo a CONNECTED y listo". Saltandose `CONSTITUTED`
  // nadie fijo la constitution, y la flota que se declare despues corre sin
  // ella sin que ningun error lo diga.
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = proyectoDePrueba(almacen, workspace.id);
  almacen.conexiones.crear({
    project_id: proyecto.id,
    clase: "tracker",
    proveedor: "fake",
    id_externo: "ext-1",
    estado: "viva",
  });

  const error = capturar(() => almacen.proyectos.transicionar(proyecto.id, "CONNECTED", { actor: "operador" }));
  assert.equal(error.codigo, "transicion_no_declarada");
  assert.match(error.causa, /CREATED/);
  assert.match(error.causa, /CONNECTED/);
  assert.match(error.causa, /DISCOVERED|CONSTITUTED/, "la causa no dice cuales si estaban disponibles");
  almacen.cerrar();
});

test("retroceder no existe: se rechaza con su propia causa, y la accion dice reabrir la etapa", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = llevarHasta(almacen, proyectoDePrueba(almacen, workspace.id), "CONSTITUTED");
  assert.equal(proyecto.estado, "CONSTITUTED");

  const error = capturar(() => almacen.proyectos.transicionar(proyecto.id, "DISCOVERED", { actor: "operador" }));
  assert.equal(error.codigo, "retroceso_no_existe");
  assert.match(error.causa, /CONSTITUTED/);
  assert.match(error.causa, /DISCOVERED/);
  // La salida va en `accion`, que es el campo que NFR-006 reserva para eso: una
  // causa que explica y no dice que hacer deja al operador igual de atascado.
  assert.match(error.accion, /reabr/i, "la accion no dice cual es la salida: reabrir la etapa sin mover el estado");
  assert.equal(almacen.proyectos.porId(proyecto.id).estado, "CONSTITUTED");
  almacen.cerrar();
});

test("`CREATED -> CONSTITUTED` solo vale para un proyecto `nuevo`: uno `local` tiene codigo que escanear", () => {
  const { almacen, workspace } = almacenDePrueba();
  const local = proyectoDePrueba(almacen, workspace.id, { origen: "local" });
  almacen.constituciones.fijar({
    project_id: local.id,
    version: "1.0.0",
    ruta_en_repo: ".specify/memory/constitution.md",
    contenido: "# c",
  });

  const error = capturar(() => almacen.proyectos.transicionar(local.id, "CONSTITUTED", { actor: "operador" }));
  assert.equal(error.codigo, "atajo_solo_para_proyecto_nuevo");
  assert.match(error.causa, /local/);
  assert.match(error.causa, /nuevo/);
  almacen.cerrar();
});

test("un proyecto `nuevo` con constitution fijada si salta de `CREATED` a `CONSTITUTED`", () => {
  const { almacen, workspace } = almacenDePrueba();
  const nuevo = proyectoDePrueba(almacen, workspace.id, { origen: "nuevo" });
  almacen.constituciones.fijar({
    project_id: nuevo.id,
    version: "1.0.0",
    ruta_en_repo: ".specify/memory/constitution.md",
    contenido: "# c",
  });
  assert.equal(almacen.proyectos.transicionar(nuevo.id, "CONSTITUTED", { actor: "operador" }).estado, "CONSTITUTED");
  almacen.cerrar();
});

test("un proyecto `nuevo` SIN constitution no salta: el atajo se salta el escaneo, no el artefacto", () => {
  const { almacen, workspace } = almacenDePrueba();
  const nuevo = proyectoDePrueba(almacen, workspace.id, { origen: "nuevo" });
  const error = capturar(() => almacen.proyectos.transicionar(nuevo.id, "CONSTITUTED", { actor: "operador" }));
  assert.equal(error.codigo, "transicion_sin_artefacto");
  assert.match(error.causa, /constitution/i);
  almacen.cerrar();
});

test("el snapshot tiene que estar ACEPTADO, no solo existir: con hallazgos pendientes no habilita", () => {
  // "Snapshot aceptado" no es "snapshot terminado". El principio X dice que lo
  // detectado se distingue de lo inferido y que el hueco se declara hueco: un
  // hallazgo `pendiente` es exactamente un hueco sin declarar, y dejarlo pasar
  // convierte la lectura de la maquina en la constitution del proyecto.
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = proyectoDePrueba(almacen, workspace.id);
  const s = almacen.snapshots.crear({ project_id: proyecto.id, commit: "c".repeat(40) });
  almacen.snapshots.agregarHallazgo({
    snapshot_id: s.id,
    categoria: "testing",
    clave: "testing.runner",
    valor: { runner: "node:test" },
    origen: "detectado",
    evidencia: [{ ruta: "package.json", linea: 12 }],
    confianza: "alta",
  });
  almacen.snapshots.completar(s.id, { duracion_ms: 80 });

  const error = capturar(() => almacen.proyectos.transicionar(proyecto.id, "DISCOVERED", { actor: "op" }));
  assert.equal(error.codigo, "transicion_sin_artefacto");
  assert.match(error.causa, /pendiente/i);
  almacen.cerrar();
});

test("un snapshot `en_curso` con todo decidido tampoco habilita: lo que se acepta es la lectura entera", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = proyectoDePrueba(almacen, workspace.id);
  const s = almacen.snapshots.crear({ project_id: proyecto.id, commit: "d".repeat(40) });
  almacen.snapshots.agregarHallazgo({
    snapshot_id: s.id,
    categoria: "ci",
    clave: "ci.workflow",
    valor: { archivo: ".github/workflows/ci.yml" },
    origen: "detectado",
    evidencia: [{ ruta: ".github/workflows/ci.yml", linea: 1 }],
    confianza: "alta",
  });
  for (const h of almacen.snapshots.hallazgos(s.id)) almacen.snapshots.decidirHallazgo(h.id, { decision: "aceptado" });

  const error = capturar(() => almacen.proyectos.transicionar(proyecto.id, "DISCOVERED", { actor: "op" }));
  assert.equal(error.codigo, "transicion_sin_artefacto");
  almacen.cerrar();
});

test("el recorrido completo pasa por sus seis estados, cada uno con su artefacto de verdad", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = llevarHasta(almacen, proyectoDePrueba(almacen, workspace.id), "ACTIVE");
  assert.equal(proyecto.estado, "ACTIVE");
  const artefactos = almacen.proyectos.artefactos(proyecto.id);
  assert.equal(artefactos.snapshot_aceptado.listo, true);
  assert.equal(artefactos.constitution_vigente.listo, true);
  assert.equal(artefactos.bootstrap_resuelto.listo, true);
  assert.equal(artefactos.conexion_viva.listo, true);
  assert.equal(artefactos.flota_declarada.listo, true);
  almacen.cerrar();
});

test("`ACTIVE -> ACTIVE` esta permitido: la reconfiguracion no inventa un estado nuevo", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = llevarHasta(almacen, proyectoDePrueba(almacen, workspace.id), "ACTIVE");
  const antes = almacen.proyectos.porId(proyecto.id).actualizado;
  const otra = almacen.proyectos.transicionar(proyecto.id, "ACTIVE", {
    actor: "operador",
    ahora: Date.parse(antes) + 1000,
  });
  assert.equal(otra.estado, "ACTIVE");
  assert.notEqual(otra.actualizado, antes, "una reconfiguracion que no mueve `actualizado` no se ve en la bandeja");
  almacen.cerrar();
});

test("ESCRITOR UNICO: si el estado cambio entre la lectura y la escritura, la transicion se rechaza", () => {
  // EL FALLO QUE EVITA, Y ES EL DEL PRINCIPIO VIII. Dos ventanas sobre el mismo
  // proyecto: las dos leen `CONSTITUTED`, las dos comprueban la guarda, las dos
  // escriben. La segunda pisa a la primera sin que nadie lo note, y el estado
  // que queda no corresponde a ningun recorrido. La escritura es condicional
  // —`WHERE id = ? AND estado = ?`— y cero filas afectadas es la senal.
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = llevarHasta(almacen, proyectoDePrueba(almacen, workspace.id), "CONSTITUTED");

  const error = capturar(() =>
    almacen.proyectos.transicionar(proyecto.id, "BOOTSTRAPPED", { actor: "ventana dos", desde: "DISCOVERED" }),
  );
  assert.equal(error.codigo, "escritor_concurrente");
  assert.match(error.causa, /DISCOVERED/);
  assert.match(error.causa, /CONSTITUTED/);
  almacen.cerrar();
});

test("transicionar un proyecto que no existe lo dice, en vez de afectar cero filas en silencio", () => {
  const { almacen } = almacenDePrueba();
  const error = capturar(() => almacen.proyectos.transicionar("no-existe", "DISCOVERED", { actor: "op" }));
  assert.equal(error.codigo, "proyecto_desconocido");
  almacen.cerrar();
});

test("un estado que no esta en la maquina se rechaza antes de tocar la base", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = proyectoDePrueba(almacen, workspace.id);
  const error = capturar(() => almacen.proyectos.transicionar(proyecto.id, "TERMINADO", { actor: "op" }));
  assert.equal(error.codigo, "estado_desconocido");
  assert.match(error.causa, /TERMINADO/);
  almacen.cerrar();
});

test("un proyecto NACE en `CREATED` aunque quien lo crea pida otra cosa", () => {
  // La puerta por la que un proyecto entraria ya en `ACTIVE` sin haber pasado
  // por ninguna guarda.
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = proyectoDePrueba(almacen, workspace.id, { estado: "ACTIVE" });
  assert.equal(proyecto.estado, "CREATED");
  assert.equal(almacen.proyectos.porId(proyecto.id).estado, "CREATED");
  almacen.cerrar();
});

test("`transicionesDesde` devuelve solo las salidas declaradas de cada estado", () => {
  assert.deepEqual(
    transicionesDesde("CREATED").map((t) => t.hasta),
    ["DISCOVERED", "CONSTITUTED"],
  );
  assert.deepEqual(
    transicionesDesde("ACTIVE").map((t) => t.hasta),
    ["ACTIVE"],
  );
  assert.deepEqual(
    transicionesDesde("CONNECTED").map((t) => t.hasta),
    ["ACTIVE"],
  );
});
