# El sistema de diseño

La interfaz de noxloop sigue **Geist**, el sistema de diseño de Vercel. Este
documento cuenta cómo, qué se pudo usar tal cual, qué hubo que reconstruir, y
qué sabemos que puede envejecer.

---

## Lo primero: Geist no se puede instalar

La documentación pública de Geist afirma que sus componentes se publican como
`@vercel/geistcn` y sus iconos como `@vercel/geistcn-assets`.

**Ninguno de los dos existe en el registro de npm.** Tampoco `@vercel/geist`,
`@vercel/geist-icons` ni `geist-tokens`. Un 404 sin autenticar no distingue "no
existe" de "es privado"; lo comprobable, y lo único que importa aquí, es que no
se pueden instalar.

Lo único oficial y público es la **fuente**: el paquete `geist`, con
`geist/font/sans` y `geist/font/mono`.

Dos trampas de nombre que conviene evitar: `geist-ui` y `@geist-ui/core` son de
un proyecto comunitario distinto, abandonado en 2022. `geist-colors` está
archivado y su CSS es inválido.

### El camino

**shadcn/ui + Radix, con los tokens de Geist encima.** Es la base más fiel
porque también es *copy-in*, headless y dirigida por tokens; y el propio
`ThemeSwitcher` de Geist usa `next-themes` internamente, así que nosotros
también.

El trabajo real no son los componentes: son las ~200 líneas de CSS que declaran
las escalas, las sombras y el anillo de foco en `apps/studio/app/globals.css`.

---

## El día que la paleta entera estuvo mal

Vale la pena contarlo porque es el modo de fallo más incómodo de esta capa.

La primera versión de `globals.css` se escribió de memoria. **166 de los ~184
valores estaban mal.** No eran aproximaciones: era la paleta de **Radix Colors**,
que es lo que Geist usaba antes. `red-700` decía `#e5484d` donde Geist dice
`#fc0035`; `purple-700` decía `#8e4ec6` donde dice `#9f00f4`.

Se descubrió porque dos extracciones independientes discrepaban y la
discrepancia era identificable. Se arregló bajando los bundles CSS de producción
y comparando valor por valor.

**Un color equivocado compila, pasa el typecheck, pasa los tests y se ve bien.**
Ninguna guarda mecánica lo atrapa. Es el principio X en su forma más incómoda —
lo inferido presentado con la misma autoridad que lo detectado, en un dominio
donde no hay exit code posible. La única defensa es no escribirlos de memoria y
dejar escrito de dónde salieron.

### De dónde salen los valores

Los docs de Geist **no publican ni un solo valor numérico**. Los de este
repositorio están extraídos de los bundles CSS de producción de vercel.com, el
2026-09-20, de estos selectores exactos:

| Tema | Selector |
|---|---|
| Claro | `:root,.light-theme,.dark .invert-theme,.dark-theme .invert-theme` |
| Oscuro | `.dark,.dark-theme,.invert-theme` |

Es código de producción de otra empresa: sin changelog, sin compromiso de
estabilidad, y puede cambiar sin aviso. **Revalidar es volver a bajar los
bundles y comparar. No los corrijas de memoria: es como se rompió la primera
vez.**

---

## Los tokens

Patrón `--ds-<escala>-<paso>`, pasos 100–1000, diez escalas: `background`,
`gray`, `gray-alpha`, `blue`, `red`, `amber`, `green`, `teal`, `purple`, `pink`.

| Paso | Significado |
|---|---|
| 100 / 200 / 300 | fondo por defecto / hover / active |
| 400 / 500 / 600 | borde por defecto / hover / active |
| 700 / 800 | fondo de alto contraste / su hover |
| 900 / 1000 | texto e iconos secundarios / primarios |

**Esto sí es doctrina y no cambia aunque los hex envejezcan.** Un componente que
usa `-400` como fondo está mal escrito aunque se vea bien.

`accent-1..accent-10` **no existe** en Geist: es el sistema pre-Geist de Vercel.
Si aparece en algún sitio, viene de un tutorial viejo.

### Tres cosas que no son obvias

**El borde va dentro de la sombra.** En Geist, un material se separa del fondo
por `--ds-shadow-border-base`, no por `border`. Sustituirlo por
`border: 1px solid` se ve parecido y descuadra el layout, porque el borde suma a
la caja y la sombra no.

**En oscuro, los dos fondos son `#000`.** `background-100` y `background-200`
son el mismo negro. No es un descuido: las superficies se separan por la sombra,
no por el color. Un `#0a0a0a` "para que se distinga" rompe esa relación.

**La interlínea no es proporcional al tamaño.** `label-13` es 13/16 y `copy-13`
es 13/18 — mismo tamaño, distinta caja. Cualquier fórmula que las derive se
equivoca; por eso las clases tipográficas están transcritas una por una.

---

## Tema claro y oscuro

Geist define los tokens **sobre clases** (`.dark`, `.light-theme`,
`.invert-theme`), no sobre `data-theme`, y no usa `prefers-color-scheme` en
ningún sitio: "system" lo resuelve JavaScript.

```tsx
<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
```

`next-themes` inyecta un script inline antes de la hidratación, así que no hay
destello y no hace falta red — compatible con el export estático y con la
aplicación de escritorio.

---

## Los componentes

Los quince que la consola necesita están en `apps/studio/components/ui/`, y se
pueden ver todos en sus estados en **`/?vista=catalogo`**.

Seis no los trae shadcn y son los que de verdad sostienen esta consola:

| Componente | Para qué, aquí |
|---|---|
| `Entity` | Fila de contenido + uno o dos controles. Es el inventario de credenciales, la lista de agentes y las filas de conexiones |
| `Fieldset` | Tarjeta de ajustes con footer de acciones. Constitution, guidelines, recomendaciones |
| `SecretValue` | Enmascara con revelado deliberado. Su modo por defecto es **solo huella**, porque la bóveda nunca entrega el valor a la interfaz |
| `Description` | Clave/valor en páginas de detalle. Geist **prohíbe** usar una tabla de dos columnas para esto |
| `EmptyState` | Con la consulta citada verbatim cuando el vacío viene de un filtro |
| `StatusDot` | Restringido a ciclo de vida de despliegue. Para runs y colas va `Badge` |

Dos trampas de nombre en el propio Geist: **el `Switch` de Geist es un control
segmentado**, no un booleano — el booleano es `Toggle`. Y `Stack` y `Popover` no
existen (el equivalente de popover es `Context Card`).

---

## Las reglas que no son opcionales

- ***"Prefer spacing and alignment over borders and boxes."*** Nada de paneles
  anidados ni una card por sección. Una superficie se gana cuando comunica
  selección, interacción, advertencia o una agrupación real.
- **Monocromo primero.** Color solo cuando añade significado a estado, acción o
  dato, y **siempre con una señal no cromática al lado**. Nunca colorear una
  métrica solo porque el número es bueno.
- **Geist Mono exclusivamente** para código, comandos e identificadores
  operativos: IDs, timestamps, huellas de credencial. Para prosa y números,
  Sans.
- `Badge`: verde sano, rojo error, ámbar advertencia, azul informativo, gris
  neutro. **Sin checkmarks ni equis** — el color ya lo dice.
- **Tablas**: texto a la izquierda, números a la derecha con `tabular-nums`, `—`
  para lo desconocido, tiempo relativo hasta siete días y absoluto después, y
  **el estado vacío fuera de la tabla**.
- **Errores**: *qué pasó y qué hacer, en ese orden*. Nunca "algo salió mal": se
  nombra el recurso. Esto es NFR-006, y Geist lo trae con la redacción
  resuelta — por eso `ErrorText` toma `causa` y `accion` como props separadas y
  obligatorias: el requisito está metido en el tipo.
- **El canal de feedback se elige por cómo el usuario vivió el evento**, no por
  el código HTTP. La validación de un campo nunca es un toast.

---

## Cómo se verifica

```bash
npm run studio:build          # compila y la salida sigue siendo estática
npm run guard                 # entre otras, que la interfaz no tenga servidor
```

El catálogo de componentes está en `/?vista=catalogo` y el build lo ejercita: si
un componente revienta al renderizar, `next build` falla.

---

## Lo que sabemos que puede envejecer

- **Los valores.** Salen de código de producción de otra empresa.
- **Los tamaños tipográficos y las sombras** están extraídos igual que la
  paleta, en la misma pasada.
- **Los modos de `EmptyState`**: los docs dicen que Geist documenta "los modos"
  pero no los enumeran de forma accesible. Los cuatro que usamos salen de los
  casos reales de esta consola, no de una transcripción — está anotado en el
  componente, y si aparece la lista original, manda la original.
- **Si `@vercel/geistcn` se publica algún día**, los componentes están aislados
  detrás de sus propios archivos: migrar sería sustituir su interior, no
  reescribir las pantallas.
