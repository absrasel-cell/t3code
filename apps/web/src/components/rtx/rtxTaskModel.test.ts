import { describe, expect, it } from "vite-plus/test";

import {
  isRslDelegatedTask,
  resolveRslThreadTaskFilter,
  rslThreadTaskRetryDelay,
  selectAttachedRslDelegatedTasks,
  selectRslDelegatedTasks,
  selectRslDelegatedTaskForThread,
} from "./rtxTaskModel";

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

  it("excludes historical delegations without a live r3xCode thread attachment", () => {
    expect(
      selectAttachedRslDelegatedTasks([
        delegatedTask,
        { ...delegatedTask, id: "55555555-5555-4555-8555-555555555555", threadId: "" },
      ]),
    ).toEqual([delegatedTask]);
  });

  it("selects Ongoing for active threads and Done for saved completed threads", () => {
    const completedTask = {
      ...delegatedTask,
      id: "66666666-6666-4666-8666-666666666666",
      threadId: "77777777-7777-4777-8777-777777777777",
      status: "done",
    } as const;
    expect(
      resolveRslThreadTaskFilter(
        [delegatedTask, completedTask],
        delegatedTask.environmentId,
        delegatedTask.threadId,
      ),
    ).toBe("ongoing");
    expect(
      resolveRslThreadTaskFilter(
        [delegatedTask, completedTask],
        completedTask.environmentId,
        completedTask.threadId,
      ),
    ).toBe("done");
    expect(resolveRslThreadTaskFilter([delegatedTask], "local", "unrelated-thread")).toBeNull();
  });

  it("returns only the delegation linked to the open thread", () => {
    const otherCompletedTask = {
      ...delegatedTask,
      id: "88888888-8888-4888-8888-888888888888",
      threadId: "99999999-9999-4999-8999-999999999999",
      title: "Unrelated completed work",
      status: "done",
    } as const;

    expect(
      selectRslDelegatedTaskForThread(
        [delegatedTask, otherCompletedTask],
        delegatedTask.environmentId,
        delegatedTask.threadId,
      ),
    ).toEqual(delegatedTask);
    expect(
      selectRslDelegatedTaskForThread(
        [delegatedTask, otherCompletedTask],
        otherCompletedTask.environmentId,
        "unrelated-thread",
      ),
    ).toBeNull();
  });

  it("retries a new thread attachment without a five-second dead period", () => {
    expect(rslThreadTaskRetryDelay(1)).toBe(250);
    expect(rslThreadTaskRetryDelay(8)).toBe(250);
    expect(rslThreadTaskRetryDelay(9)).toBe(1_000);
  });
});
