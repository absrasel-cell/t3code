import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  Check,
  Circle,
  LoaderCircle,
  RotateCw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useThreadActions } from "~/hooks/useThreadActions";
import { cn } from "~/lib/utils";
import { useProjects, useThreadShells } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import { Button } from "~/components/ui/button";

import { presentRtxTask, type RtxTaskStatus } from "./rtxTaskModel";

type TaskFilter = "all" | RtxTaskStatus | "archived";

const FILTERS: ReadonlyArray<{ id: TaskFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "ongoing", label: "Ongoing" },
  { id: "pending", label: "Pending" },
  { id: "done", label: "Done" },
  { id: "error", label: "Error" },
  { id: "archived", label: "Archived" },
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
  const projects = useProjects();
  const { archiveThread, unarchiveThread, deleteThread } = useThreadActions();
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [busyThreadKey, setBusyThreadKey] = useState<string | null>(null);

  const projectNames = useMemo(
    () =>
      new Map(projects.map((project) => [`${project.environmentId}:${project.id}`, project.title])),
    [projects],
  );
  const tasks = useMemo(
    () =>
      threads
        .flatMap((thread) => {
          const presentation = presentRtxTask(thread);
          return presentation ? [{ thread, presentation }] : [];
        })
        .sort((left, right) => right.thread.updatedAt.localeCompare(left.thread.updatedAt)),
    [threads],
  );
  const counts = useMemo(
    () => ({
      ongoing: tasks.filter(
        (task) => !task.presentation.archived && task.presentation.status === "ongoing",
      ).length,
      pending: tasks.filter(
        (task) => !task.presentation.archived && task.presentation.status === "pending",
      ).length,
      done: tasks.filter(
        (task) => !task.presentation.archived && task.presentation.status === "done",
      ).length,
    }),
    [tasks],
  );
  const visibleTasks = tasks.filter(({ presentation }) => {
    if (filter === "archived") return presentation.archived;
    if (presentation.archived) return false;
    return filter === "all" || presentation.status === filter;
  });

  const openThread = (threadRef: ScopedThreadRef) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
    });
  };
  const runMutation = async (threadRef: ScopedThreadRef, mutation: () => Promise<unknown>) => {
    const key = scopedThreadKey(threadRef);
    setBusyThreadKey(key);
    try {
      await mutation();
    } finally {
      setBusyThreadKey((current) => (current === key ? null : current));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background" data-rtx-current-tasks>
      <div className="border-b border-border/70 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-sm">Current Tasks</h2>
            <p className="mt-0.5 text-muted-foreground text-xs">
              r3xCode threads created through RedClaw and RTX.
            </p>
          </div>
          <span className="rounded-full bg-muted px-2 py-1 font-medium text-[10px] text-muted-foreground">
            {tasks.length} total
          </span>
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
              No {filter === "all" ? "current" : filter} tasks
            </p>
            <p className="mt-1 max-w-64 text-muted-foreground text-xs">
              RTX-created threads appear here as soon as RedClaw sends them to r3xCode.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleTasks.map(({ thread, presentation }) => {
              const threadRef = scopeThreadRef(thread.environmentId, thread.id);
              const threadKey = scopedThreadKey(threadRef);
              const busy = busyThreadKey === threadKey;
              const projectName =
                projectNames.get(`${thread.environmentId}:${thread.projectId}`) ??
                "Unknown project";
              return (
                <article key={threadKey} className="rounded-xl border border-border/70 bg-card p-3">
                  <button
                    type="button"
                    className="flex w-full items-start gap-2.5 text-left"
                    onClick={() => openThread(threadRef)}
                  >
                    <TaskStatusIcon status={presentation.status} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-sm leading-snug">
                        {presentation.title}
                      </span>
                      <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                        {projectName} · {presentation.origin} · {formatUpdatedAt(thread.updatedAt)}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      {presentation.statusLabel}
                    </span>
                  </button>
                  {presentation.detail ? (
                    <div className="mt-2.5 pl-7.5">
                      <div className="truncate text-[11px] text-muted-foreground">
                        {presentation.detail}
                      </div>
                      {presentation.progressPercent !== null ? (
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-info"
                            style={{ width: `${presentation.progressPercent}%` }}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="mt-2.5 flex justify-end gap-1 border-t border-border/60 pt-2">
                    <Button size="xs" variant="ghost" onClick={() => openThread(threadRef)}>
                      Open
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      disabled={busy || presentation.status === "ongoing"}
                      aria-label={presentation.archived ? "Restore thread" : "Archive thread"}
                      onClick={() =>
                        void runMutation(threadRef, () =>
                          presentation.archived
                            ? unarchiveThread(threadRef)
                            : archiveThread(threadRef),
                        )
                      }
                    >
                      {busy ? (
                        <RotateCw className="animate-spin" />
                      ) : presentation.archived ? (
                        <ArchiveRestore />
                      ) : (
                        <Archive />
                      )}
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      disabled={busy || presentation.status === "ongoing"}
                      className="text-destructive hover:text-destructive"
                      aria-label="Delete thread permanently"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Delete "${presentation.title}" permanently? This cannot be undone.`,
                          )
                        )
                          return;
                        void runMutation(threadRef, () => deleteThread(threadRef));
                      }}
                    >
                      <Trash2 />
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
