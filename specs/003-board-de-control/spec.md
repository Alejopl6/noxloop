# Feature Specification: El board de control · un proyecto es su board

**Feature Branch**: `003-board-de-control`

**Created**: 2026-09-23

**Status**: Draft

**Input**: Pedido del operador del 2026-09-23, con un referente visual de un kanban de agentes: «el concepto debe ser simple, hoy está complejo. Un proyecto tiene un board de control, y listo. Puedo ver el board por proyecto, general, etc. En settings vemos las tools». Tres decisiones tomadas por el operador el mismo día (ver *Decisiones*).

---

## Qué es esto y qué no es

La spec 002 construyó el establecimiento de un proyecto y lo presentó como catorce destinos de navegación: seis del espacio de trabajo (Inicio, Asistente, Bandeja, Proyectos, Credenciales, Auditoría) y ocho por proyecto (snapshot, constitution, guidelines, diseño, bootstrap, conexiones, flota, ciclos). Cada pantalla era correcta, y el conjunto obliga al operador a saber cuál toca. Es la misma densidad que el producto existe para quitar, un nivel más arriba.

Esta feature cambia el **eje** del producto. El establecimiento pasa a ser algo que se hace **una vez**, y lo que se usa todos los días es un **board**: los tickets del proyecto en columnas, qué está corriendo, qué necesita al operador, y un botón para lanzar el trabajo.

**El modelo en una frase**: un proyecto es su board. El board general es el mismo board con el filtro de proyecto en «Todos».

**Queda fuera de esta feature, a propósito:**

| Excluido | Motivo |
|---|---|
| Crear, editar o mover tickets desde el board | El gestor de tickets es la fuente de verdad del backlog (principio VI). El board lo lee; arrastrar una tarjeta sería un segundo escritor del gestor. |
| Rediseñar el ciclo de ejecución | El motor ya lo resuelve. Esta feature lo lanza y lo muestra. |
| Merge y deploy desde el board | La autonomía termina en el PR abierto (principio IV). La columna «En revisión» termina en un enlace al PR, no en un botón de merge. |
| Multiusuario y roles | El alcance sigue siendo un operador con varios proyectos. El asignado de un ticket se muestra; no controla permisos. |
| Borrar las pantallas de establecimiento | Se **mueven** a Settings, no se eliminan. Su dominio, sus guardas y sus tests siguen. |

---

## Decisiones tomadas por el operador (2026-09-23)

1. **Las etapas del alta salen de la navegación.** Al crear un proyecto corre el asistente una vez —ya existe—, y después todo lo que hoy son etapas vive en **Settings del proyecto**. En **Settings general** van las herramientas y conexiones, las credenciales, la flota y la auditoría. Un proyecto entra al board cuando está `ACTIVE`.
2. **Las tarjetas de Backlog y Todo salen del gestor de tickets real** (Linear, GitHub Issues, Azure DevOps). Hace falta una capacidad nueva de proveedor para listar los tickets de un proyecto, con su degradación declarada.
3. **El botón «Run» lanza el motor.** El servicio de control arranca el motor sobre el mismo home. Hoy `POST /v1/projects/:id/runs` contesta `pieza_ausente`; esta feature lo cierra. La interfaz sigue sin escribir estado (principio VIII).

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Ver el trabajo de un proyecto, o de todos, en un board (Priority: P1)

El operador abre la aplicación y lo primero que ve es el board. Cuatro columnas —Backlog, Todo, En curso, En revisión— con los tickets de sus proyectos activos. Cada tarjeta dice qué ticket es, de qué proyecto, quién lo tiene, y en qué está. Filtra por proyecto para ver el board de uno solo, o lo deja en «Todos».

**Why this priority**: es el cambio de eje. Sin el board, el resto de la feature no tiene dónde vivir, y ver el estado real de todo en una pantalla ya es valor aunque todavía no se pueda lanzar nada desde ahí.

**Independent Test**: con dos proyectos activos y un gestor falso con tickets en varios estados, y un run en curso en el disco, el board muestra cada ticket una sola vez en la columna que le corresponde, y el filtro de proyecto reduce el board a los tickets de ese proyecto.

**Acceptance Scenarios**:

1. **Given** dos proyectos `ACTIVE` con tickets en el gestor, **When** el operador abre la aplicación, **Then** ve el board general con los tickets de los dos, agrupados en Backlog, Todo, En curso y En revisión, y un contador por columna.
2. **Given** el board general, **When** el operador elige un proyecto en el filtro, **Then** el board muestra solo los tickets de ese proyecto y la dirección de la pantalla cambia para poder volver a ella.
3. **Given** un ticket en «Todo» del gestor con un run del motor en curso, **When** se pinta el board, **Then** la tarjeta aparece en **En curso**: lo que hace el motor manda sobre el estado que diga el gestor.
4. **Given** un ticket con un PR abierto por el motor, **When** se pinta el board, **Then** la tarjeta aparece en **En revisión** con un chip «PR #N listo» que enlaza al PR.
5. **Given** un ticket de un proyecto que no está `ACTIVE`, **When** se pinta el board, **Then** no aparece, y el proyecto figura en la lista lateral con la acción de terminar de configurarlo.
6. **Given** el board, **When** el operador escribe en el buscador o filtra por asignado o por «tiene repo», **Then** las columnas se reducen a las tarjetas que cumplen todos los filtros activos, y los contadores reflejan lo filtrado.

---

### User Story 2 - Lanzar el trabajo desde una tarjeta y seguirlo (Priority: P1)

El operador ve un ticket en Backlog o Todo y pulsa **Run**. El motor empieza a trabajarlo y la tarjeta se mueve a En curso con una barra de avance y la fase en la que está. Si falla, la tarjeta lo dice y ofrece **Retry**. Desde cualquier tarjeta con run, **Abrir run** lleva al detalle.

**Why this priority**: sin esto el board es un espejo del gestor, y el operador vuelve a la terminal para hacer lo único que el producto existe para hacer. Es la decisión 3 del operador.

**Independent Test**: con el proveedor `fake` y el adaptador de agente falso, pulsar Run en una tarjeta de un proyecto `ACTIVE` deja un run en disco, la tarjeta pasa a En curso en segundos y, al terminar, a En revisión con el PR.

**Acceptance Scenarios**:

1. **Given** un ticket en Todo de un proyecto `ACTIVE` con autonomía L2, **When** el operador pulsa Run, **Then** el motor planifica y ejecuta sin más confirmación, y la tarjeta pasa a En curso con su avance.
2. **Given** un proyecto con autonomía L0 o L1, **When** el operador pulsa Run, **Then** el motor planifica y **para**: la tarjeta muestra el chip «Plan listo» y la acción de revisar y aprobar el plan. Solo al aprobarlo empieza la ejecución (el plan es el punto de aprobación humana del flujo).
3. **Given** más runs pedidos de los que el proyecto permite en paralelo, **When** el operador pulsa Run, **Then** el run queda en cola y la tarjeta muestra «En cola · #N» con su posición.
4. **Given** un run que terminó con tareas bloqueadas o que falló, **When** se pinta la tarjeta, **Then** muestra el chip correspondiente con la causa textual al pasar por encima, y la acción **Retry**, que retoma el run sin perder lo ya integrado.
5. **Given** un ticket cuyo proyecto no tiene repositorio configurado, **When** se pinta la tarjeta, **Then** muestra «Sin repo» y el botón Run aparece deshabilitado, diciendo qué falta.
6. **Given** un Run pulsado dos veces sobre el mismo ticket, **When** llega la segunda petición, **Then** no se lanza un segundo run: la respuesta devuelve el run que ya existe.
7. **Given** un ticket sin criterios de aceptación verificables, **When** el operador pulsa Run, **Then** la tarjeta muestra «Necesita criterios» con la pregunta textual del planificador, y no se gasta ninguna ejecución.

---

### User Story 3 - Atender lo que me necesita (Priority: P2)

Algunos runs se detienen esperando al operador: una credencial sin permiso, una tarea bloqueada que pide una decisión, un plan esperando aprobación. El operador los ve en el resumen de la barra superior («2 te necesitan»), en la lista de runs activos del lateral y como un chip ámbar en la tarjeta. Uno de esos, un clic, y resuelve.

**Why this priority**: la bandeja de la spec 002 ya resuelve esto, pero como un destino aparte. En el board es una señal que se ve sin ir a buscarla. Depende de US1 y US2.

**Independent Test**: un run con una tarea que pide una credencial sin grant aparece en el resumen, en los runs activos y como chip «Necesita permiso» en su tarjeta; resolverlo desde ahí hace desaparecer las tres señales.

**Acceptance Scenarios**:

1. **Given** un run detenido por una credencial sin grant, **When** se pinta el board, **Then** su tarjeta muestra «Necesita permiso», el lateral lo lista en Runs activos y el resumen superior cuenta uno más en «te necesitan».
2. **Given** una entrada que necesita al operador, **When** la abre, **Then** ve la causa textual completa —no un resumen generado— y la acción que la resuelve.
3. **Given** que no hay nada que necesite al operador, **When** se pinta el resumen, **Then** lo dice («nada te espera») en vez de mostrar un cero ambiguo.

---

### User Story 4 - Una navegación de cuatro entradas, y la configuración en Settings (Priority: P2)

La navegación lateral tiene **Board, Runs, Costos y Settings**, la lista de proyectos y los runs activos. Nada más. Crear un proyecto abre el asistente de una vez. Lo que hoy son etapas —snapshot, constitution, guidelines, diseño, bootstrap, conexiones, flota— se encuentra en Settings del proyecto. Las herramientas y conexiones, las credenciales, la flota y la auditoría, en Settings general.

**Why this priority**: es la simplificación que pidió el operador. Va después del board porque sin el board no hay a dónde mandar al operador cuando termina de configurar.

**Independent Test**: se recorre la navegación y se cuentan los destinos del nivel principal; se comprueba que cada pantalla de establecimiento de la spec 002 se alcanza desde Settings y que ninguna quedó sin camino.

**Acceptance Scenarios**:

1. **Given** la aplicación abierta, **When** el operador mira la navegación lateral, **Then** ve exactamente Board, Runs, Costos y Settings como destinos, más la lista de proyectos y los runs activos.
2. **Given** un proyecto nuevo, **When** el operador lo crea, **Then** se abre el asistente de establecimiento, y al llegar a `ACTIVE` lo deja en el board de ese proyecto.
3. **Given** un proyecto a medio establecer, **When** el operador lo elige en la lista lateral, **Then** lo lleva al paso del asistente en el que quedó, no a un board vacío.
4. **Given** un proyecto `ACTIVE`, **When** el operador abre Settings del proyecto, **Then** encuentra constitution, guidelines, diseño, bootstrap, conexiones del proyecto, flota y autonomía, cada una con su pantalla actual.
5. **Given** cualquier pantalla de la spec 002, **When** se busca su camino, **Then** existe uno desde Settings o desde ⌘K. Ninguna queda alcanzable solo por dirección.

---

### User Story 5 - Ver cuánto cuesta (Priority: P3)

El operador abre Costos y ve lo gastado por proyecto y por run —dinero e invocaciones— en un periodo, a partir de lo que cada run ya registra.

**Why this priority**: útil, pero no bloquea nada. El dato ya existe en el disco; esta historia solo lo junta.

**Independent Test**: con tres runs con gasto registrado en dos proyectos, Costos muestra el total por proyecto y por run, y la suma cuadra con lo que dicen los runs.

**Acceptance Scenarios**:

1. **Given** runs con gasto registrado, **When** el operador abre Costos, **Then** ve el total del periodo, el desglose por proyecto y los runs más caros.
2. **Given** un runtime que no mide gasto, **When** se pintan sus runs, **Then** aparecen como «sin medir», no como cero: un cero diría que fue gratis.

---

### User Story 6 - Ver qué cambió cada agente (Priority: P2)

Desde «Abrir run», el operador ve las tareas del run y, por cada una, el diff exacto que dejó su agente: los archivos tocados con sus líneas, separados en el commit del test y el de la implementación. Sin abrir una terminal.

**Why this priority**: es lo que permite confiar en lo que hace un agente sin leer el PR entero, y es la evidencia de que el test existió antes que el código (principio I), a la vista.

**Independent Test**: un run del proveedor `fake` con dos tareas integradas; el detalle muestra por tarea sus archivos y el diff de cada uno de los dos commits, y coincide con `git diff` sobre la rama de la tarea.

**Acceptance Scenarios**:

1. **Given** un run con tareas integradas, **When** el operador abre el run, **Then** ve cada tarea con su estado, su agente y un resumen de archivos (+/−).
2. **Given** una tarea, **When** la abre, **Then** ve el diff del commit de test y el del commit de implementación por separado, con el mensaje de cada commit.
3. **Given** una tarea en curso, **When** la abre, **Then** ve el diff de lo que lleva hecho en su worktree respecto a su base, marcado como «sin commitear».

### Edge Cases

- **Gestor que no sabe listar tickets.** Si un proveedor no declara la capacidad de listar, Backlog y Todo muestran lo que el motor sí conoce de ese proyecto —tickets asignados o mencionados y los que ya tienen run— y una nota en la columna que nombra el proveedor y la capacidad que le falta. Nunca un board vacío sin explicación.
- **Gestor caído o credencial expirada.** Las tarjetas que vienen de runs en disco siguen apareciendo. Las columnas que dependen del gestor muestran la causa textual del fallo y la acción (reconectar, renovar), sin tumbar el resto del board.
- **Muchos tickets.** Un proyecto con cientos de tickets abiertos: el board muestra los primeros de cada columna por orden del gestor y dice cuántos más hay, en vez de cortarlos en silencio.
- **Ticket que el gestor movió mientras corre el run.** Manda el run: la tarjeta sigue en En curso hasta que el run termine o se detenga.
- **Ticket terminado.** Los tickets cerrados en el gestor y sin run activo no se muestran por defecto; un filtro «incluir terminados» los trae.
- **El servicio se detiene con runs en curso.** Al volver, esos runs aparecen como «Interrumpido» con Retry, que los retoma desde el disco (principio III).
- **Un ticket que pertenece a más de un proyecto** (dos proyectos apuntan al mismo gestor y equipo): aparece una vez por proyecto, con el proyecto en la tarjeta. El board general no los fusiona.
- **Run pedido sobre un proyecto que dejó de estar `ACTIVE`.** Se rechaza nombrando la etapa que falta, como ya hace el servicio.

---

## Requirements _(mandatory)_

### Functional Requirements

**El board**

- **FR-001**: El board MUST ser la pantalla de inicio de la aplicación y mostrar cuatro columnas en este orden: Backlog, Todo, En curso, En revisión, cada una con su contador.
- **FR-002**: El board MUST poder mostrarse para un proyecto o para todos los proyectos `ACTIVE`, y el proyecto elegido MUST quedar en la dirección de la pantalla.
- **FR-003**: La columna de cada tarjeta MUST derivarse con esta precedencia: un run con PR abierto → En revisión; un run en vuelo, en cola o detenido → En curso; si no hay run, el estado canónico del gestor (backlog → Backlog, todo → Todo, en curso → En curso, en revisión → En revisión).
- **FR-004**: Bloqueado, fallido, interrumpido, en cola, necesita permiso, necesita criterios, plan listo y sin repo MUST mostrarse como **chips** en la tarjeta, nunca como columnas.
- **FR-005**: Cada tarjeta MUST mostrar la clave del ticket, su prioridad si el gestor la da, el título, el equipo y el proyecto, el asignado, el chip de estado y **una** acción principal (Run, Abrir run, Retry, o ninguna con el motivo).
- **FR-006**: Una tarjeta con run MUST mostrar el avance como tareas integradas sobre el total, y la fase de la tarea en curso.
- **FR-007**: El board MUST permitir filtrar por texto, proyecto, asignado y «tiene repo», combinables, y los contadores MUST reflejar lo filtrado.
- **FR-008**: La barra superior MUST resumir cuántos runs hay en curso, cuántos necesitan al operador y cuántos están en cola, y decirlo en palabras cuando todos son cero.
- **FR-009**: El board MUST actualizarse solo cuando cambia el estado de un run, sin que el operador recargue.

**Los tickets del gestor**

- **FR-010**: El contrato de proveedor MUST incluir una capacidad para listar los tickets abiertos de un proyecto, con su estado canónico, asignado, prioridad y equipo cuando el gestor los tenga. Linear, GitHub Issues y Azure DevOps MUST implementarla y pasar su suite de contrato.
- **FR-011**: Un proveedor sin esa capacidad MUST degradar de forma visible (ver *Edge Cases*), y la suite de contrato MUST verificar que la degradación está declarada.
- **FR-012**: El estado canónico MUST poder distinguir backlog de todo cuando el gestor lo distingue. Cuando no lo distingue, todo cae en Todo y el board lo declara en la columna Backlog.
- **FR-013**: Un fallo del gestor MUST mostrarse con su causa textual y su acción, y MUST NOT impedir que se vean las tarjetas que vienen de runs en disco.

**Lanzar el motor**

- **FR-014**: `Run` sobre una tarjeta MUST hacer que el servicio de control arranque el motor sobre el mismo home, y MUST responder con el identificador del run sin esperar a que termine.
- **FR-015**: El comportamiento de Run MUST seguir la autonomía del proyecto: en L2 planifica y ejecuta; en L0 y L1 planifica y para, y la ejecución empieza solo cuando el operador aprueba el plan.
- **FR-016**: Lanzar un run sobre un ticket que ya tiene uno MUST devolver el existente y MUST NOT crear otro.
- **FR-017**: El número de runs simultáneos MUST respetar el límite de paralelismo declarado, y los que exceden MUST quedar en cola con su posición visible.
- **FR-018**: Retry MUST retomar el run desde su estado en disco, conservando lo ya integrado y los intentos ya consumidos.
- **FR-019**: El run lanzado desde el board MUST quedar atribuido a su proyecto, de modo que aparezca en el board del proyecto y en sus runs.
- **FR-020**: La interfaz MUST NOT escribir estado: lanzar, aprobar y reintentar son peticiones al servicio (principio VIII).
- **FR-021**: Las credenciales que el motor necesita MUST llegarle por el mismo camino que ya usa la bóveda —entorno declarado del subproceso, nunca `argv`— (principio IX).

**Navegación y Settings**

- **FR-022**: La navegación lateral MUST tener como destinos principales exactamente Board, Runs, Costos y Settings, más la lista de proyectos y la lista de runs activos con su estado.
- **FR-023**: Crear un proyecto MUST abrir el asistente de establecimiento, y al llegar a `ACTIVE` MUST llevar al board de ese proyecto.
- **FR-024**: Settings del proyecto MUST reunir constitution, guidelines, diseño, bootstrap, conexiones del proyecto, flota y autonomía. Settings general MUST reunir herramientas y conexiones, credenciales, flota por defecto y auditoría.
- **FR-025**: Toda pantalla existente de la spec 002 MUST seguir alcanzable desde Settings o desde ⌘K; ninguna MUST quedar alcanzable solo por dirección.
- **FR-026**: La bandeja deja de ser un destino: sus entradas MUST aparecer como el chip «te necesita» de su tarjeta, en los runs activos y en el resumen superior, con la causa textual completa al abrirlas.

**Runs y costos**

- **FR-029**: El detalle de un run MUST mostrar, por tarea, el diff de cada uno de sus commits (test e implementación) y, si está en curso, el diff sin commitear de su worktree, leídos de git sin escribir nada.

- **FR-027**: Runs MUST listar los runs de todos los proyectos, filtrables por proyecto y estado, con acceso al detalle de cada uno.
- **FR-028**: Costos MUST mostrar el gasto por periodo, por proyecto y por run a partir de lo que cada run registra, y MUST distinguir «sin medir» de cero.

### Key Entities

- **Tarjeta**: la unión de un ticket del gestor y, si existe, el run del motor sobre ese ticket. Tiene columna derivada, chip de estado, acción principal y avance. No se guarda en ningún sitio: se deriva cada vez.
- **Ticket del gestor**: clave, título, estado canónico, asignado, prioridad, equipo, URL. Lo escribe solo el gestor.
- **Run**: el recorrido del motor sobre un ticket, ya existente, con su proyecto, sus tareas, su PR y su gasto.
- **Lanzamiento**: la petición de ejecutar un ticket, con su posición en la cola mientras espera y el run que produce al empezar.
- **Proyecto**: ya existe. Añade al board su filtro, su autonomía y su límite de paralelismo.

---

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Al abrir la aplicación, el operador puede decir qué necesita de él y qué está corriendo sin cambiar de pantalla. Se verifica en 5 de 5 sesiones de prueba y en menos de 5 segundos.
- **SC-002**: La navegación principal tiene 4 destinos, frente a los 14 de hoy, y ninguna pantalla de establecimiento se pierde (0 pantallas alcanzables solo por dirección).
- **SC-003**: Desde pulsar Run hasta ver la tarjeta en En curso pasan menos de 3 segundos.
- **SC-004**: Con 10 proyectos y 200 tickets abiertos, el board aparece completo en menos de 2 segundos, y un gestor caído no deja nunca el board en blanco.
- **SC-005**: Con el proveedor `fake`, un ticket va de Todo a En revisión con PR usando solo el board, de punta a punta y sin intervención en un proyecto L2.
- **SC-006**: Los tres proveedores reales listan tickets y pasan su suite de contrato; un proveedor sin la capacidad produce un board con la causa declarada en el 100% de los casos.
- **SC-007**: Construir el board no cambia nada en el disco ni en el gestor. Se mide antes y después, igual que el tablero de la spec 001.
- **SC-008**: Todos los tests existentes siguen en verde durante toda la feature, en cada commit.

---

## Assumptions

- Una columna **Hecho** no forma parte del board por defecto: el referente no la tiene y lo terminado no pide acción. Se accede con el filtro «incluir terminados».
- La **prioridad** se muestra solo cuando el gestor la tiene (Linear y Azure DevOps sí; en GitHub Issues puede venir de etiquetas mapeadas en la configuración). Sin dato, la tarjeta no muestra prioridad en vez de inventar una.
- «**Fase k/N**» del referente se interpreta como tareas integradas sobre el total del plan, más el nombre de la fase de la tarea en curso (test, implementación, gate, revisión).
- Los runs dependen del servicio que los lanzó: si el servicio se detiene, el run se interrumpe y queda retomable desde el disco. No se introduce un proceso que sobreviva a la aplicación.
- La correspondencia entre un proyecto y su espacio en el gestor —equipo de Linear, repositorio de GitHub, proyecto de Azure DevOps— ya está en la configuración del proyecto después del establecimiento. Esta feature la usa y no pide datos nuevos.
- El estilo visual sigue el sistema de diseño de la spec 002 (tokens de Geist, tema claro y oscuro). El referente guía la estructura y la jerarquía, no los colores.
- El gasto se lee de lo que cada run ya registra. Esta feature no añade medición nueva.
