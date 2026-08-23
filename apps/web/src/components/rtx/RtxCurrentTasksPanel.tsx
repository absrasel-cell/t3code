import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  Check,
  CheckCircle2,
  Circle,
  CircleDot,
  ListTodo,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { buildThreadRouteParams } from "~/threadRoutes";

import { readRtxOrchestratorState, type RtxOrchestratorState } from "./rtxApi";
import {
  selectRslDelegatedTasks,
  type RslChecklistItem,
  type RslDelegatedTask,
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

function TaskStatusIcon({ status }: { status: RtxTaskStatus }) {
  if (status === "done") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
        <Check className="size-3.5" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === "ongoing") {
    return <LoaderCircle className="size-5 shrink-0 animate-spin text-info" />;
  }
  if (status === "error") {
    return <TriangleAlert className="size-5 shrink-0 text-destructive" />;
  }
  return <Circle className="size-5 shrink-0 text-muted-foreground/60" />;
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
    <section
      className="mt-3 rounded-lg border border-border/60 bg-background/45 px-2.5 py-2"
      data-rsl-delegation-checklist="true"
    >
      <div className="flex items-center gap-1.5 text-[11px]">
        <ListTodo aria-hidden className="size-3.5 text-muted-foreground" />
        <span className="font-medium">Tasks</span>
        <span className="text-muted-foreground tabular-nums">
          {completed}/{items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground/70">
          No RSL/RTX checklist was recorded for this older delegation.
        </p>
      ) : (
        <div className="mt-1.5 space-y-0.5" role="list">
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
                className="flex items-start gap-2 py-0.5 text-[11px] leading-4"
                role="listitem"
              >
                {item.status === "done" ? (
                  <CheckCircle2 aria-hidden className="mt-0.5 size-3 shrink-0 text-success" />
                ) : item.status === "ongoing" ? (
                  <CircleDot aria-hidden className="mt-0.5 size-3 shrink-0 text-info" />
                ) : (
                  <Circle aria-hidden className="mt-0.5 size-3 shrink-0 text-muted-foreground/35" />
                )}
                <span
                  className={cn(
                    "min-w-0 flex-1",
                    item.status === "done"
                      ? "text-muted-foreground/55"
                      : item.status === "ongoing"
                        ? "text-foreground"
                        : "text-muted-foreground/70",
                  )}
                >
                  {item.title}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[10px]",
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

export function RtxCurrentTasksPanel() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<TaskFilter>("ongoing");
  const [state, setState] = useState<RtxOrchestratorState | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await readRtxOrchestratorState();
      setState(next);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read RedClaw task state.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const tasks = useMemo(() => selectRslDelegatedTasks(state?.rslTasks ?? []), [state?.rslTasks]);
  const projectNames = useMemo(
    () => new Map((state?.projects ?? []).map((project) => [project.id, project.name])),
    [state?.projects],
  );
  const visibleTasks = tasks.filter((task) => filter === "all" || task.status === filter);

  const openThread = (task: RslDelegatedTask) => {
    if (!task.environmentId || !task.threadId) return;
    const threadRef = scopeThreadRef(
      EnvironmentId.make(task.environmentId),
      ThreadId.make(task.threadId),
    );
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
    });
  };

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
          <div className="space-y-2">
            {visibleTasks.map((task) => {
              return (
                <article key={task.id} className="rounded-xl border border-border/70 bg-card p-3">
                  <div className="flex w-full items-start gap-2.5 text-left">
                    <TaskStatusIcon status={task.status} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-sm leading-snug">{task.title}</span>
                      <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                        {[
                          projectNames.get(task.projectId) ?? task.projectId,
                          task.source,
                          task.origin,
                          formatUpdatedAt(task.updatedAt),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      {task.statusLabel}
                    </span>
                  </div>
                  <DelegationChecklist items={task.checklist} />
                  <div className="mt-2.5 flex justify-end border-t border-border/60 pt-2">
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={!task.environmentId || !task.threadId}
                      onClick={() => openThread(task)}
                    >
                      {task.threadId ? "Open r3xCode thread" : "Thread link pending"}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
