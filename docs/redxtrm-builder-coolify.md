# RedXTRM Builder container and Coolify runbook

This runbook packages the T3 server and its compiled web client into one
container for `https://builder.redxtrm.com`. The production container runs in
the dedicated rootless Client Dev stack beside the private BFF. Coolify's
Traefik proxy publishes T3 only; the BFF keeps no host port.

Do not publish the builder until the POST handoff exchange, immutable
ticket-derived HTTP/WebSocket scope, BFF re-authorization, replay rejection, and
cross-tenant tests are all complete and independently reviewed.

## Image contract

| Surface           | Contract                                                         |
| ----------------- | ---------------------------------------------------------------- |
| Dockerfile        | Repository-root `Dockerfile`                                     |
| Process           | `dumb-init` -> entrypoint -> Node 24 by default                  |
| Alternate runtime | Set `T3_RUNTIME=bun` to run the same artifact with Bun 1.3.11    |
| Listener          | `0.0.0.0:3000` via `T3CODE_HOST` and `T3CODE_PORT`               |
| HTTP + WebSocket  | One origin and one container port; no separate Vite server       |
| Health            | `GET /api/health` returns the exact public JSON readiness marker |
| Persistent data   | Coolify volume mounted at `/var/lib/t3code`                      |
| Container user    | Unprivileged `node` user (uid/gid 1000 in the base image)        |
| Browser mode      | `redxtrm-remote`, compiled into the Vite bundle                  |

The image is multi-stage. Bun installs the monorepo using the pinned lockfile
and builds the web and server workspaces directly so Vite receives the declared
build arguments. The server build bundles `apps/web/dist` into
`apps/server/dist/client`, and the final image contains Node, Bun, production
dependencies, and the compiled server only. Node is the production default;
Bun is retained for compatibility and controlled fallback testing.

## Local build and smoke test

The Vite values are build-time configuration and must not contain secrets:

```bash
docker build \
  --build-arg VITE_APP_MODE=redxtrm-remote \
  --build-arg VITE_APP_BRAND_NAME="RedXTRM Builder" \
  --build-arg VITE_APP_STAGE_LABEL=Production \
  --build-arg VITE_REMOTE_BUILDER_CAPABILITIES=conversations,diffs,usage \
  --tag redxtrm-builder:local \
  .
```

Use a temporary, non-production environment file copied from
`deploy/redxtrm-builder/.env.example`, then replace its placeholders outside
Git. Do not pass secrets as Docker build arguments.

```bash
docker volume create redxtrm-builder-data
docker run --rm \
  --name redxtrm-builder \
  --env-file /path/outside/repository/redxtrm-builder.env \
  --mount type=volume,src=redxtrm-builder-data,dst=/var/lib/t3code \
  --publish 3000:3000 \
  redxtrm-builder:local
```

Verify the compiled client and health endpoint:

```bash
curl --fail --show-error http://127.0.0.1:3000/
curl --fail --show-error http://127.0.0.1:3000/api/health
docker inspect --format '{{json .State.Health}}' redxtrm-builder
```

The health check requires HTTP 200, `application/json`, and exactly these two
fields (key ordering does not matter):

```json
{ "status": "ok", "mode": "redxtrm-remote" }
```

It intentionally fails on a revision that does not yet provide the dedicated
route. T3's static fallback can return the SPA HTML with HTTP 200 for an unknown
path, so status alone is not a readiness check. The container must not be
promoted until the route is present and returns the marker only after the
HTTP/WebSocket server is ready.

## Rootless stack and Coolify edge

Do not create the builder inside the `redxtrm-web` application and do not expose
the Client Dev BFF. Build a commit-pinned image with the guarded Client Dev
release script, then start it through the rootless stack's `builder` profile.
The builder joins only the internal `control` network and reaches the BFF as
`http://bff:8080`; that private HTTP exception requires
`T3_REDXTRM_CLIENT_DEV_ALLOW_PRIVATE_HTTP=1` and is rejected for any other
origin.

Configure:

1. Image: `redxtrm-t3-builder:<exact 40-character Git commit>` built by the
   guarded rootless release script.
2. Container port: `3000`, bound only on the reviewed host bridge address used
   by Coolify's proxy.
3. Health path: `/api/health` with the exact JSON contract required.
4. Domain: `https://builder.redxtrm.com`, routed by a dedicated dynamic Traefik
   file to the builder host bind.
5. Persistent storage: the rootless stack's dedicated volume mounted at
   `/var/lib/t3code`.
6. Runtime variables: the values in
   `deploy/redxtrm-builder/.env.example`, stored in the root-owned, mode-0600
   Client Dev stack environment rather than Git or Coolify.
7. Build arguments: the non-secret `VITE_*` values from the local build
   example. Do not add BFF keys or ticket secrets as build arguments.

The dashboard ticket secret must byte-match the T3 ticket secret. The BFF scope
secret is a separate value shared only by T3 and the BFF. The browser never
receives either secret. Production pins `CLIENT_DEV_BFF_AGENT_KEY` to the
no-secret `client-dev-orchestrator` frontman; project builders receive scoped
SecureCLI grants only through the private team delegation path.

The mounted data directory must remain writable by uid/gid 1000. Empty named
volumes inherit the image directory ownership; verify ownership explicitly when
using an existing or bind-mounted path.

The entrypoint refuses to start when a required ticket or Client Dev BFF value
is empty and reports variable names only. The application performs the detailed
origin, length, and protocol validation; never print a failing value while
diagnosing configuration.

Coolify's proxy must forward HTTP/1.1 WebSocket upgrades on the same origin and
must not strip `Upgrade` or `Connection` headers. Do not rewrite `/api`, the
WebSocket route, `/.well-known`, `/attachments`, or `/pair`. Disable proxy/CDN
caching for authenticated HTML, API, pairing, and WebSocket traffic.

When Cloudflare proxies the hostname, keep end-to-end TLS in Full (strict) mode
with a valid certificate at the Coolify origin. A Cloudflare 526 response means
the origin certificate is not currently trusted; repair that certificate before
testing handoff or WebSocket behavior. Do not weaken TLS mode as a release fix.

## Runtime boundaries

- `T3CODE_HOME=/var/lib/t3code` is the only persisted T3 state location. A
  deploy without the mapped volume can lose sessions, ticket-consumption state,
  attachments, logs, and environment identity.
- `T3CODE_HOST=0.0.0.0` is required inside the container. Public exposure is
  controlled by Coolify's proxy, not by binding the process to loopback.
- `T3CODE_PORT` must match Coolify's configured container port. The Docker
  health check reads this value.
- `T3_APP_MODE=redxtrm-remote` is mandatory. Do not publish a local-mode image.
- `T3CODE_TELEMETRY_ENABLED=false` keeps client-builder activity out of T3's
  default third-party analytics sink. Enable only a separately reviewed,
  client-safe observability path.
- `T3CODE_LOG_LEVEL=Warn` prevents the upstream Info-level startup pairing URL
  from entering platform logs. Remote mode must also disable generic T3 pairing
  issuance and routes in source; log filtering is only defense in depth.
- Terminal remains disabled. A Vite capability flag is not authorization to
  expose a host PTY or an unproven sandbox broker.
- Remote persistence and every HTTP/WebSocket projection are bound to the
  immutable ticket-derived tenant, project, user, and browser session. Do not
  weaken those bindings to recover a failed handoff.
- The handoff ticket is accepted only in a credential-free POST body. Never put
  it in a query string, URL fragment, redirect log, or proxy access log.

## Release verification

A Git push is not a deployment. For the exact intended commit, require all of
the following before reporting success:

1. full repository format, lint, typecheck, focused security tests, and
   production container build pass;
2. Coolify deployment reaches a terminal successful state for the exact commit;
3. exactly one current container is running and healthy;
4. `/`, `/pair`, `/.well-known/t3/environment`, and `/api/health` return the
   expected statuses through `https://builder.redxtrm.com`;
5. a real WebSocket connection upgrades and authenticates through the public
   hostname;
6. one-time ticket redemption succeeds once, replay fails, expiry fails, and a
   forged or cross-tenant scope fails;
7. the browser receives only the assigned tenant/project/user scope and the BFF
   repeats that authorization on each RedClaw operation; and
8. the preceding healthy image remains available for an explicitly authorized
   rollback.

Do not activate DNS, push a production branch, change Coolify, deploy, or roll
back without explicit owner authorization for that exact action.
