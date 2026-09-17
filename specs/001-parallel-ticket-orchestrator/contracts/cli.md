# Contract — CLI

Una sola entrada, `noxloop`, con subcomandos. Toda salida de máquina es JSON en
stdout; los mensajes para personas van a stderr. Es lo que permite componerlo
con otras herramientas y lo que hace que los tests no dependan de parsear prosa.

| Comando | Qué hace | Salida |
|---|---|---|
| `noxloop doctor` | Qué está declarado, qué falta, qué credencial no está presente, y si cada repositorio declarado tiene un checkout local que **de verdad** es ese repositorio (compara el remote). | JSON con `ready: boolean` y el detalle. Exit ≠ 0 si `ready` es `false`. |
| `noxloop plan <item>` | Planifica y **para**. Es el único punto de aprobación humana. | El plan en JSON, y la lectura en prosa por stderr. |
| `noxloop run <item>` | Ejecuta el plan de un item: tareas en paralelo, integración por cola, un PR. | Resumen del recorrido. |
| `noxloop run <item> --dry-run` | Muestra cada paso que daría, sin ejecutar ninguno. | El recorrido simulado. |
| `noxloop milestone <item>` | Prepara el recorrido de un hito: rama, orden, exclusiones. Muestra y para. | El recorrido propuesto. |
| `noxloop milestone <item> --go` | Lanza el recorrido del hito. Acepta `--max-items`, `--max-cost`, `--only`, `--skip`. | Resumen final. |
| `noxloop status [<item>]` | El estado sin interpretación: tareas, estados, intentos, bloqueos, enlaces. | JSON. |
| `noxloop inbox` | Una pasada de la bandeja: qué tickets están asignados o mencionados. No ejecuta nada. | JSON. |
| `noxloop daemon` | Consulta la bandeja cada `interval` y despacha lo que aparece. Una sola instancia, por lock. | Bitácora en stream. |
| `noxloop resume <item>` | Retoma un recorrido interrumpido desde el disco. | Igual que `run`. |
| `noxloop unstick <item> --task <id> [--note "..."]` | Destraba una tarea bloqueada registrando la decisión. No implementa nada. | El nuevo estado. |

## Invariantes de la superficie

- **`run` nunca replanifica.** Si no hay plan, falla y dice que corra `plan`.
  Un recorrido que replanifica solo es un recorrido que puede cambiar el alcance
  sin que nadie lo apruebe.
- **`--dry-run` no escribe nada**: ni estado, ni worktrees, ni el gestor. Es
  verificable con un test que corre `--dry-run` sobre un `NOXLOOP_HOME` vacío y
  comprueba que sigue vacío.
- **Ningún subcomando mergea a una rama protegida ni despliega.** No hay
  bandera que lo habilite.
- **Todo subcomando que escribe toma el lock.** Dos procesos sobre el mismo item
  no se pisan: el segundo informa quién tiene el lock y termina con exit ≠ 0.
- **`status` es de solo lectura y no toca el gestor.** Tiene que poder correr con
  la red caída.
