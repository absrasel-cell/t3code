import { Cause, Duration, Effect, Layer, Option, Queue, Ref, Schema, Stream } from "effect";
import {
  type AuthAccessStreamEvent,
  AuthSessionId,
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  EventId,
  type BuilderSessionScope,
  type OrchestrationCommand,
  type GitActionProgressEvent,
  type GitManagerServiceError,
  KeybindingsConfigError,
  OrchestrationDispatchCommandError,
  type OrchestrationEvent,
  type OrchestrationShellStreamEvent,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  ORCHESTRATION_WS_METHODS,
  ProjectSearchEntriesError,
  type ProjectId,
  ProjectWriteFileError,
  ServerSettingsError,
  OrchestrationReplayEventsError,
  FilesystemBrowseError,
  ThreadId,
  type TerminalEvent,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import { clamp } from "effect/Number";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery.ts";
import { ServerConfig } from "./config.ts";
import { GitCore } from "./git/Services/GitCore.ts";
import { GitManager } from "./git/Services/GitManager.ts";
import { GitStatusBroadcaster } from "./git/Services/GitStatusBroadcaster.ts";
import { Keybindings } from "./keybindings.ts";
import { Open, resolveAvailableEditors } from "./open.ts";
import { normalizeDispatchCommand } from "./orchestration/Normalizer.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  observeRpcEffect,
  observeRpcStream,
  observeRpcStreamEffect,
} from "./observability/RpcInstrumentation.ts";
import { ProviderRegistry } from "./provider/Services/ProviderRegistry.ts";
import { ServerLifecycleEvents } from "./serverLifecycleEvents.ts";
import { ServerRuntimeStartup } from "./serverRuntimeStartup.ts";
import { ServerSettingsService } from "./serverSettings.ts";
import { TerminalManager } from "./terminal/Services/Manager.ts";
import { WorkspaceEntries } from "./workspace/Services/WorkspaceEntries.ts";
import { WorkspaceFileSystem } from "./workspace/Services/WorkspaceFileSystem.ts";
import { WorkspacePathOutsideRootError } from "./workspace/Services/WorkspacePaths.ts";
import { ProjectSetupScriptRunner } from "./project/Services/ProjectSetupScriptRunner.ts";
import { RepositoryIdentityResolver } from "./project/Services/RepositoryIdentityResolver.ts";
import { ServerEnvironment } from "./environment/Services/ServerEnvironment.ts";
import { ServerAuth } from "./auth/Services/ServerAuth.ts";
import type { AuthenticatedSession } from "./auth/Services/ServerAuth.ts";
import {
  BootstrapCredentialService,
  type BootstrapCredentialChange,
} from "./auth/Services/BootstrapCredentialService.ts";
import {
  SessionCredentialService,
  type SessionCredentialChange,
} from "./auth/Services/SessionCredentialService.ts";
import { respondToAuthError } from "./auth/http.ts";
import { guardRemoteBuilderEffect, guardRemoteBuilderStream } from "./remoteBuilderGuard.ts";
import { isRemoteBuilderMode, resolveServerAppModeFromEnv } from "./remoteBuilderMode.ts";
import { enforceRemoteBuilderCommandPolicy } from "./remoteBuilderRuntime.ts";
import {
  exposeServerConfigForMode,
  exposeServerSettingsForMode,
  sanitizeRemoteBuilderProviders,
} from "./remoteBuilderSanitizer.ts";
import { BuilderScopeRepository } from "./persistence/Services/BuilderScopes.ts";
import { builderProjectId, sameBuilderAuthority } from "./builderSessionScope.ts";

function isThreadDetailEvent(event: OrchestrationEvent): event is Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.message-sent"
      | "thread.proposed-plan-upserted"
      | "thread.activity-appended"
      | "thread.turn-diff-completed"
      | "thread.reverted"
      | "thread.session-set";
  }
> {
  return (
    event.type === "thread.message-sent" ||
    event.type === "thread.proposed-plan-upserted" ||
    event.type === "thread.activity-appended" ||
    event.type === "thread.turn-diff-completed" ||
    event.type === "thread.reverted" ||
    event.type === "thread.session-set"
  );
}

const PROVIDER_STATUS_DEBOUNCE_MS = 200;

function toAuthAccessStreamEvent(
  change: BootstrapCredentialChange | SessionCredentialChange,
  revision: number,
  currentSessionId: AuthSessionId,
): AuthAccessStreamEvent {
  switch (change.type) {
    case "pairingLinkUpserted":
      return {
        version: 1,
        revision,
        type: "pairingLinkUpserted",
        payload: change.pairingLink,
      };
    case "pairingLinkRemoved":
      return {
        version: 1,
        revision,
        type: "pairingLinkRemoved",
        payload: { id: change.id },
      };
    case "clientUpserted":
      return {
        version: 1,
        revision,
        type: "clientUpserted",
        payload: {
          ...change.clientSession,
          current: change.clientSession.sessionId === currentSessionId,
        },
      };
    case "clientRemoved":
      return {
        version: 1,
        revision,
        type: "clientRemoved",
        payload: { sessionId: change.sessionId },
      };
  }
}

const makeWsRpcLayer = (authenticatedSession: AuthenticatedSession) =>
  WsRpcGroup.toLayer(
    Effect.gen(function* () {
      const appMode = resolveServerAppModeFromEnv();
      const currentSessionId = authenticatedSession.sessionId;
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
      const orchestrationEngine = yield* OrchestrationEngineService;
      const checkpointDiffQuery = yield* CheckpointDiffQuery;
      const keybindings = yield* Keybindings;
      const open = yield* Open;
      const gitManager = yield* GitManager;
      const git = yield* GitCore;
      const gitStatusBroadcaster = yield* GitStatusBroadcaster;
      const terminalManager = yield* TerminalManager;
      const providerRegistry = yield* ProviderRegistry;
      const config = yield* ServerConfig;
      const lifecycleEvents = yield* ServerLifecycleEvents;
      const serverSettings = yield* ServerSettingsService;
      const startup = yield* ServerRuntimeStartup;
      const workspaceEntries = yield* WorkspaceEntries;
      const workspaceFileSystem = yield* WorkspaceFileSystem;
      const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;
      const repositoryIdentityResolver = yield* RepositoryIdentityResolver;
      const serverEnvironment = yield* ServerEnvironment;
      const serverAuth = yield* ServerAuth;
      const bootstrapCredentials = yield* BootstrapCredentialService;
      const sessions = yield* SessionCredentialService;
      const builderScopes = yield* BuilderScopeRepository;
      const remoteBuilderScope = isRemoteBuilderMode(appMode)
        ? authenticatedSession.builderScope
        : undefined;
      const expectedBuilderProjectId = remoteBuilderScope
        ? builderProjectId(remoteBuilderScope)
        : undefined;
      const serverCommandId = (tag: string) =>
        CommandId.make(`server:${tag}:${crypto.randomUUID()}`);

      const loadAuthAccessSnapshot = () =>
        Effect.all({
          pairingLinks: serverAuth.listPairingLinks().pipe(Effect.orDie),
          clientSessions: serverAuth.listClientSessions(currentSessionId).pipe(Effect.orDie),
        });

      const appendSetupScriptActivity = (input: {
        readonly threadId: ThreadId;
        readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
        readonly summary: string;
        readonly createdAt: string;
        readonly payload: Record<string, unknown>;
        readonly tone: "info" | "error";
      }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId: serverCommandId("setup-script-activity"),
          threadId: input.threadId,
          activity: {
            id: EventId.make(crypto.randomUUID()),
            tone: input.tone,
            kind: input.kind,
            summary: input.summary,
            payload: input.payload,
            turnId: null,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        });

      const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
        Schema.is(OrchestrationDispatchCommandError)(cause)
          ? cause
          : new OrchestrationDispatchCommandError({
              message: cause instanceof Error ? cause.message : fallbackMessage,
              cause,
            });

      const builderScopeDenial = (message: string, cause?: unknown) =>
        new OrchestrationDispatchCommandError({
          message,
          ...(cause === undefined ? {} : { cause }),
        });

      const requireRemoteBuilderScope = (): Effect.Effect<
        BuilderSessionScope,
        OrchestrationDispatchCommandError
      > =>
        remoteBuilderScope
          ? Effect.succeed(remoteBuilderScope)
          : Effect.fail(
              builderScopeDenial("This builder session has no authorized project scope."),
            );

      const authorizeBuilderProject = (
        projectId: ProjectId,
      ): Effect.Effect<void, OrchestrationDispatchCommandError> => {
        if (!isRemoteBuilderMode(appMode)) return Effect.void;
        return Effect.gen(function* () {
          const scope = yield* requireRemoteBuilderScope();
          if (projectId !== expectedBuilderProjectId) {
            return yield* builderScopeDenial(
              "Project access is outside this builder session scope.",
            );
          }
          const binding = yield* builderScopes
            .getProject(projectId)
            .pipe(
              Effect.mapError((cause) =>
                builderScopeDenial("Unable to authorize the builder project scope.", cause),
              ),
            );
          if (Option.isNone(binding) || !sameBuilderAuthority(binding.value.scope, scope)) {
            return yield* builderScopeDenial(
              "Project access is outside this builder session scope.",
            );
          }
        });
      };

      const bindBuilderProject = (
        projectId: ProjectId,
      ): Effect.Effect<void, OrchestrationDispatchCommandError> => {
        if (!isRemoteBuilderMode(appMode)) return Effect.void;
        return Effect.gen(function* () {
          const scope = yield* requireRemoteBuilderScope();
          if (projectId !== expectedBuilderProjectId) {
            return yield* builderScopeDenial(
              "Project access is outside this builder session scope.",
            );
          }
          const bound = yield* builderScopes
            .bindProject({ projectId, scope })
            .pipe(
              Effect.mapError((cause) =>
                builderScopeDenial("Unable to bind the builder project scope.", cause),
              ),
            );
          if (!bound) {
            return yield* builderScopeDenial(
              "Project access is outside this builder session scope.",
            );
          }
        });
      };

      const authorizeBuilderThread = (
        threadId: ThreadId,
      ): Effect.Effect<void, OrchestrationDispatchCommandError> => {
        if (!isRemoteBuilderMode(appMode)) return Effect.void;
        return Effect.gen(function* () {
          const scope = yield* requireRemoteBuilderScope();
          const binding = yield* builderScopes
            .getThread(threadId)
            .pipe(
              Effect.mapError((cause) =>
                builderScopeDenial("Unable to authorize the builder thread scope.", cause),
              ),
            );
          if (
            Option.isNone(binding) ||
            binding.value.projectId !== expectedBuilderProjectId ||
            !sameBuilderAuthority(binding.value.scope, scope)
          ) {
            return yield* builderScopeDenial(
              "Thread access is outside this builder session scope.",
            );
          }
        });
      };

      const bindBuilderThread = (
        threadId: ThreadId,
        projectId: ProjectId,
      ): Effect.Effect<void, OrchestrationDispatchCommandError> => {
        if (!isRemoteBuilderMode(appMode)) return Effect.void;
        return Effect.gen(function* () {
          const scope = yield* requireRemoteBuilderScope();
          yield* authorizeBuilderProject(projectId);
          const bound = yield* builderScopes
            .bindThread({
              threadId,
              projectId,
              authSessionId: currentSessionId,
              scope,
            })
            .pipe(
              Effect.mapError((cause) =>
                builderScopeDenial("Unable to bind the builder thread scope.", cause),
              ),
            );
          if (!bound) {
            return yield* builderScopeDenial(
              "Thread access is outside this builder session scope.",
            );
          }
        });
      };

      const authorizeBuilderCommand = (
        command: OrchestrationCommand,
      ): Effect.Effect<void, OrchestrationDispatchCommandError> => {
        if (!isRemoteBuilderMode(appMode)) return Effect.void;
        switch (command.type) {
          case "project.create":
            return bindBuilderProject(command.projectId);
          case "project.meta.update":
          case "project.delete":
            return authorizeBuilderProject(command.projectId);
          case "thread.create":
            return bindBuilderThread(command.threadId, command.projectId);
          case "thread.turn.start":
            return command.bootstrap?.createThread
              ? bindBuilderThread(command.threadId, command.bootstrap.createThread.projectId)
              : authorizeBuilderThread(command.threadId);
          default:
            return authorizeBuilderThread(command.threadId);
        }
      };

      const isAuthorizedBuilderEvent = (
        event: OrchestrationEvent,
      ): Effect.Effect<boolean, never> => {
        if (!isRemoteBuilderMode(appMode)) return Effect.succeed(true);
        if (!remoteBuilderScope || !expectedBuilderProjectId) return Effect.succeed(false);
        if (event.aggregateKind === "project") {
          return Effect.succeed(event.aggregateId === expectedBuilderProjectId);
        }
        return builderScopes.getThread(ThreadId.make(event.aggregateId)).pipe(
          Effect.map(
            Option.match({
              onNone: () => false,
              onSome: (binding) =>
                binding.projectId === expectedBuilderProjectId &&
                sameBuilderAuthority(binding.scope, remoteBuilderScope),
            }),
          ),
          Effect.catch((cause) =>
            Effect.logWarning("failed to authorize remote builder orchestration event", {
              cause,
            }).pipe(Effect.as(false)),
          ),
        );
      };

      const filterBuilderShellSnapshot = <
        Snapshot extends {
          readonly projects: ReadonlyArray<{ readonly id: ProjectId }>;
          readonly threads: ReadonlyArray<{ readonly id: ThreadId; readonly projectId: ProjectId }>;
        },
      >(
        snapshot: Snapshot,
      ): Effect.Effect<Snapshot, OrchestrationGetSnapshotError> => {
        if (!isRemoteBuilderMode(appMode)) return Effect.succeed(snapshot);
        if (!remoteBuilderScope || !expectedBuilderProjectId) {
          return Effect.fail(
            new OrchestrationGetSnapshotError({
              message: "This builder session has no authorized project scope.",
              cause: currentSessionId,
            }),
          );
        }
        return builderScopes.listThreadIds(remoteBuilderScope).pipe(
          Effect.map((threadIds) => {
            const allowedThreads = new Set<ThreadId>(threadIds);
            return {
              ...snapshot,
              projects: snapshot.projects.filter(
                (project) => project.id === expectedBuilderProjectId,
              ),
              threads: snapshot.threads.filter(
                (thread) =>
                  thread.projectId === expectedBuilderProjectId && allowedThreads.has(thread.id),
              ),
            } as Snapshot;
          }),
          Effect.mapError(
            (cause) =>
              new OrchestrationGetSnapshotError({
                message: "Unable to authorize the builder shell snapshot.",
                cause,
              }),
          ),
        );
      };

      const toBootstrapDispatchCommandCauseError = (cause: Cause.Cause<unknown>) => {
        const error = Cause.squash(cause);
        return Schema.is(OrchestrationDispatchCommandError)(error)
          ? error
          : new OrchestrationDispatchCommandError({
              message:
                error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
              cause,
            });
      };

      const enrichProjectEvent = (
        event: OrchestrationEvent,
      ): Effect.Effect<OrchestrationEvent, never, never> => {
        switch (event.type) {
          case "project.created":
            return repositoryIdentityResolver.resolve(event.payload.workspaceRoot).pipe(
              Effect.map((repositoryIdentity) => ({
                ...event,
                payload: {
                  ...event.payload,
                  repositoryIdentity,
                },
              })),
            );
          case "project.meta-updated":
            return Effect.gen(function* () {
              const workspaceRoot =
                event.payload.workspaceRoot ??
                (yield* orchestrationEngine.getReadModel()).projects.find(
                  (project) => project.id === event.payload.projectId,
                )?.workspaceRoot ??
                null;
              if (workspaceRoot === null) {
                return event;
              }

              const repositoryIdentity = yield* repositoryIdentityResolver.resolve(workspaceRoot);
              return {
                ...event,
                payload: {
                  ...event.payload,
                  repositoryIdentity,
                },
              } satisfies OrchestrationEvent;
            });
          default:
            return Effect.succeed(event);
        }
      };

      const enrichOrchestrationEvents = (events: ReadonlyArray<OrchestrationEvent>) =>
        Effect.forEach(events, enrichProjectEvent, { concurrency: 4 });

      const toShellStreamEvent = (
        event: OrchestrationEvent,
      ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> => {
        switch (event.type) {
          case "project.created":
          case "project.meta-updated":
            return projectionSnapshotQuery.getProjectShellById(event.payload.projectId).pipe(
              Effect.map((project) =>
                Option.map(project, (nextProject) => ({
                  kind: "project-upserted" as const,
                  sequence: event.sequence,
                  project: nextProject,
                })),
              ),
              Effect.catch(() => Effect.succeed(Option.none())),
            );
          case "project.deleted":
            return Effect.succeed(
              Option.some({
                kind: "project-removed" as const,
                sequence: event.sequence,
                projectId: event.payload.projectId,
              }),
            );
          case "thread.deleted":
            return Effect.succeed(
              Option.some({
                kind: "thread-removed" as const,
                sequence: event.sequence,
                threadId: event.payload.threadId,
              }),
            );
          default:
            if (event.aggregateKind !== "thread") {
              return Effect.succeed(Option.none());
            }
            return projectionSnapshotQuery
              .getThreadShellById(ThreadId.make(event.aggregateId))
              .pipe(
                Effect.map((thread) =>
                  Option.map(thread, (nextThread) => ({
                    kind: "thread-upserted" as const,
                    sequence: event.sequence,
                    thread: nextThread,
                  })),
                ),
                Effect.catch(() => Effect.succeed(Option.none())),
              );
        }
      };

      const dispatchBootstrapTurnStart = (
        command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
      ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> =>
        Effect.gen(function* () {
          const bootstrap = command.bootstrap;
          const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
          let createdThread = false;
          let targetProjectId = bootstrap?.createThread?.projectId;
          let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
          let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;

          const cleanupCreatedThread = () =>
            createdThread
              ? orchestrationEngine
                  .dispatch({
                    type: "thread.delete",
                    commandId: serverCommandId("bootstrap-thread-delete"),
                    threadId: command.threadId,
                  })
                  .pipe(Effect.ignoreCause({ log: true }))
              : Effect.void;

          const recordSetupScriptLaunchFailure = (input: {
            readonly error: unknown;
            readonly requestedAt: string;
            readonly worktreePath: string;
          }) => {
            const detail =
              input.error instanceof Error ? input.error.message : "Unknown setup failure.";
            return appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.failed",
              summary: "Setup script failed to start",
              createdAt: input.requestedAt,
              payload: {
                detail,
                worktreePath: input.worktreePath,
              },
              tone: "error",
            }).pipe(
              Effect.ignoreCause({ log: false }),
              Effect.flatMap(() =>
                Effect.logWarning("bootstrap turn start failed to launch setup script", {
                  threadId: command.threadId,
                  worktreePath: input.worktreePath,
                  detail,
                }),
              ),
            );
          };

          const recordSetupScriptStarted = (input: {
            readonly requestedAt: string;
            readonly worktreePath: string;
            readonly scriptId: string;
            readonly scriptName: string;
            readonly terminalId: string;
          }) => {
            const payload = {
              scriptId: input.scriptId,
              scriptName: input.scriptName,
              terminalId: input.terminalId,
              worktreePath: input.worktreePath,
            };
            return Effect.all([
              appendSetupScriptActivity({
                threadId: command.threadId,
                kind: "setup-script.requested",
                summary: "Starting setup script",
                createdAt: input.requestedAt,
                payload,
                tone: "info",
              }),
              appendSetupScriptActivity({
                threadId: command.threadId,
                kind: "setup-script.started",
                summary: "Setup script started",
                createdAt: new Date().toISOString(),
                payload,
                tone: "info",
              }),
            ]).pipe(
              Effect.asVoid,
              Effect.catch((error) =>
                Effect.logWarning(
                  "bootstrap turn start launched setup script but failed to record setup activity",
                  {
                    threadId: command.threadId,
                    worktreePath: input.worktreePath,
                    scriptId: input.scriptId,
                    terminalId: input.terminalId,
                    detail: error.message,
                  },
                ),
              ),
            );
          };

          const runSetupProgram = () =>
            bootstrap?.runSetupScript && targetWorktreePath
              ? (() => {
                  const worktreePath = targetWorktreePath;
                  const requestedAt = new Date().toISOString();
                  return projectSetupScriptRunner
                    .runForThread({
                      threadId: command.threadId,
                      ...(targetProjectId ? { projectId: targetProjectId } : {}),
                      ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
                      worktreePath,
                    })
                    .pipe(
                      Effect.matchEffect({
                        onFailure: (error) =>
                          recordSetupScriptLaunchFailure({
                            error,
                            requestedAt,
                            worktreePath,
                          }),
                        onSuccess: (setupResult) => {
                          if (setupResult.status !== "started") {
                            return Effect.void;
                          }
                          return recordSetupScriptStarted({
                            requestedAt,
                            worktreePath,
                            scriptId: setupResult.scriptId,
                            scriptName: setupResult.scriptName,
                            terminalId: setupResult.terminalId,
                          });
                        },
                      }),
                    );
                })()
              : Effect.void;

          const bootstrapProgram = Effect.gen(function* () {
            if (bootstrap?.createThread) {
              yield* orchestrationEngine.dispatch({
                type: "thread.create",
                commandId: serverCommandId("bootstrap-thread-create"),
                threadId: command.threadId,
                projectId: bootstrap.createThread.projectId,
                title: bootstrap.createThread.title,
                modelSelection: bootstrap.createThread.modelSelection,
                runtimeMode: bootstrap.createThread.runtimeMode,
                interactionMode: bootstrap.createThread.interactionMode,
                branch: bootstrap.createThread.branch,
                worktreePath: bootstrap.createThread.worktreePath,
                createdAt: bootstrap.createThread.createdAt,
              });
              createdThread = true;
            }

            if (bootstrap?.prepareWorktree) {
              const worktree = yield* git.createWorktree({
                cwd: bootstrap.prepareWorktree.projectCwd,
                branch: bootstrap.prepareWorktree.baseBranch,
                newBranch: bootstrap.prepareWorktree.branch,
                path: null,
              });
              targetWorktreePath = worktree.worktree.path;
              yield* orchestrationEngine.dispatch({
                type: "thread.meta.update",
                commandId: serverCommandId("bootstrap-thread-meta-update"),
                threadId: command.threadId,
                branch: worktree.worktree.branch,
                worktreePath: targetWorktreePath,
              });
              yield* refreshGitStatus(targetWorktreePath);
            }

            yield* runSetupProgram();

            return yield* orchestrationEngine.dispatch(finalTurnStartCommand);
          });

          return yield* bootstrapProgram.pipe(
            Effect.catchCause((cause) => {
              const dispatchError = toBootstrapDispatchCommandCauseError(cause);
              if (Cause.hasInterruptsOnly(cause)) {
                return Effect.fail(dispatchError);
              }
              return cleanupCreatedThread().pipe(Effect.flatMap(() => Effect.fail(dispatchError)));
            }),
          );
        });

      const dispatchNormalizedCommand = (
        normalizedCommand: OrchestrationCommand,
      ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> => {
        const dispatchEffect =
          normalizedCommand.type === "thread.turn.start" && normalizedCommand.bootstrap
            ? dispatchBootstrapTurnStart(normalizedCommand)
            : orchestrationEngine
                .dispatch(normalizedCommand)
                .pipe(
                  Effect.mapError((cause) =>
                    toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
                  ),
                );

        return startup
          .enqueueCommand(dispatchEffect)
          .pipe(
            Effect.mapError((cause) =>
              toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
            ),
          );
      };

      const ensureRemoteBuilderProject = (): Effect.Effect<
        void,
        OrchestrationDispatchCommandError
      > => {
        if (!isRemoteBuilderMode(appMode)) return Effect.void;
        return Effect.gen(function* () {
          const scope = yield* requireRemoteBuilderScope();
          const projectId = expectedBuilderProjectId;
          if (!projectId) {
            return yield* builderScopeDenial(
              "This builder session has no authorized project scope.",
            );
          }
          yield* bindBuilderProject(projectId);
          const existing = yield* projectionSnapshotQuery
            .getProjectShellById(projectId)
            .pipe(
              Effect.mapError((cause) =>
                builderScopeDenial("Unable to load the builder project scope.", cause),
              ),
            );
          if (Option.isSome(existing)) return;

          const command: OrchestrationCommand = {
            type: "project.create",
            commandId: serverCommandId("remote-builder-project-create"),
            projectId,
            title: scope.projectKey,
            workspaceRoot: config.cwd,
            defaultModelSelection: {
              provider: "redclaw",
              model: DEFAULT_MODEL_BY_PROVIDER.redclaw,
            },
            createdAt: new Date().toISOString(),
          };
          yield* dispatchNormalizedCommand(command);
        });
      };

      const sanitizeSettingsReadError = (error: ServerSettingsError): ServerSettingsError =>
        isRemoteBuilderMode(appMode)
          ? new ServerSettingsError({
              settingsPath: "remote-builder",
              detail: "Unable to load remote builder settings.",
            })
          : error;

      const loadServerConfig = Effect.gen(function* () {
        const keybindingsConfig = yield* keybindings.loadConfigState;
        const providers = yield* providerRegistry.getProviders;
        const settings = yield* serverSettings.getSettings;
        const environment = yield* serverEnvironment.getDescriptor;
        const auth = yield* serverAuth.getDescriptor();

        return exposeServerConfigForMode(appMode, {
          environment,
          auth,
          cwd: config.cwd,
          keybindingsConfigPath: config.keybindingsConfigPath,
          keybindings: keybindingsConfig.keybindings,
          issues: keybindingsConfig.issues,
          providers,
          availableEditors: resolveAvailableEditors(),
          observability: {
            logsDirectoryPath: config.logsDir,
            localTracingEnabled: true,
            ...(config.otlpTracesUrl !== undefined ? { otlpTracesUrl: config.otlpTracesUrl } : {}),
            otlpTracesEnabled: config.otlpTracesUrl !== undefined,
            ...(config.otlpMetricsUrl !== undefined
              ? { otlpMetricsUrl: config.otlpMetricsUrl }
              : {}),
            otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
          },
          settings,
        });
      }).pipe(
        Effect.mapError((error) => {
          if (!isRemoteBuilderMode(appMode)) return error;
          return Schema.is(KeybindingsConfigError)(error)
            ? new KeybindingsConfigError({
                configPath: "remote-builder",
                detail: "Unable to load remote builder keybindings.",
              })
            : sanitizeSettingsReadError(error);
        }),
      );

      const refreshGitStatus = (cwd: string) =>
        gitStatusBroadcaster
          .refreshStatus(cwd)
          .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

      return WsRpcGroup.of({
        [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.dispatchCommand,
            Effect.gen(function* () {
              yield* authorizeBuilderCommand(command as OrchestrationCommand);
              const normalizedCommand = enforceRemoteBuilderCommandPolicy(
                appMode,
                yield* normalizeDispatchCommand(command),
              );
              const shouldStopSessionAfterArchive =
                normalizedCommand.type === "thread.archive"
                  ? yield* projectionSnapshotQuery
                      .getThreadShellById(normalizedCommand.threadId)
                      .pipe(
                        Effect.map(
                          Option.match({
                            onNone: () => false,
                            onSome: (thread) =>
                              thread.session !== null && thread.session.status !== "stopped",
                          }),
                        ),
                        Effect.catch(() => Effect.succeed(false)),
                      )
                  : false;
              const result = yield* dispatchNormalizedCommand(normalizedCommand);
              if (normalizedCommand.type === "thread.archive") {
                if (shouldStopSessionAfterArchive) {
                  yield* Effect.gen(function* () {
                    const stopCommand = yield* normalizeDispatchCommand({
                      type: "thread.session.stop",
                      commandId: CommandId.make(
                        `session-stop-for-archive:${normalizedCommand.commandId}`,
                      ),
                      threadId: normalizedCommand.threadId,
                      createdAt: new Date().toISOString(),
                    });

                    yield* dispatchNormalizedCommand(stopCommand);
                  }).pipe(
                    Effect.catchCause((cause) =>
                      Effect.logWarning("failed to stop provider session during archive", {
                        threadId: normalizedCommand.threadId,
                        cause,
                      }),
                    ),
                  );
                }

                yield* terminalManager.close({ threadId: normalizedCommand.threadId }).pipe(
                  Effect.catch((error) =>
                    Effect.logWarning("failed to close thread terminals after archive", {
                      threadId: normalizedCommand.threadId,
                      error: error.message,
                    }),
                  ),
                );
              }
              return result;
            }).pipe(
              Effect.mapError((cause) =>
                Schema.is(OrchestrationDispatchCommandError)(cause)
                  ? cause
                  : new OrchestrationDispatchCommandError({
                      message: "Failed to dispatch orchestration command",
                      cause,
                    }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getTurnDiff,
            authorizeBuilderThread(input.threadId).pipe(
              Effect.flatMap(() => checkpointDiffQuery.getTurnDiff(input)),
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetTurnDiffError({
                    message: "Failed to load turn diff",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getFullThreadDiff,
            authorizeBuilderThread(input.threadId).pipe(
              Effect.flatMap(() => checkpointDiffQuery.getFullThreadDiff(input)),
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetFullThreadDiffError({
                    message: "Failed to load full thread diff",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.replayEvents]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.replayEvents,
            Stream.runCollect(
              orchestrationEngine
                .readEvents(
                  clamp(input.fromSequenceExclusive, {
                    maximum: Number.MAX_SAFE_INTEGER,
                    minimum: 0,
                  }),
                )
                .pipe(Stream.filterEffect(isAuthorizedBuilderEvent)),
            ).pipe(
              Effect.map((events) => Array.from(events)),
              Effect.flatMap(enrichOrchestrationEvents),
              Effect.mapError(
                (cause) =>
                  new OrchestrationReplayEventsError({
                    message: "Failed to replay orchestration events",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.subscribeShell]: (_input) =>
          observeRpcStreamEffect(
            ORCHESTRATION_WS_METHODS.subscribeShell,
            Effect.gen(function* () {
              yield* ensureRemoteBuilderProject().pipe(
                Effect.mapError(
                  (cause) =>
                    new OrchestrationGetSnapshotError({
                      message: "Unable to initialize the builder project scope.",
                      cause,
                    }),
                ),
              );
              const snapshot = yield* projectionSnapshotQuery.getShellSnapshot().pipe(
                Effect.flatMap(filterBuilderShellSnapshot),
                Effect.mapError(
                  (cause) =>
                    new OrchestrationGetSnapshotError({
                      message: "Failed to load orchestration shell snapshot",
                      cause,
                    }),
                ),
              );

              const liveStream = orchestrationEngine.streamDomainEvents.pipe(
                Stream.filterEffect(isAuthorizedBuilderEvent),
                Stream.mapEffect(toShellStreamEvent),
                Stream.flatMap((event) =>
                  Option.isSome(event) ? Stream.succeed(event.value) : Stream.empty,
                ),
              );

              return Stream.concat(
                Stream.make({
                  kind: "snapshot" as const,
                  snapshot,
                }),
                liveStream,
              );
            }),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.subscribeThread]: (input) =>
          observeRpcStreamEffect(
            ORCHESTRATION_WS_METHODS.subscribeThread,
            Effect.gen(function* () {
              yield* authorizeBuilderThread(input.threadId).pipe(
                Effect.mapError(
                  (cause) =>
                    new OrchestrationGetSnapshotError({
                      message: "Thread access is outside this builder session scope.",
                      cause,
                    }),
                ),
              );
              const [threadDetail, snapshotSequence] = yield* Effect.all([
                projectionSnapshotQuery.getThreadDetailById(input.threadId).pipe(
                  Effect.mapError(
                    (cause) =>
                      new OrchestrationGetSnapshotError({
                        message: `Failed to load thread ${input.threadId}`,
                        cause,
                      }),
                  ),
                ),
                orchestrationEngine
                  .getReadModel()
                  .pipe(Effect.map((readModel) => readModel.snapshotSequence)),
              ]);

              if (Option.isNone(threadDetail)) {
                return yield* new OrchestrationGetSnapshotError({
                  message: `Thread ${input.threadId} was not found`,
                  cause: input.threadId,
                });
              }

              const liveStream = orchestrationEngine.streamDomainEvents.pipe(
                Stream.filterEffect(isAuthorizedBuilderEvent),
                Stream.filter(
                  (event) =>
                    event.aggregateKind === "thread" &&
                    event.aggregateId === input.threadId &&
                    isThreadDetailEvent(event),
                ),
                Stream.map((event) => ({
                  kind: "event" as const,
                  event,
                })),
              );

              return Stream.concat(
                Stream.make({
                  kind: "snapshot" as const,
                  snapshot: {
                    snapshotSequence,
                    thread: threadDetail.value,
                  },
                }),
                liveStream,
              );
            }),
            { "rpc.aggregate": "orchestration" },
          ),
        [WS_METHODS.serverGetConfig]: (_input) =>
          observeRpcEffect(WS_METHODS.serverGetConfig, loadServerConfig, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverRefreshProviders]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverRefreshProviders,
            guardRemoteBuilderEffect(
              appMode,
              "providerRefresh",
              providerRegistry.refresh().pipe(Effect.map((providers) => ({ providers }))),
            ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverUpsertKeybinding]: (rule) =>
          observeRpcEffect(
            WS_METHODS.serverUpsertKeybinding,
            guardRemoteBuilderEffect(
              appMode,
              "globalSettingsMutation",
              Effect.gen(function* () {
                const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule);
                return { keybindings: keybindingsConfig, issues: [] };
              }),
            ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverGetSettings]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverGetSettings,
            serverSettings.getSettings.pipe(
              Effect.map((settings) => exposeServerSettingsForMode(appMode, settings)),
              Effect.mapError(sanitizeSettingsReadError),
            ),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverUpdateSettings]: ({ patch }) =>
          observeRpcEffect(
            WS_METHODS.serverUpdateSettings,
            guardRemoteBuilderEffect(
              appMode,
              "globalSettingsMutation",
              serverSettings.updateSettings(patch),
            ),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.projectsSearchEntries]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsSearchEntries,
            guardRemoteBuilderEffect(
              appMode,
              "workspaceBrowse",
              workspaceEntries.search(input).pipe(
                Effect.mapError(
                  (cause) =>
                    new ProjectSearchEntriesError({
                      message: `Failed to search workspace entries: ${cause.detail}`,
                      cause,
                    }),
                ),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsWriteFile]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsWriteFile,
            guardRemoteBuilderEffect(
              appMode,
              "workspaceWrite",
              workspaceFileSystem.writeFile(input).pipe(
                Effect.mapError((cause) => {
                  const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                    ? "Workspace file path must stay within the project root."
                    : "Failed to write workspace file";
                  return new ProjectWriteFileError({
                    message,
                    cause,
                  });
                }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.shellOpenInEditor]: (input) =>
          observeRpcEffect(
            WS_METHODS.shellOpenInEditor,
            guardRemoteBuilderEffect(appMode, "openInEditor", open.openInEditor(input)),
            {
              "rpc.aggregate": "workspace",
            },
          ),
        [WS_METHODS.filesystemBrowse]: (input) =>
          observeRpcEffect(
            WS_METHODS.filesystemBrowse,
            guardRemoteBuilderEffect(
              appMode,
              "workspaceBrowse",
              workspaceEntries.browse(input).pipe(
                Effect.mapError(
                  (cause) =>
                    new FilesystemBrowseError({
                      message: cause.detail,
                      cause,
                    }),
                ),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.subscribeGitStatus]: (input) =>
          observeRpcStream(
            WS_METHODS.subscribeGitStatus,
            guardRemoteBuilderStream(appMode, "git", gitStatusBroadcaster.streamStatus(input)),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitRefreshStatus]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitRefreshStatus,
            guardRemoteBuilderEffect(appMode, "git", gitStatusBroadcaster.refreshStatus(input.cwd)),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitPull]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitPull,
            guardRemoteBuilderEffect(
              appMode,
              "git",
              git.pullCurrentBranch(input.cwd).pipe(
                Effect.matchCauseEffect({
                  onFailure: (cause) => Effect.failCause(cause),
                  onSuccess: (result) =>
                    refreshGitStatus(input.cwd).pipe(
                      Effect.ignore({ log: true }),
                      Effect.as(result),
                    ),
                }),
              ),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitRunStackedAction]: (input) =>
          observeRpcStream(
            WS_METHODS.gitRunStackedAction,
            guardRemoteBuilderStream(
              appMode,
              "git",
              Stream.callback<GitActionProgressEvent, GitManagerServiceError>((queue) =>
                gitManager
                  .runStackedAction(input, {
                    actionId: input.actionId,
                    progressReporter: {
                      publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
                    },
                  })
                  .pipe(
                    Effect.matchCauseEffect({
                      onFailure: (cause) => Queue.failCause(queue, cause),
                      onSuccess: () =>
                        refreshGitStatus(input.cwd).pipe(
                          Effect.andThen(Queue.end(queue).pipe(Effect.asVoid)),
                        ),
                    }),
                  ),
              ),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitResolvePullRequest]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitResolvePullRequest,
            guardRemoteBuilderEffect(appMode, "git", gitManager.resolvePullRequest(input)),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitPreparePullRequestThread]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitPreparePullRequestThread,
            guardRemoteBuilderEffect(
              appMode,
              "git",
              gitManager
                .preparePullRequestThread(input)
                .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitListBranches]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitListBranches,
            guardRemoteBuilderEffect(appMode, "git", git.listBranches(input)),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitCreateWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitCreateWorktree,
            guardRemoteBuilderEffect(
              appMode,
              "git",
              git.createWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitRemoveWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitRemoveWorktree,
            guardRemoteBuilderEffect(
              appMode,
              "git",
              git.removeWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitCreateBranch]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitCreateBranch,
            guardRemoteBuilderEffect(
              appMode,
              "git",
              git.createBranch(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitCheckout]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitCheckout,
            guardRemoteBuilderEffect(
              appMode,
              "git",
              Effect.scoped(git.checkoutBranch(input)).pipe(
                Effect.tap(() => refreshGitStatus(input.cwd)),
              ),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitInit]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitInit,
            guardRemoteBuilderEffect(
              appMode,
              "git",
              git.initRepo(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.terminalOpen]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalOpen,
            guardRemoteBuilderEffect(appMode, "terminal", terminalManager.open(input)),
            {
              "rpc.aggregate": "terminal",
            },
          ),
        [WS_METHODS.terminalWrite]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalWrite,
            guardRemoteBuilderEffect(appMode, "terminal", terminalManager.write(input)),
            { "rpc.aggregate": "terminal" },
          ),
        [WS_METHODS.terminalResize]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalResize,
            guardRemoteBuilderEffect(appMode, "terminal", terminalManager.resize(input)),
            { "rpc.aggregate": "terminal" },
          ),
        [WS_METHODS.terminalClear]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalClear,
            guardRemoteBuilderEffect(appMode, "terminal", terminalManager.clear(input)),
            { "rpc.aggregate": "terminal" },
          ),
        [WS_METHODS.terminalRestart]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalRestart,
            guardRemoteBuilderEffect(appMode, "terminal", terminalManager.restart(input)),
            { "rpc.aggregate": "terminal" },
          ),
        [WS_METHODS.terminalClose]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalClose,
            guardRemoteBuilderEffect(appMode, "terminal", terminalManager.close(input)),
            { "rpc.aggregate": "terminal" },
          ),
        [WS_METHODS.subscribeTerminalEvents]: (_input) =>
          observeRpcStream(
            WS_METHODS.subscribeTerminalEvents,
            guardRemoteBuilderStream(
              appMode,
              "terminal",
              Stream.callback<TerminalEvent>((queue) =>
                Effect.acquireRelease(
                  terminalManager.subscribe((event) => Queue.offer(queue, event)),
                  (unsubscribe) => Effect.sync(unsubscribe),
                ),
              ),
            ),
            { "rpc.aggregate": "terminal" },
          ),
        [WS_METHODS.subscribeServerConfig]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeServerConfig,
            Effect.gen(function* () {
              const keybindingsUpdates = keybindings.streamChanges.pipe(
                Stream.map((event) => ({
                  version: 1 as const,
                  type: "keybindingsUpdated" as const,
                  payload: {
                    issues: isRemoteBuilderMode(appMode) ? [] : event.issues,
                  },
                })),
              );
              const providerStatuses = providerRegistry.streamChanges.pipe(
                Stream.map((providers) => ({
                  version: 1 as const,
                  type: "providerStatuses" as const,
                  payload: {
                    providers: isRemoteBuilderMode(appMode)
                      ? sanitizeRemoteBuilderProviders(providers)
                      : providers,
                  },
                })),
                Stream.debounce(Duration.millis(PROVIDER_STATUS_DEBOUNCE_MS)),
              );
              const settingsUpdates = serverSettings.streamChanges.pipe(
                Stream.map((settings) => ({
                  version: 1 as const,
                  type: "settingsUpdated" as const,
                  payload: { settings: exposeServerSettingsForMode(appMode, settings) },
                })),
              );

              yield* Effect.all(
                isRemoteBuilderMode(appMode)
                  ? [providerRegistry.refresh("redclaw")]
                  : [providerRegistry.refresh("codex"), providerRegistry.refresh("claudeAgent")],
                {
                  concurrency: "unbounded",
                  discard: true,
                },
              ).pipe(Effect.ignoreCause({ log: true }), Effect.forkScoped);

              const liveUpdates = Stream.merge(
                keybindingsUpdates,
                Stream.merge(providerStatuses, settingsUpdates),
              );

              return Stream.concat(
                Stream.make({
                  version: 1 as const,
                  type: "snapshot" as const,
                  config: yield* loadServerConfig,
                }),
                liveUpdates,
              );
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeServerLifecycle]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeServerLifecycle,
            Effect.gen(function* () {
              const snapshot = yield* lifecycleEvents.snapshot;
              const snapshotEvents = Array.from(snapshot.events).toSorted(
                (left, right) => left.sequence - right.sequence,
              );
              const liveEvents = lifecycleEvents.stream.pipe(
                Stream.filter((event) => event.sequence > snapshot.sequence),
              );
              return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents);
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeAuthAccess]: (_input) =>
          observeRpcStream(
            WS_METHODS.subscribeAuthAccess,
            guardRemoteBuilderStream(
              appMode,
              "accessManagement",
              Stream.unwrap(
                Effect.gen(function* () {
                  const initialSnapshot = yield* loadAuthAccessSnapshot();
                  const revisionRef = yield* Ref.make(1);
                  const accessChanges: Stream.Stream<
                    BootstrapCredentialChange | SessionCredentialChange
                  > = Stream.merge(bootstrapCredentials.streamChanges, sessions.streamChanges);

                  const liveEvents: Stream.Stream<AuthAccessStreamEvent> = accessChanges.pipe(
                    Stream.mapEffect((change) =>
                      Ref.updateAndGet(revisionRef, (revision) => revision + 1).pipe(
                        Effect.map((revision) =>
                          toAuthAccessStreamEvent(change, revision, currentSessionId),
                        ),
                      ),
                    ),
                  );

                  return Stream.concat(
                    Stream.make({
                      version: 1 as const,
                      revision: 1,
                      type: "snapshot" as const,
                      payload: initialSnapshot,
                    }),
                    liveEvents,
                  );
                }),
              ),
            ),
            { "rpc.aggregate": "auth" },
          ),
      });
    }),
  );

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.succeed(
    HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const serverAuth = yield* ServerAuth;
        const sessions = yield* SessionCredentialService;
        const session = yield* serverAuth.authenticateWebSocketUpgrade(request);
        const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
          spanPrefix: "ws.rpc",
          spanAttributes: {
            "rpc.transport": "websocket",
            "rpc.system": "effect-rpc",
          },
        }).pipe(
          Effect.provide(
            makeWsRpcLayer(session).pipe(Layer.provideMerge(RpcSerialization.layerJson)),
          ),
        );
        return yield* Effect.acquireUseRelease(
          sessions.markConnected(session.sessionId),
          () => rpcWebSocketHttpEffect,
          () => sessions.markDisconnected(session.sessionId),
        );
      }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
    ),
  ),
);
