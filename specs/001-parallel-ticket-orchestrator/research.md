# Phase 0 — Research

Cada decisión de abajo tiene detrás una medición o una carencia observada, no
una preferencia. Donde no la hay, lo dice.

La base empírica es un harness equivalente corriendo en producción sobre Azure
DevOps durante seis semanas: 133 invocaciones registradas, 14,5 min y $5,59 de
media, 32 h de reloj y $743,61 de consumo real, con la distribución por
invocación mín $0,54 / mediana $6,24 / máx $7,99.

---

## D1 — Cómo se invoca el modelo

**Decision**: Sesiones del Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
lanzadas concurrentemente por el motor, con degradación automática a invocar el
CLI si el paquete no está instalado. El SDK es dependencia opcional.

**Rationale**: El paralelismo es el requisito central (FR-010) y con
subprocesos de CLI no es gobernable: no hay handle sobre la sesión, el progreso
solo se ve al terminar, y el corte por presupuesto vuelve como `exit 0`. El SDK
da stream de mensajes, identidad de sesión y el subtipo del corte. La
degradación al CLI existe porque un usuario nuevo que clona el repositorio tiene
que poder correr algo antes de instalar nada.

**Alternatives considered**:
- *Solo CLI*: es el punto de partida medido. Cada fase arranca proceso y contexto
  fríos; 14,5 min de media por invocación con 30 min de techo.
- *La tool `Workflow` de Claude Code*: encaja para el fan-out **dentro** de una
  sesión interactiva (ver D7), pero no puede ser el bucle externo: necesita una
  sesión viva, y el recorrido de un hito dura horas y tiene que sobrevivir a que
  se cierre la terminal.
- *API de Mensajes directa, con loop propio*: implicaría reimplementar el harness
  de herramientas (lectura, escritura, bash, permisos, hooks). Es exactamente lo
  que el Agent SDK ya es.

---

## D2 — Contexto por fase: sesión nueva o retomada

**Decision**: **Retomar** la sesión entre las fases de una misma tarea
(RED → GREEN → GATE → REVIEW), y **sesión nueva** entre tareas distintas.

**Rationale**: Es la corrección de un desperdicio medido. El adaptador del SDK
del harness anterior ya soporta `resume` y `forkSession`, y ninguno de sus tres
puntos de invocación los pasa: cada fase reconstruye desde cero el prompt de
sistema, las skills, los agentes y el esquema de herramientas. Con 14,5 min
entre invocaciones, el caché de prompt —cuyo TTL por defecto es de 5 minutos—
nunca llega a servir, y el prefijo además incluye directorio y estado de git del
worktree, que muta mientras la tarea avanza. Retomar dentro de la tarea elimina
las dos causas a la vez.

Sesión nueva **entre** tareas se mantiene a propósito: es lo que evita la
degradación por compactación que se observó al cerrar un recorrido de 14 tareas
en un solo contexto —las cuatro últimas abrieron PR con los contadores en cero—
y es lo que permite que dos tareas corran en paralelo sin compartir historia.

**Alternatives considered**:
- *Una sesión por tarea completa, sin fases*: pierde el punto de control entre
  fases, que es donde el motor decide si avanza.
- *Una sesión por recorrido*: es el fallo original. No escala y se compacta.

---

## D3 — Dónde vive el presupuesto

**Decision**: Techo por **hito** y por **recorrido**, no por invocación. El
corte por presupuesto se detecta como corte y viaja como campo propio, nunca
como éxito.

**Rationale**: El techo por invocación se midió como amputación, no como
ahorro: en un hito de 71 invocaciones, 13 aterrizaron entre $7,50 y $7,99
contra un techo de $8, se registraron como `exit 0`, y el trabajo cortado volvió
como reintento que costó más que lo que el techo ahorró. Un presupuesto que
corta a mitad de una tarea y lo reporta como terminada es el "verde inventado"
que el principio II prohíbe.

**Alternatives considered**:
- *Sin techo*: un motor que se equivoca en bucle lo hace con presupuesto real.
- *Techo por invocación más alto*: mueve el muro sin quitarlo; el problema no es
  dónde está, es que corta a mitad de una unidad de trabajo indivisible.

---

## D4 — Modelo de dependencias de cada gestor

**Decision**: La interfaz declara `dependencies` como capacidad **opcional**.
Quien la soporta la usa; quien no, el motor serializa y lo dice.

**Rationale**: Los tres gestores incluidos difieren de raíz, y una interfaz que
asuma el modelo del más rico no se puede implementar en el más pobre:

| Gestor | Jerarquía | Dependencias | Consulta |
|---|---|---|---|
| Azure DevOps | Parent/Child nativo | `Predecessor`/`Successor` nativos | WIQL |
| Linear | `parent` / sub-issues | relaciones `blocks` / `blocked_by` nativas | GraphQL |
| GitHub Issues | sub-issues e issue types | **sin relación de bloqueo nativa** | REST + GraphQL |

En GitHub el orden se deriva de la jerarquía y, si el proyecto lo declara, de
un campo de Projects; si no hay nada, se serializa. Esto satisface el escenario
US3-AC2 sin inventar un orden que el gestor no afirma.

**A verificar en implementación**: el modelo de sub-issues y de tipos de issue
de GitHub es el que cambió más recientemente de los tres. La forma exacta de la
consulta se confirma contra la API vigente al escribir el proveedor, no contra
memoria — y el proveedor se escribe con su test de contrato delante.

**Alternatives considered**:
- *Exigir dependencias a todo proveedor*: dejaría GitHub Issues afuera, que es
  el gestor más probable de quien adopte el proyecto publicado.
- *Deducir dependencias del texto del ticket*: es una suposición disfrazada de
  característica, y el principio de "lo ambiguo se pregunta" la excluye.

---

## D5 — Cómo se paraleliza sin reintroducir conflictos

**Decision**: Un worktree de git por tarea paralela, rama por tarea, y una
**cola de integración serial** que rebasa sobre la punta actual de la rama del
ticket, vuelve a correr el gate y solo entonces integra. Nadie ramifica sobre
trabajo no integrado.

**Rationale**: El fallo que esto evita está medido: un recorrido encadenó 14
ramas una sobre otra —cada tarea ramificando de la anterior— y cuando las diez
primeras se mergearon, las tres siguientes llegaron en conflicto porque la base
se había movido debajo de ellas. La corrección de entonces fue serializar todo
en una sola rama, que resuelve el conflicto y elimina el paralelismo. La cola es
lo que permite tener las dos cosas: aislamiento real durante la ejecución e
integración ordenada al final de cada tarea.

El gate se vuelve a correr **después** del rebase, no antes: un verde sobre una
base vieja no es un verde sobre la base en la que va a vivir el código.

**Alternatives considered**:
- *Una rama por ticket, tareas seriales*: es el estado actual. Correcto y lento;
  con historias de 1 a 6 tareas deja casi toda la ganancia sobre la mesa.
- *Todas las tareas en paralelo sin mirar el DAG*: reproduce el fallo medido.
- *Un worktree compartido con bloqueos por archivo*: dos tareas del mismo
  repositorio verían los cambios sin integrar de la otra, y el gate de una
  mediría el código de la otra.

---

## D6 — Pull requests: CLI del forge, no servidor MCP

**Decision**: Un envoltorio determinista sobre el CLI del forge (`gh` para
GitHub) en `forge.mjs`. Sin servidor MCP para el forge.

**Rationale**: Dos razones, y la primera es de seguridad. Los hooks del harness
interceptan `Bash` en `PreToolUse`; **las llamadas a herramientas MCP no pasan
por ese hook**. El límite de autonomía del principio IV —no mergear, no
desplegar— está forzado hoy porque un merge es un comando de shell. Un servidor
MCP con una herramienta de merge devolvería ese límite a la buena voluntad del
prompt, que es justo lo que el harness existe para no depender de. La segunda
razón es de costo: cada servidor MCP inyecta su esquema completo de
herramientas en cada contexto, también en los subagentes que no lo usan.

Además, el cuerpo del PR lo arma código a partir del estado del recorrido —
criterios, evidencia del gate, carencias, ampliaciones de alcance — y no la
prosa del modelo, que es lo que lo hace comparable entre recorridos.

**Alternatives considered**:
- *Servidor MCP oficial del forge, en modo lectura*: tiene sentido más adelante
  y para otra cosa (que el modelo *converse* con el forge: triage, leer hilos de
  revisión). No para producir el PR.
- *API REST directa*: el CLI del forge ya resuelve autenticación y paginación;
  reimplementarlo no compra nada.

---

## D7 — Dónde encaja la tool `Workflow`

**Decision**: En dos lugares acotados, dentro del plugin y no del motor: el
fan-out de **planificación** (analista → planificador → materialización, con
salida validada por esquema) y el fan-out de **revisión** de una tarea grande
(varios revisores con una lente cada uno, en paralelo). El motor no depende de
ella.

**Rationale**: Son las dos fases donde hay varios agentes con handoff de
contrato fijo y donde hoy se paga prosa para pasar datos entre ellos. `pipeline`
y `parallel` con `schema` devuelven objetos validados en vez de texto que hay
que interpretar.

**MEDIDO (2026-09-17). Se puede, y conviene NO usarlo.**

Una sesión del SDK **sí** puede invocar `Workflow`: la tool viene en la lista de
26 por defecto y solo hace falta permiso (`allowedTools: ["Workflow"]`, o
`canUseTool`, o `bypassPermissions` — las tres medidas). Los hooks **sí** corren
dentro de los subagentes del workflow, con el deny sosteniéndose, así que el
límite de autonomía no se perdería por esa vía. La tool es **asíncrona**: el
`tool_result` es un marcador y el valor de retorno llega por
`system/task_notification`.

Y entonces se midió lo que importa. Fan-out de 4, mismo trabajo por worker, dos
repeticiones:

| Mecanismo | Reloj (mediana) | Costo |
|---|---|---|
| `Workflow` con `parallel([4])` | **55,65 s** | $1,46 |
| Cuatro `query()` concurrentes | **18,12 s** | $0,52 |

**Tres veces más lento y dos y media más caro**, con ±2 s de varianza. Y no es
serialización: los cuatro agentes arrancaron dentro de 4 ms y el span fue 45,7 s
contra 137,4 s de suma de duraciones — corrieron concurrentes de verdad. La
penalidad es la latencia por subagente (25-46 s contra 7-18 s con el trabajo
idéntico), su prompt de sistema de ~27k tokens, y ~7 s del turno del orquestador
que decide llamar la tool.

**Conclusión: para el reloj, varias `query()` concurrentes desde JavaScript es el
camino, y es el que el motor ya usa.** `Workflow` queda para el camino
interactivo, donde lo que se compra es la orquestación declarativa y no la
velocidad.

Lo que NO se midió, y por eso la conclusión tiene alcance: N=4 con dos
repeticiones en una sola máquina, un solo modelo y una sola forma de trabajo.
No se midió el punto de cruce con N grande (10-50, donde el cap de concurrencia
compartido del workflow podría darlo vuelta frente a 50 procesos), ni con
`pipeline()` multi-etapa, que es donde ese DSL promete su mejor caso.

---

## D8 — Disparo: consulta periódica, no webhooks

**Decision**: Consulta periódica al gestor buscando dos señales —ticket
asignado a la identidad de noxloop, y mención en un comentario— con
deduplicación por ticket. La costura para webhooks queda declarada en la
interfaz, sin implementar.

**Rationale**: Los webhooks obligan a un endpoint público, a manejar
reintentos y a verificar firmas: es infraestructura que quien adopta el proyecto
puede no tener, y el requisito (FR-002) se satisface sin ella. La
deduplicación por ticket es lo que hace que asignar *y* mencionar produzca un
solo recorrido.

**Alternatives considered**:
- *Solo mención*: es el disparo del harness actual. Obliga a escribir un
  comentario en un flujo donde asignar ya expresa la intención.
- *Webhooks desde el principio*: más rápido para reaccionar, y una barrera de
  adopción en la primera pantalla.

---

## D9 — Runner de tests y validación de configuración

**Decision**: `node:test` para la suite. `ajv` + `ajv-formats` como dependencia
**de desarrollo** para validar la configuración contra JSON Schema, con la
validación corriendo en `doctor` y en CI.

**Rationale**: El principio de cero dependencias en el camino crítico. Un
proyecto que se instala para orquestar repositorios ajenos no puede traer un
árbol de dependencias propio. `node:test` viene en el runtime; el validador solo
corre en desarrollo y en la verificación de entorno.

**Alternatives considered**:
- *Vitest*: mejor ergonomía, y una dependencia de desarrollo grande para un
  proyecto cuyo argumento es no tenerlas.
- *Validación a mano*: fue el estado anterior. Produjo una configuración que
  mentía —un campo de carencias vacío que el reporte leía como "sin carencias"—
  y el fallo apareció a mitad de un recorrido.

---

## D10 — Tipos sin paso de build

**Decision**: JSDoc en el código, verificado con `tsc --checkJs --noEmit` en CI.
Sin TypeScript ni transpilación.

**Rationale**: El motor lo invocan hooks del sistema de archivos, subprocesos y
un plugin que se instala desde un checkout de git. Un artefacto compilado obliga
a que el build esté sincronizado con el checkout en todas esas rutas, y el modo
de fallo es silencioso: se ejecuta código viejo. JSDoc con `checkJs` da el
chequeo de tipos en CI sin introducir ese modo de fallo.

**Alternatives considered**:
- *TypeScript con build*: mejor experiencia de desarrollo, peor experiencia de
  instalación, y un modo de fallo nuevo en el camino donde más duele.
- *Sin tipos*: es el estado anterior, con 4.000 líneas y ningún chequeo.

---

## Preguntas que quedan abiertas, y no bloquean

1. **¿Puede una sesión del SDK invocar `Workflow`?** Acotado por D7: el motor no
   depende de ello. Se verifica al implementar el plugin.
2. **¿Cuántas sesiones concurrentes tolera la cuota antes de degradar?** Es
   configuración (`maxParallel`) y se calibra con uso real. El motor no intenta
   descubrirlo.
3. ~~**¿Cómo se entregan los hooks a una sesión headless lanzada por el
   motor?**~~ **RESUELTA Y MEDIDA** (2026-09-17, T080).

   El camino es pasar la configuración explícitamente, y funciona por dos vías:
   `--settings <archivo-o-json>` en el CLI, y `options.settings` (el mismo JSON
   declarativo) u `options.hooks` (callbacks en el propio proceso) en el SDK.
   No existe ningún flag `--hooks`.

   Verificado en sesiones reales, **con el plugin sin instalar** (control:
   `grep -ril noxloop ~/.claude/plugins` vacío): la intercepción ocurre en la
   sesión, **dentro de un subagente**, y en una **sesión retomada** con
   `--resume`, que es lo que hace el driver entre RED y GREEN.

   Tres cosas que la medición dejó, y que no estaban previstas:

   - El plugin usa `${CLAUDE_PLUGIN_ROOT}`, que **solo lo expande el cargador de
     plugins**. Por esta vía es texto literal → archivo inexistente → sesión sin
     guarda. El motor resuelve rutas absolutas él mismo.
   - La forma `command` + `args` spawnea el binario directo, sin shell. Es
     preferible a meter la ruta dentro de `command`: un worktree con un `$` en la
     ruta rompe la forma con shell que usa el plugin.
   - En modo `-p`, **un archivo de settings que no valida se ignora en
     silencio**. Por eso `validateHookSettings` se niega a escribir uno
     incompleto en vez de confiar en que el cargador avise.

   Lo que quedó sin medir: la vía `plugins` / `--plugin-dir`, y
   `pluginDelivery: "initialize"` (que exige una versión del CLI más nueva que la
   del PATH). El motor no depende de ninguna de las dos.
