export const BUILDER_MODES = ["local", "redxtrm-remote"] as const;

export type BuilderMode = (typeof BUILDER_MODES)[number];

export const BUILDER_CAPABILITIES = [
  "conversations",
  "diffs",
  "previews",
  "terminal",
  "usage",
] as const;

export type BuilderCapability = (typeof BUILDER_CAPABILITIES)[number];

export type BuilderCapabilityMap = Readonly<Record<BuilderCapability, boolean>>;

export interface BuilderEnvironmentInput {
  readonly appMode?: string;
  readonly brandName?: string;
  readonly stageLabel?: string;
  readonly remoteCapabilities?: string;
}

export interface BuilderEnvironment {
  readonly mode: BuilderMode;
  readonly isRemote: boolean;
  readonly branding: {
    readonly baseName: string;
    readonly displayName: string;
    readonly stageLabel: string | null;
  };
  readonly capabilities: BuilderCapabilityMap;
}

const CAPABILITY_SET = new Set<string>(BUILDER_CAPABILITIES);

function readOptionalLabel(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function parseRemoteCapabilities(value: string | undefined): ReadonlySet<BuilderCapability> {
  if (!value) {
    return new Set(["conversations"]);
  }

  const capabilities = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is BuilderCapability => CAPABILITY_SET.has(entry));

  return new Set(["conversations", ...capabilities]);
}

function capabilityMap(enabledCapabilities: ReadonlySet<BuilderCapability>): BuilderCapabilityMap {
  return Object.fromEntries(
    BUILDER_CAPABILITIES.map((capability) => [capability, enabledCapabilities.has(capability)]),
  ) as unknown as BuilderCapabilityMap;
}

function remoteCapabilityMap(
  requestedCapabilities: ReadonlySet<BuilderCapability>,
): BuilderCapabilityMap {
  return {
    ...capabilityMap(requestedCapabilities),
    // A browser build flag is not proof that the remote workspace has an isolated sandbox.
    // This must stay off until the server attests a sandbox-broker capability at runtime.
    terminal: false,
  };
}

export function resolveBuilderEnvironment(input: BuilderEnvironmentInput): BuilderEnvironment {
  const mode: BuilderMode =
    input.appMode?.trim().toLowerCase() === "redxtrm-remote" ? "redxtrm-remote" : "local";
  const isRemote = mode === "redxtrm-remote";
  const baseName = readOptionalLabel(input.brandName) ?? (isRemote ? "RedXTRM Builder" : "T3 Code");
  const stageLabel = readOptionalLabel(input.stageLabel) ?? (isRemote ? "Remote" : null);
  const capabilities = isRemote
    ? remoteCapabilityMap(parseRemoteCapabilities(input.remoteCapabilities))
    : capabilityMap(new Set(BUILDER_CAPABILITIES));

  return {
    mode,
    isRemote,
    branding: {
      baseName,
      displayName: isRemote || stageLabel === null ? baseName : `${baseName} (${stageLabel})`,
      stageLabel,
    },
    capabilities,
  };
}
