#!/usr/bin/env bash
# Cross-platform issue sync lives in Node; Git Bash remains supported.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/issues.mjs" "$@"

