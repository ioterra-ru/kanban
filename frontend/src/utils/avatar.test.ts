import { describe, expect, it } from "vitest";
import { AVATAR_PRESETS, autoAvatarPreset, avatarSrc } from "./avatar";

describe("avatar utils", () => {
  it("autoAvatarPreset is stable and in presets", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const a = autoAvatarPreset(id);
    const b = autoAvatarPreset(id);
    expect(a).toBe(b);
    expect(AVATAR_PRESETS.includes(a)).toBe(true);
  });

  it("avatarSrc uses uploaded avatar when present", () => {
    const src = avatarSrc({ id: "u1", avatarUploadName: "pic.png", avatarPreset: "a1" });
    expect(src).toContain("/api/auth/avatar/u1");
    expect(src).toContain("pic.png");
  });

  it("avatarSrc falls back to preset or auto", () => {
    const src1 = avatarSrc({ id: "u2", avatarPreset: "a2" });
    expect(src1).toBe("/avatars/a2.svg");
    const src2 = avatarSrc({ id: "u3", avatarPreset: "bad" as any });
    expect(src2.startsWith("/avatars/")).toBe(true);
  });
});

