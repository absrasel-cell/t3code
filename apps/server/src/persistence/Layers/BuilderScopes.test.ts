import { AuthSessionId, type BuilderSessionScope, ProjectId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Result } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { BuilderScopeRepositoryLive } from "./BuilderScopes.ts";
import { BuilderScopeRepository } from "../Services/BuilderScopes.ts";

const projectId = ProjectId.make("redxtrm-scoped-project");
const threadId = ThreadId.make("redxtrm-scoped-thread");
const authSessionId = AuthSessionId.make("redxtrm-scoped-session");
const scope: BuilderSessionScope = {
  v: 1,
  handoffJti: "33333333-3333-4333-8333-333333333333",
  subject: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  tenantKey: "22222222-2222-4222-8222-222222222222",
  projectKey: "domain:client-example",
  role: "member",
};
const crossTenantScope: BuilderSessionScope = {
  ...scope,
  workspaceId: "44444444-4444-4444-8444-444444444444",
  tenantKey: "44444444-4444-4444-8444-444444444444",
};

const testLayer = BuilderScopeRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory));

const insertSession = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO auth_sessions (
      session_id, subject, role, method, issued_at, expires_at, builder_scope_json
    ) VALUES (
      ${authSessionId}, ${scope.subject}, 'client', 'browser-session-cookie',
      '2026-08-18T00:00:00.000Z', '2026-08-19T00:00:00.000Z', ${JSON.stringify(scope)}
    )
  `;
});

it.effect(
  "atomically binds immutable project and thread authority and rejects cross-tenant reuse",
  () =>
    Effect.gen(function* () {
      const scopes = yield* BuilderScopeRepository;
      yield* insertSession;

      expect(yield* scopes.bindProject({ projectId, scope })).toBe(true);
      expect(yield* scopes.bindProject({ projectId, scope: crossTenantScope })).toBe(false);
      expect(yield* scopes.bindThread({ threadId, projectId, authSessionId, scope })).toBe(true);
      expect(
        yield* scopes.bindThread({
          threadId,
          projectId,
          authSessionId,
          scope: crossTenantScope,
        }),
      ).toBe(false);

      const thread = yield* scopes.getThread(threadId);
      expect(Option.isSome(thread)).toBe(true);
      expect(yield* scopes.listThreadIds(scope)).toEqual([threadId]);
      expect(yield* scopes.listThreadIds(crossTenantScope)).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
);

it.effect("database triggers reject forged mutation of session, project, and thread scope", () =>
  Effect.gen(function* () {
    const scopes = yield* BuilderScopeRepository;
    const sql = yield* SqlClient.SqlClient;
    yield* insertSession;
    yield* scopes.bindProject({ projectId, scope });
    yield* scopes.bindThread({ threadId, projectId, authSessionId, scope });

    const sessionMutation = yield* Effect.result(
      sql`UPDATE auth_sessions SET builder_scope_json = ${JSON.stringify(crossTenantScope)} WHERE session_id = ${authSessionId}`,
    );
    const projectMutation = yield* Effect.result(
      sql`UPDATE builder_project_scopes SET builder_scope_json = ${JSON.stringify(crossTenantScope)} WHERE project_id = ${projectId}`,
    );
    const threadMutation = yield* Effect.result(
      sql`UPDATE builder_thread_scopes SET builder_scope_json = ${JSON.stringify(crossTenantScope)} WHERE thread_id = ${threadId}`,
    );

    expect(Result.isFailure(sessionMutation)).toBe(true);
    expect(Result.isFailure(projectMutation)).toBe(true);
    expect(Result.isFailure(threadMutation)).toBe(true);
  }).pipe(Effect.provide(testLayer)),
);
