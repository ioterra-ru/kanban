export type ColumnId =
  | "BACKLOG"
  | "HIGH_PRIORITY"
  | "TODO"
  | "IN_PROGRESS"
  | "READY_FOR_ACCEPTANCE"
  | "DONE";

export type Importance = "LOW" | "MEDIUM" | "HIGH";

export type Role = "ADMIN" | "MEMBER";

export type User = {
  id: string;
  email: string;
  name: string;
  avatarPreset?: string | null;
  avatarUploadName?: string | null;
  role: Role;
  totpEnabled: boolean;
  mustChangePassword: boolean;
  defaultBoardId: string | null;
};

export type Board = {
  id: string;
  name: string;
  description?: string | null;
  memberIds?: string[];
};

export type CardSummary = {
  id: string;
  description: string;
  assignee: string | null;
  dueDate: string | null;
  column: ColumnId;
  position: number;
  importance: Importance;
  paused: boolean;
  details?: string | null;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  attachmentCount: number;
};

export type BoardColumn = {
  id: ColumnId;
  title: string;
  cards: CardSummary[];
};

export type BoardResponse = {
  columns: BoardColumn[];
};

export type Comment = {
  id: string;
  cardId: string;
  author: string | null;
  authorId?: string | null;
  body: string;
  createdAt: string;
};

export type Attachment = {
  id: string;
  cardId: string;
  filename: string;
  storedName: string;
  mimeType: string;
  size: number;
  relativePath: string;
  createdAt: string;
  url?: string;
};

export type CardParticipant = {
  user: Pick<User, "id" | "email" | "name" | "avatarPreset" | "avatarUploadName">;
};

export type CardDetail = {
  id: string;
  description: string;
  details: string | null;
  assignee: string | null;
  dueDate: string | null;
  column: ColumnId;
  position: number;
  importance: Importance;
  paused: boolean;
  createdAt: string;
  updatedAt: string;
  comments: Comment[];
  attachments: Attachment[];
  participants?: CardParticipant[];
};

