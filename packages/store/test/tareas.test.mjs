// Las tareas propias (spec 003, FR-030..032): el gestor local vive en el
// almacen, y el servicio es su unico escritor.
//
// LO QUE SE PRUEBA AQUI ES LO QUE LA BASE GARANTIZA SOLA. La numeracion de la
// clave (`PAY-12`), el enum del estado y el del modo de termino, la prioridad
// acotada: todo eso tiene que cumplirse tambien para quien escriba su propio
// SQL manana, asi que se prueba contra la base abierta y no contra la
// intencion del repositorio.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ENUMS, MIGRACIONES } from "../src/index.mjs";
import { prefijoDe } from "../src/tareas.mjs";
import { almacenDePrueba, capturar } from "./ayuda.mjs";

/** Un proyecto minimo con el nombre dado. */
function proyecto(almacen, workspace, nombre = "Payments") {
  return almacen.proyectos.crear({
    workspace_id: workspace.id,
    nombre,
    slug: nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    origen: "local",
    ruta_local: `/tmp/${nombre}`,
  });
}

test("la migracion de las tareas es una version NUEVA, no un retoque de las que ya corrieron", () => {
  // Por nombre y no `at(-1)`: despues llegaron otras (el orden del board, spec
  // 005), y lo que importa es que esta sea una version propia, no la ultima.
  const propia = MIGRACIONES.find((m) => m.nombre === "tareas-propias");
  assert.ok(propia);
  assert.ok(propia.version >= 5);
});

test("el enum del estado es el canonico mas `backlog`, y el termino es changes|commit|pr", () => {
  assert.deepEqual(ENUMS["local_task.estado"], ["backlog", "todo", "in_progress", "blocked", "in_review", "done"]);
  assert.deepEqual(ENUMS["local_task.termino"], ["changes", "commit", "pr"]);
});

test("el prefijo sale del nombre del proyecto, sin acentos ni simbolos, y nunca queda vacio", () => {
  assert.equal(prefijoDe("Payments"), "PAY");
  assert.equal(prefijoDe("Mi App Nueva"), "MAN");
  assert.equal(prefijoDe("núcleo de pagos"), "NDP");
  assert.equal(prefijoDe("api"), "API");
  assert.equal(prefijoDe("你好"), "TSK", "un nombre sin letras latinas no deja un prefijo vacio");
});

test("crear numera por proyecto: `PAY-1`, `PAY-2`, y otro proyecto empieza en 1 con su prefijo", () => {
  const { almacen, workspace } = almacenDePrueba();
  const a = proyecto(almacen, workspace, "Payments");
  const b = proyecto(almacen, workspace, "Core Api");

  const t1 = almacen.tareas.crear({ project_id: a.id, titulo: "cobrar", criterios: ["cobra"] });
  const t2 = almacen.tareas.crear({ project_id: a.id, titulo: "devolver" });
  const t3 = almacen.tareas.crear({ project_id: b.id, titulo: "otro" });

  assert.equal(t1.clave, "PAY-1");
  assert.equal(t2.clave, "PAY-2");
  assert.equal(t3.clave, "CA-1");
  assert.equal(t1.estado, "todo", "una tarea nueva aparece en Todo (US7, escenario 1)");
  assert.equal(t1.termino, "pr", "sin decir como termina, termina en PR: el limite del principio IV");
  assert.deepEqual(t1.criterios, ["cobra"]);
  assert.deepEqual(t2.criterios, []);
  assert.equal(t1.ejecutor, null);
  almacen.cerrar();
});

test("un prefijo configurado manda para las siguientes, y la numeracion sigue sin repetirse", () => {
  const { almacen, workspace } = almacenDePrueba();
  const a = proyecto(almacen, workspace, "Payments");
  almacen.tareas.crear({ project_id: a.id, titulo: "una" });
  const t = almacen.tareas.crear({ project_id: a.id, titulo: "dos", prefijo: "PG" });
  assert.equal(t.clave, "PG-2", "cambiar el prefijo no reinicia el numero: dos claves iguales serian dos tareas con el mismo nombre");
  const e = capturar(() => almacen.tareas.crear({ project_id: a.id, titulo: "tres", prefijo: "no vale" }));
  assert.match(String(e.message ?? e.causa), /prefijo/i);
  almacen.cerrar();
});

test("la base rechaza lo que el contrato no admite: prioridad fuera de 0..4, estado o termino inventados", () => {
  const { almacen, workspace } = almacenDePrueba();
  const a = proyecto(almacen, workspace);
  assert.ok(capturar(() => almacen.tareas.crear({ project_id: a.id, titulo: "x", prioridad: 7 })));
  assert.ok(capturar(() => almacen.tareas.crear({ project_id: a.id, titulo: "x", estado: "cerrada" })));
  assert.ok(capturar(() => almacen.tareas.crear({ project_id: a.id, titulo: "x", termino: "merge" })), "ningun termino mergea");
  assert.ok(capturar(() => almacen.tareas.crear({ project_id: a.id, titulo: "  " })), "una tarea sin titulo no se ve en el board");
  // Y lo mismo por SQL directo: el invariante vive en la base.
  assert.ok(
    capturar(() =>
      almacen.base.escribir(
        "INSERT INTO local_task (id, project_id, numero, clave, titulo, termino, creado, actualizado) VALUES ('t', ?, 1, 'X-1', 't', 'merge', 'a', 'a')",
        [a.id],
      ),
    ),
  );
  almacen.cerrar();
});

test("listar: por proyecto, sin terminadas salvo que se pidan, con total y pagina", () => {
  const { almacen, workspace } = almacenDePrueba();
  const a = proyecto(almacen, workspace);
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(almacen.tareas.crear({ project_id: a.id, titulo: `t${i}` }).id);
  almacen.tareas.cambiarEstado(ids[0], "done");

  const abiertas = almacen.tareas.listar(a.id);
  assert.equal(abiertas.total, 4);
  assert.ok(abiertas.filas.every((f) => f.estado !== "done"));

  const todas = almacen.tareas.listar(a.id, { incluirTerminadas: true });
  assert.equal(todas.total, 5);

  const p1 = almacen.tareas.listar(a.id, { limite: 2 });
  const p2 = almacen.tareas.listar(a.id, { limite: 2, desde: 2 });
  assert.equal(p1.filas.length, 2);
  assert.equal(p2.filas.length, 2);
  assert.equal(new Set([...p1.filas, ...p2.filas].map((f) => f.id)).size, 4, "la segunda pagina repite la primera");
  almacen.cerrar();
});

test("actualizar solo toca los campos declarados, y comentar acumula", () => {
  const { almacen, workspace } = almacenDePrueba();
  const a = proyecto(almacen, workspace);
  const t = almacen.tareas.crear({ project_id: a.id, titulo: "t" });
  const cambiada = almacen.tareas.actualizar(t.id, {
    titulo: "nuevo",
    ejecutor: { runtime: "claude-agent-sdk", agente: "revisor-de-api" },
    termino: "commit",
    clave: "HACK-99",
    project_id: "otro",
  });
  assert.equal(cambiada.titulo, "nuevo");
  assert.deepEqual(cambiada.ejecutor, { runtime: "claude-agent-sdk", agente: "revisor-de-api" });
  assert.equal(cambiada.termino, "commit");
  assert.equal(cambiada.clave, t.clave, "la clave no se edita: es el nombre con el que la tarea se cita");
  assert.equal(cambiada.project_id, a.id);

  almacen.tareas.comentar(t.id, "PR abierto");
  almacen.tareas.comentar(t.id, "otro");
  assert.deepEqual(almacen.tareas.comentarios(t.id).map((c) => c.texto), ["PR abierto", "otro"]);

  almacen.tareas.borrar(t.id);
  assert.equal(almacen.tareas.porId(t.id), null);
  assert.deepEqual(almacen.tareas.comentarios(t.id), [], "los comentarios se van con su tarea");
  almacen.cerrar();
});
