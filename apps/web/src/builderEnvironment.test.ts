import { describe, expect, it } from "vitest";

import { resolveBuilderEnvironment } from "./builderEnvironment";

describe("resolveBuilderEnvironment", () => {
  it("preserves the normal T3 Code defaults", () => {
    const environment = resolveBuilderEnvironment({});

    expect(environment).toEqual({
      mode: "local",
      isRemote: false,
      branding: {
        baseName: "T3 Code",
        displayName: "T3 Code",
        stageLabel: null,
      },
      capabilities: {
        conversations: true,
        diffs: true,
        previews: true,
        terminal: true,
        usage: true,
      },
    });
  });

  it("uses RedXTRM branding and keeps terminal access disabled in remote mode", () => {
    const environment = resolveBuilderEnvironment({ appMode: "redxtrm-remote" });

    expect(environment.branding).toEqual({
      baseName: "RedXTRM Builder",
      displayName: "RedXTRM Builder",
      stageLabel: "Remote",
    });
    expect(environment.capabilities).toEqual({
      conversations: true,
      diffs: false,
      previews: false,
      terminal: false,
      usage: false,
    });
  });

  it("enables only safe build-time remote capabilities", () => {
    const environment = resolveBuilderEnvironment({
      appMode: " REDXTRM-REMOTE ",
      remoteCapabilities: " terminal, previews, unknown, TERMINAL ",
    });

    expect(environment.capabilities).toEqual({
      conversations: true,
      diffs: false,
      previews: true,
      terminal: false,
      usage: false,
    });
  });

  it("never treats a browser build flag as sandbox terminal attestation", () => {
    const environment = resolveBuilderEnvironment({
      appMode: "redxtrm-remote",
      remoteCapabilities: "terminal",
    });

    expect(environment.capabilities.terminal).toBe(false);
  });

  it("accepts build-time brand labels without changing local behavior", () => {
    const environment = resolveBuilderEnvironment({
      brandName: "Builder Preview",
      stageLabel: "QA",
    });

    expect(environment.mode).toBe("local");
    expect(environment.branding).toEqual({
      baseName: "Builder Preview",
      displayName: "Builder Preview (QA)",
      stageLabel: "QA",
    });
    expect(environment.capabilities.terminal).toBe(true);
  });
});
