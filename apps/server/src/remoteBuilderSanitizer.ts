import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  DEFAULT_SERVER_SETTINGS,
  type ServerConfig,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";

import { isRemoteBuilderMode, type ServerAppMode } from "./remoteBuilderMode.ts";

const REMOTE_WORKSPACE_ROOT = "/workspace";

export function sanitizeRemoteBuilderProviders(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ServerProvider> {
  return providers
    .filter((provider) => provider.provider === "redclaw")
    .map((provider) => ({
      ...provider,
      skills: provider.skills.map((skill) => ({
        ...skill,
        path: `redclaw-skill:${skill.name}`,
      })),
    }));
}

export function sanitizeRemoteBuilderSettings(_settings: ServerSettings): ServerSettings {
  return {
    enableAssistantStreaming: false,
    defaultThreadEnvMode: "local",
    addProjectBaseDirectory: "",
    textGenerationModelSelection: {
      provider: "redclaw",
      model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER.redclaw,
    },
    providers: {
      codex: {
        ...DEFAULT_SERVER_SETTINGS.providers.codex,
        enabled: false,
        homePath: "",
        customModels: [],
      },
      claudeAgent: {
        ...DEFAULT_SERVER_SETTINGS.providers.claudeAgent,
        enabled: false,
        customModels: [],
        launchArgs: "",
      },
      cursor: {
        ...DEFAULT_SERVER_SETTINGS.providers.cursor,
        enabled: false,
        apiEndpoint: "",
        customModels: [],
      },
      opencode: {
        ...DEFAULT_SERVER_SETTINGS.providers.opencode,
        enabled: false,
        serverUrl: "",
        serverPassword: "",
        customModels: [],
      },
      redclaw: {
        enabled: true,
        customModels: [],
      },
    },
    observability: {
      otlpTracesUrl: "",
      otlpMetricsUrl: "",
    },
  };
}

export function sanitizeRemoteBuilderServerConfig(config: ServerConfig): ServerConfig {
  return {
    ...config,
    environment: {
      ...config.environment,
      label: "RedXTRM Remote Builder",
      platform: { os: "unknown", arch: "other" },
      capabilities: { repositoryIdentity: false },
    },
    cwd: REMOTE_WORKSPACE_ROOT,
    keybindingsConfigPath: `${REMOTE_WORKSPACE_ROOT}/.redxtrm/keybindings.json`,
    keybindings: [],
    issues: [],
    providers: sanitizeRemoteBuilderProviders(config.providers),
    availableEditors: [],
    observability: {
      logsDirectoryPath: `${REMOTE_WORKSPACE_ROOT}/.redxtrm/logs`,
      localTracingEnabled: false,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: sanitizeRemoteBuilderSettings(config.settings),
  };
}

export function exposeServerSettingsForMode(
  mode: ServerAppMode,
  settings: ServerSettings,
): ServerSettings {
  return isRemoteBuilderMode(mode) ? sanitizeRemoteBuilderSettings(settings) : settings;
}

export function exposeServerConfigForMode(mode: ServerAppMode, config: ServerConfig): ServerConfig {
  return isRemoteBuilderMode(mode) ? sanitizeRemoteBuilderServerConfig(config) : config;
}
