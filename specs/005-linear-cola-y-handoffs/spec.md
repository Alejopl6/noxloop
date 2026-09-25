# Feature Specification: Linear completo, orden a mano y hand-offs

**Feature Branch**: `005-linear-cola-y-handoffs`

**Created**: 2026-09-24

**Status**: Draft

**Input**: Bloque P2 del análisis del release Nodal 0.1.0 (ver `specs/004-diagnostico-y-run-en-vivo/spec.md` → Fase siguiente), más los huecos declarados en los PR #13 y #14. Decisión del operador: «sigamos con lo demás».

---

## Qué es esto y qué no es

El board ya lanza, muestra y diagnostica. Lo que falta para trabajar con un gestor real y con varios runs a la vez: **decidir qué issues de Linear le tocan a cada proyecto**, **mapear sus estados sin editar JSON**, **ordenar a mano lo que se hace primero**, y **pasar una tarea de un agente a otro** sin empezar de cero.

**Queda fuera:** mover tarjetas entre columnas desde el board. Eso escribiría el estado en el gestor, y el gestor sigue siendo la fuente de verdad del backlog (principio VI, spec 003). Reordenar **dentro** de una columna sí, porque es una preferencia local y no se escribe en el gestor.

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Linear completo: qué issues le tocan a cada proyecto, y sus estados (Priority: P1)

En Settings del proyecto → Gestor, el operador elige el equipo de Linear y, si quiere, **reglas de ruteo** (un proyecto de Linear y/o etiquetas) que deciden qué issues aparecen en este board. Mapea los estados de Linear a los canónicos con un **editor visual** (cada estado del equipo, con un selector), sin escribir JSON. Cuando el motor termina, **el estado se empuja** a Linear y queda un **comentario de cierre** con el PR. Si una issue con run **cambia de proyecto** en Linear, la tarjeta lo marca y ofrece qué hacer.

**Independent Test**: con respuestas grabadas de Linear, dos proyectos de noxloop con reglas distintas sobre el mismo equipo ven cada uno solo sus issues; el editor de estados guarda un `stateMap` válido; una issue que cambia de proyecto con un run abierto sale marcada «movida».

**Acceptance Scenarios**:

1. **Given** un equipo con issues de dos proyectos de Linear, **When** el proyecto A tiene la regla «proyecto = Pagos», **Then** su board muestra solo las issues de Pagos.
2. **Given** el editor de estados, **When** el operador asigna cada estado del equipo, **Then** se guarda validado contra el esquema del proveedor, y los estados sin asignar se nombran.
3. **Given** un run que abre PR, **When** termina, **Then** la issue pasa al estado mapeado de `in_review` y recibe un comentario con el enlace al PR.
4. **Given** una issue con run que sale de las reglas del proyecto, **When** se pinta el board, **Then** la tarjeta muestra el chip «movida» con adónde fue y la acción de seguir en este proyecto o soltarla.

---

### User Story 2 - Ordenar a mano: el board y la cola (Priority: P2)

El operador arrastra (o sube y baja) tarjetas **dentro de una columna** para decidir qué va primero, y en Runs ve la **cola global** —todos los proyectos, con un límite de runs simultáneos configurable— y la reordena.

**Acceptance Scenarios**:

1. **Given** tres tarjetas en Todo, **When** el operador sube la tercera, **Then** queda primera y el orden sobrevive a reiniciar la app; en el gestor no se escribe nada.
2. **Given** un límite global de 2 y cuatro runs pedidos, **When** se pinta la cola, **Then** 2 corren y 2 esperan con su posición; al mover el último al primer lugar de espera, arranca antes.

---

### User Story 3 - Hand-off: pasar una tarea a otro agente sin perder lo hecho (Priority: P2)

Una tarea bloqueada o a medias puede **pasarse a otro ejecutor** (p. ej. de Codex a Claude) sobre la misma rama y worktree: conserva el test rojo verificado, los commits hechos y el historial; el nuevo agente retoma desde la fase en que quedó.

**Acceptance Scenarios**:

1. **Given** una tarea bloqueada en GREEN con Codex, **When** el operador la pasa a Claude, **Then** se retoma en GREEN, en la misma rama, con el fallo pendiente como contexto y los intentos ya consumidos contados.
2. **Given** un hand-off que dejaría al implementador igual que el revisor, **When** se pide, **Then** se rechaza con causa y acción (FR-034).
3. **Given** un hand-off, **When** se mira el transcript, **Then** se ve quién hizo cada fase.

---

### User Story 4 - Cerrar los huecos declarados (Priority: P2)

- `POST /v1/projects/:id/runs` rechaza por un bloqueante del diagnóstico, no solo la tarjeta.
- La pantalla de flota muestra cómo se fuerza el TDD de cada agente (`por_hook` / `por_motor`).
- El board anticipa el choque entre el ejecutor de la tarea y el revisor de la flota, con Run deshabilitado y el motivo.
- La API key de un runtime que solo es revisor llega a su fase.

### Edge Cases

- Una regla de ruteo que no deja pasar nada: el board lo dice en la columna, no se queda vacío en silencio.
- Dos proyectos con reglas que se solapan: la issue aparece en los dos, con su proyecto en la tarjeta (como en la spec 003).
- Orden manual de una tarjeta que desaparece del gestor: se olvida sin error.
- Hand-off en medio de una fase en vuelo: se rechaza; primero se detiene.

## Requirements _(mandatory)_

- **FR-001**: Cada proyecto con Linear MUST poder declarar equipo y reglas de ruteo (proyecto de Linear, etiquetas), validadas contra el `optionsSchema`; `listItems` MUST aplicarlas.
- **FR-002**: MUST existir un editor visual del `stateMap` que lista los estados reales del equipo (leídos del gestor) y guarda por `PATCH /v1/projects/:id/tracker`.
- **FR-003**: Al abrir PR el motor MUST empujar el estado y dejar un comentario de cierre con el enlace, si el gestor lo soporta; si no, degradación declarada.
- **FR-004**: Una issue con run que ya no cumple las reglas MUST marcarse «movida» con su destino.
- **FR-005**: El orden manual dentro de una columna MUST persistir en el almacén del servicio, por proyecto, sin escribir en el gestor.
- **FR-006**: La cola de runs MUST ser global, con límite configurable, visible con posición y reordenable.
- **FR-007**: `POST /v1/runs/:itemId/tasks/:taskId/handoff {runtime, agente?}` MUST retomar la tarea con otro implementador, en la misma rama, conservando rojo, commits e intentos; MUST rechazar si choca con el revisor o si la fase está en vuelo.
- **FR-008**: Los cuatro huecos de la User Story 4 MUST quedar cerrados, con test.

## Success Criteria _(mandatory)_

- **SC-001**: Con dos proyectos sobre el mismo equipo de Linear, cada board muestra solo lo suyo en el 100% de los casos grabados.
- **SC-002**: Configurar el gestor de un proyecto no exige escribir JSON.
- **SC-003**: Un hand-off retoma sin repetir el paso RED ni perder commits.
- **SC-004**: Todos los tests existentes siguen en verde.
