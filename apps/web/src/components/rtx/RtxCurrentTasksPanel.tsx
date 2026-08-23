import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Check, Circle, LoaderCircle, RotateCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { useThreadShells } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";

import { readRtxOrchestratorState, type RtxOrchestratorState } from "./rtxApi";
import { selectRslDelegatedTasks, type RslDelegatedTask, type RtxTaskStatus } from "./rtxTaskModel";

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

export function RtxCurrentTasksPanel() {
  const navigate = useNavigate();
  const threads = useThreadShells();
  const [filter, setFilter] = useState<TaskFilter>("ongoing");
  const [state, setState] = useState<RtxOrchestratorState | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (showSpinner = true) => {
    if (showSpinner) setRefreshing(true);
    try {
      const next = await readRtxOrchestratorState();
      setState(next);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read RedClaw task state.");
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh(false);
    const interval = window.setInterval(() => void refresh(false), 5_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const tasks = useMemo(() => selectRslDelegatedTasks(state?.rslTasks ?? []), [state?.rslTasks]);
  const projectNames = useMemo(
    () => new Map((state?.projects ?? []).map((project) => [project.id, project.name])),
    [state?.projects],
  );
  const threadById = useMemo(() => {
    const byId = new Map<string, (typeof threads)[number]>();
    for (const thread of threads) {
      byId.set(`${thread.environmentId}:${thread.id}`, thread);
    }
    return byId;
  }, [threads]);
  const counts = useMemo(
    () => ({
      ongoing: tasks.filter((task) => task.status === "ongoing").length,
      pending: tasks.filter((task) => task.status === "pending").length,
      done: tasks.filter((task) => task.status === "done").length,
    }),
    [tasks],
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
      <div className="border-b border-border/70 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-sm">Current Tasks</h2>
            <p className="mt-0.5 text-muted-foreground text-xs">
              Development tasks delegated by RSL Ai to RTX at RedClaw.
            </p>
          </div>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Refresh RSL tasks"
            onClick={() => void refresh()}
          >
            <RotateCw className={cn(refreshing && "animate-spin")} />
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            ["Ongoing", counts.ongoing, "text-info"],
            ["Pending", counts.pending, "text-warning"],
            ["Done", counts.done, "text-success"],
          ].map(([label, count, tone]) => (
            <div
              key={String(label)}
              className="rounded-lg border border-border/70 bg-card px-2.5 py-2"
            >
              <div className={cn("font-semibold text-lg tabular-nums", tone)}>{count}</div>
              <div className="text-[10px] text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
        {error ? <p className="mt-2 text-destructive text-xs">{error}</p> : null}
      </div>

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
              const thread = threadById.get(`${task.environmentId}:${task.threadId}`);
              const progress = thread?.planProgress;
              const progressPercent =
                progress && progress.totalSteps > 0
                  ? Math.min(100, Math.round((progress.completedSteps / progress.totalSteps) * 100))
                  : null;
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
                  {progress ? (
                    <div className="mt-2.5 pl-7.5">
                      <div className="truncate text-[11px] text-muted-foreground">
                        {progress.step}
                      </div>
                      {progressPercent !== null ? (
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-info"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
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
