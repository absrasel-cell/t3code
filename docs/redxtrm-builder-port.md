# RedXTRM Builder port

Status: foundation implemented and locally verified. This branch is not safe to
deploy to clients until the remaining ticket-bound session gates are complete.

## Objective

Reuse T3 Code's conversation, plan, diff, reconnect, and terminal presentation
inside a RedXTRM-branded builder while keeping authentication, tenant scope,
agent execution, secrets, repositories, terminals, previews, and usage behind
the isolated Client Dev control plane.

The T3 web application is the cockpit. It is not the authorization boundary.

## Required trust flow

```text
authenticated redxtrm browser
  -> redxtrm server issues a short-lived builder handoff ticket
  -> builder consumes the ticket once and binds its immutable scope
  -> T3 websocket session inherits that bound scope
  -> RedClaw adapter forwards the bound scope to the Client Dev BFF
  -> BFF re-authorizes every project operation
  -> isolated RedClaw agents and project sandbox
```

The handoff ticket must never appear in a query string or log. The builder
accepts it in a POST body, verifies its protected header and closed claims,
atomically consumes its `jti`, and only then creates a session.

Until T3 has tenant-aware persistence, a redeemed ticket must map to one
single-tenant builder process or container. A process may not be re-scoped or
shared between tenants. Process isolation is defense in depth, not a substitute
for the BFF re-authorizing the ticket-derived tenant and project on every call.

## Foundation implemented on this branch

- RedClaw is represented as a typed provider/model contract.
- The RedClaw server adapter uses bounded, schema-validated HTTP responses and
  is absent when its server-only configuration is invalid or incomplete.
- A RedXTRM remote-builder UI mode provides dedicated branding and capability
  presentation without changing local T3 defaults.
- Remote mode hard-disables the existing terminal UI. A build-time capability
  flag is not allowed to attest that a sandbox broker exists.
- The redxtrm application issues a separate short-lived, one-time-intended
  builder ticket from authenticated membership scope.
- T3 verifies that ticket with a closed HS256 v1 contract and atomically
  consumes its `jti` in durable SQLite storage; concurrent redemption tests
  allow exactly one winner.
- Server-side remote mode registers and exposes only RedClaw. Invalid RedClaw
  configuration leaves the remote provider unavailable rather than falling
  back to a host-local coding provider.
- Direct remote WebSocket calls are denied for host terminal, Git, workspace
  browse/write, editor launch, provider refresh, keybinding, and server-settings
  mutations. Config and settings reads are projected through a path- and
  secret-sanitizing remote view.

These pieces are deliberately inactive as a production path until all P0 gates
below are complete.

## Local-machine surfaces that are forbidden in remote mode

Remote mode must reject these on the server even if a modified client calls the
WebSocket RPC directly:

- host PTY open, write, restart, and close;
- host Git and GitHub CLI mutations;
- local workspace reads or writes outside the assigned sandbox projection;
- open-in-editor and other desktop shell operations;
- process-global settings and provider mutations; and
- T3 pairing flows that are not derived from a consumed redxtrm handoff.

Hiding buttons is not an authorization control. The existing local T3
implementations remain valid for local mode, but they must not be registered as
remote-builder RPC handlers.

## RedClaw adapter boundary

The adapter targets the isolated Client Dev BFF, not the public redxtrm Next.js
application and not an owner/CAP RedClaw instance. Its credentials are
server-only and dedicated to this service.

Every mutation needs an idempotency identity. Every session, turn, event,
approval, diff, usage record, and preview must match the immutable tenant,
project, user, thread, and request scope derived from the consumed ticket. The
BFF returns only closed client-safe events; raw traces, prompts, tool payloads,
credentials, host paths, provider payloads, and internal agent identifiers are
not valid adapter input.

## P0 release gates

1. A dedicated POST exchange endpoint that atomically creates a T3 `client`
   session and immutable session-scope row after consuming the ticket.
2. Ticket-derived tenant/project/user scope loaded during HTTP and WebSocket
   authentication and forwarded on every RedClaw call.
3. Tenant-scoped orchestration persistence, snapshots, thread streams, and
   lifecycle/auth streams, including cross-tenant negative tests.
4. BFF scope re-authorization and cross-tenant negative tests.
5. A trusted sandbox terminal broker before any terminal capability can be
   advertised or enabled.
6. Mutation idempotency and ambiguous-timeout tests at the BFF boundary.
7. Exact usage correlation and approval enforcement.
8. Authenticated browser E2E plus an independent security review.

## Next vertical slice

The next runnable slice is intentionally narrow:

1. expose the existing strict ticket consumer through a credential-free POST
   body exchange;
2. atomically create one T3 `client` session plus immutable scope row;
3. load that scope on WebSocket authentication and constrain orchestration
   reads/writes to it;
4. forward the same scope on every RedClaw BFF request;
5. send one idempotent turn and stream sanitized assistant/activity events; and
6. close the session and prove replay and cross-tenant access both fail.

Terminal execution, repository writes, previews, and deployment remain disabled
until their separate brokers and approval gates are proven.
