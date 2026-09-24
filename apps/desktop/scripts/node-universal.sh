#!/usr/bin/env bash
# Arma el Node universal (arm64 + x86_64) que viaja como sidecar en el .dmg
# universal de macOS.
#
#   scripts/node-universal.sh <version> <directorio-de-salida>
#   p. ej. scripts/node-universal.sh 22.23.3 "$RUNNER_TEMP/node"
#
# Deja en <salida>: node-arm64, node-x64 y node-universal, e imprime las tres
# rutas como `NOXLOOP_SIDECAR_NODE_*=...` para `>> "$GITHUB_ENV"`.
#
# POR QUE LOS DOS OFICIALES DE NODEJS.ORG Y NO EL DEL RUNNER. El sidecar tiene
# que ser autocontenido (ver `preparar-sidecar.mjs`: el de Homebrew muere con
# `Library not loaded: @rpath/libnode`), y un binario universal necesita las
# dos arquitecturas de la MISMA version: un runner tiene solo la suya.
#
# VERIFICACION. Cada tarball se compara contra `SHASUMS256.txt` de la misma
# version antes de extraer nada. Un tarball que no cuadra corta el build: se
# empaqueta un runtime que ejecuta codigo del operador con sus credenciales.
set -euo pipefail

VERSION="${1:?Uso: node-universal.sh <version> <directorio-de-salida>}"
VERSION="${VERSION#v}"
SALIDA="${2:?Uso: node-universal.sh <version> <directorio-de-salida>}"
BASE="https://nodejs.org/dist/v${VERSION}"

mkdir -p "$SALIDA"
SALIDA="$(cd "$SALIDA" && pwd)"
cd "$SALIDA"

curl -fsSL --retry 3 -o SHASUMS256.txt "$BASE/SHASUMS256.txt"

for arq in arm64 x64; do
  tarball="node-v${VERSION}-darwin-${arq}.tar.gz"
  curl -fsSL --retry 3 -o "$tarball" "$BASE/$tarball"
  # `grep` exacto por nombre: la lista trae decenas de archivos.
  if ! grep "  ${tarball}\$" SHASUMS256.txt | shasum -a 256 -c -; then
    echo "El SHA-256 de ${tarball} no coincide con SHASUMS256.txt de v${VERSION}. No se empaqueta." >&2
    exit 1
  fi
  tar -xzf "$tarball" "node-v${VERSION}-darwin-${arq}/bin/node"
  cp "node-v${VERSION}-darwin-${arq}/bin/node" "node-${arq}"
done

lipo -create node-arm64 node-x64 -output node-universal
chmod 755 node-arm64 node-x64 node-universal

# Que de verdad tenga las dos: un `lipo` que "funciona" con dos binarios de la
# misma arquitectura falla, pero uno mal copiado no.
archs="$(lipo -archs node-universal)"
case "$archs" in
  *arm64*x86_64*|*x86_64*arm64*) ;;
  *) echo "node-universal tiene '$archs', no arm64 y x86_64." >&2; exit 1 ;;
esac

echo "NOXLOOP_SIDECAR_NODE_AARCH64=$SALIDA/node-arm64"
echo "NOXLOOP_SIDECAR_NODE_X86_64=$SALIDA/node-x64"
echo "NOXLOOP_SIDECAR_NODE_UNIVERSAL=$SALIDA/node-universal"
