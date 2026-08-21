const SECRET_MIN_BYTES = 32;
const SECRET_MAX_BYTES = 512;

export interface BuilderHandoffConfig {
  readonly audience: string;
  readonly dashboardOrigin: string;
  readonly secret: Uint8Array;
}

export type BuilderHandoffEnvironment = Readonly<Record<string, string | undefined>>;

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function isPlainOrigin(url: URL): boolean {
  return (
    !url.username &&
    !url.password &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash &&
    Boolean(url.hostname)
  );
}

/** Invalid or partial server-only configuration keeps the exchange disabled. */
export function resolveBuilderHandoffConfig(
  environment: BuilderHandoffEnvironment = process.env,
): BuilderHandoffConfig | undefined {
  const rawOrigin = environment.T3_REDXTRM_BUILDER_ORIGIN;
  const rawDashboardOrigin = environment.T3_REDXTRM_DASHBOARD_ORIGIN;
  const rawSecret = environment.T3_REDXTRM_BUILDER_TICKET_SECRET;
  if (
    !rawOrigin ||
    rawOrigin !== rawOrigin.trim() ||
    !rawDashboardOrigin ||
    rawDashboardOrigin !== rawDashboardOrigin.trim() ||
    !rawSecret ||
    rawSecret !== rawSecret.trim()
  ) {
    return undefined;
  }

  const secretBytes = Buffer.byteLength(rawSecret, "utf8");
  if (secretBytes < SECRET_MIN_BYTES || secretBytes > SECRET_MAX_BYTES) {
    return undefined;
  }

  let parsedOrigin: URL;
  let parsedDashboardOrigin: URL;
  try {
    parsedOrigin = new URL(rawOrigin);
    parsedDashboardOrigin = new URL(rawDashboardOrigin);
  } catch {
    return undefined;
  }
  if (!isPlainOrigin(parsedOrigin) || !isPlainOrigin(parsedDashboardOrigin)) {
    return undefined;
  }

  const allowsLoopbackHttp =
    environment.NODE_ENV !== "production" &&
    parsedOrigin.protocol === "http:" &&
    isLoopbackHost(parsedOrigin.hostname);
  if (parsedOrigin.protocol !== "https:" && !allowsLoopbackHttp) {
    return undefined;
  }
  const allowsLoopbackDashboardHttp =
    environment.NODE_ENV !== "production" &&
    parsedDashboardOrigin.protocol === "http:" &&
    isLoopbackHost(parsedDashboardOrigin.hostname);
  if (parsedDashboardOrigin.protocol !== "https:" && !allowsLoopbackDashboardHttp) {
    return undefined;
  }

  return {
    audience: parsedOrigin.origin,
    dashboardOrigin: parsedDashboardOrigin.origin,
    secret: Buffer.from(rawSecret, "utf8"),
  };
}

export function isTrustedBuilderRequestOrigin(
  requestOrigin: string | undefined,
  config: BuilderHandoffConfig,
): boolean {
  if (!requestOrigin) return false;
  try {
    return (
      new URL(requestOrigin).origin === config.dashboardOrigin &&
      requestOrigin === config.dashboardOrigin
    );
  } catch {
    return false;
  }
}
