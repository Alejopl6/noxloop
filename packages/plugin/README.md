# El plugin de noxloop

Comandos, agentes, skills y hooks para operar noxloop desde Claude Code.

```
/plugin marketplace add Alejopl6/noxloop
/plugin install noxloop
```

## Comandos

| Comando | Para qué |
|---|---|
| `/noxloop-plan <item>` | Convierte un ticket en un DAG de tareas y **para**. Único punto de aprobación humana. |
| `/noxloop-run <item>` | Lanza el recorrido: tareas en paralelo, un pull request. |
| `/noxloop-status [<item>]` | En qué quedó, sin interpretación. Funciona con la red caída. |
| `/noxloop-task` | Una fase de una tarea. **Lo invoca el motor**; no se usa a mano. |

## Los hooks

Se instalan con el plugin y son lo que hace que las reglas no dependan de que el
modelo se acuerde:

- **`tdd-order-guard`** bloquea escribir producción sin rojo verificado.
- **`task-scope-guard`** bloquea un archivo que la tarea no declaró.
- **`no-prod-writes`** bloquea merge a rama protegida, deploy y force push.
- **`state-checkpoint`** avisa si el turno termina con trabajo sin registrar.

Los tres primeros **permiten todo** cuando no hay una tarea activa: si noxloop no
está corriendo, la sesión es de una persona y no les corresponde decidir.
