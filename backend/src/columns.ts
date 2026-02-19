import type { ColumnId } from "./domain.js";

export const COLUMNS_IN_ORDER: Array<{ id: ColumnId; title: string }> = [
  { id: "BACKLOG", title: "Backlog" },
  { id: "HIGH_PRIORITY", title: "High priority" },
  { id: "TODO", title: "ToDo" },
  { id: "IN_PROGRESS", title: "In Progress" },
  { id: "READY_FOR_ACCEPTANCE", title: "Ready For Acceptance" },
  { id: "DONE", title: "Done" },
];

