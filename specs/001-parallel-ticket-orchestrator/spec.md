# Feature Specification: Orquestador paralelo de tickets, agnóstico del gestor

**Feature Branch**: `001-parallel-ticket-orchestrator`

**Created**: 2026-09-16

**Status**: Draft

**Input**: User description: "noxloop: un orquestador genérico que toma una épica, feature, historia o tarea de cualquier gestor de tickets (GitHub, Linear, Azure DevOps, y con espacio plano para Jira u otros), genera el plan de trabajo y lo ejecuta en paralelo hasta dejar pull requests abiertos. Se dispara tanto por asignación de un ticket como por mención. Publicable e instalable por terceros."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Asignar un ticket es todo lo que hay que hacer (Priority: P1)

Una persona del equipo asigna un ticket a noxloop en el gestor que ya usa, o lo
menciona en un comentario. Sin abrir una terminal ni escribir un prompt, el
ticket queda con un pull request abierto, sus criterios de aceptación cubiertos
por tests que fallaron antes de existir la implementación, y el estado del
ticket reflejando lo que realmente pasó.

**Why this priority**: Es el producto. Todo lo demás —paralelismo, hitos, otros
gestores— es una ampliación de este recorrido. Si solo se implementa esta
historia, el sistema ya entrega valor completo para un ticket a la vez.

**Independent Test**: Asignar un ticket con criterios de aceptación verificables
en un proyecto de prueba y comprobar, sin ninguna intervención intermedia, que
aparece un pull request cuyo diff contiene el test antes que la implementación
en el historial de commits, y que el ticket quedó comentado con el enlace.

**Acceptance Scenarios**:

1. **Given** un ticket con criterios de aceptación verificables y sin asignar,
   **When** se le asigna noxloop, **Then** el sistema lo toma, deja un pull
   request abierto y comenta el enlace en el ticket.
2. **Given** un ticket sin criterios de aceptación verificables, **When** se le
   asigna noxloop, **Then** el sistema no escribe código: deja el ticket
   bloqueado con la pregunta concreta que hay que responder.
3. **Given** un ticket ya tomado por un recorrido en curso, **When** se le
   asigna noxloop otra vez, **Then** el sistema reporta en qué punto está y no
   arranca un segundo recorrido sobre el mismo ticket.
4. **Given** un recorrido que dejó su pull request abierto, **When** termina,
   **Then** ni ese pull request se mergea ni se dispara ningún despliegue.

---

### User Story 2 - Un hito se cierra completo, y en paralelo (Priority: P1)

Un responsable aprueba una épica o feature una sola vez. El sistema recorre sus
historias, ejecuta a la vez todo lo que el grafo de dependencias permite, e
integra cada historia terminada sobre la rama del hito para que la siguiente
arranque sobre trabajo ya integrado. Al final queda un pull request por historia
y una sola rama de hito lista para la revisión humana.

**Why this priority**: Es la diferencia entre una herramienta que ahorra
minutos y una que ahorra días. Y es la razón por la que el paralelismo existe:
con ejecución serial, un hito de nueve historias tarda la suma de las nueve.

**Independent Test**: Preparar una épica con tres historias sin dependencias
entre sí y verificar que las tres avanzan a la vez —observable en los recorridos
activos y en los worktrees existentes— y que el tiempo total se aproxima al de
la historia más lenta, no a la suma de las tres.

**Acceptance Scenarios**:

1. **Given** una épica con historias sin dependencias entre sí, **When** se
   lanza el recorrido, **Then** varias historias avanzan simultáneamente hasta
   el límite de paralelismo configurado.
2. **Given** dos tareas donde la segunda depende de la primera, **When** el
   planificador decide qué ejecutar, **Then** la segunda no empieza hasta que la
   primera está integrada.
3. **Given** dos tareas sin dependencia entre ellas sobre el mismo repositorio,
   **When** corren a la vez, **Then** ninguna ve ni pisa los cambios de la otra.
4. **Given** una tarea terminada que espera integración, **When** la cola la
   toma, **Then** se rebasa sobre la punta actual y se vuelve a verificar antes
   de integrarla; si el resultado no pasa, no se integra.
5. **Given** una historia que agota sus presupuestos, **When** queda bloqueada,
   **Then** el recorrido sigue con las demás y al final se reporta cuáles
   quedaron fuera y cuáles se volvieron inalcanzables por depender de ellas.

---

### User Story 3 - Funciona con el gestor de tickets que ya usás (Priority: P2)

Un equipo que trabaja con GitHub Issues, otro con Linear y otro con Azure
DevOps instalan el mismo sistema y obtienen el mismo recorrido. Quien use un
gestor no incluido puede agregarlo escribiendo un solo archivo, sin leer ni
modificar el motor.

**Why this priority**: Condiciona la adopción externa, que es el objetivo de
publicarlo. Un orquestador atado a un gestor solo sirve a quien usa ese gestor.

**Independent Test**: Correr la misma suite de contrato de proveedor contra los
tres proveedores incluidos y obtener el mismo resultado; después, agregar un
proveedor nuevo de prueba y verificar que pasa la suite sin ningún cambio en el
motor (comprobable porque el motor no tiene cambios sin commitear).

**Acceptance Scenarios**:

1. **Given** cualquiera de los gestores soportados configurado, **When** se
   ejecuta el mismo recorrido, **Then** el resultado observable es el mismo:
   plan, tests primero, pull request, estado y comentario en el ticket.
2. **Given** un gestor que no soporta dependencias explícitas entre tickets,
   **When** el sistema arma el orden de trabajo, **Then** lo declara y serializa
   por defecto en vez de inventar un orden.
3. **Given** un gestor que no soporta alguna capacidad opcional, **When** el
   recorrido llega al punto que la usaría, **Then** continúa y deja constancia
   de lo que no pudo hacer, sin fallar.
4. **Given** un archivo de proveedor nuevo, **When** se declara en la
   configuración, **Then** el sistema lo reconoce sin ningún cambio en el motor.

---

### User Story 4 - Un recorrido interrumpido se retoma donde quedó (Priority: P2)

Se corta la luz, se cierra la terminal o se agota un presupuesto a mitad de un
hito de doce historias. Quien vuelve al día siguiente relanza el recorrido y
continúa exactamente donde estaba, sin repetir trabajo hecho ni regalar intentos
a una tarea que ya los consumió.

**Why this priority**: Un recorrido largo se interrumpe; es un hecho, no una
excepción. Sin esto, cada interrupción cuesta el hito entero.

**Independent Test**: Matar el proceso a mitad de un recorrido de varias
historias, relanzarlo, y verificar que no repite ninguna tarea ya terminada, que
las tareas a medias conservan sus intentos consumidos, y que el resultado final
es el mismo que sin la interrupción.

**Acceptance Scenarios**:

1. **Given** un recorrido interrumpido, **When** se relanza, **Then** continúa
   desde el estado en disco y no reconstruye el plan de memoria.
2. **Given** una tarea que consumió intentos antes de la interrupción, **When**
   se retoma, **Then** conserva los intentos consumidos.
3. **Given** un corte a mitad de una escritura de estado, **When** se relanza,
   **Then** el estado se lee completo y consistente, nunca a medias.
4. **Given** una tarea que quedó a medias con cambios sin commitear, **When** se
   retoma, **Then** el sistema se detiene a decidir qué hacer con ella en vez de
   pisarla.
5. **Given** un recorrido ya en curso, **When** alguien lanza un segundo
   proceso sobre el mismo hito, **Then** el segundo no arranca.

---

### User Story 5 - Instalable por alguien que no lo escribió (Priority: P3)

Una persona que encuentra el proyecto publicado lo instala en su organización
siguiendo el README, declara sus repositorios y su gestor de tickets en un
archivo de configuración, corre una verificación que le dice exactamente qué le
falta, y cierra su primer ticket el mismo día.

**Why this priority**: Es lo que separa un proyecto publicado de un proyecto
usable. No cambia lo que el motor hace, pero decide si alguien más lo corre.

**Independent Test**: En una máquina sin ninguna configuración previa, seguir
únicamente el README hasta dejar un ticket cerrado, sin leer el código del
motor y sin preguntarle nada a quien lo escribió.

**Acceptance Scenarios**:

1. **Given** una instalación nueva, **When** se corre la verificación de
   entorno, **Then** informa qué está declarado, qué falta y qué credencial no
   está presente, sin inventar valores por defecto peligrosos.
2. **Given** una configuración incompleta o inválida, **When** se intenta
   arrancar, **Then** el sistema no arranca y dice exactamente qué corregir.
3. **Given** una configuración válida, **When** se corre el recorrido en modo de
   simulación, **Then** muestra qué haría sin ejecutar nada.
4. **Given** un repositorio cuyo directorio local no corresponde al declarado,
   **When** se verifica el entorno, **Then** se detecta y se reporta, en vez de
   trabajar en el repositorio equivocado.

---

### Edge Cases

- **Un ticket sin criterios de aceptación verificables**: no se inventa el
  criterio ni se escribe código. Se bloquea con la pregunta concreta.
- **El gestor no soporta dependencias entre tickets**: se declara la carencia y
  se serializa; nunca se deduce un orden que el gestor no afirma.
- **Dos tareas del mismo repositorio en paralelo**: cada una en su propio
  espacio de trabajo aislado; ninguna ve los cambios sin integrar de la otra.
- **Conflicto al integrar una tarea terminada**: la integración se rechaza, la
  tarea vuelve a estar abierta con el conflicto como causa, y el resto del
  recorrido sigue.
- **El gate del repositorio ya estaba roto antes de la tarea**: se distingue de
  un fallo causado por la tarea, y la tarea no se bloquea por un fallo ajeno.
- **Se agota el presupuesto a mitad de una invocación**: el corte se detecta
  como corte, nunca como éxito, y se reporta como tal.
- **El gestor de tickets responde con límite de tasa o cae**: se reintenta con
  espera; si persiste, el recorrido se detiene con la causa real, sin marcar
  tareas como terminadas.
- **Un espacio de trabajo quedó huérfano de un recorrido anterior**: se detecta
  y se limpia solo si no tiene cambios sin commitear.
- **Dos procesos sobre el mismo hito**: solo uno corre; el segundo lo informa y
  termina.
- **Un ticket asignado y mencionado a la vez**: produce un solo recorrido, no
  dos.

## Requirements _(mandatory)_

### Functional Requirements

**Entrada y disparo**

- **FR-001**: El sistema MUST aceptar como entrada un ticket de cualquier nivel
  —épica, feature, historia o tarea— y resolver su nivel consultando al gestor,
  nunca deduciéndolo del nombre del tipo.
- **FR-002**: El sistema MUST detectar trabajo nuevo por asignación del ticket y
  por mención en un comentario, y producir un solo recorrido cuando ocurren las
  dos cosas sobre el mismo ticket.
- **FR-003**: El sistema MUST poder invocarse manualmente sobre un ticket
  concreto, y MUST ofrecer un modo de simulación que muestre el plan sin
  ejecutar nada.
- **FR-004**: El sistema MUST rechazar el arranque cuando su configuración es
  inválida o incompleta, indicando qué corregir.

**Planificación**

- **FR-005**: El sistema MUST convertir un ticket en un plan de tareas atómicas,
  cada una con un criterio verificable, los archivos que va a tocar, los
  archivos de test que la prueban y sus dependencias.
- **FR-006**: El sistema MUST rechazar un ticket cuyos criterios de aceptación
  no puedan convertirse en un test que falle, y MUST reportarlo como pregunta en
  vez de rellenarlo con una suposición.
- **FR-007**: El sistema MUST derivar el orden de trabajo del grafo de
  dependencias, y MUST distinguir dependencias que bloquean de dependencias que
  solo informan.
- **FR-008**: El sistema MUST asignar a cada tarea un tamaño que module la
  profundidad de la verificación y el costo, sin que ningún tamaño elimine el
  paso de test-primero.
- **FR-009**: El sistema MUST materializar las tareas del plan como tickets
  hijos en el gestor cuando el gestor lo soporte, heredando los campos de
  planificación necesarios para que aparezcan en el tablero.

**Ejecución**

- **FR-010**: El sistema MUST ejecutar en paralelo las tareas sin dependencia
  entre sí, hasta un límite configurable, y MUST serializar las dependientes.
- **FR-011**: El sistema MUST ejecutar cada tarea paralela en un espacio de
  trabajo aislado, sin tocar el área de trabajo de una persona.
- **FR-012**: El sistema MUST impedir toda escritura sobre archivos de
  producción de una tarea mientras no exista un test propio verificado en rojo.
- **FR-013**: El sistema MUST impedir que una tarea escriba archivos que no
  declaró, y MUST permitir ampliar el alcance solo de forma explícita y
  registrada.
- **FR-014**: El sistema MUST determinar el resultado de una tarea a partir del
  código de salida de la verificación del repositorio, y MUST rechazar cualquier
  veredicto que no tenga esa evidencia.
- **FR-015**: El sistema MUST consumir un presupuesto explícito por cada intento
  de cada ciclo, y MUST bloquear la tarea con la causa real al agotarlo.
- **FR-016**: El sistema MUST continuar con las demás tareas cuando una queda
  bloqueada, y MUST reportar al final las bloqueadas y las que quedaron
  inalcanzables por depender de ellas.
- **FR-017**: El sistema MUST detectar cuando una invocación se cortó por
  agotar su presupuesto de costo y MUST tratarlo como corte, nunca como éxito.
- **FR-018**: El sistema MUST detectar que un recorrido dejó de avanzar y
  detenerlo, sin depender de que el modelo se dé cuenta.

**Integración y límite de autonomía**

- **FR-019**: El sistema MUST integrar el trabajo terminado a través de una cola
  serial que rebase sobre la punta actual y vuelva a verificar antes de
  integrar.
- **FR-020**: El sistema MUST abrir un pull request por ticket, con los
  criterios de aceptación, la evidencia real de la verificación, las carencias
  declaradas del repositorio y las ampliaciones de alcance registradas.
- **FR-021**: El sistema MUST NOT mergear a una rama protegida, desplegar, hacer
  force push ni ejecutar operaciones destructivas, y esta restricción MUST
  aplicarse por interceptación de la operación, no por instrucción.
- **FR-022**: El sistema MUST reflejar en el ticket el avance real —en curso,
  bloqueado, con pull request— y MUST NOT mover un ticket hacia atrás ni
  cerrarlo.

**Estado y reanudación**

- **FR-023**: El sistema MUST persistir todo el estado necesario para retomar,
  fuera de los repositorios, con escrituras atómicas.
- **FR-024**: El sistema MUST retomar un recorrido interrumpido desde el estado
  persistido, sin repetir trabajo terminado y sin devolver presupuesto
  consumido.
- **FR-025**: El sistema MUST impedir que dos procesos recorran el mismo hito a
  la vez.
- **FR-026**: El sistema MUST exponer el estado de un recorrido de forma legible
  y sin interpretación: tareas, estados, intentos, bloqueos y enlaces.

**Agnosticismo del gestor**

- **FR-027**: El sistema MUST interactuar con el gestor de tickets únicamente a
  través de una interfaz de proveedor, y MUST NOT contener lógica específica de
  ningún gestor fuera de su proveedor.
- **FR-028**: Cada proveedor MUST declarar qué capacidades soporta, y el sistema
  MUST consultar esa declaración antes de usar una capacidad en vez de asumirla.
- **FR-029**: El sistema MUST degradar de forma limpia y visible cuando una
  capacidad no está disponible, sin fallar el recorrido.
- **FR-030**: Agregar un gestor nuevo MUST requerir únicamente un archivo de
  proveedor nuevo y su declaración en la configuración, sin cambios en el motor.
- **FR-031**: El sistema MUST traducir entre sus estados canónicos y los estados
  del gestor mediante configuración, y MUST NOT escribir un nombre de estado de
  memoria.

**Configuración y adopción**

- **FR-032**: Toda referencia a organizaciones, repositorios, comandos de
  verificación, ramas base, límites y credenciales MUST vivir en configuración
  validada, no en el código del motor.
- **FR-033**: El sistema MUST ofrecer una verificación de entorno que informe
  qué está declarado, qué falta y qué credencial no está presente.
- **FR-034**: El sistema MUST verificar que el directorio local de un
  repositorio corresponde efectivamente al repositorio declarado.
- **FR-035**: El sistema MUST declarar, por repositorio, qué no cubre su
  verificación, y MUST hacer visible esa carencia en el pull request.

### Key Entities

- **Ticket**: unidad de trabajo del gestor externo, de cualquier nivel. Tiene
  identidad, título, descripción, criterios de aceptación, estado, responsable,
  padre y relaciones de dependencia. El sistema lo lee y lo anota; no es su
  dueño.
- **Plan**: grafo dirigido de tareas derivado de un ticket. Es el contrato entre
  la fase que entiende y la fase que ejecuta.
- **Tarea**: unidad atómica ejecutable. Pertenece a un repositorio, declara su
  criterio verificable, sus archivos de producción, sus archivos de test, su
  tamaño y sus dependencias.
- **Recorrido**: ejecución de un plan. Guarda el estado de cada tarea, los
  intentos consumidos por ciclo, los espacios de trabajo, los enlaces
  producidos y la causa de cada bloqueo.
- **Hito**: ticket de nivel superior que agrupa otros. Tiene su propia rama de
  integración y su propio orden de recorrido.
- **Proveedor**: adaptador de un gestor de tickets. Declara sus capacidades y
  traduce entre el modelo canónico y el del gestor.
- **Verificación**: comando por repositorio cuyo código de salida decide si una
  tarea cumple, junto con la declaración de lo que ese comando no cubre.
- **Cola de integración**: mecanismo serial que decide el orden en que el
  trabajo terminado entra a la rama compartida.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Un ticket con criterios de aceptación verificables llega a pull
  request abierto sin ninguna intervención humana entre la asignación y el
  resultado, en al menos 8 de cada 10 intentos.
- **SC-002**: Un hito de tres historias independientes se completa en un tiempo
  que se aproxima al de la historia más lenta, y en ningún caso supera el 60%
  de la suma de las tres.
- **SC-003**: El 100% de los pull requests producidos contienen el test antes
  que su implementación en el historial, verificable sin leer el código del
  sistema.
- **SC-004**: Cero pull requests mergeados y cero despliegues disparados por el
  sistema, en cualquier configuración y sin excepción.
- **SC-005**: Cero tareas reportadas como cumplidas sin evidencia de una
  verificación ejecutada.
- **SC-006**: Retomar un recorrido interrumpido no repite ninguna tarea
  terminada ni devuelve ningún intento consumido, en el 100% de los casos.
- **SC-007**: Agregar un gestor de tickets nuevo requiere un solo archivo nuevo
  y cero líneas modificadas en el motor, y ese proveedor pasa la misma suite de
  contrato que los incluidos.
- **SC-008**: Una persona ajena al proyecto llega a su primer ticket cerrado
  siguiendo únicamente la documentación publicada, sin consultar a quien lo
  escribió.
- **SC-009**: Una búsqueda de nombres propios de organización, repositorio o
  host en el código del motor devuelve cero resultados.
- **SC-010**: Un hito interrumpido a la mitad y retomado produce el mismo
  resultado final que el mismo hito sin interrupción.

## Assumptions

- Los repositorios de trabajo están disponibles localmente y el sistema tiene
  permiso para crear espacios de trabajo aislados sobre ellos.
- Cada repositorio tiene un comando de verificación propio que devuelve un
  código de salida significativo. Donde no lo hay, la carencia se declara y las
  tareas con lógica de negocio no se asignan a ese repositorio.
- El código vive en un sistema de control de versiones con pull requests, que
  puede ser distinto del gestor de tickets. Esa separación es la norma, no la
  excepción.
- Los tickets que el sistema recibe tienen o pueden tener criterios de
  aceptación. Un gestor usado solo como lista de títulos queda fuera de alcance.
- Las credenciales de cada gestor se proveen por entorno y nunca se persisten en
  la configuración del proyecto.
- El límite de paralelismo real lo impone la máquina y la cuota del proveedor
  del modelo; el sistema respeta un límite configurado y no intenta descubrirlo.
- La revisión humana del pull request y su merge quedan fuera de alcance, por
  decisión de diseño y no por falta de capacidad.
- Existe un único responsable humano por hito, que aprueba una vez al principio.
