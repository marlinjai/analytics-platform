#!/bin/bash
# check-bundle-size.sh — Build the tracker and verify the gzipped bundle is <= 5KB.
#
# Exits 0 if within budget, exits 1 if the limit is exceeded.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACKER_DIR="${SCRIPT_DIR}/../packages/tracker"
BUNDLE_PATH="${TRACKER_DIR}/dist/index.js"
MAX_BYTES=5120  # 5 KB gzipped

echo "=== Tracker Bundle Size Check ==="
echo ""

# Build the tracker
echo "Building tracker..."
(cd "${TRACKER_DIR}" && pnpm build)

# Verify output file exists
if [ ! -f "${BUNDLE_PATH}" ]; then
  echo "ERROR: Bundle not found at ${BUNDLE_PATH}"
  exit 1
fi

# Measure raw size
RAW_BYTES=$(wc -c < "${BUNDLE_PATH}" | tr -d ' ')

# Measure gzipped size
GZIP_BYTES=$(gzip -c "${BUNDLE_PATH}" | wc -c | tr -d ' ')

RAW_KB=$(echo "scale=2; ${RAW_BYTES}/1024" | bc)
GZIP_KB=$(echo "scale=2; ${GZIP_BYTES}/1024" | bc)

echo "  Raw size:    ${RAW_BYTES} bytes (${RAW_KB} KB)"
echo "  Gzipped:     ${GZIP_BYTES} bytes (${GZIP_KB} KB)"
echo "  Budget:      ${MAX_BYTES} bytes (5.00 KB gzipped)"
echo ""

if [ "${GZIP_BYTES}" -gt "${MAX_BYTES}" ]; then
  echo "FAIL: Gzipped bundle (${GZIP_BYTES}B) exceeds the 5KB limit (${MAX_BYTES}B)."
  exit 1
fi

echo "PASS: Gzipped bundle is within the 5KB budget."
