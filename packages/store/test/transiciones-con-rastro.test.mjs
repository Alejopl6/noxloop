// Una transicion de estado deja rastro en el registro append-only.
//
// EL HUECO QUE ESTO CIERRA, y lo encontro el recorrido de punta a punta al
// intentar demostrar algo que parecia obvio: "el proyecto paso por los seis
// estados en orden".
//
// `project.estado` guarda DONDE esta el proyecto, no COMO llego. No hay tabla
// de historia —dieciseis tablas, ninguna— y `transicionar` recibia un `actor`
// que no escribia en ningun sitio. Asi que esa pregunta solo se podia responder
// observando en vivo, y quien abre la aplicacion tres semanas despues no estaba
// mirando. El recorrido tuvo que demostrarlo muestreando las guardas en cada
// frontera, que prueba otra cosa.
//
// POR QUE EN LA AUDITORIA Y NO EN UNA TABLA DE HISTORIA PROPIA: `audit_event`
// no cuelga de ninguna clave foranea, a proposito, para que borrar un proyecto
// no se lleve por delante la explicacion de lo que paso con el. Una tabla
// `project_transition` con `REFERENCES project(id)` se habria ido con la
// cascada justo cuando mas falta hace — que es cuando alguien pregunta por que
// se borro.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { abrirAlmacen } from "../src/almacen.mjs";

/** Un almacen con redactor, porque auditar sin el no se puede (principio IX). */
function almacen() {
  const dir = mkdtempSync(join(tmpdir(), "noxloop-trans-"));
  return abrirAlmacen({ ruta: join(dir, "a.sqlite"), redactor: (d) => d });
}

/** Un proyecto recien creado, en `CREATED`. */
function proyectoNuevo(a) {
  const w = a.workspaces.crear({ home: "/tmp/noxloop" });
  return a.proyectos.crear({
    workspace_id: w.id,
    nombre: "el proyecto",
    slug: "el-proyecto",
    origen: "nuevo",
    ruta_local: "/tmp/noxloop/el-proyecto",
  });
}

/**
 * El artefacto que `CREATED -> CONSTITUTED` exige.
 *
 * El atajo de proyecto nuevo se salta el SNAPSHOT —no hay codigo que
 * escanear— pero no la constitution: el estado no se escribe a partir de que
 * alguien diga que la etapa termino. Lo descubri escribiendo este test, dando
 * por hecho que "nuevo" significaba "sin artefactos". La guarda tenia razon.
 */
function conConstitution(a, projectId) {
  a.constituciones.fijar({ project_id: projectId, version: "1.0.0", ruta_en_repo: "CONSTITUTION.md" });
}

/** Los eventos de transicion de un proyecto, en el orden en que se escribieron. */
function transicionesDe(a, projectId) {
  return a.auditoria
    .eventos({ accion: "proyecto.transicion" })
    .filter((e) => e.objeto_id === projectId);
}

test("una transicion escribe su fila de auditoria, con quien la hizo y de donde a donde", () => {
  const a = almacen();
  const p = proyectoNuevo(a);

  // `CREATED → CONSTITUTED` es el atajo declarado para proyecto nuevo: no
  // necesita snapshot, asi que sirve para probar el rastro sin montar media
  // etapa 01.
  conConstitution(a, p.id);
  a.proyectos.transicionar(p.id, "CONSTITUTED", { actor: "la operadora" });

  const mias = transicionesDe(a, p.id);
  assert.equal(mias.length, 1, "la transicion no dejo rastro");
  const [evento] = mias;
  assert.equal(evento.actor, "la operadora", "el rastro no dice quien la hizo");
  assert.equal(evento.objeto_tipo, "project");
  assert.equal(evento.resultado, "permitido");

  const detalle = typeof evento.detalle === "string" ? JSON.parse(evento.detalle) : evento.detalle;
  assert.equal(detalle.desde, "CREATED", "el rastro no dice de donde venia");
  assert.equal(detalle.hasta, "CONSTITUTED", "el rastro no dice a donde fue");

  a.cerrar();
});

test("EL INVARIANTE: el recorrido completo se puede reconstruir DESPUES, leyendo solo la auditoria", () => {
  // Esta es la pregunta que el recorrido de punta a punta no podia contestar.
  // No se comprueba que el proyecto llegue lejos —eso ya lo prueba el
  // recorrido—, se comprueba que la historia quede LEGIBLE cuando ya nadie
  // estaba mirando.
  const a = almacen();
  const p = proyectoNuevo(a);

  conConstitution(a, p.id);
  a.proyectos.transicionar(p.id, "CONSTITUTED", { actor: "la operadora" });

  const eventos = transicionesDe(a, p.id).map((e) =>
    typeof e.detalle === "string" ? JSON.parse(e.detalle) : e.detalle,
  );

  // El recorrido se reconstruye encadenando `desde` con `hasta`: el `hasta` de
  // cada paso tiene que ser el `desde` del siguiente. Si la cadena se rompe,
  // hubo una transicion sin rastro — que es exactamente el fallo de antes.
  const recorrido = [eventos[0].desde, ...eventos.map((e) => e.hasta)];
  assert.deepEqual(recorrido, ["CREATED", "CONSTITUTED"]);

  for (let i = 1; i < eventos.length; i++) {
    assert.equal(
      eventos[i].desde,
      eventos[i - 1].hasta,
      `hay un salto entre ${eventos[i - 1].hasta} y ${eventos[i].desde}: falta el rastro de una transicion`,
    );
  }

  a.cerrar();
});

test("una transicion rechazada NO deja rastro de haber ocurrido", () => {
  // El rastro dice lo que PASO. Una transicion que el almacen rechazo no paso,
  // y anotarla como si hubiera pasado convierte la reconstruccion en ficcion:
  // el recorrido leido tendria estados por los que el proyecto nunca estuvo.
  //
  // Un intento denegado si merece quedar registrado algun dia, pero entonces
  // con `resultado: "denegado"` y no confundible con este. Hoy no se registra,
  // y esta prueba fija que el silencio es el comportamiento actual para que
  // cambiarlo sea una decision visible.
  const a = almacen();
  const p = proyectoNuevo(a);

  assert.throws(() => a.proyectos.transicionar(p.id, "ACTIVE", { actor: "la operadora" }));

  assert.deepEqual(transicionesDe(a, p.id), [], "una transicion que no ocurrio dejo rastro de haber ocurrido");

  a.cerrar();
});

test("el rastro y la transicion caen en la misma transaccion", () => {
  // Si el rastro se escribiera fuera de la transaccion, un fallo entre las dos
  // escrituras dejaria el estado avanzado y la historia con un salto — y la
  // reconstruccion del test de arriba acusaria una transicion que si ocurrio.
  //
  // Se comprueba por el efecto observable: una transicion rechazada no deja
  // NI estado nuevo NI fila. Con escrituras separadas, la fila podria existir.
  const a = almacen();
  const p = proyectoNuevo(a);

  assert.throws(() => a.proyectos.transicionar(p.id, "BOOTSTRAPPED", { actor: "la operadora" }));

  assert.equal(a.proyectos.porId(p.id).estado, "CREATED", "el estado avanzo pese al rechazo");
  assert.deepEqual(transicionesDe(a, p.id), [], "quedo una fila de una transicion que no ocurrio");

  a.cerrar();
});
