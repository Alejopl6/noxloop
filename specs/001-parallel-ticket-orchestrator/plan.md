# Implementation Plan: Orquestador paralelo de tickets, agnóstico del gestor

**Branch**: `001-parallel-ticket-orchestrator` | **Date**: 2026-09-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-parallel-ticket-orchestrator/spec.md`

## Summary

noxloop toma un ticket de cualquier nivel y devuelve pull requests, ejecutando
en paralelo todo lo que el grafo de dependencias permite y sin pasar nunca de
ahí: no mergea, no despliega.

El enfoque técnico tiene tres piezas y una inversión de control. La inversión:
el motor maneja y llama al modelo, no al revés — cada fase es una sesión propia
con contexto chico, y quien decide si avanzar es el motor mirando códigos de
salida y estado en disco, nunca la prosa del modelo. Las tres piezas: un
**planificador** que convierte el ticket en un DAG de tareas atómicas, un
**scheduler** que decide qué corre ahora (topológico, con ancho configurable, un
worktree por tarea), y una **cola de integración** serial que rebasa sobre la
punta y vuelve a verificar antes de mergear.

El agnosticismo del gestor se resuelve con una interfaz de proveedor que declara
capacidades: el motor pregunta qué sabe hacer el gestor antes de usarlo, y
degrada visiblemente cuando no puede. Se incluyen tres proveedores y la suite de
contrato que cualquier cuarto tiene que pasar.

Este trabajo parte de un harness ya probado en producción sobre Azure DevOps
(~4.000 líneas, 133 invocaciones medidas, 32 h de reloj, $743 de consumo real) y
consiste en portarlo genericizándolo, más lo que no existía: el paralelismo
gobernado por el DAG, la interfaz de proveedor y la adoptabilidad por terceros.

## Technical Context

**Language/Version**: Node.js ≥ 20, JavaScript ESM (`.mjs`). Sin TypeScript y
sin paso de build, a propósito: el motor lo invocan hooks del sistema de
archivos y subprocesos de sesión, donde un artefacto compilado obliga a
mantener build y checkout sincronizados. Los tipos se declaran en JSDoc y se
verifican con `tsc --checkJs --noEmit` en CI, que da el chequeo sin el build.

**Primary Dependencies**: `@anthropic-ai/claude-agent-sdk` como única
dependencia de runtime, y **opcional**: si no está instalada, el motor degrada
a invocar el CLI, y lo dice. Desarrollo: `ajv` + `ajv-formats` para validar
configuración contra JSON Schema, y `typescript` solo para `--checkJs`. El
runner de tests es `node:test`, del runtime, para no sumar dependencia.

**Storage**: Archivos JSON bajo `NOXLOOP_HOME` (por defecto `~/.noxloop`), con
escrituras atómicas (temporal + `rename`). Fuera de los repositorios, porque un
ticket abarca varios y los hooks que corren dentro de uno tienen que ver la
misma tarea activa que los que corren dentro de otro. Worktrees de git como
espacio de trabajo aislado por tarea paralela.

**Testing**: `node --test`. Cuatro niveles: unitario (scheduler, estado, plan,
cola), contrato de proveedor (la misma suite contra los tres, y contra un
proveedor falso), integración (repositorio git desechable + proveedor falso, sin
red ni modelo), y guardas de constitución (tests que fallan si el motor
adquiere un nombre propio o si una ruta puede declarar verde sin evidencia).

**Target Platform**: macOS y Linux, Node ≥ 20, git ≥ 2.30. Windows queda fuera
de alcance declarado en v1 por los hooks y las rutas POSIX.

**Project Type**: Monorepo con tres artefactos: una biblioteca+CLI (el motor),
un plugin de Claude Code (los comandos, agentes y skills), y un directorio
plano de proveedores. Workspaces de npm.

**Performance Goals**: El ancho de paralelismo es configuración, no
descubrimiento: el techo real lo pone la cuota del proveedor del modelo y la
máquina. Objetivo verificable: con N tareas concurrentes el estado en disco
permanece consistente y ninguna tarea observa los cambios sin integrar de otra.
Referencia de la que se parte: 14,5 min y $5,59 por invocación en serie.

**Constraints**: Cero nombres propios de organización, repositorio o host en el
motor (verificado por test). Cero dependencias de runtime obligatorias. Ningún
camino de código puede marcar una tarea como cumplida sin el objeto del gate.
Los hooks permiten ante la duda. El proceso no mergea a rama protegida ni
despliega, por interceptación y no por instrucción.

**Scale/Scope**: Hitos de hasta ~60 tareas y ~8 repositorios por organización.
Tres proveedores incluidos (GitHub, Linear, Azure DevOps) y la costura probada
para un cuarto.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principio | Cómo lo satisface este plan | Verificación |
|---|---|---|
| **I. Test primero, forzado** | El hook `tdd-order-guard` se entrega en el plugin y además como binario invocable por el motor, y consulta el estado en disco. Los cuatro tiers ejecutan RED. | Test que simula una escritura de producción con `redVerified: false` y espera bloqueo, en los cuatro tiers. |
| **II. Exit code, no frase** | `gate.mjs` es el único productor de veredictos y devuelve `{comando, exitCode, duración, salida}`. `state.mjs` rechaza una transición a `gated` sin ese objeto. | Test que intenta marcar `gated` sin evidencia y espera error. |
| **III. Estado en disco** | `state.mjs` con escrituras atómicas bajo `NOXLOOP_HOME`; `driver.mjs` nunca sostiene el plan en memoria entre fases. | Test que corta a mitad de la escritura y verifica que se lee el estado anterior completo. |
| **IV. Autonomía termina en el PR** | `no-prod-writes` intercepta `Bash`; el motor no tiene ninguna ruta de código que mergee a rama protegida ni despliegue. | Test que pide merge/deploy/force-push y espera bloqueo; más un test que recorre el motor buscando esos verbos. |
| **V. Paralelismo por DAG** | `scheduler.mjs` solo devuelve tareas cuyas dependencias duras están integradas; `merge-queue.mjs` integra de a una, rebasando sobre la punta. | Test del scheduler con un DAG conocido; test de la cola con dos ramas que se pisan. |
| **VI. El gestor es un detalle** | `providers/contract.mjs` define la interfaz y exporta la suite; el motor consulta `capabilities()` antes de cada capacidad opcional. | La misma suite corre contra los tres proveedores y contra uno falso mínimo. |
| **VII. Configuración es datos** | `noxloop.config.json` validado con JSON Schema; `doctor` reporta lo que falta. | Test que hace `grep` de nombres propios en `packages/engine/src/**` y falla si encuentra alguno. |

**Resultado: PASA.** Sin violaciones que justificar, por lo que la sección de
Complexity Tracking queda vacía y se elimina.

Una observación que el gate deja registrada sin bloquear: el principio VI exige
que agregar un gestor no toque el motor. Este plan incluye tres proveedores
justamente para que la interfaz no se diseñe contra uno solo — una interfaz con
una sola implementación filtra el modelo de esa implementación, y el segundo
proveedor lo descubre rompiéndola. Linear y GitHub entran en la primera entrega
por eso, no por cobertura.

## Project Structure

### Documentation (this feature)

```text
specs/001-parallel-ticket-orchestrator/
├── plan.md              # Este archivo
├── research.md          # Fase 0
├── data-model.md        # Fase 1
├── quickstart.md        # Fase 1
├── contracts/           # Fase 1
│   ├── provider.md          # la interfaz que todo gestor implementa
│   ├── config.schema.json   # la configuración del proyecto
│   ├── plan.schema.json     # el DAG que consume el motor
│   ├── run.schema.json      # el estado persistido
│   └── cli.md               # la superficie de línea de comandos
├── checklists/
│   └── requirements.md
└── tasks.md             # Fase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/
├── engine/                          # @noxloop/engine — biblioteca + CLI
│   ├── bin/noxloop.mjs              # el CLI: run, plan, status, doctor, daemon
│   ├── src/
│   │   ├── config.mjs               # carga, valida contra schema, resuelve rutas
│   │   ├── doctor.mjs               # qué está declarado, qué falta, qué credencial
│   │   ├── state.mjs                # recorridos, tareas, presupuestos, atómico
│   │   ├── plan.mjs                 # validación del DAG, ciclos, alcance
│   │   ├── scheduler.mjs            # qué corre ahora: topológico + ancho
│   │   ├── runner.mjs               # una fase = una sesión (SDK, o CLI si no hay)
│   │   ├── driver.mjs               # el bucle: hito → items → tareas
│   │   ├── dispatch.mjs             # un ticket de cualquier nivel entra
│   │   ├── milestone.mjs            # el recorrido de un hito y su rama
│   │   ├── worktree.mjs             # un espacio aislado por tarea paralela
│   │   ├── merge-queue.mjs          # integración serial, rebase sobre la punta
│   │   ├── gate.mjs                 # el único productor de veredictos
│   │   ├── lock.mjs                 # una instancia por hito
│   │   ├── repos.mjs                # resuelve y verifica checkouts locales
│   │   ├── forge.mjs                # pull requests (GitHub CLI, sin esquema MCP)
│   │   ├── log.mjs                  # bitácora estructurada del recorrido
│   │   └── hooks/
│   │       ├── tdd-order-guard.mjs
│   │       ├── task-scope-guard.mjs
│   │       ├── no-prod-writes.mjs
│   │       ├── state-checkpoint.mjs
│   │       └── _shared.mjs
│   ├── schemas/                     # los JSON Schema que valida `config.mjs`
│   └── test/                        # node:test — unit, contrato, integración, guardas
└── plugin/                          # el plugin de Claude Code
    ├── .claude-plugin/plugin.json
    ├── commands/                    # /noxloop-plan, -run, -status, -inbox, -milestone
    ├── agents/                      # analyst, planner, implementer, verifier, reviewer, scribe, fanout
    ├── skills/                      # orchestration, work-items, tdd, provider-authoring
    ├── hooks/hooks.json             # apunta a los hooks del motor
    └── workflows/                   # scripts de Workflow: fan-out de planificación y de revisión

providers/                           # plano, a propósito: un archivo = un gestor
├── contract.mjs                     # la interfaz, el validador y la suite de contrato
├── github/index.mjs
├── linear/index.mjs
├── azure-devops/index.mjs
├── fake/index.mjs                   # el que usan los tests, y el ejemplo mínimo
└── README.md                        # cómo agregar Jira u otro, en 5 pasos

examples/
├── noxloop.config.json              # configuración comentada, lista para copiar
└── gates.example.json

.claude-plugin/marketplace.json      # para `/plugin marketplace add <owner>/noxloop`
docs/
├── README.md → el de la raíz
├── ADOPTING.md                      # instalar en una organización nueva
├── PROVIDERS.md                     # la interfaz explicada
├── PARALLELISM.md                   # el DAG, la cola y el fallo que evitan
└── AUTONOMY.md                      # dónde termina, y cómo está forzado
```

**Structure Decision**: Monorepo con workspaces de npm y tres artefactos
publicables por separado. La decisión que importa es la tercera: `providers/`
vive en la raíz y no dentro del motor. Es lo que hace que agregar un gestor sea
agregar un archivo en un directorio plano, y no navegar la estructura interna de
un paquete. El motor depende de la *interfaz*, no del directorio: recibe la ruta
del proveedor por configuración y lo carga dinámicamente, así que un proveedor
puede vivir fuera de este repositorio.

`packages/plugin` no contiene lógica: sus comandos y agentes son markdown que
invoca al motor. Es lo que evita que una corrección tenga que hacerse dos veces,
una en el prompt y otra en el código.

## Complexity Tracking

Sin violaciones de constitución que justificar.
