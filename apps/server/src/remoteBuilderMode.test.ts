import { describe, expect, it } from "vitest";
import {
  isRemoteBuilderMode,
  resolveServerAppMode,
  resolveServerAppModeFromEnv,
  SERVER_APP_MODES,
} from "./remoteBuilderMode.ts";

describe("remoteBuilderMode", () => {
  it("preserves local mode when the server mode is unset", () => {
    expect(resolveServerAppMode(undefined)).toBe(SERVER_APP_MODES.local);
    expect(resolveServerAppModeFromEnv({})).toBe(SERVER_APP_MODES.local);
  });

  it("recognizes the dedicated server-side remote mode", () => {
    const mode = resolveServerAppModeFromEnv({ T3_APP_MODE: " redxtrm-remote " });

    expect(mode).toBe(SERVER_APP_MODES.redxtrmRemote);
    expect(isRemoteBuilderMode(mode)).toBe(true);
  });

  it("rejects unknown explicit modes instead of silently enabling local capabilities", () => {
    expect(() => resolveServerAppMode("redxtrm-remtoe")).toThrowError(
      "Invalid T3_APP_MODE. Expected 'local' or 'redxtrm-remote'.",
    );
  });
});
