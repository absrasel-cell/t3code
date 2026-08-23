import { describe, expect, it } from "vite-plus/test";

import {
  currentTaskProviderForDriver,
  parseRtxTaskTitle,
  presentCurrentTask,
} from "./rtxTaskModel";

const baseThread = {
  title: "[whatsapp] Repair the invoice flow",
  archivedAt: null,
  latestTurn: null,
  session: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  backgroundLiveness: null,
  planProgress: null,
} as const;

describe("current task presentation", () => {
  it("accepts current and future RedClaw origin markers", () => {
    expect(parseRtxTaskTitle("[whatsapp] Fix login")).toEqual({
      origin: "whatsapp",
      title: "Fix login",
    });
    expect(parseRtxTaskTitle("[future-channel] Fix login")).toEqual({
      origin: "future-channel",
      title: "Fix login",
    });
    expect(parseRtxTaskTitle("Ordinary web thread")).toBeNull();
  });

  it("recognizes Codex and Claude execution providers", () => {
    expect(currentTaskProviderForDriver("codex")).toBe("Codex");
    expect(currentTaskProviderForDriver("claudeAgent")).toBe("Claude");
    expect(currentTaskProviderForDriver("cursor")).toBeNull();
  });

  it("keeps ordinary Codex and Claude threads in the task list", () => {
    expect(
      presentCurrentTask(
        { ...baseThread, title: "Ordinary web thread", latestTurn: { state: "running" } },
        "Claude",
      ),
    ).toMatchObject({
      title: "Ordinary web thread",
      origin: null,
      provider: "Claude",
      status: "ongoing",
    });
  });

  it("maps running, waiting, completed, and failed threads", () => {
    expect(
      presentCurrentTask(
        {
          ...baseThread,
          latestTurn: { state: "running" },
          planProgress: { step: "Run checks", completedSteps: 2, totalSteps: 4 },
        },
        "Codex",
      ),
    ).toMatchObject({ status: "ongoing", progressPercent: 50, detail: "Run checks" });
    expect(presentCurrentTask({ ...baseThread, hasPendingUserInput: true }, "Codex")).toMatchObject(
      {
        status: "pending",
        statusLabel: "Pending input",
      },
    );
    expect(
      presentCurrentTask({ ...baseThread, latestTurn: { state: "completed" } }, "Claude"),
    ).toMatchObject({ status: "done" });
    expect(
      presentCurrentTask({ ...baseThread, latestTurn: { state: "error" } }, "Claude"),
    ).toMatchObject({ status: "error" });
  });
});
