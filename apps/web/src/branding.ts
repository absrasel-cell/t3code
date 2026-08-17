import type { DesktopAppBranding } from "@t3tools/contracts";

import { BUILDER_ENVIRONMENT } from "./builderEnvironment.runtime";

function readInjectedDesktopAppBranding(): DesktopAppBranding | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.desktopBridge?.getAppBranding?.() ?? null;
}

const injectedDesktopAppBranding = readInjectedDesktopAppBranding();

export const APP_BASE_NAME =
  injectedDesktopAppBranding?.baseName ?? BUILDER_ENVIRONMENT.branding.baseName;
export const APP_STAGE_LABEL =
  injectedDesktopAppBranding?.stageLabel ??
  BUILDER_ENVIRONMENT.branding.stageLabel ??
  (import.meta.env.DEV ? "Dev" : "Alpha");
export const APP_DISPLAY_NAME =
  injectedDesktopAppBranding?.displayName ??
  (BUILDER_ENVIRONMENT.isRemote
    ? BUILDER_ENVIRONMENT.branding.displayName
    : `${APP_BASE_NAME} (${APP_STAGE_LABEL})`);
export const APP_VERSION = import.meta.env.APP_VERSION || "0.0.0";
