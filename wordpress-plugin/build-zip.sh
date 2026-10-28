#!/bin/sh
# Builds a standard installable plugin ZIP from the source directory.
# Usage: ./build-zip.sh [output-path]
# Default output is /tmp/wp-doctor-ai-connector.zip (a build artifact,
# never the source of truth — always rebuild from this directory).
set -e
OUT="${1:-/tmp/wp-doctor-ai-connector.zip}"
DIR="$(cd "$(dirname "$0")" && pwd)"
rm -f "$OUT"
(cd "$DIR" && zip -r "$OUT" wp-doctor-ai-connector -x "*/.DS_Store" >/dev/null)
echo "Built: $OUT"
