#!/bin/sh
set -e

# Prisma records applied migrations in PostgreSQL table "_prisma_migrations".
# On each container start we apply any migrations shipped in the image that are not yet recorded there.
run_migrations() {
  case "${RUN_DB_MIGRATIONS:-1}" in
    0 | false | FALSE | no | NO | off | OFF) return 0 ;;
  esac

  if [ -z "${DATABASE_URL:-}" ]; then
    echo "docker-entrypoint: DATABASE_URL unset, skipping prisma migrate deploy"
    return 0
  fi

  echo "docker-entrypoint: applying pending prisma migrations (if any)..."
  cd /app
  if ! ./node_modules/.bin/prisma migrate deploy; then
    # P3009: a previous start recorded this migration as failed, so deploy refuses to continue.
    echo "docker-entrypoint: migrate deploy failed, retrying uiScale migration once..."
    ./node_modules/.bin/prisma migrate resolve --rolled-back 20261021120000_user_ui_scale || true
    ./node_modules/.bin/prisma migrate deploy
  fi
}

run_migrations
cd /app/apps/web
exec "$@"
