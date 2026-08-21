import { describe, expect, it } from "vitest";

import { resolveAvailableProviderOptions } from "./ProviderModelPicker";

describe("resolveAvailableProviderOptions", () => {
  it("offers only RedClaw in remote builder mode", () => {
    expect(resolveAvailableProviderOptions(true).map((option) => option.value)).toEqual([
      "redclaw",
    ]);
  });

  it("preserves the normal T3 provider choices in local mode", () => {
    expect(resolveAvailableProviderOptions(false).map((option) => option.value)).toEqual([
      "codex",
      "claudeAgent",
      "opencode",
      "cursor",
    ]);
  });
});
