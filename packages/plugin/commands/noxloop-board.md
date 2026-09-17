---
description: "El tablero 360 en el navegador: qué hay, qué corre, qué te necesita. Solo lectura."
argument-hint: "[--port N] [--home <ruta>] [--open]"
---

# /noxloop-board

```bash
noxloop board [--port N] [--home <ruta>] [--open]
```

Levanta en `127.0.0.1:7777` un tablero que muestra **todo lo que hay** en cinco
columnas —por empezar, en curso, con PR abierto, integrado, bloqueado— y arriba,
separado del resto, **lo que necesita que una persona conteste**.

Tres cosas que conviene saber antes de correrlo:

- **No escribe nada.** Lee `$NOXLOOP_HOME` y punto. Se puede abrir con un
  recorrido corriendo sin tocarlo: `state.mjs` sigue siendo el único escritor
  del estado, y un tablero con permiso de escritura sería el segundo.
- **Es el único comando que no necesita configuración.** Con `--home <ruta>`
  mira un directorio de estado y listo. Es a propósito: el escenario para el que
  existe incluye "el gestor está caído" y "estoy en otra máquina sin los
  checkouts".
- **Escucha solo en loopback.** Lo que muestra son títulos de tickets, texto de
  fallos de gate y rutas de worktrees.

Se queda corriendo hasta que lo interrumpan. Si la persona quiere el dato en vez
de la pantalla, `noxloop status --json` da lo mismo sin servidor.

Lo que el tablero dice y el `status` de un solo recorrido no puede decir:

- **la fila de arriba** junta tres orígenes distintos de "te necesitan": un item
  del hito esperando respuesta, un rechazo **permanente** de la bandeja, y un
  recorrido que agotó todo sin integrar nada. Los tres piden una persona; los
  transitorios no aparecen porque el motor los reintenta solo.
- **los avisos**: un lock viejo, un puntero de tarea activa huérfano, un archivo
  de estado corrupto. Nada de eso sale en el estado de un recorrido.
- **el avance** se mide sobre tareas **integradas**. Una tarea `reviewed` no
  cuenta como hecha.
