/**
 * RedClawAdapterLive - bounded HTTP adapter for the isolated RedClaw Client
 * Dev builder BFF.
 *
 * The BFF is the trust boundary: it resolves tenant/project identity and
 * returns client-safe canonical events. T3 Code never receives provider
 * credentials or direct GoClaw infrastructure access.
 */
import {
  REDCLAW_BUILDER_SCOPE_AUDIENCE,
  REDCLAW_BUILDER_SCOPE_ISSUER,
  REDCLAW_BUILDER_SCOPE_KEY_ID,
  ProviderRuntimeEvent,
  ProviderSession,
  ProviderTurnStartResult,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Effect, Layer, PubSub, Schema, Stream } from "effect";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { Option } from "effect";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { RedClawAdapter, type RedClawAdapterShape } from "../Services/RedClawAdapter.ts";
import type {
  ProviderThreadSnapshot,
  ProviderThreadTurnSnapshot,
} from "../Services/ProviderAdapter.ts";
import type { RedClawConfig } from "../redclawConfig.ts";
import { BuilderScopeRepository } from "../../persistence/Services/BuilderScopes.ts";

const PROVIDER = "redclaw" as const;
const BUILDER_API_PREFIX = "/v1/client-dev/builder";
const SCOPE_TOKEN_TTL_SECONDS = 60;
const SCOPE_TOKEN_HEADER = Buffer.from(
  JSON.stringify({ alg: "HS256", typ: "JWT", kid: REDCLAW_BUILDER_SCOPE_KEY_ID }),
  "utf8",
).toString("base64url");

const ProviderThreadTurnResponse = Schema.Struct({
  id: TurnId,
  items: Schema.Array(Schema.Unknown),
});

const ProviderThreadResponse = Schema.Struct({
  threadId: ThreadId,
  turns: Schema.Array(ProviderThreadTurnResponse),
});

const RuntimeEvents = Schema.Array(ProviderRuntimeEvent);

const StartSessionResponse = Schema.Struct({
  session: ProviderSession,
  events: Schema.optional(RuntimeEvents),
});

const SendTurnResponse = Schema.Struct({
  turn: ProviderTurnStartResult,
  session: Schema.optional(ProviderSession),
  events: Schema.optional(RuntimeEvents),
});

const MutationResponse = Schema.Struct({
  session: Schema.optional(ProviderSession),
  events: Schema.optional(RuntimeEvents),
});

const ReadThreadResponse = Schema.Struct({
  thread: ProviderThreadResponse,
  events: Schema.optional(RuntimeEvents),
});

export type RedClawFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RedClawAdapterLiveOptions {
  readonly fetchImpl?: RedClawFetch;
}

function encodedPathPart(value: string): string {
  return encodeURIComponent(value);
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error("response exceeded the configured size limit");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > maximumBytes) {
      throw new Error("response exceeded the configured size limit");
    }
    return body;
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new Error("response exceeded the configured size limit");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function safeRequestDetail(operation: string, cause: unknown): string {
  if (
    (cause instanceof DOMException && cause.name === "AbortError") ||
    (cause instanceof Error && cause.name === "AbortError")
  ) {
    return `${operation} timed out.`;
  }
  if (cause instanceof Error && cause.message.includes("size limit")) {
    return `${operation} returned an oversized response.`;
  }
  return `${operation} failed.`;
}

function makeRedClawAdapter(config: RedClawConfig, options?: RedClawAdapterLiveOptions) {
  return Effect.gen(function* () {
    const sessions = new Map<ThreadId, ProviderSession>();
    const pendingTurnIdempotency = new Map<
      ThreadId,
      { readonly fingerprint: string; readonly key: string }
    >();
    const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const fetchImpl = options?.fetchImpl ?? fetch;
    const builderScopes = yield* BuilderScopeRepository;

    const issueScopeToken = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const binding = yield* builderScopes.getThread(threadId).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "authorizeScope",
                detail: "Unable to load the builder request scope.",
                cause,
              }),
          ),
        );
        if (Option.isNone(binding)) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "authorizeScope",
            detail: "The thread has no authorized builder scope.",
          });
        }
        const now = Math.floor(Date.now() / 1_000);
        const payload = Buffer.from(
          JSON.stringify({
            v: 1,
            iss: REDCLAW_BUILDER_SCOPE_ISSUER,
            aud: REDCLAW_BUILDER_SCOPE_AUDIENCE,
            sid: binding.value.authSessionId,
            handoffJti: binding.value.scope.handoffJti,
            sub: binding.value.scope.subject,
            workspaceId: binding.value.scope.workspaceId,
            tenantKey: binding.value.scope.tenantKey,
            projectKey: binding.value.scope.projectKey,
            role: binding.value.scope.role,
            threadId,
            iat: now,
            nbf: now,
            exp: now + SCOPE_TOKEN_TTL_SECONDS,
            jti: randomUUID(),
          }),
          "utf8",
        ).toString("base64url");
        const signingInput = `${SCOPE_TOKEN_HEADER}.${payload}`;
        const signature = createHmac("sha256", Buffer.from(config.scopeSigningSecret))
          .update(signingInput, "utf8")
          .digest("base64url");
        return `${signingInput}.${signature}`;
      });

    const request = <S extends Schema.Top>(input: {
      readonly operation: string;
      readonly path: string;
      readonly method: "GET" | "POST" | "DELETE";
      readonly schema: S;
      readonly body?: unknown;
      readonly idempotencyKey?: string;
      readonly threadId: ThreadId;
    }): Effect.Effect<S["Type"], ProviderAdapterRequestError, S["DecodingServices"]> => {
      const responseBody = Effect.flatMap(issueScopeToken(input.threadId), (scopeToken) =>
        Effect.tryPromise({
          try: async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), config.timeoutMs);
            try {
              const response = await fetchImpl(`${config.origin}${input.path}`, {
                method: input.method,
                headers: {
                  Authorization: `Bearer ${config.apiKey}`,
                  "X-Client-Agent-Key": config.agentKey,
                  "X-RedXTRM-Builder-Scope": scopeToken,
                  Accept: "application/json",
                  ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
                  ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
                },
                ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
                cache: "no-store",
                redirect: "error",
                signal: controller.signal,
              });
              if (!response.ok) {
                throw new Error(`request returned HTTP ${response.status}`);
              }
              return readBoundedBody(response, config.maxResponseBytes);
            } finally {
              clearTimeout(timer);
            }
          },
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: input.operation,
              detail: safeRequestDetail(input.operation, cause),
            }),
        }),
      );
      return Effect.flatMap(responseBody, (body) =>
        Schema.decodeUnknownEffect(Schema.fromJsonString(input.schema))(body).pipe(
          Effect.mapError(
            () =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: input.operation,
                detail: `${input.operation} returned a malformed response.`,
              }),
          ),
        ),
      );
    };

    const validateEvents = (
      operation: string,
      threadId: ThreadId,
      events: ReadonlyArray<ProviderRuntimeEvent> | undefined,
    ): Effect.Effect<ReadonlyArray<ProviderRuntimeEvent>, ProviderAdapterValidationError> =>
      Effect.gen(function* () {
        const validEvents = events ?? [];
        for (const event of validEvents) {
          if (event.provider !== PROVIDER || event.threadId !== threadId) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation,
              issue: "The BFF returned an event for a different provider or thread.",
            });
          }
          if (event.raw !== undefined) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation,
              issue: "The BFF returned a raw provider trace instead of a sanitized event.",
            });
          }
        }
        return validEvents;
      });

    const publishEvents = (
      operation: string,
      threadId: ThreadId,
      events: ReadonlyArray<ProviderRuntimeEvent> | undefined,
    ) =>
      Effect.flatMap(validateEvents(operation, threadId, events), (validEvents) =>
        Effect.forEach(validEvents, (event) => PubSub.publish(runtimeEventPubSub, event), {
          discard: true,
        }),
      );

    const requireSession = (
      threadId: ThreadId,
    ): Effect.Effect<ProviderSession, ProviderAdapterSessionNotFoundError> => {
      const session = sessions.get(threadId);
      return session
        ? Effect.succeed(session)
        : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
    };

    const validateSession = (
      operation: string,
      threadId: ThreadId,
      session: ProviderSession,
    ): Effect.Effect<ProviderSession, ProviderAdapterValidationError> => {
      if (session.provider !== PROVIDER || session.threadId !== threadId) {
        return Effect.fail(
          new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation,
            issue: "The BFF returned a session for a different provider or thread.",
          }),
        );
      }
      return Effect.succeed(session);
    };

    const startSession: RedClawAdapterShape["startSession"] = Effect.fn("startSession")(
      function* (input) {
        const existing = sessions.get(input.threadId);
        if (existing && existing.status !== "closed") return existing;

        if (input.modelSelection && input.modelSelection.provider !== PROVIDER) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: "RedClaw sessions require a RedClaw model selection.",
          });
        }

        const response = yield* request({
          operation: "startSession",
          path: `${BUILDER_API_PREFIX}/sessions`,
          method: "POST",
          schema: StartSessionResponse,
          idempotencyKey: `redclaw-start-${createHash("sha256").update(input.threadId).digest("hex").slice(0, 32)}`,
          threadId: input.threadId,
          body: {
            threadId: input.threadId,
            runtimeMode: "approval-required",
            agentRoute: config.agentKey,
            resumeCursor: input.resumeCursor,
          },
        });
        const remoteSession = yield* validateSession(
          "startSession",
          input.threadId,
          response.session,
        );
        yield* validateEvents("startSession", input.threadId, response.events);
        // A BFF may know an internal sandbox path; never project it back to the
        // browser. Keep only the T3-side project cwd supplied to this adapter.
        const session: ProviderSession = {
          ...remoteSession,
          runtimeMode: "approval-required",
          ...(input.cwd ? { cwd: input.cwd } : { cwd: undefined }),
          model: config.agentKey,
        };
        sessions.set(input.threadId, session);
        yield* publishEvents("startSession", input.threadId, response.events);
        return session;
      },
    );

    const sendTurn: RedClawAdapterShape["sendTurn"] = Effect.fn("sendTurn")(function* (input) {
      const current = yield* requireSession(input.threadId);
      if (input.modelSelection && input.modelSelection.provider !== PROVIDER) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "RedClaw turns require a RedClaw model selection.",
        });
      }
      const turnBody = {
        input: input.input,
        attachments: input.attachments ?? [],
        agentRoute: config.agentKey,
        interactionMode: input.interactionMode,
      };
      const fingerprint = createHash("sha256")
        .update(JSON.stringify({ threadId: input.threadId, ...turnBody }))
        .digest("hex");
      const pending = pendingTurnIdempotency.get(input.threadId);
      const idempotencyKey =
        pending?.fingerprint === fingerprint ? pending.key : `redclaw-turn-${randomUUID()}`;
      pendingTurnIdempotency.set(input.threadId, { fingerprint, key: idempotencyKey });
      const response = yield* request({
        operation: "sendTurn",
        path: `${BUILDER_API_PREFIX}/sessions/${encodedPathPart(input.threadId)}/turns`,
        method: "POST",
        schema: SendTurnResponse,
        body: turnBody,
        idempotencyKey,
        threadId: input.threadId,
      });
      if (response.turn.threadId !== input.threadId) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "The BFF returned a turn for a different thread.",
        });
      }
      yield* validateEvents("sendTurn", input.threadId, response.events);
      if (response.session) {
        const session = yield* validateSession("sendTurn", input.threadId, response.session);
        sessions.set(input.threadId, {
          ...session,
          runtimeMode: "approval-required",
          model: config.agentKey,
          cwd: current.cwd,
        });
      }
      yield* publishEvents("sendTurn", input.threadId, response.events);
      if (pendingTurnIdempotency.get(input.threadId)?.key === idempotencyKey) {
        pendingTurnIdempotency.delete(input.threadId);
      }
      return response.turn;
    });

    const interruptTurn: RedClawAdapterShape["interruptTurn"] = Effect.fn("interruptTurn")(
      function* (threadId, turnId) {
        yield* requireSession(threadId);
        const response = yield* request({
          operation: "interruptTurn",
          path: `${BUILDER_API_PREFIX}/sessions/${encodedPathPart(threadId)}/interrupt`,
          method: "POST",
          schema: MutationResponse,
          body: { turnId },
          threadId,
        });
        yield* validateEvents("interruptTurn", threadId, response.events);
        if (response.session) {
          sessions.set(
            threadId,
            yield* validateSession("interruptTurn", threadId, response.session),
          );
        }
        yield* publishEvents("interruptTurn", threadId, response.events);
      },
    );

    const respondToRequest: RedClawAdapterShape["respondToRequest"] = Effect.fn("respondToRequest")(
      function* (threadId, requestId, decision) {
        yield* requireSession(threadId);
        const response = yield* request({
          operation: "respondToRequest",
          path: `${BUILDER_API_PREFIX}/sessions/${encodedPathPart(threadId)}/requests/${encodedPathPart(requestId)}/response`,
          method: "POST",
          schema: MutationResponse,
          body: { decision },
          threadId,
        });
        yield* publishEvents("respondToRequest", threadId, response.events);
      },
    );

    const respondToUserInput: RedClawAdapterShape["respondToUserInput"] = Effect.fn(
      "respondToUserInput",
    )(function* (threadId, requestId, answers) {
      yield* requireSession(threadId);
      const response = yield* request({
        operation: "respondToUserInput",
        path: `${BUILDER_API_PREFIX}/sessions/${encodedPathPart(threadId)}/user-input/${encodedPathPart(requestId)}/response`,
        method: "POST",
        schema: MutationResponse,
        body: { answers },
        threadId,
      });
      yield* publishEvents("respondToUserInput", threadId, response.events);
    });

    const stopSession: RedClawAdapterShape["stopSession"] = Effect.fn("stopSession")(
      function* (threadId) {
        yield* requireSession(threadId);
        const response = yield* request({
          operation: "stopSession",
          path: `${BUILDER_API_PREFIX}/sessions/${encodedPathPart(threadId)}`,
          method: "DELETE",
          schema: MutationResponse,
          threadId,
        });
        yield* publishEvents("stopSession", threadId, response.events);
        sessions.delete(threadId);
        pendingTurnIdempotency.delete(threadId);
      },
    );

    const listSessions: RedClawAdapterShape["listSessions"] = () =>
      Effect.sync(() => Array.from(sessions.values(), (session) => ({ ...session })));

    const hasSession: RedClawAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => sessions.has(threadId));

    const readThread: RedClawAdapterShape["readThread"] = Effect.fn("readThread")(
      function* (threadId) {
        yield* requireSession(threadId);
        const response = yield* request({
          operation: "readThread",
          path: `${BUILDER_API_PREFIX}/sessions/${encodedPathPart(threadId)}/thread`,
          method: "GET",
          schema: ReadThreadResponse,
          threadId,
        });
        if (response.thread.threadId !== threadId) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "readThread",
            issue: "The BFF returned a snapshot for a different thread.",
          });
        }
        yield* publishEvents("readThread", threadId, response.events);
        return {
          threadId,
          turns: response.thread.turns as ReadonlyArray<ProviderThreadTurnSnapshot>,
        } satisfies ProviderThreadSnapshot;
      },
    );

    const rollbackThread: RedClawAdapterShape["rollbackThread"] = Effect.fn("rollbackThread")(
      function* (threadId, numTurns) {
        yield* requireSession(threadId);
        if (!Number.isInteger(numTurns) || numTurns < 1) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: "numTurns must be an integer >= 1.",
          });
        }
        const response = yield* request({
          operation: "rollbackThread",
          path: `${BUILDER_API_PREFIX}/sessions/${encodedPathPart(threadId)}/rollback`,
          method: "POST",
          schema: ReadThreadResponse,
          body: { numTurns },
          threadId,
        });
        if (response.thread.threadId !== threadId) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: "The BFF returned a snapshot for a different thread.",
          });
        }
        yield* publishEvents("rollbackThread", threadId, response.events);
        return response.thread;
      },
    );

    const stopAll: RedClawAdapterShape["stopAll"] = () =>
      Effect.forEach(Array.from(sessions.keys()), stopSession, { discard: true });

    yield* Effect.addFinalizer(() => PubSub.shutdown(runtimeEventPubSub));

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "in-session" },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      readThread,
      rollbackThread,
      stopAll,
      streamEvents: Stream.fromPubSub(runtimeEventPubSub),
    } satisfies RedClawAdapterShape;
  });
}

export function makeRedClawAdapterLive(config: RedClawConfig, options?: RedClawAdapterLiveOptions) {
  return Layer.effect(RedClawAdapter, makeRedClawAdapter(config, options));
}
