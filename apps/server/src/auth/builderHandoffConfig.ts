const SECRET_MIN_BYTES = 32;
const SECRET_MAX_BYTES = 512;

export interface BuilderHandoffConfig {
  readonly audience: string;
  readonly secret: Uint8Array;
}

export type BuilderHandoffEnvironment = Readonly<Record<string, string | undefined>>;

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Invalid or partial server-only configuration keeps the exchange disabled. */
export function resolveBuilderHandoffConfig(
  environment: BuilderHandoffEnvironment = process.env,
): BuilderHandoffConfig | undefined {
  const rawOrigin = environment.T3_REDXTRM_BUILDER_ORIGIN;
  const rawSecret = environment.T3_REDXTRM_BUILDER_TICKET_SECRET;
  if (
    !rawOrigin ||
    rawOrigin !== rawOrigin.trim() ||
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
  try {
    parsedOrigin = new URL(rawOrigin);
  } catch {
    return undefined;
  }
  if (
    parsedOrigin.username ||
    parsedOrigin.password ||
    parsedOrigin.pathname !== "/" ||
    parsedOrigin.search ||
    parsedOrigin.hash ||
    !parsedOrigin.hostname
  ) {
    return undefined;
  }

  const allowsLoopbackHttp =
    environment.NODE_ENV !== "production" &&
    parsedOrigin.protocol === "http:" &&
    isLoopbackHost(parsedOrigin.hostname);
  if (parsedOrigin.protocol !== "https:" && !allowsLoopbackHttp) {
    return undefined;
  }

  return {
    audience: parsedOrigin.origin,
    secret: Buffer.from(rawSecret, "utf8"),
  };
}
