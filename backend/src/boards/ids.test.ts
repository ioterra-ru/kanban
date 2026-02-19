import { describe, expect, it } from "vitest";
import { BoardIdSchema, DEFAULT_BOARD_ID } from "./ids.js";

describe("BoardIdSchema", () => {
  it("accepts a normal UUID", () => {
    expect(BoardIdSchema.parse("550e8400-e29b-41d4-a716-446655440000")).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("accepts DEFAULT_BOARD_ID even if it is non-standard uuid version", () => {
    expect(BoardIdSchema.parse(DEFAULT_BOARD_ID)).toBe(DEFAULT_BOARD_ID);
  });

  it("rejects invalid values", () => {
    expect(() => BoardIdSchema.parse("not-a-uuid")).toThrow();
  });
});

