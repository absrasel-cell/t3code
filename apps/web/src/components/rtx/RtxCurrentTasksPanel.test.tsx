import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { LinkedTaskCard, RtxCurrentTasksPanel } from "./RtxCurrentTasksPanel";

const threadRef = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));

describe("RtxCurrentTasksPanel thread plan mode", () => {
  it("renders the linked WhatsApp controller task with the local task-list treatment", () => {
    const markup = renderToStaticMarkup(
      <LinkedTaskCard
        projectName="LLP Chat Rust UI"
        task={{
          id: "11111111-1111-4111-8111-111111111111",
          objectiveId: "11111111-1111-4111-8111-111111111111",
          title: "Repair the Current Tasks panel",
          status: "ongoing",
          statusLabel: "T3 working",
          source: "Luma → T3",
          projectId: "llp.chat_ui",
          origin: "whatsapp",
          updatedAt: "2026-08-26T10:01:00Z",
          createdAt: "2026-08-26T10:00:00Z",
          threadId: "22222222-2222-4222-8222-222222222222",
          environmentId: "llp-t3",
          checklist: [
            { id: "task-1", title: "Read the linked controller task", status: "ongoing" },
            { id: "task-2", title: "Render the ordered checklist", status: "pending" },
          ],
        }}
      />,
    );

    expect(markup).toContain('aria-label="from WhatsApp"');
    expect(markup).toContain("Repair the Current Tasks panel");
    expect(markup).toContain("Luma → T3");
    expect(markup).toContain("T3 working");
    expect(markup).toContain("Status · 0/2");
    expect(markup).toContain("Render the ordered checklist");
  });

  it("renders the active thread plan without the RedClaw bridge", () => {
    const markup = renderToStaticMarkup(
      <RtxCurrentTasksPanel
        source="thread"
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
    expect(markup).toContain("Agent plan");
    expect(markup).toContain("Status · 1/3");
    expect(markup).toContain("Restore the product UI");
    expect(markup).toContain("up next");
    expect(markup).not.toContain("No RSL delegated task");
  });

  it("explains where TODOs appear before a plan exists", () => {
    const markup = renderToStaticMarkup(
      <RtxCurrentTasksPanel source="thread" threadRef={threadRef} />,
    );

    expect(markup).toContain("No agent plan yet");
    expect(markup).toContain("this thread&#x27;s agent publishes a plan");
  });
});
