// @effect-diagnostics nodeBuiltinImport:off - This pure selector prepares a bounded Node subprocess invocation.
import * as NodePath from "node:path";

type BridgeEnvironment = Readonly<Record<string, string | undefined>>;

export interface TaskBridgeInvocation {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
}

function resolvedSetting(value: string | undefined): string | null {
  const configured = value?.trim();
  return configured ? NodePath.resolve(configured) : null;
}

export function resolveTaskBridgeInvocation(
  action: string,
  environment: BridgeEnvironment = process.env,
  nodeExecutable = process.execPath,
): TaskBridgeInvocation | null {
  const profile = environment.T3CODE_DEPLOYMENT_PROFILE;
  const llpTaskBridge = resolvedSetting(environment.T3CODE_LLP_TASK_BRIDGE);
  if (
    action === "thread-task" &&
    (profile === "llp-chat-only" || profile === "llp-full") &&
    llpTaskBridge
  ) {
    return {
      command: llpTaskBridge,
      args: [action],
      cwd: NodePath.dirname(llpTaskBridge),
    };
  }

  if (environment.RTX_ORCHESTRATOR_ENABLED !== "1") return null;
  const rtxBridge = resolvedSetting(environment.RTX_ORCHESTRATOR_BRIDGE);
  return rtxBridge
    ? {
        command: nodeExecutable,
        args: [rtxBridge, action],
        cwd: NodePath.dirname(rtxBridge),
      }
    : null;
}
