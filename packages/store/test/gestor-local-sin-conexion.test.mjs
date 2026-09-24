// La etapa 06 para un proyecto que usa el gestor LOCAL (spec 003, US8, FR-035).
//
// EL PROBLEMA. `conexion_viva` exigia una conexion viva —del proyecto o del
// espacio de trabajo— para pasar de `BOOTSTRAPPED` a `CONNECTED`. Pero desde
// FR-030 un proyecto puede vivir entero de sus tareas propias: no necesita
// alcanzar ningun gestor externo, porque el gestor es el servicio. Exigirle una
// conexion era exigirle conectar algo que no va a usar, y es lo que dejaba a
// tres proyectos del operador en `CREATED` sin forma corta de llegar al board.
//
// LA REGLA NUEVA Y SU LIMITE. Un proyecto que DECLARO el gestor local (tiene su
// secuencia de claves, `local_task_sequence`) y NO tiene un tracker propio
// declarado satisface la guarda sin conexion externa. Un proyecto con un
// tracker propio —aunque este `pendiente` o `fallida`— sigue exigiendo que ese
// tracker este vivo: el operador dijo de donde salen sus tickets, y la guarda
// no se relaja por el para no ejecutar tickets de otro sitio.

import { test } from "node:test";
import assert from "node:assert/strict";

import { almacenDePrueba, capturar, llevarHasta, proyectoDePrueba } from "./ayuda.mjs";

function alBordeDeLaEtapa06(almacen, workspace) {
  return llevarHasta(almacen, proyectoDePrueba(almacen, workspace.id), "BOOTSTRAPPED");
}

test("un proyecto sin gestor local declarado ni conexion sigue en rojo: la regla no es «sin conexiones vale»", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = alBordeDeLaEtapa06(almacen, workspace);
  const veredicto = almacen.proyectos.artefactos(proyecto.id).conexion_viva;
  assert.equal(veredicto.listo, false, veredicto.hallado);
  const e = capturar(() => almacen.proyectos.transicionar(proyecto.id, "CONNECTED", { actor: "prueba" }));
  assert.match(String(e.message), /conexion_viva/);
  almacen.cerrar();
});

test("declarar el gestor local deja la secuencia de claves y basta para la etapa 06", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = alBordeDeLaEtapa06(almacen, workspace);

  const declarado = almacen.tareas.declararGestorLocal(proyecto.id);
  assert.equal(typeof declarado.prefijo, "string");
  assert.ok(declarado.prefijo.length > 0);
  // Idempotente: declararlo dos veces no reinicia la numeracion ni cambia el prefijo.
  assert.deepEqual(almacen.tareas.declararGestorLocal(proyecto.id), declarado);

  const veredicto = almacen.proyectos.artefactos(proyecto.id).conexion_viva;
  assert.equal(veredicto.listo, true, veredicto.hallado);
  assert.match(veredicto.hallado, /gestor local/, "el verde tiene que decir POR QUE no hizo falta conexion");

  const conectado = almacen.proyectos.transicionar(proyecto.id, "CONNECTED", { actor: "prueba" });
  assert.equal(conectado.estado, "CONNECTED");
  almacen.cerrar();
});

test("con un tracker PROPIO declarado y sin vida, el gestor local no lo tapa: la guarda sigue en rojo", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = alBordeDeLaEtapa06(almacen, workspace);
  almacen.tareas.declararGestorLocal(proyecto.id);
  almacen.conexiones.crear({ project_id: proyecto.id, clase: "tracker", proveedor: "jira", estado: "pendiente" });

  const veredicto = almacen.proyectos.artefactos(proyecto.id).conexion_viva;
  assert.equal(veredicto.listo, false, "un proyecto con gestor externo declarado no se relaja por tener tareas locales");
  assert.match(veredicto.hallado, /pendiente/);
  almacen.cerrar();
});

test("declarar el gestor local de un proyecto que no existe falla con su causa", () => {
  const { almacen } = almacenDePrueba();
  const e = capturar(() => almacen.tareas.declararGestorLocal("no-existe"));
  assert.match(String(e.message), /no-existe|proyecto/);
  almacen.cerrar();
});
