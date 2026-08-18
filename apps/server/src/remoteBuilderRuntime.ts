import { DEFAULT_MODEL_BY_PROVIDER, type OrchestrationCommand } from "@t3tools/contracts";

import { isRemoteBuilderMode, type ServerAppMode } from "./remoteBuilderMode.ts";

const REMOTE_BUILDER_RUNTIME_MODE = "approval-required" as const;
const REMOTE_BUILDER_MODEL_SELECTION = {
  provider: "redclaw",
  model: DEFAULT_MODEL_BY_PROVIDER.redclaw,
} as const;

/**
 * Applies remote builder execution policy at the trusted server boundary.
 * Browser-supplied runtime modes and providers are advisory in local T3 only;
 * a remote client may never elevate permissions or bypass the scoped RedClaw
 * frontman.
 */
export function enforceRemoteBuilderCommandPolicy(
  mode: ServerAppMode,
  command: OrchestrationCommand,
): OrchestrationCommand {
  if (!isRemoteBuilderMode(mode)) return command;

  switch (command.type) {
    case "project.create":
    case "project.meta.update":
      return {
        ...command,
        defaultModelSelection: REMOTE_BUILDER_MODEL_SELECTION,
      };
    case "thread.create":
      return {
        ...command,
        modelSelection: REMOTE_BUILDER_MODEL_SELECTION,
        runtimeMode: REMOTE_BUILDER_RUNTIME_MODE,
      };
    case "thread.meta.update":
      return {
        ...command,
        modelSelection: REMOTE_BUILDER_MODEL_SELECTION,
      };
    case "thread.runtime-mode.set":
      return {
        ...command,
        runtimeMode: REMOTE_BUILDER_RUNTIME_MODE,
      };
    case "thread.turn.start": {
      const createThread = command.bootstrap?.createThread;
      return {
        ...command,
        modelSelection: REMOTE_BUILDER_MODEL_SELECTION,
        runtimeMode: REMOTE_BUILDER_RUNTIME_MODE,
        ...(command.bootstrap
          ? {
              bootstrap: {
                ...command.bootstrap,
                ...(createThread
                  ? {
                      createThread: {
                        ...createThread,
                        modelSelection: REMOTE_BUILDER_MODEL_SELECTION,
                        runtimeMode: REMOTE_BUILDER_RUNTIME_MODE,
                      },
                    }
                  : {}),
              },
            }
          : {}),
      };
    }
    default:
      return command;
  }
}
