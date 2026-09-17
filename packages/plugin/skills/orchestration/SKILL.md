---
name: orchestration
description: Cómo funciona por dentro el motor de noxloop — el estado, los presupuestos, los hooks, el paralelismo y la cola de integración. Se usa al depurar un recorrido atascado, al retomar uno interrumpido, o al modificar el motor.
---

# El motor de noxloop

## Reglas no negociables

- **Nunca desactives un hook para que una tarea avance.** Si un hook bloquea, o
  la tarea está mal declarada o el paso está fuera de orden. Las dos cosas se
  arreglan, no se saltean.
- **Nunca declares que un gate pasó sin el objeto del gate.** El criterio de
  éxito es un exit code.
- **Nunca reconstruyas el plan de memoria al retomar.** El archivo de estado es
  la verdad; la conversación, no.
- **Cuando una tarea agota su presupuesto, bloqueala con la causa real y seguí
  con la siguiente.** Un recorrido con tres bloqueadas y un diagnóstico honesto
  es útil; uno con tres verdes inventados, no.

## Dónde vive el estado

`NOXLOOP_HOME` (por defecto `~/.noxloop`):

```
runs/run-<item>.json        un recorrido por ticket
plans/plan-<item>.json      el handoff de la planificación
milestones/…                el recorrido de un hito
active-tasks/<worktree>.json una entrada por tarea en vuelo
locks/<recurso>.json        instancia única
worktrees/<repo>/…          un espacio aislado por tarea
noxloop.log
```

**Fuera de los repositorios, a propósito.** Un ticket puede abarcar varios, y
los hooks que corren dentro de uno tienen que ver la misma tarea activa que los
que corren dentro de otro. Un `.noxloop/` por repositorio no puede dar eso — y
tampoco los artefactos intermedios: un archivo de handoff dentro del árbol de
trabajo de alguien termina commiteado por accidente.

Las escrituras son atómicas (temporal + rename), y toda mutación lee el estado
**fresco** del disco antes de aplicarse. Eso último es lo que evita que dos
tareas en paralelo se pisen: sin ello, la última en guardar borra lo que escribió
la otra, y el síntoma es una tarea que pierde su worktree y muere intentando
crearlo de nuevo.

## Por qué existe cada mecanismo

| Mecanismo | El fallo que evita |
|---|---|
| Estado en archivo | Perder el hilo tras una compactación o una sesión matada. Es lo que hace retomable un recorrido. |
| Transiciones con guarda | Que una tarea se marque cumplida sin evidencia de que algo corrió. |
| `gate` como único veredicto | Que un agente declare "pasó" sin haber corrido nada. |
| Gate por repositorio | Que un comando único falle en la mayoría de los repos de una organización: no hay uno uniforme. |
| Worktree por tarea | Que dos tareas en paralelo se pisen, y que el gate de una mida el código de la otra. |
| Cola de integración serial | Ramificar sobre trabajo no integrado. Catorce ramas encadenadas, y las tres últimas en conflicto. |
| Puntero activo por worktree | Que el guardián de alcance de una tarea bloquee los archivos de otra. |
| `tdd-order-guard` | Que TDD dependa de que el modelo se acuerde. A la tercera iteración no se acuerda. |
| `task-scope-guard` | Que el PR de una tarea de tres archivos termine con cuarenta sin que nadie lo note. |
| `no-prod-writes` | Que el recorrido mergee o despliegue. La autonomía termina en el PR abierto. |
| Presupuestos por bucle | El bucle infinito, y su gemelo peor: el "lo di por bueno". |
| `providerStateWritten` | Que el tablero mienta, o que relanzar mueva el ticket dos veces. |

## Presupuestos

`red: 2`, `green: 3`, `gate: 3`, `review: 2`. **Por bucle, no globales**: una
tarea que necesitó tres intentos de GREEN todavía tiene sus tres de GATE.
Agotado cualquiera, la tarea se bloquea.

Se consumen **explícitamente**. Un intento que no se registra no existe, y una
tarea que no registra puede iterar sin límite: registrar es parte del intento.

## El paralelismo, en una frase

Una tarea corre si ninguna de sus dependencias **duras** está sin **integrar**.
Sin integrar, no "sin terminar". Las blandas no bloquean ni arrastran.

Una tarea bloqueada vuelve **inalcanzables** a las que dependen de ella, y eso
es una categoría distinta de bloqueada: una falló, la otra nunca pudo
intentarse, y el reporte final solo sirve si los distingue.

## Cuando un hook bloquea

**`tdd-order-guard`** — la salida no es saltearlo: es escribir el test,
correrlo, **verlo fallar**, y que el motor lo verifique. La marca solo se
concede después de una corrida real.

**`task-scope-guard`** — si el archivo hace falta de verdad, declaralo con
`noxloop add-target <item> <tarea> <ruta> "<por qué>"`. Queda en el PR.

**`no-prod-writes`** — no hay forma legítima de rodearlo. Si hace falta, se le
pide a una persona.

Los tres comparten un principio: **ante la duda, permitir**. Corren en cada
operación de la sesión, también cuando noxloop no está activo.

## Retomar

```bash
noxloop status                 # qué recorridos hay
noxloop status <item>          # el detalle
noxloop resume <item>          # continuar
```

La tarea que quedó a medias conserva sus intentos: retomar no regala
presupuesto. Si su worktree está sucio, decidí antes de seguir — o se completa,
o se registra por qué quedó así, o se bloquea.
