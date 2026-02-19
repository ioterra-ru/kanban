import type { Role } from "@prisma/client";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  avatarPreset: string | null;
  avatarUploadName: string | null;
  role: Role;
  totpEnabled: boolean;
  mustChangePassword: boolean;
  defaultBoardId: string | null;
};

