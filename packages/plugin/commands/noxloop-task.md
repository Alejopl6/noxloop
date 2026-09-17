---
description: "Ejecuta UNA fase de UNA tarea de un recorrido de noxloop. Lo invoca el motor; no se usa a mano."
argument-hint: "<item> <tarea> --phase RED|GREEN|REVIEW"
---

# /noxloop-task — una fase, una tarea

Argumentos: `$ARGUMENTS`.

**Este comando lo invoca el motor**, una vez por fase. No decide nada sobre el
recorrido: hace su fase y devuelve. Quien decide si avanzar es el motor, mirando
el estado en disco y los códigos de salida — nunca lo que vos escribas acá.

Lo primero, siempre:

```bash
noxloop status <item> --json
```

De ahí salen el repo, el worktree, los archivos declarados, el criterio de
aceptación y los intentos consumidos. **Nunca reconstruyas la tarea de memoria.**

Trabajás **dentro del worktree de la tarea** y nada más. El checkout principal
puede tener trabajo de una persona.

## Fase RED

Escribí el test del criterio de aceptación, en los `testFiles` declarados.

Después **corrélo y vélo fallar**. No es una formalidad: el motor va a correr
ese test él mismo y solo concede el rojo si sale con código distinto de cero
*y* el archivo existe. Si pasa sin el cambio, no prueba nada — reescribilo hasta
que falle por la razón correcta.

No toques ningún archivo de producción en esta fase. El hook `tdd-order-guard`
lo bloquea de todos modos, y su mensaje te dice cómo salir.

## Fase GREEN

El código mínimo que hace pasar ese test. Mínimo de verdad: lo que sobra
pertenece a otra tarea del plan, y lo va a marcar el revisor.

Si el prompt trae un fallo pendiente —un hallazgo del revisor, un gate en rojo,
un conflicto al rebasar— **eso es lo que hay que resolver**, no una mejora
general.

Solo los archivos declarados. Si necesitás otro de verdad:

```bash
noxloop add-target <item> <tarea> <ruta> "<por qué>"
```

Queda registrado y se reporta en el PR. Ampliar el alcance no está prohibido;
que ocurra en silencio, sí.

## Fase REVIEW

Solo lectura sobre el diff de la tarea. Cruzá cuatro criterios: que el criterio
de aceptación esté realmente cubierto, seguridad del input externo, el estilo
del repo, y que el alcance no se haya ido.

Si encontrás algo **bloqueante**, decilo de forma inequívoca empezando tu
respuesta con `HALLAZGO BLOQUEANTE:` y el detalle. Si no, decí qué revisaste y
que está limpio.

No implementes nada en esta fase. Si el hallazgo exige código, el motor va a
abrir una fase GREEN con tu hallazgo como contexto.

## No negociables

- Nunca debilites un test para que pase: ni `skip`, ni bajar un umbral, ni
  relajar una aserción. Si el test está mal planteado, corregilo **como test**.
- Nunca declares que algo pasó sin haberlo corrido.
- Nunca mergees ni despliegues. El hook lo bloquea, y el límite es real: el
  recorrido termina en el PR abierto.
