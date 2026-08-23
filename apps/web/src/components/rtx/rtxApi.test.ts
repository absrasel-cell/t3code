import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { clearRtxThreadTaskCacheForTests, readRtxThreadTask } from "./rtxApi";

const task = {
  id: "11111111-1111-4111-8111-111111111111",
  objectiveId: "22222222-2222-4222-8222-222222222222",
  title: "Repair the invoice flow",
  status: "done",
  statusLabel: "Done",
  source: "RSL Ai → RTX",
  projectId: "llp.rag_backend",
  origin: "whatsapp",
  updatedAt: "2026-08-23T10:01:00Z",
  createdAt: "2026-08-23T10:00:00Z",
  threadId: "33333333-3333-4333-8333-333333333333",
  environmentId: "local",
  checklist: [{ id: "task-1", title: "Inspect repository instructions", status: "done" }],
} as const;

afterEach(() => {
  clearRtxThreadTaskCacheForTests();
  vi.unstubAllGlobals();
});

describe("RTX thread task reads", () => {
  it("shares one fast-path request between thread auto-open and panel mount", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        task,
        projectName: "LLP RAG Backend",
        checkedAt: "2026-08-23T10:02:00Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      readRtxThreadTask(task.environmentId, task.threadId),
      readRtxThreadTask(task.environmentId, task.threadId),
    ]);
    const cached = await readRtxThreadTask(task.environmentId, task.threadId);

    expect(first.task).toEqual(task);
    expect(second).toEqual(first);
    expect(cached).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/rtx/thread-task?environmentId=${task.environmentId}&threadId=${task.threadId}`,
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("does not cache a missing attachment while a new RTX thread is being linked", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ task: null, projectName: "", checkedAt: "2026-08-23T10:02:00Z" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await readRtxThreadTask("local", task.threadId);
    await readRtxThreadTask("local", task.threadId);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
