// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - This narrow local bridge is a bounded Node subprocess adapter.
import * as NodeChildProcess from "node:child_process";

import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpServerRespondable,
} from "effect/unstable/http";

import { authenticateRawRouteWithScope } from "../http.ts";

import { resolveTaskBridgeInvocation } from "./bridgeCommand.ts";

const MAX_BRIDGE_OUTPUT_BYTES = 2 * 1024 * 1024;
const BRIDGE_TIMEOUT_MS = 45_000;
const BRIDGE_ACTIONS = new Set([
  "set-mode",
  "submit",
  "schedule-create",
  "schedule-toggle",
  "schedule-run",
  "schedule-delete",
]);

class RtxBridgeError extends Error {
  readonly _tag = "RtxBridgeError";
}

function runBridge(action: string, input: unknown): Promise<unknown> {
  const bridgeLabel = action === "thread-task" ? "Current Tasks" : "RTX orchestration";
  const invocation = resolveTaskBridgeInvocation(action);
  if (!invocation) {
    return Promise.reject(new Error(`${bridgeLabel} is not configured for this server.`));
  }

  return new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error(`${bridgeLabel} timed out.`)));
    }, BRIDGE_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout, "utf8") > MAX_BRIDGE_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(() => reject(new Error(`${bridgeLabel} returned too much data.`)));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 2_000) stderr += chunk;
    });
    child.once("error", () => {
      finish(() => reject(new Error(`${bridgeLabel} could not start.`)));
    });
    child.once("close", (code) => {
      finish(() => {
        if (code !== 0) {
          const detail = stderr.trim();
          reject(new Error(detail || `${bridgeLabel} failed.`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`${bridgeLabel} returned an invalid response.`));
        }
      });
    });

    child.stdin.end(JSON.stringify(input ?? {}));
  });
}

function jsonError(message: string, status: number) {
  return HttpServerResponse.jsonUnsafe(
    { ok: false, error: message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function bridgeResponse(action: string, input: unknown) {
  return Effect.tryPromise({
    try: () => runBridge(action, input),
    catch: (cause) =>
      new RtxBridgeError(
        cause instanceof Error
          ? cause.message
          : action === "thread-task"
            ? "Current Tasks failed."
            : "RTX orchestration failed.",
      ),
  }).pipe(
    Effect.match({
      onFailure: (cause) => jsonError(cause.message, 502),
      onSuccess: (value) =>
        HttpServerResponse.jsonUnsafe(value, {
          status: 200,
          headers: { "cache-control": "no-store" },
        }),
    }),
  );
}

const stateRoute = HttpRouter.add(
  "GET",
  "/api/rtx/state",
  Effect.gen(function* () {
    yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
    return yield* bridgeResponse("state", {});
  }).pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
    }),
  ),
);

const threadTaskRoute = HttpRouter.add(
  "GET",
  "/api/rtx/thread-task",
  Effect.gen(function* () {
    yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) return jsonError("Request URL is invalid.", 400);
    const environmentId = url.value.searchParams.get("environmentId")?.trim() ?? "";
    const threadId = url.value.searchParams.get("threadId")?.trim() ?? "";
    if (!environmentId || !threadId) {
      return jsonError("environmentId and threadId are required.", 400);
    }
    return yield* bridgeResponse("thread-task", { environmentId, threadId });
  }).pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
    }),
  ),
);

const actionRoute = HttpRouter.add(
  "POST",
  "/api/rtx/action",
  Effect.gen(function* () {
    yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
    const request = yield* HttpServerRequest.HttpServerRequest;
    const decoded = yield* Effect.result(request.json);
    if (Result.isFailure(decoded)) {
      return jsonError("Request body is not valid JSON.", 400);
    }
    const payload = decoded.success;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return jsonError("Request must be a JSON object.", 400);
    }
    const { action, input } = payload as { action?: unknown; input?: unknown };
    if (typeof action !== "string" || !BRIDGE_ACTIONS.has(action)) {
      return jsonError("Unsupported RTX orchestration action.", 400);
    }
    return yield* bridgeResponse(action, input ?? {});
  }).pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
    }),
  ),
);

export const rtxHttpRouteLayer = Layer.mergeAll(stateRoute, threadTaskRoute, actionRoute);
