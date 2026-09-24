# Feature Specification: Diagnóstico, run en vivo y release

**Feature Branch**: `004-diagnostico-y-run-en-vivo`

**Created**: 2026-09-24

**Status**: Draft

**Input**: Lectura del release Nodal 0.1.0 (Mazp17/nodal-agentos, MIT) del 2026-09-24 y decisión del operador: montar el bloque P1 —diagnóstico por repo, run en vivo, abrir en el editor, badge del Dock y release de verdad—. El bloque P2 (Linear completo, board y cola reordenables, hand-offs) queda escrito aquí como fase siguiente.

---

## Qué es esto y qué no es

La spec 003 dejó el board lanzando el motor. Lo que falta para usarlo a diario es **saber por qué un run no arranca antes de que falle**, **ver qué está haciendo el agente mientras trabaja**, y **tener la aplicación instalable como un producto**.

**Queda fuera, a propósito:**

| Excluido | Motivo |
|---|---|
| Escribir la confianza de Claude Code en `~/.claude.json` | Es configuración de otra herramienta. Se lee y se dice cómo aceptarla; no se escribe por el operador. |
| Vista de actividad de sesiones que la app no lanzó | Lee un formato interno sin documentar de un solo runtime; choca con que el producto es agnóstico. |
| Notarización de Apple | Requiere una cuenta de desarrollador de pago; se documenta el paso de cuarentena. |

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Saber por qué un run no va a arrancar, antes de pulsar Run (Priority: P1)

El operador abre Settings → Diagnóstico y ve, para la máquina, las versiones de `git`, `claude`, `codex` y `node`, y para cada proyecto: si su carpeta es un repositorio, si Claude Code confía en él, si el gate se puede correr y si el runtime de cada rol está conectado. Cada problema trae la acción exacta. La tarjeta de un proyecto con un problema bloqueante muestra Run deshabilitado con ese motivo.

**Why this priority**: un run que no puede arrancar —sin git, sin gate, sin modelo— tiene que decirlo antes de pulsar Run, no después.

> **Corregido el 2026-09-24 con el binario delante.** La primera versión decía que un repo sin la confianza de Claude Code aceptada hacía fallar o colgarse el run. En `claude` 2.1.281 no es así: con `-p`, como el motor lanza cada fase, se da por confiado. Lo que sí pasa es que **ignora la configuración propia del repo** (`.claude/settings.json`, sus hooks y sus MCP). Los hooks de noxloop llegan por `--settings` y siguen. Por eso la confianza pendiente es un **aviso**, no un bloqueo.

**Independent Test**: con git ausente, Run sale deshabilitado en todas las tarjetas con cómo instalarlo; con un repo cuya confianza no está aceptada, el diagnóstico lo avisa con la acción «abre `claude` en esa carpeta una vez y acepta», sin deshabilitar Run.

**Acceptance Scenarios**:

1. **Given** `claude` instalado y un repo sin la confianza aceptada, **When** se abre el diagnóstico, **Then** el repo figura «confianza pendiente» como aviso, con lo que se pierde (la configuración propia del repo) y la acción textual; Run sigue habilitado.
2. **Given** un binario ausente (`codex`, `git`), **When** se abre el diagnóstico, **Then** figura ausente con cómo instalarlo, y solo se deshabilita lo que lo necesita.
3. **Given** el diagnóstico, **When** se consulta, **Then** no escribe nada: ni en `~/.claude.json`, ni en el repo, ni en el home.

---

### User Story 2 - Ver el run en vivo: transcript, fases, tokens (Priority: P1)

Desde «Abrir run», el operador ve por tarea y por fase lo que el agente fue diciendo y haciendo —mensajes, herramientas que usó, resultado— renderizado en markdown, con los tokens de cada fase y el total; mientras el run corre, se actualiza solo.

**Why this priority**: hoy se ve el diff y el gasto, pero no el razonamiento visible ni las herramientas: cuando una tarea se bloquea, no se sabe qué intentó.

**Independent Test**: un run con el adaptador falso produce un transcript por fase; el detalle lo muestra, con tokens por fase, y un evento nuevo del run aparece sin recargar.

**Acceptance Scenarios**:

1. **Given** un run en curso, **When** el operador abre una tarea, **Then** ve cada fase (RED, GREEN, REVIEW…) con su transcript en orden y sus tokens.
2. **Given** un transcript con un secreto de la bóveda, **When** se guarda o se muestra, **Then** sale redactado (principio IX): el transcript en disco nunca contiene el valor.
3. **Given** un runtime que no reporta tokens, **When** se muestra, **Then** dice «sin medir», no cero.

---

### User Story 3 - Abrir el cambio en mi editor, y saber qué me espera sin abrir la app (Priority: P2)

En el diff de una tarea, «Abrir en el editor» abre el archivo (y la línea) en el editor instalado del operador (VS Code, Cursor, Zed, o el que tenga). En el Dock, la aplicación muestra un número con lo que necesita al operador.

**Acceptance Scenarios**:

1. **Given** un editor soportado instalado, **When** se pulsa «Abrir en el editor» en un archivo del diff, **Then** se abre ese archivo del worktree de la tarea en esa línea.
2. **Given** dos runs esperando al operador, **When** la app está en segundo plano, **Then** el Dock muestra «2»; al resolverlos, el número baja.

---

### User Story 4 - Instalar noxloop como un producto (Priority: P2)

Con un tag `v*`, el CI publica un release con un `.dmg` universal (Apple Silicon e Intel), su `.sha256` y las instrucciones de instalación, incluido el paso de cuarentena por no estar notarizado.

**Acceptance Scenarios**:

1. **Given** un tag `v0.1.0`, **When** corre el workflow de release, **Then** el release tiene el `.dmg` universal y su `.sha256`, y el `.app` arranca en las dos arquitecturas.
2. **Given** el README, **When** alguien lo lee, **Then** sabe descargar, verificar el checksum y quitar la cuarentena.

---

### Fase siguiente (P2 del análisis, no en esta entrega)

- Linear completo: importar con reglas de ruteo por proyecto o etiqueta, editor visual del mapeo de estados, detección de issues movidas.
- Board y cola global reordenables a mano.
- Hand-offs: pasar una tarea de un ejecutor a otro sobre la misma rama.

### Edge Cases

- `~/.claude.json` ausente, ilegible o con otra forma: la confianza se declara «desconocida» con la causa, no «pendiente» ni «aceptada».
- Transcript muy largo: se pagina; lo cortado se dice.
- Ningún editor detectado: el botón no se pinta y se dice por qué en el diagnóstico.
- Badge en una plataforma sin Dock: no hace nada y no falla.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: `GET /v1/diagnostics` MUST reportar versiones de `git`, `claude`, `codex` y `node`, y por proyecto: repositorio válido, confianza de Claude Code (`aceptada|pendiente|desconocida` con evidencia), gate declarado y runtimes por rol conectados. Cada problema con causa y acción.
- **FR-002**: El diagnóstico MUST ser de solo lectura: no escribe en `~/.claude.json`, en el repo ni en el home. Un test mide que no escribe.
- **FR-003**: Un problema bloqueante del diagnóstico MUST deshabilitar Run en las tarjetas afectadas con su motivo.
- **FR-004**: El motor MUST guardar, por tarea y fase, el transcript del runtime (mensajes, herramientas, resultado) y los tokens, redactados, bajo el home (principio III).
- **FR-005**: `GET /v1/runs/:itemId/tasks/:taskId/transcript` MUST devolverlo por fases, paginado; el servicio MUST emitir un evento cuando crece.
- **FR-006**: La interfaz MUST renderizar el transcript en markdown sin inyectar HTML, y los tokens por fase, con «sin medir» distinto de cero.
- **FR-007**: El escritorio MUST poder abrir un archivo del worktree, en una línea, en el editor instalado detectado; la interfaz no ejecuta nada por su cuenta (lo hace la cáscara).
- **FR-008**: El escritorio MUST mostrar en el Dock el número de entradas que necesitan al operador.
- **FR-009**: Un tag `v*` MUST publicar un release con el `.dmg` universal y su `.sha256`; el README MUST documentar la instalación.

## Success Criteria _(mandatory)_

- **SC-001**: Todo lo que impide un run (git ausente, carpeta que no es repo, sin gate, modelo sin conectar) se ve en el diagnóstico y en la tarjeta antes de pulsar Run, en el 100% de los casos.
- **SC-002**: Desde que el agente emite un mensaje hasta que se ve en el detalle pasan menos de 3 segundos.
- **SC-003**: Ningún transcript en disco contiene un secreto de la bóveda (test centinela).
- **SC-004**: El `.dmg` publicado arranca en Apple Silicon e Intel.
- **SC-005**: Todos los tests existentes siguen en verde.

## Assumptions

- La confianza de Claude Code se lee de `~/.claude.json` → `projects[<ruta>].hasTrustDialogAccepted` (forma observada en esta máquina el 2026-09-24; es un formato interno, por eso existe el estado «desconocida»).
- Editores soportados de entrada: VS Code, Cursor, Zed, Sublime y el que declare `$VISUAL`/`$EDITOR` si es gráfico.
- El release no se notariza; se documenta `xattr -dr com.apple.quarantine`.
