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

- [ ] T030 [P] [US1] Test del runner en `packages/engine/test/runner.test.mjs`: retoma la sesión entre fases de una tarea (mismo `sessionId`), abre sesión nueva entre tareas, detecta el corte por presupuesto como corte y **nunca** como `ok`, y degrada al CLI cuando el SDK no está
- [ ] T031 [P] [US1] Test del forge en `packages/engine/test/forge.test.mjs`: el cuerpo del PR se arma desde el estado —criterios, `gateEvidence` textual, `gaps`, `addedTargets`, tareas bloqueadas— y no de prosa del modelo
- [ ] T032 [P] [US1] Test de idempotencia del gestor en `packages/engine/test/provider-writes.test.mjs`: relanzar no mueve el ticket dos veces ni duplica comentarios (`providerStateWritten`)
- [ ] T033 [US1] Test de integración de la historia en `packages/engine/test/us1-ticket-to-pr.test.mjs`: proveedor falso + repositorio git desechable, recorrido completo hasta rama lista, verificando el orden test→implementación en el historial de commits
- [ ] T034 [P] [US1] Test de ticket sin criterios verificables en `packages/engine/test/us1-no-acceptance.test.mjs`: no se escribe código y el ticket queda bloqueado con la pregunta concreta
- [ ] T035 [P] [US1] Test de autonomía en `packages/engine/test/autonomy.test.mjs`: merge a rama protegida, force push y deploy interceptados; más recorrido del fuente del motor buscando esas operaciones

### Implementación

- [ ] T036 [US1] Implementar `packages/engine/src/runner.mjs`: una fase = una sesión del SDK con `resume` dentro de la tarea, stream de progreso, `budgetExhausted` como campo propio, y degradación al CLI
- [ ] T037 [P] [US1] Implementar `packages/engine/src/forge.mjs`: envoltorio determinista del CLI del forge, armado del cuerpo del PR desde el estado, e idempotencia si el PR ya existe
- [ ] T038 [US1] Implementar `packages/engine/src/driver.mjs`: el bucle de un item — abrir, RED, GREEN, GATE, REVIEW, cerrar — decidiendo por código de salida y estado, nunca por la prosa del modelo
- [ ] T039 [US1] Implementar la detección de revisión ausente en `driver.mjs`: una tarea que llega a terminal con `attempts.review === 0` recibe la revisión que falta antes del PR, con dos oportunidades
- [ ] T040 [P] [US1] Implementar `packages/engine/src/dispatch.mjs`: resuelve el nivel del ticket con el proveedor y delega; `plan` para `story`/`task`, `milestone` para `epic`/`feature`
- [ ] T041 [P] [US1] Escribir los comandos del plugin `packages/plugin/commands/noxloop-plan.md` y `noxloop-run.md`
- [ ] T042 [P] [US1] Escribir los agentes del plugin en `packages/plugin/agents/`: `analyst.md`, `planner.md`, `implementer.md`, `verifier.md`, `reviewer.md`, `scribe.md`
- [ ] T043 [P] [US1] Escribir `packages/plugin/hooks/hooks.json` apuntando a los hooks del motor, y la skill `packages/plugin/skills/tdd/SKILL.md`

**Checkpoint**: US1 entregable. El producto ya sirve para un ticket a la vez.

---

## Phase 4: User Story 2 — Un hito se cierra completo, y en paralelo (P1)

**Goal**: Una aprobación, N historias, tareas independientes en paralelo e integración ordenada.

**Independent Test**: Una épica con tres historias sin dependencias avanza en tres worktreesa la vez y termina en un tiempo cercano al de la más lenta.

### Tests (OBLIGATORIO — TDD) ⚠️

- [ ] T044 [P] [US2] Test del scheduler en `packages/engine/test/scheduler.test.mjs`: la tabla completa del escenario 2 de `quickstart.md`, incluyendo `blocked` vs `unreachable` y el recorte por `maxParallelTasks`
- [ ] T045 [P] [US2] Test de la cola en `packages/engine/test/merge-queue.test.mjs`: repositorio git real, dos ramas que tocan la misma línea, rebase que falla, tarea que vuelve a `green` con el conflicto textual, rama base intacta, y gate **después** del rebase
- [ ] T046 [P] [US2] Test de hito en `packages/engine/test/milestone.test.mjs`: orden desde dependencias cuando el proveedor las tiene, serialización declarada cuando no, `--skip` y `--only`, y el reporte final de bloqueadas e inalcanzables
- [ ] T047 [US2] Test de concurrencia en `packages/engine/test/parallel.test.mjs`: N tareas concurrentes sobre el mismo repositorio mantienen el estado consistente y ninguna observa los cambios sin integrar de otra
- [ ] T048 [P] [US2] Test del techo por hito en `packages/engine/test/milestone-budget.test.mjs`: al alcanzarlo el recorrido se detiene ordenadamente, sin cortar una tarea a mitad

### Implementación

- [ ] T049 [US2] Implementar `packages/engine/src/scheduler.mjs`: orden topológico, dependencias duras contra `integrated`, recorte por ancho, y cálculo de `unreachable`
- [ ] T050 [US2] Implementar `packages/engine/src/merge-queue.mjs`: cola serial, rebase sobre la punta, re-verificación con el gate rápido, e integración o rechazo con la causa
- [ ] T051 [US2] Implementar `packages/engine/src/milestone.mjs`: rama del hito, orden de items, exclusiones declaradas antes de arrancar, notas como canal de vuelta, y contabilidad de gasto
- [ ] T052 [US2] Extender `driver.mjs` a ejecución concurrente: lanzar el ReadySet, esperar la primera que termine, recalcular desde disco, y respetar `maxParallelItems`
- [ ] T053 [P] [US2] Escribir `packages/plugin/workflows/planning-fanout.mjs`: `pipeline` analista → planificador → materialización con salida validada por esquema
- [ ] T054 [P] [US2] Escribir `packages/plugin/workflows/review-fanout.mjs` y `packages/plugin/agents/review-fanout.md`: revisores en paralelo con una lente cada uno, solo en tier `large`
- [ ] T055 [P] [US2] Escribir `packages/plugin/commands/noxloop-milestone.md`

**Checkpoint**: US2 entregable. El paralelismo es observable y la integración no produce el fallo de las ramas encadenadas.

---

## Phase 5: User Story 3 — Funciona con el gestor que ya usás (P2)

**Goal**: Tres gestores, el mismo recorrido, y un cuarto en un archivo.

**Independent Test**: La misma suite de contrato pasa para los tres, y un proveedor nuevo pasa sin tocar el motor.

### Tests (OBLIGATORIO — TDD) ⚠️

- [ ] T056 [P] [US3] Test de contrato de Azure DevOps en `providers/azure-devops/index.test.mjs`, con respuestas grabadas y sin red
- [ ] T057 [P] [US3] Test de contrato de GitHub en `providers/github/index.test.mjs`, incluyendo el camino degradado de `dependencies: false`
- [ ] T058 [P] [US3] Test de contrato de Linear en `providers/linear/index.test.mjs`, incluyendo relaciones `blocks`/`blocked_by`
- [ ] T059 [P] [US3] Test de degradación en `packages/engine/test/degradation.test.mjs`: una fila por capacidad de la tabla de `contracts/provider.md`

### Implementación

- [ ] T060 [P] [US3] Implementar `providers/azure-devops/index.mjs`: WIQL, jerarquía, `Predecessor`/`Successor`, comentarios, `Hyperlink` para el PR, y mapa de tipos por plantilla de proceso
- [ ] T061 [P] [US3] Implementar `providers/github/index.mjs`: issues, sub-issues, labels, y orden serializado declarado por falta de dependencias nativas — confirmando la forma de la API vigente contra su test antes de escribirlo
- [ ] T062 [P] [US3] Implementar `providers/linear/index.mjs`: GraphQL, `parent`/sub-issues, relaciones, estados de workflow
- [ ] T063 [P] [US3] Escribir `providers/README.md`: los cinco pasos para agregar un gestor, con Jira como ejemplo trabajado
- [ ] T064 [P] [US3] Escribir `docs/PROVIDERS.md`: la interfaz explicada, con la tabla de degradación

**Checkpoint**: US3 entregable. El agnosticismo está probado, no afirmado.

---

## Phase 6: User Story 4 — Un recorrido interrumpido se retoma (P2)

**Goal**: Interrumpir no cuesta el hito.

**Independent Test**: Matar el proceso a mitad y relanzar produce el mismo resultado final.

### Tests (OBLIGATORIO — TDD) ⚠️

- [ ] T065 [P] [US4] Test de reanudación en `packages/engine/test/resume.test.mjs`: no repite tareas `integrated`, conserva intentos, y el resultado final coincide con el de la corrida sin interrupción
- [ ] T066 [P] [US4] Test de worktree huérfano en `packages/engine/test/worktree.test.mjs`: se detecta, y solo se limpia si no tiene cambios sin commitear
- [ ] T067 [P] [US4] Test de `unstick`: registra la decisión y devuelve la tarea al bucle sin implementar nada

### Implementación

- [ ] T068 [US4] Implementar `resume` en `bin/noxloop.mjs` y la recuperación de tareas a medias en `driver.mjs`: decidir antes de seguir, nunca pisar
- [ ] T069 [P] [US4] Implementar la limpieza de worktrees huérfanos en `worktree.mjs`
- [ ] T070 [P] [US4] Implementar `unstick` en `bin/noxloop.mjs` y `state.mjs`
- [ ] T071 [P] [US4] Escribir `packages/plugin/commands/noxloop-status.md` y la skill `packages/plugin/skills/orchestration/SKILL.md`

**Checkpoint**: US4 entregable.

---

## Phase 7: User Story 5 — Instalable por alguien que no lo escribió (P3)

**Goal**: Del clone al primer ticket cerrado, con el README solo.

**Independent Test**: Una máquina limpia, siguiendo solo `docs/ADOPTING.md`.

### Tests (OBLIGATORIO — TDD) ⚠️

- [ ] T072 [P] [US5] Test de la configuración de ejemplo: `examples/noxloop.config.json` valida contra el esquema y `doctor` la acepta
- [ ] T073 [P] [US5] Test de `doctor`: enumera cada carencia por separado y no inventa ningún valor por defecto que pueda escribir en el lugar equivocado

### Implementación

- [X] T074 [P] [US5] Escribir `examples/noxloop.config.json` (+ `examples/README.md`), comentado y listo para copiar. **Adelantada desde la fase 7**: `npm run validate` la necesita para poder correr en CI desde el primer commit. `gates.example.json` no hizo falta: los gates viven dentro de la configuracion, no en un archivo aparte
- [ ] T075 [P] [US5] Escribir `README.md`: qué es, el argumento, instalación, y el primer ticket en cinco comandos
- [ ] T076 [P] [US5] Escribir `docs/ADOPTING.md`: instalación en una organización nueva, paso por paso
- [ ] T077 [P] [US5] Escribir `docs/PARALLELISM.md` y `docs/AUTONOMY.md`: el DAG, la cola y dónde termina la autonomía, cada uno con el fallo que evita
- [ ] T078 [P] [US5] Escribir `docs/MIGRATING.md`: cómo mover un harness existente atado a un gestor a esta estructura

**Checkpoint**: US5 entregable. El proyecto es publicable.

---

## Phase 8: Polish & Cross-Cutting

- [ ] T079 [P] Implementar `inbox` y `daemon` en `bin/noxloop.mjs`: consulta periódica con deduplicación por ticket, instancia única por lock
- [ ] T080 Resolver la pregunta abierta 3 de `research.md` con un test: pedir un merge desde una sesión headless lanzada por el motor y verificar que lo intercepta. **El modo daemon no se publica hasta que este test pase.**
- [X] T081 [P] Dejar `npm run typecheck` (`tsc --checkJs`) en verde sobre todo el motor y los proveedores. **Adelantada**: corrio contra el codigo de la fase 2 y encontro 17 errores reales (acumuladores inferidos como `never`, `home` opcional pasado a una firma que lo exige, el `code` de un error de spawn sin tipar). Arreglarlos despues habria sido arqueologia
- [ ] T082 [P] Escribir `CHANGELOG.md` y `CONTRIBUTING.md`
- [ ] T083 [P] Agregar al CI en `.github/workflows/ci.yml` la guarda de nombres propios y la validación de los ejemplos
- [ ] T084 Verificar los ocho escenarios de `quickstart.md` de punta a punta y registrar el resultado real de cada uno

---

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
