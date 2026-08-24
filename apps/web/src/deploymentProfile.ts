export type DeploymentUiCapabilities = {
  readonly appBaseName: string;
  readonly appStageLabel: string | null;
  readonly appearanceModeToggle: boolean;
  readonly currentTasks: boolean;
  readonly productShell: boolean;
  readonly projectAdministration: boolean;
  readonly rtxOrchestrator: boolean;
  readonly workspaceTools: boolean;
};

export function deploymentUiCapabilitiesForProfile(
  profile: string | null | undefined,
): DeploymentUiCapabilities {
  if (profile === "llp-chat-only") {
    return {
      appBaseName: "r3xCode",
      appStageLabel: null,
      appearanceModeToggle: true,
      currentTasks: true,
      productShell: true,
      projectAdministration: false,
      rtxOrchestrator: false,
      workspaceTools: false,
    };
  }

  return {
    appBaseName: "T3 Code",
    appStageLabel: null,
    appearanceModeToggle: false,
    currentTasks: true,
    productShell: true,
    projectAdministration: true,
    rtxOrchestrator: true,
    workspaceTools: true,
  };
}

export const T3CODE_DEPLOYMENT_PROFILE =
  import.meta.env.VITE_T3CODE_DEPLOYMENT_PROFILE?.trim() || null;
export const LLP_CHAT_ONLY_UI = T3CODE_DEPLOYMENT_PROFILE === "llp-chat-only";
export const DEPLOYMENT_UI_CAPABILITIES =
  deploymentUiCapabilitiesForProfile(T3CODE_DEPLOYMENT_PROFILE);

export function isLlpChatOnlyRestrictedRoute(pathname: string): boolean {
  return (
    pathname === "/connect" ||
    pathname.startsWith("/connect/") ||
    pathname === "/pull-requests" ||
    pathname === "/usage" ||
    pathname === "/settings" ||
    pathname.startsWith("/settings/") ||
    pathname.startsWith("/projects/")
  );
}
