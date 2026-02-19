import { describe, expect, it } from "vitest";
import { AVATAR_PRESETS, isAvatarPreset, randomAvatarPreset } from "./avatarPresets.js";

describe("avatar presets", () => {
  it("has a stable list", () => {
    expect(AVATAR_PRESETS.length).toBeGreaterThanOrEqual(6);
  });

  it("isAvatarPreset validates values", () => {
    expect(isAvatarPreset("a1")).toBe(true);
    expect(isAvatarPreset("a12")).toBe(true);
    expect(isAvatarPreset("a0")).toBe(false);
    expect(isAvatarPreset(null)).toBe(false);
  });

  it("randomAvatarPreset returns a value from the list", () => {
    const v = randomAvatarPreset();
    expect(isAvatarPreset(v)).toBe(true);
  });
});

