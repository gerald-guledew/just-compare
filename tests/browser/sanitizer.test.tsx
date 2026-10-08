import { describe, expect, it } from "vitest";
// Exercise the actual Monaco rendering boundary, including its sanitizer patch.
import { sanitizeHtml } from "monaco-editor/esm/vs/base/browser/domSanitize.js";

function render(markup: string, config?: object): Document {
  return new DOMParser().parseFromString(
    String(sanitizeHtml(markup, config)),
    "text/html",
  );
}

describe("Monaco markup sanitization", () => {
  it("preserves safe formatting and removes scripts, event handlers, and unsafe URLs", () => {
    const output = render(
      '<p><strong>safe</strong><script>alert(1)</script>' +
        '<img src="https://example.com/image.png" onerror="alert(1)">' +
        '<a href="javascript:alert(1)">link</a></p>',
    );
    expect(output.querySelector("strong")?.textContent).toBe("safe");
    expect(output.querySelector("script")).toBeNull();
    expect(output.querySelector("img")?.hasAttribute("onerror")).toBe(false);
    expect(output.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(output.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/image.png",
    );
  });

  it("does not retain custom protocol hooks between rendering calls", () => {
    const markup = '<a href="custom:document">link</a>';
    const permitted = render(markup, {
      allowedLinkProtocols: { override: ["custom"] },
    });
    expect(permitted.querySelector("a")?.getAttribute("href")).toBe(
      "custom:document",
    );
    const standard = render(markup);
    expect(standard.querySelector("a")?.hasAttribute("href")).toBe(false);
  });
});
