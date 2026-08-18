import type { BuilderSessionScope } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { builderProjectId, sameBuilderAuthority } from "./builderSessionScope.ts";

const scope: BuilderSessionScope = {
  v: 1,
  handoffJti: "33333333-3333-4333-8333-333333333333",
  subject: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  tenantKey: "22222222-2222-4222-8222-222222222222",
  projectKey: "domain:client-example",
  role: "member",
};

describe("builder session scope", () => {
  it("derives a stable opaque id from tenant, project, and user authority", () => {
    expect(builderProjectId({ ...scope, handoffJti: "55555555-5555-4555-8555-555555555555" })).toBe(
      builderProjectId(scope),
    );
    expect(
      builderProjectId({ ...scope, subject: "66666666-6666-4666-8666-666666666666" }),
    ).not.toBe(builderProjectId(scope));
    expect(
      builderProjectId({
        ...scope,
        workspaceId: "77777777-7777-4777-8777-777777777777",
        tenantKey: "77777777-7777-4777-8777-777777777777",
      }),
    ).not.toBe(builderProjectId(scope));
  });

  it("allows a fresh handoff only for the same immutable user authority", () => {
    expect(
      sameBuilderAuthority(scope, {
        ...scope,
        handoffJti: "55555555-5555-4555-8555-555555555555",
      }),
    ).toBe(true);
    expect(
      sameBuilderAuthority(scope, {
        ...scope,
        subject: "66666666-6666-4666-8666-666666666666",
      }),
    ).toBe(false);
  });
});
