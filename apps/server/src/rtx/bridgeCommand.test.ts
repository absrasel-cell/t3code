import { describe, expect, it } from "@effect/vitest";

import { resolveTaskBridgeInvocation } from "./bridgeCommand.ts";

describe("task bridge selection", () => {
  it("uses the direct LLP controller bridge only for thread task reads", () => {
    const environment = {
      T3CODE_DEPLOYMENT_PROFILE: "llp-full",
      T3CODE_LLP_TASK_BRIDGE: "/usr/local/libexec/llp_t3_task_controller.py",
    };

    expect(resolveTaskBridgeInvocation("thread-task", environment, "/usr/local/bin/node")).toEqual({
      command: "/usr/local/libexec/llp_t3_task_controller.py",
      args: ["thread-task"],
      cwd: "/usr/local/libexec",
    });
    expect(resolveTaskBridgeInvocation("state", environment, "/usr/local/bin/node")).toBeNull();
  });

  it("preserves the workstation RTX Node bridge", () => {
    expect(
      resolveTaskBridgeInvocation(
        "thread-task",
        {
          RTX_ORCHESTRATOR_ENABLED: "1",
          RTX_ORCHESTRATOR_BRIDGE: "/opt/redclaw/t3-bridge.mjs",
        },
        "/usr/local/bin/node",
      ),
    ).toEqual({
      command: "/usr/local/bin/node",
      args: ["/opt/redclaw/t3-bridge.mjs", "thread-task"],
      cwd: "/opt/redclaw",
    });
  });
});
