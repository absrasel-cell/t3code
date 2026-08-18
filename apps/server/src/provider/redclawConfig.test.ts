import { describe, expect, it } from "vitest";

import { resolveRedClawConfig } from "./redclawConfig.ts";

const validEnvironment = {
  NODE_ENV: "production",
  T3_REDXTRM_CLIENT_DEV_ORIGIN: "https://client-builder.example",
  T3_REDXTRM_CLIENT_DEV_API_KEY: "server-only-test-key",
  T3_REDXTRM_CLIENT_DEV_AGENT_KEY: "client-dev-orchestrator",
  T3_REDXTRM_CLIENT_DEV_SCOPE_SECRET: "redclaw-scope-test-secret-with-at-least-32-bytes",
} as const;

describe("resolveRedClawConfig", () => {
  it("fails closed for partial or insecure configuration", () => {
    expect(resolveRedClawConfig({})).toBeUndefined();
    expect(
      resolveRedClawConfig({
        ...validEnvironment,
        T3_REDXTRM_CLIENT_DEV_API_KEY: undefined,
      }),
    ).toBeUndefined();
    expect(
      resolveRedClawConfig({
        ...validEnvironment,
        T3_REDXTRM_CLIENT_DEV_ORIGIN: "http://client-builder.example",
      }),
    ).toBeUndefined();
    expect(
      resolveRedClawConfig({
        ...validEnvironment,
        T3_REDXTRM_CLIENT_DEV_ORIGIN: "https://user:password@client-builder.example",
      }),
    ).toBeUndefined();
  });

  it("allows loopback HTTP only outside production", () => {
    expect(
      resolveRedClawConfig({
        ...validEnvironment,
        NODE_ENV: "development",
        T3_REDXTRM_CLIENT_DEV_ORIGIN: "http://127.0.0.1:8787/path-is-normalized",
      }),
    ).toMatchObject({ origin: "http://127.0.0.1:8787" });
    expect(
      resolveRedClawConfig({
        ...validEnvironment,
        T3_REDXTRM_CLIENT_DEV_ORIGIN: "http://127.0.0.1:8787",
      }),
    ).toBeUndefined();
  });

  it("bounds timeout and response-size overrides", () => {
    expect(resolveRedClawConfig(validEnvironment)).toMatchObject({
      timeoutMs: 15 * 60_000,
    });
    expect(
      resolveRedClawConfig({
        ...validEnvironment,
        T3_REDXTRM_CLIENT_DEV_TIMEOUT_MS: "9999999",
        T3_REDXTRM_CLIENT_DEV_MAX_RESPONSE_BYTES: "9999999",
      }),
    ).toMatchObject({
      origin: "https://client-builder.example",
      timeoutMs: 30 * 60_000,
      maxResponseBytes: 512 * 1024,
    });
  });

  it("allows only the explicit isolated bff service over private HTTP", () => {
    expect(
      resolveRedClawConfig({
        ...validEnvironment,
        T3_REDXTRM_CLIENT_DEV_ORIGIN: "http://bff:8080",
        T3_REDXTRM_CLIENT_DEV_ALLOW_PRIVATE_HTTP: "1",
      }),
    ).toMatchObject({ origin: "http://bff:8080" });
    expect(
      resolveRedClawConfig({
        ...validEnvironment,
        T3_REDXTRM_CLIENT_DEV_ORIGIN: "http://other:8080",
        T3_REDXTRM_CLIENT_DEV_ALLOW_PRIVATE_HTTP: "1",
      }),
    ).toBeUndefined();
    expect(
      resolveRedClawConfig({
        ...validEnvironment,
        T3_REDXTRM_CLIENT_DEV_ORIGIN: "http://bff:8081",
        T3_REDXTRM_CLIENT_DEV_ALLOW_PRIVATE_HTTP: "1",
      }),
    ).toBeUndefined();
  });
});
