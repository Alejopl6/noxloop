# Plan: El board de control

**Spec**: [spec.md](spec.md) · **Contrato**: [contracts/board-api.md](contracts/board-api.md) · **Fecha**: 2026-09-24

## El hueco que decide el plan

Ningún camino del producto lleva de un proyecto del Studio a una configuración
del motor. El test de punta a punta la arma a mano (`configDelMotor` en
`packages/service/test/punta-a-punta.test.mjs`) y `POST /v1/projects/:id/runs`
contesta `pieza_ausente`. Sin ese puente no hay botón Run ni board con datos de
verdad. Es la pieza central, y las demás cuelgan de ella.

## Tres frentes, en paralelo, con carpetas disjuntas

| Frente | Carpeta | Entrega |
|---|---|---|
| **A · Proveedores** | `providers/` | Capacidad `listItems` en el contrato; implementada en `fake`, `github`, `linear`, `azure-devops`, con respuestas grabadas y degradación declarada. |
| **B · Servicio** | `packages/service/`, `packages/engine/` (solo lo mínimo) | `motor.mjs`: config del motor desde el proyecto. Lanzador del motor como subproceso, con cola, aprobación de plan y retomar. `GET /v1/board`, `GET /v1/usage`, `GET /v1/runs`, eventos `run.cambio`. |
| **C · Interfaz** | `apps/studio/` | Navegación Board · Runs · Costos · Settings + proyectos + runs activos. Vista board con columnas, tarjetas, chips, filtros y resumen. Settings general (portal de tools: catálogo de conexiones, credenciales, flota, auditoría) y Settings de proyecto (las pantallas de 002 como pestañas). Crear proyecto → asistente. |

Los tres se encuentran solo en [el contrato](contracts/board-api.md). La
interfaz se construye contra el contrato con datos de catálogo y se cablea al
servicio real al final.

## Decisiones técnicas

- **Config del motor = derivada, no guardada.** Se compone en cada lanzamiento
  desde el almacén: `ruta_local` y `remoto` del proyecto, el proveedor del
  gestor desde la conexión `tracker` del proyecto (o la `scm` de GitHub cuando
  el gestor es GitHub Issues), `owner/repo` desde el remoto, y el gate desde el
  hallazgo de comando de test del snapshot. Se escribe a un archivo temporal
  bajo `<home>/motor/<proyecto>.config.json` (principio III: fuera del repo).
  Sin gate detectado, el proyecto declara `gate` ausente y Run se deshabilita
  con el motivo.
- **El motor corre como subproceso de `node packages/engine/bin/noxloop.mjs`**,
  con `NOXLOOP_HOME` del servicio y el entorno exacto que declara la bóveda
  (principio IX: nada por `argv`). El `projectId` viaja como opción del plan
  (`--project <id>`), que termina en `createRun`.
- **Autonomía**: L2 → `plan` y `run` encadenados; L0/L1 → solo `plan`, y
  `POST /v1/runs/:itemId/approve` lanza `run`.
- **Cola**: por proyecto, con el tope `limits.maxParallelItems`; en memoria del
  servicio (los runs no sobreviven a la aplicación, supuesto de la spec).
- **Board = read-model puro** en `packages/service/src/board.mjs`, sobre
  `listItems` del proveedor (con caché de 30 s por proyecto) más los runs en
  disco. No escribe (SC-007, mismo test de huella que el tablero de 001).

## Constitution Check

| Principio | Cómo se cumple |
|---|---|
| III estado en disco | Runs y config del motor en `NOXLOOP_HOME`; la cola es memoria efímera y un run interrumpido se retoma del disco. |
| IV autonomía hasta el PR | El board no mergea ni mueve tickets; el motor sigue con sus hooks. |
| VI gestor detalle | `listItems` es una capacidad; sin ella, degradación visible. |
| VIII interfaz lee | Lanzar, aprobar y reintentar son peticiones al servicio. |
| IX secretos | Credenciales al subproceso por entorno declarado, nunca `argv`. |

## Orden de integración

1. A y B en paralelo (B usa `fake` hasta que A termine).
2. C en paralelo contra el contrato.
3. Cableado real: C contra B, B contra A. Test de punta a punta: proyecto
   `ACTIVE` con `fake` → Run en el board → tarjeta en En revisión (SC-005).
4. Escritorio: `tauri dev` con el board como pantalla de inicio.
