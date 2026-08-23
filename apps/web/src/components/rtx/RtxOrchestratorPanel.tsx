import {
  CalendarClock,
  CirclePause,
  CirclePlay,
  LoaderCircle,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Workflow,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";

import {
  readRtxOrchestratorState,
  runRtxAction,
  type RtxAutomaticMode,
  type RtxOrchestratorState,
  type RtxSchedule,
} from "./rtxApi";

const MODE_COPY: Readonly<Record<RtxAutomaticMode, string>> = {
  auto: "RTX applies its current routing policy and guardrails.",
  on: "Safe in-scope work continues automatically until it reaches a terminal state.",
  off: "RTX analyzes and plans, but does not launch or change project work.",
};

type ScheduleKind = "every" | "cron" | "at";

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function describeSchedule(schedule: RtxSchedule): string {
  if (schedule.schedule.kind === "every") {
    return `Every ${Math.round((schedule.schedule.everyMs ?? 0) / 60_000)} minutes`;
  }
  if (schedule.schedule.kind === "cron") {
    return `${schedule.schedule.expr ?? "Cron"}${schedule.schedule.tz ? ` · ${schedule.schedule.tz}` : ""}`;
  }
  if (schedule.schedule.kind === "at") {
    return `Once · ${formatTimestamp(new Date(schedule.schedule.atMs ?? 0).toISOString())}`;
  }
  return "Schedule";
}

export function RtxOrchestratorPanel() {
  const [state, setState] = useState<RtxOrchestratorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [request, setRequest] = useState("");
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [scheduleName, setScheduleName] = useState("");
  const [scheduleProjectId, setScheduleProjectId] = useState("");
  const [scheduleRequest, setScheduleRequest] = useState("");
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>("every");
  const [everyMinutes, setEveryMinutes] = useState("60");
  const [cronExpression, setCronExpression] = useState("0 9 * * *");
  const [runAt, setRunAt] = useState("");
  const [timezone, setTimezone] = useState("Asia/Dhaka");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setState(await readRtxOrchestratorState());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reach RTX through RedClaw.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runAction = useCallback(
    async <T,>(key: string, action: string, input: Record<string, unknown>): Promise<T | null> => {
      setBusy(key);
      setNotice(null);
      try {
        const result = await runRtxAction<T>(action, input);
        setError(null);
        return result;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "RTX orchestration failed.");
        return null;
      } finally {
        setBusy((current) => (current === key ? null : current));
      }
    },
    [],
  );

  const setMode = async (mode: RtxAutomaticMode) => {
    const next = await runAction<RtxOrchestratorState>("mode", "set-mode", {
      automaticMode: mode,
    });
    if (next) setState(next);
  };

  const submit = async () => {
    const input = request.trim();
    if (!input) return;
    const result = await runAction<{ ok: true; jobId: string }>("submit", "submit", {
      input,
      projectId,
      automaticMode: state?.settings.automaticMode ?? "auto",
    });
    if (!result) return;
    setRequest("");
    setNotice("Queued with RTX. Its r3xCode thread will appear in Current Tasks.");
    window.setTimeout(() => void refresh(), 800);
  };

  const updateSchedule = async (
    key: string,
    action: "schedule-toggle" | "schedule-run" | "schedule-delete",
    input: Record<string, unknown>,
  ) => {
    const next = await runAction<RtxOrchestratorState>(key, action, input);
    if (next) setState(next);
  };

  const createSchedule = async (event: FormEvent) => {
    event.preventDefault();
    const input: Record<string, unknown> = {
      name: scheduleName.trim(),
      input: scheduleRequest.trim(),
      projectId: scheduleProjectId,
      automaticMode: state?.settings.automaticMode ?? "auto",
      scheduleKind,
      timezone,
    };
    if (scheduleKind === "every") input.everyMinutes = Number(everyMinutes);
    if (scheduleKind === "cron") input.cronExpression = cronExpression;
    if (scheduleKind === "at") input.runAt = runAt;
    const next = await runAction<RtxOrchestratorState>("schedule-create", "schedule-create", input);
    if (!next) return;
    setState(next);
    setScheduleName("");
    setScheduleRequest("");
    setShowScheduleForm(false);
  };

  const mode = state?.settings.automaticMode ?? "auto";
  const projects = useMemo(() => state?.projects ?? [], [state?.projects]);
  const online = state?.health.redclaw === "online" && state.health.rtx === "ready";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background p-3" data-rtx-orchestrator>
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-border/70 bg-card p-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-info/10 text-info">
          <Workflow className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-sm">Orchestrator (RTX)</h2>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", online ? "bg-success" : "bg-warning")} />
            {loading
              ? "Connecting…"
              : online
                ? "RedClaw online · RTX ready"
                : "Connection degraded"}
          </p>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Refresh RTX state"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw className={cn(loading && "animate-spin")} />
        </Button>
      </div>

      {error ? (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-xs">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mb-3 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-success-foreground text-xs">
          {notice}
        </div>
      ) : null}

      <section className="mb-3 rounded-xl border border-border/70 bg-card p-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-xs">Automatic mode</h3>
          <span className="text-[10px] text-muted-foreground">RTX policy</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
          {(["auto", "on", "off"] as const).map((item) => (
            <button
              key={item}
              type="button"
              disabled={busy === "mode" || !state}
              onClick={() => void setMode(item)}
              className={cn(
                "rounded-md px-2 py-1.5 font-medium text-xs capitalize transition",
                item === mode
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {busy === "mode" && item === mode ? "Saving…" : item}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{MODE_COPY[mode]}</p>
      </section>

      <section className="mb-3 rounded-xl border border-border/70 bg-card p-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-xs">Assign work</h3>
          <span className="text-[10px] text-muted-foreground">Direct · RedClaw</span>
        </div>
        <label className="mt-3 block text-[11px] text-muted-foreground" htmlFor="rtx-project">
          Project
        </label>
        <select
          id="rtx-project"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
        >
          <option value="">Choose automatically</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name} · {project.id}
            </option>
          ))}
        </select>
        <label className="mt-3 block text-[11px] text-muted-foreground" htmlFor="rtx-request">
          Request
        </label>
        <Textarea
          id="rtx-request"
          size="sm"
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          className="mt-1"
          placeholder="Describe the outcome RTX should drive through r3xCode…"
        />
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            onClick={() => void submit()}
            disabled={!state || !request.trim() || busy === "submit"}
          >
            {busy === "submit" ? <LoaderCircle className="animate-spin" /> : <Send />}
            Send to RTX
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-border/70 bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="font-medium text-xs">Scheduling</h3>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Uses the current GoClaw cron implementation.
            </p>
          </div>
          <Button
            size="xs"
            variant="outline"
            onClick={() => setShowScheduleForm((current) => !current)}
          >
            <Plus />
            Add
          </Button>
        </div>

        {showScheduleForm ? (
          <form
            className="mt-3 space-y-2.5 border-t border-border/60 pt-3"
            onSubmit={(event) => void createSchedule(event)}
          >
            <div>
              <label
                className="block text-[11px] text-muted-foreground"
                htmlFor="rtx-schedule-name"
              >
                Name
              </label>
              <Input
                id="rtx-schedule-name"
                size="sm"
                value={scheduleName}
                onChange={(event) => setScheduleName(event.target.value)}
                placeholder="daily-project-check"
                required
              />
            </div>
            <div>
              <label
                className="block text-[11px] text-muted-foreground"
                htmlFor="rtx-schedule-project"
              >
                Project
              </label>
              <select
                id="rtx-schedule-project"
                value={scheduleProjectId}
                onChange={(event) => setScheduleProjectId(event.target.value)}
                className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
              >
                <option value="">Choose automatically</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} · {project.id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                className="block text-[11px] text-muted-foreground"
                htmlFor="rtx-schedule-request"
              >
                Scheduled request
              </label>
              <Textarea
                id="rtx-schedule-request"
                size="sm"
                value={scheduleRequest}
                onChange={(event) => setScheduleRequest(event.target.value)}
                placeholder="What should RTX do on each run?"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  className="block text-[11px] text-muted-foreground"
                  htmlFor="rtx-schedule-kind"
                >
                  Schedule
                </label>
                <select
                  id="rtx-schedule-kind"
                  value={scheduleKind}
                  onChange={(event) => setScheduleKind(event.target.value as ScheduleKind)}
                  className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2 text-xs"
                >
                  <option value="every">Every interval</option>
                  <option value="cron">Cron</option>
                  <option value="at">Once</option>
                </select>
              </div>
              {scheduleKind === "every" ? (
                <div>
                  <label className="block text-[11px] text-muted-foreground" htmlFor="rtx-every">
                    Minutes
                  </label>
                  <Input
                    id="rtx-every"
                    size="sm"
                    type="number"
                    min={1}
                    value={everyMinutes}
                    onChange={(event) => setEveryMinutes(event.target.value)}
                    required
                  />
                </div>
              ) : scheduleKind === "cron" ? (
                <div>
                  <label className="block text-[11px] text-muted-foreground" htmlFor="rtx-cron">
                    5-field cron
                  </label>
                  <Input
                    id="rtx-cron"
                    size="sm"
                    value={cronExpression}
                    onChange={(event) => setCronExpression(event.target.value)}
                    required
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-[11px] text-muted-foreground" htmlFor="rtx-run-at">
                    Run at
                  </label>
                  <Input
                    id="rtx-run-at"
                    size="sm"
                    type="datetime-local"
                    value={runAt}
                    onChange={(event) => setRunAt(event.target.value)}
                    required
                  />
                </div>
              )}
            </div>
            {scheduleKind === "cron" ? (
              <div>
                <label className="block text-[11px] text-muted-foreground" htmlFor="rtx-timezone">
                  Timezone
                </label>
                <Input
                  id="rtx-timezone"
                  size="sm"
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  required
                />
              </div>
            ) : null}
            <div className="flex justify-end gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowScheduleForm(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={
                  busy === "schedule-create" || !scheduleName.trim() || !scheduleRequest.trim()
                }
              >
                {busy === "schedule-create" ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <CalendarClock />
                )}
                Create
              </Button>
            </div>
          </form>
        ) : null}

        <div
          className={cn(
            "space-y-2",
            showScheduleForm ? "mt-3 border-t border-border/60 pt-3" : "mt-3",
          )}
        >
          {state?.schedules.length ? (
            state.schedules.map((schedule) => (
              <article
                key={schedule.id}
                className="rounded-lg border border-border/70 bg-background p-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-xs">{schedule.name}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {describeSchedule(schedule)}
                    </div>
                    {schedule.nextRunAt ? (
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        Next {formatTimestamp(schedule.nextRunAt)}
                      </div>
                    ) : null}
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[9px]",
                      schedule.enabled
                        ? "bg-success/10 text-success-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {schedule.enabled ? "Active" : "Paused"}
                  </span>
                </div>
                <div className="mt-2 flex gap-1 border-t border-border/60 pt-2">
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy === `toggle:${schedule.id}`}
                    onClick={() =>
                      void updateSchedule(`toggle:${schedule.id}`, "schedule-toggle", {
                        jobId: schedule.id,
                        enabled: !schedule.enabled,
                      })
                    }
                  >
                    {schedule.enabled ? <CirclePause /> : <CirclePlay />}
                    {schedule.enabled ? "Pause" : "Enable"}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy === `run:${schedule.id}`}
                    onClick={() =>
                      void updateSchedule(`run:${schedule.id}`, "schedule-run", {
                        jobId: schedule.id,
                      })
                    }
                  >
                    <CirclePlay />
                    Run now
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="ml-auto text-destructive hover:text-destructive"
                    aria-label={`Delete ${schedule.name}`}
                    disabled={busy === `delete:${schedule.id}`}
                    onClick={() => {
                      if (!window.confirm(`Delete schedule "${schedule.name}"?`)) return;
                      void updateSchedule(`delete:${schedule.id}`, "schedule-delete", {
                        jobId: schedule.id,
                      });
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </article>
            ))
          ) : (
            <div className="py-5 text-center text-[11px] text-muted-foreground">
              No RTX schedules yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
