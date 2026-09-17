// El responsable declarado tiene que llegar a la consulta.
//
// EL FALLO QUE CIERRA. `identity.assignee` estaba en el esquema de
// configuracion y ADOPTING decia que lo consumen `inbox` y `daemon`. La consulta
// por defecto de este proveedor preguntaba por `@Me` —el dueño del token— asi
// que declarar otro responsable no cambiaba nada y tampoco avisaba. En un
// proyecto donde noxloop corre con una cuenta de servicio y los tickets se le
// asignan a OTRO usuario, la bandeja quedaba muda sin decir por que.

import { test } from "node:test";
import assert from "node:assert/strict";
import { consultasDeBandeja } from "./index.mjs";

test("sin responsable declarado se sigue preguntando por el dueño del token", () => {
  const c = consultasDeBandeja({}, {});
  assert.match(c.assigned, /@Me/);
});

test("con responsable declarado la consulta pregunta por EL, no por @Me", () => {
  const c = consultasDeBandeja({}, { assignee: "bot@empresa.test" });
  assert.doesNotMatch(c.assigned, /@Me/, "seguir preguntando por @Me es ignorar lo declarado");
  assert.match(c.assigned, /'bot@empresa\.test'/, "va entre comillas simples, que es lo que WIQL espera");
});

test("una comilla en el nombre no rompe la consulta: WIQL las duplica", () => {
  const c = consultasDeBandeja({}, { assignee: "o'brien@x.test" });
  assert.match(c.assigned, /'o''brien@x\.test'/);
});

test("un wiql propio sigue ganando: es la salida para una consulta que no anticipamos", () => {
  const c = consultasDeBandeja({ wiql: { assigned: "SELECT algo MIO" } }, { assignee: "bot@x.test" });
  assert.equal(c.assigned, "SELECT algo MIO");
});

test("el responsable no toca la consulta de menciones: @RecentMentions es del token y no se puede cambiar", () => {
  const c = consultasDeBandeja({}, { assignee: "bot@x.test", mention: "@noxloop" });
  assert.match(c.mentioned, /@RecentMentions/);
});
