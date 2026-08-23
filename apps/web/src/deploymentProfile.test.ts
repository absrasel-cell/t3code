import { describe, expect, it } from "@effect/vitest";

import { isLlpChatOnlyRestrictedRoute } from "./deploymentProfile";

describe("LLP chat-only routes", () => {
  it("keeps chat and pairing reachable", () => {
    expect(isLlpChatOnlyRestrictedRoute("/")).toBe(false);
    expect(isLlpChatOnlyRestrictedRoute("/pair")).toBe(false);
    expect(isLlpChatOnlyRestrictedRoute("/env/thread")).toBe(false);
  });

  it("removes administrative and repository surfaces", () => {
    for (const pathname of [
      "/connect",
      "/pull-requests",
      "/usage",
      "/settings/providers",
      "/projects/project-1",
    ]) {
      expect(isLlpChatOnlyRestrictedRoute(pathname)).toBe(true);
    }
  });
});
