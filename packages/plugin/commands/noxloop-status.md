---
description: "El estado de un recorrido: tareas, intentos, bloqueos y enlaces. Sin interpretación."
argument-hint: "[<item>]"
---

# /noxloop-status

```bash
noxloop status [<item>]
```

Solo lectura, y **no toca el gestor de tickets**: tiene que poder correr con la
red caída, que es justo cuando más falta saber en qué quedó un recorrido.

Presentá lo que devuelve tal cual, sin interpretarlo. Lo que conviene mirar, en
este orden:

- **el estado de cada tarea** y, si alguna está bloqueada, su `lastFailure`
  **textual**. No lo resumas: "falla el build" no es accionable, el mensaje y el
  archivo sí.
- **`redVerified`**: si está en `false` y la tarea está en vuelo, el rojo todavía
  no se vio.
- **los intentos** por bucle. Un `green: 3` dice dónde costó.
- **`gate`**: el exit code y cuándo corrió. Sin ese objeto no hubo veredicto.
- **`addedTargets`**: qué alcance se amplió y con qué motivo.
- **el lock**: si lo tiene un proceso vivo, hay un recorrido corriendo ahora.

Si una tarea está `in_progress` con su worktree sucio, decilo: hay que decidir
antes de seguir — o se completa, o se registra por qué quedó a medias, o se
bloquea con la causa.
