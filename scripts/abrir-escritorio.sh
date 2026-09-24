#!/usr/bin/env bash
# Abre noxloop de escritorio en modo desarrollo, con todo cableado, en un comando:
#
#   npm run abrir
#
# Lo que resuelve por ti, y por que cada cosa:
#   - Rust: `cargo` vive en ~/.cargo/bin y ese directorio no siempre esta en el
#     PATH de la terminal.
#   - El Node del sidecar: tiene que ser una distribucion oficial de nodejs.org
#     (el de Homebrew depende de bibliotecas que no viajan y el proceso muere al
#     arrancar). Si no esta en ~/.noxloop/runtime, lo baja y verifica su SHA-256
#     contra SHASUMS256.txt de nodejs.org.
#   - Nango: si el servidor de integraciones esta levantado (docker compose en
#     packages/connections/nango), lee su clave secreta del entorno `dev` y la
#     pasa POR ENTORNO — nunca por argumento, que queda a la vista en `ps`. Sin
#     Nango la app arranca igual, con el camino de token personal.
#   - NOXLOOP_HOME: por defecto ~/.noxloop; se respeta si ya viene definido.
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"

VERSION_NODE="v22.23.3"
ARQ="$(uname -m)"; [ "$ARQ" = "x86_64" ] && ARQ="x64"
DIR_NODE="$HOME/.noxloop/runtime/node-$VERSION_NODE-darwin-$ARQ"
if [ ! -x "$DIR_NODE/bin/node" ]; then
  echo "bajando Node $VERSION_NODE oficial para el sidecar..."
  mkdir -p "$HOME/.noxloop/runtime"
  cd "$HOME/.noxloop/runtime"
  ARCHIVO="node-$VERSION_NODE-darwin-$ARQ.tar.gz"
  curl -sSfO "https://nodejs.org/dist/$VERSION_NODE/$ARCHIVO"
  curl -sSf "https://nodejs.org/dist/$VERSION_NODE/SHASUMS256.txt" | grep " $ARCHIVO\$" | shasum -a 256 -c -
  tar xzf "$ARCHIVO" && rm "$ARCHIVO"
  cd "$RAIZ"
fi
export NOXLOOP_SIDECAR_NODE="$DIR_NODE/bin/node"

if docker compose -f "$RAIZ/packages/connections/nango/docker-compose.yaml" ps --status running 2>/dev/null | grep -q nango-server; then
  CLAVE="$(cd "$RAIZ/packages/connections/nango" && docker compose exec -T nango-db psql -U nango -d nango -t -A \
    -c "select secret_key from _nango_environments where name='dev';" | tr -d '[:space:]')"
  if [ -n "$CLAVE" ]; then
    export NOXLOOP_NANGO_SECRET_KEY="$CLAVE"
    export NOXLOOP_NANGO_URL="${NOXLOOP_NANGO_URL:-http://localhost:3003}"
    echo "Nango detectado: OAuth habilitado"
  fi
else
  echo "Nango no esta levantado: solo el camino de token personal (docs/CONEXIONES.md para levantarlo)"
fi

cd "$RAIZ"
exec npm run desktop
