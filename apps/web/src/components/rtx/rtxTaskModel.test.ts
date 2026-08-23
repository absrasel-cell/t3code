import { describe, expect, it } from "vite-plus/test";

import { isRslDelegatedTask, selectRslDelegatedTasks } from "./rtxTaskModel";

const delegatedTask = {
  id: "11111111-1111-4111-8111-111111111111",
  objectiveId: "22222222-2222-4222-8222-222222222222",
  title: "Repair the invoice flow",
  status: "ongoing",
  statusLabel: "RTX working",
  source: "RSL Ai → RTX",
  projectId: "llp.rag_backend",
  origin: "whatsapp",
  updatedAt: "2026-08-23T10:01:00Z",
  createdAt: "2026-08-23T10:00:00Z",
  threadId: "33333333-3333-4333-8333-333333333333",
  environmentId: "local",
  checklist: [
    { id: "task-1", title: "Inspect repository instructions", status: "done" },
    { id: "task-2", title: "Reproduce the build failure", status: "ongoing" },
    { id: "task-3", title: "Run the authoritative checks", status: "pending" },
  ],
} as const;

describe("RSL delegated task selection", () => {
  it("accepts the RedClaw RSL to RTX delegation contract", () => {
    expect(isRslDelegatedTask(delegatedTask)).toBe(true);
    expect(selectRslDelegatedTasks([delegatedTask])).toEqual([delegatedTask]);
  });

  it("excludes ordinary Codex and Claude provider work", () => {
    const ordinaryThread = {
      id: "44444444-4444-4444-8444-444444444444",
      title: "Ordinary web thread",
      status: "ongoing",
      source: "Codex",
      projectId: "llp.rag_backend",
    };
    expect(isRslDelegatedTask(ordinaryThread)).toBe(false);
    expect(selectRslDelegatedTasks([ordinaryThread])).toEqual([]);
  });

  it("rejects a forged label without a real delegation UUID", () => {
    expect(isRslDelegatedTask({ ...delegatedTask, id: "not-a-delegation" })).toBe(false);
  });

  it("rejects provider-authored plan rows in place of the delegation checklist", () => {
    expect(
      isRslDelegatedTask({
        ...delegatedTask,
        checklist: [{ id: "task-1", title: "Inspect files", status: "inProgress" }],
      }),
    ).toBe(false);
  });
});
