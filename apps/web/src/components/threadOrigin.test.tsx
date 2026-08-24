import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { parseThreadOrigin, plainThreadTitle, ThreadOriginTitle } from "./threadOrigin";

describe("thread origin titles", () => {
  it("turns a supported channel prefix into an accessible icon", () => {
    const markup = renderToStaticMarkup(<ThreadOriginTitle title="[whatsapp] LLP filing work" />);

    expect(markup).toContain('aria-label="from WhatsApp"');
    expect(markup).toContain("LLP filing work");
    expect(markup).not.toContain("[whatsapp]");
    expect(plainThreadTitle("[whatsapp] LLP filing work")).toBe("LLP filing work");
  });

  it("keeps unknown channel kinds legible and leaves ordinary titles alone", () => {
    expect(parseThreadOrigin("[client-portal] Intake")).toEqual({
      kind: "client-portal",
      text: "Intake",
    });
    expect(renderToStaticMarkup(<ThreadOriginTitle title="[client-portal] Intake" />)).toContain(
      "client-portal",
    );
    expect(renderToStaticMarkup(<ThreadOriginTitle title="Ordinary thread" />)).toBe(
      "Ordinary thread",
    );
  });
});
