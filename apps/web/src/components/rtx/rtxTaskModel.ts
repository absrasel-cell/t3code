export type RtxTaskStatus = "done" | "ongoing" | "pending" | "error";
export type RslChecklistItemStatus = "done" | "ongoing" | "pending";

export interface RslChecklistItem {
  readonly id: string;
  readonly title: string;
  readonly status: RslChecklistItemStatus;
}

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
  readonly checklist: ReadonlyArray<RslChecklistItem>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATUSES = new Set<RtxTaskStatus>(["done", "ongoing", "pending", "error"]);
const CHECKLIST_STATUSES = new Set<RslChecklistItemStatus>(["done", "ongoing", "pending"]);

function isRslChecklistItem(value: unknown): value is RslChecklistItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RslChecklistItem>;
  return (
    typeof item.id === "string" &&
    /^[a-z0-9][a-z0-9-]{0,63}$/.test(item.id) &&
    typeof item.title === "string" &&
    item.title.length > 0 &&
    typeof item.status === "string" &&
    CHECKLIST_STATUSES.has(item.status as RslChecklistItemStatus)
  );
}

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
    STATUSES.has(task.status as RtxTaskStatus) &&
    Array.isArray(task.checklist) &&
    task.checklist.every(isRslChecklistItem)
  );
}

export function selectRslDelegatedTasks(values: ReadonlyArray<unknown>): RslDelegatedTask[] {
  return values.filter(isRslDelegatedTask);
}

export function selectAttachedRslDelegatedTasks(
  values: ReadonlyArray<unknown>,
): RslDelegatedTask[] {
  return selectRslDelegatedTasks(values).filter(
    (task) => task.environmentId.length > 0 && task.threadId.length > 0,
  );
}
