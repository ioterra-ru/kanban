import type { Role } from "@prisma/client";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  avatarPreset: string | null;
  avatarUploadName: string | null;
  role: Role;
  /** Админ требует 2FA для этой учётной записи. */
  totpEnabled: boolean;
  /** Секрет TOTP уже сохранён (настройка завершена). */
  totpConfigured: boolean;
  mustChangePassword: boolean;
  defaultBoardId: string | null;
};

