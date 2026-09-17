# Contribuir a noxloop

## El flujo: spec-kit

Todo cambio entra por el ciclo de [spec-kit](https://github.com/github/spec-kit):
`specify → plan → tasks → implement`. No es ceremonia: el motor decide cosas que
son caras de revertir —la forma del estado persistido, el contrato de proveedor,
el orden del rebase y el gate en la cola— y una especificación de media hora
cuesta menos que descubrir la decisión equivocada con quince tareas encima.

El scaffolding de spec-kit **no está en este repositorio**, a propósito: es de
terceros y tiene su propia licencia, así que se instala en vez de
redistribuirse. Para tenerlo:

```bash
uvx --from git+https://github.com/github/spec-kit specify init --here --ai claude
```

Eso deja `.specify/` (plantillas y scripts) y las skills `/speckit-*`. Revisá las
instrucciones vigentes en el repositorio de spec-kit: el comando puede haber
cambiado.

Lo que **sí** se versiona acá y no lo pisa esa instalación:

- `.specify/memory/constitution.md` — la constitución de noxloop. Si el init la
  sobreescribe, recuperala con `git checkout .specify/memory/`.
- `specs/` — el ciclo completo de cada cambio, que es la memoria del proyecto.

## Antes de abrir un pull request

```bash
npm test          # incluye las guardas de constitución
npm run typecheck
npm run validate
```

Los tres tienen que estar en verde. Los tests del motor corren sin red, sin
credenciales y sin modelo.

## Las reglas que no se negocian

Están en `.specify/memory/constitution.md` y hay tests que las verifican. Las
tres que más se intentan violar sin darse cuenta:

1. **El paso RED no se saltea en ningún tier.** Lo que un tier abarata es la
   revisión, el modelo y el alcance del gate — nunca el orden test-primero.
2. **Ningún nombre propio en el motor.** Organizaciones, repositorios, hosts,
   comandos y ramas van a configuración. Hay un test que busca nombres propios
   en `packages/engine/src/**`.
3. **Solo `state.mjs` escribe el estado de una tarea.** Un estado escrito por
   otro archivo se saltea las guardas, que es todo lo que sostiene el principio
   del exit code.

Bajar un umbral, saltear un test, apagar un hook o recortar un gate para que
algo avance no es una decisión de implementación. No está disponible.

## Agregar un gestor de tickets

Cinco pasos, y ninguno toca el motor. Están en
[`providers/README.md`](providers/README.md); el resumen es: copiar
`providers/fake/index.mjs`, declarar `capabilities()` con la verdad, escribir el
mapa de tipos y de estados, correr la suite de contrato hasta verde, y apuntar
`provider.module` en la configuración.

Si hace falta cambiar el motor para soportar un gestor, la interfaz está mal: se
arregla la interfaz y se agrega el caso a la suite.

## Licencia y atribución

noxloop es MIT (ver `LICENSE`). El scaffolding de spec-kit no forma parte de
este repositorio y conserva la licencia de su proyecto.
