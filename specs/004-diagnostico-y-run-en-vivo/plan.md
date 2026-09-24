# Plan: Diagnóstico, run en vivo y release

**Spec**: [spec.md](spec.md) · **Fecha**: 2026-09-24

| Frente | Carpetas | Entrega |
|---|---|---|
| **A · Diagnóstico** | `packages/service/src/diagnostico.mjs` (nuevo), `board.mjs` (motivo de Run), `apps/studio` (Settings → Diagnóstico, chip en tarjeta) | FR-001..003 |
| **B · Run en vivo** | `packages/engine` (transcript por fase, redactado), `packages/adapters` (eventos del runtime), `packages/service` (ruta + evento), `apps/studio/components/runs/*` | FR-004..006 |
| **C · Escritorio y release** | `apps/desktop` (abrir en editor, badge del Dock, build universal), `.github/workflows/release.yml`, `README.md`, `apps/studio` (botón del diff y hook del badge) | FR-007..009 |

Contratos compartidos: `lib/tipos.ts` y `lib/daemon.ts` de la interfaz los tocan los tres; cada frente agrega su sección al final y relee antes de editar. `errores.mjs` y `tabla.mjs` del servicio, igual.

Constitution Check: III (transcripts en el home), VIII (la interfaz pide, la cáscara o el servicio ejecutan), IX (transcript redactado, centinela), X (confianza `desconocida` en vez de inventada).
