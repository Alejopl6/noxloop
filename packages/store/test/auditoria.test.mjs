// `AuditEvent`: append-only con hash encadenado.
//
// SON DOS MECANISMOS CONTRA DOS ATACANTES DISTINTOS, Y CADA UNO TIENE SU PRUEBA.
//
// El primero es la aplicacion misma: un `UPDATE` escrito sin mala intencion
// —"corrijo el actor de ese evento, que salio mal"— borra la unica constancia
// de quien hizo que. Contra eso hay disparadores en la propia base: la
// aplicacion no puede editar ni borrar aunque quiera, y no hay que confiar en
// que ninguna ruta se acuerde.
//
// El segundo es quien tiene el archivo. Los disparadores se quitan con un
// `DROP TRIGGER`, asi que contra ese no protegen: protege el encadenamiento.
// Una fila alterada por fuera deja el hash sin cuadrar, y la verificacion dice
// cual. Sin la cadena, un evento `denegado` reescrito como `permitido` es
// indistinguible de uno que siempre fue `permitido`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { almacenDePrueba, capturar, centinela } from "./ayuda.mjs";
import { GENESIS } from "../src/auditoria.mjs";
import { ErrorDeAlmacen } from "../src/errores.mjs";

/** @param {any} almacen @param {number} cuantos */
function sembrar(almacen, cuantos) {
  const eventos = [];
  for (let i = 0; i < cuantos; i++) {
    eventos.push(
      almacen.auditoria.registrar({
        actor: `operador-${i}`,
        accion: "grant.concedido",
        objeto_tipo: "grant",
        objeto_id: `g-${i}`,
        // Todos `denegado` a proposito: asi cualquier prueba que altere una
        // fila poniendo `permitido` cambia algo de verdad. Con resultados
        // mezclados, el `UPDATE` de la prueba caia en una fila que ya tenia ese
        // valor y la prueba pasaba sin haber alterado nada.
        resultado: "denegado",
        detalle: { nota: `evento ${i}` },
      }),
    );
  }
  return eventos;
}

test("el primer evento encadena contra el genesis, y cada uno contra el hash del anterior", () => {
  const { almacen } = almacenDePrueba();
  const eventos = sembrar(almacen, 5);

  assert.equal(eventos[0].hash_anterior, GENESIS);
  for (let i = 1; i < eventos.length; i++) {
    assert.equal(eventos[i].hash_anterior, eventos[i - 1].hash);
    assert.equal(eventos[i].id, eventos[i - 1].id + 1);
  }
  assert.deepEqual(almacen.auditoria.verificarCadena(), { intacta: true, roto: null, total: 5 });
  almacen.cerrar();
});

test("la aplicacion NO PUEDE editar la tabla: el UPDATE lo aborta la propia base", () => {
  const { almacen } = almacenDePrueba();
  sembrar(almacen, 3);
  assert.throws(
    () => almacen.base.escribir("UPDATE audit_event SET resultado = 'permitido' WHERE id = 1"),
    /append-only/i,
  );
  assert.throws(() => almacen.base.escribir("DELETE FROM audit_event WHERE id = 1"), /append-only/i);
  assert.equal(almacen.base.consultarUno("SELECT count(*) AS n FROM audit_event").n, 3);
  almacen.cerrar();
});

test("el repositorio de auditoria no expone ninguna operacion de edicion ni de borrado", () => {
  // FR-049 dice "la aplicacion no expone ninguna ruta que edite o borre esta
  // tabla". Los disparadores lo impiden; esto afirma que ademas no existe el
  // metodo, porque un metodo que existe acaba llamandose y el fallo aparece en
  // tiempo de ejecucion, no en la revision del diff.
  const { almacen } = almacenDePrueba();
  assert.deepEqual(Object.keys(almacen.auditoria).sort(), ["eventos", "registrar", "verificarCadena"]);
  almacen.cerrar();
});

test("EL INVARIANTE: alterar una fila por fuera rompe la cadena y la verificacion dice cual", () => {
  // Se quitan los disparadores a proposito: es exactamente lo que haria quien
  // tiene el archivo. El encadenamiento existe para ese caso, no para el otro.
  const { almacen } = almacenDePrueba();
  sembrar(almacen, 6);
  assert.equal(almacen.auditoria.verificarCadena().intacta, true);

  almacen.base.ejecutar("DROP TRIGGER audit_event_sin_update");
  const { cambios } = almacen.base.escribir("UPDATE audit_event SET resultado = 'permitido' WHERE id = 3");
  assert.equal(cambios, 1, "la prueba no altero ninguna fila: no esta probando nada");

  const veredicto = almacen.auditoria.verificarCadena();
  assert.equal(veredicto.intacta, false);
  assert.equal(veredicto.roto.id, 3, "la verificacion no senala la fila alterada");
  assert.match(veredicto.roto.motivo, /hash/i);
  almacen.cerrar();
});

test("cambiar solo el `detalle` tambien rompe la cadena: el hash cubre el campo redactado", () => {
  const { almacen } = almacenDePrueba();
  sembrar(almacen, 4);
  almacen.base.ejecutar("DROP TRIGGER audit_event_sin_update");
  almacen.base.escribir("UPDATE audit_event SET detalle = ? WHERE id = 2", ['{"nota":"otra cosa"}']);
  const veredicto = almacen.auditoria.verificarCadena();
  assert.equal(veredicto.intacta, false);
  assert.equal(veredicto.roto.id, 2);
  almacen.cerrar();
});

test("borrar una fila del medio deja un hueco que la verificacion nombra", () => {
  // Un borrado no rompe ningun hash por si solo —los que quedan siguen siendo
  // correctos— asi que hace falta mirar tambien la continuidad de los ids.
  // Sin esta comprobacion, borrar el evento incomodo es invisible.
  const { almacen } = almacenDePrueba();
  sembrar(almacen, 5);
  almacen.base.ejecutar("DROP TRIGGER audit_event_sin_delete");
  almacen.base.escribir("DELETE FROM audit_event WHERE id = 3");

  const veredicto = almacen.auditoria.verificarCadena();
  assert.equal(veredicto.intacta, false);
  assert.equal(veredicto.roto.id, 4, "el hueco se detecta en el primer evento que sigue al borrado");
  assert.match(veredicto.roto.motivo, /hueco|falta/i);
  almacen.cerrar();
});

test("intercambiar el contenido de dos filas rompe la cadena: el orden es parte de lo que se firma", () => {
  const { almacen } = almacenDePrueba();
  sembrar(almacen, 4);
  almacen.base.ejecutar("DROP TRIGGER audit_event_sin_update");
  const dos = almacen.base.consultarUno("SELECT * FROM audit_event WHERE id = 2");
  const tres = almacen.base.consultarUno("SELECT * FROM audit_event WHERE id = 3");
  almacen.base.escribir("UPDATE audit_event SET actor = ? WHERE id = 2", [tres.actor]);
  almacen.base.escribir("UPDATE audit_event SET actor = ? WHERE id = 3", [dos.actor]);
  assert.equal(almacen.auditoria.verificarCadena().intacta, false);
  almacen.cerrar();
});

test("sin redactor no se escribe NINGUN evento, y el rechazo dice que falta", () => {
  // Principio IX: la redaccion ocurre ANTES de persistir. Un redactor opcional
  // con identidad por defecto convierte ese principio en una recomendacion: el
  // dia que nadie lo inyecta, la auditoria sigue escribiendo y el detalle sale
  // crudo. El almacen no trae redactor propio porque lo construye la boveda con
  // las referencias que tiene cargadas, y el almacen no la importa (ver
  // `test/paquete-autocontenido.test.mjs`).
  const { almacen } = almacenDePrueba({ redactor: null });
  const error = capturar(() =>
    almacen.auditoria.registrar({
      actor: "quien sea",
      accion: "credencial.rotada",
      objeto_tipo: "credential",
      objeto_id: "c1",
      resultado: "permitido",
      detalle: { valor: centinela("crudo") },
    }),
  );
  assert.ok(error instanceof ErrorDeAlmacen);
  assert.equal(error.codigo, "auditoria_sin_redactor");
  assert.match(error.accion, /redactor/i);
  assert.equal(almacen.base.consultarUno("SELECT count(*) AS n FROM audit_event").n, 0);
  almacen.cerrar();
});

test("el detalle que se guarda es el que devolvio el redactor, no el que entro", () => {
  const valor = centinela("detalle");
  const { almacen } = almacenDePrueba({
    redactor: (d) => JSON.parse(JSON.stringify(d).split(valor).join("[redactado:token]")),
  });
  almacen.auditoria.registrar({
    actor: "agente",
    accion: "ssh.comando",
    objeto_tipo: "ssh_access",
    objeto_id: "s1",
    resultado: "permitido",
    detalle: { comando: `curl -H "Authorization: ${valor}"` },
  });
  const fila = almacen.base.consultarUno("SELECT detalle FROM audit_event WHERE id = 1");
  assert.ok(!fila.detalle.includes(valor), "el valor llego a disco: la redaccion fue posterior a la escritura");
  assert.match(fila.detalle, /\[redactado:token\]/);
  almacen.cerrar();
});

test("`audit_event` no cuelga de ninguna clave foranea: borrar un proyecto no borra su rastro", () => {
  // EL FALLO QUE EVITA. Con `ON DELETE CASCADE` sobre el proyecto, dar de baja
  // un proyecto borraria justo los eventos que explican por que se dio de baja.
  const { almacen } = almacenDePrueba();
  assert.deepEqual(almacen.base.consultar("SELECT * FROM pragma_foreign_key_list('audit_event')"), []);
  almacen.cerrar();
});
