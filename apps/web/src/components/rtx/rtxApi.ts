import type { RslDelegatedTask } from "./rtxTaskModel";

export type RtxAutomaticMode = "auto" | "on" | "off";

export interface RtxProjectOption {
  readonly id: string;
  readonly name: string;
}

export interface RtxSchedule {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly schedule: {
    readonly kind?: string;
    readonly everyMs?: number;
    readonly expr?: string;
    readonly tz?: string;
    readonly atMs?: number;
  };
  readonly nextRunAt: string;
  readonly lastRunAt: string;
  readonly lastStatus: string;
  readonly lastError: string;
}

export interface RtxOrchestratorState {
  readonly settings: { readonly automaticMode: RtxAutomaticMode };
  readonly projects: ReadonlyArray<RtxProjectOption>;
  readonly schedules: ReadonlyArray<RtxSchedule>;
  readonly rslTasks: ReadonlyArray<RslDelegatedTask>;
  readonly health: {
    readonly redclaw: "online" | "degraded";
    readonly rtx: "ready" | "unavailable";
    readonly checkedAt: string;
    readonly errors: ReadonlyArray<string>;
  };
}

interface RtxErrorResponse {
  readonly error?: string;
}

async function decodeResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & RtxErrorResponse;
  if (!response.ok) {
    throw new Error(payload.error || `RTX request failed with HTTP ${response.status}.`);
  }
  return payload;
}

export async function readRtxOrchestratorState(): Promise<RtxOrchestratorState> {
  const response = await fetch("/api/rtx/state", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  return decodeResponse<RtxOrchestratorState>(response);
}

export async function runRtxAction<T = RtxOrchestratorState>(
  action: string,
  input: Record<string, unknown>,
): Promise<T> {
  const response = await fetch("/api/rtx/action", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ action, input }),
  });
  return decodeResponse<T>(response);
}
