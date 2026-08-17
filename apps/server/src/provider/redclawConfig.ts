const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const AGENT_KEY_PATTERN = /^[a-zA-Z0-9_-]{3,80}$/;

export interface RedClawConfig {
  readonly origin: string;
  readonly apiKey: string;
  readonly agentKey: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

export type RedClawEnvironment = Readonly<Record<string, string | undefined>>;

function parseBoundedInteger(raw: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Resolve the server-only RedClaw configuration. Invalid or partial
 * configuration returns undefined so the provider remains unregistered.
 */
export function resolveRedClawConfig(
  environment: RedClawEnvironment = process.env,
): RedClawConfig | undefined {
  const origin = environment.T3_REDXTRM_CLIENT_DEV_ORIGIN?.trim();
  const apiKey = environment.T3_REDXTRM_CLIENT_DEV_API_KEY?.trim();
  const agentKey = environment.T3_REDXTRM_CLIENT_DEV_AGENT_KEY?.trim();
  if (!origin || !apiKey || !agentKey || !AGENT_KEY_PATTERN.test(agentKey)) {
    return undefined;
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return undefined;
  }

  const allowsLoopbackHttp =
    environment.NODE_ENV !== "production" &&
    parsedOrigin.protocol === "http:" &&
    isLoopbackHost(parsedOrigin.hostname);
  if (parsedOrigin.protocol !== "https:" && !allowsLoopbackHttp) {
    return undefined;
  }
  if (parsedOrigin.username || parsedOrigin.password) {
    return undefined;
  }

  return {
    origin: parsedOrigin.origin,
    apiKey,
    agentKey,
    timeoutMs: parseBoundedInteger(
      environment.T3_REDXTRM_CLIENT_DEV_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    ),
    maxResponseBytes: parseBoundedInteger(
      environment.T3_REDXTRM_CLIENT_DEV_MAX_RESPONSE_BYTES,
      DEFAULT_MAX_RESPONSE_BYTES,
      MAX_RESPONSE_BYTES,
    ),
  };
}
