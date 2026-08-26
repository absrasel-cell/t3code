import { describe, expect, it } from "@effect/vitest";

import { nextAppearanceMode, sidebarBrandLabelForAppName } from "./SidebarChrome";

describe("sidebar brand label", () => {
  it("uses the owner brand for r3xCode deployments", () => {
    expect(sidebarBrandLabelForAppName("r3xCode")).toBe("R3xCode");
  });

  it("keeps the stock wordmark for other deployments", () => {
    expect(sidebarBrandLabelForAppName("T3 Code")).toBeNull();
  });
});

describe("sidebar appearance mode toggle", () => {
  it("switches between explicit light and dark modes", () => {
    expect(nextAppearanceMode("light")).toBe("dark");
    expect(nextAppearanceMode("dark")).toBe("light");
  });
});
