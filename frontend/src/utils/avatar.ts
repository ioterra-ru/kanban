export const AVATAR_PRESETS = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10", "a11", "a12"] as const;
export type AvatarPreset = (typeof AVATAR_PRESETS)[number];

export function autoAvatarPreset(userId: string) {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % AVATAR_PRESETS.length;
  return AVATAR_PRESETS[idx];
}

export function avatarSrc(u: { id: string; avatarUploadName?: string | null; avatarPreset?: string | null }) {
  if (u.avatarUploadName) return `/api/auth/avatar/${u.id}?v=${encodeURIComponent(u.avatarUploadName)}`;
  const key = (u.avatarPreset && (AVATAR_PRESETS as readonly string[]).includes(u.avatarPreset) ? u.avatarPreset : autoAvatarPreset(u.id)) as string;
  return `/avatars/${key}.svg`;
}

