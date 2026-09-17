# Paralelismo: la regla, la cola, y el fallo medido que las dos evitan

Para quien va a confiarle un hito a esto y quiere saber por qué no le va a
devolver tres ramas en conflicto.

Hay tres documentos y no se solapan:

- [`README.md`](../README.md) — **el argumento** en cinco líneas: el paralelismo
  lo gobierna el DAG.
- [`specs/001-parallel-ticket-orchestrator/research.md`](../specs/001-parallel-ticket-orchestrator/research.md)
  (D5) — **la decisión** con las alternativas que se descartaron y por qué.
- este — **el mecanismo**: qué hace el código hoy, y qué fallo concreto evita
  cada parte. Nada de acá es normativo; si algo discrepa, manda
  [la constitución](../.specify/memory/constitution.md) (principio V), y después
  el código.

---

## La regla, entera y en una frase

**Una tarea corre si ninguna de sus dependencias duras está sin integrar.**

Sin **integrar**, no "sin terminar". Es la palabra que carga toda la decisión.
Una tarea puede estar `gated` —su gate dio exit code 0— y seguir sin habilitar a
nadie: su código todavía no está en la rama del ticket, así que quien ramifique
encima está ramificando sobre trabajo que puede volver atrás, rebasarse distinto
o ser rechazado por la cola. En `scheduler.mjs` la regla es literal: la
dependencia se compara contra `integrated` y contra nada más.

Los estados que el scheduler mira son tres grupos, y no hay un cuarto:

| Grupo | Estados | Qué significa para el scheduler |
|---|---|---|
| Terminales | `integrated`, `blocked` | no va a avanzar más |
| En vuelo | `in_progress`, `red`, `green`, `gated`, `reviewed`, `queued` | ocupa un lugar del ancho |
| Candidata | `pending` | puede arrancar si sus duras están integradas |

`blocked` es terminal para el scheduler: una tarea bloqueada no vuelve al
conjunto por sí sola. Vuelve cuando alguien la devuelve **explícitamente** a
`pending` o a `in_progress` —la única arista hacia atrás que la máquina de
estados permite además del retorno a `green`—.

`readySet(run, opts)` es una **función pura sobre el estado**: recibe un
recorrido, devuelve un conjunto. No lanza nada, no escribe nada y no recuerda
nada. Lo último es deliberado: cachear el conjunto listo es exactamente cómo un
scheduler lanza dos veces la misma tarea —entre el cálculo y el lanzamiento el
estado cambió y el conjunto viejo ya no es cierto—, así que se recalcula desde
el disco en cada vuelta del driver. Es barato y es correcto.

---

## El fallo medido: catorce ramas encadenadas

La razón de que la regla diga "integrada" no es teórica.

Un recorrido anterior ejecutó **catorce tareas ramificando cada una de la
anterior**: cada tarea nacía del trabajo no integrado de la que la precedía.
Cuando las **diez primeras** se integraron, **las tres siguientes llegaron en
conflicto**: la base se había movido debajo de ellas mientras trabajaban.

La corrección de entonces fue **serializar todo en una sola rama**. Resuelve el
conflicto —y elimina el paralelismo. Es la respuesta correcta a la pregunta
equivocada: el problema no era que hubiera varias tareas a la vez, era que
ramificaban sobre trabajo que todavía no existía en ningún lugar estable.

La cola de integración es lo que permite tener las dos cosas: **aislamiento real
durante la ejecución, integración ordenada al terminar cada tarea.**

---

## La cola: tres pasos, y el orden de los dos primeros es el punto

`merge-queue.mjs` procesa las tareas en `queued` de a una, en orden topológico,
y para cada una hace esto sin excepción:

1. **rebasa** la rama de la tarea sobre la punta **actual** de la rama del ítem;
2. **vuelve a correr el gate**, sobre la base rebasada;
3. **integra con fast-forward**, que por construcción no puede conflictuar.

**El gate corre después del rebase, y ahí está toda la decisión.** Un verde
sobre una base vieja no dice nada sobre la base en la que el código va a vivir:
dice que el código funcionaba contra un pasado. Verificar antes del rebase es la
versión sofisticada de no verificar — produce un objeto de gate con su exit code
real, que es evidencia legítima de una pregunta que a nadie le importa.

Dos asimetrías declaradas, para que nadie las descubra leyendo el código:

- La re-verificación usa el **gate rápido** (`fastGate`). Si el repositorio no
  declara uno, cae al completo: nunca se inventa una versión corta, porque un
  gate más corto que el declarado no es el gate del repositorio.
- La cola es **serial y eso no es una limitación pendiente de optimizar**: es el
  mecanismo. Dos integraciones simultáneas sobre la misma rama son el problema
  que la cola resuelve.

### Poner la rama del ítem al día: la pieza existe y `run` no la usa

`merge-queue.mjs` exporta `syncItemBranch`, que rebasa la rama del ítem sobre su
base antes de que empiece cualquier tarea. El motivo es de costo: arrancar sobre
una base vieja significa que cada tarea va a rebasar contra algo que ya cambió, y
el conflicto aparece al integrar —cuando ya hay catorce ramas— en vez de al
empezar, cuando no hay ninguna.

**Hoy `noxloop run` no la llama.** El único importador es el recorrido de hito,
que todavía no está enganchado al CLI. Lo que hace `run` es crear el worktree del
ítem desde la base **la primera vez** (`makeResolve`, en `wiring.mjs`) y nada
más: si ese worktree ya existe de un recorrido anterior, la rama del ítem se
queda donde quedó, y las tareas de hoy rebasan sobre la base de entonces.

Se declara porque es exactamente el fallo que la función existe para evitar, y
porque el borde tiene una forma concreta de evitarse a mano: antes de un `run`
sobre un ítem viejo, poné la rama al día en su propio worktree.

```bash
git -C "$NOXLOOP_HOME/worktrees/<repo>/item-<id>" fetch origin <base>
git -C "$NOXLOOP_HOME/worktrees/<repo>/item-<id>" rebase origin/<base>
```

La rama del ítem vive en su **propio worktree** (`worktrees/<repo>/item-<id>`) y
no en el checkout principal: ese checkout puede tener trabajo de una persona, y
la cola tiene que poder hacer fast-forward sin pelearse con nadie.

### Un rechazo no contamina

Si el rebase conflictúa, o si el gate falla después de rebasar, o si el
fast-forward no procede:

- la tarea vuelve a `green` con la **causa textual** como `lastFailure`;
- la rama del ítem queda **exactamente como estaba**;
- el recorrido **sigue con las demás**.

Tres detalles del rechazo que son cicatrices, no elegancia:

- **Abortar el rebase no es opcional.** Sin `rebase --abort`, el worktree queda
  en medio de un rebase y cada reintento posterior falla antes de empezar, con
  un error que no tiene nada que ver con la causa real.
- **El fast-forward que no procede no se fuerza.** Si después de un rebase
  limpio el `merge --ff-only` falla, es que la punta se movió entre el rebase y
  el merge: otro proceso está tocando la rama. La tarea vuelve al bucle y la
  próxima vuelta rebasa sobre la punta nueva.
- **Volver a `green` exige decir por qué.** La máquina de estados rechaza ese
  retroceso sin causa, y al hacerlo **borra la evidencia del gate**: era de otro
  código, el de antes del arreglo que viene. `redVerified` no se pierde — el
  test sigue existiendo y sigue habiendo fallado alguna vez.

Y la contracara: `integrated` **solo lo puede escribir la cola**. La guarda de
`state.mjs` compara el actor y rechaza la transición desde cualquier otro lugar,
porque una tarea marcada como integrada sin haber pasado por el rebase y la
re-verificación es el verde inventado del principio II con otro nombre.

---

## `blocked` vs `unreachable`: por qué el reporte final solo sirve si los separa

`readySet` devuelve las dos categorías por separado, y son problemas distintos:

- **`blocked`** es una tarea que **falló**: agotó un presupuesto, no llegó a un
  rojo verificado, su gate no pasó, la revisión siguió encontrando hallazgos.
  Bloquear **exige la causa real** —la máquina de estados lanza sin ella—, así
  que una tarea bloqueada siempre viene con su diagnóstico.
- **`unreachable`** es una tarea que **nunca pudo intentarse**: depende, directa
  o transitivamente y siempre por una arista **dura**, de una bloqueada. No
  tiene causa propia porque no tiene fallo propio.

Juntarlas en una sola lista es lo que vuelve inútil el reporte. Una tarea que
falló pide un diagnóstico: hay que leer su `lastFailure` y decidir. Una tarea
inalcanzable no pide nada de eso: pide **destrabar otra cosa**. Un reporte que
dice "cinco tareas bloqueadas" manda a revisar cinco fallos donde hay uno.

El cálculo es un cierre transitivo sobre aristas duras, y se salta lo ya
integrado: una tarea integrada no se vuelve inalcanzable porque alguien de quien
dependía se bloquee después.

---

## Las dependencias blandas: no bloquean y no arrastran

`dependencyKind` tiene dos valores:

- **`hard`** — la tarea no arranca hasta que sus `dependsOn` estén integradas, y
  si alguna se bloquea, ella se vuelve `unreachable`.
- **`soft`** — la tarea **arranca igual** y **no se arrastra**: asume el
  contrato de la otra y lo declara. En el scheduler son dos líneas simétricas:
  al calcular candidatas, una tarea blanda no mira sus dependencias; al calcular
  inalcanzables, una arista blanda no propaga el bloqueo.

El criterio para elegir, que es lo que de verdad hay que decidir al planificar:

> `hard` si la tarea no compila ni pasa sin la anterior integrada. `soft` si
> puede asumir el contrato y declararlo. **Ante la duda, `hard`.**

Y la razón de que la duda se resuelva para el lado lento: **un recorrido lento
se nota y se corrige; un PR roto contamina la rama.** Marcar `hard` de más
serializa el recorrido —se ve en el reporte, se ve en el reloj, y se arregla
cambiando un campo del plan—. Marcar `soft` de más produce una tarea que compiló
contra un contrato que todavía no existe, y eso llega al PR con el gate en
verde.

**Una precisión sobre lo que el modelo de datos permite hoy**, para que nadie se
lleve una sorpresa: `dependencyKind` es un campo **de la tarea**, no de cada
arista. Una tarea marcada `soft` trata como blandas **todas** sus dependencias.
Si una tarea necesita esperar a una y puede asumir la otra, hoy eso no se
expresa: se parte en dos tareas, o se declara `hard` y se paga la serialización.

---

## El aislamiento: un worktree por tarea

Cada tarea paralela vive en su propio worktree de git
(`worktrees/<repo>/<itemId>-<taskId>`), sobre su propia rama
(`task/<itemId>-<taskId>`), nacida de la rama del ítem.

No es comodidad. Con dos tareas del mismo repositorio corriendo a la vez, un
árbol de trabajo compartido significa que **el gate de una mide el código de la
otra**, y entonces el veredicto deja de significar algo — que es peor que no
tener veredicto, porque se persiste como evidencia. Un worktree y no un clon
porque comparte los objetos de git y aísla solo el árbol, que es exactamente lo
que hace falta; y nunca el checkout principal, que puede tener trabajo de una
persona.

El ancho del paralelismo es **configuración, no descubrimiento**
(`limits.maxParallelTasks`, 4 por defecto): el techo real lo pone la cuota del
proveedor del modelo y la máquina, y el motor no intenta averiguarlo. Dos
detalles del recorte:

- **El ancho cuenta las que ya corren.** Los lugares libres son el ancho menos
  las que están en vuelo menos las reclamadas. Un ancho que solo mira las nuevas
  no es un ancho: es un mínimo.
- **Las reclamadas se pasan explícitamente**, no se deducen del estado: entre
  reclamar una tarea y escribir su estado hay una ventana, y esa ventana es
  donde se duplica el trabajo.

Cuando el ancho recorta, el lugar se da en **orden topológico estable**. Estable
a propósito: dos recorridos del mismo plan tienen que poder compararse.

Y un proceso por recorrido: el lock de `lock.mjs` impide que dos procesos
recorran el mismo ítem, porque dos recorridos sobre el mismo ítem no producen el
doble de trabajo — producen dos veces la misma tarea, dos PRs y un estado que
ninguno de los dos escribió entero.

---

## El puntero de tarea activa, y el fallo que destapó el paralelismo

Los hooks que fuerzan TDD y alcance corren como procesos aparte, sin acceso a la
configuración ni a la sesión: leen el estado en disco y ahí tiene que estar
escrito **cuál es la tarea activa**.

El puntero era **uno solo**, y con el paralelismo dejó de alcanzar: con N tareas
en vuelo, **el guardián de alcance de una bloqueaba los archivos de otra**, y el
de orden medía el rojo de la tarea equivocada. No lo encontró un test: lo
destapó el paralelismo al existir (T086 en `tasks.md`).

Hoy hay **un puntero por worktree** (`active-tasks/<slug>.json`), y el hook
resuelve cuál le toca por el worktree del que viene la operación —el `cwd` de la
sesión, o la ruta del archivo que se va a escribir—. Tres decisiones sobre esa
resolución, cada una con su fallo detrás:

- **El worktree más específico gana.** Con uno anidado dentro de otro, el
  externo también coincide, y elegirlo sería elegir la tarea equivocada.
- **Con varias activas y sin pista, no se adivina**: devuelve `null` y el hook
  permite. Adivinar es la forma de que el guardián de alcance de una tarea
  policíe archivos ajenos. Sobre-resolver es sobre-bloquear.
- **Las rutas se comparan resueltas** (`realpath`), no por su grafía. Con el
  home bajo `/var/folders` —ruta real `/private/var/folders` en macOS— y dos
  tareas activas, la sesión reportaba una grafía y el puntero guardaba la otra:
  no había respaldo de "la única activa", así que la resolución devolvía `null`
  y **la guarda permitía todo, justo cuando tenía que actuar** (T094).

Se sigue aceptando un puntero **sin** worktree, como entrada `_global`, para un
recorrido serial: ahí el puntero vale para toda la sesión.

---

## La carrera de pérdida de actualización

El paralelismo trajo un bug propio, y es el que más cuesta reconocer desde el
síntoma.

Dos tareas concurrentes sostenían **su propia copia del recorrido entre
`await`s**. Cada una mutaba su copia y la guardaba entera, así que **la última
en guardar borraba lo que había escrito la otra**. Lo que se observó no fue un
error de estado: fue **una tarea que perdía su worktree, volvía a `pending`,
intentaba crear el worktree de nuevo y moría** — con el error apareciendo en el
lugar equivocado, a dos pasos de la causa (T087).

El arreglo es que **toda mutación de estado lee el disco de nuevo antes de
escribir**: `conEstadoFresco()` carga el recorrido fresco, aplica la mutación
sobre él, guarda, y deja el objeto del llamador al día —incluida la parte que
escribió la otra tarea mientras tanto—.

Es seguro **sin locks** por una razón concreta y no por optimismo: esas
funciones son **síncronas**. Dentro de una función síncrona no hay interleaving
posible en Node, así que leer, mutar y escribir es atómico frente a cualquier
otra tarea del mismo proceso. La carrera nunca estuvo en la escritura: estaba en
sostener el objeto entre `await`s. Y la escritura es atómica frente al resto del
sistema por temporal + `rename`, así que un corte a mitad no deja un estado
leído a medias.

---

## Dónde entra el paralelismo en el código: un solo punto

En `driver.mjs`, un `Promise.allSettled` sobre el conjunto que devuelve el
scheduler. Todo lo que lo hace seguro —el DAG, la cola, el lock, el puntero por
worktree, la lectura-modificación-escritura— está probado aparte y **antes**. No
se implementó concurrencia para después agregarle guardas.

El bucle de cada vuelta es:

1. leer el recorrido **del disco**;
2. `readySet` → lanzar en paralelo lo que quepa en el ancho (`allSettled`, no
   `all`: una tarea que falla no puede abortar a las demás, y el estado de cada
   una ya quedó en disco antes de que su promesa resuelva);
3. **drenar la cola**, que es lo que libera las dependencias duras de la vuelta
   siguiente — por eso la cola corre después de cada vuelta y no al final;
4. comparar la huella del estado con la de la vuelta anterior: si no cambió
   `limits.stallRounds` veces (2 por defecto), el recorrido **se corta**. Un
   recorrido que dejó de avanzar tiene que detenerse sin depender de que el
   modelo se dé cuenta.

Y una tarea, por su lado, tiene un tope de vueltas de su propia máquina de
estados (40). Sin ese tope, un estado que no avanza y no consume presupuesto
sería un bucle infinito silencioso.

### Retomar no reconstruye nada

El driver no tiene ningún "dónde iba" en memoria: es un `switch` sobre el estado
de la tarea, releído del disco en cada vuelta. Por eso retomar un recorrido
interrumpido es gratis.

Las tareas que quedaron **en vuelo** de un recorrido interrumpido se devuelven
aparte (`resumable()`), y no dentro del conjunto listo: una tarea a medias con
su worktree sucio necesita una **decisión** antes de seguir —completar el paso,
registrar por qué quedó así, o bloquearla con la causa— y meterla en el conjunto
listo la pisaría.

---

## Cómo se verifica, sin gastar un centavo

```bash
node --test packages/engine/test/scheduler.test.mjs        # la regla y el reporte
node --test packages/engine/test/merge-queue.test.mjs      # la cola, con conflicto real
node --test packages/engine/test/active-tasks.test.mjs     # el puntero por worktree
node --test packages/engine/test/state-concurrencia.test.mjs  # la carrera
```

El test del scheduler recorre la tabla del escenario 2 de
[`quickstart.md`](../specs/001-parallel-ticket-orchestrator/quickstart.md) sobre
un DAG conocido —T1 y T2 sin dependencias, T3 dura sobre T1, T4 sobre T3—
incluyendo el caso que define la regla: **con T1 en `gated` y no integrada, T3
no arranca**.

El de la cola crea un repositorio git temporal y **dos ramas que tocan la misma
línea del mismo archivo**: la primera se integra, la segunda se rebasa sobre la
punta nueva, el rebase falla, la tarea vuelve a `green` con el conflicto
textual, y la rama base queda intacta. Es el fallo de las catorce ramas
reproducido en miniatura, y verificado.

Ninguno de los cuatro necesita red, credenciales ni modelo.

---

## Lo que este documento no promete

- **Todo lo de arriba es el ancho de un ítem: tareas de una misma historia.**
  El esquema declara un segundo ancho, el de **historias de un hito**
  (`limits.maxParallelItems`, 2 por defecto), pero **hoy no lo aplica ningún
  camino del CLI**: los únicos que lo leen son el recorrido de hito y el daemon,
  y los dos salen con `todavia no esta implementado`. Declararlo en la
  configuración no cambia nada por ahora. Cuando entre, la regla que va a
  obedecer es la misma extendida: **si el gestor de tickets no soporta
  dependencias entre tickets, ese ancho es 1**, porque un ancho mayor sobre un
  orden que nadie afirma es el paralelismo por optimismo que prohíbe el
  principio V.
- **SC-002 —un hito de tres historias en menos del 60% de la suma— es un
  objetivo, no una medición.** Lo que está medido es el punto de partida serial:
  14,5 min y $5,59 de media por invocación, sobre 133 invocaciones. La ganancia
  real del paralelismo se mide con un hito real, y ese número todavía no existe.
- **El test de concurrencia con N tareas sobre el mismo repositorio (T047) está
  pendiente.** Lo que hoy prueba el aislamiento es el worktree por tarea y la
  carrera de estado, por separado — las dos mitades, nunca las dos a la vez
  contra un repositorio de verdad.
