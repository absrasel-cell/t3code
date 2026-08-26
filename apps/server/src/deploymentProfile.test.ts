import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  LLP_CHAT_ONLY_DEPLOYMENT_PROFILE,
  LLP_FULL_DEPLOYMENT_PROFILE,
  applyDeploymentProfileToEnvironmentDescriptor,
  commandDenialReasonForDeploymentProfile,
  isHttpRequestAllowedByDeploymentProfile,
  isRpcMethodAllowedByDeploymentProfile,
  shouldPreserveBundledWebIcons,
} from "./deploymentProfile.ts";

const commandId = CommandId.make("command-1");
const threadId = ThreadId.make("thread-1");
const projectId = ProjectId.make("project-1");
const fixedModel = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.6-sol",
  options: [{ id: "reasoningEffort", value: "high" }],
} as const;
const standardDeploymentProfile = "standard";

const createThread = (): Extract<OrchestrationCommand, { type: "thread.create" }> => ({
  type: "thread.create",
  commandId,
  threadId,
  projectId,
  title: "LLP task",
  modelSelection: fixedModel,
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  createdAt: "2026-08-24T00:00:00.000Z",
});

describe("LLP chat-only deployment profile", () => {
  it("preserves the web build's branded icon set", () => {
    expect(shouldPreserveBundledWebIcons(LLP_CHAT_ONLY_DEPLOYMENT_PROFILE)).toBe(true);
    expect(shouldPreserveBundledWebIcons(LLP_FULL_DEPLOYMENT_PROFILE)).toBe(true);
    expect(shouldPreserveBundledWebIcons(standardDeploymentProfile)).toBe(false);
  });

  it("keeps the branded full profile unrestricted", () => {
    expect(
      isRpcMethodAllowedByDeploymentProfile("terminal.open", LLP_FULL_DEPLOYMENT_PROFILE),
    ).toBe(true);
    expect(
      isHttpRequestAllowedByDeploymentProfile(
        "GET",
        "/api/auth/pairing-links",
        LLP_FULL_DEPLOYMENT_PROFILE,
      ),
    ).toBe(true);
    expect(
      commandDenialReasonForDeploymentProfile(
        {
          type: "project.delete",
          commandId,
          projectId,
        },
        LLP_FULL_DEPLOYMENT_PROFILE,
      ),
    ).toBeUndefined();
  });

  it("does not advertise hidden server capabilities", () => {
    const descriptor = {
      environmentId: EnvironmentId.make("environment-1"),
      label: "LLP workbench",
      platform: { os: "linux", arch: "x64" },
      serverVersion: "1.0.0",
      capabilities: {
        repositoryIdentity: true,
        connectionProbe: true,
        pullRequests: true,
        serverSelfUpdate: "boot-service",
        serverSelfUpdateProgress: true,
        agentActivityPublishing: true,
      },
    } as const;

    expect(
      applyDeploymentProfileToEnvironmentDescriptor(descriptor, LLP_CHAT_ONLY_DEPLOYMENT_PROFILE),
    ).toEqual({
      ...descriptor,
      capabilities: {
        repositoryIdentity: false,
        connectionProbe: true,
        pullRequests: false,
        agentActivityPublishing: false,
      },
    });
    expect(
      applyDeploymentProfileToEnvironmentDescriptor(descriptor, standardDeploymentProfile),
    ).toBe(descriptor);
  });

  it("denies privileged RPC surfaces independently of token scopes", () => {
    for (const method of [
      "terminal.open",
      "review.getDiffPreview",
      "vcs.pull",
      "git.runStackedAction",
    ]) {
      expect(isRpcMethodAllowedByDeploymentProfile(method, LLP_CHAT_ONLY_DEPLOYMENT_PROFILE)).toBe(
        false,
      );
    }
    expect(
      isRpcMethodAllowedByDeploymentProfile(
        "orchestration.dispatchCommand",
        LLP_CHAT_ONLY_DEPLOYMENT_PROFILE,
      ),
    ).toBe(true);
    expect(isRpcMethodAllowedByDeploymentProfile("terminal.open", standardDeploymentProfile)).toBe(
      true,
    );
  });

  it("allows only browser auth, chat reads, dispatch, and signed assets over HTTP", () => {
    expect(
      isHttpRequestAllowedByDeploymentProfile(
        "POST",
        "/api/auth/browser-session",
        LLP_CHAT_ONLY_DEPLOYMENT_PROFILE,
      ),
    ).toBe(true);
    expect(
      isHttpRequestAllowedByDeploymentProfile(
        "GET",
        "/api/orchestration/threads/thread-1?turnLimit=20",
        LLP_CHAT_ONLY_DEPLOYMENT_PROFILE,
      ),
    ).toBe(true);
    expect(
      isHttpRequestAllowedByDeploymentProfile(
        "GET",
        "/api/rtx/thread-task?environmentId=llp-t3&threadId=thread-1",
        LLP_CHAT_ONLY_DEPLOYMENT_PROFILE,
      ),
    ).toBe(true);
    expect(
      isHttpRequestAllowedByDeploymentProfile(
        "POST",
        "/api/connect/relay-config",
        LLP_CHAT_ONLY_DEPLOYMENT_PROFILE,
      ),
    ).toBe(false);
    expect(
      isHttpRequestAllowedByDeploymentProfile(
        "GET",
        "/api/auth/pairing-links",
        LLP_CHAT_ONLY_DEPLOYMENT_PROFILE,
      ),
    ).toBe(false);
    expect(
      isHttpRequestAllowedByDeploymentProfile(
        "POST",
        "/api/pull-requests/diff",
        LLP_CHAT_ONLY_DEPLOYMENT_PROFILE,
      ),
    ).toBe(false);
    expect(
      isHttpRequestAllowedByDeploymentProfile("POST", "/mcp", LLP_CHAT_ONLY_DEPLOYMENT_PROFILE),
    ).toBe(false);
    expect(
      isHttpRequestAllowedByDeploymentProfile(
        "GET",
        "/assets/index.js",
        LLP_CHAT_ONLY_DEPLOYMENT_PROFILE,
      ),
    ).toBe(true);
  });

  it("accepts fixed chat lifecycle commands", () => {
    expect(
      commandDenialReasonForDeploymentProfile(createThread(), LLP_CHAT_ONLY_DEPLOYMENT_PROFILE),
    ).toBeUndefined();
    expect(
      commandDenialReasonForDeploymentProfile(
        {
          type: "thread.turn.start",
          commandId,
          threadId,
          message: {
            messageId: MessageId.make("message-1"),
            role: "user",
            text: "Implement the LLP task",
            attachments: [],
          },
          modelSelection: fixedModel,
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: "2026-08-24T00:00:00.000Z",
        },
        LLP_CHAT_ONLY_DEPLOYMENT_PROFILE,
      ),
    ).toBeUndefined();
  });

  it("rejects project, model, branch, worktree, and checkpoint mutations", () => {
    expect(
      commandDenialReasonForDeploymentProfile(
        {
          ...createThread(),
          modelSelection: { ...fixedModel, model: "gpt-5.6-terra" },
        },
        LLP_CHAT_ONLY_DEPLOYMENT_PROFILE,
      ),
    ).toContain("fixed Codex model");
    expect(
      commandDenialReasonForDeploymentProfile(
        {
          type: "thread.meta.update",
          commandId,
          threadId,
          branch: "release",
        },
        LLP_CHAT_ONLY_DEPLOYMENT_PROFILE,
      ),
    ).toContain("branch");
    expect(
      commandDenialReasonForDeploymentProfile(
        {
          type: "thread.checkpoint.revert",
          commandId,
          threadId,
          turnCount: 1,
          createdAt: "2026-08-24T00:00:00.000Z",
        },
        LLP_CHAT_ONLY_DEPLOYMENT_PROFILE,
      ),
    ).toContain("disabled");
    expect(
      commandDenialReasonForDeploymentProfile(
        {
          type: "project.delete",
          commandId,
          projectId,
        },
        LLP_CHAT_ONLY_DEPLOYMENT_PROFILE,
      ),
    ).toContain("disabled");
  });
});
