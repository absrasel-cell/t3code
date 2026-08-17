import type { ProviderKind } from "@t3tools/contracts";
import { it, assert, vi } from "@effect/vitest";
import { assertFailure } from "@effect/vitest/utils";

import { Effect, Layer, Stream } from "effect";

import { ClaudeAdapter } from "../Services/ClaudeAdapter.ts";
import type { ClaudeAdapterShape } from "../Services/ClaudeAdapter.ts";
import { CodexAdapter } from "../Services/CodexAdapter.ts";
import type { CodexAdapterShape } from "../Services/CodexAdapter.ts";
import { CursorAdapter } from "../Services/CursorAdapter.ts";
import type { CursorAdapterShape } from "../Services/CursorAdapter.ts";
import { OpenCodeAdapter } from "../Services/OpenCodeAdapter.ts";
import type { OpenCodeAdapterShape } from "../Services/OpenCodeAdapter.ts";
import { RedClawAdapter, type RedClawAdapterShape } from "../Services/RedClawAdapter.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import {
  makeProviderAdapterRegistryLive,
  ProviderAdapterRegistryLive,
} from "./ProviderAdapterRegistry.ts";
import { ProviderUnsupportedError } from "../Errors.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";

const fakeCodexAdapter: CodexAdapterShape = {
  provider: "codex",
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeClaudeAdapter: ClaudeAdapterShape = {
  provider: "claudeAgent",
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeOpenCodeAdapter: OpenCodeAdapterShape = {
  provider: "opencode",
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeCursorAdapter: CursorAdapterShape = {
  provider: "cursor",
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeRedClawAdapter: RedClawAdapterShape = {
  provider: "redclaw",
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const layer = it.layer(
  Layer.mergeAll(
    Layer.provide(
      ProviderAdapterRegistryLive,
      Layer.mergeAll(
        Layer.succeed(CodexAdapter, fakeCodexAdapter),
        Layer.succeed(ClaudeAdapter, fakeClaudeAdapter),
        Layer.succeed(OpenCodeAdapter, fakeOpenCodeAdapter),
        Layer.succeed(CursorAdapter, fakeCursorAdapter),
      ),
    ),
    NodeServices.layer,
  ),
);

layer("ProviderAdapterRegistryLive", (it) => {
  it.effect("resolves a registered provider adapter", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      const codex = yield* registry.getByProvider("codex");
      const claude = yield* registry.getByProvider("claudeAgent");
      const openCode = yield* registry.getByProvider("opencode");
      const cursor = yield* registry.getByProvider("cursor");
      assert.equal(codex, fakeCodexAdapter);
      assert.equal(claude, fakeClaudeAdapter);
      assert.equal(openCode, fakeOpenCodeAdapter);
      assert.equal(cursor, fakeCursorAdapter);

      const providers = yield* registry.listProviders();
      assert.deepEqual(providers, ["codex", "claudeAgent", "opencode", "cursor"]);
    }),
  );

  it.effect("fails with ProviderUnsupportedError for unknown providers", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      const adapter = yield* registry.getByProvider("unknown" as ProviderKind).pipe(Effect.result);
      assertFailure(adapter, new ProviderUnsupportedError({ provider: "unknown" }));
    }),
  );
});

const remoteLayer = it.layer(
  Layer.mergeAll(
    Layer.provide(
      makeProviderAdapterRegistryLive({ mode: "redxtrm-remote" }),
      Layer.mergeAll(
        Layer.succeed(CodexAdapter, fakeCodexAdapter),
        Layer.succeed(ClaudeAdapter, fakeClaudeAdapter),
        Layer.succeed(OpenCodeAdapter, fakeOpenCodeAdapter),
        Layer.succeed(CursorAdapter, fakeCursorAdapter),
        Layer.succeed(RedClawAdapter, fakeRedClawAdapter),
      ),
    ),
    NodeServices.layer,
  ),
);

remoteLayer("ProviderAdapterRegistryLive in redxtrm-remote mode", (it) => {
  it.effect("registers only RedClaw even when local adapters are available", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      assert.deepEqual(yield* registry.listProviders(), ["redclaw"]);
      assert.equal(yield* registry.getByProvider("redclaw"), fakeRedClawAdapter);
      const localAdapter = yield* registry.getByProvider("codex").pipe(Effect.result);
      assertFailure(localAdapter, new ProviderUnsupportedError({ provider: "codex" }));
    }),
  );
});

const unconfiguredRemoteLayer = it.layer(
  Layer.mergeAll(
    Layer.provide(
      makeProviderAdapterRegistryLive({ mode: "redxtrm-remote" }),
      Layer.mergeAll(
        Layer.succeed(CodexAdapter, fakeCodexAdapter),
        Layer.succeed(ClaudeAdapter, fakeClaudeAdapter),
        Layer.succeed(OpenCodeAdapter, fakeOpenCodeAdapter),
        Layer.succeed(CursorAdapter, fakeCursorAdapter),
      ),
    ),
    NodeServices.layer,
  ),
);

unconfiguredRemoteLayer("unconfigured redxtrm-remote provider registry", (it) => {
  it.effect("fails closed with no registered adapters", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      assert.deepEqual(yield* registry.listProviders(), []);
      const localAdapter = yield* registry.getByProvider("codex").pipe(Effect.result);
      const redClawAdapter = yield* registry.getByProvider("redclaw").pipe(Effect.result);
      assertFailure(localAdapter, new ProviderUnsupportedError({ provider: "codex" }));
      assertFailure(redClawAdapter, new ProviderUnsupportedError({ provider: "redclaw" }));
    }),
  );
});
