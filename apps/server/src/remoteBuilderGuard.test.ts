import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  guardRemoteBuilderEffect,
  guardRemoteBuilderStream,
  makeRemoteBuilderDenial,
} from "./remoteBuilderGuard.ts";
import { SERVER_APP_MODES } from "./remoteBuilderMode.ts";

describe("remoteBuilderGuard", () => {
  it("returns a typed, sanitized denial", () => {
    const denial = makeRemoteBuilderDenial("terminal");

    expect(denial._tag).toBe("RemoteBuilderAccessDeniedError");
    expect(denial.capability).toBe("terminal");
    expect(denial.message).toBe("terminal is unavailable in server-enforced remote builder mode.");
    expect(denial).not.toHaveProperty("cause");
  });

  it.each([
    "terminal",
    "git",
    "workspaceBrowse",
    "workspaceWrite",
    "openInEditor",
    "globalSettingsMutation",
    "providerRefresh",
  ] as const)(
    "blocks direct %s effects before their handlers run in remote mode",
    async (capability) => {
      let invoked = false;
      const guarded = guardRemoteBuilderEffect(
        SERVER_APP_MODES.redxtrmRemote,
        capability,
        Effect.sync(() => {
          invoked = true;
          return "unsafe local operation";
        }),
      );

      const denial = await Effect.runPromise(Effect.flip(guarded));

      expect(denial._tag).toBe("RemoteBuilderAccessDeniedError");
      expect(denial.capability).toBe(capability);
      expect(invoked).toBe(false);
    },
  );

  it("preserves the existing handler in local mode", async () => {
    let invoked = false;
    const result = await Effect.runPromise(
      guardRemoteBuilderEffect(
        SERVER_APP_MODES.local,
        "terminal",
        Effect.sync(() => {
          invoked = true;
          return "allowed";
        }),
      ),
    );

    expect(result).toBe("allowed");
    expect(invoked).toBe(true);
  });

  it("blocks streaming handlers before their producer runs in remote mode", async () => {
    let invoked = false;
    const guarded = guardRemoteBuilderStream(
      SERVER_APP_MODES.redxtrmRemote,
      "terminal",
      Stream.fromEffect(
        Effect.sync(() => {
          invoked = true;
          return "unsafe event";
        }),
      ),
    );

    const denial = await Effect.runPromise(Effect.flip(Stream.runCollect(guarded)));

    expect(denial._tag).toBe("RemoteBuilderAccessDeniedError");
    expect(invoked).toBe(false);
  });
});
