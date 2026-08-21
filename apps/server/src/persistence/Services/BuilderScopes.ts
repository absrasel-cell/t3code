import { AuthSessionId, BuilderSessionScope, ProjectId, ThreadId } from "@t3tools/contracts";
import { Context, Option, Schema } from "effect";
import type { Effect } from "effect";

import type { PersistenceDecodeError, PersistenceSqlError } from "../Errors.ts";

export const BuilderProjectScopeBinding = Schema.Struct({
  projectId: ProjectId,
  scope: BuilderSessionScope,
  createdAt: Schema.DateTimeUtcFromString,
});
export type BuilderProjectScopeBinding = typeof BuilderProjectScopeBinding.Type;

export const BuilderThreadScopeBinding = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  authSessionId: AuthSessionId,
  scope: BuilderSessionScope,
  createdAt: Schema.DateTimeUtcFromString,
});
export type BuilderThreadScopeBinding = typeof BuilderThreadScopeBinding.Type;

export type BuilderScopeRepositoryError = PersistenceSqlError | PersistenceDecodeError;

export interface BuilderScopeRepositoryShape {
  readonly bindProject: (input: {
    readonly projectId: ProjectId;
    readonly scope: BuilderSessionScope;
  }) => Effect.Effect<boolean, BuilderScopeRepositoryError>;
  readonly bindThread: (input: {
    readonly threadId: ThreadId;
    readonly projectId: ProjectId;
    readonly authSessionId: AuthSessionId;
    readonly scope: BuilderSessionScope;
  }) => Effect.Effect<boolean, BuilderScopeRepositoryError>;
  readonly getProject: (
    projectId: ProjectId,
  ) => Effect.Effect<Option.Option<BuilderProjectScopeBinding>, BuilderScopeRepositoryError>;
  readonly getThread: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<BuilderThreadScopeBinding>, BuilderScopeRepositoryError>;
  readonly listThreadIds: (
    scope: BuilderSessionScope,
  ) => Effect.Effect<ReadonlyArray<ThreadId>, BuilderScopeRepositoryError>;
}

export class BuilderScopeRepository extends Context.Service<
  BuilderScopeRepository,
  BuilderScopeRepositoryShape
>()("t3/persistence/Services/BuilderScopes/BuilderScopeRepository") {}
