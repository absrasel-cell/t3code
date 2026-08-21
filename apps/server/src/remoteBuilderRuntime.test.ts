import {
  CommandId,
  MessageId,
  type OrchestrationCommand,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { SERVER_APP_MODES } from "./remoteBuilderMode.ts";
import { enforceRemoteBuilderCommandPolicy } from "./remoteBuilderRuntime.ts";

const commandId = CommandId.make("command-remote-runtime-1");
const threadId = ThreadId.make("thread-remote-runtime-1");
const projectId = ProjectId.make("project-remote-runtime-1");
const createdAt = "2026-08-18T00:00:00.000Z";

function createThreadCommand(): OrchestrationCommand {
  return {
    type: "thread.create",
    commandId,
    threadId,
    projectId,
    title: "Remote thread",
    modelSelection: { provider: "redclaw", model: "client-dev-orchestrator" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt,
  };
}

describe("enforceRemoteBuilderCommandPolicy", () => {
  it("preserves local T3 runtime mode selection", () => {
    const command = createThreadCommand();

    expect(enforceRemoteBuilderCommandPolicy(SERVER_APP_MODES.local, command)).toBe(command);
  });

  it("forces remote thread creation and mode updates to approval-required", () => {
    const created = enforceRemoteBuilderCommandPolicy(
      SERVER_APP_MODES.redxtrmRemote,
      createThreadCommand(),
    );
    const updated = enforceRemoteBuilderCommandPolicy(SERVER_APP_MODES.redxtrmRemote, {
      type: "thread.runtime-mode.set",
      commandId,
      threadId,
      runtimeMode: "auto-accept-edits",
      createdAt,
    });

    expect(created).toMatchObject({ runtimeMode: "approval-required" });
    expect(updated).toMatchObject({ runtimeMode: "approval-required" });
  });

  it("forces remote turn and bootstrap thread modes regardless of browser input", () => {
    const command: OrchestrationCommand = {
      type: "thread.turn.start",
      commandId,
      threadId,
      message: {
        messageId: MessageId.make("message-remote-runtime-1"),
        role: "user",
        text: "Run this safely.",
        attachments: [],
      },
      modelSelection: { provider: "redclaw", model: "client-dev-orchestrator" },
      runtimeMode: "full-access",
      interactionMode: "default",
      bootstrap: {
        createThread: {
          projectId,
          title: "Remote thread",
          modelSelection: { provider: "redclaw", model: "client-dev-orchestrator" },
          runtimeMode: "auto-accept-edits",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt,
        },
      },
      createdAt,
    };

    const result = enforceRemoteBuilderCommandPolicy(SERVER_APP_MODES.redxtrmRemote, command);

    expect(result).toMatchObject({
      modelSelection: { provider: "redclaw", model: "client-dev-orchestrator" },
      runtimeMode: "approval-required",
      bootstrap: {
        createThread: {
          modelSelection: { provider: "redclaw", model: "client-dev-orchestrator" },
          runtimeMode: "approval-required",
        },
      },
    });
  });

  it("pins remote project and thread model changes to the RedClaw frontman", () => {
    const project = enforceRemoteBuilderCommandPolicy(SERVER_APP_MODES.redxtrmRemote, {
      type: "project.create",
      commandId,
      projectId,
      title: "Remote project",
      workspaceRoot: "/workspace",
      defaultModelSelection: { provider: "codex", model: "unsafe-client-choice" },
      createdAt,
    });
    const thread = enforceRemoteBuilderCommandPolicy(SERVER_APP_MODES.redxtrmRemote, {
      type: "thread.meta.update",
      commandId,
      threadId,
      modelSelection: { provider: "codex", model: "unsafe-client-choice" },
    });

    expect(project).toMatchObject({
      defaultModelSelection: { provider: "redclaw", model: "client-dev-orchestrator" },
    });
    expect(thread).toMatchObject({
      modelSelection: { provider: "redclaw", model: "client-dev-orchestrator" },
    });
  });
});
