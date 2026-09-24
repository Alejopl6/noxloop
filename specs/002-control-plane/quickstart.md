# Quickstart — el plano de control

Cómo se levanta y cómo se verifica, en orden de costo creciente. Los cuatro
primeros escenarios no necesitan red, credenciales, modelo ni Docker: son los
que corre el CI en cada commit, con los mismos comandos. Los siguientes piden
algo más —un Rust instalado, contenedores, una cuenta en un proveedor— y lo
dicen al empezar.

## Prerrequisitos

- Node ≥ 22 y git ≥ 2.30
- `npm install` en la raíz
- Para el escenario 6: Rust estable y las dependencias de sistema de Tauri
- Para el escenario 7: Docker, y una cuenta en el proveedor que se va a conectar

---

## Escenario 1 — La suite, los tipos y las guardas

```bash
npm test          # toda la suite: motor, servicio, bóveda, scanner, conexiones, interfaz
npm run typecheck # tsc --checkJs, sin paso de build
npm run validate  # la configuración de ejemplo contra su esquema
npm run guard     # las guardas de constitución, solas y con nombre
```

**Se espera**: verde en los cuatro. **Prueba**: SC-010 —los tests del motor
siguen en verde con la feature entera encima—.

---

## Escenario 2 — De un repositorio de verdad a un PR abierto

```bash
node --test packages/service/test/punta-a-punta.test.mjs
```

Arranca el servicio sobre un home desechable, da de alta un repositorio git
real, lo lleva por las siete etapas por HTTP hasta `ACTIVE`, y lanza el motor
con el proveedor `fake` hasta dejar un PR abierto. Solo simula el modelo y el
forge; worktrees, gate, commits y cola de integración corren de verdad.

**Se espera**: verde, y una línea como esta al final:

```
T205 · recorrido completo en 2825 ms (2.8 s), 80 pasos, 0 ediciones a mano
```

Si la línea termina en `N costura(s) cruzada(s) a mano` y las enumera, el
recorrido llegó pero el producto no lo lleva solo por esas costuras: cada una es
un defecto, no una nota. **Prueba**: SC-009, y la mitad automatizable de SC-001.

---

## Escenario 3 — El scanner no escribe y ningún secreto se filtra

```bash
node --test packages/scanner/test/scanner-no-escribe.test.mjs
node --test packages/scanner/test/scanner-no-copia-secreto.test.mjs
node --test packages/service/test/centinela.test.mjs
node --test packages/store/test/invariantes.test.mjs
```

Son los dos invariantes sin segundo intento. El CI los corre además solos, en un
paso propio, junto con toda `packages/vault/test/`, y falla si encuentra menos
archivos de los que había: un paso que mira menos de lo que cree sigue verde.
**Prueba**: SC-002, SC-003 y SC-004.

---

## Escenario 4 — La interfaz compila a estático

```bash
npm run studio:build
ls apps/studio/out/index.html
```

**Se espera**: `out/index.html` existe y **no** hay `out/_next/server/`. La
misma salida la sirve el escritorio y la sirve un navegador; si apareciera un
directorio de servidor, el escritorio abriría en blanco. **Prueba**: SC-008.

---

## Escenario 5 — El servicio y la interfaz en el navegador

Dos terminales:

```bash
npm run service -- --home ~/.noxloop-prueba --port 4747
```

```bash
NEXT_PUBLIC_DAEMON_URL=http://127.0.0.1:4747 npm run studio:dev
```

El servicio imprime `NOXLOOP_READY http://127.0.0.1:4747` y escucha **solo** en
`127.0.0.1`. Su token de sesión queda en `~/.noxloop-prueba/servicio/sesion.json`,
con permisos `0600`. Abre `http://localhost:3100`, pega el token cuando la
interfaz lo pida y da de alta un repositorio desde la pantalla de inicio.

El 3100 no es un capricho: es el origen que la allowlist del servicio acepta por
defecto, y el que `devUrl` de Tauri espera. Otro puerto exige `--origen`.

**Se espera**: la bandeja vacía dicha como tal, y el alta llevando el proyecto
etapa por etapa.

---

## Escenario 6 — El escritorio

```bash
npm run desktop
```

`tauri dev` prepara el sidecar (el ejecutable de Node, copiado a
`apps/desktop/src-tauri/binaries/`), levanta la interfaz en el 3100 y arranca el
servicio como proceso hijo, con un token aleatorio que la interfaz recibe por
`invoke` y que nunca se escribe en el webview.

Las pruebas de la cáscara, que son las que el CI corre en un job aparte:

```bash
cd apps/desktop/src-tauri
NOXLOOP_SIDECAR_ENLAZADO_OK=1 cargo test --lib
cargo fmt --check
```

**Se espera**: la vista de inicio en menos de 3 segundos en frío (SC-007), y
verde en `cargo test`. Entre esas pruebas está la de que ningún comando de la
bóveda llega al webview.

### Construir el `.dmg` (macOS, Apple Silicon)

El sidecar tiene que ser un Node **oficial** de nodejs.org: el de Homebrew está
enlazado contra dylibs de `/opt/homebrew` y `preparar-sidecar.mjs` corta si se
lo pasan.

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cd apps/desktop
NOXLOOP_SIDECAR_NODE=/ruta/a/node-v22.x-darwin-arm64/bin/node \
  npx tauri build --bundles app,dmg
```

Sale en `apps/desktop/src-tauri/target/release/bundle/dmg/noxloop_<version>_aarch64.dmg`
(~45 MB; el `.app` descomprimido, ~155 MB, casi todo el runtime de Node). Si
`bundle_dmg.sh` falla sin más detalle, suele ser el paso de Finder por
AppleScript: `hdiutil info` muestra un `rw.*.dmg` montado; desmontarlo con
`hdiutil detach` y repetir.

Qué hay dentro, y por qué tiene esa forma:

- `Contents/MacOS/`: `noxloop-desktop`, `noxloop-service` (el Node) y
  `noxloop-llavero`. El llavero no se declara como `externalBin`: el bundler
  copia todos los binarios del crate, y `llavero_junto_a` lo busca ahí.
- `Contents/Resources/app/`: una **réplica de la estructura del repositorio**
  (`packages/<x>/src`, `packages/engine/{bin,schemas}`, `providers/`,
  `node_modules/<terceros>`). Así `../../engine/bin/` y `../../../providers/`
  resuelven igual que en el repo. La guarda es
  `packages/service/test/recursos-del-escritorio.test.mjs`: prohíbe globs en
  `bundle.resources` (Tauri los aplana), exige la réplica bajo `app/`, comprueba
  que ninguna ruta relativa de lo empaquetado sale de lo empaquetado, y monta el
  árbol fuera del repo para importarlo con un Node limpio.

**Verificar el `.app` sin el repositorio**: copiarlo del `.dmg` a un directorio
cualquiera, lanzarlo con un home aislado y preguntarle al servicio:

```bash
MP=$(hdiutil attach -nobrowse -readonly <ruta-al-.dmg> | grep -o '/Volumes/.*$')
cp -R "$MP/noxloop.app" /tmp/prueba/ && hdiutil detach "$MP"
NOXLOOP_HOME=/tmp/prueba/home /tmp/prueba/noxloop.app/Contents/MacOS/noxloop-desktop &
# token y puerto: `ps ax -o command | grep noxloop-service` y la línea NOXLOOP_READY
curl -H "Authorization: Bearer <token>" http://127.0.0.1:<puerto>/v1/capabilities
```

**Se espera**: `boveda.valor.tipo` = `keychain_so` con evidencia en
`Contents/MacOS/noxloop-llavero`, y `motor.valor.presente` = `true` con
evidencia en `Contents/Resources/app/packages/engine/package.json`. Y
`Contents/MacOS/noxloop-service Contents/Resources/app/packages/engine/bin/noxloop.mjs help`
sale con 0.

### El `.dmg` universal del release (spec 004, FR-009)

Es el que publica `.github/workflows/release.yml` con un tag `v*` (la versión
de `tauri.conf.json` tiene que coincidir con el tag). A mano, en un Mac con
Apple Silicon:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
rustup target add x86_64-apple-darwin          # solo el target de compilación
eval "$(apps/desktop/scripts/node-universal.sh 22.23.3 /tmp/node-universal | grep '^NOXLOOP_' | sed 's/^/export /')"
cd apps/desktop
CI=true npx tauri build --target universal-apple-darwin --bundles dmg
```

- `node-universal.sh` baja los dos Node oficiales (darwin-arm64 y darwin-x64)
  de nodejs.org, los verifica contra `SHASUMS256.txt` y los une con
  `lipo -create`.
- `preparar-sidecar.mjs` con el triple `universal-apple-darwin` deja **tres**
  sidecars (uno por arquitectura, que `tauri-build` exige al compilar cada una,
  y el universal que va al `.app`) y, como `beforeBundleCommand`, une además el
  llavero con `lipo`: la CLI de Tauri solo une el binario principal y sin esto
  el bundle falla con `noxloop-llavero does not exist`.
- `CI=true` hace que `bundle_dmg.sh` se salte la maquetación de Finder por
  AppleScript, que falla sin sesión gráfica con permisos (ver arriba). En
  GitHub Actions ya está puesta.

Sale `apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/dmg/noxloop_<version>_universal.dmg`
(~90 MB; el `.app`, ~280 MB: dos runtimes de Node).

**Se espera**: `lipo -info` sobre cada binario de `Contents/MacOS/`
(`noxloop-desktop`, `noxloop-service`, `noxloop-llavero`) dice `x86_64 arm64`;
y la app arranca su servicio (`NOXLOOP_READY` en la salida) tanto con
`arch -arm64 …/noxloop-desktop` como con `arch -x86_64 …/noxloop-desktop`
(Rosetta), con los dos procesos en `X86-64 (translated)` según `vmmap`.

### Abrir en el editor y el badge del Dock (spec 004, FR-007 y FR-008)

Con la app de escritorio abierta y un run con tareas:

1. En el detalle del run, abre una tarea: cada archivo del diff (salvo los
   borrados) tiene «Abrir en el editor», y los números de línea del lado nuevo
   son pulsables. Abre el archivo **del worktree de la tarea** en esa línea en
   el primer editor detectado (VS Code, Cursor, Zed, Sublime Text; por bundle
   en `/Applications` o `~/Applications`, o por CLI en el `PATH`). Sin editor
   detectado, o en la interfaz web, el botón no aparece.
2. La cáscara solo abre archivos que, resueltos los enlaces simbólicos, estén
   dentro de `<home de noxloop>/worktrees/`; cualquier otra ruta que mande el
   webview se rechaza con su causa. Lo prueban los tests de
   `src-tauri/src/editor.rs` (`cargo test --lib`).
3. Con dos entradas en «te necesitan», el icono del Dock muestra `2`; al
   resolverlas baja, y en `0` desaparece.

---

## Escenario 7 — Conectar un proveedor por OAuth

Pide Docker y una cuenta en el proveedor. Sin esto el producto sigue entero:
los proveedores de token personal y de clave de API se conectan con el
adaptador local y sin contenedores.

```bash
cd packages/connections/nango
cp .env.ejemplo .env
openssl rand -base64 32          # pégalo en NANGO_ENCRYPTION_KEY
docker compose up -d
```

Luego arranca el servicio con la clave secreta del entorno `dev` del servidor
—por entorno y no por bandera, porque `argv` se ve en la tabla de procesos—:

```bash
export NOXLOOP_NANGO_SECRET_KEY=...   # del panel, o de `_nango_environments`
npm run service
```

En la pantalla de conexiones, el proveedor sin aplicación registrada muestra el
recorrido de cuatro pasos. **La aplicación OAuth hay que registrarla tú**: en un
Nango autoalojado no hay aplicaciones compartidas, y la dirección de retorno es
`http://localhost:3003/oauth/callback`, no la de `api.nango.dev` que dice la guía
oficial. Detalle en [`docs/CONEXIONES.md`](../../docs/CONEXIONES.md).

**Se espera**: al autorizar, el navegador del sistema se abre, la pantalla sondea
y la conexión aparece sola.

---

## Escenario 8 — La aceptación de SC-001, a mano

Lo que el escenario 2 no puede medir: una persona, un repositorio suyo, sin leer
este archivo.

1. Abre la aplicación de escritorio (escenario 6) con un home limpio.
2. Da de alta un repositorio real que no sea este.
3. Cronometra hasta que el proyecto llegue a `ACTIVE`.

**Se espera**: menos de 15 minutos, sin editar un archivo a mano y sin abrir la
documentación. Cada vez que haga falta salir de la aplicación para avanzar, se
anota: eso es una costura, igual que las que imprime el escenario 2.

---

## Resultados

| Escenario | Estado | Fecha |
|---|---|---|
| 1 | verde: 1750 tests, typecheck, validate y guard | 2026-09-23 |
| 2 | verde, 0 costuras | 2026-09-23 |
| 3 | verde (dentro del escenario 1) | 2026-09-23 |
| 4 | verde: `out/` con 31 archivos y sin directorio de servidor | 2026-09-23 |
| 5 | la mitad del servicio: `NOXLOOP_READY`, `sesion.json` en `0600`, `401` sin token y `200` con token y origen 3100. La interfaz en el navegador, sin registrar | 2026-09-23 |
| 6–7 | sin registrar | — |
| 8 | pendiente: necesita una persona y un repositorio real | — |
