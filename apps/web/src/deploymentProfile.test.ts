import { describe, expect, it } from "@effect/vitest";

import {
  deploymentUiCapabilitiesForProfile,
  isLlpChatOnlyRestrictedRoute,
} from "./deploymentProfile";

describe("LLP chat-only routes", () => {
  it("keeps chat and pairing reachable", () => {
    expect(isLlpChatOnlyRestrictedRoute("/")).toBe(false);
    expect(isLlpChatOnlyRestrictedRoute("/pair")).toBe(false);
    expect(isLlpChatOnlyRestrictedRoute("/env/thread")).toBe(false);
  });

  it("removes administrative and repository surfaces", () => {
    for (const pathname of [
      "/connect",
      "/pull-requests",
      "/usage",
      "/settings/providers",
      "/projects/project-1",
    ]) {
      expect(isLlpChatOnlyRestrictedRoute(pathname)).toBe(true);
    }
  });

  it("keeps the branded product shell and thread TODOs without exposing internal tools", () => {
    expect(deploymentUiCapabilitiesForProfile("llp-chat-only")).toEqual({
      appBaseName: "r3xCode",
      appStageLabel: null,
      appearanceModeToggle: true,
      currentTasks: true,
      currentTasksSource: "controller",
      productShell: true,
      projectAdministration: false,
      rtxOrchestrator: false,
      workspaceTools: false,
    });
  });

  it("keeps a safe appearance control when settings routes are unavailable", () => {
    expect(deploymentUiCapabilitiesForProfile("llp-chat-only").appearanceModeToggle).toBe(true);
    expect(deploymentUiCapabilitiesForProfile(null).appearanceModeToggle).toBe(false);
  });

  it("keeps r3xCode branding while enabling the complete LLP owner surface", () => {
    expect(deploymentUiCapabilitiesForProfile("llp-full")).toEqual({
      appBaseName: "r3xCode",
      appStageLabel: null,
      appearanceModeToggle: true,
      currentTasks: true,
      currentTasksSource: "controller",
      productShell: true,
      projectAdministration: true,
      rtxOrchestrator: false,
      workspaceTools: true,
    });
  });

  it("uses the VM-native controller projection instead of the host-only RTX bridge", () => {
    expect(deploymentUiCapabilitiesForProfile("llp-chat-only").currentTasksSource).toBe(
      "controller",
    );
    expect(deploymentUiCapabilitiesForProfile("llp-full").currentTasksSource).toBe("controller");
    expect(deploymentUiCapabilitiesForProfile(null).currentTasksSource).toBe("rtx");
  });
});
