import crypto from "node:crypto";

export const AVATAR_PRESETS = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10", "a11", "a12"] as const;
export type AvatarPreset = (typeof AVATAR_PRESETS)[number];

export function isAvatarPreset(v: unknown): v is AvatarPreset {
  return typeof v === "string" && (AVATAR_PRESETS as readonly string[]).includes(v);
}

export function randomAvatarPreset() {
  return AVATAR_PRESETS[crypto.randomInt(0, AVATAR_PRESETS.length)];
}

