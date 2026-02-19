export const ColumnIds = [
  "BACKLOG",
  "HIGH_PRIORITY",
  "TODO",
  "IN_PROGRESS",
  "READY_FOR_ACCEPTANCE",
  "DONE",
] as const;

export type ColumnId = (typeof ColumnIds)[number];

export const ImportanceIds = ["LOW", "MEDIUM", "HIGH"] as const;
export type ImportanceId = (typeof ImportanceIds)[number];

