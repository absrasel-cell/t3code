import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { RtxCurrentTasksPanel } from "./RtxCurrentTasksPanel";

const threadRef = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));

describe("RtxCurrentTasksPanel local thread mode", () => {
  it("renders the active thread plan without the RedClaw bridge", () => {
    const markup = renderToStaticMarkup(
      <RtxCurrentTasksPanel
        localOnly
        threadRef={threadRef}
        progress={{ step: "Restore the product UI", completedSteps: 1, totalSteps: 3 }}
        steps={[
          { step: "Inspect the deployment profile", status: "completed" },
          { step: "Restore the product UI", status: "inProgress" },
          { step: "Verify the remote build", status: "pending" },
        ]}
      />,
    );

    expect(markup).toContain('data-thread-todo="true"');
    expect(markup).toContain("Thread TODO");
    expect(markup).toContain("Status · 1/3");
    expect(markup).toContain("Restore the product UI");
    expect(markup).toContain("up next");
    expect(markup).not.toContain("No RSL delegated task");
  });

  it("explains where TODOs appear before a plan exists", () => {
    const markup = renderToStaticMarkup(<RtxCurrentTasksPanel localOnly threadRef={threadRef} />);

    expect(markup).toContain("No thread TODOs yet");
    expect(markup).toContain("development agent publishes a plan");
  });
});
