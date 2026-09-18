---
description: "Task list for 001-parallel-ticket-orchestrator"
---

# Tasks: Orquestador paralelo de tickets, agnóstico del gestor

**Input**: Design documents from `/specs/001-parallel-ticket-orchestrator/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: OBLIGATORIOS. El principio I de la constitución fija TDD como
mecanismo, no como preferencia: toda tarea con lógica nueva lleva su test ANTES
que la implementación, y ese test debe fallar contra el código viejo. El motor
se construye con la disciplina que impone.

**Organization**: Por historia de usuario, para que cada una se pueda
implementar, probar y entregar por separado.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede correr en paralelo (archivos distintos, sin dependencias abiertas)
- **[Story]**: A qué historia pertenece (US1..US5)
- Todas las rutas son relativas a la raíz del repositorio

---

## Phase 1: Setup

**Purpose**: Estructura del monorepo y verificación automática desde el primer commit

- [X] T001 Crear `package.json` raíz con workspaces (`packages/*`), scripts `test`, `typecheck`, `validate`, y Node ≥ 20 en `engines`
- [X] T002 [P] Crear `packages/engine/package.json` con `bin.noxloop` → `bin/noxloop.mjs`, `type: module`, y `@anthropic-ai/claude-agent-sdk` en `optionalDependencies`
- [X] T003 [P] Crear `packages/plugin/.claude-plugin/plugin.json` y `.claude-plugin/marketplace.json` en la raíz
- [X] T004 [P] Crear `.github/workflows/ci.yml`: `npm test`, `npm run typecheck`, `npm run validate` en Node 20 y 22
- [X] T005 [P] Crear `tsconfig.json` con `checkJs`, `noEmit` y `strict`, incluyendo `packages/engine/src` y `providers`
- [X] T006 [P] Crear `.gitignore`, `LICENSE` (MIT), `.editorconfig` y `.nvmrc`
- [X] T007 Copiar los tres esquemas de `specs/001-parallel-ticket-orchestrator/contracts/*.schema.json` a `packages/engine/schemas/` y agregar `npm run validate` que valide `examples/noxloop.config.json` contra el suyo

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Lo que toda historia necesita. Ninguna historia puede empezar antes.

**⚠️ CRÍTICO**: La interfaz de proveedor y el proveedor falso viven acá y no en
US3 porque US1 no se puede probar sin ellos. Los tres proveedores reales sí son
US3.

### Tests (OBLIGATORIO — TDD) ⚠️

> Escribí estos tests PRIMERO y verificá que FALLAN antes de implementar.

- [X] T008 [P] Test de configuración en `packages/engine/test/config.test.mjs`: carga válida, rechazo con mensaje accionable de una inválida, resolución de `${VAR:-default}`, y que un estado canónico sin mapear se reporte
- [X] T009 [P] Test de estado en `packages/engine/test/state.test.mjs`: cada transición con guarda del data-model, escritura atómica (corte a mitad deja el estado anterior íntegro), presupuestos por bucle independientes, y que retomar no devuelva intentos
- [X] T010 [P] Test de plan en `packages/engine/test/plan.test.mjs`: rechazo de ciclo **nombrando el ciclo**, `dependsOn` a un id inexistente, `repo` fuera de `repoScope`, y `testFiles` vacío sin `noTestsBecause`
- [X] T011 [P] Test de contrato de proveedor en `providers/contract.test.mjs`: los 8 puntos de `contracts/provider.md`, corriendo contra el proveedor falso
- [X] T012 [P] Test de guardas de constitución en `packages/engine/test/constitution.test.mjs`: `grep` de nombres propios en `packages/engine/src/**` devuelve vacío, y ninguna ruta puede escribir `gated` sin `gateEvidence.exitCode === 0`
- [X] T013 [P] Test de hooks en `packages/engine/test/hooks.test.mjs`: `tdd-order-guard` bloquea producción sin rojo en los cuatro tiers, `task-scope-guard` bloquea un archivo no declarado, `no-prod-writes` bloquea merge/deploy/force-push, y los tres **permiten todo** cuando no hay tarea activa
- [X] T014 [P] Test de gate en `packages/engine/test/gate.test.mjs`: devuelve el objeto con `exitCode` real, respeta el timeout marcando `timedOut`, distingue gate roto en la base de fallo de la tarea, y reporta los `gaps` declarados
- [X] T015 [P] Test de repositorios en `packages/engine/test/repos.test.mjs`: detecta que un checkout local no corresponde al remote declarado
- [X] T016 [P] Test de lock en `packages/engine/test/lock.test.mjs`: el segundo proceso no arranca e informa quién lo tiene; un lock huérfano de un proceso muerto se recupera

### Implementación

- [X] T017 [P] Implementar `packages/engine/src/log.mjs`: bitácora estructurada a stdout y archivo, con el recorrido y la fase en cada línea
- [X] T018 [P] Implementar `packages/engine/src/config.mjs`: carga, validación con `ajv` contra `schemas/config.schema.json`, resolución de rutas y de `${VAR:-default}`
- [X] T019 Implementar `packages/engine/src/plan.mjs`: validación de esquema más las tres reglas que el esquema no expresa (aciclicidad, integridad referencial, alcance)
- [X] T020 Implementar `packages/engine/src/state.mjs`: recorridos, tareas, transiciones con guarda, presupuestos explícitos, escrituras atómicas bajo `NOXLOOP_HOME`
- [X] T021 [P] Implementar `providers/contract.mjs`: la interfaz, el validador que carga un proveedor y verifica capacidades contra funciones, y `runContractSuite()`
- [X] T022 [P] Implementar `providers/fake/index.mjs`: proveedor en memoria, que es además el ejemplo mínimo que se copia para agregar uno nuevo
- [X] T023 [P] Implementar `packages/engine/src/repos.mjs`: resuelve el checkout de un repo y **verifica el remote** antes de devolverlo
- [X] T024 [P] Implementar `packages/engine/src/lock.mjs`: lock por hito y por recorrido, con recuperación de lock huérfano
- [X] T025 Implementar `packages/engine/src/gate.mjs`: único productor de veredictos, con `env` del repo, timeout y salida truncada
- [X] T026 [P] Implementar `packages/engine/src/worktree.mjs`: crear, listar y quitar espacios aislados; sin `--force` no descarta cambios sin commitear
- [X] T027 Implementar los cinco hooks en `packages/engine/src/hooks/`: `_shared.mjs`, `tdd-order-guard.mjs`, `task-scope-guard.mjs`, `no-prod-writes.mjs`, `state-checkpoint.mjs` — todos permiten ante la duda
- [X] T028 Implementar `packages/engine/src/doctor.mjs`: qué está declarado, qué falta, qué credencial no está, y el remote de cada repo
- [X] T029 Implementar `packages/engine/bin/noxloop.mjs`: enrutado de subcomandos de `contracts/cli.md`, salida JSON a stdout y prosa a stderr. Los subcomandos que aun no existen declaran que tarea los trae. **`--dry-run` queda para T038/T052**: no hay todavia ningun comando que simular, y un flag que no hace nada es peor que uno ausente

**Checkpoint**: El motor valida configuración, persiste estado con guardas, corre gates y bloquea lo que tiene que bloquear. Ninguna historia depende de otra para empezar.

---

## Phase 3: User Story 1 — Asignar un ticket es todo lo que hay que hacer (P1) 🎯 MVP

**Goal**: Un ticket con criterios verificables llega a PR abierto sin intervención.

**Independent Test**: Asignar un ticket en un proyecto de prueba y comprobar que aparece un PR cuyo historial tiene el test antes que la implementación, y que el ticket quedó comentado.

### Tests (OBLIGATORIO — TDD) ⚠️

- [X] T030 [P] [US1] Test del runner en `packages/engine/test/runner.test.mjs`: retoma la sesión entre fases de una tarea (mismo `sessionId`), abre sesión nueva entre tareas, detecta el corte por presupuesto como corte y **nunca** como `ok`, y degrada al CLI cuando el SDK no está
- [X] T031 [P] [US1] Test del forge en `packages/engine/test/forge.test.mjs`: el cuerpo del PR se arma desde el estado —criterios, `gateEvidence` textual, `gaps`, `addedTargets`, tareas bloqueadas— y no de prosa del modelo
- [X] T032 [P] [US1] Test de idempotencia del gestor en `packages/engine/test/provider-writes.test.mjs`: relanzar no mueve el ticket dos veces ni duplica comentarios (`providerStateWritten`)
- [X] T033 [US1] Test de integración de la historia en `packages/engine/test/us1-ticket-to-pr.test.mjs`: proveedor falso + repositorio git desechable, recorrido completo hasta rama lista, verificando el orden test→implementación en el historial de commits
- [X] T034 [P] [US1] Test de ticket sin criterios verificables en `packages/engine/test/us1-no-acceptance.test.mjs`: no se escribe código y el ticket queda bloqueado con la pregunta concreta
- [X] T035 [P] [US1] Test de autonomía en `packages/engine/test/autonomy.test.mjs`: 16 casos en cuatro bloques. **Al escribirlo encontró dos bugs reales del hook**: un flag global de git (`git -C /x push --force`) desarmaba la guarda entera, y un refspec (`HEAD:refs/heads/production`) la esquivaba buscando esas operaciones

### Implementación

- [X] T036 [US1] Implementar `packages/engine/src/runner.mjs`: una fase = una sesión del SDK con `resume` dentro de la tarea, stream de progreso, `budgetExhausted` como campo propio, y degradación al CLI
- [X] T037 [P] [US1] Implementar `packages/engine/src/forge.mjs`: envoltorio determinista del CLI del forge, armado del cuerpo del PR desde el estado, e idempotencia si el PR ya existe
- [X] T038 [US1] Implementar `packages/engine/src/driver.mjs`: el bucle de un item — abrir, RED, GREEN, GATE, REVIEW, cerrar — decidiendo por código de salida y estado, nunca por la prosa del modelo
- [X] T039 [US1] Implementar la detección de revisión ausente en `driver.mjs`: una tarea que llega a terminal con `attempts.review === 0` recibe la revisión que falta antes del PR, con dos oportunidades
- [X] T040 [P] [US1] Implementar `packages/engine/src/dispatch.mjs`: resuelve el nivel del ticket con el proveedor y delega; `plan` para `story`/`task`, `milestone` para `epic`/`feature`
- [X] T041 [P] [US1] Escribir los comandos del plugin `packages/plugin/commands/noxloop-plan.md` y `noxloop-run.md`
- [X] T042 [P] [US1] Escribir los agentes del plugin en `packages/plugin/agents/`: `planner.md`, `implementer.md`, `verifier.md`, `reviewer.md`. **`analyst` y `scribe` no se escribieron, y no por falta de tiempo**: el análisis del ticket es inseparable de armar el DAG y quedó dentro de `planner`, y el trabajo del escriba lo hace el motor llamando al proveedor — un agente que escriba en el gestor es un agente que puede escribir de memoria un nombre de estado
- [X] T043 [P] [US1] Escribir `packages/plugin/hooks/hooks.json` apuntando a los hooks del motor, y la skill `packages/plugin/skills/tdd/SKILL.md`

**Checkpoint**: US1 entregable. El producto ya sirve para un ticket a la vez.

---

## Phase 4: User Story 2 — Un hito se cierra completo, y en paralelo (P1)

> **Nota de ejecucion**: `scheduler.mjs` y `merge-queue.mjs` (T044, T045, T049,
> T050) se adelantaron a la fase 3. La dependencia declarada de US2 sobre US1 es
> sobre **T052** —implementar concurrencia encima de un bucle de tarea que
> todavia no es solido multiplica los fallos del bucle— y esos dos modulos son
> funciones sobre el estado y sobre git, probables de forma aislada y sin
> modelo. Construirlos antes baja el riesgo en vez de subirlo: son la parte que
> mas cuesta acertar, y ahora estan acertadas con un conflicto de git real.

**Goal**: Una aprobación, N historias, tareas independientes en paralelo e integración ordenada.

**Independent Test**: Una épica con tres historias sin dependencias avanza en tres worktreesa la vez y termina en un tiempo cercano al de la más lenta.

### Tests (OBLIGATORIO — TDD) ⚠️

- [X] T044 [P] [US2] Test del scheduler en `packages/engine/test/scheduler.test.mjs`: la tabla completa del escenario 2 de `quickstart.md`, incluyendo `blocked` vs `unreachable` y el recorte por `maxParallelTasks`
- [X] T045 [P] [US2] Test de la cola en `packages/engine/test/merge-queue.test.mjs`: repositorio git real, dos ramas que tocan la misma línea, rebase que falla, tarea que vuelve a `green` con el conflicto textual, rama base intacta, y gate **después** del rebase
- [X] T046 [P] [US2] Test de hito en `packages/engine/test/milestone.test.mjs`: orden desde dependencias cuando el proveedor las tiene, serialización declarada cuando no, `--skip` y `--only`, y el reporte final de bloqueadas e inalcanzables
- [X] T047 [US2] Test de concurrencia en `packages/engine/test/parallel.test.mjs`: N tareas concurrentes sobre el mismo repositorio mantienen el estado consistente y ninguna observa los cambios sin integrar de otra
- [X] T048 [P] [US2] Test del techo por hito en `packages/engine/test/milestone-budget.test.mjs`: al alcanzarlo el recorrido se detiene ordenadamente, sin cortar una tarea a mitad

### Implementación

- [X] T049 [US2] Implementar `packages/engine/src/scheduler.mjs`: orden topológico, dependencias duras contra `integrated`, recorte por ancho, y cálculo de `unreachable`
- [X] T050 [US2] Implementar `packages/engine/src/merge-queue.mjs`: cola serial, rebase sobre la punta, re-verificación con el gate rápido, e integración o rechazo con la causa
- [X] T051 [US2] Implementar `packages/engine/src/milestone.mjs`: rama del hito, orden de items, exclusiones declaradas antes de arrancar, notas como canal de vuelta, y contabilidad de gasto
- [X] T052 [US2] Extender `driver.mjs` a ejecución concurrente: lanzar el ReadySet, esperar la primera que termine, recalcular desde disco, y respetar `maxParallelItems`
- [X] T053 [P] [US2] Escribir `packages/plugin/workflows/planning-fanout.mjs`: `pipeline` analista → planificador → materialización con salida validada por esquema
- [X] T054 [P] [US2] Escribir `packages/plugin/workflows/review-fanout.mjs` y `packages/plugin/agents/review-fanout.md`: revisores en paralelo con una lente cada uno, solo en tier `large`
- [X] T055 [P] [US2] Escribir `packages/plugin/commands/noxloop-milestone.md`

**Checkpoint**: US2 entregable. El paralelismo es observable y la integración no produce el fallo de las ramas encadenadas.

---

## Phase 5: User Story 3 — Funciona con el gestor que ya usás (P2)

**Goal**: Tres gestores, el mismo recorrido, y un cuarto en un archivo.

**Independent Test**: La misma suite de contrato pasa para los tres, y un proveedor nuevo pasa sin tocar el motor.

### Tests (OBLIGATORIO — TDD) ⚠️

- [X] T056 [P] [US3] Test de contrato de Azure DevOps en `providers/azure-devops/index.test.mjs`, con respuestas grabadas y sin red
- [X] T057 [P] [US3] Test de contrato de GitHub en `providers/github/index.test.mjs`, incluyendo el camino degradado de `dependencies: false`
- [X] T058 [P] [US3] Test de contrato de Linear en `providers/linear/index.test.mjs`, incluyendo relaciones `blocks`/`blocked_by`
- [X] T059 [P] [US3] Test de degradación en `providers/degradation.test.mjs` (+ `degradation-fakes.mjs`): una fila por capacidad de la tabla de `contracts/provider.md`. Vive en `providers/` y no en `packages/engine/`, que es donde lo ponía el plan: lo que prueba es el contrato, no el motor

### Implementación

- [X] T060 [P] [US3] Implementar `providers/azure-devops/index.mjs`: WIQL, jerarquía, `Predecessor`/`Successor`, comentarios, `Hyperlink` para el PR, y mapa de tipos por plantilla de proceso
- [X] T061 [P] [US3] Implementar `providers/github/index.mjs`: issues, sub-issues, labels, y orden serializado declarado por falta de dependencias nativas — confirmando la forma de la API vigente contra su test antes de escribirlo
- [X] T062 [P] [US3] Implementar `providers/linear/index.mjs`: GraphQL, `parent`/sub-issues, relaciones, estados de workflow
- [X] T063 [P] [US3] Escribir `providers/README.md`: los cinco pasos para agregar un gestor, con Jira como ejemplo trabajado
- [X] T064 [P] [US3] Escribir `docs/PROVIDERS.md`: la interfaz explicada, con la tabla de degradación

**Checkpoint**: US3 entregable. El agnosticismo está probado, no afirmado.

---

## Phase 6: User Story 4 — Un recorrido interrumpido se retoma (P2)

**Goal**: Interrumpir no cuesta el hito.

**Independent Test**: Matar el proceso a mitad y relanzar produce el mismo resultado final.

### Tests (OBLIGATORIO — TDD) ⚠️

- [X] T065 [P] [US4] Test de reanudación en `packages/engine/test/resume.test.mjs`: no repite tareas `integrated`, conserva intentos, y el resultado final coincide con el de la corrida sin interrupción
- [X] T066 [P] [US4] Test de worktree huérfano en `packages/engine/test/worktree.test.mjs`: se detecta, y solo se limpia si no tiene cambios sin commitear
- [X] T067 [P] [US4] Test de `unstick`: registra la decisión y devuelve la tarea al bucle sin implementar nada

### Implementación

- [X] T068 [US4] Implementar `resume` en `bin/noxloop.mjs` y la recuperación de tareas a medias en `driver.mjs`: decidir antes de seguir, nunca pisar
- [X] T069 [P] [US4] Implementar la limpieza de worktrees huérfanos en `worktree.mjs`
- [X] T070 [P] [US4] Implementar `unstick` en `bin/noxloop.mjs` y `state.mjs`
- [X] T071 [P] [US4] Escribir `packages/plugin/commands/noxloop-status.md` y la skill `packages/plugin/skills/orchestration/SKILL.md`

**Checkpoint**: US4 entregable.

---

## Phase 7: User Story 5 — Instalable por alguien que no lo escribió (P3)

**Goal**: Del clone al primer ticket cerrado, con el README solo.

**Independent Test**: Una máquina limpia, siguiendo solo `docs/ADOPTING.md`.

### Tests (OBLIGATORIO — TDD) ⚠️

- [X] T072 [P] [US5] Test de la configuración de ejemplo: `examples/noxloop.config.json` valida contra el esquema y `doctor` la acepta
- [X] T073 [P] [US5] Test de `doctor`: enumera cada carencia por separado y no inventa ningún valor por defecto que pueda escribir en el lugar equivocado

### Implementación

- [X] T074 [P] [US5] Escribir `examples/noxloop.config.json` (+ `examples/README.md`), comentado y listo para copiar. **Adelantada desde la fase 7**: `npm run validate` la necesita para poder correr en CI desde el primer commit. `gates.example.json` no hizo falta: los gates viven dentro de la configuracion, no en un archivo aparte
- [X] T075 [P] [US5] Escribir `README.md`: qué es, el argumento, instalación, y el primer ticket en cinco comandos
- [X] T076 [P] [US5] Escribir `docs/ADOPTING.md`: instalación en una organización nueva, paso por paso
- [X] T077 [P] [US5] Escribir `docs/PARALLELISM.md` y `docs/AUTONOMY.md`: el DAG, la cola y dónde termina la autonomía, cada uno con el fallo que evita
- [X] T078 [P] [US5] Escribir `docs/MIGRATING.md`: cómo mover un harness existente atado a un gestor a esta estructura

**Checkpoint**: US5 entregable. El proyecto es publicable.

---

## Phase 8: Polish & Cross-Cutting

- [X] T079 [P] Implementar `inbox` y `daemon` en `bin/noxloop.mjs`: consulta periódica con deduplicación por ticket, instancia única por lock
- [X] T080 Resolver la pregunta abierta 3 de `research.md` con un test: pedir un merge desde una sesión headless lanzada por el motor y verificar que lo intercepta. **Cerrado y medido**: `--settings` (CLI) y `options.settings` / `options.hooks` (SDK) funcionan, verificado en una sesión real, dentro de un subagente y en una sesión retomada, con el plugin **sin instalar**. Lo implementa `session-settings.mjs`, y `runner.mjs` se niega a lanzar una sesión sin guardas
- [X] T081 [P] Dejar `npm run typecheck` (`tsc --checkJs`) en verde sobre todo el motor y los proveedores. **Adelantada**: corrio contra el codigo de la fase 2 y encontro 17 errores reales (acumuladores inferidos como `never`, `home` opcional pasado a una firma que lo exige, el `code` de un error de spawn sin tipar). Arreglarlos despues habria sido arqueologia
- [X] T082 [P] Escribir `CHANGELOG.md` y `CONTRIBUTING.md`
- [X] T083 [P] Agregar al CI en `.github/workflows/ci.yml` la guarda de nombres propios y la validación de los ejemplos
- [~] T084 Verificar los ocho escenarios de `quickstart.md` de punta a punta y registrar el resultado real de cada uno. **Los ocho corridos y registrados al pie de `quickstart.md`**; los escenarios 4, 5 y 8 quedaron verificados solo en su mitad offline y ahí está dicho por qué. Lo que falta no es código: una credencial de un gestor real y un ticket de prueba

---

## Tareas descubiertas durante la ejecución

El plan no las previó y aparecieron al implementar. Se registran acá y no se
disimulan: cada una es un hueco que el plan tenía.

- [X] T085 Implementar `packages/engine/src/planner.mjs` con `packages/engine/test/planner.test.mjs`. **El plan daba por hecho que el plan de una historia existía**; nadie lo producía. Es la fase que lee el ticket, verifica que tenga criterios antes de gastar una invocación, valida lo que el modelo devuelve y materializa los tickets hijos
- [X] T086 Puntero de tarea activa **por worktree** en `state.mjs`, con `packages/engine/test/active-tasks.test.mjs`. El puntero era único, y con N tareas a la vez los hooks no podían saber cuál les tocaba: el guardián de alcance de una bloqueaba los archivos de otra. Lo destapó el paralelismo, no un test
- [X] T087 Lectura-modificación-escritura en toda mutación de estado, con `packages/engine/test/state-concurrencia.test.mjs`. **Bug de pérdida de actualización**: dos tareas concurrentes sostenían su propia copia del recorrido entre `await`s y la última en guardar borraba lo de la otra. El síntoma observado fue una tarea que perdía su worktree, volvía a `pending` y moría intentando crearlo de nuevo
- [X] T088 `packages/engine/src/vcs.mjs` con `packages/engine/test/vcs.test.mjs`: **dos commits por tarea**, el del test antes del de la implementación. El driver no commiteaba nada, y la cola rebasaba ramas sin contenido — los tests pasaban porque solo miraban estados. Sin esto, SC-003 no se puede verificar en el historial del PR
- [X] T089 `packages/engine/src/comandos.mjs` y `wiring.mjs`: la capa entre el CLI y el motor. El plan ponía el cableado en `bin/`, donde no se puede probar
- [X] T090 Renuncia explícita a la revisión (`reviewWaived`) en `state.mjs`. Un tier con `review: false` no podía encolar nunca, porque la guarda exige el contador en más de cero. La salida no es debilitar la guarda: es que la renuncia quede registrada y se reporte en el PR
- [X] T091 Marca de agua del estado del gestor en `driver.mjs`: relanzar un recorrido terminado movía el ticket **hacia atrás**, de "en revisión" a "en curso". Lo cachó el test de idempotencia, no una revisión
- [X] T092 Mover el archivo de handoff del plan a `NOXLOOP_HOME`. Estaba dentro del worktree del usuario, y lo atrapó la guarda de constitución del principio III: el estado y sus artefactos intermedios no se escriben dentro de un repositorio de trabajo

### Segunda ronda de descubiertas

Salieron de la verificación adversarial de T035/T080. Las ocho primeras las
encontró un escéptico con instrucción de romper la promesa, y **la rompió**: de
57 grafías de comando prohibido, 45 la sortearon, y una se ejecutó contra un
remoto real moviéndole la rama principal.

- [X] T093 **Invertir la guarda de Bash**: dentro de una tarea, denegar por defecto con una lista de permitidos derivada de la configuración del repositorio (`comandosPermitidos` en `wiring.mjs`, que viaja en el puntero de tarea activa porque el hook no tiene acceso a la configuración). Con `packages/engine/test/guard-inversion.test.mjs`, 26 casos. **Requirió enmendar la constitución a 1.1.0**: "ante la duda, permitir" queda acotado a las sesiones donde hay una persona del otro lado. Verificado por mí, aparte de los tests: de 28 grafías prohibidas pasan 0, y de 8 legítimas se bloquean 0
- [X] T094 H2 — `dentroDe` comparaba rutas sin `realpath`. Con el home bajo `/var/folders` (ruta real `/private/var/folders`) y dos tareas activas, `activeTaskFull` devolvía `null` y la guarda permitía todo: el hook se apartaba justo cuando tenía que actuar
- [X] T095 H3 — el motor nunca inyectaba `NOXLOOP_HOME` en la sesión que lanza. Quien declaraba `home` en el archivo en vez de exportarlo corría todas sus sesiones con los hooks mirando `~/.noxloop`: cero tareas activas, cero guarda. Ahora va en los dos transportes, junto con `NOXLOOP_GUARD_ALWAYS`
- [X] T096 H4 — `runSingleTest` interpolaba `{file}` y corría con `shell: true`, y `file` lo escribe el planificador (un modelo) sobre un esquema que aceptaba string libre. **Era el único camino donde el motor ejecutaba algo arbitrario por su cuenta, sin pasar por ningún hook.** Ahora va por argv sin shell, y el esquema del plan exige que una ruta sea una ruta
- [X] T097 H5 — `validateHookSettings` juntaba rutas que terminaran en `.mjs` y contaba. Decía `ok: true` con el hook de Bash apuntando a un archivo inexistente, con el nombre del evento mal escrito y con `PreToolUse` vacío. Ahora exige las cuatro guardas, cada una en su evento y su matcher, y nombra la que falta
- [X] T098 Chequeo 7 de la suite de contrato: validaba el **fixture**, no el proveedor. Ahora le pasa un mapa de estados incompleto y exige que el proveedor no invente el nombre nativo. Los tres proveedores ya pasaban, así que no cambió ningún comportamiento — cambió lo que el chequeo puede afirmar
- [X] T099 `contracts/provider.md` mandaba correr `node --test providers/<nuevo>/`, que **falla con `MODULE_NOT_FOUND` en Node ≥ 22** porque el runner ya no expande directorios. Quien adoptara el proyecto se comía un error ajeno a su proveedor en el paso 4 de cinco

### Tercera ronda de descubiertas

De los cuatro workflows del daemon, el hito, la reanudacion y la documentacion.
Los cuatro escepticos rompieron algo.

- [X] T100 **La carrera del lock**, que rompia la promesa de instancia unica. `acquire` decidia con `existsSync` y escribia despues: dos daemons que arrancan juntos caen los dos en la ventana. Medido con dos procesos reales: **16 de 25 arranques se tomaron el mismo lock**. El primer arreglo (`open` con `wx`) movio la ventana en vez de cerrarla —el archivo queda visible VACIO entre el `open` y el `write`, y el otro proceso lo lee ilegible y lo declara huerfano— y bajo a 18 de 20. El que cierra es `link`: el contenido se escribe en un temporal y el nombre final aparece en una sola operacion atomica que falla si ya existe. Con `packages/engine/test/lock-carrera.test.mjs`, que usa **procesos de verdad** apuntando a un instante acordado, porque la carrera no existe dentro de un proceso
- [X] T101 Un lock de **otra maquina** ya no se roba: `lock.mjs` trataba como huerfano cualquier lock cuyo host no fuera el propio, y con un `NOXLOOP_HOME` compartido eso son dos daemons sobre la misma bandeja sin que ninguno se entere. Y se recupera por antiguedad, porque respetarlo para siempre traba el recurso si esa maquina murio
- [X] T102 Un **pid reusado** ya no traba el recurso para siempre: `process.kill(pid, 0)` dice "vivo" si el sistema reasigno el pid, y sin techo de antiguedad el lock de un daemon muerto quedaba en pie culpando a un pid que no es un daemon
- [X] T103 **Transitorio no es rechazo.** La bandeja indexaba lo omitido por la huella del ticket, asi que un 502 del gestor a mitad de un despacho dejaba el ticket parado hasta que alguien le cambiara el titulo. Ahora una omision declara su clase: un rechazo del planificador no se arregla esperando, un fallo del mundo si — con espera creciente y con techo, y conservando la clase al refrescar (reponerla a `permanente` en cada vuelta convertia un fallo transitorio en definitivo en la primera pasada que lo mirara)
- [X] T104 **El techo de gasto no podia dispararse nunca.** El recorrido de un hito lee `run.spent.usd` para decidir si se detiene, y NADA del motor lo escribia: el techo existia en la configuracion, en el esquema y en el codigo que lo consulta. `addSpend` en `state.mjs` y el driver anotando cada invocacion, con costo o sin el
- [X] T105 **El cache de `makeResolve` era por repositorio**, y un hito resuelve varias ramas del mismo: la segunda historia habria trabajado en el worktree de la primera, y su gate habria medido el codigo ajeno. Ahora la clave incluye la rama
- [X] T106 **El test de punta a punta del cableado** (`packages/engine/test/e2e-asignar-a-pr.test.mjs`), que es el hueco que el esceptico del daemon marco con estas palabras: "nada de esto prueba el cableado; `despachar` esta inyectado en todos los tests". Setenta tests afirmaban sobre el bucle y cero sobre el recorrido. Ahora se inyecta **solo** lo que no puede existir sin cuenta —el modelo y el forge— y corre de verdad la bandeja, la deduplicacion, el despacho por nivel, el planificador, el estado con sus guardas, el scheduler, los worktrees, el gate, los dos commits y la cola
- [X] T107 El cableado al CLI de todo lo anterior: `inbox`, `daemon`, `milestone`, `diagnose`, `resume`, `unstick` y `prune`, mas el despachador real que la bandeja y el daemon usan, y las inyecciones que hacen probable ese camino
- [X] T108 `--dry-run` creaba el worktree de la tarea. Lo cacho el test de punta a punta

### Cuarta ronda: lo que encontro la revision en frio

Un agente que no escribio nada del proyecto siguio la documentacion corriendo
cada comando y contrastando cada afirmacion contra el codigo. Encontro **once
afirmaciones que el codigo no respaldaba** —las corrigio en la doc— y estos
fallos reales, que arregle yo:

- [X] T109 **La causa real del fallo al abrir el PR se tiraba.** `createPR`
  devuelve el stderr del forge y el resumen retornaba `pr: null` sin motivo, asi
  que el reporte decia "sin PR: no se llego a abrir" y la causa —la rama sin
  empujar, permisos, un PR que ya existe— se perdia. Es el mismo fallo que el
  motor prohibe en una tarea: nunca resumir un error a "falla el build"
- [X] T110 **`syncItemBranch` era codigo muerto en el camino de `run`.** Existia
  en la cola y solo la importaba el recorrido de un hito, asi que un
  `noxloop run` nunca ponia la rama del item al dia con su base: con el worktree
  del item venido de un recorrido anterior, cada tarea rebasaba contra algo que
  ya cambio y el conflicto aparecia **al integrar** en vez de al empezar — que es
  exactamente lo que la cola existe para evitar
- [X] T111 `requiredEnv` se iteraba sin comprobar que fuera una lista: un
  proveedor que lo exportara como string hacia que `doctor` lo recorriera
  caracter por caracter y reportara un problema por cada letra, en el comando
  cuyo valor es que la lista de carencias sea legible
- [X] T112 Cuatro textos que habian dejado de ser ciertos: `dispatch` decia que
  `milestone` no estaba implementado, `session-settings.mjs` seguia listando como
  sin confirmar lo que T080 confirmo y midio, el encabezado de
  `guard-inversion.test.mjs` decia 12 grafias y la lista tiene 18, y el
  comentario de `log.mjs` decia stdout cuando escribe en stderr
- [X] T113 `.specify/memory/.constitution-template.json` seguia versionado: es
  metadata de plantilla de spec-kit, la misma atribucion de terceros que el
  commit `dd5db29` vino a limpiar, y entro porque el `.gitignore` des-ignoraba
  `/.specify/memory/` entero

### Huecos declarados, abiertos a proposito

Ninguno es un olvido. Se declaran porque un hueco dicho vale mas que un verde
inventado.

- [x] T114 **`provider.options` se valida** contra el `optionsSchema` que declara cada proveedor. En `config.schema.json` es
  `{"type": "object"}` sin `properties` ni `additionalProperties`, asi que nada
  de lo que un proveedor real necesita ahi se describe ni se comprueba, y un
  proveedor no tiene forma de declarar el esquema de sus opciones. Una opcion
  mal escrita (`organization` por `organizacion`) pasa la validacion y falla a
  mitad de un recorrido — la clase de fallo que la decision D9 de `research.md`
  dice que validar vino a matar. El ejemplo lo esquiva porque no declara
  `options`, asi que el hueco no se ve desde la puerta de entrada. El arreglo
  natural era un `optionsSchema` opcional en el contrato de proveedor, y se
  construyo: la premisa de que "ninguno de los tres lo usaria" era falsa —
  azure-devops EXIGE organization, project y team; github usa owner y repo;
  linear teamId—. Los tres lo declaran, con `additionalProperties: false`, y hay
  un test que falla si el codigo lee una opcion que el esquema no describe
- [x] T115 **`doctor` prueba su rama degradada** con el detector inyectado.
  `sdkDisponible()` resuelve el paquete con `createRequire` y no acepta
  inyeccion, y como el SDK es `optionalDependency` un `npm ci` normal lo
  instala. O sea: el camino que el README promete —"si falta, se degrada a
  invocar el CLI y lo dice"— casi nunca se recorre en los tests. El test que
  existia era una bicondicional (ausente ⇔ hay aviso), que no prueba ni el
  mensaje ni que sea aviso y no problema. Ahora `doctor` acepta `sdkDisponible`
  por `opts` —la misma forma que ya usa para el reloj, los locks y la cola— con
  el detector de produccion como default, y hay un test que verifica que doctor
  y el runner coincidan: si difieren, uno de los dos miente
- [ ] T116 **El merge local en dos tiempos** (`git checkout main` y despues
  `git merge task/x`) no lo frena el hook. No se cerro porque bloquear
  `checkout` es el sobre-bloqueo que este hook ya cometio una vez, y la salida a
  lo compartido si esta cerrada: publicarlo exige un `git push origin main`, que
  esta probado bloqueado

## Dependencies

```
Phase 1 (Setup)
   ↓
Phase 2 (Foundational) ← bloquea todo
   ↓
Phase 3 (US1, P1) ─────────┐
   ↓                       │
Phase 4 (US2, P1)          │  US3, US4 y US5 no dependen entre sí
   ↓                       │  y pueden ir en cualquier orden
Phase 5 (US3, P2) ←────────┤  después de US1
Phase 6 (US4, P2) ←────────┤
Phase 7 (US5, P3) ←────────┘
   ↓
Phase 8 (Polish)
```

- **US1** depende solo de Foundational.
- **US2** depende de US1: el paralelismo extiende el bucle de una tarea, no lo reemplaza.
- **US3, US4, US5** dependen de US1 y son independientes entre sí.
- **T080 bloquea la publicación del modo daemon**, no el resto.

## Parallel Execution Examples

**Phase 2, después de T007** — nueve tests a la vez, todos en archivos distintos:

```
T008  T009  T010  T011  T012  T013  T014  T015  T016
```

**Phase 2, implementación** — cuatro frentes sin tocarse:

```
T017 (log)  T018 (config)  T021+T022 (proveedor)  T023+T024 (repos, lock)
```

**Phase 3** — los tests de US1 salvo el de integración:

```
T030  T031  T032  T034  T035
```

**Phase 5** — los tres proveedores son perfectamente paralelos:

```
T056+T060 (ADO)   T057+T061 (GitHub)   T058+T062 (Linear)
```

## Implementation Strategy

**MVP = Phase 1 + Phase 2 + Phase 3 (US1).** Al terminar Phase 3 el proyecto
ya hace lo que promete para un ticket a la vez, con un proveedor falso o real, y
es demostrable.

**Orden recomendado**: Phase 3 completa antes de tocar el paralelismo. El motivo
es el fallo medido: el paralelismo sobre un bucle de tarea que todavía no es
sólido multiplica los fallos del bucle en vez de multiplicar el trabajo.

**El paralelismo entra en un solo punto** (T052), y todo lo que lo hace seguro
—scheduler, cola, lock— está probado antes en T044 a T048. No se implementa
concurrencia y después se le agregan guardas.

**Lo que no se publica sin pasar**: T035 (autonomía) y T080 (hooks en sesión
headless). Son las dos promesas cuyo incumplimiento daña el repositorio de otra
persona.

## Totals

- **84 tareas**
- Setup 7 · Foundational 22 · US1 14 · US2 12 · US3 9 · US4 7 · US5 7 · Polish 6
- **44 tareas marcadas `[P]`**
