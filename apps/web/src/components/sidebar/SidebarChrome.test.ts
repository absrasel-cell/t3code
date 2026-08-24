import { describe, expect, it } from "@effect/vitest";

import { nextAppearanceMode } from "./SidebarChrome";

describe("sidebar appearance mode toggle", () => {
  it("switches between explicit light and dark modes", () => {
    expect(nextAppearanceMode("light")).toBe("dark");
    expect(nextAppearanceMode("dark")).toBe("light");
  });
});
