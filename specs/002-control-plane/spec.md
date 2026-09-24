# Feature Specification: Control Plane de proyecto · establecimiento 00–07

**Feature Branch**: `002-control-plane`

**Created**: 2026-09-20

**Status**: Draft

**Input**: Definición de producto *AI Software Engineering Control Plane v1.0* (etapas 00–07 del ciclo, componentes transversales §11, gobernanza de credenciales §12) + decisiones de producto tomadas el 2026-09-20.

---

## Qué es esto y qué no es

noxloop hoy resuelve las etapas 08–12: un ticket entra y sale un pull request. Esta feature construye **lo que va antes**: el establecimiento del proyecto. Sin él, cada ciclo empieza explicándole al modelo lo mismo que se le explicó ayer.

El alcance es el bloque 00–07 del ciclo y la capa de credenciales que lo sostiene, sobre una superficie visual que funciona como aplicación de escritorio y como aplicación web con el mismo código.

**Queda fuera de esta feature, a propósito:**

| Excluido | Motivo |
|---|---|
| Rediseñar la ejecución 08–12 en la UI | El motor ya la resuelve y tiene 650 tests. Esta feature lo invoca, no lo reemplaza. |
| Merge y deploy autónomos | La autonomía termina en el PR abierto. Es invariante de la constitution, no una opción pendiente. |
| Memoria de proyecto (etapa 15) y evolución continua (16) | Dependen del esquema de evidencia, que esta feature deja preparado pero no consume. |
| Multiusuario, roles organizacionales | Producto distinto. El alcance asume un operador con varios proyectos. |
| Constructor visual de workflows | El DAG nace del plan del work item. |

---

## El modelo de interacción · corregido el 2026-09-21

> **Hacer fácil y visible lo que hoy es invisible pero necesario para desarrollar asistidamente con IA y con calidad.**

Esa es la frase del operador y es el criterio con el que se resuelve cualquier duda de interfaz. Se escribe aquí porque la primera versión de la superficie no la cumplía.

**Lo que se construyó primero y por qué estaba mal.** Trece vistas que se visitan como destinos: una consola. Cada pantalla, aislada, era correcta — y el conjunto le pedía al operador que supiera *cuál* de las trece tocaba ahora, en qué orden, y qué exigía cada una. Eso es trasladarle el problema: exactamente la densidad que el producto existe para quitar.

**El modelo correcto es un recorrido guiado**, y no es un cambio de estética:

```
crear proyecto → discovery → constitution → guidelines → design
              → bootstrap → connections → flota → listo
```

Una decisión a la vez, centrado y a una columna. Lo denso detrás de un «ver detalle», no pintado por defecto. Retomable, porque el estado del proyecto ya dice en qué paso va. Y con salida al modo consola: quien tiene doce proyectos no quiere un asistente para cambiar una credencial.

### «Automático» significa que lo hace y lo propone

Y esto es lo único que no se puede relajar al simplificar.

El bootstrap se dispara solo y deja **una** propuesta completa lista para aprobar, en vez de veinte decisiones. La flota se sugiere desde lo que el snapshot ya sabe del proyecto. **Lo que desaparece es el trabajo, no la puerta humana**: nada se escribe en el repositorio del operador sin decisión explícita, y el diff exacto se enseña antes de tocar nada (FR-026).

Un asistente que escribe solo destruye la propiedad que hace adoptable a este producto. Por eso dos cosas salen siempre del «aprobar todo» y se presentan solas: lo que **declara conflicto con la constitution** —es justo lo que existe para ser mirado (FR-028)— y lo que **pisa un archivo que ya existe**. El criterio no es el número de cambios: crear un archivo se deshace borrándolo, pisar uno que el operador escribió, no.

### La sugerencia dice de dónde sale

Todo campo propuesto declara su origen con el **mismo vocabulario que el scanner** —`detectado` con su evidencia, `inferido` con su confianza, `por_defecto`, `vacio`— porque el operador ya lo aprendió en el snapshot, y enseñarle un segundo para la flota sería densidad gratuita.

Es el principio X aplicado a las propuestas: quien no sabe por qué se le sugiere algo no puede juzgarlo, y **acaba aceptando todo** — que es lo mismo que no haberle sugerido nada.

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Adoptar un proyecto que ya existe (Priority: P1)

El operador abre noxloop, señala una carpeta local o un repositorio remoto, y la herramienta le devuelve una lectura técnica del proyecto sin haber modificado un solo archivo: qué stack usa, qué arquitectura tiene, cómo prueba, qué CI corre, qué guidelines y configuración de agentes ya existen.

**Why this priority**: Es la puerta de entrada al producto y la única que se puede probar contra proyectos reales desde el primer día. Sin snapshot no hay contexto, y sin contexto todo lo demás es una plantilla vacía. Además, es el punto donde el producto demuestra valor antes de pedir una sola credencial.

**Independent Test**: Apuntar la app a este mismo repositorio y verificar que el snapshot identifica Node 20, módulos ES, `node --test`, el workflow de CI, la constitution en `.specify/memory/`, el plugin de Claude Code y los cuatro proveedores — todo sin que `git status` cambie.

**Acceptance Scenarios**:

1. **Given** una carpeta local con un repositorio git, **When** el operador la selecciona, **Then** la app produce un Project Snapshot con stack, arquitectura, testing, CI/CD, dependencias y setup de agentes detectado, y el árbol de trabajo queda idéntico (`git status --porcelain` vacío).
2. **Given** un repositorio remoto y una credencial de SCM con grant, **When** el operador lo indica, **Then** la app lo clona a un área de trabajo propia y produce el mismo snapshot.
3. **Given** un snapshot producido, **When** el operador revisa un hallazgo que considera erróneo, **Then** puede corregirlo o descartarlo, porque el snapshot es una propuesta de lectura y no una verdad impuesta.
4. **Given** una carpeta que no es un repositorio git, **When** el operador la selecciona, **Then** la app lo dice con causa textual y ofrece inicializar el repositorio o elegir otra carpeta — no falla en silencio ni asume un default.
5. **Given** un proyecto de 50.000 archivos, **When** corre el scanner, **Then** muestra progreso incremental y se puede cancelar sin dejar estado a medias.

---

### User Story 2 — Arrancar un proyecto nuevo (Priority: P1)

El operador no tiene código todavía. Declara identidad, stack, arquitectura y repositorio; la herramienta parte de una plantilla que él elige y deja el workspace inicializado y listo para las etapas siguientes.

**Why this priority**: Es la otra mitad de la etapa 00 y comparte todo lo que viene después. Sin ella, la herramienta solo sirve para proyectos que ya sufrieron su arranque en otro lado.

**Independent Test**: Crear un proyecto nuevo con plantilla Node+TypeScript, verificar que el workspace queda en estado `CREATED` con repositorio inicializado, y que la etapa 01 se puede omitir porque no hay código que escanear.

**Acceptance Scenarios**:

1. **Given** el operador elige "proyecto nuevo", **When** completa identidad, stack, arquitectura y destino del repositorio, **Then** el workspace queda inicializado en estado `CREATED` y la app indica cuál es la siguiente etapa.
2. **Given** un proyecto nuevo sin código, **When** llega la etapa de discovery, **Then** la app la omite explícitamente y el bootstrap parte de la plantilla elegida, no de un análisis inventado.
3. **Given** el destino del repositorio ya existe y no está vacío, **When** el operador confirma, **Then** la app se niega a escribir encima y ofrece adoptarlo como proyecto existente.

---

### User Story 3 — Fijar cómo se gobierna el proyecto (Priority: P2)

El operador define la constitution del proyecto —arquitectura, metodología, convenciones de git, política de testing, de seguridad, de agentes, de revisión y de despliegue, y el nivel de autonomía habilitado— y las guidelines que el runtime aplicará al producir cambios.

**Why this priority**: Es lo que el runtime consulta cuando una decisión es ambigua, y lo que convierte el snapshot en reglas ejecutables. Va después de P1 porque necesita el snapshot como borrador de partida: proponer una constitution sin haber leído el proyecto produce un documento genérico que nadie respeta.

**Independent Test**: Sobre un snapshot existente, generar una constitution propuesta, editarla, guardarla, y verificar que queda versionada junto al código y que un cambio posterior produce una enmienda con fecha y motivo, no una sobreescritura silenciosa.

**Acceptance Scenarios**:

1. **Given** un Project Snapshot, **When** el operador entra a la etapa de constitution, **Then** la app propone un borrador derivado de lo que detectó y marca cada apartado como *detectado*, *inferido* o *vacío*.
2. **Given** una constitution propuesta, **When** el operador la edita y guarda, **Then** se escribe versionada en el repositorio y el proyecto pasa a estado `CONSTITUTED`.
3. **Given** una constitution vigente, **When** se modifica un principio, **Then** queda registrada una enmienda con fecha, motivo y versión anterior recuperable.
4. **Given** guidelines por área (frontend, backend, testing, git, seguridad, agentes), **When** el operador las guarda, **Then** quedan versionadas junto al código y son legibles por el runtime.
5. **Given** un proyecto sin superficie visual, **When** llega la etapa de diseño, **Then** se omite sin penalización y sin bloquear el avance.

---

### User Story 4 — Que la herramienta proponga el setup, y el operador decida (Priority: P2)

La app detecta qué hay ya configurado en el proyecto y propone hooks, skills, servidores MCP, tools, subagentes y validaciones acordes al stack. Cada recomendación tiene tres salidas: aplicar, personalizar u omitir. Nada se escribe sin esa decisión.

**Why this priority**: Es donde el producto deja de ser un formulario y empieza a ahorrar trabajo. Depende de la constitution porque una recomendación que contradice una regla del proyecto es ruido.

**Independent Test**: Correr el bootstrap sobre este repositorio y verificar que detecta el plugin de Claude Code, los hooks y las skills de speckit **ya presentes** y no los vuelve a proponer; que las recomendaciones nuevas se pueden aplicar una por una; y que ninguna escritura ocurre antes de la aprobación.

**Acceptance Scenarios**:

1. **Given** un proyecto con hooks y skills ya configurados, **When** corre el bootstrap, **Then** los detecta y no los propone de nuevo.
2. **Given** una recomendación propuesta, **When** el operador elige *aplicar*, **Then** la app muestra exactamente qué archivos va a crear o modificar, con su contenido, **antes** de escribir.
3. **Given** una recomendación propuesta, **When** el operador elige *omitir*, **Then** queda registrado que se omitió, para alimentar la evolución continua.
4. **Given** el bootstrap terminado, **When** el operador revisa el resultado, **Then** el proyecto pasa a `BOOTSTRAPPED` y existe un registro de qué se aceptó y qué no.
5. **Given** una recomendación que contradice la constitution del proyecto, **When** el motor de recomendaciones la evalúa, **Then** no se propone, o se propone marcada con el conflicto explícito.

---

### User Story 5 — Conectar el proyecto con su ecosistema, con las credenciales bajo control (Priority: P2)

El operador conecta el tracker, el SCM y las integraciones externas mediante un flujo de autorización, y cada credencial queda inventariada: nombre, proveedor, alcance, proyecto, creación, expiración y huella. El valor nunca se guarda en claro. Ningún agente usa una credencial sin un grant explícito.

**Why this priority**: Es el diferencial competitivo más claro del producto y el dolor operativo más citado. Está en P2 y no en P3 porque es la única parte del sistema donde un error no se arregla con un parche: un secreto filtrado no se recupera.

**Independent Test**: Conectar un tracker, verificar que la credencial aparece en el inventario sin su valor, que la vista inversa responde "qué agentes y proyectos alcanzan esta credencial hoy", y que una tarea que pide una credencial sin grant se bloquea y aparece en la bandeja en vez de fallar.

**Acceptance Scenarios**:

1. **Given** un proyecto en estado `BOOTSTRAPPED`, **When** el operador conecta un tracker mediante el flujo de autorización, **Then** la conexión queda registrada y la credencial entra al inventario con huella, sin el valor en claro.
2. **Given** una credencial inventariada, **When** el operador consulta la vista inversa, **Then** obtiene la lista exacta de agentes y proyectos que la alcanzan hoy.
3. **Given** un agente sin grant para una credencial, **When** una tarea la necesita, **Then** la tarea se bloquea con causa textual, aparece en la bandeja y **no** se ejecuta — denegar por defecto.
4. **Given** un grant concedido, **When** el runner ejecuta la tarea, **Then** la credencial se inyecta al entorno del subproceso y **nunca** al estado persistido, ni a logs, ni a transcripts, ni a la interfaz.
5. **Given** una credencial con expiración declarada, **When** se acerca la fecha configurada de aviso, **Then** la app avisa; **When** expira, **Then** produce un bloqueo con causa textual explícita, no un error del proveedor sin contexto.
6. **Given** una credencial rotada, **When** se actualiza su valor, **Then** cambia la huella y los grants se conservan.
7. **Given** un acceso SSH registrado, **When** se usa, **Then** la huella del host está fijada, solo se permiten comandos de lectura y diagnóstico por defecto, y la bitácora registra **cada comando** ejecutado en el canal remoto, no solo la apertura de la sesión.
8. **Given** cualquier acción sensible sobre credenciales o grants, **When** ocurre, **Then** queda en un registro append-only que no se puede editar ni borrar desde la app.

---

### User Story 6 — Declarar la flota de agentes del proyecto (Priority: P3)

El operador registra qué agentes existen para este proyecto: rol, runtime, modelo, skills, tools, servidores MCP, credenciales concedidas, permisos, presupuesto y contexto.

**Why this priority**: Es la última etapa del establecimiento y la que menos valor entrega por sí sola: sin ejecución no se nota. Pero es el prerequisito del handoff, y es donde se materializan los grants de P2.

**Independent Test**: Definir dos agentes con runtimes distintos —uno implementador, uno revisor— y verificar que el revisor no puede recibir el transcript del implementador y que cada uno solo alcanza las credenciales que su grant declara.

**Acceptance Scenarios**:

1. **Given** un proyecto conectado, **When** el operador define un agente, **Then** quedan registrados rol, runtime, modelo, skills, tools, MCPs, permisos, presupuesto y contexto.
2. **Given** dos runtimes disponibles, **When** el operador configura la revisión, **Then** la app exige que el revisor sea un runtime distinto del implementador y lo impide si no lo es.
3. **Given** un agente definido, **When** se le concede una credencial, **Then** el grant es la tripleta proyecto + agente + credencial, con vigencia opcional.
4. **Given** la flota configurada, **When** el operador termina, **Then** el proyecto pasa a `ACTIVE`.

---

### User Story 7 — Volver a una vista que solo muestra lo que requiere una persona (Priority: P3)

El operador vuelve después de horas. La pantalla de inicio le da un resumen de lo ocurrido en todos sus proyectos y, separada del resto, la bandeja de lo que requiere su atención: preguntas de agentes, autorizaciones de credencial, permisos de tool, gates en rojo, conflictos, hallazgos de revisión y decisiones de merge.

**Why this priority**: Es el objetivo de experiencia del producto —dirigido por excepción— pero solo tiene contenido real cuando hay ejecución. Con el establecimiento recién construido, la bandeja se alimenta sobre todo de autorizaciones de credencial, que es lo que P2 genera.

**Independent Test**: Con dos proyectos y una autorización de credencial pendiente, verificar que la vista de inicio muestra los indicadores agregados y que el único elemento accionable es la bandeja.

**Acceptance Scenarios**:

1. **Given** varios proyectos, **When** el operador abre la app, **Then** ve indicadores agregados (tareas completadas, HUs completadas, PRs esperando decisión, fallos críticos, entradas que requieren atención) y la bandeja separada del resto.
2. **Given** una entrada en la bandeja, **When** el operador la abre, **Then** ve la causa textual completa y el contexto, no un resumen generado.
3. **Given** la bandeja vacía, **When** el operador abre la app, **Then** la vista lo dice explícitamente — el estado normal del sistema es la bandeja vacía.
4. **Given** doce proyectos activos, **When** el operador abre la app, **Then** la vista de inicio **no** es una grilla de tarjetas por proyecto.

---

### User Story 8 — Entregarle el proyecto establecido al motor (Priority: P3)

Con el proyecto en `ACTIVE`, el operador lanza un ciclo de trabajo desde la app. El motor de ejecución existente recibe el contexto compilado del proyecto —constitution, guidelines, diseño y work item— y hace lo que ya sabe hacer: plan, DAG, worktrees, gates, PR.

**Why this priority**: Cierra el lazo y demuestra que el establecimiento sirve para algo. Va al final porque depende de las siete anteriores y porque la ejecución en sí no es alcance de esta feature.

**Independent Test**: Sobre un proyecto `ACTIVE` con el proveedor `fake`, lanzar un ciclo desde la app y verificar que el motor arranca con el contexto del proyecto y que la app refleja su estado sin escribirlo.

**Acceptance Scenarios**:

1. **Given** un proyecto `ACTIVE`, **When** el operador lanza un ciclo, **Then** el motor recibe el contexto compilado del proyecto y el run arranca.
2. **Given** un run en curso, **When** el operador lo observa desde la app, **Then** la app **lee** el estado y no lo escribe — el motor sigue siendo el único escritor.
3. **Given** un proyecto que no alcanzó `ACTIVE`, **When** el operador intenta lanzar un ciclo, **Then** la app lo impide y nombra exactamente qué etapa falta.

---

### Edge Cases

- **La app se cierra a mitad del establecimiento.** Al reabrir, el proyecto retoma en la etapa donde quedó, con lo ya decidido intacto. Ninguna etapa deja estado a medias.
- **Dos ventanas de la app abiertas sobre el mismo proyecto.** La segunda no corrompe lo que escribe la primera: hay un único escritor y las demás vistas leen.
- **El daemon no está corriendo (modo web) o murió (modo escritorio).** La app lo dice con causa textual y ofrece la acción concreta; no muestra una pantalla en blanco ni datos rancios como si fueran frescos.
- **El proveedor de integraciones no está disponible.** Las conexiones existentes siguen funcionando con los tokens ya emitidos hasta su expiración; las nuevas fallan con causa textual.
- **El operador revoca una credencial mientras un agente la está usando.** El proceso en curso termina o se corta según política, y el evento queda auditado.
- **El scanner encuentra un secreto en claro en el repositorio.** Se reporta como hallazgo del snapshot y **no** se copia al snapshot, ni a logs, ni a la interfaz.
- **Un repositorio sin tests, sin CI y sin guidelines.** El snapshot lo declara vacío en esos apartados en vez de inventar un contenido plausible.
- **Conflicto entre lo detectado y lo declarado por el operador.** Gana lo declarado, y queda registrado que contradice la detección.
- **El proyecto vive en una ruta con espacios, acentos o enlaces simbólicos.** Funciona, o falla con causa textual — no a medias.

---

## Requirements _(mandatory)_

### Funcionales · Superficie y ejecución

- **FR-001**: El sistema DEBE ofrecer la misma funcionalidad como aplicación de escritorio y como aplicación web, construidas desde un único código de interfaz.
- **FR-002**: La interfaz NO DEBE escribir el estado del proyecto directamente: toda mutación pasa por el servicio que es único escritor, preservando el invariante de la constitution vigente.
- **FR-003**: El sistema DEBE funcionar sin conexión a internet para todo lo que no requiera un servicio externo (escanear, editar constitution y guidelines, revisar recomendaciones).
- **FR-004**: En escritorio, el sistema DEBE arrancar su propio servicio local sin que el operador lo lance a mano, y detenerlo al cerrar la aplicación.
- **FR-005**: El sistema DEBE indicar en todo momento si está mostrando datos frescos o si perdió la conexión con el servicio.

### Funcionales · Etapas 00–01

- **FR-010**: El sistema DEBE permitir crear un proyecto nuevo o adoptar uno existente desde carpeta local o repositorio remoto.
- **FR-011**: El scanner NO DEBE modificar ningún archivo del proyecto analizado, y esto DEBE ser verificable automáticamente.
- **FR-012**: El snapshot DEBE cubrir arquitectura, stack, patrones, testing, CI/CD, dependencias, guidelines existentes y configuración de agentes, MCP, skills y hooks ya presentes.
- **FR-013**: Cada hallazgo del snapshot DEBE indicar su origen —detectado en un archivo concreto, o inferido— y el archivo que lo respalda.
- **FR-014**: El operador DEBE poder corregir o descartar cualquier hallazgo del snapshot.
- **FR-015**: El scanner DEBE reportar progreso y ser cancelable sin dejar estado parcial.

### Funcionales · Etapas 02–05

- **FR-020**: El sistema DEBE proponer una constitution derivada del snapshot y permitir editarla antes de fijarla.
- **FR-021**: La constitution y las guidelines DEBEN quedar versionadas junto al código del proyecto.
- **FR-022**: Un cambio a la constitution vigente DEBE producir una enmienda registrada con fecha, motivo y versión anterior recuperable.
- **FR-023**: La etapa de diseño DEBE ser omitible sin penalización ni bloqueo.
- **FR-024**: El bootstrap DEBE detectar el setup existente antes de proponer nada.
- **FR-025**: Cada recomendación DEBE ofrecer tres salidas: aplicar, personalizar u omitir.
- **FR-026**: Ninguna recomendación DEBE escribir en el proyecto sin aprobación explícita, y el sistema DEBE mostrar el diff exacto antes de escribir.
- **FR-027**: El sistema DEBE registrar qué recomendaciones se aceptaron y cuáles se omitieron.
- **FR-028**: Una recomendación que contradiga la constitution del proyecto NO DEBE proponerse sin declarar el conflicto.

### Funcionales · Etapas 06–07

- **FR-030**: El sistema DEBE conectar el proyecto con un tracker (Linear, Jira, Azure DevOps, GitHub Issues o la gestión interna), con el SCM y con integraciones externas.
- **FR-031**: La capa de integración DEBE estar detrás de una interfaz propia, de modo que sustituir el proveedor de integraciones no requiera cambios fuera de su adaptador.
- **FR-032**: Git y SCM DEBEN mantenerse separados conceptualmente de la capa de integración.
- **FR-033**: El sistema DEBE permitir registrar agentes con rol, runtime, modelo, skills, tools, MCPs, credenciales, permisos, presupuesto y contexto.
- **FR-034**: El sistema DEBE impedir configurar revisión donde el revisor comparta runtime con el implementador.
- **FR-035**: Los recursos compartidos entre proyectos DEBEN exponerse con alcance por proyecto y por agente.

### Funcionales · Credenciales y gobernanza

- **FR-040**: Cada credencial DEBE registrarse con nombre, proveedor, alcance declarado, ámbito (proyecto o global), fecha de creación, fecha de expiración y huella.
- **FR-041**: El valor de una credencial NUNCA DEBE almacenarse en claro; el almacenamiento se delega al backend de secretos del sistema operativo, con alternativa cifrada donde ese backend no exista.
- **FR-042**: El modelo de autorización DEBE ser la tripleta proyecto + agente + credencial, con vigencia opcional.
- **FR-043**: El sistema DEBE denegar por defecto: una tarea que necesita una credencial sin grant se bloquea y entra en la bandeja; NO DEBE fallar en silencio.
- **FR-044**: La credencial DEBE inyectarse al entorno del subproceso que la usa y NUNCA al estado persistido.
- **FR-045**: El sistema DEBE ofrecer la vista inversa: dada una credencial, qué agentes y proyectos la alcanzan hoy.
- **FR-046**: El sistema DEBE avisar antes de la expiración declarada, con antelación configurable, y producir un bloqueo con causa textual al expirar.
- **FR-047**: Al rotar una credencial, la huella DEBE actualizarse y los grants DEBEN conservarse.
- **FR-048**: Los accesos SSH DEBEN fijar la huella del host, permitir por defecto solo comandos de lectura y diagnóstico, exigir autorización explícita para escritura o despliegue, y registrar cada comando ejecutado en el canal remoto.
- **FR-049**: Toda acción sensible sobre credenciales, grants y capacidades DEBE quedar en un registro append-only, no editable ni borrable desde la aplicación.
- **FR-050**: Los transcripts, la evidencia y los logs DEBEN redactarse contra la bóveda **antes** de persistir, no después.
- **FR-051**: Las capacidades de alto impacto (merge autónomo, despliegue, base de datos de producción, comandos destructivos, cambios de infraestructura, acciones sobre cuentas externas) DEBEN estar desactivadas por defecto y requerir política explícita y auditada.
- **FR-052**: El contenido de terceros (comentarios de PR, respuestas de APIs externas, descripciones de tickets) NUNCA DEBE tratarse como instrucciones ejecutables.

### Funcionales · Bandeja y handoff

- **FR-060**: La vista de inicio DEBE mostrar indicadores agregados y la bandeja separada como único elemento accionable.
- **FR-061**: La vista de inicio NO DEBE ser una grilla de tarjetas por proyecto.
- **FR-062**: Cada entrada de la bandeja DEBE mostrar la causa textual completa, no un resumen generado.
- **FR-063**: El sistema DEBE permitir lanzar un ciclo de trabajo sobre un proyecto `ACTIVE`, entregando al motor el contexto compilado del proyecto.
- **FR-064**: El sistema DEBE impedir lanzar un ciclo sobre un proyecto que no alcanzó `ACTIVE`, nombrando qué etapa falta.

### No funcionales

- **NFR-001**: El snapshot de un repositorio de hasta 10.000 archivos DEBE completarse en menos de 60 segundos en un portátil de gama media.
- **NFR-002**: La vista de inicio DEBE responder en menos de 1 segundo con 20 proyectos registrados.
- **NFR-003**: El sistema DEBE tolerar el cierre abrupto sin corromper estado: toda escritura de estado es atómica.
- **NFR-004**: Ningún secreto DEBE aparecer en logs, estado, interfaz, evidencia ni mensajes de error, y DEBE existir una prueba automática que lo verifique.
- **NFR-005**: La interfaz DEBE ser operable con teclado y legible en tema claro y oscuro.
- **NFR-006**: Todo error mostrado al operador DEBE nombrar la causa concreta y la acción siguiente.

### Key Entities

- **Workspace**: contiene N proyectos. Guarda recursos compartidos (tools, skills, MCPs, modelos, credenciales globales) y el inventario de credenciales.
- **Project**: contexto aislado con identidad, ruta o remoto, estado del ciclo, constitution, guidelines, diseño, conexiones, flota y memoria propios.
- **ProjectSnapshot**: lectura técnica del proyecto producida por el scanner. Cada hallazgo lleva origen, evidencia y confianza. Es propuesta, no verdad.
- **Constitution**: invariantes del proyecto, versionada, con historial de enmiendas (fecha, motivo, versión anterior).
- **Guideline**: documentación con reglas aplicables por el runtime, por área.
- **Recommendation**: propuesta del bootstrap con tipo, justificación, diff exacto, y decisión (aplicada, personalizada, omitida).
- **Connection**: vínculo con un servicio externo, con proveedor, estado, alcance y credencial asociada.
- **Credential**: entrada del inventario: nombre, proveedor, alcance declarado, ámbito, creación, expiración, huella. Nunca el valor.
- **Grant**: autorización acotada — proyecto, agente, credencial, vigencia opcional.
- **Agent**: rol, runtime, modelo, skills, tools, MCPs, permisos, presupuesto, contexto.
- **InboxEntry**: entrada que requiere una persona, con tipo, origen, causa textual, contexto y decisiones posibles.
- **AuditEvent**: registro append-only de acción sensible, con actor, acción, objeto, resultado e instante.
- **ProjectState**: `CREATED → DISCOVERED → CONSTITUTED → BOOTSTRAPPED → CONNECTED → ACTIVE`.

---

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Un operador lleva un repositorio existente y real desde "abrir la app" hasta estado `ACTIVE` en menos de 15 minutos, sin editar un archivo a mano y sin leer documentación.
- **SC-002**: El scanner no modifica nada: en 100 de 100 ejecuciones sobre repositorios distintos, `git status --porcelain` queda vacío. Sin excepciones.
- **SC-003**: Cero secretos fuera de la bóveda: la prueba de no filtración pasa sobre estado, logs, interfaz, evidencia y mensajes de error, y corre en cada commit.
- **SC-004**: El 100% de las acciones sensibles sobre credenciales y grants aparece en el registro append-only.
- **SC-005**: Sobre este mismo repositorio, el bootstrap detecta al menos el 90% del setup ya existente (hooks, skills, plugin, CI, proveedores) y no lo vuelve a proponer.
- **SC-006**: Una tarea que pide una credencial sin grant se bloquea el 100% de las veces y aparece en la bandeja con causa textual; cero ejecuciones no autorizadas.
- **SC-007**: La app de escritorio arranca y muestra la vista de inicio en menos de 3 segundos en frío.
- **SC-008**: El mismo build de interfaz funciona en escritorio y en navegador sin bifurcaciones de producto — solo difiere el origen del servicio.
- **SC-009**: Un proyecto establecido en la app lanza un ciclo del motor que llega a PR abierto usando el proveedor `fake`, de punta a punta, sin intervención manual.
- **SC-010**: Los 650 tests existentes del motor siguen en verde durante toda la feature, en cada commit.

---

## Assumptions

Decisiones ya tomadas que esta spec da por cerradas (registradas el 2026-09-20):

1. **La feature crece en este monorepo.** El motor existente se conserva y se migra a tipado estático por paquetes, manteniendo sus tests en verde. No se reescribe.
2. **Una sola interfaz para las dos superficies**, empaquetada como aplicación de escritorio y desplegada como aplicación web.
3. **La interfaz no tiene servidor propio**: habla siempre contra un servicio local que expone la API y los eventos, y que es el único escritor del estado.
4. **Estado híbrido**: el estado del run sigue en archivos atómicos —lo que los hooks y los 650 tests ya asumen— y lo nuevo (inventario de credenciales, grants, auditoría, snapshots, memoria) va a un almacén consultable local.
5. **Dos runtimes de agente en el alcance**: el de referencia y un segundo, suficiente para validar que el adaptador aísla de verdad y para cumplir la regla de revisor distinto del implementador.
6. **La capa de integración se aloja localmente**, detrás de una interfaz propia que permite sustituirla. Entra como dependencia del núcleo, con su licencia Elastic 2.0 aceptada a sabiendas y declarada en `LICENSE` y `README` — no es OSI ni compatible con GPL/AGPL. Las aplicaciones OAuth son propias desde el primer día, que es lo único que garantiza poder exportar los tokens si algún día se sustituye.
7. **La bóveda primaria es el backend de secretos del sistema operativo**, con alternativa cifrada donde no exista (servidor headless, contenedor, CI).
8. **El producto sigue llamándose noxloop.** Esta feature es su versión 2.
9. **Un solo operador con varios proyectos.** Sin roles organizacionales.
10. **El idioma del proyecto sigue siendo el español** en documentación, mensajes al operador, nombres de tests y mensajes de commit.

## Dependencies

- El motor de ejecución existente (etapas 08–12) y su contrato de proveedores.
- La constitution vigente del repositorio: esta feature no puede violar ninguno de sus principios, y si necesita ampliarla, lo hace por enmienda escrita.
- Un servicio de integración alojado localmente para el flujo de autorización de las conexiones.
- Un backend de secretos del sistema operativo, con alternativa cifrada declarada.

## Out of Scope

Además de lo declarado al inicio: marketplace de plugins, constructor visual de workflows, multiusuario con roles organizacionales, merge y deploy autónomos, runners remotos y en la nube, memoria de proyecto (etapa 15), evolución continua (etapa 16), y competir en cantidad de adaptadores de runtime.
