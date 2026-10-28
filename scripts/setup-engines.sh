#!/bin/sh
# Download Prisma 6.14.0 engine binaries with curl (this VM's npm/Node fetch
# through the egress proxy resets intermittently, but curl is reliable).
# Places them in prisma-engines/ and the libquery library where the CLI looks.
# Usage: sh scripts/setup-engines.sh
# Then export before running prisma commands:
#   PRISMA_SCHEMA_ENGINE_BINARY=$PWD/prisma-engines/schema-engine \
#   PRISMA_QUERY_ENGINE_BINARY=$PWD/prisma-engines/query-engine \
#   PRISMA_QUERY_ENGINE_LIBRARY=$PWD/prisma-engines/libquery_engine.so.node \
#   prisma validate|generate|migrate dev
set -eu
cd "$(dirname "$0")/.."
COMMIT=717184b7b35ea05dfa71a3236b7af656013e1e49
PLATFORM=debian-openssl-3.0.x
mkdir -p prisma-engines
for b in schema-engine query-engine; do
  if [ ! -x "prisma-engines/$b" ]; then
    curl -sL --retry 5 --retry-delay 3 \
      -o "prisma-engines/$b.gz" \
      "https://binaries.prisma.sh/all_commits/$COMMIT/$PLATFORM/$b.gz"
    gunzip -f "prisma-engines/$b.gz"
    chmod +x "prisma-engines/$b"
  fi
done
if [ ! -f prisma-engines/libquery_engine.so.node ]; then
  curl -sL --retry 5 --retry-delay 3 \
    -o prisma-engines/libquery_engine.so.node.gz \
    "https://binaries.prisma.sh/all_commits/$COMMIT/$PLATFORM/libquery_engine.so.node.gz"
  gunzip -f prisma-engines/libquery_engine.so.node.gz
fi
mkdir -p node_modules/@prisma/engines
cp prisma-engines/libquery_engine.so.node \
  node_modules/@prisma/engines/libquery_engine-debian-openssl-3.0.x.so.node 2>/dev/null || true
# After `prisma generate`, the runtime also needs the platform-suffixed name
# inside node_modules/.prisma/client (generate alone copies the plain name).
mkdir -p node_modules/.prisma/client
cp prisma-engines/libquery_engine.so.node \
  node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node 2>/dev/null || true
echo "Prisma engines ready in prisma-engines/"
