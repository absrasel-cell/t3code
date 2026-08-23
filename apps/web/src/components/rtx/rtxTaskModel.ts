export type RtxTaskStatus = "done" | "ongoing" | "pending" | "error";
export type CurrentTaskProvider = "Codex" | "Claude";

export interface RtxTaskThreadShape {
  readonly title: string;
  readonly archivedAt: string | null;
  readonly latestTurn: { readonly state: "running" | "interrupted" | "completed" | "error" } | null;
  readonly session: { readonly status: string } | null;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
  readonly backgroundLiveness?: "working" | "monitoring" | null | undefined;
  readonly planProgress?:
    | {
        readonly step: string;
        readonly completedSteps: number;
        readonly totalSteps: number;
      }
    | null
    | undefined;
}

export interface RtxTaskPresentation {
  readonly title: string;
  readonly origin: string | null;
  readonly provider: CurrentTaskProvider;
  readonly status: RtxTaskStatus;
  readonly statusLabel: string;
  readonly archived: boolean;
  readonly detail: string | null;
  readonly progressPercent: number | null;
}

const ORIGIN_PREFIX = /^\[([a-z][a-z0-9-]{1,23})\]\s+(.+)$/;

export function parseRtxTaskTitle(title: string): { origin: string; title: string } | null {
  const match = ORIGIN_PREFIX.exec(title.trim());
  if (!match) return null;
  return { origin: match[1]!, title: match[2]!.trim() };
}

export function currentTaskProviderForDriver(
  driverKind: string | null | undefined,
): CurrentTaskProvider | null {
  if (driverKind === "codex") return "Codex";
  if (driverKind === "claudeAgent") return "Claude";
  return null;
}

export function presentCurrentTask(
  thread: RtxTaskThreadShape,
  provider: CurrentTaskProvider,
): RtxTaskPresentation {
  const parsed = parseRtxTaskTitle(thread.title);

  const waiting = thread.hasPendingApprovals || thread.hasPendingUserInput;
  const running =
    thread.latestTurn?.state === "running" ||
    thread.session?.status === "starting" ||
    thread.session?.status === "running" ||
    thread.backgroundLiveness === "working" ||
    thread.backgroundLiveness === "monitoring";
  const errored = thread.latestTurn?.state === "error" || thread.session?.status === "error";
  const status: RtxTaskStatus = errored
    ? "error"
    : waiting
      ? "pending"
      : running
        ? "ongoing"
        : thread.latestTurn?.state === "completed"
          ? "done"
          : "pending";
  const statusLabel = errored
    ? "Error"
    : thread.hasPendingApprovals
      ? "Pending approval"
      : thread.hasPendingUserInput
        ? "Pending input"
        : status === "ongoing"
          ? thread.backgroundLiveness === "monitoring"
            ? "Monitoring"
            : "Ongoing"
          : status === "done"
            ? "Done"
            : "Pending";
  const progress = thread.planProgress;
  const progressPercent =
    progress && progress.totalSteps > 0
      ? Math.min(100, Math.round((progress.completedSteps / progress.totalSteps) * 100))
      : null;

  return {
    title: parsed?.title ?? thread.title.trim(),
    origin: parsed?.origin ?? null,
    provider,
    status,
    statusLabel,
    archived: thread.archivedAt !== null,
    detail: progress?.step ?? null,
    progressPercent,
  };
}
