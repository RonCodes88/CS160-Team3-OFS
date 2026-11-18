#!/bin/sh
set -eu

# A bind mount replaces the image's manifests. The anonymous dependency volume
# can survive a rebuild, so synchronize it before starting Next or running tests.
if ! sha256sum --check --status node_modules/.ofs-dependencies.sha256 2>/dev/null; then
  echo "Installing dependencies for the current package-lock.json..."
  npm ci
  sha256sum package.json package-lock.json > node_modules/.ofs-dependencies.sha256
fi

exec "$@"
