import { ApprovalRequestId, ThreadId, TurnId, type ProviderSession } from "@t3tools/contracts";
import { Effect, Result } from "effect";
import { describe, expect, it, vi } from "vitest";

import { RedClawAdapter } from "../Services/RedClawAdapter.ts";
import type { RedClawConfig } from "../redclawConfig.ts";
import { makeRedClawAdapterLive, type RedClawFetch } from "./RedClawAdapter.ts";

const config: RedClawConfig = {
  origin: "https://client-builder.example",
  apiKey: "server-only-test-key",
  agentKey: "client-dev-orchestrator",
  timeoutMs: 100,
  maxResponseBytes: 4_096,
};

const threadId = ThreadId.make("thread-redclaw-1");
const turnId = TurnId.make("turn-redclaw-1");
const now = "2026-08-17T12:00:00.000Z";

function session(overrides: Partial<ProviderSession> = {}): ProviderSession {
  return {
    provider: "redclaw",
    status: "ready",
    runtimeMode: "approval-required",
    threadId,
    cwd: "/internal/sandbox/path",
    model: "client-dev-orchestrator",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function runWithAdapter<A, E>(
  fetchImpl: RedClawFetch,
  effect: Effect.Effect<A, E, RedClawAdapter>,
) {
  return Effect.runPromise(
    effect.pipe(Effect.provide(makeRedClawAdapterLive(config, { fetchImpl })), Effect.scoped),
  );
}

describe("RedClawAdapterLive", () => {
  it("starts and sends through the bounded BFF without exposing server credentials", async () => {
    const requestInits: RequestInit[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requestInits.push(init ?? {});
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/sessions")) {
        return Response.json({ session: session() });
      }
      if (path.endsWith("/turns")) {
        return Response.json({ turn: { threadId, turnId } });
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const result = await runWithAdapter(
      fetchImpl,
      Effect.gen(function* () {
        const adapter = yield* RedClawAdapter;
        const started = yield* adapter.startSession({
          threadId,
          provider: "redclaw",
          cwd: "/local/project",
          modelSelection: { provider: "redclaw", model: "client-dev-orchestrator" },
          runtimeMode: "approval-required",
        });
        const turn = yield* adapter.sendTurn({
          threadId,
          input: "Build the approved change.",
          modelSelection: { provider: "redclaw", model: "client-dev-builder" },
        });
        const sessions = yield* adapter.listSessions();
        return { started, turn, sessions };
      }),
    );

    expect(result.started.cwd).toBe("/local/project");
    expect(result.started.cwd).not.toContain("internal");
    expect(result.turn).toEqual({ threadId, turnId });
    expect(result.sessions).toHaveLength(1);

    const firstInit = requestInits[0]!;
    expect(firstInit).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
    expect(firstInit.headers).toMatchObject({
      Authorization: `Bearer ${config.apiKey}`,
      "X-Client-Agent-Key": config.agentKey,
    });
    expect(firstInit.headers).toHaveProperty("Idempotency-Key");
    const turnInit = requestInits[1]!;
    expect(turnInit.headers).toHaveProperty("Idempotency-Key");
    expect(String(firstInit.body)).not.toContain(config.apiKey);
    expect(String(firstInit.body)).not.toContain("/local/project");
    expect(JSON.stringify(result)).not.toContain(config.apiKey);
  });

  it("reuses the send idempotency key after a retryable request failure", async () => {
    let turnAttempts = 0;
    const turnKeys: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/sessions")) return Response.json({ session: session() });
      turnAttempts += 1;
      const headers = init?.headers as Record<string, string> | undefined;
      turnKeys.push(String(headers?.["Idempotency-Key"]));
      if (turnAttempts === 1) return new Response(null, { status: 503 });
      return Response.json({ turn: { threadId, turnId } });
    });

    await runWithAdapter(
      fetchImpl,
      Effect.gen(function* () {
        const adapter = yield* RedClawAdapter;
        yield* adapter.startSession({
          threadId,
          provider: "redclaw",
          runtimeMode: "approval-required",
        });
        const input = { threadId, input: "Retry this exact turn." } as const;
        const first = yield* Effect.result(adapter.sendTurn(input));
        expect(Result.isFailure(first)).toBe(true);
        yield* adapter.sendTurn(input);
      }),
    );

    expect(turnKeys).toHaveLength(2);
    expect(turnKeys[0]).toBe(turnKeys[1]);
  });

  it("implements interrupt, approval, user-input, read, rollback, and stop semantics", async () => {
    const requestId = ApprovalRequestId.make("approval-redclaw-1");
    const paths: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      if (path.endsWith("/sessions")) return Response.json({ session: session() });
      if (path.endsWith("/thread")) {
        return Response.json({ thread: { threadId, turns: [{ id: turnId, items: [] }] } });
      }
      if (path.endsWith("/rollback")) {
        return Response.json({ thread: { threadId, turns: [] } });
      }
      return Response.json({});
    });

    await runWithAdapter(
      fetchImpl,
      Effect.gen(function* () {
        const adapter = yield* RedClawAdapter;
        yield* adapter.startSession({
          threadId,
          provider: "redclaw",
          runtimeMode: "approval-required",
        });
        yield* adapter.interruptTurn(threadId, turnId);
        yield* adapter.respondToRequest(threadId, requestId, "accept");
        yield* adapter.respondToUserInput(threadId, requestId, { scope: "preview" });
        const beforeRollback = yield* adapter.readThread(threadId);
        const afterRollback = yield* adapter.rollbackThread(threadId, 1);
        expect(beforeRollback.turns).toHaveLength(1);
        expect(afterRollback.turns).toHaveLength(0);
        yield* adapter.stopSession(threadId);
        expect(yield* adapter.hasSession(threadId)).toBe(false);
      }),
    );

    expect(paths).toEqual([
      "/v1/client-dev/builder/sessions",
      `/v1/client-dev/builder/sessions/${threadId}/interrupt`,
      `/v1/client-dev/builder/sessions/${threadId}/requests/${requestId}/response`,
      `/v1/client-dev/builder/sessions/${threadId}/user-input/${requestId}/response`,
      `/v1/client-dev/builder/sessions/${threadId}/thread`,
      `/v1/client-dev/builder/sessions/${threadId}/rollback`,
      `/v1/client-dev/builder/sessions/${threadId}`,
    ]);
  });

  it("fails closed for malformed and oversized responses", async () => {
    const malformedFetch = vi.fn().mockResolvedValue(new Response("{not-json"));
    const malformed = await runWithAdapter(
      malformedFetch,
      Effect.gen(function* () {
        const adapter = yield* RedClawAdapter;
        return yield* Effect.result(
          adapter.startSession({
            threadId,
            provider: "redclaw",
            runtimeMode: "approval-required",
          }),
        );
      }),
    );
    expect(Result.isFailure(malformed)).toBe(true);
    if (Result.isFailure(malformed)) {
      expect(malformed.failure._tag).toBe("ProviderAdapterRequestError");
      expect(malformed.failure.message).not.toContain(config.apiKey);
    }

    const oversizedFetch = vi
      .fn()
      .mockResolvedValue(new Response("x".repeat(config.maxResponseBytes + 1)));
    const oversized = await runWithAdapter(
      oversizedFetch,
      Effect.gen(function* () {
        const adapter = yield* RedClawAdapter;
        return yield* Effect.result(
          adapter.startSession({
            threadId,
            provider: "redclaw",
            runtimeMode: "approval-required",
          }),
        );
      }),
    );
    expect(Result.isFailure(oversized)).toBe(true);
    if (Result.isFailure(oversized)) {
      expect(oversized.failure.message).toContain("oversized response");
    }
  });

  it("rejects cross-provider or cross-thread sessions and events atomically", async () => {
    const otherThreadId = ThreadId.make("thread-redclaw-other");
    const invalidResponses = [
      { session: session({ provider: "codex" }) },
      { session: session({ threadId: otherThreadId }) },
      {
        session: session(),
        events: [
          {
            eventId: "event-cross-provider",
            provider: "codex",
            threadId,
            createdAt: now,
            type: "session.started",
            payload: { message: "Cross-provider event" },
          },
        ],
      },
      {
        session: session(),
        events: [
          {
            eventId: "event-cross-thread",
            provider: "redclaw",
            threadId: otherThreadId,
            createdAt: now,
            type: "session.started",
            payload: { message: "Cross-thread event" },
          },
        ],
      },
      {
        session: session(),
        events: [
          {
            eventId: "event-raw-trace",
            provider: "redclaw",
            threadId,
            createdAt: now,
            type: "session.started",
            payload: { message: "Unsafe raw event" },
            raw: {
              source: "codex.app-server.notification",
              payload: { path: "/internal/operator/workspace" },
            },
          },
        ],
      },
    ];

    for (const invalidResponse of invalidResponses) {
      const fetchImpl = vi.fn().mockResolvedValue(Response.json(invalidResponse));
      const result = await runWithAdapter(
        fetchImpl,
        Effect.gen(function* () {
          const adapter = yield* RedClawAdapter;
          const outcome = yield* Effect.result(
            adapter.startSession({
              threadId,
              provider: "redclaw",
              runtimeMode: "approval-required",
            }),
          );
          return { outcome, hasSession: yield* adapter.hasSession(threadId) };
        }),
      );
      expect(Result.isFailure(result.outcome)).toBe(true);
      if (Result.isFailure(result.outcome)) {
        expect(result.outcome.failure._tag).toBe("ProviderAdapterValidationError");
        expect(result.outcome.failure.message).not.toContain(config.apiKey);
      }
      expect(result.hasSession).toBe(false);
    }
  });

  it("times out without returning request configuration", async () => {
    const fetchImpl = vi.fn(
      (_url, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );
    const timeoutConfig = { ...config, timeoutMs: 5 };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const adapter = yield* RedClawAdapter;
        return yield* Effect.result(
          adapter.startSession({
            threadId,
            provider: "redclaw",
            runtimeMode: "approval-required",
          }),
        );
      }).pipe(Effect.provide(makeRedClawAdapterLive(timeoutConfig, { fetchImpl })), Effect.scoped),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain("timed out");
      expect(result.failure.message).not.toContain(config.origin);
      expect(result.failure.message).not.toContain(config.apiKey);
    }
  });
});
