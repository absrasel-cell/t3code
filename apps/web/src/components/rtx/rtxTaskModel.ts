export type RtxTaskStatus = "done" | "ongoing" | "pending" | "error";

export interface RslDelegatedTask {
  readonly id: string;
  readonly objectiveId: string;
  readonly title: string;
  readonly status: RtxTaskStatus;
  readonly statusLabel: string;
  readonly source: "RSL Ai → RTX";
  readonly projectId: string;
  readonly origin: string;
  readonly updatedAt: string;
  readonly createdAt: string;
  readonly threadId: string;
  readonly environmentId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATUSES = new Set<RtxTaskStatus>(["done", "ongoing", "pending", "error"]);

export function isRslDelegatedTask(value: unknown): value is RslDelegatedTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<RslDelegatedTask>;
  return (
    typeof task.id === "string" &&
    UUID.test(task.id) &&
    task.source === "RSL Ai → RTX" &&
    typeof task.projectId === "string" &&
    task.projectId.length > 0 &&
    typeof task.title === "string" &&
    task.title.length > 0 &&
    typeof task.status === "string" &&
    STATUSES.has(task.status as RtxTaskStatus)
  );
}

export function selectRslDelegatedTasks(values: ReadonlyArray<unknown>): RslDelegatedTask[] {
  return values.filter(isRslDelegatedTask);
}
