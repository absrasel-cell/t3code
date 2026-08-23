import { describe, expect, it } from "vite-plus/test";

import { parseRtxTaskTitle, presentRtxTask } from "./rtxTaskModel";

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

describe("RTX task presentation", () => {
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

  it("maps running, waiting, completed, and failed threads", () => {
    expect(
      presentRtxTask({
        ...baseThread,
        latestTurn: { state: "running" },
        planProgress: { step: "Run checks", completedSteps: 2, totalSteps: 4 },
      }),
    ).toMatchObject({ status: "ongoing", progressPercent: 50, detail: "Run checks" });
    expect(presentRtxTask({ ...baseThread, hasPendingUserInput: true })).toMatchObject({
      status: "pending",
      statusLabel: "Pending input",
    });
    expect(presentRtxTask({ ...baseThread, latestTurn: { state: "completed" } })).toMatchObject({
      status: "done",
    });
    expect(presentRtxTask({ ...baseThread, latestTurn: { state: "error" } })).toMatchObject({
      status: "error",
    });
  });
});
