#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_TAG="${1:-taesks:local}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker CLI is not installed or not on PATH." >&2
  exit 127
fi

echo "Building ${IMAGE_TAG} from ${SCRIPT_DIR}"
docker build --tag "${IMAGE_TAG}" "${SCRIPT_DIR}"
