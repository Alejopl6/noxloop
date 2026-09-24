# Plan: Linear completo, orden a mano y hand-offs

| Frente | Carpetas | Entrega |
|---|---|---|
| **A · Linear** | `providers/linear`, `packages/service/src/{gestor,board}.mjs`, `packages/engine` (comentario de cierre), `apps/studio` (Settings → Gestor, editor de estados) | FR-001..004 |
| **B · Orden y cola** | `packages/store` (orden), `packages/service/src/{lanzador,orden}.mjs`, `apps/studio` (board y Runs) | FR-005..006 |
| **C · Hand-offs y huecos** | `packages/engine` (retomar con otro implementador), `packages/service/src/{runs,ejecutor,flota,diagnostico}.mjs`, `apps/studio` (acción en la tarjeta y en el detalle, flota) | FR-007..008 |

Compartidos: `tabla.mjs`, `errores.mjs`, `lib/tipos.ts`, `lib/daemon.ts` — cada frente agrega su sección, relee antes de editar, ediciones mínimas.
