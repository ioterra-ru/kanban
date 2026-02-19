import type { BoardResponse, CardDetail, ColumnId, Importance } from "./types";

// In containers we use same-origin (nginx proxies /api and /uploads to backend),
// so default base URL is empty (relative requests).
const RAW_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
const API_URL = RAW_BASE.replace(/\/+$/, "");

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = 8000;
  const t = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: "include",
      signal: controller.signal,
      headers: {
        ...(init?.headers ?? {}),
        ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      },
    });
  } catch (e) {
    if ((e as any)?.name === "AbortError") throw new Error("Timeout");
    throw e;
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let parsedError: string | undefined;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      parsedError = parsed?.error;
    } catch {
      parsedError = undefined;
    }
    if (parsedError) throw new Error(parsedError);
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }
  return (await res.json()) as T;
}

export const Api = {
  fetchBoard: () => api<{ columns: BoardResponse["columns"] }>("/api/board"),

  fetchCard: (id: string) => api<{ card: CardDetail }>(`/api/cards/${id}`),

  createCard: (input: {
    description: string;
    details?: string | null;
    assignee?: string | null;
    dueDate?: string | null;
    column?: ColumnId;
    importance?: Importance;
    paused?: boolean;
  }) => api<{ card: unknown }>("/api/cards", { method: "POST", body: JSON.stringify(input) }),

  updateCard: (
    id: string,
    input: {
      description?: string;
      details?: string | null;
      assignee?: string | null;
      dueDate?: string | null;
      importance?: Importance;
      paused?: boolean;
    },
  ) => api<{ card: unknown }>(`/api/cards/${id}`, { method: "PATCH", body: JSON.stringify(input) }),

  listAllUsers: () =>
    api<{ users: Array<{ id: string; email: string; name: string; avatarPreset?: string | null; avatarUploadName?: string | null; role: string }> }>(
      "/api/users",
    ),

  addParticipant: (cardId: string, input: { userId: string }) =>
    api<{ participant: unknown }>(`/api/cards/${cardId}/participants`, { method: "POST", body: JSON.stringify(input) }),

  removeParticipant: (cardId: string, userId: string) =>
    api<{ ok: true }>(`/api/cards/${cardId}/participants/${userId}`, { method: "DELETE" }),

  moveCard: (id: string, input: { toColumn: ColumnId; toIndex: number }) =>
    api<{ ok: true }>(`/api/cards/${id}/move`, { method: "POST", body: JSON.stringify(input) }),

  deleteCard: (id: string) => api<{ ok: true }>(`/api/cards/${id}`, { method: "DELETE" }),

  addComment: (cardId: string, input: { body: string }) =>
    api<{ comment: unknown }>(`/api/cards/${cardId}/comments`, { method: "POST", body: JSON.stringify(input) }),

  updateComment: (commentId: string, input: { body: string }) =>
    api<{ comment: unknown }>(`/api/comments/${commentId}`, { method: "PATCH", body: JSON.stringify(input) }),

  deleteComment: (commentId: string) =>
    api<{ ok: true }>(`/api/comments/${commentId}`, { method: "DELETE" }),

  uploadAttachment: async (cardId: string, file: File) => {
    const fd = new FormData();
    fd.set("file", file);
    return await api<{ attachment: unknown }>(`/api/cards/${cardId}/attachments`, {
      method: "POST",
      body: fd,
    });
  },

  deleteAttachment: (id: string) =>
    api<{ ok: true }>(`/api/attachments/${id}`, { method: "DELETE" }),

  downloadAttachmentUrl: (id: string) => `${API_URL}/api/attachments/${id}/download`,

  uploadsBaseUrl: () => `${API_URL}`,

  me: () => api<{ user: any; twoFactorPassed?: boolean; currentBoardId?: string | null }>("/api/auth/me"),
  login: (input: { login: string; password: string; totp?: string; rememberDevice?: boolean }) =>
    api<{ user: any; twoFactorPassed?: boolean; currentBoardId?: string | null }>("/api/auth/login", { method: "POST", body: JSON.stringify(input) }),
  logout: () => api<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  changePassword: (input: { newPassword: string }) =>
    api<{ ok: true }>("/api/auth/password", { method: "POST", body: JSON.stringify(input) }),
  forgotPassword: (input: { login: string }) =>
    api<{ ok: true }>("/api/auth/password/forgot", { method: "POST", body: JSON.stringify(input) }),
  resetPasswordByToken: (input: { token: string; newPassword: string }) =>
    api<{ ok: true }>("/api/auth/password/reset", { method: "POST", body: JSON.stringify(input) }),
  resetPasswordByTotp: (input: { login: string; code: string; newPassword: string }) =>
    api<{ ok: true }>("/api/auth/password/reset-by-totp", { method: "POST", body: JSON.stringify(input) }),
  twoFaSetup: () => api<{ secret: string; otpauthUrl: string; qrDataUrl: string }>("/api/auth/2fa/setup", { method: "POST" }),
  twoFaEnable: (input: { code: string }) =>
    api<{ ok: true }>("/api/auth/2fa/enable", { method: "POST", body: JSON.stringify(input) }),
  twoFaVerify: (input: { code: string; rememberDevice?: boolean }) =>
    api<{ ok: true }>("/api/auth/2fa/verify", { method: "POST", body: JSON.stringify(input) }),

  getProfile: () => api<{ user: any }>("/api/auth/profile"),
  updateProfile: (input: { name?: string; email?: string; defaultBoardId?: string; avatarPreset?: string | null }) =>
    api<{ user: any; currentBoardId?: string | null }>("/api/auth/profile", { method: "PATCH", body: JSON.stringify(input) }),
  uploadMyAvatar: async (file: File) => {
    const fd = new FormData();
    fd.set("file", file);
    return await api<{ user: any }>("/api/auth/profile/avatar", { method: "POST", body: fd });
  },
  deleteMyAvatar: () => api<{ user: any }>("/api/auth/profile/avatar", { method: "DELETE" }),

  getMailSettings: () =>
    api<{ settings: { enabled: boolean; host: string; port: number; secure: boolean; user: string; from: string; passSet: boolean } }>(
      "/api/auth/mail-settings",
    ),
  updateMailSettings: (input: {
    enabled: boolean;
    host?: string | null;
    port?: number | null;
    secure?: boolean | null;
    user?: string | null;
    pass?: string | null;
    from?: string | null;
  }) =>
    api<{ settings: { enabled: boolean; host: string; port: number; secure: boolean; user: string; from: string; passSet: boolean } }>(
      "/api/auth/mail-settings",
      { method: "PUT", body: JSON.stringify(input) },
    ),
  testMailSettings: (input: { host?: string | null; port?: number | null; secure?: boolean | null; user?: string | null; pass?: string | null; from?: string | null }) =>
    api<{ ok: boolean; error?: string; from?: string }>("/api/auth/mail-settings/test", { method: "POST", body: JSON.stringify(input) }),

  listBoards: () =>
    api<{ boards: Array<{ id: string; name: string; description?: string | null; memberIds?: string[] }>; currentBoardId: string | null }>(
      "/api/boards",
    ),
  selectBoard: (input: { boardId: string }) =>
    api<{ ok: true; currentBoardId: string }>("/api/boards/select", { method: "POST", body: JSON.stringify(input) }),
  createBoard: (input: { name: string; description?: string | null; memberIds?: string[] }) =>
    api<{ board: { id: string; name: string; description?: string | null; memberIds?: string[] } }>("/api/boards", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateBoard: (id: string, input: { name?: string; description?: string | null; memberIds?: string[] }) =>
    api<{ board: { id: string; name: string; description?: string | null; memberIds?: string[] } }>(`/api/boards/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteBoard: (id: string) => api<{ ok: true }>(`/api/boards/${id}`, { method: "DELETE" }),

  listUsers: () => api<{ users: any[] }>("/api/auth/users"),
  createUser: (input: { email: string; name?: string; role?: "ADMIN" | "MEMBER"; password: string }) =>
    api<{ user: any }>("/api/auth/users", { method: "POST", body: JSON.stringify(input) }),
  resetUserPassword: (userId: string, input: { newPassword: string }) =>
    api<{ ok: true }>(`/api/auth/users/${userId}/password`, { method: "POST", body: JSON.stringify(input) }),
  adminUpdateUser: (userId: string, input: { email?: string; role?: "ADMIN" | "MEMBER" }) =>
    api<{ user: any }>(`/api/auth/users/${userId}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteUser: (userId: string) => api<{ ok: true }>(`/api/auth/users/${userId}`, { method: "DELETE" }),

  adminGetUserBoards: (userId: string) =>
    api<{ defaultBoardId: string | null; boards: Array<{ id: string; name: string; hasAccess: boolean }> }>(
      `/api/auth/users/${userId}/boards`,
    ),
  adminSetUserBoards: (userId: string, input: { boardIds: string[]; defaultBoardId: string }) =>
    api<{ ok: true }>(`/api/auth/users/${userId}/boards`, { method: "PUT", body: JSON.stringify(input) }),
};

