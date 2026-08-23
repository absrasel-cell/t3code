import {
  ORCHESTRATION_WS_METHODS,
  WS_METHODS,
  type ExecutionEnvironmentDescriptor,
  type OrchestrationCommand,
  type ModelSelection,
} from "@t3tools/contracts";

export const LLP_CHAT_ONLY_DEPLOYMENT_PROFILE = "llp-chat-only";

export function isLlpChatOnlyDeploymentProfile(
  profile = process.env.T3CODE_DEPLOYMENT_PROFILE,
): boolean {
  return profile === LLP_CHAT_ONLY_DEPLOYMENT_PROFILE;
}

export function applyDeploymentProfileToEnvironmentDescriptor(
  descriptor: ExecutionEnvironmentDescriptor,
  profile = process.env.T3CODE_DEPLOYMENT_PROFILE,
): ExecutionEnvironmentDescriptor {
  if (!isLlpChatOnlyDeploymentProfile(profile)) return descriptor;

  const {
    serverSelfUpdate: _serverSelfUpdate,
    serverSelfUpdateProgress: _serverSelfUpdateProgress,
    ...capabilities
  } = descriptor.capabilities;
  return {
    ...descriptor,
    capabilities: {
      ...capabilities,
      repositoryIdentity: false,
      pullRequests: false,
      agentActivityPublishing: false,
    },
  };
}

const LLP_CHAT_ONLY_RPC_METHODS = new Set<string>([
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  ORCHESTRATION_WS_METHODS.getTurnDiff,
  ORCHESTRATION_WS_METHODS.getFullThreadDiff,
  ORCHESTRATION_WS_METHODS.searchThreads,
  ORCHESTRATION_WS_METHODS.subscribeShell,
  ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
  ORCHESTRATION_WS_METHODS.subscribeThread,
  WS_METHODS.serverProbe,
  WS_METHODS.serverGetConfig,
  WS_METHODS.serverRefreshProviders,
  WS_METHODS.serverGetSettings,
  WS_METHODS.serverGetUsageSummary,
  WS_METHODS.serverReportClientActivity,
  WS_METHODS.serverGetBackgroundPolicy,
  WS_METHODS.assetsCreateUrl,
  WS_METHODS.subscribeServerConfig,
  WS_METHODS.subscribeServerLifecycle,
  WS_METHODS.subscribeBackgroundPolicy,
]);

export function isRpcMethodAllowedByDeploymentProfile(
  method: string,
  profile = process.env.T3CODE_DEPLOYMENT_PROFILE,
): boolean {
  return !isLlpChatOnlyDeploymentProfile(profile) || LLP_CHAT_ONLY_RPC_METHODS.has(method);
}

export function isHttpRequestAllowedByDeploymentProfile(
  method: string,
  rawPath: string,
  profile = process.env.T3CODE_DEPLOYMENT_PROFILE,
): boolean {
  if (!isLlpChatOnlyDeploymentProfile(profile)) return true;

  const path = rawPath.split("?", 1)[0] ?? rawPath;
  const normalizedMethod = method.toUpperCase();
  const protectedPath =
    path === "/ws" ||
    path === "/mcp" ||
    path.startsWith("/mcp/") ||
    path.startsWith("/api/") ||
    path.startsWith("/oauth/") ||
    path.startsWith("/.well-known/t3/");
  if (!protectedPath) return true;

  if (normalizedMethod === "GET" && path === "/ws") return true;
  if (normalizedMethod === "GET" && path === "/.well-known/t3/environment") return true;
  if (normalizedMethod === "GET" && path === "/api/auth/session") return true;
  if (normalizedMethod === "POST" && path === "/api/auth/browser-session") return true;
  if (normalizedMethod === "POST" && path === "/oauth/token") return true;
  if (normalizedMethod === "POST" && path === "/api/auth/websocket-ticket") return true;
  if (normalizedMethod === "GET" && path === "/api/orchestration/snapshot") return true;
  if (normalizedMethod === "GET" && path === "/api/orchestration/shell") return true;
  if (normalizedMethod === "GET" && path.startsWith("/api/orchestration/threads/")) return true;
  if (normalizedMethod === "POST" && path === "/api/orchestration/dispatch") return true;
  if (normalizedMethod === "GET" && path.startsWith("/api/assets/")) return true;

  return false;
}

function isFixedLlpModelSelection(selection: ModelSelection): boolean {
  const options = selection.options ?? [];
  return (
    selection.instanceId === "codex" &&
    selection.model === "gpt-5.6-sol" &&
    options.length === 1 &&
    options[0]?.id === "reasoningEffort" &&
    options[0].value === "high"
  );
}

function invalidCreateThreadSettings(input: {
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: string;
  readonly interactionMode: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
}): boolean {
  return (
    !isFixedLlpModelSelection(input.modelSelection) ||
    input.runtimeMode !== "full-access" ||
    input.interactionMode !== "default" ||
    input.branch !== null ||
    input.worktreePath !== null
  );
}

/**
 * Returns a stable reason when a client command exceeds the LLP chat surface.
 * The policy is deliberately independent of token scopes: even an accidentally
 * over-scoped pairing token cannot recover project, Git, terminal, or model
 * controls while this deployment profile is active.
 */
export function commandDenialReasonForDeploymentProfile(
  command: OrchestrationCommand,
  profile = process.env.T3CODE_DEPLOYMENT_PROFILE,
): string | undefined {
  if (!isLlpChatOnlyDeploymentProfile(profile)) return undefined;

  switch (command.type) {
    case "thread.create":
      return invalidCreateThreadSettings(command)
        ? "LLP chat threads must use the fixed Codex model and workspace mode."
        : undefined;
    case "thread.turn.start": {
      if (command.runtimeMode !== "full-access" || command.interactionMode !== "default") {
        return "LLP chat turns must use the fixed runtime and interaction modes.";
      }
      if (
        command.modelSelection !== undefined &&
        !isFixedLlpModelSelection(command.modelSelection)
      ) {
        return "LLP chat turns must use the fixed Codex model.";
      }
      if (command.sourceProposedPlan !== undefined) {
        return "Creating implementation threads from plans is disabled in LLP chat mode.";
      }
      if (command.bootstrap?.prepareWorktree !== undefined || command.bootstrap?.runSetupScript) {
        return "Worktree preparation and project scripts are disabled in LLP chat mode.";
      }
      if (
        command.bootstrap?.createThread !== undefined &&
        invalidCreateThreadSettings(command.bootstrap.createThread)
      ) {
        return "LLP chat threads must use the fixed Codex model and workspace mode.";
      }
      return undefined;
    }
    case "thread.meta.update":
      return command.modelSelection !== undefined ||
        command.branch !== undefined ||
        command.expectedBranch !== undefined ||
        command.worktreePath !== undefined
        ? "Model, branch, and worktree changes are disabled in LLP chat mode."
        : undefined;
    case "thread.delete":
    case "thread.archive":
    case "thread.unarchive":
    case "thread.settle":
    case "thread.unsettle":
    case "thread.snooze":
    case "thread.unsnooze":
    case "thread.pin":
    case "thread.unpin":
    case "thread.pin.reorder":
    case "thread.turn.interrupt":
    case "thread.approval.respond":
    case "thread.user-input.respond":
    case "thread.session.stop":
      return undefined;
    default:
      return `The ${command.type} command is disabled in LLP chat mode.`;
  }
}
