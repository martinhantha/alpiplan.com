#!/usr/bin/env bash
# Mark migrations already reflected in an existing DB (e.g. restored prod dump without
# "_prisma_migrations"), then apply only newer migrations. Does not delete rows.
set -euo pipefail
cd "$(dirname "$0")/.."

BASELINE_UNTIL="${1:-20261012200000_appointment_draft_reminder}"

echo "Baselining migrations up to and including: ${BASELINE_UNTIL}"
for dir in prisma/migrations/*/; do
  name="$(basename "$dir")"
  pnpm exec prisma migrate resolve --applied "$name"
  if [[ "$name" == "$BASELINE_UNTIL" ]]; then
    break
  fi
done

echo "Applying pending migrations (schema-only, data preserved)..."
pnpm exec prisma migrate deploy

echo "Done. Verify:"
pnpm exec prisma migrate status
