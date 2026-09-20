# Investigación · Fase 0

**Branch**: `002-control-plane` | **Fecha**: 2026-09-20

Tres investigaciones paralelas sobre las piezas que esta feature no tiene todavía. Cada sección termina con lo que **no** se pudo verificar, declarado como tal — el principio X de la enmienda propuesta empieza aplicándose a este documento.

---

## 1. Superficie: Next.js static export + Tauri v2 + sidecar Node

### Versiones verificadas (2026-09-20)

| Pieza | Estado |
|---|---|
| Next.js | 16.3.5 |
| React | 19.3.0 |
| Tailwind | 4.3.3 |
| Tauri CLI / API | 2.11.5 / 2.11.1 |
| Node SEA | **Stability 1.1 — Active Development** |
| `vercel/pkg` | **Archivado y deprecado** (último release 5.8.1) |

### Lo que `output: 'export'` prohíbe

Sin Server Actions, sin middleware, sin `cookies()`/`headers()`, sin rewrites ni redirects, sin ISR, sin optimización de imágenes, sin rutas dinámicas sin `generateStaticParams()`. Los Route Handlers funcionan solo en GET y estáticos.

**Esto no es una limitación que sufrimos: es la propiedad que queríamos.** Coincide exactamente con FR-002 —la interfaz no escribe— y con la decisión de que todo pase por el servicio. Una restricción del build que hace imposible saltarse un invariante vale más que una regla que pide no saltárselo.

Para IDs que vienen en runtime del servicio: catch-all `app/[[...slug]]/page.tsx` con `generateStaticParams()` devolviendo `[{ slug: [] }]` → un `index.html` y enrutado en cliente.

### Configuración

```ts
// next.config.ts
const isProd = process.env.NODE_ENV === 'production'
const internalHost = process.env.TAURI_DEV_HOST || 'localhost'

export default {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,                                    // sin esto, /settings no resuelve en tauri://
  assetPrefix: isProd ? undefined : `http://${internalHost}:3000`,
} satisfies NextConfig
```

`assetPrefix` apuntando a `localhost:3000` en el build de producción deja la app de escritorio **en blanco**. Es la trampa número uno y se evita con ese ternario.

### Decisión: cómo empaquetar el runtime del sidecar

| Opción | Veredicto |
|---|---|
| Asumir Node instalado | **Descartado.** Versión impredecible, PATH distinto bajo Finder, nada en una máquina limpia |
| `vercel/pkg` | **Descartado.** Archivado por sus autores |
| Node SEA | **Descartado para el MVP.** `macOS x64 "not currently supported"` — bloqueante si se publica build Intel. Además, cross-compile obliga a desactivar code cache y snapshot |
| **Binario de Node embebido como `externalBin` + código como `resources`** | **Elegido** |
| `bun build --compile` | Reevaluar antes de la V1 |

**Por qué Node embebido y no Bun.** El sidecar **es el motor de v1**: 849 tests pasando sobre APIs de Node, hooks que corren en subprocesos, `node --test`. Cambiar su runtime a Bun en la misma feature que construye la superficie mete dos variables en el mismo experimento. Bun cross-compila los 8 targets desde un solo runner —ventaja real de CI— y es la reevaluación natural cuando el motor esté migrado y sus tests corran en verde bajo los dos runtimes.

Coste aceptado: ~60-90 MB por plataforma en el bundle.

### Ciclo de vida del sidecar

Verificado en el código del plugin shell: mata a sus hijos en `RunEvent::Exit`. Pero solo al hijo directo, y no si el padre muere por SIGKILL. Cinturón y tirantes:

1. Guardar el `CommandChild` y matarlo explícitamente en `RunEvent::Exit`.
2. **Watchdog en el daemon**: `--parent-pid`, y `process.kill(pid, 0)` cada 2s. Si el padre no está, salir.
3. Puerto efímero: el daemon escucha en `:0` e imprime `NOXLOOP_READY http://127.0.0.1:PORT`; Rust lo parsea.
4. Token de sesión aleatorio generado en Rust, pasado por `--token` y entregado al frontend por `invoke`.

**Por qué el token importa aunque sea localhost:** cualquier página abierta en el navegador del operador puede hacer peticiones a `127.0.0.1`. Sin token, un anuncio en otra pestaña enumera sus proyectos y sus credenciales.

### La corrección sobre el keychain

**`tauri-plugin-stronghold` no usa el keychain del sistema operativo.** Guarda un fichero cifrado protegido por una contraseña que la aplicación debe suministrar — y esa contraseña habría que guardarla en el keychain, con lo que Stronghold no aporta la pieza.

No hay plugin oficial para keychain. La vía: **comando Rust sobre el crate `keyring`** (Keychain / Credential Manager / Secret Service).

Efecto lateral que mejora el diseño: los comandos de bóveda **no se exponen al webview**. La interfaz no tiene ruta para pedir un secreto porque la ruta no existe.

Fallback obligatorio: en Linux sin Secret Service (servidores, WM minimalistas) `keyring` falla. Ahí entra el archivo cifrado, **declarado en `/v1/capabilities`**, nunca en silencio.

### Trampas con solución

| Trampa | Solución |
|---|---|
| CORS: el origen en producción no es `localhost:3000` | Allowlist con las tres variantes: `tauri://localhost`, `http://tauri.localhost`, `http://localhost:3000` |
| CSP corta el fetch al daemon | `connect-src` con `http://127.0.0.1:* http://localhost:* ipc: http://ipc.localhost` |
| **`EventSource` no manda headers** | Token en query string validado por el daemon, o `fetch` + `ReadableStream` parseando SSE a mano |
| SSE en Linux (WebKitGTK) | **Una sola** conexión SSE multiplexada para toda la app. Si aparece el techo, puente por Rust con `Channel<T>` |
| Fuentes de Google por `<link>` | `next/font` auto-hospeda en build; cero red en runtime |
| Consola negra en Windows | GUI subsystem o `CREATE_NO_WINDOW` |
| Gatekeeper mata la app | `codesign` del sidecar **antes** de `tauri build` |
| `window` en el prerender | Todo acceso a `window`, `isTauri()` y plugins dentro de `useEffect` |

### No verificado

- Si el hashing CSP de Tauri cubre los inline scripts de Next 16. Mecanismo documentado, interacción concreta sin probar.
- Origen exacto del webview por plataforma. Comprobar con `location.origin` en cada SO antes de fijar la allowlist de CORS.
- El techo de 6 conexiones de WebKitGTK: reporte comunitario, no documentación.
- La deprecación de Stronghold en Tauri v3: afirmada en discusiones, ausente del README oficial.
- Compatibilidad del motor con el runtime de Bun.

---

## 2. Design system: Geist

### El hallazgo que cambia el plan

**El sistema de componentes de Geist no es instalable.** La documentación de Vercel afirma que los componentes se publican como `@vercel/geistcn` y los iconos como `@vercel/geistcn-assets`. El registro de npm devuelve **404 en ambos**, igual que en `@vercel/geist`, `@vercel/geist-icons` y `geist-tokens`.

Un 404 sin autenticar no distingue "no existe" de "es privado". Lo comprobable, y lo único que importa aquí: **no se pueden instalar**.

Lo único oficial y público es la **fuente**: `geist@1.7.2`, licencia SIL OFL, con `geist/font/sans`, `geist/font/mono` y `geist/font/pixel`.

Trampas a evitar: `geist-ui` y `@geist-ui/core` son de un proyecto comunitario distinto, abandonado en 2022. `geist-colors` está archivado y su CSS es inválido.

### El camino

**shadcn/ui + Radix, con los tokens de Geist encima.** Es la base más fiel: también es copy-in, headless y dirigida por tokens, y Vercel usa `next-themes` internamente para su propio `ThemeSwitcher`.

```bash
npm i geist next-themes sonner lucide-react @tanstack/react-table
npx shadcn@latest init
```

El trabajo real son ~200 líneas de CSS: las 10 escalas `--ds-*`, las sombras, el anillo de foco, y el mapeo de los tokens de shadcn encima.

### Tokens verificados

Patrón `--ds-<escala>-<paso>`, pasos 100–1000, 10 escalas (`backgrounds`, `gray`, `gray-alpha`, `blue`, `red`, `amber`, `green`, `teal`, `purple`, `pink`).

| Paso | Significado |
|---|---|
| 100 / 200 / 300 | fondo por defecto / hover / active |
| 400 / 500 / 600 | borde por defecto / hover / active |
| 700 / 800 | fondo de alto contraste / hover |
| 900 / 1000 | texto secundario / primario |

**`accent-1..accent-10` no existe en Geist** — es el sistema pre-Geist de Vercel. Geist moderno es `--ds-*`.

Tipografía: cuatro familias (`text-heading-*` 600, `text-button-*` 500, `text-label-*` 400, `text-copy-*` 400). `text-label-14` y `text-copy-14` son las dos más usadas.

Radios: `material-base` 6px, `material-medium/menu/modal` 12px, `material-fullscreen` 16px. **No existen `--ds-radius-*`**: son literales.

Espaciado: Geist **no define escala propia**. Tailwind sin modificar, 4px.

Tema: sobre **clases** (`.dark`, `.light-theme`, `.invert-theme`), no sobre `data-theme`. Cero ocurrencias de `prefers-color-scheme`. Vercel resuelve "system" con `next-themes`; nosotros también.

### Componentes que esta consola necesita y no están en la lista obvia

| Componente | Para qué, aquí |
|---|---|
| **`Entity`** | Fila de contenido + uno o dos controles. Es el inventario de credenciales, la lista de agentes y las filas de conexiones |
| **`Fieldset`** | Tarjeta de ajustes con footer de acciones. Constitution, guidelines, recomendaciones |
| **`SecretValue`** | Enmascara credenciales con revelado deliberado. Directamente FR-040/041 y NFR-004 |
| **`Destructive Action Modal`** | Confirmación con escritura del nombre. Revocar credenciales y grants |
| **`JSON View`, `File Tree`** | Snapshot y diffs de recomendaciones |
| **`Command Menu`** | ⌘K. NFR-005 |
| **`Description`** | Clave/valor en detalle. Geist prohíbe usar una tabla de dos columnas para esto |

Trampa de nombres: **el `Switch` de Geist es un control segmentado**, no un booleano. El booleano es `Toggle`. `Stack` y `Popover` no existen (`Context Card` es el equivalente de popover).

### Patrones que se adoptan como guidelines

- *"Prefer spacing and alignment over borders and boxes."* Nada de paneles anidados ni una card por sección.
- **Diseñar en monocromo primero.** Color solo cuando añade significado a estado, acción o dato, y siempre con una señal no cromática al lado.
- Geist Mono **exclusivamente** para código, comandos e identificadores operativos: IDs, timestamps, huellas de credencial.
- Tablas: texto a la izquierda, números a la derecha con `tabular-nums`, `—` para lo desconocido, tiempo relativo hasta 7 días y absoluto después, **el estado vacío fuera de la tabla**.
- Errores: **qué pasó y qué hacer, en ese orden.** `Couldn't`/`Can't` para estado del usuario, `Failed to` para sistema. Nunca "Unable to", nunca "Something went wrong" — se nombra el recurso. Es literalmente NFR-006, y viene con redacción resuelta.
- Feedback: *"elige el canal por cómo el usuario vivió el evento, no por el código HTTP."* Validación de campo nunca es un toast.

### No verificado

- Si `@vercel/geistcn` es privado o inexistente.
- **Los docs de Geist no publican ningún valor numérico.** Los hex, sombras y tamaños salen del stylesheet de producción de vercel.com, no de documentación autorizada: **pueden cambiar sin aviso**. Se fijan en nuestro CSS y se revisan a mano.
- `--ds-background-100` en oscuro: dos capas del bundle discrepan (`#000` vs `~#0a0a0a`).

---

## 3. Capa de integración: Nango self-hosted

Versión verificada: **0.71.9**, publicada 2026-09-16, último commit 2026-09-18. El proyecto está muy vivo.

### Qué trae la edición gratuita, y qué no

| | Free self-hosted |
|---|---|
| API Auth | **Sí** |
| Proxy | **Sí** |
| Syncs, tool calls, triggers | No |
| Servidor MCP | No |
| Webhooks | Declarado "No" (ver ambigüedad abajo) |

La prueba no es la tabla de la documentación: es el `Dockerfile.self_hosted`, que **borra** `packages/jobs`, `packages/runner` y `packages/persist`. Sin orquestador, sin runner.

**Para nuestro caso eso está bien**: necesitamos autorizar, recuperar el token y proxear. Nada más. Y el resultado son 3 contenedores en vez de una plataforma.

### El callback OAuth en escritorio: resuelto

El hallazgo que desbloquea la etapa 06: **Nango no necesita dominio público porque el callback lo sirve el propio Nango, que corre en localhost.** Con `NANGO_SERVER_URL=http://localhost:3003`, el callback es `http://localhost:3003/oauth/callback`. El proveedor redirige **el navegador del operador**, que sí alcanza localhost.

No hace falta deep link, ni esquema propio, ni túnel.

El camino que funciona:

1. Registrar `http://localhost:3003/oauth/callback` como redirect URI en la aplicación OAuth de cada proveedor. **Puerto fijo, obligatorio.**
2. El servicio pide un connect session y obtiene un `connect_link`.
3. Tauri lo abre en el **navegador del sistema**, no en el webview — varios proveedores bloquean webviews embebidos por política.
4. La página de callback de Nango es autónoma: no necesita `window.opener`, funciona en una pestaña suelta.
5. La app **sondea** hasta que la conexión aparece.

### Lo que rompe el supuesto de "conectar tools con OAuth"

| Proveedor | Modo de autenticación real |
|---|---|
| Linear, Jira, GitHub, Slack, Notion | OAuth2 |
| **Azure DevOps** | **BASIC (PAT)** — no OAuth |
| **Vercel** | **API_KEY** — no OAuth |

Dos de los objetivos declarados no usan OAuth. Por eso el contrato se llama `ConnectionProvider` y no `OAuthProvider`, y el modo lo decide el catálogo. Si la interfaz se hubiera escrito alrededor de un flujo OAuth, el error habría aparecido al implementar Azure DevOps, con todo construido encima.

### La licencia

**Elastic License 2.0**, y los SDK `@nangohq/node` y `@nangohq/frontend` también.

- No está aprobada por la OSI. No es compatible con GPL/AGPL.
- Distribuir la app con `@nangohq/node` dentro es redistribuir código ELv2. El repositorio puede seguir siendo MIT; **la dependencia no lo es**.
- Debian, Fedora y varias políticas corporativas rechazan ELv2.
- La cláusula de "no ofrecer como servicio alojado a terceros" **no** afecta a un Nango local para su propio operador. **Sí** afectaría a un noxloop alojado que conectara integraciones por cuenta de sus usuarios.

### Riesgos verificados

| Riesgo | Detalle |
|---|---|
| Licencia | Arriba. Es el riesgo principal, y no es técnico |
| Tres contenedores | Postgres + Redis + Node en la máquina del operador, para conectar Linear |
| El puerto 3003 es un contrato externo | Queda registrado en la aplicación OAuth de cada proveedor. Ocupado = todos los flujos rotos, sin degradación posible |
| `NANGO_ENCRYPTION_KEY` **no rota** | Cambiarla rompe el descifrado. Sin ella, las credenciales se guardan **en claro** en Postgres |
| Calidad del camino gratuito | El bug del puerto (#5305) cerrado como *not planned*; la petición de aclarar el feature set (#5536) lleva meses abierta y marcada stale |
| Aplicaciones OAuth compartidas | Scopes fijos, el usuario autoriza "Nango" y no tu producto, revocables por el proveedor. **Solo con aplicación propia se pueden exportar los tokens y salir de Nango.** Registrar las propias desde el día uno es el seguro de portabilidad |
| Dashboard abierto por defecto | Sin `FLAG_AUTH_ENABLED=false` + basic auth, cualquiera que alcance la instancia entra |
| Sin syncs no hay caché | Todo contra la API del proveedor en tiempo real: los límites de tasa pegan de lleno |

### Bug que muerde el primer día

`SERVER_PORT` va sin valor por defecto en el compose, pero la imagen trae `PORT=8080` horneado: el servidor escucha en 8080 y el compose expone 3003. No conecta nada. Solución: `SERVER_PORT=3003` explícito en el `.env`.

### Alternativas descartadas

| Opción | Por qué no |
|---|---|
| Paragon | Sin self-hosting real fuera de contratos enterprise |
| Merge.dev | SaaS puro, las credenciales viven en su nube |
| Supaglue | Apache-2.0 y self-hostable, pero **archivado desde marzo de 2024** |
| MCP + OAuth propio | Máximo control y sin licencia restrictiva, pero implica escribir a mano el refresco de tokens, el cifrado en reposo y N flujos OAuth. Es la superficie más delicada del producto |

### No verificado

- Sizing oficial de recursos para la edición gratuita de 3 contenedores: **no existe en la documentación**.
- Si los webhooks de autenticación funcionan realmente en la edición gratuita. La tabla dice que no; el código (`shouldSend` no consulta plan ni edición) sugiere que sí; nadie de Nango lo ha aclarado en siete meses. **Por eso el sondeo es el camino primario.**
- Si Linear acepta redirect URIs `http://localhost` en su portal. Para Atlassian está confirmado.
- Si hay tope de conexiones en la edición gratuita: `connections_max: 10` existe en el plan free, pero `FLAG_PLAN_ENABLED` está apagado por defecto en self-hosted. No se confirma en ninguna dirección.

---

## Resumen de decisiones de Fase 0

| # | Decisión | Motivo en una línea |
|---|---|---|
| 1 | Next 16 static export + Tauri v2 | La restricción del build hace imposible saltarse FR-002 |
| 2 | Catch-all + enrutado en cliente para IDs | Static export no admite rutas dinámicas sin params conocidos |
| 3 | Sidecar = Node embebido como `externalBin` | El motor son 849 tests sobre APIs de Node; no se cambia su runtime en esta feature |
| 4 | Puerto efímero + token de sesión | Cualquier pestaña del navegador alcanza `127.0.0.1` |
| 5 | Keychain por crate `keyring`, no Stronghold | Stronghold no es el keychain; y así la bóveda no se expone al webview |
| 6 | shadcn/ui + tokens de Geist | El sistema de componentes de Geist no es instalable |
| 7 | `next-themes` con `attribute="class"` | Es lo que usa el propio `ThemeSwitcher` de Geist |
| 8 | `ConnectionProvider`, no `OAuthProvider` | Azure DevOps y Vercel no usan OAuth |
| 9 | Sondeo primario, webhooks opcionales | La disponibilidad de webhooks en la edición gratuita no se puede verificar |
| 10 | Nango como dependencia del núcleo, con adaptador `local` para PAT y claves de API | Decisión tomada con la licencia ELv2 sobre la mesa; `local` cubre los modos donde Nango no aporta |
