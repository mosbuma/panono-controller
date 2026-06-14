#!/bin/bash
set -euo pipefail

BUILD_ARGS=(--network=host)

if [[ "${NPM_CI_VERBOSE:-}" == "1" ]]; then
  echo "Verbose npm ci enabled (NPM_CI_VERBOSE=1) — logs show each package install."
  BUILD_ARGS+=(--progress=plain --no-cache --build-arg "NPM_CI_LOGLEVEL=verbose")
fi

echo "Building Panono Control Docker image (host networking for Synology DNS)..."
docker build "${BUILD_ARGS[@]}" -t panono-webapp:latest .

echo ""
echo "Build OK. Start with:"
echo "  docker compose up -d"
echo ""
