import { resolveBuilderEnvironment } from "./builderEnvironment";

export const BUILDER_ENVIRONMENT = resolveBuilderEnvironment({
  appMode: import.meta.env.VITE_APP_MODE,
  brandName: import.meta.env.VITE_APP_BRAND_NAME,
  stageLabel: import.meta.env.VITE_APP_STAGE_LABEL,
  remoteCapabilities: import.meta.env.VITE_REMOTE_BUILDER_CAPABILITIES,
});
