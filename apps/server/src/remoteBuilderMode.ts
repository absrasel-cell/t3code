export const SERVER_APP_MODES = {
  local: "local",
  redxtrmRemote: "redxtrm-remote",
} as const;

export type ServerAppMode = (typeof SERVER_APP_MODES)[keyof typeof SERVER_APP_MODES];

type ServerModeEnvironment = Readonly<Record<string, string | undefined>> & {
  readonly T3_APP_MODE?: string;
};

/**
 * Resolves the trusted server application mode.
 *
 * An unset value preserves T3 Code's local-first behavior. An explicit but
 * unknown value is rejected so a misspelled remote deployment cannot silently
 * fall back to local-machine capabilities.
 */
export function resolveServerAppMode(value: string | undefined): ServerAppMode {
  const normalized = value?.trim();

  if (normalized === undefined || normalized === "" || normalized === SERVER_APP_MODES.local) {
    return SERVER_APP_MODES.local;
  }

  if (normalized === SERVER_APP_MODES.redxtrmRemote) {
    return SERVER_APP_MODES.redxtrmRemote;
  }

  throw new Error("Invalid T3_APP_MODE. Expected 'local' or 'redxtrm-remote'.");
}

export function resolveServerAppModeFromEnv(
  environment: ServerModeEnvironment = process.env,
): ServerAppMode {
  return resolveServerAppMode(environment.T3_APP_MODE);
}

export function isRemoteBuilderMode(mode: ServerAppMode): boolean {
  return mode === SERVER_APP_MODES.redxtrmRemote;
}
