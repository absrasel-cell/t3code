import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type ServerConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  exposeServerConfigForMode,
  sanitizeRemoteBuilderServerConfig,
} from "./remoteBuilderSanitizer.ts";
import { SERVER_APP_MODES } from "./remoteBuilderMode.ts";

const provider = (providerKind: ServerProvider["provider"]): ServerProvider => ({
  provider: providerKind,
  enabled: true,
  installed: true,
  version: "host-version",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-08-17T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [
    {
      name: "builder",
      path: "/home/operator/.local/skills/builder",
      enabled: true,
    },
  ],
});

const config: ServerConfig = {
  environment: {
    environmentId: EnvironmentId.make("host-environment"),
    label: "Operator workstation",
    platform: { os: "linux", arch: "x64" },
    serverVersion: "0.0.20",
    capabilities: { repositoryIdentity: true },
  },
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: ["one-time-token"],
    sessionMethods: ["browser-session-cookie"],
    sessionCookieName: "t3-session",
  },
  cwd: "/home/operator/client-work",
  keybindingsConfigPath: "/home/operator/.config/t3/keybindings.json",
  keybindings: [],
  issues: [],
  providers: [provider("codex"), provider("redclaw")],
  availableEditors: ["vscode"],
  observability: {
    logsDirectoryPath: "/home/operator/.local/logs",
    localTracingEnabled: true,
    otlpTracesUrl: "https://private.example/traces",
    otlpTracesEnabled: true,
    otlpMetricsUrl: "https://private.example/metrics",
    otlpMetricsEnabled: true,
  },
  settings: {
    ...DEFAULT_SERVER_SETTINGS,
    addProjectBaseDirectory: "/home/operator/client-work",
    providers: {
      ...DEFAULT_SERVER_SETTINGS.providers,
      opencode: {
        ...DEFAULT_SERVER_SETTINGS.providers.opencode,
        serverUrl: "http://127.0.0.1:4096",
        serverPassword: "secret-password",
      },
    },
  },
};

describe("remoteBuilderSanitizer", () => {
  it("preserves the exact local config object in local mode", () => {
    expect(exposeServerConfigForMode(SERVER_APP_MODES.local, config)).toBe(config);
  });

  it("removes host paths, local providers, editors, endpoints, and secrets in remote mode", () => {
    const exposed = sanitizeRemoteBuilderServerConfig(config);
    const serialized = JSON.stringify(exposed);

    expect(exposed.cwd).toBe("/workspace");
    expect(exposed.keybindingsConfigPath).toBe("/workspace/.redxtrm/keybindings.json");
    expect(exposed.availableEditors).toEqual([]);
    expect(exposed.providers.map((entry) => entry.provider)).toEqual(["redclaw"]);
    expect(exposed.providers[0]?.skills[0]?.path).toBe("redclaw-skill:builder");
    expect(exposed.settings.textGenerationModelSelection.provider).toBe("redclaw");
    expect(exposed.settings.providers.codex.enabled).toBe(false);
    expect(exposed.settings.providers.claudeAgent.enabled).toBe(false);
    expect(exposed.settings.providers.cursor.enabled).toBe(false);
    expect(exposed.settings.providers.opencode.enabled).toBe(false);
    expect(exposed.observability).toEqual({
      logsDirectoryPath: "/workspace/.redxtrm/logs",
      localTracingEnabled: false,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    });
    expect(serialized).not.toContain("/home/operator");
    expect(serialized).not.toContain("127.0.0.1");
    expect(serialized).not.toContain("secret-password");
    expect(serialized).not.toContain("private.example");
  });
});
