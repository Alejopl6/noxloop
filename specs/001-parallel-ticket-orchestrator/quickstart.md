# Phase 1 — Quickstart & Validation

Cómo probar que esto funciona, en orden de costo creciente. Los tres primeros
escenarios no necesitan red, credenciales ni modelo: corren contra el proveedor
falso y repositorios git desechables. Es a propósito — el paralelismo y la cola
de integración se verifican sin gastar un centavo.

## Prerrequisitos

- Node ≥ 20, git ≥ 2.30
- `npm install` en la raíz (solo dependencias de desarrollo)
- Para los escenarios 4 y 5: credencial del gestor en el entorno y
  `@anthropic-ai/claude-agent-sdk` instalado

---

## Escenario 1 — La suite completa, sin red

```bash
npm test
```

**Se espera**: verde. Incluye el contrato de los cuatro proveedores (los tres
reales corren contra respuestas grabadas; el falso, contra memoria), el
scheduler, la máquina de estados, la cola de integración y las guardas de
constitución.

**Prueba**: FR-005 a FR-008, FR-010, FR-014, FR-015, FR-023 a FR-031, y
SC-005, SC-007, SC-009.

---

## Escenario 2 — El paralelismo es real, y el DAG lo gobierna

```bash
node --test packages/engine/test/scheduler.test.mjs
```

Sobre un DAG conocido —T1 y T2 sin dependencias, T3 dependiendo de T1 con
dependencia dura, T4 de T3— el scheduler tiene que devolver:

| Estado del recorrido | ReadySet esperado |
|---|---|
| todo `pending` | `[T1, T2]` |
| T1 `integrated` | `[T2, T3]` |
| T1 `integrated`, T2 en curso | `[T3]` |
| T1 `gated` (no integrada) | `[T2]` — T3 **no** arranca: dura sin integrar |
| `maxParallelTasks: 1` | una sola, la primera en orden topológico |
| T1 `blocked` | `[T2]`, y T3/T4 se reportan `unreachable`, no `blocked` |

**Prueba**: FR-010, FR-016, US2-AC2, y el principio V de la constitución.

La distinción entre `blocked` y `unreachable` es la que hace útil el reporte
final: una tarea que falló y una que nunca pudo intentarse no son el mismo
problema.

---

## Escenario 3 — La cola de integración, con conflicto de verdad

```bash
node --test packages/engine/test/merge-queue.test.mjs
```

El test crea un repositorio git temporal, dos ramas que tocan **la misma línea**
del mismo archivo, y las mete en la cola.

**Se espera**: la primera se integra; la segunda se rebasa sobre la punta nueva,
el rebase falla, la tarea vuelve a `green` con el conflicto textual como
`lastFailure`, y la rama base **queda intacta**. Después, con el conflicto
resuelto, la segunda entra y el gate se vuelve a correr *después* del rebase.

**Prueba**: FR-019, US2-AC4, y el fallo medido del recorrido de 14 ramas.

---

## Escenario 4 — Un ticket entra, un PR sale

Con un gestor real configurado y un repositorio de prueba:

```bash
noxloop doctor                      # tiene que decir ready: true
noxloop plan <id-del-ticket>        # planifica y para
noxloop run <id-del-ticket>
```

**Se espera**: un PR abierto cuyo historial de commits tiene el test **antes**
que su implementación, el ticket comentado con el enlace, y su estado en "en
curso". Cero merges y cero despliegues.

**Cómo se verifica el orden, sin leer el motor**:

```bash
git log --format='%h %s' --name-only <rama> | head -40
```

El commit del test de una tarea precede al de su implementación.

**Prueba**: US1 completa, FR-001 a FR-004, FR-012, FR-020 a FR-022, SC-001,
SC-003, SC-004.

---

## Escenario 5 — Un hito, con historias en paralelo

```bash
noxloop milestone <id> --dry-run    # qué haría
noxloop milestone <id> --go --max-items 1
```

`--max-items 1` es la forma sensata de estrenarlo: se mira una historia completa
antes de confiarle el hito.

Con el hito entero, y tres historias sin dependencias entre sí:

```bash
watch -n5 'noxloop status --json | jq ".items[] | {id, status}"'
```

**Se espera**: tres historias en `running` a la vez, tres worktrees en
`$NOXLOOP_HOME/worktrees/`, y un tiempo total que no supera el 60% de la suma de
las tres corridas en serie.

**Prueba**: US2, FR-010, FR-011, SC-002.

---

## Escenario 6 — El límite de autonomía, a propósito

```bash
node --test packages/engine/test/autonomy.test.mjs
```

El test pide, desde una sesión lanzada por el motor: mergear a la rama
protegida, hacer force push, y ejecutar un despliegue.

**Se espera**: las tres interceptadas antes de ejecutarse, con el bloqueo
registrado. Y un segundo test que recorre el fuente del motor buscando esas
operaciones sobre ramas protegidas: cero resultados.

**Prueba**: FR-021, SC-004, y el principio IV.

Este escenario es el que **no se publica sin pasar**. Es la única promesa del
proyecto que, si es falsa, produce daño en el repositorio de otra persona.

---

## Escenario 7 — Retomar

```bash
noxloop run <id> &
sleep 90 && kill %1
noxloop resume <id>
```

**Se espera**: continúa donde quedó, no repite ninguna tarea `integrated`, y las
tareas a medias conservan sus intentos consumidos. Un `noxloop status` antes y
después lo hace verificable.

**Prueba**: US4, FR-023 a FR-026, SC-006, SC-010.

---

## Escenario 8 — Adoptabilidad

En una máquina limpia, siguiendo **solo** `docs/ADOPTING.md`:

```bash
git clone <repo> && cd noxloop && npm install
cp examples/noxloop.config.json ./noxloop.config.json
$EDITOR noxloop.config.json
noxloop doctor
```

**Se espera**: `doctor` enumera exactamente qué falta —repositorio no
encontrado, remote que no coincide, credencial ausente, estado canónico sin
mapear— y no inventa ningún valor por defecto que pueda escribir en el lugar
equivocado.

**Prueba**: US5, FR-032 a FR-035, SC-008.
