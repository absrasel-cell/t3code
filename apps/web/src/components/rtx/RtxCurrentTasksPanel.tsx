import type { ScopedThreadRef } from "@t3tools/contracts";
import { CheckCircle2, Circle, CircleDot, ListTodo } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "~/lib/utils";

import { readRtxThreadTask, type RtxThreadTaskState } from "./rtxApi";
import {
  type RslChecklistItem,
  type RslThreadTaskFilter,
  type RtxTaskStatus,
} from "./rtxTaskModel";

type TaskFilter = "all" | RtxTaskStatus;

const FILTERS: ReadonlyArray<{ id: TaskFilter; label: string }> = [
  { id: "ongoing", label: "Ongoing" },
  { id: "pending", label: "Pending" },
  { id: "done", label: "Done" },
  { id: "error", label: "Error" },
  { id: "all", label: "All" },
];

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

export function RtxCurrentTasksPanel({
  threadRef,
  initialFilter = "ongoing",
}: {
  readonly threadRef: ScopedThreadRef;
  readonly initialFilter?: RslThreadTaskFilter;
}) {
  const [filter, setFilter] = useState<TaskFilter>(initialFilter);
  const [state, setState] = useState<RtxThreadTaskState | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await readRtxThreadTask(threadRef.environmentId, threadRef.threadId);
      setState(next);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read RedClaw task state.");
    }
  }, [threadRef.environmentId, threadRef.threadId]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const linkedTask = state?.task ?? null;
  const visibleTasks =
    linkedTask && (filter === "all" || linkedTask.status === filter) ? [linkedTask] : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background" data-rtx-current-tasks>
      <div className="flex gap-1 overflow-x-auto border-b border-border/70 px-3 py-2">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            className={cn(
              "shrink-0 rounded-full border px-2.5 py-1 text-[11px] transition",
              filter === item.id
                ? "border-foreground/20 bg-foreground text-background"
                : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {error ? (
        <p className="border-b border-border/70 px-3 py-2 text-destructive text-xs">{error}</p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {visibleTasks.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center text-center">
            <Circle className="size-7 text-muted-foreground/35" />
            <p className="mt-3 font-medium text-sm">
              No {filter === "all" ? "RSL delegated" : filter} tasks
            </p>
            <p className="mt-1 max-w-64 text-muted-foreground text-xs">
              An RSL Ai development handoff appears here as soon as RedClaw delegates it to RTX.
            </p>
          </div>
        ) : (
          <div>
            {visibleTasks.map((task) => {
              return (
                <article key={task.id}>
                  <div className="min-w-0">
                    <span className="block font-medium text-sm leading-snug">{task.title}</span>
                    <span className="mt-1.5 block truncate text-[11px] text-muted-foreground">
                      {[
                        state?.projectName || task.projectId,
                        task.source,
                        task.origin,
                        formatUpdatedAt(task.updatedAt),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  <DelegationChecklist items={task.checklist} />
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
