# Referente: Nodal (Mazp17/nodal-agentos, MIT)

Leído el 2026-09-24: README, `src/domain/types.ts` y la estructura del repo.
Se toman ideas y patrones; no se copia código (stack distinto: Tauri+Rust+React
allá, servicio Node + Next estático acá). Si alguna vez se toma código, va con
su atribución MIT.

## Qué se adopta

| Idea | Cómo aterriza en noxloop |
|---|---|
| Tareas propias con "New task": plan markdown, criterios, prioridad, etiquetas, clave `PAY-1` | Proveedor **`local`** (principio VI: un gestor más). El servicio es su único escritor (principio VIII). El motor lo consume por el contrato de siempre. |
| Ejecutor por tarea: agente (`~/.claude/agents`, repo, plugin), workflow o Claude a secas; cascada tarea → repo → proyecto → default | `Executor` en la tarea local y en la flota, **agnóstico**: runtime (`claude-agent-sdk`, `codex`) + agente opcional. |
| Cómo termina: `changes` / `commit` / `pr` | Opción por tarea. El límite sigue en el PR abierto (principio IV); nunca merge. |
| Columnas Todo · In Progress · In Review · Blocked · Done | Reemplaza las 4 de la primera versión de la spec. Backlog queda plegable a la izquierda. |
| Run en vivo: fases, subagentes, transcript, tokens, diff | Detalle de run: el diff ya está en el contrato; se suman transcript por fase y tokens. |
| Revisión automática contra criterios → In Review o Blocked con hallazgos | Ya existe (fase REVIEW); se expone el veredicto en la tarjeta. |

## Qué se deja para después

- Vista **Actividad** (todas las sesiones de Claude en disco, lanzadas o no por la app): lee un formato interno sin documentar de Claude Code; frágil y no agnóstico.
- Proyecto con **varios repos**: el motor ya soporta varios repos por config; la UI lo suma después.

## Qué NO se adopta, y por qué

- Leer el progreso de `claude agents --json` y de `~/.claude/projects`: acopla el producto a un runtime y a un formato sin documentar. noxloop lee su propio estado en disco (principio III), igual para Claude y para Codex.
- Tareas que terminan sin test: acá el test primero lo fuerza un hook (principio I). Es la diferencia de fondo entre los dos productos.
