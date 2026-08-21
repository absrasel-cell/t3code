import { AuthSessionId, BuilderSessionScope, ProjectId, ThreadId } from "@t3tools/contracts";
import { DateTime, Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  BuilderScopeRepository,
  type BuilderScopeRepositoryError,
  type BuilderScopeRepositoryShape,
} from "../Services/BuilderScopes.ts";
import { sameBuilderAuthority } from "../../builderSessionScope.ts";

const ScopeJson = Schema.fromJsonString(BuilderSessionScope);
const ProjectRow = Schema.Struct({
  projectId: ProjectId,
  scope: ScopeJson,
  createdAt: Schema.DateTimeUtcFromString,
});
const ThreadRow = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  authSessionId: AuthSessionId,
  scope: ScopeJson,
  createdAt: Schema.DateTimeUtcFromString,
});

const ProjectLookup = Schema.Struct({ projectId: ProjectId });
const ThreadLookup = Schema.Struct({ threadId: ThreadId });

function toRepositoryError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): BuilderScopeRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeBuilderScopeRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const getProjectRow = SqlSchema.findOneOption({
    Request: ProjectLookup,
    Result: ProjectRow,
    execute: ({ projectId }) => sql`
      SELECT project_id AS "projectId", builder_scope_json AS "scope", created_at AS "createdAt"
      FROM builder_project_scopes
      WHERE project_id = ${projectId}
    `,
  });
  const getThreadRow = SqlSchema.findOneOption({
    Request: ThreadLookup,
    Result: ThreadRow,
    execute: ({ threadId }) => sql`
      SELECT
        thread_id AS "threadId",
        project_id AS "projectId",
        auth_session_id AS "authSessionId",
        builder_scope_json AS "scope",
        created_at AS "createdAt"
      FROM builder_thread_scopes
      WHERE thread_id = ${threadId}
    `,
  });
  const listThreadRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ThreadRow,
    execute: () => sql`
      SELECT
        thread_id AS "threadId",
        project_id AS "projectId",
        auth_session_id AS "authSessionId",
        builder_scope_json AS "scope",
        created_at AS "createdAt"
      FROM builder_thread_scopes
      ORDER BY thread_id ASC
    `,
  });

  const getProject: BuilderScopeRepositoryShape["getProject"] = (projectId) =>
    getProjectRow({ projectId }).pipe(
      Effect.mapError(
        toRepositoryError("BuilderScopeRepository.getProject", "BuilderScopeRepository.getProject"),
      ),
    );

  const getThread: BuilderScopeRepositoryShape["getThread"] = (threadId) =>
    getThreadRow({ threadId }).pipe(
      Effect.mapError(
        toRepositoryError("BuilderScopeRepository.getThread", "BuilderScopeRepository.getThread"),
      ),
    );

  const bindProject: BuilderScopeRepositoryShape["bindProject"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const createdAt = yield* DateTime.now;
          const createdAtIso = DateTime.formatIso(createdAt);
          yield* sql`
            INSERT INTO builder_project_scopes (project_id, builder_scope_json, created_at)
            VALUES (${input.projectId}, ${JSON.stringify(input.scope)}, ${createdAtIso})
            ON CONFLICT(project_id) DO NOTHING
          `;
          const existing = yield* getProjectRow({ projectId: input.projectId });
          return Option.isSome(existing) && sameBuilderAuthority(existing.value.scope, input.scope);
        }),
      )
      .pipe(
        Effect.mapError(
          toRepositoryError(
            "BuilderScopeRepository.bindProject",
            "BuilderScopeRepository.bindProject",
          ),
        ),
      );

  const bindThread: BuilderScopeRepositoryShape["bindThread"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const project = yield* getProjectRow({ projectId: input.projectId });
          if (Option.isNone(project) || !sameBuilderAuthority(project.value.scope, input.scope)) {
            return false;
          }
          const createdAt = yield* DateTime.now;
          const createdAtIso = DateTime.formatIso(createdAt);
          yield* sql`
            INSERT INTO builder_thread_scopes (
              thread_id, project_id, auth_session_id, builder_scope_json, created_at
            )
            VALUES (
              ${input.threadId}, ${input.projectId}, ${input.authSessionId},
              ${JSON.stringify(input.scope)}, ${createdAtIso}
            )
            ON CONFLICT(thread_id) DO NOTHING
          `;
          const existing = yield* getThreadRow({ threadId: input.threadId });
          return (
            Option.isSome(existing) &&
            existing.value.projectId === input.projectId &&
            existing.value.authSessionId === input.authSessionId &&
            sameBuilderAuthority(existing.value.scope, input.scope)
          );
        }),
      )
      .pipe(
        Effect.mapError(
          toRepositoryError(
            "BuilderScopeRepository.bindThread",
            "BuilderScopeRepository.bindThread",
          ),
        ),
      );

  const listThreadIds: BuilderScopeRepositoryShape["listThreadIds"] = (scope) =>
    listThreadRows().pipe(
      Effect.map((rows) =>
        rows.filter((row) => sameBuilderAuthority(row.scope, scope)).map((row) => row.threadId),
      ),
      Effect.mapError(
        toRepositoryError(
          "BuilderScopeRepository.listThreadIds",
          "BuilderScopeRepository.listThreadIds",
        ),
      ),
    );

  return {
    bindProject,
    bindThread,
    getProject,
    getThread,
    listThreadIds,
  } satisfies BuilderScopeRepositoryShape;
});

export const BuilderScopeRepositoryLive = Layer.effect(
  BuilderScopeRepository,
  makeBuilderScopeRepository,
);
