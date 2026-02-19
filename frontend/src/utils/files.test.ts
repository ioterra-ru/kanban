import { describe, expect, it } from "vitest";
import { compactFileName, compactMiddle } from "./files";

describe("compactMiddle", () => {
  it("returns original when within limit", () => {
    expect(compactMiddle("hello", 10)).toBe("hello");
  });

  it("compacts long text with ellipsis", () => {
    const out = compactMiddle("abcdefghijklmnopqrstuvwxyz", 10);
    expect(out.length).toBe(10);
    expect(out.includes("…")).toBe(true);
  });
});

describe("compactFileName", () => {
  it("keeps extension", () => {
    const out = compactFileName("very-very-very-long-name-of-document.pdf", 18);
    expect(out.endsWith(".pdf")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(18);
  });

  it("handles names without extension", () => {
    const out = compactFileName("veryveryveryveryverylongname", 12);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out.includes("…")).toBe(true);
  });
});

