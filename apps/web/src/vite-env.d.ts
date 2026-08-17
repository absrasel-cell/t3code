/// <reference types="vite/client" />

import type { DesktopBridge, LocalApi } from "@t3tools/contracts";

interface ImportMetaEnv {
  readonly APP_VERSION: string;
  readonly VITE_APP_MODE?: string;
  readonly VITE_APP_BRAND_NAME?: string;
  readonly VITE_APP_STAGE_LABEL?: string;
  readonly VITE_REMOTE_BUILDER_CAPABILITIES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    nativeApi?: LocalApi;
    desktopBridge?: DesktopBridge;
  }
}
