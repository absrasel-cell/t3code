import { describe, expect, it } from "vitest";

import { resolveBuilderHandoffConfig } from "./builderHandoffConfig.ts";

const validEnvironment = {
  NODE_ENV: "production",
  T3_REDXTRM_BUILDER_ORIGIN: "https://builder.redxtrm.example",
  T3_REDXTRM_BUILDER_TICKET_SECRET: "builder-test-secret-with-more-than-thirty-two-bytes",
} as const;

describe("resolveBuilderHandoffConfig", () => {
  it("loads a bounded server-only key and exact HTTPS audience", () => {
    const config = resolveBuilderHandoffConfig(validEnvironment);

    expect(config?.audience).toBe("https://builder.redxtrm.example");
    expect(Buffer.from(config?.secret ?? []).toString("utf8")).toBe(
      validEnvironment.T3_REDXTRM_BUILDER_TICKET_SECRET,
    );
  });

  it.each([
    {},
    { ...validEnvironment, T3_REDXTRM_BUILDER_TICKET_SECRET: "short" },
    {
      ...validEnvironment,
      T3_REDXTRM_BUILDER_TICKET_SECRET: ` ${validEnvironment.T3_REDXTRM_BUILDER_TICKET_SECRET}`,
    },
    { ...validEnvironment, T3_REDXTRM_BUILDER_ORIGIN: "http://builder.redxtrm.example" },
    { ...validEnvironment, T3_REDXTRM_BUILDER_ORIGIN: "https://builder.redxtrm.example/path" },
    { ...validEnvironment, T3_REDXTRM_BUILDER_ORIGIN: "https://user:pass@builder.redxtrm.example" },
  ])("fails closed for partial or unsafe configuration %#", (environment) => {
    expect(resolveBuilderHandoffConfig(environment)).toBeUndefined();
  });

  it("permits HTTP only for loopback outside production", () => {
    expect(
      resolveBuilderHandoffConfig({
        ...validEnvironment,
        NODE_ENV: "development",
        T3_REDXTRM_BUILDER_ORIGIN: "http://127.0.0.1:4173",
      })?.audience,
    ).toBe("http://127.0.0.1:4173");
    expect(
      resolveBuilderHandoffConfig({
        ...validEnvironment,
        NODE_ENV: "development",
        T3_REDXTRM_BUILDER_ORIGIN: "http://builder.redxtrm.example",
      }),
    ).toBeUndefined();
  });
});
