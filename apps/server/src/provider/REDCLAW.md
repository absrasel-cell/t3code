# RedClaw provider foundation

This adapter targets the isolated RedClaw Client Dev BFF builder-session API at
`/v1/client-dev/builder/*`. It does not target redxtrm's existing one-shot
`/v1/client/execute` integration.

Runtime registration is fail-closed and requires all three server-only values:

- `T3_REDXTRM_CLIENT_DEV_ORIGIN` — HTTPS BFF origin. Loopback HTTP is accepted
  only outside production.
- `T3_REDXTRM_CLIENT_DEV_API_KEY` — BFF bearer credential.
- `T3_REDXTRM_CLIENT_DEV_AGENT_KEY` — allowlisted client agent key.

Optional bounded overrides are `T3_REDXTRM_CLIENT_DEV_TIMEOUT_MS` and
`T3_REDXTRM_CLIENT_DEV_MAX_RESPONSE_BYTES`.

Remote builder server mode uses `T3_APP_MODE=redxtrm-remote`. Ticket verification
uses the exact builder audience in `T3_REDXTRM_BUILDER_ORIGIN` plus the shared,
dedicated `T3_REDXTRM_BUILDER_TICKET_SECRET`. Those two values must match the
redxtrm dashboard issuer configuration. The ticket is accepted only through the
future POST exchange route; it must never be placed in a query string or log.

This is a protocol foundation, not a multi-tenant readiness claim. The current
T3 provider contract does not yet carry a consumed redxtrm builder ticket or
tenant/user/project identity into the adapter. The BFF endpoints must remain
unpublished until that authenticated identity binding is implemented and
verified. `ProviderRuntimeEvent` values are accepted only as already-sanitized
output from that BFF; raw GoClaw traces are not an acceptable response.
