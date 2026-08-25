import type { ScopedThreadRef } from "@t3tools/contracts";
import { CheckCircle2, Circle, CircleDot, ListTodo } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "~/lib/utils";
import type { ComposerTaskStep, ComposerTasksProgress } from "~/components/chat/ComposerTasksBadge";

import { readRtxThreadTask, type RtxThreadTaskState } from "./rtxApi";
import { type RslChecklistItem } from "./rtxTaskModel";

const EMPTY_THREAD_TODO_STEPS: readonly ComposerTaskStep[] = [];

function keyedThreadTodoSteps(steps: readonly ComposerTaskStep[]) {
  const occurrences = new Map<string, number>();
  return steps.map((item, index) => {
    const occurrence = occurrences.get(item.step) ?? 0;
    occurrences.set(item.step, occurrence + 1);
    return { index, item, key: `${item.step}:${occurrence}` };
  });
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function DelegationChecklist({ items }: { readonly items: ReadonlyArray<RslChecklistItem> }) {
  const completed = items.filter((item) => item.status === "done").length;
  const nextPendingId = items.find((item) => item.status === "pending")?.id ?? null;

  return (
    <section className="mt-4" data-rsl-delegation-checklist="true">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-border/60 border-y py-2 text-[10px] text-muted-foreground uppercase tracking-wide">
        <span className="flex items-center gap-1.5">
          <ListTodo aria-hidden className="size-3.5" />
          Task
        </span>
        <span className="tabular-nums">
          Status · {completed}/{items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="py-3 text-[11px] text-muted-foreground/70">
          No RSL/RTX checklist was recorded for this older delegation.
        </p>
      ) : (
        <div className="divide-y divide-border/45" role="list">
          {items.map((item) => {
            const label =
              item.status === "done"
                ? "done"
                : item.status === "ongoing"
                  ? "now"
                  : item.id === nextPendingId
                    ? "up next"
                    : "pending";
            return (
              <div
                key={item.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 py-2.5 text-[11px] leading-4"
                role="listitem"
              >
                <span className="flex min-w-0 items-start gap-2.5">
                  {item.status === "done" ? (
                    <CheckCircle2 aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />
                  ) : item.status === "ongoing" ? (
                    <CircleDot aria-hidden className="mt-0.5 size-3.5 shrink-0 text-info" />
                  ) : (
                    <Circle
                      aria-hidden
                      className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/35"
                    />
                  )}
                  <span
                    className={cn(
                      "min-w-0",
                      item.status === "done"
                        ? "text-muted-foreground/60"
                        : item.status === "ongoing"
                          ? "text-foreground"
                          : "text-muted-foreground/75",
                    )}
                  >
                    {item.title}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 pt-px text-[10px] tabular-nums",
                    item.status === "ongoing"
                      ? "text-info"
                      : item.status === "done"
                        ? "text-success/70"
                        : "text-muted-foreground/45",
                  )}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ThreadTodoChecklist({
  progress,
  steps,
}: {
  readonly progress: ComposerTasksProgress | null;
  readonly steps: readonly ComposerTaskStep[];
}) {
  const completed = steps.filter((item) => item.status === "completed").length;
  const nextPendingIndex = steps.findIndex((item) => item.status === "pending");

  return (
    <article data-thread-todo="true">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-border/60 border-y py-2 text-[10px] text-muted-foreground uppercase tracking-wide">
        <span className="flex items-center gap-1.5">
          <ListTodo aria-hidden className="size-3.5" />
          Agent plan
        </span>
        <span className="tabular-nums">
          Status · {completed}/{steps.length}
        </span>
      </div>
      <div className="divide-y divide-border/45" role="list">
        {keyedThreadTodoSteps(steps).map(({ index, item, key }) => {
          const label =
            item.status === "completed"
              ? "done"
              : item.status === "inProgress"
                ? "now"
                : index === nextPendingIndex
                  ? "up next"
                  : "pending";
          return (
            <div
              key={key}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 py-2.5 text-[11px] leading-4"
              role="listitem"
            >
              <span className="flex min-w-0 items-start gap-2.5">
                {item.status === "completed" ? (
                  <CheckCircle2 aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />
                ) : item.status === "inProgress" ? (
                  <CircleDot aria-hidden className="mt-0.5 size-3.5 shrink-0 text-info" />
                ) : (
                  <Circle
                    aria-hidden
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/35"
                  />
                )}
                <span
                  className={cn(
                    "min-w-0",
                    item.status === "completed"
                      ? "text-muted-foreground/60"
                      : item.status === "inProgress"
                        ? "text-foreground"
                        : "text-muted-foreground/75",
                  )}
                >
                  {item.step}
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 pt-px text-[10px] tabular-nums",
                  item.status === "inProgress"
                    ? "text-info"
                    : item.status === "completed"
                      ? "text-success/70"
                      : "text-muted-foreground/45",
                )}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
      {progress ? (
        <p className="border-border/45 border-t pt-2 text-[10px] text-muted-foreground">
          Current · {progress.step}
        </p>
      ) : null}
    </article>
  );
}

export function RtxCurrentTasksPanel({
  progress = null,
  source = "rtx",
  steps = EMPTY_THREAD_TODO_STEPS,
  threadRef,
}: {
  readonly progress?: ComposerTasksProgress | null;
  readonly source?: "rtx" | "thread";
  readonly steps?: readonly ComposerTaskStep[];
  readonly threadRef: ScopedThreadRef;
}) {
  const [state, setState] = useState<RtxThreadTaskState | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (source === "thread") return;
    try {
      const next = await readRtxThreadTask(threadRef.environmentId, threadRef.threadId);
      setState(next);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read RedClaw task state.");
    }
  }, [source, threadRef.environmentId, threadRef.threadId]);

  useEffect(() => {
    if (source === "thread") return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(interval);
  }, [source, refresh]);

  const linkedTask = state?.task ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background" data-rtx-current-tasks>
      {source === "rtx" && error ? (
        <p className="border-b border-border/70 px-3 py-2 text-destructive text-xs">{error}</p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {source === "thread" && steps.length > 0 ? (
          <ThreadTodoChecklist progress={progress} steps={steps} />
        ) : source === "thread" ? (
          <div className="flex min-h-48 flex-col items-center justify-center text-center">
            <Circle className="size-7 text-muted-foreground/35" />
            <p className="mt-3 font-medium text-sm">No agent plan yet</p>
            <p className="mt-1 max-w-64 text-muted-foreground text-xs">
              Tasks appear here when this thread's agent publishes a plan.
            </p>
          </div>
        ) : state === null && !error ? null : linkedTask === null ? (
          <div className="flex min-h-48 flex-col items-center justify-center text-center">
            <Circle className="size-7 text-muted-foreground/35" />
            <p className="mt-3 font-medium text-sm">No RSL delegated task</p>
            <p className="mt-1 max-w-64 text-muted-foreground text-xs">
              This thread is not linked to an RSL Ai development handoff.
            </p>
          </div>
        ) : (
          <article key={linkedTask.id}>
            <div className="min-w-0">
              <span className="block font-medium text-sm leading-snug">{linkedTask.title}</span>
              <span className="mt-1.5 block truncate text-[11px] text-muted-foreground">
                {[
                  state?.projectName || linkedTask.projectId,
                  linkedTask.source,
                  linkedTask.origin,
                  formatUpdatedAt(linkedTask.updatedAt),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            <DelegationChecklist items={linkedTask.checklist} />
          </article>
        )}
      </div>
    </div>
  );
}
