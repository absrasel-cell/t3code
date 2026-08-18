#!/bin/sh
set -eu

case "${T3_RUNTIME:-node}" in
  node | bun)
    runtime="${T3_RUNTIME:-node}"
    ;;
  *)
    echo "T3_RUNTIME must be 'node' or 'bun'." >&2
    exit 64
    ;;
esac

missing_variables=""
for variable_name in \
  T3_REDXTRM_BUILDER_ORIGIN \
  T3_REDXTRM_BUILDER_TICKET_SECRET \
  T3_REDXTRM_DASHBOARD_ORIGIN \
  T3_REDXTRM_CLIENT_DEV_ORIGIN \
  T3_REDXTRM_CLIENT_DEV_API_KEY \
  T3_REDXTRM_CLIENT_DEV_AGENT_KEY \
  T3_REDXTRM_CLIENT_DEV_SCOPE_SECRET; do
  if [ -z "$(printenv "$variable_name" 2>/dev/null || true)" ]; then
    missing_variables="$missing_variables $variable_name"
  fi
done

if [ -n "$missing_variables" ]; then
  echo "Missing required RedXTRM Builder environment variables:$missing_variables" >&2
  exit 78
fi

exec "$runtime" /app/apps/server/dist/bin.mjs start "$@"
