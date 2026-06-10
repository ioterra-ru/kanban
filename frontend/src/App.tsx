import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type RefObject } from "react";
import {
  type CollisionDetection,
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { format } from "date-fns";

import { Api } from "./api";
import { MarkdownHtmlBlock, MarkdownRichEditor } from "./components/MarkdownRichEditor";
import type {
  Board,
  BoardColumn,
  CardDetail,
  CardSearchHit,
  CardSummary,
  ColumnId,
  Comment as CardComment,
  Importance,
  User,
  UserActivityListItem,
} from "./types";
import { extractAttachmentIdsFromMarkdown, markdownForUploadedAttachment } from "./utils/commentAttachments";
import { compactFileName } from "./utils/files";
import { AVATAR_PRESETS, autoAvatarPreset, avatarSrc } from "./utils/avatar";

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function importanceLabel(importance: Importance) {
  switch (importance) {
    case "LOW":
      return "Низкая";
    case "MEDIUM":
      return "Средняя";
    case "HIGH":
      return "Высокая";
  }
}

function importanceBadge(importance: Importance) {
  switch (importance) {
    case "LOW":
      return "bg-slate-200 text-slate-900";
    case "MEDIUM":
      return "bg-[#246c7c] text-white";
    case "HIGH":
      return "bg-[#ac4c1c] text-white";
  }
}

function cardBorderClass(importance: Importance) {
  switch (importance) {
    case "LOW":
      return "border-slate-200 hover:border-slate-300";
    case "MEDIUM":
      return "border-[#246c7c] hover:border-[#246c7c]";
    case "HIGH":
      return "border-[#ac4c1c] hover:border-[#ac4c1c]";
  }
}

function getCardShareLink(boardId: string, cardId: string): string {
  const base = window.location.origin + window.location.pathname + (window.location.search || "");
  return `${base}#board/${boardId}/card/${cardId}`;
}

function roleLabelRu(role: User["role"]) {
  if (role === "ADMIN") return "Администратор";
  if (role === "OBSERVER") return "Наблюдатель";
  return "Участник";
}

function Modal(props: {
  open: boolean;
  title?: string;
  headerLeft?: React.ReactNode;
  headerRight?: React.ReactNode;
  headerClassName?: string;
  showCloseButton?: boolean;
  panelClassName?: string;
  panelStyle?: React.CSSProperties;
  panelOverlay?: React.ReactNode;
  /** Панель на весь вьюпорт без отступов оверлея (окно «на весь экран»). */
  fillViewport?: boolean;
  /** Область под шапкой: по умолчанию вертикальный скролл; для карточки — flex-колонка без внешнего скролла. */
  bodyClassName?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!props.open) return null;
  const showClose = props.showCloseButton ?? true;
  const fill = !!props.fillViewport;
  const headerLeft = props.headerLeft ?? (props.title ? <div className="text-lg font-semibold">{props.title}</div> : null);
  const headerRight =
    props.headerRight ??
    (showClose ? (
      <IconButton title="Закрыть" onClick={props.onClose}>
        <IconX className="h-5 w-5" />
      </IconButton>
    ) : null);

  return (
    <div
      className={classNames(
        "fixed inset-0 z-50 flex bg-black/60",
        fill ? "items-stretch justify-stretch p-0" : "items-center justify-center p-4",
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        className={classNames(
          "relative flex min-h-0 flex-col overflow-hidden bg-white shadow-2xl",
          fill
            ? "h-full max-h-full w-full rounded-none"
            : classNames(
                "w-full max-w-5xl rounded-2xl border border-slate-200",
                props.panelStyle?.height ? "" : "max-h-[80vh]",
              ),
          props.panelClassName,
        )}
        style={props.panelStyle}
      >
        {(headerLeft || headerRight) && (
          <div
            className={classNames(
              "flex items-start justify-between gap-4 border-b border-slate-200 p-4",
              props.headerClassName,
            )}
          >
            <div className="min-w-0 flex-1">{headerLeft}</div>
            <div className="shrink-0">{headerRight}</div>
          </div>
        )}
        <div
          className={classNames(
            "flex-1 p-4",
            fill && "min-h-0",
            props.bodyClassName ?? "overflow-x-hidden overflow-y-auto",
          )}
        >
          {props.children}
        </div>
        {props.panelOverlay}
      </div>
    </div>
  );
}

function ColumnDropZone(props: { id: ColumnId; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id: `column:${props.id}` });
  return (
    <div
      ref={setNodeRef}
      className={classNames(
        "flex h-full min-h-[120px] flex-col rounded-xl border border-slate-200 bg-white p-2",
        isOver && "ring-2 ring-[#246c7c]",
      )}
    >
      {props.children}
    </div>
  );
}

const COLUMN_PREFIX = "col:";

function SortableBoardColumnRow(props: {
  col: { id: string; title: string; position: number; _count?: { cards: number } };
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.col.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const handle = (
    <span
      {...attributes}
      {...listeners}
      className="cursor-grab touch-none rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
      title="Перетащите для изменения порядка"
      aria-label="Изменить порядок"
    >
      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 16 16">
        <circle cx="4" cy="5" r="1.2" />
        <circle cx="12" cy="5" r="1.2" />
        <circle cx="4" cy="8" r="1.2" />
        <circle cx="12" cy="8" r="1.2" />
        <circle cx="4" cy="11" r="1.2" />
        <circle cx="12" cy="11" r="1.2" />
      </svg>
    </span>
  );
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={classNames(
        "flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2",
        isDragging && "opacity-80 shadow-lg",
      )}
    >
      {handle}
      {props.children}
    </div>
  );
}

function SortableColumnSection(props: {
  col: BoardColumn;
  renderHeader: (dragHandle: React.ReactNode) => React.ReactNode;
  children: React.ReactNode;
  columnDragDisabled?: boolean;
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({
    id: `${COLUMN_PREFIX}${props.col.id}`,
    disabled: !!props.columnDragDisabled,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const handle = (
    <span
      {...attributes}
      {...listeners}
      className="cursor-grab touch-none rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
      title="Перетащите для изменения порядка колонок"
      aria-label="Изменить порядок колонки"
    >
      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 16 16">
        <circle cx="4" cy="5" r="1.2" />
        <circle cx="12" cy="5" r="1.2" />
        <circle cx="4" cy="8" r="1.2" />
        <circle cx="12" cy="8" r="1.2" />
        <circle cx="4" cy="11" r="1.2" />
        <circle cx="12" cy="11" r="1.2" />
      </svg>
    </span>
  );
  return (
    <section
      ref={setNodeRef}
      style={style}
      className={classNames(
        "column-section flex h-full min-h-0 w-[340px] shrink-0 flex-col",
        isDragging && "opacity-80 ring-2 ring-[#246c7c] rounded-xl",
      )}
    >
      <div className="column-scroll-area flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="sticky top-0 z-10 shrink-0 border-b border-slate-100 bg-white pb-2 pt-0.5">
          {props.renderHeader(handle)}
        </div>
        <div className="min-h-0 flex-1">{props.children}</div>
      </div>
    </section>
  );
}

function CardTile(props: {
  card: CardSummary;
  assigneeDisplay?: string | null;
  assigneeUser?: { id: string; avatarUploadName?: string | null; avatarPreset?: string | null; name?: string } | null;
  onClick: () => void;
  isSelected?: boolean;
  cardRef?: (el: HTMLDivElement | null) => void;
  onDelete?: () => void;
  onArchive?: () => void;
  onShare?: () => void;
  dragDisabled?: boolean;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!actionsOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) setActionsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActionsOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [actionsOpen]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.card.id,
    data: { columnId: props.card.column },
    disabled: !!props.dragDisabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const setRefs = (el: HTMLDivElement | null) => {
    setNodeRef(el);
    props.cardRef?.(el);
  };

  const showActions = !!(props.onDelete || props.onArchive || props.onShare);

  return (
    <div
      ref={setRefs}
      style={style}
      className={classNames(
        "group rounded-xl border-2 bg-white p-3 shadow-sm transition-colors",
        cardBorderClass(props.card.importance),
        "hover:bg-slate-200",
        isDragging && "opacity-50",
        props.isSelected && "ring-2 ring-[#246c7c] ring-offset-2",
      )}
      {...attributes}
      {...listeners}
      onDoubleClick={props.onClick}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-900">
            {props.card.description}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            {props.assigneeDisplay ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                {props.assigneeUser ? <AvatarImg user={props.assigneeUser} size={24} /> : null}
                <span className="min-w-0 truncate">{props.assigneeDisplay}</span>
              </span>
            ) : null}
            {props.card.dueDate ? (
              <span>Срок: {format(new Date(props.card.dueDate), "dd.MM.yyyy HH:mm")}</span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-1.5">
            {props.card.isFavorite ? (
              <span className="text-amber-500" title="В избранном" aria-label="В избранном">
                <IconStarFilled className="h-4 w-4" />
              </span>
            ) : null}
            <span
              className={classNames("inline-block h-2.5 w-2.5 shrink-0 rounded", importanceBadge(props.card.importance))}
              title={importanceLabel(props.card.importance)}
              aria-label={importanceLabel(props.card.importance)}
            />
          </div>
          {props.card.paused ? (
            <span className="rounded-md bg-amber-300 px-2 py-0.5 text-[11px] font-semibold text-amber-950">
              Пауза
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            title="Открыть"
            aria-label="Открыть"
            onClick={(e) => {
              e.stopPropagation();
              props.onClick();
            }}
          >
            <IconEye className="h-4 w-4" />
          </button>
          <span>💬 {props.card.commentCount}</span>
          <span>📎 {props.card.attachmentCount}</span>
        </div>
        {showActions ? (
          <div className="relative" ref={actionsRef}>
            <button
              type="button"
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              title="Действия"
              aria-label="Действия"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setActionsOpen((v) => !v);
              }}
            >
              <IconMoreVertical className="h-4 w-4" />
            </button>
            {actionsOpen ? (
              <div className="absolute right-0 top-full z-10 mt-1 min-w-[2.5rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                {props.onShare ? (
                  <button
                    type="button"
                    className="flex w-full items-center justify-center px-3 py-2 text-slate-700 hover:bg-slate-50"
                    title="Поделиться"
                    aria-label="Поделиться"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActionsOpen(false);
                      props.onShare?.();
                    }}
                  >
                    <IconShare className="h-4 w-4 shrink-0" />
                  </button>
                ) : null}
                {props.onArchive ? (
                  <button
                    type="button"
                    className="flex w-full items-center justify-center px-3 py-2 text-slate-700 hover:bg-slate-50"
                    title="В архив"
                    aria-label="В архив"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActionsOpen(false);
                      props.onArchive?.();
                    }}
                  >
                    <IconArchive className="h-4 w-4 shrink-0" />
                  </button>
                ) : null}
                {props.onDelete ? (
                  <button
                    type="button"
                    className="flex w-full items-center justify-center border-t border-slate-100 px-3 py-2 text-rose-700 hover:bg-rose-50"
                    title="Удалить"
                    aria-label="Удалить"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActionsOpen(false);
                      props.onDelete?.();
                    }}
                  >
                    <IconTrash className="h-4 w-4 shrink-0 text-rose-600" />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function toDateTimeLocalValue(iso: string | null) {
  if (!iso) return "";
  return format(new Date(iso), "yyyy-MM-dd'T'HH:mm");
}

function IconMenu(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={props.className ?? "h-6 w-6"}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function IconStarOutline(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-5 w-5"} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path
        strokeLinejoin="round"
        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
      />
    </svg>
  );
}

function IconStarFilled(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-5 w-5"} fill="currentColor" aria-hidden>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function IconActivity(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={props.className ?? "h-5 w-5"}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function IconFilter(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={props.className ?? "h-5 w-5"}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

type MainMenuPanel = "main" | "activity" | "filter" | "favorites" | "boards";

function MainAppMenuFlyout(props: {
  boards: Board[];
  currentBoardId: string | null;
  allUsers: Array<Pick<User, "id" | "email" | "name" | "avatarPreset" | "avatarUploadName">>;
  onSelectBoard: (boardId: string) => Promise<void>;
  onOpenCardOnBoard: (boardId: string, cardId: string) => Promise<void>;
  setError: (msg: string | null) => void;
  onApplyBoardCardFilter: (cardIds: Iterable<string>) => void;
  onShowMyCardsOnBoard: () => Promise<void>;
}) {
  const leaveTimer = useRef<number | null>(null);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [panel, setPanel] = useState<MainMenuPanel>("main");

  const [activity, setActivity] = useState<UserActivityListItem[]>([]);
  const [activityNext, setActivityNext] = useState<string | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);

  const [favorites, setFavorites] = useState<
    Array<{ cardId: string; boardId: string; boardName: string; description: string; columnTitle: string }> | null
  >(null);

  const [filterAuthorId, setFilterAuthorId] = useState("");
  const [filterCustomer, setFilterCustomer] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterParticipantIds, setFilterParticipantIds] = useState<string[]>([]);
  const [filterText, setFilterText] = useState("");
  const [filterBusy, setFilterBusy] = useState(false);
  const [filterBoardMessage, setFilterBoardMessage] = useState<string | null>(null);
  const [filterParticipantAddOpen, setFilterParticipantAddOpen] = useState(false);
  const [filterParticipantAddSearch, setFilterParticipantAddSearch] = useState("");
  const filterParticipantPickerRef = useRef<HTMLDivElement | null>(null);

  const clearLeave = () => {
    if (leaveTimer.current !== null) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  };
  const openHover = () => {
    clearLeave();
    setHoverOpen(true);
  };
  const scheduleClose = () => {
    clearLeave();
    leaveTimer.current = window.setTimeout(() => {
      setHoverOpen(false);
      setPanel("main");
      leaveTimer.current = null;
    }, 240);
  };

  useEffect(() => {
    if (panel !== "activity") {
      setActivity([]);
      setActivityNext(null);
      return;
    }
    let cancelled = false;
    setActivityLoading(true);
    void Api.myActivity(null, 30)
      .then((d) => {
        if (cancelled) return;
        setActivity(d.items);
        setActivityNext(d.nextCursor);
      })
      .catch((e) => {
        if (!cancelled) props.setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [panel]);

  useEffect(() => {
    if (panel !== "favorites") {
      setFavorites(null);
      return;
    }
    void Api.listFavorites()
      .then((d) => setFavorites(d.items))
      .catch((e) => props.setError((e as Error).message));
  }, [panel]);

  useEffect(() => {
    if (panel !== "filter") {
      setFilterBoardMessage(null);
      setFilterParticipantAddOpen(false);
      setFilterParticipantAddSearch("");
    }
  }, [panel]);

  useEffect(() => {
    if (!filterParticipantAddOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (filterParticipantPickerRef.current && !filterParticipantPickerRef.current.contains(e.target as Node)) {
        setFilterParticipantAddOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc, true);
    return () => document.removeEventListener("mousedown", onDoc, true);
  }, [filterParticipantAddOpen]);

  const loadMoreActivity = () => {
    if (!activityNext || activityLoading) return;
    setActivityLoading(true);
    void Api.myActivity(activityNext, 30)
      .then((d) => {
        setActivity((prev) => [...prev, ...d.items]);
        setActivityNext(d.nextCursor);
      })
      .catch((e) => props.setError((e as Error).message))
      .finally(() => setActivityLoading(false));
  };

  const onActivityScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 120) return;
    loadMoreActivity();
  };

  const runFilter = () => {
    const has =
      !!filterAuthorId.trim() ||
      !!filterCustomer.trim() ||
      !!filterAssignee.trim() ||
      filterParticipantIds.length > 0 ||
      !!filterText.trim();
    if (!has) {
      props.setError("Укажите хотя бы одно поле фильтра");
      return;
    }
    props.setError(null);
    setFilterBusy(true);
    void Api.filterCardsGlobal({
      authorId: filterAuthorId.trim() || undefined,
      customer: filterCustomer.trim() || undefined,
      assignee: filterAssignee.trim() || undefined,
      participantUserIds: filterParticipantIds.length ? filterParticipantIds : undefined,
      text: filterText.trim() || undefined,
    })
      .then((d) => {
        props.onApplyBoardCardFilter(d.cards.map((c) => c.id));
        const bid = props.currentBoardId;
        const onThis = bid ? d.cards.filter((c) => c.boardId === bid).length : 0;
        setFilterBoardMessage(
          d.cards.length === 0
            ? "Ничего не найдено — на доске карточки скрыты."
            : `Найдено карточек: ${d.cards.length}. На текущей доске отображается: ${onThis}.`,
        );
      })
      .catch((e) => props.setError((e as Error).message))
      .finally(() => setFilterBusy(false));
  };

  const removeFilterParticipant = (id: string) => {
    setFilterParticipantIds((prev) => prev.filter((x) => x !== id));
  };

  const filterParticipantUsers = filterParticipantIds
    .map((id) => props.allUsers.find((u) => u.id === id))
    .filter(Boolean) as Array<Pick<User, "id" | "email" | "name" | "avatarPreset" | "avatarUploadName">>;

  const filterParticipantAddCandidates = (() => {
    const q = filterParticipantAddSearch.trim().toLowerCase();
    return props.allUsers
      .filter((u) => !filterParticipantIds.includes(u.id))
      .filter(
        (u) =>
          !q || (u.name ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q),
      );
  })();

  const back = () => {
    setPanel("main");
    props.setError(null);
  };

  const menuBtnClass =
    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-800 hover:bg-slate-100";
  const menuItemIconClass = "h-5 w-5 shrink-0 text-slate-500";

  return (
    <div className="relative z-[70] flex shrink-0 items-stretch" onMouseEnter={openHover} onMouseLeave={scheduleClose}>
      <button
        type="button"
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
        aria-label="Меню"
        title="Меню"
      >
        <IconMenu className="h-6 w-6" />
      </button>
      <div
        className={classNames(
          "pointer-events-none fixed left-0 top-0 z-[75] flex h-screen w-[min(22rem,calc(100vw-1rem))] -translate-x-full flex-col border-r border-slate-200 bg-white opacity-0 shadow-2xl transition-[transform,opacity] duration-200 ease-out",
          hoverOpen && "pointer-events-auto translate-x-0 opacity-100",
        )}
        onMouseEnter={openHover}
        onMouseLeave={scheduleClose}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-3">
          {panel === "main" ? (
            <div className="flex min-w-0 items-center gap-2.5">
              <img src="/ioterra.svg" alt="" className="h-9 w-9 shrink-0" width={36} height={36} aria-hidden />
              <span className="text-sm font-bold text-slate-900">Меню</span>
            </div>
          ) : (
            <button type="button" className="text-sm font-semibold text-[#246c7c] hover:underline" onClick={back}>
              ← Назад
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {panel === "main" ? (
            <nav className="flex flex-col gap-0.5">
              <button
                type="button"
                className={menuBtnClass}
                onClick={() => {
                  clearLeave();
                  setHoverOpen(false);
                  setPanel("main");
                  void props.onShowMyCardsOnBoard().catch((e) => props.setError((e as Error).message));
                }}
              >
                <IconColumns className={menuItemIconClass} />
                <span>Карточки</span>
              </button>
              <button type="button" className={menuBtnClass} onClick={() => setPanel("activity")}>
                <IconActivity className={menuItemIconClass} />
                <span>Активность</span>
              </button>
              <button type="button" className={menuBtnClass} onClick={() => setPanel("filter")}>
                <IconFilter className={menuItemIconClass} />
                <span>Фильтр</span>
              </button>
              <button type="button" className={menuBtnClass} onClick={() => setPanel("favorites")}>
                <IconStarOutline className={menuItemIconClass} />
                <span>Избранное</span>
              </button>
              <button type="button" className={menuBtnClass} onClick={() => setPanel("boards")}>
                <IconLayoutKanban className={menuItemIconClass} />
                <span>Доски</span>
              </button>
            </nav>
          ) : null}

          {panel === "activity" ? (
            <div className="flex max-h-[calc(100vh-8rem)] flex-col gap-2 overflow-y-auto" onScroll={onActivityScroll}>
              {activityLoading && activity.length === 0 ? (
                <div className="p-3 text-sm text-slate-500">Загрузка…</div>
              ) : !activity.length ? (
                <div className="p-3 text-sm text-slate-500">Пока нет записей активности.</div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {activity.map((a) => (
                    <li key={a.id} className="rounded-lg border border-slate-100 bg-slate-50/80 px-2 py-2 text-sm">
                      <div className="text-slate-800">{a.summary}</div>
                      <div className="mt-1 text-xs text-slate-500">{format(new Date(a.createdAt), "yyyy-MM-dd HH:mm")}</div>
                      {a.cardId && a.boardId ? (
                        <button
                          type="button"
                          className="mt-1 text-xs font-semibold text-[#246c7c] hover:underline"
                          onClick={() => {
                            clearLeave();
                            setHoverOpen(false);
                            setPanel("main");
                            void props.onOpenCardOnBoard(a.boardId!, a.cardId!);
                          }}
                        >
                          Открыть карточку
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {activityLoading && activity.length > 0 ? <div className="py-2 text-center text-xs text-slate-400">…</div> : null}
            </div>
          ) : null}

          {panel === "filter" ? (
            <div className="flex flex-col gap-3 px-1">
              <label className="block text-xs font-semibold text-slate-600">
                Автор
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  value={filterAuthorId}
                  onChange={(e) => setFilterAuthorId(e.target.value)}
                >
                  <option value="">—</option>
                  {props.allUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name || u.email}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-600">
                Заказчик (email)
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  value={filterCustomer}
                  onChange={(e) => setFilterCustomer(e.target.value)}
                  placeholder="user@example.com"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-600">
                Ответственный (email)
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  value={filterAssignee}
                  onChange={(e) => setFilterAssignee(e.target.value)}
                  placeholder="user@example.com"
                />
              </label>
              <div className="text-xs font-semibold text-slate-600">Участники</div>
              <div className="flex flex-wrap items-center gap-1.5">
                {filterParticipantUsers.map((u) => (
                  <div
                    key={u.id}
                    className="inline-flex max-w-[200px] items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-0.5 pr-1 text-xs shadow-sm"
                    title={u.email}
                  >
                    <AvatarImg user={u} size={22} />
                    <span className="min-w-0 truncate font-medium text-slate-800">{u.name || u.email}</span>
                    <button
                      type="button"
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                      title="Убрать"
                      aria-label="Убрать"
                      onClick={() => removeFilterParticipant(u.id)}
                    >
                      <IconX className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className={classNames(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-lg border-2 border-teal-300/80 bg-white text-slate-700 shadow-sm transition-colors hover:bg-teal-50/70 hover:text-[#246c7c] hover:border-teal-500",
                  )}
                  title="Добавить участника в фильтр"
                  aria-label="Добавить участника в фильтр"
                  onClick={() => setFilterParticipantAddOpen((v) => !v)}
                >
                  <IconPlus className="h-4 w-4" />
                </button>
              </div>
              {filterParticipantAddOpen ? (
                <div ref={filterParticipantPickerRef} className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                  <input
                    type="text"
                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-9 text-sm outline-none focus:border-[#246c7c]"
                    placeholder="Поиск пользователя…"
                    value={filterParticipantAddSearch}
                    onChange={(e) => setFilterParticipantAddSearch(e.target.value)}
                    autoFocus
                    aria-label="Поиск пользователя для фильтра"
                  />
                  <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-slate-100 py-1">
                    {filterParticipantAddCandidates.length === 0 ? (
                      <div className="px-3 py-3 text-center text-sm text-slate-500">Нет пользователей</div>
                    ) : (
                      filterParticipantAddCandidates.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
                          onClick={() => {
                            setFilterParticipantIds((prev) => (prev.includes(u.id) ? prev : [...prev, u.id]));
                            setFilterParticipantAddSearch("");
                          }}
                        >
                          <AvatarImg user={u} size={24} />
                          <span className="min-w-0 flex-1 truncate">{u.name || u.email}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
              <label className="block text-xs font-semibold text-slate-600">
                Текст в описании и комментариях
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="Поиск…"
                />
              </label>
              <button
                type="button"
                disabled={filterBusy}
                className="rounded-xl bg-[#246c7c] px-3 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
                onClick={runFilter}
              >
                {filterBusy ? "Поиск…" : "Найти"}
              </button>
              {filterBoardMessage ? (
                <p className="rounded-lg border border-slate-100 bg-slate-50/90 px-2 py-2 text-xs text-slate-700">{filterBoardMessage}</p>
              ) : null}
            </div>
          ) : null}

          {panel === "favorites" ? (
            <div>
              {!favorites ? (
                <div className="p-3 text-sm text-slate-500">Загрузка…</div>
              ) : favorites.length === 0 ? (
                <div className="p-3 text-sm text-slate-500">Нет избранных карточек.</div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {favorites.map((f) => (
                    <li key={f.cardId}>
                      <button
                        type="button"
                        className="w-full rounded-lg border border-slate-100 px-2 py-2 text-left text-sm hover:bg-slate-50"
                        onClick={() => {
                          clearLeave();
                          setHoverOpen(false);
                          setPanel("main");
                          void props.onOpenCardOnBoard(f.boardId, f.cardId);
                        }}
                      >
                        <div className="font-medium text-slate-900 line-clamp-2">{f.description}</div>
                        <div className="text-xs text-slate-500">
                          {f.boardName} · {f.columnTitle}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {panel === "boards" ? (
            <ul className="flex flex-col gap-1">
              {props.boards.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    className={classNames(
                      "w-full rounded-lg border px-2 py-2 text-left text-sm hover:bg-slate-50",
                      b.id === props.currentBoardId ? "border-[#246c7c] bg-teal-50/50" : "border-slate-100",
                    )}
                    onClick={() => {
                      clearLeave();
                      setHoverOpen(false);
                      setPanel("main");
                      void props.onSelectBoard(b.id);
                    }}
                  >
                    <div className="font-medium text-slate-900">{b.name}</div>
                    {b.description ? <div className="text-xs text-slate-500 line-clamp-2">{b.description}</div> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [me, setMe] = useState<{ user: User | null; twoFactorPassed: boolean } | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  /** Если задан — на доске показываются только карточки с этими id (меню «Карточки» / «Фильтр»). */
  const [boardVisibleCardIds, setBoardVisibleCardIds] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allUsers, setAllUsers] = useState<Array<Pick<User, "id" | "email" | "name" | "avatarPreset" | "avatarUploadName">> | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [currentBoardId, setCurrentBoardId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const [activeCardId, setActiveCardId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createColumn, setCreateColumn] = useState<ColumnId>("");
  const [createTitle, setCreateTitle] = useState("");
  const [createDetails, setCreateDetails] = useState("");
  const [createCustomer, setCreateCustomer] = useState("");

  const [cardOpen, setCardOpen] = useState(false);
  const [cardDetail, setCardDetail] = useState<CardDetail | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CardSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const columnSectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const cardTileRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [columnActionsOpen, setColumnActionsOpen] = useState<string | null>(null);
  const columnActionsRef = useRef<HTMLDivElement | null>(null);
  const [shareConfirm, setShareConfirm] = useState<{ cardTitle: string; link: string } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const isObserver = me?.user?.role === "OBSERVER";

  const displayColumns = useMemo(() => {
    if (!boardVisibleCardIds) return columns;
    return columns.map((col) => ({
      ...col,
      cards: col.cards.filter((c) => boardVisibleCardIds.has(c.id)),
    }));
  }, [columns, boardVisibleCardIds]);

  const boardFilterActive = boardVisibleCardIds !== null;

  const cardsById = useMemo(() => {
    const m = new Map<string, CardSummary>();
    for (const col of columns) for (const c of col.cards) m.set(c.id, c);
    return m;
  }, [columns]);

  const clearBoardCardFilter = useCallback(() => {
    setBoardVisibleCardIds(null);
  }, []);

  const onShowMyCardsOnBoard = useCallback(async () => {
    setError(null);
    const d = await Api.myParticipatedCards();
    if (!d.cards.length) {
      setError("Нет карточек, где вы участвуете.");
      return;
    }
    setBoardVisibleCardIds(new Set(d.cards.map((c) => c.id)));
  }, []);

  const onApplyBoardCardFilter = useCallback((cardIds: Iterable<string>) => {
    setBoardVisibleCardIds(new Set(cardIds));
  }, []);

  const userNameByEmail = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of allUsers ?? []) m.set(u.email, u.name);
    return m;
  }, [allUsers]);

  const userByEmail = useMemo(() => {
    const m = new Map<string, Pick<User, "id" | "email" | "name" | "avatarPreset" | "avatarUploadName">>();
    for (const u of allUsers ?? []) m.set(u.email, u);
    return m;
  }, [allUsers]);

  useEffect(() => {
    if (columnActionsOpen === null) return;
    const onMouseDown = (e: MouseEvent) => {
      if (columnActionsRef.current && !columnActionsRef.current.contains(e.target as Node)) setColumnActionsOpen(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setColumnActionsOpen(null);
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [columnActionsOpen]);

  const assigneeDisplay = (assignee: string | null) => {
    if (!assignee) return null;
    if (assignee.includes("@")) return userNameByEmail.get(assignee) ?? assignee;
    return assignee;
  };

  const assigneeUser = (assignee: string | null) => {
    if (!assignee) return null;
    if (!assignee.includes("@")) return null;
    return userByEmail.get(assignee) ?? null;
  };

  const loadMe = async () => {
    try {
      const data = await Api.me();
      setMe({ user: data.user as User | null, twoFactorPassed: !!data.twoFactorPassed });
      setCurrentBoardId((data as any).currentBoardId ?? null);
    } catch (e) {
      setMe({ user: null, twoFactorPassed: false });
      setCurrentBoardId(null);
    }
  };

  const reload = async () => {
    try {
      setError(null);
      const data = await Api.fetchBoard();
      setColumns(data.columns);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void loadMe();
  }, []);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.pathname === "/reset-password") {
        const t = url.searchParams.get("token");
        setResetToken(t && t.trim() ? t : null);
      } else {
        setResetToken(null);
      }
    } catch {
      setResetToken(null);
    }
  }, []);

  const openCardFromHash = useCallback(async () => {
    const hash = window.location.hash.slice(1);
    const m = hash.match(/^board\/([^/]+)\/card\/([^/]+)$/);
    if (!m) return;
    const [, boardId, cardId] = m;
    if (currentBoardId !== boardId) {
      await Api.selectBoard({ boardId });
      setCurrentBoardId(boardId);
      await reload();
    }
    try {
      const data = await Api.fetchCard(cardId);
      setCardDetail(data.card);
      setCardOpen(true);
    } catch {
      // card may not exist or no access
    }
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, [currentBoardId]);

  useEffect(() => {
    if (!me) return;
    const totpConfigured = !!me.user?.totpConfigured;
    const ok =
      !!me.user &&
      !me.user.mustChangePassword &&
      (!me.user.totpEnabled || (totpConfigured && me.twoFactorPassed));
    if (!ok) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let currentBoardIdFromLoad: string | null = null;
    void (async () => {
      try {
        const b = await Api.listBoards();
        setBoards(b.boards as any);
        const nextBoardId = b.currentBoardId ?? b.boards[0]?.id ?? null;
        if (nextBoardId && nextBoardId !== b.currentBoardId) {
          await Api.selectBoard({ boardId: nextBoardId });
        }
        currentBoardIdFromLoad = nextBoardId;
        setCurrentBoardId(nextBoardId);
        await Promise.all([
          reload(),
          Api.listAllUsers()
            .then((d) => setAllUsers(d.users as any))
            .catch(() => setAllUsers([])),
        ]);
        const hash = window.location.hash.slice(1);
        const hashMatch = hash.match(/^board\/([^/]+)\/card\/([^/]+)$/);
        if (hashMatch) {
          const [, boardId, cardId] = hashMatch;
          if (boardId !== currentBoardIdFromLoad) {
            await Api.selectBoard({ boardId });
            setCurrentBoardId(boardId);
            await reload();
          }
          try {
            const data = await Api.fetchCard(cardId);
            setCardDetail(data.card);
            setCardOpen(true);
          } catch {
            // ignore
          }
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [me?.user?.id, me?.twoFactorPassed, me?.user?.totpEnabled, me?.user?.totpConfigured, me?.user?.mustChangePassword]);

  useEffect(() => {
    const onHashChange = () => void openCardFromHash();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [openCardFromHash]);

  const handleShareCard = useCallback((cardTitle: string, link: string) => {
    navigator.clipboard.writeText(link).then(
      () => setShareConfirm({ cardTitle, link }),
      () => setShareConfirm({ cardTitle, link }),
    );
  }, []);

  const findColumnForCard = (cardId: string): { columnId: ColumnId; index: number } | null => {
    for (const col of columns) {
      const idx = col.cards.findIndex((c) => c.id === cardId);
      if (idx >= 0) return { columnId: col.id, index: idx };
    }
    return null;
  };

  /** Карточки: сначала цель под курсором (карточка или пустая зона column:), иначе closestCorners (в т.ч. col:… у секции). */
  const boardCollisionDetection = useCallback<CollisionDetection>(
    (args) => {
      if (String(args.active.id).startsWith(COLUMN_PREFIX)) {
        return closestCorners(args);
      }
      const pointerCollisions = pointerWithin(args);
      const overCard = pointerCollisions.filter((c) => findColumnForCard(String(c.id)));
      if (overCard.length > 0) return overCard;
      const overColumnDrop = pointerCollisions.find((c) => String(c.id).startsWith("column:"));
      if (overColumnDrop) return [overColumnDrop];
      return closestCorners(args);
    },
    [columns],
  );

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    const t = setTimeout(() => {
      setSearching(true);
      Api.searchCards(searchQuery.trim())
        .then((r) => {
          setSearchResults(r.cards);
          setSearchOpen(true);
        })
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSearchOpen(false);
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (searchOpen && searchInputRef.current && !searchInputRef.current.contains(target)) {
        const panel = (e.target as Element).closest?.("[data-search-panel]");
        if (!panel) setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [searchOpen]);

  if (me === null) {
    return <div className="flex h-full items-center justify-center text-slate-700">Загрузка…</div>;
  }

  if (resetToken) {
    return (
      <ResetPasswordView
        token={resetToken}
        onDone={() => {
          setResetToken(null);
          try {
            window.history.replaceState({}, "", "/");
          } catch {
            // ignore
          }
        }}
      />
    );
  }

  if (!me.user) {
    return <LoginView onDone={loadMe} />;
  }

  if (me.user.mustChangePassword) {
    return <ChangePasswordView onDone={loadMe} />;
  }

  if (me.user.totpEnabled && !me.user.totpConfigured) {
    return (
      <TwoFaSetupView
        user={me.user}
        onDone={loadMe}
        onUseOtherAccount={() => void Api.logout().then(loadMe)}
      />
    );
  }

  if (me.user.totpEnabled && me.user.totpConfigured && !me.twoFactorPassed) {
    return (
      <TwoFaVerifyView
        user={me.user}
        onDone={loadMe}
        onUseOtherAccount={() => void Api.logout().then(loadMe)}
      />
    );
  }

  const moveLocally = (cardId: string, toColumn: ColumnId, toIndex: number) => {
    setColumns((prev) => {
      const from = (() => {
        for (const col of prev) {
          const idx = col.cards.findIndex((c) => c.id === cardId);
          if (idx >= 0) return { columnId: col.id, index: idx, card: col.cards[idx] };
        }
        return null;
      })();
      if (!from) return prev;

      const next = prev.map((c) => ({ ...c, cards: [...c.cards] }));
      const fromCol = next.find((c) => c.id === from.columnId)!;
      const [card] = fromCol.cards.splice(from.index, 1);
      card.column = toColumn;

      const toCol = next.find((c) => c.id === toColumn)!;
      const idx = Math.max(0, Math.min(toIndex, toCol.cards.length));
      toCol.cards.splice(idx, 0, card);

      return next;
    });
  };

  const onOpenCard = async (id: string) => {
    try {
      setError(null);
      setSelectedCardId(null);
      setCardOpen(true);
      const data = await Api.fetchCard(id);
      setCardDetail(data.card);
    } catch (e) {
      setError((e as Error).message);
      setCardOpen(false);
    }
  };

  const navigateToBoardAndOpenCard = async (boardId: string, cardId: string) => {
    try {
      setError(null);
      setSearchOpen(false);
      setSearchQuery("");
      setSearchResults(null);
      if (currentBoardId !== boardId) {
        setBoardVisibleCardIds(null);
        setLoading(true);
        await Api.selectBoard({ boardId });
        setCurrentBoardId(boardId);
        await Promise.all([
          reload(),
          Api.listAllUsers()
            .then((d) => setAllUsers(d.users as any))
            .catch(() => setAllUsers([])),
        ]);
        setLoading(false);
      }
      await onOpenCard(cardId);
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  };

  const goToCard = (cardId: string, columnId: string) => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults(null);
    setSelectedCardId(cardId);
    requestAnimationFrame(() => {
      const colEl = columnSectionRefs.current.get(columnId);
      const cardEl = cardTileRefs.current.get(cardId);
      colEl?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      setTimeout(() => {
        cardEl?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    });
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center text-slate-700">Загрузка…</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-200 bg-white px-5 py-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center gap-3 flex-shrink-0">
            <MainAppMenuFlyout
              boards={boards}
              currentBoardId={currentBoardId}
              allUsers={allUsers ?? []}
              onSelectBoard={async (boardId) => {
                if (!boardId) return;
                setBoardVisibleCardIds(null);
                setLoading(true);
                try {
                  await Api.selectBoard({ boardId });
                  setCurrentBoardId(boardId);
                  await Promise.all([
                    reload(),
                    Api.listAllUsers()
                      .then((d) => setAllUsers(d.users as any))
                      .catch(() => setAllUsers([])),
                  ]);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setLoading(false);
                }
              }}
              onOpenCardOnBoard={navigateToBoardAndOpenCard}
              setError={setError}
              onApplyBoardCardFilter={onApplyBoardCardFilter}
              onShowMyCardsOnBoard={onShowMyCardsOnBoard}
            />
            <button
              type="button"
              onClick={() => {
                clearBoardCardFilter();
                setError(null);
              }}
              className="flex items-center gap-3 rounded-lg text-left outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-[#246c7c]/40"
              title="Показать все карточки на доске"
            >
              <img src="/ioterra.svg" alt="ИоТерра" className="h-16 w-16 shrink-0" />
              <div className="leading-tight">
                <div className="text-2xl font-extrabold text-slate-900">ИоТерра Канбан</div>
                <div className="mt-0.5 text-xs font-medium text-slate-400">
                  v{import.meta.env.VITE_APP_VERSION || "dev"} · © ИоТерра {new Date().getFullYear()}
                </div>
              </div>
            </button>
          </div>
          <div className="flex-1 flex justify-center items-stretch gap-2 min-w-0 h-12">
            {boards.length ? (
              <select
                className="h-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-white/90 pl-3 pr-8 text-2xl font-bold leading-none text-slate-800 outline-none focus:border-[#246c7c] [&>option]:text-sm"
                value={currentBoardId ?? ""}
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) return;
                  setBoardVisibleCardIds(null);
                  setLoading(true);
                  void Api.selectBoard({ boardId: id })
                    .then(() => {
                      setCurrentBoardId(id);
                      return Promise.all([
                        reload(),
                        Api.listAllUsers()
                          .then((d) => setAllUsers(d.users as any))
                          .catch(() => setAllUsers([])),
                      ]);
                    })
                    .finally(() => setLoading(false));
                }}
              >
                {boards.map((b) => (
                  <option key={b.id} value={b.id} style={{ fontSize: "0.875rem" }}>
                    {b.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="flex h-full items-center rounded-xl border border-slate-200 bg-white/90 px-3 text-2xl font-bold text-slate-800">Доска</span>
            )}
            <button
              type="button"
              className="flex h-full w-12 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-transparent text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:hover:bg-transparent"
              disabled={columns.length === 0}
              title="Создание новой карточки"
              aria-label="Создание новой карточки"
              onClick={() => {
                setCreateColumn(columns[0]?.id ?? "");
                setCreateTitle("");
                setCreateDetails("");
                setCreateCustomer("");
                setCreateOpen(true);
              }}
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <div className="relative flex h-full min-w-0 items-center rounded-xl border border-slate-200 bg-white focus-within:border-[#246c7c]">
              <span className="pointer-events-none absolute left-3 text-slate-400" aria-hidden>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
              <input
                ref={searchInputRef}
                type="text"
                className={`h-full w-72 min-w-0 rounded-xl border-0 bg-transparent py-0 pl-9 text-sm text-slate-800 outline-none focus:ring-0 placeholder:text-slate-400 ${searchQuery ? "pr-9" : "pr-3"}`}
                placeholder="Поиск карточки"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => searchResults && setSearchOpen(true)}
              />
              {searching ? (
                <span className="absolute right-9 text-xs text-slate-400">…</span>
              ) : searchQuery ? (
                <button
                  type="button"
                  className="absolute right-2 flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  onClick={() => {
                    setSearchQuery("");
                    setSearchOpen(false);
                    searchInputRef.current?.focus();
                  }}
                  title="Очистить поиск"
                  aria-label="Очистить поиск"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              ) : null}
              {searchOpen && searchResults !== null ? (
                <div
                  data-search-panel
                  className="absolute top-full left-0 z-50 mt-1 max-h-72 w-80 overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {searchResults.length === 0 ? (
                    <div className="p-3 text-sm text-slate-500">Ничего не найдено</div>
                  ) : (
                    <ul className="py-1">
                      {searchResults.map((hit) => (
                        <li key={hit.id}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                            onClick={() => goToCard(hit.id, hit.columnId)}
                          >
                            <div className="truncate font-medium text-slate-900">{hit.description}</div>
                            <div className="mt-0.5 text-xs text-slate-500">{hit.columnTitle}</div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="flex w-full items-center justify-center border-t border-slate-100 px-3 py-2 text-slate-500 hover:bg-slate-50"
                    title="Закрыть панель поиска"
                    aria-label="Закрыть панель поиска"
                    onClick={() => setSearchOpen(false)}
                  >
                    <IconX className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex items-center flex-shrink-0 ml-10">
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50/80 px-2 py-1.5">
              <AvatarImg user={me.user} size={24} />
              <span className="px-2 text-sm font-semibold text-slate-800">{me.user.name}</span>
              <span className="text-slate-400">·</span>
              <span className="text-sm text-slate-600">{roleLabelRu(me.user.role)}</span>
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
                onClick={() => setProfileOpen(true)}
                title="Кабинет"
                aria-label="Кабинет"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
                onClick={() => void Api.logout().then(loadMe)}
                title="Выйти"
                aria-label="Выйти"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        {error ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
      </header>

      {boardFilterActive ? (
        <div
          role="status"
          className="border-b border-teal-200/90 bg-teal-50 px-4 py-2 text-center text-sm text-slate-800"
        >
          Показаны только отфильтрованные карточки. Полный вид доски — нажмите{" "}
          <span className="font-semibold text-[#1a4d58]">«ИоТерра Канбан»</span> или логотип ИоТерра слева.
        </div>
      ) : null}

      <main className="flex min-h-0 flex-1 flex-col overflow-auto p-5">
        <DndContext
          sensors={sensors}
          collisionDetection={boardCollisionDetection}
          onDragStart={(e) => {
            if (isObserver) return;
            const id = String(e.active.id);
            if (!id.startsWith(COLUMN_PREFIX)) {
              setActiveCardId(id);
              setSelectedCardId(null);
            }
          }}
          onDragEnd={(e) => {
            const activeId = String(e.active.id);
            const overId = e.over?.id ? String(e.over.id) : null;
            setActiveCardId(null);
            if (!overId) return;
            if (isObserver) return;

            if (activeId.startsWith(COLUMN_PREFIX)) {
              const columnId = activeId.slice(COLUMN_PREFIX.length);
              if (!overId.startsWith(COLUMN_PREFIX)) return;
              const overColumnId = overId.slice(COLUMN_PREFIX.length);
              const fromIdx = columns.findIndex((c) => c.id === columnId);
              const toIdx = columns.findIndex((c) => c.id === overColumnId);
              if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
              const next = [...columns];
              const [removed] = next.splice(fromIdx, 1);
              next.splice(toIdx, 0, removed);
              setColumns(next);
              if (currentBoardId) {
                void Api.updateBoardColumn(currentBoardId, columnId, { position: toIdx }).catch(async () => {
                  await reload();
                });
              }
              return;
            }

            const from = findColumnForCard(activeId);
            if (!from) return;

            let toColumn: ColumnId | null = null;
            let toIndex = 0;

            if (overId.startsWith("column:")) {
              toColumn = overId.replace("column:", "") as ColumnId;
              const dest = columns.find((c) => c.id === toColumn);
              toIndex = dest ? dest.cards.length : 0;
            } else if (overId.startsWith(COLUMN_PREFIX)) {
              // Пустая колонка (или зона вне карточек): closestCorners часто даёт id секции `col:…`,
              // а не внутренний droppable `column:…` — иначе findColumnForCard не находит цель.
              toColumn = overId.slice(COLUMN_PREFIX.length) as ColumnId;
              const dest = columns.find((c) => c.id === toColumn);
              if (!dest) return;
              toIndex = dest.cards.length;
            } else {
              const over = findColumnForCard(overId);
              if (!over) return;
              toColumn = over.columnId;
              toIndex = over.index;
            }

            if (toColumn === from.columnId && toIndex === from.index) return;

            moveLocally(activeId, toColumn, toIndex);
            void Api.moveCard(activeId, { toColumnId: toColumn, toIndex }).catch(async () => {
              await reload();
            });
          }}
        >
          <div className="flex min-h-0 min-w-[1200px] flex-1 items-stretch gap-4">
            <SortableContext
              items={columns.map((c) => `${COLUMN_PREFIX}${c.id}`)}
              strategy={horizontalListSortingStrategy}
            >
              {displayColumns.map((col) => (
                <SortableColumnSection
                  key={col.id}
                  col={col}
                  columnDragDisabled={isObserver}
                  renderHeader={(handle) => (
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        {handle}
                        <div
                          ref={(el) => {
                            if (el) columnSectionRefs.current.set(col.id, el);
                          }}
                          className="text-sm font-semibold text-slate-900"
                        >
                          {col.title} <span className="text-slate-500">({col.cards.length})</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {!isObserver ? (
                          <button
                            type="button"
                            className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                            title="Новая карточка в колонке"
                            aria-label="Новая карточка в колонке"
                            onClick={() => {
                              setCreateColumn(col.id);
                              setCreateTitle("");
                              setCreateDetails("");
                              setCreateCustomer("");
                              setCreateOpen(true);
                            }}
                          >
                            <IconPlus className="h-4 w-4" />
                          </button>
                        ) : null}
                        {me?.user?.role === "ADMIN" ? (
                          <div
                            className="relative"
                            ref={columnActionsOpen === col.id ? columnActionsRef : null}
                          >
                            <button
                              type="button"
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                              title="Действия"
                              aria-label="Действия"
                              onClick={(e) => {
                                e.stopPropagation();
                                setColumnActionsOpen((id) => (id === col.id ? null : col.id));
                              }}
                            >
                              <IconMoreVertical className="h-4 w-4" />
                            </button>
                            {columnActionsOpen === col.id ? (
                              <div className="absolute right-0 top-full z-10 mt-1 min-w-[2.5rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                                <button
                                  type="button"
                                  className="flex w-full items-center justify-center px-3 py-2 text-slate-700 hover:bg-slate-50"
                                  title="В архив"
                                  aria-label="В архив"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setColumnActionsOpen(null);
                                    if (!currentBoardId) return;
                                    void Api.archiveColumn(currentBoardId, col.id)
                                      .then(() => reload())
                                      .catch((e) => setError((e as Error).message));
                                  }}
                                >
                                  <IconArchive className="h-4 w-4 shrink-0" />
                                </button>
                                <button
                                  type="button"
                                  className="flex w-full items-center justify-center border-t border-slate-100 px-3 py-2 text-rose-700 hover:bg-rose-50"
                                  title="Удалить колонку"
                                  aria-label="Удалить колонку"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setColumnActionsOpen(null);
                                    const msg =
                                      col.cards.length > 0
                                        ? `Вы действительно хотите удалить «${col.title}»? В ней содержится ${col.cards.length} карточек.`
                                        : `Удалить колонку «${col.title}»?`;
                                    if (!confirm(msg)) return;
                                    if (!currentBoardId) return;
                                    void Api.deleteBoardColumn(currentBoardId, col.id)
                                      .then(() => reload())
                                      .catch((e) => setError((e as Error).message));
                                  }}
                                >
                                  <IconTrash className="h-4 w-4 shrink-0 text-rose-600" />
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                >
                  <ColumnDropZone id={col.id}>
                    <SortableContext items={col.cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                      <div className="flex flex-col gap-2">
                        {col.cards.map((card) => (
                          <CardTile
                            key={card.id}
                            card={card}
                            dragDisabled={isObserver || boardFilterActive}
                            assigneeDisplay={assigneeDisplay(card.assignee)}
                            assigneeUser={assigneeUser(card.assignee)}
                            onClick={() => void onOpenCard(card.id)}
                            isSelected={selectedCardId === card.id}
                            cardRef={(el) => {
                              if (el) cardTileRefs.current.set(card.id, el);
                            }}
                            onDelete={
                              isObserver
                                ? undefined
                                : () => {
                                    if (
                                      !confirm(
                                        "Вы точно хотите удалить эту карточку? Это действие нельзя отменить.",
                                      )
                                    )
                                      return;
                                    void Api.deleteCard(card.id).then(() => reload()).catch((e) => setError((e as Error).message));
                                  }
                            }
                            onArchive={
                              isObserver
                                ? undefined
                                : () => {
                                    void Api.archiveCard(card.id).then(() => reload()).catch((e) => setError((e as Error).message));
                                  }
                            }
                            onShare={
                              currentBoardId
                                ? () => handleShareCard(card.description, getCardShareLink(currentBoardId, card.id))
                                : undefined
                            }
                          />
                        ))}
                        {col.cards.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                            {isObserver ? "Пока нет карточек." : "Перетащите сюда карточку или добавьте новую."}
                          </div>
                        ) : null}
                      </div>
                    </SortableContext>
                  </ColumnDropZone>
                </SortableColumnSection>
              ))}
            </SortableContext>
          </div>

          <DragOverlay>
            {activeCardId && cardsById.get(activeCardId) ? (
              <div className="w-[340px]">
                <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xl">
                  <div className="text-sm font-semibold">{cardsById.get(activeCardId)!.description}</div>
                  {assigneeDisplay(cardsById.get(activeCardId)!.assignee) ? (
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-slate-600">
                      {assigneeUser(cardsById.get(activeCardId)!.assignee) ? (
                        <AvatarImg user={assigneeUser(cardsById.get(activeCardId)!.assignee)!} size={24} />
                      ) : null}
                      <span className="min-w-0 truncate">{assigneeDisplay(cardsById.get(activeCardId)!.assignee)}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </main>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        headerLeft={
          <div className="min-w-0">
            <input
              className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-semibold text-slate-900 outline-none focus:border-slate-200 focus:bg-white"
              value={createTitle}
              onChange={(e) => setCreateTitle(e.target.value)}
              placeholder="Название карточки"
              autoFocus
            />
            <div className="mt-1 text-xs text-slate-500">Новая карточка</div>
          </div>
        }
      >
        <div className="grid gap-3">
          <label className="grid gap-1">
            <div className="text-xs text-slate-600">Описание</div>
            <textarea
              className="min-h-[90px] rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-[#246c7c]"
              value={createDetails}
              onChange={(e) => setCreateDetails(e.target.value)}
              placeholder="Что нужно сделать?"
            />
          </label>
          <label className="grid gap-1">
            <div className="text-xs text-slate-600">Заказчик</div>
            <select
              className="rounded-xl border border-slate-200 bg-white p-2 text-sm outline-none focus:border-[#246c7c]"
              value={createCustomer}
              onChange={(e) => setCreateCustomer(e.target.value)}
            >
              <option value="">— не выбран</option>
              {(allUsers ?? []).map((u) => (
                <option key={u.id} value={u.email}>
                  {u.name || u.email}
                </option>
              ))}
            </select>
          </label>
          {columns.length > 0 ? (
            <label className="grid gap-1">
              <div className="text-xs text-slate-600">Колонка</div>
              <select
                className="rounded-xl border border-slate-200 bg-white p-2 text-sm outline-none focus:border-[#246c7c]"
                value={createColumn}
                onChange={(e) => setCreateColumn(e.target.value)}
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="flex justify-end">
            <IconButton
              variant="brand"
              title="Создать карточку"
              disabled={!createTitle.trim() || !createColumn}
              onClick={() => {
                const title = createTitle.trim();
                if (!title) return;
                const details = createDetails.trim() ? createDetails.trim() : null;
                void Api.createCard({
                  description: title,
                  details,
                  columnId: createColumn,
                  assignee: me?.user?.email ?? undefined,
                  customer: createCustomer.trim() ? createCustomer.trim() : undefined,
                }).then(async () => {
                  setCreateOpen(false);
                  await reload();
                });
              }}
            >
              <IconPlus className="h-5 w-5" />
            </IconButton>
          </div>
        </div>
      </Modal>

      <CardModal
        open={cardOpen}
        card={cardDetail}
        columns={columns}
        boardId={currentBoardId}
        onShareLink={handleShareCard}
        onClose={() => {
          setCardOpen(false);
          setCardDetail(null);
        }}
        onChanged={async () => {
          if (!cardDetail) return;
          await reload();
          const data = await Api.fetchCard(cardDetail.id);
          setCardDetail(data.card);
        }}
        onDeleted={async () => {
          await reload();
        }}
        viewer={me.user}
        allUsers={allUsers ?? []}
      />

      {shareConfirm ? (
        <Modal
          open={true}
          title="Ссылка скопирована"
          onClose={() => setShareConfirm(null)}
        >
          <p className="text-sm text-slate-700">
            Карточка «{shareConfirm.cardTitle}». Ссылка {shareConfirm.link} скопирована в буфер обмена.
          </p>
          <div className="mt-4 flex justify-end">
            <IconButton variant="brand" title="OK" onClick={() => setShareConfirm(null)}>
              <IconCheck className="h-5 w-5" />
            </IconButton>
          </div>
        </Modal>
      ) : null}

      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        me={me.user}
        boards={boards}
        onUpdated={async () => {
          await loadMe();
          const b = await Api.listBoards();
          setBoards(b.boards as any);
          setCurrentBoardId(b.currentBoardId ?? null);
          await Promise.all([
            reload(),
            Api.listAllUsers()
              .then((d) => setAllUsers(d.users as any))
              .catch(() => setAllUsers([])),
          ]);
        }}
      />
    </div>
  );
}

export default App;

function IconX(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconExpandPanel(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconShrinkPanel(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconTrash(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M10 11v7M14 11v7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M7 7l1 14h8l1-14M9 7V4h6v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconDownload(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 3v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 11l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M4 20h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconKey(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M14.5 10a4.5 4.5 0 1 1-1.04-2.88L22 5v4h-2v2h-2v2h-2.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M10 14a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" fill="currentColor" />
    </svg>
  );
}

function IconEye(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconEyeOff(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.242 16.293 7.367 19.5 12 19.5c1.585 0 3.101-.29 4.5-.815M6.228 6.228A10.45 10.45 0 0 1 12 4.5c4.638 0 8.573 3.007 9.963 7.178.051.15.088.305.105.466M6.228 6.228 4.5 4.5m1.728 1.728L4.5 4.5m1.728 1.728 12.728 12.728M4.5 4.5l2.228 2.228m0 0L19.5 19.5m-12.772-12.772L19.5 19.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconEdit(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 20h9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconCheck(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconChevronDown(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-5 w-5"} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconChevronUp(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-5 w-5"} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 15l-6-6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconChevronLeft(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconChevronRight(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconMoreVertical(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="6" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="18" r="1.5" fill="currentColor" />
    </svg>
  );
}

function IconArchive(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 8v13h16V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 5h20v3H2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 12h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconArchiveRestore(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 8v13h16V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 5h20v3H2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 18V9M9 12l3-3 3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconShare(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 6l-4-4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 2v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconPlus(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconPaperclip(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <path d="M21.44 11.05 12 20.49a6 6 0 0 1-8.49-8.49l9.44-9.44a4 4 0 0 1 5.66 5.66l-9.44 9.44a2 2 0 1 1-2.83-2.83l8.49-8.49" />
    </svg>
  );
}

function IconLink(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L10.9 5.03" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07l1.22-1.22" />
    </svg>
  );
}

function IconAt(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </svg>
  );
}

function IconMinus(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 12h14" />
    </svg>
  );
}

function IconLogin(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  );
}

function IconLogout(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  );
}

function IconUser(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IconMail(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function IconLayoutKanban(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="5" height="18" rx="1" />
      <rect x="10" y="3" width="5" height="12" rx="1" />
      <rect x="17" y="3" width="5" height="8" rx="1" />
    </svg>
  );
}

function IconUsers(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconColumns(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  );
}

function IconPhotoUpload(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function IconQrCode(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <line x1="14" y1="14" x2="14" y2="14.01" />
      <line x1="18" y1="14" x2="18" y2="14.01" />
      <line x1="14" y1="18" x2="18" y2="18" />
      <line x1="18" y1="18" x2="18" y2="21" />
      <line x1="21" y1="18" x2="21" y2="21" />
      <line x1="14" y1="21" x2="17" y2="21" />
    </svg>
  );
}

function IconPlug(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 22v-5M9 8V2M15 8V2M5 8h14v5a7 7 0 0 1-14 0V8z" />
    </svg>
  );
}

function IconSpinner(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={classNames("animate-spin", props.className ?? "h-5 w-5")} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// AVATAR_PRESETS/autoAvatarPreset/avatarSrc are in ./utils/avatar

function AvatarImg(props: { user: { id: string; avatarUploadName?: string | null; avatarPreset?: string | null; name?: string }; size: number }) {
  return (
    <img
      src={avatarSrc(props.user)}
      alt={props.user.name ? `Аватар: ${props.user.name}` : "Аватар"}
      className="shrink-0 rounded-full border border-slate-200 bg-white"
      style={{ width: props.size, height: props.size }}
      loading="lazy"
    />
  );
}

function AvatarPresetDropdown(props: {
  userId: string;
  value: string; // "" means auto
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const selected = props.value;
  const selectedKey = selected ? selected : autoAvatarPreset(props.userId);
  const selectedLabel = selected ? selected.toUpperCase() : "Авто";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={props.disabled}
        className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-[#246c7c] disabled:opacity-50"
        title={`Пресет аватара: ${selectedLabel}`}
        aria-label={`Пресет аватара: ${selectedLabel}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <img src={`/avatars/${selectedKey}.svg`} alt="" className="h-6 w-6 rounded-full border border-slate-200 bg-white" />
        <span className="flex shrink-0 text-slate-500" aria-hidden>
          {open ? <IconChevronUp className="h-6 w-6" /> : <IconChevronDown className="h-6 w-6" />}
        </span>
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-20 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="max-h-64 overflow-auto p-1">
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-800 hover:bg-slate-50"
              title="Авто"
              aria-label="Авто"
              onClick={() => {
                props.onChange("");
                setOpen(false);
              }}
              role="option"
              aria-selected={selected === ""}
            >
              <img
                src={`/avatars/${autoAvatarPreset(props.userId)}.svg`}
                alt=""
                className="h-6 w-6 rounded-full border border-slate-200 bg-white"
              />
              {selected === "" ? <IconCheck className="h-4 w-4 shrink-0 text-[#246c7c]" /> : <span className="h-4 w-4 shrink-0" aria-hidden />}
            </button>
            {AVATAR_PRESETS.map((k) => (
              <button
                key={k}
                type="button"
                className="flex w-full items-center justify-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-800 hover:bg-slate-50"
                title={k.toUpperCase()}
                aria-label={k.toUpperCase()}
                onClick={() => {
                  props.onChange(k);
                  setOpen(false);
                }}
                role="option"
                aria-selected={selected === k}
              >
                <img src={`/avatars/${k}.svg`} alt="" className="h-6 w-6 rounded-full border border-slate-200 bg-white" />
                {selected === k ? <IconCheck className="h-4 w-4 shrink-0 text-[#246c7c]" /> : <span className="h-4 w-4 shrink-0" aria-hidden />}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function IconButton(props: {
  title: string;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "default" | "danger" | "brand" | "ghost" | "ghostLink";
  /** ~2/3 of default — used in карточке для заголовка */
  size?: "default" | "compact";
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const variant = props.variant ?? "default";
  const size = props.size ?? "default";
  const cls =
    variant === "brand"
      ? "border-2 border-teal-400/70 bg-white text-[#246c7c] shadow-sm hover:bg-teal-50/70 hover:border-teal-500"
      : variant === "danger"
        ? "border-2 border-rose-300 bg-white text-rose-600 shadow-sm hover:bg-rose-50 hover:border-rose-400"
        : variant === "ghost"
          ? "border-transparent bg-transparent text-slate-800 hover:bg-slate-100"
          : variant === "ghostLink"
            ? "border-transparent bg-transparent text-[#246c7c] hover:bg-slate-100"
            : "border-2 border-slate-300 bg-white text-slate-800 hover:bg-slate-50 hover:border-slate-400";
  const sizeCls =
    size === "compact"
      ? "grid h-7 w-7 min-h-7 min-w-7 place-items-center rounded-lg border disabled:opacity-50 disabled:pointer-events-none"
      : "grid h-10 w-10 place-items-center rounded-xl border disabled:opacity-50 disabled:pointer-events-none";

  return (
    <button
      type={props.type ?? "button"}
      className={classNames(
        sizeCls,
        cls,
        props.className,
      )}
      onClick={props.type === "submit" ? undefined : props.onClick}
      title={props.title}
      aria-label={props.title}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

function PasswordInput(props: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  className?: string;
  inputClassName?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={classNames("relative", props.className)}>
      <input
        type={visible ? "text" : "password"}
        className={classNames(
          "w-full rounded-xl border border-slate-200 bg-white py-2 pl-2 text-sm outline-none focus:border-[#246c7c] disabled:opacity-50",
          props.inputClassName,
          "pr-10",
        )}
        value={props.value}
        onChange={props.onChange}
        onBlur={props.onBlur}
        placeholder={props.placeholder}
        autoComplete={props.autoComplete}
        disabled={props.disabled}
        name={props.name}
        id={props.id}
      />
      <button
        type="button"
        tabIndex={-1}
        className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-50"
        aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
        title={visible ? "Скрыть пароль" : "Показать пароль"}
        disabled={props.disabled}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function CenteredShell(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-3">
          <img src="/ioterra.svg" alt="ИоТерра" className="h-8 w-8" />
          <div className="text-lg font-bold">{props.title}</div>
        </div>
        {props.children}
      </div>
    </div>
  );
}

function LoginView(props: { onDone: () => Promise<void> | void }) {
  const [login, setLogin] = useState("admin");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needTotp, setNeedTotp] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [fpLogin, setFpLogin] = useState("");
  const [fpCode, setFpCode] = useState("");
  const [fpP1, setFpP1] = useState("");
  const [fpP2, setFpP2] = useState("");
  const [fpOk, setFpOk] = useState(false);
  const [fpMailSent, setFpMailSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const friendlyAuthError = (msg: string) => {
    if (msg.includes("Invalid credentials")) return "Неверный логин или пароль.";
    if (msg.includes("Two-factor required")) return "Введите код 2FA и повторите вход.";
    if (msg.includes("2FA setup required"))
      return "Сначала завершите настройку 2FA (экран с QR-кодом) или обратитесь к администратору, если политика изменилась.";
    if (msg.includes("Unknown login for password reset"))
      return "Учётная запись с таким логином или email не найдена. Проверьте адрес — он должен совпадать с записью в базе (в т.ч. домен после @).";
    if (msg.includes("Password reset not available"))
      return "Для этой учётной записи сброс по коду 2FA недоступен (2FA выключена или не настроена). Обратитесь к администратору или используйте восстановление по почте.";
    if (msg.includes("Invalid code")) return "Неверный код 2FA.";
    if (msg.includes("Timeout")) return "Сервер не отвечает. Подождите и попробуйте ещё раз (или перезапустите контейнеры).";
    if (msg.includes("502") || msg.toLowerCase().includes("bad gateway"))
      return "Сервер временно недоступен. Подождите и попробуйте ещё раз (или перезапустите контейнеры).";
    if (msg.toLowerCase().includes("failed to fetch") || msg.toLowerCase().includes("network"))
      return "Ошибка сети. Проверьте подключение и попробуйте ещё раз.";
    return "Ошибка входа. Проверьте данные и попробуйте ещё раз.";
  };

  return (
    <CenteredShell title="ИоТерра Канбан">
      <div className="grid gap-3">
        <div className="text-sm text-slate-600">{mode === "login" ? "Вход" : "Восстановление пароля"}</div>
        {mode === "login" ? (
          <div className="text-xs text-slate-500">
            По умолчанию: логин <span className="font-mono">admin</span>, пароль <span className="font-mono">admin</span>.
          </div>
        ) : null}
        {error ? (
          <div
            className="max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
            aria-live="polite"
          >
            {error}
          </div>
        ) : null}
        {mode === "login" ? (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (submitting) return;
              setError(null);
              setFpOk(false);
              setSubmitting(true);
              void Api.login({
                login: login.trim(),
                password,
                ...(needTotp ? { totp: totp.trim(), rememberDevice } : {}),
              })
                .then(async () => {
                  await props.onDone();
                })
                .catch((e) => {
                  const msg = (e as Error).message;
                  if (msg.includes("Two-factor required")) setNeedTotp(true);
                  setError(friendlyAuthError(msg));
                })
                .finally(() => setSubmitting(false));
            }}
          >
            <label className="grid gap-1">
              <div className="text-xs text-slate-600">Логин</div>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-2 pr-2 text-sm outline-none focus:border-[#246c7c]"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="admin или email"
                autoComplete="username"
              />
            </label>
            <label className="grid gap-1">
              <div className="text-xs text-slate-600">Пароль</div>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </label>
            {needTotp ? (
              <div className="grid gap-2">
                <label className="grid gap-1">
                  <div className="text-xs text-slate-600">Код 2FA</div>
                  <input
                    className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
                    value={totp}
                    onChange={(e) => setTotp(e.target.value)}
                    placeholder="123456"
                  />
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 text-sm text-slate-800">
                  <input type="checkbox" checked={rememberDevice} onChange={(e) => setRememberDevice(e.target.checked)} />
                  <span>Не спрашивать код на этом устройстве 30 дней</span>
                </label>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl border border-transparent bg-[#246c7c] py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
            >
              {submitting ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <IconSpinner className="h-5 w-5 shrink-0 text-white" />
                  Вход…
                </span>
              ) : (
                "Войти"
              )}
            </button>
            <button
              type="button"
              className="w-full text-center text-sm font-medium text-[#246c7c] underline decoration-[#246c7c] underline-offset-2 hover:opacity-90"
              onClick={() => {
                setError(null);
                setFpOk(false);
                setFpMailSent(false);
                setMode("forgot");
                setFpLogin(login.trim());
                setFpCode("");
                setFpP1("");
                setFpP2("");
              }}
            >
              Забыли пароль?
            </button>
          </form>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span className="font-medium">Без 2FA:</span> запросите ссылку на почту (ниже) — если на сервере настроен SMTP.
              <br />
              <span className="font-medium">С 2FA:</span> введите код из приложения-аутентификатора и новый пароль.
            </div>
            {fpOk ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                Пароль изменён. Теперь вы можете войти.
              </div>
            ) : null}
            {fpMailSent ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                Если для этой учётной записи на сервере настроена почта, на указанный email отправлена ссылка для сброса
                (действует около часа). Проверьте папку «Спам». Если письма нет — почта на сервере не настроена; обратитесь к
                администратору.
              </div>
            ) : null}
            <label className="grid gap-1">
              <div className="text-xs text-slate-600">Логин или email</div>
              <input
                className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
                value={fpLogin}
                onChange={(e) => setFpLogin(e.target.value)}
                placeholder="admin или email"
                autoComplete="username"
              />
            </label>
            <button
              type="button"
              disabled={fpOk || !fpLogin.trim() || submitting}
              className="w-full rounded-xl border border-[#246c7c] bg-white py-3 text-sm font-semibold text-[#246c7c] hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
              onClick={() => {
                setError(null);
                setFpMailSent(false);
                setSubmitting(true);
                void Api.forgotPassword({ login: fpLogin.trim() })
                  .then(() => setFpMailSent(true))
                  .catch((e) => setError(friendlyAuthError((e as Error).message)))
                  .finally(() => setSubmitting(false));
              }}
            >
              {submitting ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <IconSpinner className="h-5 w-5 shrink-0 text-[#246c7c]" />
                  Отправка…
                </span>
              ) : (
                "Отправить ссылку на email"
              )}
            </button>
            <div className="text-center text-xs text-slate-400">или с 2FA</div>
            <label className="grid gap-1">
              <div className="text-xs text-slate-600">Код 2FA</div>
              <input
                className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
                value={fpCode}
                onChange={(e) => setFpCode(e.target.value)}
                placeholder="123456"
              />
            </label>
            <PasswordInput
              placeholder="Новый пароль (мин. 8)"
              value={fpP1}
              onChange={(e) => setFpP1(e.target.value)}
              autoComplete="new-password"
            />
            <PasswordInput
              placeholder="Повторите пароль"
              value={fpP2}
              onChange={(e) => setFpP2(e.target.value)}
              autoComplete="new-password"
            />
            <button
              type="button"
              disabled={fpOk || !fpLogin.trim() || fpCode.trim().length < 6 || !fpP1 || fpP1 !== fpP2 || fpP1.length < 8 || submitting}
              className="w-full rounded-xl border border-transparent bg-[#246c7c] py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
              onClick={() => {
                setError(null);
                setSubmitting(true);
                void Api.resetPasswordByTotp({ login: fpLogin.trim(), code: fpCode.trim(), newPassword: fpP1 })
                  .then(() => {
                    setFpOk(true);
                    setPassword("");
                    setTotp("");
                    setNeedTotp(false);
                  })
                  .catch((e) => setError(friendlyAuthError((e as Error).message)))
                  .finally(() => setSubmitting(false));
              }}
            >
              {submitting ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <IconSpinner className="h-5 w-5 shrink-0 text-white" />
                  Смена…
                </span>
              ) : (
                "Сменить пароль"
              )}
            </button>
            <button
              type="button"
              className="w-full text-center text-sm font-medium text-[#246c7c] underline decoration-[#246c7c] underline-offset-2 hover:opacity-90"
              onClick={() => {
                setError(null);
                setFpOk(false);
                setFpMailSent(false);
                setMode("login");
                setPassword("");
                setTotp("");
                setNeedTotp(false);
                if (fpLogin.trim()) setLogin(fpLogin.trim());
              }}
            >
              Назад ко входу
            </button>
          </>
        )}
      </div>
    </CenteredShell>
  );
}

function ResetPasswordView(props: { token: string; onDone: () => void }) {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  return (
    <CenteredShell title="Сброс пароля">
      <div className="grid gap-3">
        <div className="text-sm text-slate-600">Задайте новый пароль (минимум 8 символов).</div>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
        {ok ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Пароль изменён. Теперь вы можете войти.
          </div>
        ) : null}
        <PasswordInput
          placeholder="Новый пароль"
          value={p1}
          onChange={(e) => setP1(e.target.value)}
          autoComplete="new-password"
        />
        <PasswordInput
          placeholder="Повторите пароль"
          value={p2}
          onChange={(e) => setP2(e.target.value)}
          autoComplete="new-password"
        />
        <div className="flex flex-wrap items-center justify-center gap-3">
          <IconButton
            type="button"
            variant="brand"
            title="Сменить пароль"
            disabled={ok || !p1 || p1 !== p2 || p1.length < 8}
            onClick={() => {
              setError(null);
              void Api.resetPasswordByToken({ token: props.token, newPassword: p1 })
                .then(() => setOk(true))
                .catch((e) => setError((e as Error).message));
            }}
          >
            <IconCheck className="h-5 w-5" />
          </IconButton>
          <IconButton type="button" variant="ghost" title="Перейти ко входу" onClick={props.onDone}>
            <IconLogin className="h-5 w-5" />
          </IconButton>
        </div>
      </div>
    </CenteredShell>
  );
}

function ChangePasswordView(props: { onDone: () => Promise<void> | void }) {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const handleSave = () => {
    if (!p1 || p1 !== p2 || p1.length < 8) return;
    setError(null);
    setSubmitting(true);
    void Api.changePassword({ newPassword: p1 })
      .then(() => props.onDone())
      .catch((e) => setError((e as Error).message))
      .finally(() => setSubmitting(false));
  };
  return (
    <CenteredShell title="Смена пароля">
      <div className="grid gap-3">
        <div className="text-sm text-slate-600">Задайте новый пароль (минимум 8 символов).</div>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
        <PasswordInput
          placeholder="Новый пароль"
          value={p1}
          onChange={(e) => setP1(e.target.value)}
          autoComplete="new-password"
        />
        <PasswordInput
          placeholder="Повторите пароль"
          value={p2}
          onChange={(e) => setP2(e.target.value)}
          autoComplete="new-password"
        />
        <IconButton
          type="button"
          variant="brand"
          title={submitting ? "Сохранение…" : "Сохранить"}
          disabled={!p1 || p1 !== p2 || p1.length < 8 || submitting}
          onClick={handleSave}
        >
          {submitting ? <IconSpinner className="h-5 w-5 text-[#246c7c]" /> : <IconCheck className="h-5 w-5" />}
        </IconButton>
      </div>
    </CenteredShell>
  );
}

function TwoFaAccountBanner(props: {
  user: Pick<User, "id" | "email" | "name">;
  onUseOtherAccount: () => void;
}) {
  const displayName = props.user.name?.trim() || "Без имени";
  return (
    <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Учётная запись</div>
        <div className="mt-1 flex items-start gap-2">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600">
            <IconUser className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold text-slate-900">{displayName}</div>
            <div className="break-all text-sm text-slate-600">{props.user.email}</div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
        <span className="text-xs text-slate-500">Войти под другой учётной записью</span>
        <IconButton
          type="button"
          variant="ghost"
          title="Выйти и войти под другой учётной записью"
          onClick={props.onUseOtherAccount}
        >
          <IconLogout className="h-5 w-5" />
        </IconButton>
      </div>
    </div>
  );
}

function TwoFaSetupView(props: {
  user: Pick<User, "id" | "email" | "name">;
  onDone: () => Promise<void> | void;
  onUseOtherAccount: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <CenteredShell title="Настройка 2FA">
      <div className="grid gap-3">
        <TwoFaAccountBanner user={props.user} onUseOtherAccount={props.onUseOtherAccount} />
        <div className="text-sm text-slate-600">
          По политике организации для указанной учётной записи требуется двухфакторная аутентификация. Отсканируйте QR-код в
          приложении-аутентификаторе и введите код. Включить или отключить требование 2FA может только администратор.
        </div>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
        {!qr ? (
          <IconButton
            type="button"
            variant="brand"
            title="Сгенерировать QR-код"
            onClick={() => {
              setError(null);
              void Api.twoFaSetup()
                .then((d) => setQr(d.qrDataUrl))
                .catch((e) => {
                  const msg = (e as Error).message;
                  if (msg.includes("2FA is not required")) {
                    setError("Для этой учётной записи 2FA отключена администратором. Обновите страницу или войдите снова.");
                  } else {
                    setError(msg);
                  }
                });
            }}
          >
            <IconQrCode className="h-5 w-5" />
          </IconButton>
        ) : (
          <div className="grid gap-2">
            <img src={qr} alt="QR для 2FA" className="mx-auto w-48 rounded-xl border border-slate-200 bg-white p-2" />
            <input className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Код 2FA" />
            <IconButton
              type="button"
              variant="brand"
              title="Подтвердить привязку"
              disabled={code.trim().length < 6}
              onClick={() => {
                setError(null);
                void Api.twoFaEnable({ code: code.trim() })
                  .then(() => props.onDone())
                  .catch((e) => {
                    const msg = (e as Error).message;
                    if (msg.includes("2FA is not required")) {
                      setError("Для этой учётной записи 2FA отключена администратором.");
                    } else {
                      setError(msg);
                    }
                  });
              }}
            >
              <IconCheck className="h-5 w-5" />
            </IconButton>
          </div>
        )}
      </div>
    </CenteredShell>
  );
}

function TwoFaVerifyView(props: {
  user: Pick<User, "id" | "email" | "name">;
  onDone: () => Promise<void> | void;
  onUseOtherAccount: () => void;
}) {
  const [code, setCode] = useState("");
  const [rememberDevice, setRememberDevice] = useState(true);
  const [error, setError] = useState<string | null>(null);
  return (
    <CenteredShell title="Подтверждение 2FA">
      <div className="grid gap-3">
        <TwoFaAccountBanner user={props.user} onUseOtherAccount={props.onUseOtherAccount} />
        <div className="text-sm text-slate-600">Введите код из приложения-аутентификатора для этой учётной записи.</div>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
        <input className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 text-sm text-slate-800">
          <input type="checkbox" checked={rememberDevice} onChange={(e) => setRememberDevice(e.target.checked)} />
          <span>Не спрашивать код на этом устройстве 30 дней</span>
        </label>
        <IconButton
          type="button"
          variant="brand"
          title="Подтвердить"
          disabled={code.trim().length < 6}
          onClick={() => {
            setError(null);
            void Api.twoFaVerify({ code: code.trim(), rememberDevice })
              .then(() => props.onDone())
              .catch((e) => setError((e as Error).message));
          }}
        >
          <IconCheck className="h-5 w-5" />
        </IconButton>
      </div>
    </CenteredShell>
  );
}

function UsersModal(props: { open: boolean; onClose: () => void; embedded?: boolean }) {
  const [users, setUsers] = useState<
    Array<{
      id: string;
      email: string;
      name: string;
      avatarPreset?: string | null;
      avatarUploadName?: string | null;
      role: string;
      isSystem?: boolean;
      totpEnabled: boolean;
      totpConfigured?: boolean;
    }>
    | null
  >(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [newUserTotpRequired, setNewUserTotpRequired] = useState(true);
  const [role, setRole] = useState<"ADMIN" | "MEMBER" | "OBSERVER">("MEMBER");
  const [error, setError] = useState<string | null>(null);
  const [boardsForUser, setBoardsForUser] = useState<{ id: string; name: string; email: string } | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setError(null);
    void Api.listUsers()
      .then((d) => setUsers(d.users as any))
      .catch((e) => setError((e as Error).message));
  }, [props.open]);

  if (!props.open) return null;

  const content = (
        <div className="grid gap-3">
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
          <div className="text-xs text-slate-600">
            При создании задайте стартовый пароль. При первом входе пользователь будет обязан сменить пароль. По умолчанию для
            новой учётной записи включено требование 2FA (можно снять флажок ниже).
          </div>
          <div className="text-xs text-slate-500">
            Для системного администратора доступны только смена почты и пароля (в т.ч. через «Кабинет»).
          </div>

          <form
            className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-2"
            autoComplete="off"
            onSubmit={(e) => e.preventDefault()}
          >
            <input
              className="rounded-xl border border-slate-200 bg-white p-2 text-sm outline-none focus:border-[#246c7c]"
              placeholder="Имя (необязательно)"
              name="cabinet-new-user-display-name"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="rounded-xl border border-slate-200 bg-white p-2 text-sm outline-none focus:border-[#246c7c]"
              placeholder="Email"
              type="email"
              name="cabinet-new-user-email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <PasswordInput
              className="md:col-span-2"
              placeholder="Стартовый пароль (мин. 8)"
              name="cabinet-new-user-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 md:col-span-2">
              <input
                type="checkbox"
                checked={newUserTotpRequired}
                onChange={(e) => setNewUserTotpRequired(e.target.checked)}
              />
              <span>Требовать 2FA (пользователь не может отключить сам)</span>
            </label>
            <div className="flex items-center gap-2 md:col-span-2">
              <select
                className="flex-1 rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
              >
                <option value="MEMBER">Участник</option>
                <option value="OBSERVER">Наблюдатель</option>
                <option value="ADMIN">Администратор</option>
              </select>
              <button
                type="button"
                className="grid h-10 w-10 place-items-center rounded-xl bg-[#246c7c] text-white hover:opacity-90 disabled:opacity-50"
                disabled={!email.trim() || password.trim().length < 8}
                title="Добавить пользователя"
                aria-label="Добавить пользователя"
                onClick={() => {
                  setError(null);
                  void Api.createUser({
                    email: email.trim(),
                    ...(name.trim() ? { name: name.trim() } : {}),
                    role,
                    password: password.trim(),
                    totpEnabled: newUserTotpRequired,
                  })
                    .then(() => {
                      setEmail("");
                      setName("");
                      setPassword("");
                      setNewUserTotpRequired(true);
                      return Api.listUsers();
                    })
                    .then((d) => setUsers(d.users as any))
                    .catch((e) => setError((e as Error).message));
                }}
              >
                <IconPlus className="h-5 w-5" />
              </button>
            </div>
          </form>

          <div className="rounded-2xl border border-slate-200 bg-white">
            <div className="grid grid-cols-[1fr_1fr_120px_108px_56px_90px_44px] gap-2 border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">
              <div>Имя</div>
              <div>Email</div>
              <div>Роль</div>
              <div title="Требование 2FA (политика администратора)">2FA</div>
              <div>Пароль</div>
              <div>Доски</div>
              <div />
            </div>
            <div className="max-h-[40vh] overflow-auto">
              {(users ?? []).map((u) => (
                <div key={u.id} className="grid grid-cols-[1fr_1fr_120px_108px_56px_90px_44px] items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm text-slate-800">
                  <div className="flex min-w-0 items-center gap-2">
                    <AvatarImg user={u} size={24} />
                    <div className="min-w-0 flex-1 truncate">{u.name}</div>
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="min-w-0 flex-1 truncate text-slate-600">{u.email}</div>
                    <button
                      className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                      title="Изменить почту"
                      aria-label="Изменить почту"
                      onClick={() => {
                        const next = prompt("Новая почта:", u.email);
                        if (!next) return;
                        setError(null);
                        void Api.adminUpdateUser(u.id, { email: next.trim() })
                          .then(() => Api.listUsers())
                          .then((d) => setUsers(d.users as any))
                          .catch((e) => setError((e as Error).message));
                      }}
                    >
                      <IconEdit className="h-4 w-4" />
                    </button>
                  </div>
                  <div>
                    {u.isSystem ? (
                      "Админ"
                    ) : (
                      <select
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm font-semibold text-slate-800 outline-none focus:border-[#246c7c]"
                        value={u.role}
                        onChange={(e) => {
                          const next = e.target.value as "ADMIN" | "MEMBER" | "OBSERVER";
                          setError(null);
                          void Api.adminUpdateUser(u.id, { role: next })
                            .then(() => Api.listUsers())
                            .then((d) => setUsers(d.users as any))
                            .catch((err) => setError((err as Error).message));
                        }}
                      >
                        <option value="MEMBER">Участник</option>
                        <option value="OBSERVER">Наблюдатель</option>
                        <option value="ADMIN">Админ</option>
                      </select>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-800">
                      <input
                        type="checkbox"
                        checked={u.totpEnabled}
                        title="Требовать 2FA для этого пользователя"
                        onChange={(e) => {
                          const next = e.target.checked;
                          setError(null);
                          void Api.adminUpdateUser(u.id, { totpEnabled: next })
                            .then(() => Api.listUsers())
                            .then((d) => setUsers(d.users as any))
                            .catch((err) => setError((err as Error).message));
                        }}
                      />
                      <span>{u.totpEnabled ? "Да" : "Нет"}</span>
                    </label>
                    {u.totpEnabled ? (
                      <span className={`text-[10px] ${u.totpConfigured ? "text-emerald-700" : "text-amber-700"}`}>
                        {u.totpConfigured ? "привязано" : "не привязано"}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400">не требуется</span>
                    )}
                  </div>
                  <button
                    className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                    title="Сбросить пароль"
                    aria-label="Сбросить пароль"
                    onClick={() => {
                      const np = prompt("Новый пароль (минимум 8):");
                      if (!np) return;
                      if (np.trim().length < 8) {
                        setError("Пароль должен быть минимум 8 символов.");
                        return;
                      }
                      setError(null);
                      void Api.resetUserPassword(u.id, { newPassword: np.trim() })
                        .then(() => Api.listUsers())
                        .then((d) => setUsers(d.users as any))
                        .catch((e) => setError((e as Error).message));
                    }}
                  >
                    <IconKey />
                  </button>
                  {u.isSystem || u.role === "ADMIN" ? (
                    <div className="text-right text-xs font-semibold text-slate-400" title="Системный администратор">
                      —
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                      onClick={() => setBoardsForUser({ id: u.id, name: u.name, email: u.email })}
                      title="Доступ к доскам"
                      aria-label="Доступ к доскам"
                    >
                      <IconLayoutKanban className="h-4 w-4" />
                    </button>
                  )}
                  {u.isSystem ? (
                    <button
                      type="button"
                      className="grid h-8 w-8 cursor-not-allowed place-items-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400"
                      title="Нельзя удалить системного администратора"
                      aria-label="Нельзя удалить системного администратора"
                      onClick={() => {
                        setError("Нельзя удалить системного администратора. Можно изменить только почту и пароль.");
                      }}
                    >
                      <IconMinus className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      className="grid h-8 w-8 place-items-center rounded-lg bg-[#ac4c1c] text-white hover:opacity-90"
                      title="Удалить пользователя"
                      aria-label="Удалить пользователя"
                      onClick={() => {
                        if (!confirm(`Удалить пользователя “${u.name}” (${u.email})?`)) return;
                        setError(null);
                        void Api.deleteUser(u.id)
                          .then(() => Api.listUsers())
                          .then((d) => setUsers(d.users as any))
                          .catch((e) => setError((e as Error).message));
                      }}
                    >
                      <IconTrash className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
  );

  if (props.embedded) {
    return (
      <>
        {content}
        <BoardAccessModal open={!!boardsForUser} user={boardsForUser} onClose={() => setBoardsForUser(null)} />
      </>
    );
  }

  return (
    <>
      <Modal open={true} title="Пользователи" onClose={props.onClose}>
        {content}
      </Modal>
      <BoardAccessModal open={!!boardsForUser} user={boardsForUser} onClose={() => setBoardsForUser(null)} />
    </>
  );
}

function BoardAccessModal(props: { open: boolean; user: { id: string; name: string; email: string } | null; onClose: () => void }) {
  const user = props.user;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boards, setBoards] = useState<Array<{ id: string; name: string; hasAccess: boolean }> | null>(null);
  const [defaultBoardId, setDefaultBoardId] = useState<string>("");

  useEffect(() => {
    if (!props.open || !user) return;
    setLoading(true);
    setError(null);
    void Api.adminGetUserBoards(user.id)
      .then((d) => {
        setBoards(d.boards);
        setDefaultBoardId(d.defaultBoardId ?? (d.boards.find((b) => b.hasAccess)?.id ?? ""));
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [props.open, user?.id]);

  if (!props.open || !user) return null;

  const selectedIds = new Set((boards ?? []).filter((b) => b.hasAccess).map((b) => b.id));

  return (
    <Modal open={true} title={`Доступ к доскам: ${user.name}`} onClose={props.onClose}>
      <div className="grid gap-3">
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
        {loading ? <div className="text-sm text-slate-600">Загрузка…</div> : null}

        {boards ? (
          <>
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="mb-2 text-xs font-semibold text-slate-600">Доски пользователя</div>
              <div className="grid gap-1">
                {boards.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={b.hasAccess}
                      onChange={(e) => {
                        const next = e.target.checked;
                        const nextBoards = (boards ?? []).map((x) => (x.id === b.id ? { ...x, hasAccess: next } : x));
                        const nextIds = nextBoards.filter((x) => x.hasAccess).map((x) => x.id);
                        let nextDefault = defaultBoardId;
                        if (!next && defaultBoardId === b.id) nextDefault = nextBoards.find((x) => x.hasAccess)?.id ?? "";
                        if (next && !defaultBoardId) nextDefault = b.id;
                        setBoards(nextBoards);
                        setDefaultBoardId(nextDefault);
                        setError(null);
                        setLoading(true);
                        void Api.adminSetUserBoards(user.id, { boardIds: nextIds, defaultBoardId: nextDefault })
                          .catch((e) => setError((e as Error).message))
                          .finally(() => setLoading(false));
                      }}
                    />
                    <span className="text-sm text-slate-800">{b.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="grid gap-1">
              <div className="text-xs text-slate-600">Доска по умолчанию</div>
              <select
                className="rounded-xl border border-slate-200 bg-white p-2 text-sm outline-none focus:border-[#246c7c]"
                value={defaultBoardId}
                onChange={(e) => {
                  const v = e.target.value;
                  setDefaultBoardId(v);
                  setError(null);
                  setLoading(true);
                  void Api.adminSetUserBoards(user.id, { boardIds: Array.from(selectedIds), defaultBoardId: v })
                    .catch((e) => setError((e as Error).message))
                    .finally(() => setLoading(false));
                }}
              >
                <option value="">—</option>
                {(boards ?? [])
                  .filter((b) => b.hasAccess)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </label>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

type CabinetTab = "personal" | "smtp" | "boards" | "users" | "archive";

function ProfileModal(props: {
  open: boolean;
  onClose: () => void;
  me: User;
  boards: Board[];
  onUpdated: () => Promise<void>;
}) {
  const [cabinetTab, setCabinetTab] = useState<CabinetTab>("personal");
  const [name, setName] = useState(props.me.name);
  const [email, setEmail] = useState(props.me.email);
  const [defaultBoardId, setDefaultBoardId] = useState<string>(props.me.defaultBoardId ?? "");
  const [avatarPreset, setAvatarPreset] = useState<string>(props.me.avatarPreset ?? "");
  const [avatarUploadName, setAvatarUploadName] = useState<string | null>(props.me.avatarUploadName ?? null);
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(
    props.me.emailNotificationsEnabled !== false,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarFileRef = useRef<HTMLInputElement | null>(null);

  const [mailLoading, setMailLoading] = useState(false);
  const [mailSaving, setMailSaving] = useState(false);
  const [mailTesting, setMailTesting] = useState(false);
  const [mailTest, setMailTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [mailEnabled, setMailEnabled] = useState(false);
  const [mailHost, setMailHost] = useState("");
  const [mailPort, setMailPort] = useState("465");
  const [mailSecure, setMailSecure] = useState(true);
  const [mailUser, setMailUser] = useState("");
  const [mailFrom, setMailFrom] = useState("");
  const [mailPass, setMailPass] = useState("");
  const [mailPassSet, setMailPassSet] = useState(false);

  const [archiveFiles, setArchiveFiles] = useState<string[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [restoreFilename, setRestoreFilename] = useState<string | null>(null);
  const [restoreBoardId, setRestoreBoardId] = useState("");
  const [restoreColumnId, setRestoreColumnId] = useState("");
  const [restoreColumns, setRestoreColumns] = useState<Array<{ id: string; title: string; position: number }>>([]);
  const [restoring, setRestoring] = useState(false);

  const isAdmin = props.me.role === "ADMIN";

  const saveProfile = useCallback(
    (updates: {
      name?: string;
      email?: string;
      defaultBoardId?: string;
      avatarPreset?: string | null;
      emailNotificationsEnabled?: boolean;
    }) => {
      const payload: Parameters<typeof Api.updateProfile>[0] = {};
      if (updates.name !== undefined && updates.name.trim() !== (props.me.name ?? "")) payload.name = updates.name.trim();
      if (updates.email !== undefined && updates.email.trim() !== (props.me.email ?? "")) payload.email = updates.email.trim();
      if (updates.defaultBoardId !== undefined && updates.defaultBoardId !== (props.me.defaultBoardId ?? "")) payload.defaultBoardId = updates.defaultBoardId || undefined;
      const nextPreset = updates.avatarPreset !== undefined ? updates.avatarPreset : (avatarPreset || null);
      const prevPreset = props.me.avatarPreset ? props.me.avatarPreset : null;
      if (nextPreset !== prevPreset) payload.avatarPreset = nextPreset;
      if (updates.emailNotificationsEnabled !== undefined && updates.emailNotificationsEnabled !== (props.me.emailNotificationsEnabled !== false)) payload.emailNotificationsEnabled = updates.emailNotificationsEnabled;
      if (Object.keys(payload).length === 0) return;
      setSaving(true);
      setError(null);
      void Api.updateProfile(payload)
        .then(() => props.onUpdated())
        .catch((e) => setError((e as Error).message))
        .finally(() => setSaving(false));
    },
    [avatarPreset, props],
  );

  useEffect(() => {
    if (!props.open) return;
    setCabinetTab("personal");
    setName(props.me.name);
    setEmail(props.me.email);
    setDefaultBoardId(props.me.defaultBoardId ?? "");
    setAvatarPreset(props.me.avatarPreset ?? "");
    setAvatarUploadName(props.me.avatarUploadName ?? null);
    setEmailNotificationsEnabled(props.me.emailNotificationsEnabled !== false);
    setError(null);
  }, [props.open, props.me.avatarPreset, props.me.avatarUploadName, props.me.defaultBoardId, props.me.email, props.me.emailNotificationsEnabled, props.me.id, props.me.name]);

  useEffect(() => {
    if (!props.open || cabinetTab !== "archive" || props.me.role !== "ADMIN") return;
    setArchiveLoading(true);
    setArchiveError(null);
    void Api.listArchives()
      .then((r) => setArchiveFiles(r.files))
      .catch((e) => setArchiveError((e as Error).message))
      .finally(() => setArchiveLoading(false));
  }, [props.open, cabinetTab, props.me.role]);

  useEffect(() => {
    if (!restoreBoardId) {
      setRestoreColumns([]);
      setRestoreColumnId("");
      return;
    }
    void Api.listBoardColumns(restoreBoardId).then((r) => {
      setRestoreColumns(r.columns);
      setRestoreColumnId(r.columns[0]?.id ?? "");
    });
  }, [restoreBoardId]);

  useEffect(() => {
    if (!props.open) return;
    if (props.me.role !== "ADMIN") return;
    setMailLoading(true);
    void Api.getMailSettings()
      .then((r) => {
        setMailEnabled(!!r.settings.enabled);
        setMailHost(r.settings.host ?? "");
        setMailPort(String(r.settings.port ?? 465));
        setMailSecure(!!r.settings.secure);
        setMailUser(r.settings.user ?? "");
        setMailFrom(r.settings.from ?? "");
        setMailPass("");
        setMailPassSet(!!r.settings.passSet);
        setMailTest(null);
      })
      .catch(() => {
        // keep silent; admin can still use env-based mail if any
      })
      .finally(() => setMailLoading(false));
  }, [props.open, props.me.role]);

  const saveMailSettingsBlur = useCallback(() => {
    if (!mailEnabled || mailLoading || mailSaving) return;
    setError(null);
    setMailTest(null);
    setMailSaving(true);
    const portNum = Number(mailPort);
    const host = mailHost.trim() || null;
    const user = mailUser.trim() || null;
    const from = mailFrom.trim() || null;
    void Api.updateMailSettings({
      enabled: true,
      host,
      port: Number.isFinite(portNum) ? portNum : null,
      secure: mailSecure,
      user,
      from,
      ...(mailPass.trim() ? { pass: mailPass.trim() } : {}),
    })
      .then((r) => {
        setMailPass("");
        setMailPassSet(!!r.settings.passSet);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setMailSaving(false));
  }, [mailEnabled, mailFrom, mailHost, mailLoading, mailPass, mailPort, mailSaving, mailSecure, mailUser]);

  if (!props.open) return null;

  return (
    <Modal
      open={true}
      onClose={props.onClose}
      panelStyle={{ height: "70vh", minHeight: "400px" }}
      headerLeft={
        <div className="flex min-w-0 items-center gap-3">
          <img src="/ioterra.svg" alt="" className="h-9 w-9 shrink-0" width={36} height={36} aria-hidden />
          <div className="text-lg font-semibold text-slate-900">Личный кабинет</div>
        </div>
      }
    >
      <div className="flex flex-col gap-3 h-full min-h-0">
        <div className="shrink-0 flex flex-wrap gap-1 border-b border-slate-200 pb-2">
          <button
            type="button"
            className={classNames(
              "grid h-10 w-10 place-items-center rounded-xl text-sm font-semibold",
              cabinetTab === "personal"
                ? "bg-[#246c7c] text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200",
            )}
            title="Личные данные"
            aria-label="Личные данные"
            onClick={() => setCabinetTab("personal")}
          >
            <IconUser className="h-5 w-5" />
          </button>
          {isAdmin ? (
            <>
              <button
                type="button"
                className={classNames(
                  "grid h-10 w-10 place-items-center rounded-xl text-sm font-semibold",
                  cabinetTab === "smtp"
                    ? "bg-[#246c7c] text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                )}
                title="Настройки SMTP"
                aria-label="Настройки SMTP"
                onClick={() => setCabinetTab("smtp")}
              >
                <IconMail className="h-5 w-5" />
              </button>
              <button
                type="button"
                className={classNames(
                  "grid h-10 w-10 place-items-center rounded-xl text-sm font-semibold",
                  cabinetTab === "boards"
                    ? "bg-[#246c7c] text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                )}
                title="Доски"
                aria-label="Доски"
                onClick={() => setCabinetTab("boards")}
              >
                <IconLayoutKanban className="h-5 w-5" />
              </button>
              <button
                type="button"
                className={classNames(
                  "grid h-10 w-10 place-items-center rounded-xl text-sm font-semibold",
                  cabinetTab === "users"
                    ? "bg-[#246c7c] text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                )}
                title="Пользователи"
                aria-label="Пользователи"
                onClick={() => setCabinetTab("users")}
              >
                <IconUsers className="h-5 w-5" />
              </button>
              <button
                type="button"
                className={classNames(
                  "grid h-10 w-10 place-items-center rounded-xl text-sm font-semibold",
                  cabinetTab === "archive"
                    ? "bg-[#246c7c] text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                )}
                title="Архив"
                aria-label="Архив"
                onClick={() => setCabinetTab("archive")}
              >
                <IconArchive className="h-5 w-5" />
              </button>
            </>
          ) : null}
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
        {cabinetTab === "boards" ? (
          <BoardsModal
            open={true}
            onClose={() => setCabinetTab("personal")}
            boards={props.boards}
            onUpdated={props.onUpdated}
            embedded
          />
        ) : cabinetTab === "users" ? (
          <UsersModal open={true} onClose={() => setCabinetTab("personal")} embedded />
        ) : cabinetTab === "archive" ? (
          <div className="grid gap-3">
            {archiveError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{archiveError}</div>
            ) : null}
            <div className="text-sm text-slate-600">ZIP-архивы карточек. Можно удалить, скачать или восстановить карточку на доску.</div>
            {archiveLoading ? (
              <div className="text-slate-500">Загрузка…</div>
            ) : archiveFiles.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Архивов пока нет.</div>
            ) : (
              <ul className="grid gap-2">
                {archiveFiles.map((filename) => (
                  <li
                    key={filename}
                    className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white p-3"
                  >
                    <span
                      className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900"
                      title={filename}
                    >
                      {filename}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <IconButton
                        title="Удалить"
                        onClick={() => {
                          if (confirm(`Удалить архив «${filename}»?`)) {
                            void Api.deleteArchive(filename).then(() =>
                              Api.listArchives().then((r) => setArchiveFiles(r.files)),
                            ).catch((e) => setArchiveError((e as Error).message));
                          }
                        }}
                      >
                        <IconTrash className="h-5 w-5" />
                      </IconButton>
                      <IconButton
                        title="Скачать"
                        onClick={() => void Api.downloadArchive(filename).catch((e) => setArchiveError((e as Error).message))}
                      >
                        <IconDownload className="h-5 w-5" />
                      </IconButton>
                      <IconButton
                        title="Восстановить"
                        variant="brand"
                        onClick={() => {
                          setRestoreFilename(filename);
                          setRestoreBoardId(props.boards[0]?.id ?? "");
                          setRestoreColumnId("");
                        }}
                      >
                        <IconArchiveRestore className="h-5 w-5" />
                      </IconButton>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {restoreFilename ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 text-sm font-semibold text-slate-800">Восстановить карточку из «{restoreFilename}»</div>
                <div className="grid gap-2">
                  <label className="grid gap-1 text-sm">
                    Доска
                    <select
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1"
                      value={restoreBoardId}
                      onChange={(e) => setRestoreBoardId(e.target.value)}
                    >
                      {props.boards.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    Колонка
                    <select
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1"
                      value={restoreColumnId}
                      onChange={(e) => setRestoreColumnId(e.target.value)}
                      disabled={restoreColumns.length === 0}
                    >
                      {restoreColumns.map((c) => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                      ))}
                    </select>
                  </label>
                  <div className="flex gap-2">
                    <IconButton
                      variant="brand"
                      title={restoring ? "Восстановление…" : "Восстановить"}
                      disabled={restoring || !restoreColumnId}
                      onClick={() => {
                        if (!restoreFilename || !restoreColumnId) return;
                        setRestoring(true);
                        setArchiveError(null);
                        void Api.restoreArchive(restoreFilename, restoreBoardId, restoreColumnId)
                          .then(() => {
                            setRestoreFilename(null);
                            return Api.listArchives().then((r) => setArchiveFiles(r.files));
                          })
                          .then(() => props.onUpdated())
                          .catch((e) => setArchiveError((e as Error).message))
                          .finally(() => setRestoring(false));
                      }}
                    >
                      {restoring ? <IconSpinner className="h-5 w-5 text-[#246c7c]" /> : <IconArchiveRestore className="h-5 w-5" />}
                    </IconButton>
                    <IconButton title="Отмена" onClick={() => setRestoreFilename(null)}>
                      <IconX className="h-5 w-5" />
                    </IconButton>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : cabinetTab === "smtp" ? (
          <div className="grid gap-3">
            {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
            <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Настройки SMTP (для всех уведомлений)</div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <label className="flex items-center gap-2 text-sm text-slate-800">
                  <input
                    type="checkbox"
                    checked={mailEnabled}
                    disabled={mailLoading || mailSaving}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setMailEnabled(v);
                      setError(null);
                      setMailTest(null);
                      setMailSaving(true);
                      if (v) {
                        const portNum = Number(mailPort);
                        const host = mailHost.trim() || null;
                        const user = mailUser.trim() || null;
                        const from = mailFrom.trim() || null;
                        void Api.updateMailSettings({
                          enabled: true,
                          host,
                          port: Number.isFinite(portNum) ? portNum : null,
                          secure: mailSecure,
                          user,
                          from,
                          ...(mailPass.trim() ? { pass: mailPass.trim() } : {}),
                        })
                          .then((r) => {
                            setMailPass("");
                            setMailPassSet(!!r.settings.passSet);
                          })
                          .catch((e) => setError((e as Error).message))
                          .finally(() => setMailSaving(false));
                      } else {
                        void Api.updateMailSettings({ enabled: false })
                          .catch((e) => setError((e as Error).message))
                          .finally(() => setMailSaving(false));
                      }
                    }}
                  />
                  <span>Включить отправку писем (сервер)</span>
                </label>

                {mailEnabled ? (
                  <div className="mt-3 grid gap-2">
                    <div className="grid gap-2 md:grid-cols-2">
                      <label className="grid gap-1">
                        <div className="text-xs text-slate-600">SMTP host</div>
                        <input
                          className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
                          value={mailHost}
                          onChange={(e) => setMailHost(e.target.value)}
                          onBlur={saveMailSettingsBlur}
                          placeholder="smtp.example.com"
                          disabled={mailLoading || mailSaving || mailTesting}
                        />
                      </label>
                      <label className="grid gap-1">
                        <div className="text-xs text-slate-600">Порт</div>
                        <input
                          className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
                          value={mailPort}
                          onChange={(e) => setMailPort(e.target.value)}
                          onBlur={saveMailSettingsBlur}
                          placeholder="465"
                          inputMode="numeric"
                          disabled={mailLoading || mailSaving || mailTesting}
                        />
                      </label>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-slate-800">
                      <input
                        type="checkbox"
                        checked={mailSecure}
                        disabled={mailLoading || mailSaving || mailTesting}
                        onChange={(e) => {
                          setMailSecure(e.target.checked);
                          if (mailLoading || mailSaving) return;
                          setError(null);
                          setMailSaving(true);
                          const portNum = Number(mailPort);
                          const host = mailHost.trim() || null;
                          const user = mailUser.trim() || null;
                          const from = mailFrom.trim() || null;
                          void Api.updateMailSettings({
                            enabled: true,
                            host,
                            port: Number.isFinite(portNum) ? portNum : null,
                            secure: e.target.checked,
                            user,
                            from,
                            ...(mailPass.trim() ? { pass: mailPass.trim() } : {}),
                          })
                            .then((r) => {
                              setMailPass("");
                              setMailPassSet(!!r.settings.passSet);
                            })
                            .catch((e) => setError((e as Error).message))
                            .finally(() => setMailSaving(false));
                        }}
                      />
                      <span>SSL/TLS (secure)</span>
                    </label>
                    <div className="grid gap-2 md:grid-cols-2">
                      <label className="grid gap-1">
                        <div className="text-xs text-slate-600">Логин</div>
                        <input
                          className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
                          value={mailUser}
                          onChange={(e) => setMailUser(e.target.value)}
                          onBlur={saveMailSettingsBlur}
                          placeholder="user@example.com"
                          disabled={mailLoading || mailSaving || mailTesting}
                        />
                      </label>
                      <label className="grid gap-1">
                        <div className="text-xs text-slate-600">Пароль</div>
                        <PasswordInput
                          value={mailPass}
                          onChange={(e) => setMailPass(e.target.value)}
                          onBlur={saveMailSettingsBlur}
                          placeholder={mailPassSet ? "•••••••• (сохранён)" : "Введите пароль"}
                          disabled={mailLoading || mailSaving || mailTesting}
                        />
                      </label>
                    </div>
                    <label className="grid gap-1">
                      <div className="text-xs text-slate-600">From</div>
                      <input
                        className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
                        value={mailFrom}
                        onChange={(e) => setMailFrom(e.target.value)}
                        onBlur={saveMailSettingsBlur}
                        placeholder="Имя <no-reply@example.com>"
                        disabled={mailLoading || mailSaving || mailTesting}
                      />
                    </label>

                    {mailTest ? (
                      <div
                        className={classNames(
                          "rounded-xl border px-3 py-2 text-sm",
                          mailTest.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-800",
                        )}
                      >
                        {mailTest.message}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap justify-end gap-2">
                      <IconButton
                        title={mailTesting ? "Проверка…" : "Проверить соединение"}
                        disabled={mailLoading || mailSaving || mailTesting}
                        onClick={() => {
                          setError(null);
                          setMailTest(null);
                          setMailTesting(true);
                          const portNum = Number(mailPort);
                          void Api.testMailSettings({
                            host: mailHost.trim() || null,
                            port: Number.isFinite(portNum) ? portNum : null,
                            secure: mailSecure,
                            user: mailUser.trim() || null,
                            from: mailFrom.trim() || null,
                            ...(mailPass.trim() ? { pass: mailPass.trim() } : {}),
                          })
                            .then((r) => {
                              if (r.ok) setMailTest({ ok: true, message: "Соединение установлено. Аутентификация успешна." });
                              else setMailTest({ ok: false, message: `Ошибка: ${r.error ?? "неизвестно"}` });
                            })
                            .catch((e) => setMailTest({ ok: false, message: `Ошибка: ${(e as Error).message}` }))
                            .finally(() => setMailTesting(false));
                        }}
                      >
                        {mailTesting ? <IconSpinner className="h-5 w-5" /> : <IconPlug className="h-5 w-5" />}
                      </IconButton>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
          <AvatarImg user={{ ...props.me, avatarPreset, avatarUploadName }} size={64} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-slate-600">Аватар</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <AvatarPresetDropdown
                userId={props.me.id}
                value={avatarPreset}
                disabled={saving || uploadingAvatar}
                onChange={(v) => {
                  setAvatarPreset(v);
                  saveProfile({ avatarPreset: v || null });
                }}
              />

              <input
                ref={avatarFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  setError(null);
                  setUploadingAvatar(true);
                  void Api.uploadMyAvatar(f)
                    .then((r) => {
                      setAvatarUploadName(r.user?.avatarUploadName ?? null);
                      return props.onUpdated();
                    })
                    .catch((err) => setError((err as Error).message))
                    .finally(() => setUploadingAvatar(false));
                }}
              />
              <IconButton
                title="Загрузить фото"
                disabled={saving || uploadingAvatar}
                onClick={() => avatarFileRef.current?.click()}
              >
                <IconPhotoUpload className="h-5 w-5" />
              </IconButton>

              {avatarUploadName ? (
                <IconButton
                  title="Удалить фото"
                  variant="danger"
                  onClick={() => {
                    setError(null);
                    setUploadingAvatar(true);
                    void Api.deleteMyAvatar()
                      .then((r) => {
                        setAvatarUploadName(r.user?.avatarUploadName ?? null);
                        return props.onUpdated();
                      })
                      .catch((err) => setError((err as Error).message))
                      .finally(() => setUploadingAvatar(false));
                  }}
                >
                  <IconTrash className="h-5 w-5" />
                </IconButton>
              ) : null}
            </div>
            <div className="mt-1 text-xs text-slate-500">PNG/JPG/WebP/GIF, до 2 МБ. Фото показывается вместо пресета.</div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={emailNotificationsEnabled}
              disabled={saving}
              onChange={(e) => {
                const v = e.target.checked;
                setEmailNotificationsEnabled(v);
                saveProfile({ emailNotificationsEnabled: v });
              }}
            />
            <span>Использовать уведомления по почте</span>
          </label>
          <div className="mt-1 text-xs text-slate-500">Получать письма об изменениях в карточках, где вы участник.</div>
        </div>

        <label className="grid gap-1">
          <div className="text-xs text-slate-600">Имя</div>
          <input
            className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && saveProfile({ name })}
          />
        </label>
        <label className="grid gap-1">
          <div className="text-xs text-slate-600">Email</div>
          <input
            className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => email.trim() && saveProfile({ email })}
          />
        </label>
        <label className="grid gap-1">
          <div className="text-xs text-slate-600">Доска по умолчанию</div>
          <select
            className="rounded-xl border border-slate-200 bg-white p-2 text-sm outline-none focus:border-[#246c7c]"
            value={defaultBoardId}
            onChange={(e) => {
              const v = e.target.value;
              setDefaultBoardId(v);
              saveProfile({ defaultBoardId: v });
            }}
          >
            {props.boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
          </>
        )}
        </div>
      </div>
    </Modal>
  );
}

function BoardsModal(props: {
  open: boolean;
  onClose: () => void;
  boards: Board[];
  onUpdated: () => Promise<void>;
  embedded?: boolean;
}) {
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createMemberIds, setCreateMemberIds] = useState<string[]>([]);

  const [edit, setEdit] = useState<Record<string, { name: string; description: string; memberIds: string[] }>>({});
  const [allUsers, setAllUsers] = useState<
    Array<{ id: string; email: string; name: string; role: string; avatarPreset?: string | null; avatarUploadName?: string | null }> | null
  >(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [columnsBoardId, setColumnsBoardId] = useState<string | null>(null);
  const [boardColumns, setBoardColumns] = useState<Array<{ id: string; title: string; position: number; _count?: { cards: number } }>>([]);
  const [columnsLoading, setColumnsLoading] = useState(false);
  const [columnsError, setColumnsError] = useState<string | null>(null);
  const [newColumnTitle, setNewColumnTitle] = useState("");
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editingColumnTitle, setEditingColumnTitle] = useState("");

  const columnListSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const boardsModalOpenRef = useRef(false);
  useEffect(() => {
    if (!props.open) {
      boardsModalOpenRef.current = false;
      return;
    }
    const wasOpen = boardsModalOpenRef.current;
    boardsModalOpenRef.current = true;
    if (!wasOpen) {
      setColumnsBoardId(null);
    }
    setCreateName("");
    setCreateDescription("");
    setCreateMemberIds([]);
    setEdit(
      Object.fromEntries(
        props.boards.map((b) => [
          b.id,
          {
            name: b.name,
            description: (b.description ?? "") as string,
            memberIds: (b.memberIds ?? []) as string[],
          },
        ]),
      ),
    );
    setAllUsers(null);
    setExpandedId(null);
    setError(null);

    void Api.listUsers()
      .then((r) => setAllUsers(r.users))
      .catch(() => setAllUsers([]));
  }, [props.open, props.boards]);

  useEffect(() => {
    if (!columnsBoardId) return;
    setColumnsLoading(true);
    setColumnsError(null);
    void Api.listBoardColumns(columnsBoardId)
      .then((r) => setBoardColumns(r.columns))
      .catch((e) => setColumnsError((e as Error).message))
      .finally(() => setColumnsLoading(false));
  }, [columnsBoardId]);

  if (!props.open) return null;

  const usersForMembers = allUsers ?? [];

  const toggleId = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  const columnsBoard = columnsBoardId ? props.boards.find((x) => x.id === columnsBoardId) : null;

  const content = (
      <div className="grid gap-3">
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Новая доска</div>
        <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center gap-2">
            <input
              className="flex-1 rounded-xl border border-slate-200 bg-white p-2 text-sm outline-none focus:border-[#246c7c]"
              placeholder="Название новой доски"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
            />
            <button
              type="button"
              className="grid h-10 w-10 place-items-center rounded-xl bg-[#246c7c] text-white hover:opacity-90 disabled:opacity-50"
              disabled={!createName.trim()}
              onClick={() => {
                setError(null);
                void Api.createBoard({
                  name: createName.trim(),
                  description: createDescription.trim() ? createDescription.trim() : null,
                  ...(usersForMembers.length ? { memberIds: createMemberIds } : {}),
                })
                  .then(() => props.onUpdated())
                  .then(() => {
                    setCreateName("");
                    setCreateDescription("");
                    setCreateMemberIds([]);
                  })
                  .catch((e) => setError((e as Error).message));
              }}
              title="Создать доску"
              aria-label="Создать доску"
            >
              <IconPlus className="h-5 w-5" />
            </button>
          </div>
          <textarea
            className="min-h-[72px] w-full rounded-xl border border-slate-200 bg-white p-2 text-sm text-slate-900 outline-none focus:border-[#246c7c]"
            placeholder="Описание (необязательно)"
            value={createDescription}
            onChange={(e) => setCreateDescription(e.target.value)}
          />
          {usersForMembers.length ? (
            <div className="rounded-xl border border-slate-200 bg-white p-2">
              <div className="mb-2 text-xs font-semibold text-slate-600">Участники</div>
              <div className="max-h-32 overflow-auto">
                <div className="grid gap-1">
                  {usersForMembers.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 text-sm text-slate-900">
                      <input
                        type="checkbox"
                        checked={createMemberIds.includes(u.id)}
                        onChange={() => setCreateMemberIds((prev) => toggleId(prev, u.id))}
                      />
                      <AvatarImg user={u} size={20} />
                      <span className="truncate">{u.name || u.email}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Список досок</div>
        <div className="max-h-[55vh] overflow-auto rounded-2xl border border-slate-200 bg-white">
          <div className="divide-y divide-slate-100">
            {props.boards.map((b) => {
              const isOpen = expandedId === b.id;
              const e =
                edit[b.id] ?? { name: b.name, description: (b.description ?? "") as string, memberIds: (b.memberIds ?? []) as string[] };

              return (
                <div key={b.id} className="bg-white">
                  <button
                    className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-slate-50"
                    onClick={() => setExpandedId((prev) => (prev === b.id ? null : b.id))}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">{b.name}</div>
                    </div>
                    <div className="flex min-h-[2.75rem] min-w-[2.75rem] shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700">{isOpen ? <IconChevronUp className="h-6 w-6" /> : <IconChevronDown className="h-6 w-6" />}</div>
                  </button>

                  {isOpen ? (
                    <div className="px-4 pb-4">
                      <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <label className="grid gap-1">
                          <div className="text-xs font-semibold text-slate-600">Название</div>
                          <input
                            className="w-full rounded-xl border border-slate-200 bg-white p-2 text-sm outline-none focus:border-[#246c7c]"
                            value={e.name}
                            onChange={(ev) =>
                              setEdit((prev) => ({ ...prev, [b.id]: { ...(prev[b.id] ?? e), name: ev.target.value } }))
                            }
                            onBlur={() => {
                              if (!e.name.trim()) return;
                              setError(null);
                              void Api.updateBoard(b.id, {
                                name: e.name.trim(),
                                description: (e.description ?? "").trim() || null,
                                ...(usersForMembers.length ? { memberIds: e.memberIds } : {}),
                              })
                                .then(() => props.onUpdated())
                                .catch((err) => setError((err as Error).message));
                            }}
                          />
                        </label>

                        <label className="grid gap-1">
                          <div className="text-xs font-semibold text-slate-600">Описание</div>
                          <textarea
                            className="min-h-[72px] w-full rounded-xl border border-slate-200 bg-white p-2 text-sm text-slate-900 outline-none focus:border-[#246c7c]"
                            value={e.description}
                            onChange={(ev) =>
                              setEdit((prev) => ({
                                ...prev,
                                [b.id]: { ...(prev[b.id] ?? e), description: ev.target.value },
                              }))
                            }
                            onBlur={() => {
                              setError(null);
                              void Api.updateBoard(b.id, {
                                name: (e.name ?? "").trim(),
                                description: (e.description ?? "").trim() || null,
                                ...(usersForMembers.length ? { memberIds: e.memberIds } : {}),
                              })
                                .then(() => props.onUpdated())
                                .catch((err) => setError((err as Error).message));
                            }}
                          />
                        </label>

                        {usersForMembers.length ? (
                          <div className="rounded-xl border border-slate-200 bg-white p-2">
                            <div className="mb-2 text-xs font-semibold text-slate-600">Участники</div>
                            <div className="max-h-40 overflow-auto">
                              <div className="grid gap-1">
                                {usersForMembers.map((u) => (
                                  <label key={u.id} className="flex items-center gap-2 text-sm text-slate-900">
                                    <input
                                      type="checkbox"
                                      checked={(e.memberIds ?? []).includes(u.id)}
                                      onChange={() => {
                                        const nextMemberIds = toggleId(e.memberIds, u.id);
                                        setEdit((prev) => ({
                                          ...prev,
                                          [b.id]: { ...(prev[b.id] ?? e), memberIds: nextMemberIds },
                                        }));
                                        setError(null);
                                        void Api.updateBoard(b.id, {
                                          name: (e.name ?? "").trim(),
                                          description: (e.description ?? "").trim() || null,
                                          memberIds: nextMemberIds,
                                        })
                                          .then(() => props.onUpdated())
                                          .catch((err) => setError((err as Error).message));
                                      }}
                                    />
                                    <AvatarImg user={u} size={20} />
                                    <span className="truncate">{u.name || u.email}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          </div>
                        ) : null}

                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <IconButton
                            title="Колонки доски"
                            onClick={() => {
                              setColumnsBoardId(b.id);
                              setNewColumnTitle("");
                              setEditingColumnId(null);
                            }}
                          >
                            <IconColumns className="h-5 w-5" />
                          </IconButton>
                          <IconButton
                            title={props.boards.length <= 1 ? "Нельзя удалить последнюю доску" : "Удалить доску"}
                            variant="danger"
                            disabled={props.boards.length <= 1}
                            onClick={() => {
                              if (props.boards.length <= 1) return;
                              if (!confirm(`Удалить доску “${b.name}”?`)) return;
                              setError(null);
                              void Api.deleteBoard(b.id)
                                .then(() => props.onUpdated())
                                .catch((err) => setError((err as Error).message));
                            }}
                          >
                            <IconTrash className="h-5 w-5" />
                          </IconButton>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
  );

  const columnsModal =
    columnsBoardId &&
    columnsBoard &&
    (
      <Modal
        open={true}
        title={`Колонки: ${columnsBoard.name}`}
        onClose={() => setColumnsBoardId(null)}
        headerRight={
          <IconButton title="Закрыть" onClick={() => setColumnsBoardId(null)}>
            <IconX className="h-5 w-5" />
          </IconButton>
        }
      >
        <div className="grid gap-3">
          {columnsError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{columnsError}</div>
          ) : null}
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Колонки доски</div>
          {columnsLoading ? (
            <div className="text-sm text-slate-500">Загрузка…</div>
          ) : (
            <DndContext
              sensors={columnListSensors}
              collisionDetection={closestCorners}
              onDragEnd={(e) => {
                const activeId = e.active.id as string;
                const overId = e.over?.id as string | undefined;
                if (!overId || activeId === overId) return;
                const fromIdx = boardColumns.findIndex((c) => c.id === activeId);
                const toIdx = boardColumns.findIndex((c) => c.id === overId);
                if (fromIdx < 0 || toIdx < 0) return;
                const next = [...boardColumns];
                const [removed] = next.splice(fromIdx, 1);
                next.splice(toIdx, 0, removed);
                setBoardColumns(next);
                setColumnsError(null);
                void Api.updateBoardColumn(columnsBoardId, activeId, { position: toIdx })
                  .then(() => void props.onUpdated())
                  .catch((err) => setColumnsError((err as Error).message));
              }}
            >
              <SortableContext items={boardColumns.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {boardColumns.map((col) => (
                    <SortableBoardColumnRow key={col.id} col={col}>
                      {editingColumnId === col.id ? (
                        <>
                          <input
                            className="min-w-[120px] flex-1 rounded-lg border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
                            value={editingColumnTitle}
                            onChange={(e) => setEditingColumnTitle(e.target.value)}
                            onBlur={() => {
                              const t = editingColumnTitle.trim();
                              if (!t) {
                                setEditingColumnId(null);
                                setEditingColumnTitle("");
                                return;
                              }
                              setColumnsError(null);
                              void Api.updateBoardColumn(columnsBoardId, col.id, { title: t })
                                .then(() => {
                                  setBoardColumns((prev) => prev.map((c) => (c.id === col.id ? { ...c, title: t } : c)));
                                  setEditingColumnId(null);
                                  setEditingColumnTitle("");
                                  void props.onUpdated();
                                })
                                .catch((e) => setColumnsError((e as Error).message));
                            }}
                            autoFocus
                          />
                          <button
                            type="button"
                            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-800 hover:bg-slate-50"
                            title="Отмена"
                            aria-label="Отмена"
                            onClick={() => {
                              setEditingColumnId(null);
                              setEditingColumnTitle("");
                            }}
                          >
                            <IconX className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-sm font-medium text-slate-900">{col.title}</span>
                          <span className="text-xs text-slate-500">
                            {col._count?.cards ?? 0} карточек
                          </span>
                          <button
                            type="button"
                            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-800 hover:bg-slate-50"
                            title="Переименовать"
                            aria-label="Переименовать"
                            onClick={() => {
                              setEditingColumnId(col.id);
                              setEditingColumnTitle(col.title);
                            }}
                          >
                            <IconEdit className="h-4 w-4" />
                          </button>
                          <IconButton
                            title="Удалить колонку"
                            variant="danger"
                            disabled={boardColumns.length <= 1}
                            onClick={() => {
                              if (boardColumns.length <= 1) return;
                              if (!confirm(`Удалить колонку "${col.title}"? Карточки будут перемещены в первую колонку.`)) return;
                              setColumnsError(null);
                              void Api.deleteBoardColumn(columnsBoardId, col.id)
                                .then(() => {
                                  setBoardColumns((prev) => prev.filter((c) => c.id !== col.id));
                                  void props.onUpdated();
                                })
                                .catch((e) => setColumnsError((e as Error).message));
                            }}
                          >
                            <IconTrash className="h-4 w-4" />
                          </IconButton>
                        </>
                      )}
                    </SortableBoardColumnRow>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
          <div className="border-t border-slate-200 pt-3">
            <div className="text-xs font-semibold text-slate-600 mb-2">Добавить колонку</div>
            <div className="flex gap-2">
              <input
                className="min-w-[140px] flex-1 rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
                placeholder="Название колонки"
                value={newColumnTitle}
                onChange={(e) => setNewColumnTitle(e.target.value)}
              />
              <IconButton
                variant="brand"
                title="Добавить колонку"
                disabled={!newColumnTitle.trim()}
                onClick={() => {
                  const title = newColumnTitle.trim();
                  if (!title) return;
                  setColumnsError(null);
                  void Api.createBoardColumn(columnsBoardId, { title })
                    .then((r) => {
                      setBoardColumns((prev) => [...prev, { id: r.column.id, title: r.column.title, position: r.column.position }]);
                      setNewColumnTitle("");
                      void props.onUpdated();
                    })
                    .catch((e) => setColumnsError((e as Error).message));
                }}
              >
                <IconPlus className="h-5 w-5" />
              </IconButton>
            </div>
          </div>
        </div>
      </Modal>
    );

  if (props.embedded) {
    return (
      <>
        {content}
        {columnsModal}
      </>
    );
  }

  return (
    <>
      <Modal
        open={true}
        title="Доски"
        onClose={props.onClose}
        headerRight={
          <IconButton title="Закрыть" onClick={props.onClose}>
            <IconX className="h-5 w-5" />
          </IconButton>
        }
      >
        {content}
      </Modal>
      {columnsModal}
    </>
  );
}

type CardModalUserLite = Pick<User, "id" | "email" | "name" | "avatarPreset" | "avatarUploadName">;

function CardModalUserEmailField(props: {
  label: string;
  valueEmail: string;
  onPick: (email: string) => void;
  isOpen: boolean;
  setIsOpen: (next: boolean) => void;
  onBeforeOpen: () => void;
  users: CardModalUserLite[];
  canManage: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  onPersist: () => void;
  /** Одна строка «лейбл: значение», как у полей колонки/важности. */
  compact?: boolean;
}) {
  const selected = useMemo(() => props.users.find((u) => u.email === props.valueEmail) ?? null, [props.users, props.valueEmail]);
  const inner = (
    <div className="relative min-w-0" ref={props.containerRef}>
        {props.canManage ? (
          <>
            <button
              type="button"
              className={classNames(
                "flex w-full min-w-0 items-center gap-2 border border-slate-200 bg-white text-left text-slate-800 outline-none hover:bg-slate-50 focus:border-[#246c7c]",
                props.compact ? "rounded-md px-1.5 py-0.5 text-[11px] leading-snug" : "rounded-xl px-2.5 py-2 text-sm",
              )}
              onClick={() => {
                props.onBeforeOpen();
                props.setIsOpen(!props.isOpen);
              }}
              aria-haspopup="listbox"
              aria-expanded={props.isOpen}
            >
              {props.valueEmail ? (
                selected ? (
                  <>
                    <AvatarImg user={selected} size={props.compact ? 18 : 24} />
                    <span className="min-w-0 flex-1 truncate">{selected.name || selected.email}</span>
                  </>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-slate-600">{props.valueEmail}</span>
                )
              ) : (
                <span className="text-slate-500">Не выбрано</span>
              )}
              <span className="shrink-0 text-slate-400">
                {props.isOpen ? (
                  <IconChevronUp className={props.compact ? "h-3 w-3" : "h-4 w-4"} />
                ) : (
                  <IconChevronDown className={props.compact ? "h-3 w-3" : "h-4 w-4"} />
                )}
              </span>
            </button>
            {props.isOpen ? (
              <div
                className="absolute left-0 top-full z-30 mt-1 max-h-56 w-full min-w-[12rem] overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                role="listbox"
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={!props.valueEmail}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
                  onClick={() => {
                    props.onPick("");
                    props.setIsOpen(false);
                    setTimeout(() => props.onPersist(), 0);
                  }}
                >
                  <span className="text-slate-500">Не выбрано</span>
                </button>
                {props.valueEmail && !props.users.some((u) => u.email === props.valueEmail) ? (
                  <button
                    type="button"
                    role="option"
                    aria-selected={true}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
                    onClick={() => props.setIsOpen(false)}
                  >
                    <span className="min-w-0 truncate">{props.valueEmail}</span>
                  </button>
                ) : null}
                {props.users.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    role="option"
                    aria-selected={props.valueEmail === u.email}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
                    onClick={() => {
                      props.onPick(u.email);
                      props.setIsOpen(false);
                      setTimeout(() => props.onPersist(), 0);
                    }}
                  >
                    <AvatarImg user={u} size={24} />
                    <span className="min-w-0 flex-1 truncate">{u.name || u.email}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div
            className={classNames(
              "flex items-center gap-2 border border-transparent text-slate-800",
              props.compact ? "min-h-0 rounded-md px-1 py-0.5 text-[11px] leading-snug" : "min-h-[2.5rem] rounded-xl px-1 py-2 text-sm",
            )}
          >
            {props.valueEmail ? (
              selected ? (
                <>
                  <AvatarImg user={selected} size={props.compact ? 18 : 24} />
                  <span className="min-w-0 truncate">{selected.name || selected.email}</span>
                </>
              ) : (
                <span className="min-w-0 truncate">{props.valueEmail}</span>
              )
            ) : (
              <span className="text-slate-500">—</span>
            )}
          </div>
        )}
    </div>
  );
  if (props.compact) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-[11px] leading-snug">
        <span className="shrink-0 text-slate-600">{props.label}:</span>
        {inner}
      </div>
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-[10rem,minmax(0,1fr)] sm:items-start sm:gap-x-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 sm:pt-2">{props.label}</div>
      {inner}
    </div>
  );
}

function CardModal(props: {
  open: boolean;
  card: CardDetail | null;
  columns: BoardColumn[];
  boardId: string | null;
  onShareLink?: (cardTitle: string, link: string) => void;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
  viewer: User;
  allUsers: Array<Pick<User, "id" | "email" | "name" | "avatarPreset" | "avatarUploadName">>;
}) {
  const card = props.card;
  const uploadInputRef = useRef<HTMLInputElement>(null);
  type CardFileUploadTarget =
    | { kind: "card" }
    | { kind: "newComment" }
    | { kind: "editComment"; commentId: string }
    | { kind: "details" };
  const uploadTargetRef = useRef<CardFileUploadTarget>({ kind: "card" });
  const commentComposerRef = useRef<HTMLDivElement | null>(null);
  const commentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** Позиция каретки в черновике комментария: при вкладке «Просмотр» textarea снят с DOM, при выборе файла фокус уходит — без ref вставки уезжают в конец. */
  const commentCaretRef = useRef(0);
  const editingCommentComposerRef = useRef<HTMLDivElement | null>(null);
  const editingCommentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editingCommentCaretRef = useRef(0);
  const persistInFlightRef = useRef<Promise<boolean> | null>(null);
  const detailsTextareaRef = useRef<HTMLTextAreaElement>(null);
  const detailsComposerRef = useRef<HTMLDivElement | null>(null);
  const detailsCaretRef = useRef(0);

  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [detailsEditing, setDetailsEditing] = useState(false);
  const [assignee, setAssignee] = useState("");
  const [customer, setCustomer] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [importance, setImportance] = useState<Importance>("MEDIUM");
  const [paused, setPaused] = useState(false);
  const [uploadSelectedName, setUploadSelectedName] = useState<string>("");

  const [commentBody, setCommentBody] = useState("");
  const [commentMentionOpen, setCommentMentionOpen] = useState(false);
  const [commentMentionQuery, setCommentMentionQuery] = useState("");
  const [commentMentionStart, setCommentMentionStart] = useState<number | null>(null);
  const [commentCardLinkOpen, setCommentCardLinkOpen] = useState(false);
  const [commentCardLinkQuery, setCommentCardLinkQuery] = useState("");
  const [commentCardLinkResults, setCommentCardLinkResults] = useState<CardSearchHit[]>([]);
  const [commentCardLinkSearching, setCommentCardLinkSearching] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState<string>("");
  const [editingCommentMentionOpen, setEditingCommentMentionOpen] = useState(false);
  const [editingCommentMentionQuery, setEditingCommentMentionQuery] = useState("");
  const [editingCommentMentionStart, setEditingCommentMentionStart] = useState<number | null>(null);
  const [editingCommentCardLinkOpen, setEditingCommentCardLinkOpen] = useState(false);
  const [editingCommentCardLinkQuery, setEditingCommentCardLinkQuery] = useState("");
  const [editingCommentCardLinkResults, setEditingCommentCardLinkResults] = useState<CardSearchHit[]>([]);
  const [editingCommentCardLinkSearching, setEditingCommentCardLinkSearching] = useState(false);

  const [detailsMentionOpen, setDetailsMentionOpen] = useState(false);
  const [detailsMentionQuery, setDetailsMentionQuery] = useState("");
  const [detailsMentionStart, setDetailsMentionStart] = useState<number | null>(null);
  const [detailsCardLinkOpen, setDetailsCardLinkOpen] = useState(false);
  const [detailsCardLinkQuery, setDetailsCardLinkQuery] = useState("");
  const [detailsCardLinkResults, setDetailsCardLinkResults] = useState<CardSearchHit[]>([]);
  const [detailsCardLinkSearching, setDetailsCardLinkSearching] = useState(false);

  const resetDetailsTools = () => {
    setDetailsMentionOpen(false);
    setDetailsMentionQuery("");
    setDetailsMentionStart(null);
    setDetailsCardLinkOpen(false);
    setDetailsCardLinkQuery("");
    setDetailsCardLinkResults([]);
  };

  const [participants, setParticipants] = useState<
    Array<{ user: Pick<User, "id" | "email" | "name" | "avatarPreset" | "avatarUploadName"> }>
  >([]);
  const [participantAddOpen, setParticipantAddOpen] = useState(false);
  const [participantAddUserId, setParticipantAddUserId] = useState("");
  const [participantAddSearch, setParticipantAddSearch] = useState("");
  const [participantError, setParticipantError] = useState<string | null>(null);
  const [customerSelectOpen, setCustomerSelectOpen] = useState(false);
  const customerSelectRef = useRef<HTMLDivElement>(null);
  const [participantMenuUserId, setParticipantMenuUserId] = useState<string | null>(null);
  const participantAddRef = useRef<HTMLDivElement>(null);

  const [rightWidth, setRightWidth] = useState(420);
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{ startX: number; startW: number } | null>(null);
  const cardLayoutRef = useRef<HTMLDivElement>(null);
  const [leftPaneCollapsed, setLeftPaneCollapsed] = useState(false);
  const [rightPaneCollapsed, setRightPaneCollapsed] = useState(false);
  const [isLg, setIsLg] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [panelSize, setPanelSize] = useState<{ w: number; h: number }>({ w: 1120, h: 740 });
  const [panelHasCustomSize, setPanelHasCustomSize] = useState(false);
  const [panelResizing, setPanelResizing] = useState(false);
  const [panelFullscreen, setPanelFullscreen] = useState(false);
  const panelResizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const lastLoadedIdRef = useRef<string | null>(null);
  const [headerActionsOpen, setHeaderActionsOpen] = useState(false);
  const headerActionsRef = useRef<HTMLDivElement | null>(null);
  const [favorite, setFavorite] = useState(false);

  const canEditCard = props.viewer.role !== "OBSERVER";
  const canManageCard =
    !!card &&
    canEditCard &&
    (props.viewer.role === "ADMIN" || ((card as any).authorId as string | null | undefined) === props.viewer.id);

  const participantChips = useMemo(() => {
    const aEmail = assignee.trim();
    const assigneeResolved = aEmail ? props.allUsers.find((x) => x.email === aEmail) ?? null : null;
    const chips: Array<{ user: CardModalUserLite; isAssignee: boolean }> = [];
    if (assigneeResolved) {
      chips.push({ user: assigneeResolved, isAssignee: true });
    } else if (aEmail) {
      chips.push({
        user: {
          id: "legacy-assignee",
          email: aEmail,
          name: aEmail,
          avatarPreset: null,
          avatarUploadName: null,
        },
        isAssignee: true,
      });
    }
    for (const p of participants) {
      if (assigneeResolved && p.user.id === assigneeResolved.id) continue;
      if (aEmail && p.user.email === aEmail) continue;
      chips.push({ user: p.user as CardModalUserLite, isAssignee: false });
    }
    return chips;
  }, [participants, assignee, props.allUsers]);

  const userById = useMemo(() => new Map(props.allUsers.map((u) => [u.id, u])), [props.allUsers]);

  const authorDisplay = useMemo(() => {
    const a = card?.author;
    if (!a) return null;
    return userById.get(a.id) ?? a;
  }, [card, userById]);

  const cardParamRowClass =
    "flex min-w-0 flex-wrap items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-[11px] leading-snug";

  /** Ширина колонки со сплиттером и кнопками «свернуть» (px), совпадает с Tailwind `w-5`. */
  const CARD_SPLITTER_COL_PX = 20;
  const CARD_MIN_LEFT_PX = 160;
  const CARD_MIN_RIGHT_PX = 200;

  const collapseLeftPane = () => {
    if (rightPaneCollapsed) setRightPaneCollapsed(false);
    setLeftPaneCollapsed(true);
  };
  const collapseRightPane = () => {
    if (leftPaneCollapsed) setLeftPaneCollapsed(false);
    setRightPaneCollapsed(true);
  };

  useEffect(() => {
    if (!card) return;
    setTitle(card.description ?? "");
    setDetails(card.details ?? "");
    setAssignee(card.assignee ?? "");
    const authorEmail = (card.author?.email ?? "").trim();
    setCustomer((card.customer ?? "").trim() || authorEmail);
    setDueDate(toDateTimeLocalValue(card.dueDate));
    setImportance(card.importance);
    setPaused(card.paused);
    setParticipants((card.participants as any) ?? []);
    setParticipantAddOpen(false);
    setParticipantAddUserId("");
    setParticipantAddSearch("");
    setParticipantError(null);
    setCustomerSelectOpen(false);
    setParticipantMenuUserId(null);
    setSaveError(null);
    setDeleting(false);
    setCommentBody("");
    commentCaretRef.current = 0;
    setCommentMentionOpen(false);
    setCommentMentionQuery("");
    setCommentMentionStart(null);
    setCommentCardLinkOpen(false);
    setCommentCardLinkQuery("");
    setCommentCardLinkResults([]);
    setEditingCommentId(null);
    setEditingCommentBody("");
    editingCommentCaretRef.current = 0;
    setEditingCommentMentionOpen(false);
    setEditingCommentMentionQuery("");
    setEditingCommentMentionStart(null);
    setEditingCommentCardLinkOpen(false);
    setEditingCommentCardLinkQuery("");
    setEditingCommentCardLinkResults([]);
    resetDetailsTools();
    detailsCaretRef.current = (card.details ?? "").length;
    setDetailsEditing(false);
    setHeaderActionsOpen(false);
    setPanelFullscreen(false);
    setLeftPaneCollapsed(false);
    setRightPaneCollapsed(false);

    // restore per-user sizes
    try {
      const raw = localStorage.getItem(`ioterra.cardModal.size.${props.viewer.id}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { w?: number; h?: number; rightW?: number };
        const nextW = typeof parsed.w === "number" ? parsed.w : panelSize.w;
        const nextH = typeof parsed.h === "number" ? parsed.h : panelSize.h;
        const nextRightW = typeof parsed.rightW === "number" ? parsed.rightW : rightWidth;
        setPanelSize({ w: clamp(nextW, 720, 1600), h: clamp(nextH, 520, 900) });
        const layoutGuess =
          typeof window !== "undefined" ? Math.max(480, window.innerWidth - 48) : Math.max(480, nextW);
        const maxRight = Math.max(CARD_MIN_RIGHT_PX, layoutGuess - CARD_MIN_LEFT_PX - CARD_SPLITTER_COL_PX);
        setRightWidth(clamp(nextRightW, CARD_MIN_RIGHT_PX, maxRight));
        setPanelHasCustomSize(true);
      }
    } catch {
      // ignore
    }
    lastLoadedIdRef.current = card.id;
  }, [card?.id]);

  useEffect(() => {
    if (!detailsEditing) return;
    const id = window.requestAnimationFrame(() => {
      detailsTextareaRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [detailsEditing]);

  useEffect(() => {
    if (!editingCommentId) return;
    const id = window.requestAnimationFrame(() => {
      editingCommentTextareaRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [editingCommentId]);

  useEffect(() => {
    if (!card) return;
    setFavorite(!!card.isFavorite);
  }, [card?.id, card?.isFavorite]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setIsLg(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!isLg) {
      setLeftPaneCollapsed(false);
      setRightPaneCollapsed(false);
    }
  }, [isLg]);

  useEffect(() => {
    if (!customerSelectOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (customerSelectRef.current && !customerSelectRef.current.contains(e.target as Node)) {
        setCustomerSelectOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [customerSelectOpen]);

  useEffect(() => {
    if (!participantAddOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (participantAddRef.current && !participantAddRef.current.contains(e.target as Node)) {
        setParticipantAddOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [participantAddOpen]);

  useEffect(() => {
    if (!participantMenuUserId) return;
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest?.("[data-participant-chip-menu]")) return;
      setParticipantMenuUserId(null);
    };
    document.addEventListener("mousedown", close, true);
    return () => document.removeEventListener("mousedown", close, true);
  }, [participantMenuUserId]);

  useEffect(() => {
    if (!headerActionsOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (headerActionsRef.current && !headerActionsRef.current.contains(e.target as Node)) setHeaderActionsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHeaderActionsOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [headerActionsOpen]);

  useEffect(() => {
    if (!commentMentionOpen && !commentCardLinkOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (commentComposerRef.current && !commentComposerRef.current.contains(e.target as Node)) {
        setCommentMentionOpen(false);
        setCommentCardLinkOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [commentMentionOpen, commentCardLinkOpen]);

  useEffect(() => {
    if (!commentCardLinkOpen) return;
    const q = commentCardLinkQuery.trim();
    if (!q) {
      setCommentCardLinkResults([]);
      setCommentCardLinkSearching(false);
      return;
    }
    setCommentCardLinkSearching(true);
    const t = window.setTimeout(() => {
      Api.searchCards(q)
        .then((r) => setCommentCardLinkResults(r.cards))
        .catch(() => setCommentCardLinkResults([]))
        .finally(() => setCommentCardLinkSearching(false));
    }, 250);
    return () => window.clearTimeout(t);
  }, [commentCardLinkOpen, commentCardLinkQuery]);

  useEffect(() => {
    if (!editingCommentMentionOpen && !editingCommentCardLinkOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (editingCommentComposerRef.current && !editingCommentComposerRef.current.contains(e.target as Node)) {
        setEditingCommentMentionOpen(false);
        setEditingCommentCardLinkOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [editingCommentMentionOpen, editingCommentCardLinkOpen]);

  useEffect(() => {
    if (!detailsCardLinkOpen) return;
    const q = detailsCardLinkQuery.trim();
    if (!q) {
      setDetailsCardLinkResults([]);
      setDetailsCardLinkSearching(false);
      return;
    }
    setDetailsCardLinkSearching(true);
    const t = window.setTimeout(() => {
      Api.searchCards(q)
        .then((r) => setDetailsCardLinkResults(r.cards))
        .catch(() => setDetailsCardLinkResults([]))
        .finally(() => setDetailsCardLinkSearching(false));
    }, 250);
    return () => window.clearTimeout(t);
  }, [detailsCardLinkOpen, detailsCardLinkQuery]);

  useEffect(() => {
    if (!detailsMentionOpen && !detailsCardLinkOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (detailsComposerRef.current && !detailsComposerRef.current.contains(e.target as Node)) {
        resetDetailsTools();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [detailsMentionOpen, detailsCardLinkOpen]);

  useEffect(() => {
    if (!editingCommentCardLinkOpen) return;
    const q = editingCommentCardLinkQuery.trim();
    if (!q) {
      setEditingCommentCardLinkResults([]);
      setEditingCommentCardLinkSearching(false);
      return;
    }
    setEditingCommentCardLinkSearching(true);
    const t = window.setTimeout(() => {
      Api.searchCards(q)
        .then((r) => setEditingCommentCardLinkResults(r.cards))
        .catch(() => setEditingCommentCardLinkResults([]))
        .finally(() => setEditingCommentCardLinkSearching(false));
    }, 250);
    return () => window.clearTimeout(t);
  }, [editingCommentCardLinkOpen, editingCommentCardLinkQuery]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const st = dragStateRef.current;
      if (!st) return;
      const delta = e.clientX - st.startX;
      const next = Math.round(st.startW - delta);
      const el = cardLayoutRef.current;
      const layoutW =
        el?.clientWidth ??
        (typeof window !== "undefined"
          ? Math.min(panelSize.w, window.innerWidth - 32)
          : panelSize.w);
      const maxRight = Math.max(CARD_MIN_RIGHT_PX, layoutW - CARD_MIN_LEFT_PX - CARD_SPLITTER_COL_PX);
      setRightWidth(clamp(next, CARD_MIN_RIGHT_PX, maxRight));
    };
    const onUp = () => {
      setDragging(false);
      dragStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(
          `ioterra.cardModal.size.${props.viewer.id}`,
          JSON.stringify({ w: panelSize.w, h: panelSize.h, rightW: rightWidth }),
        );
      } catch {
        // ignore
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, panelSize.h, panelSize.w, props.viewer.id, rightWidth]);

  useEffect(() => {
    if (!isLg) return;
    if (leftPaneCollapsed || rightPaneCollapsed) return;
    const el = cardLayoutRef.current;
    if (!el) return;
    const apply = () => {
      const w = el.clientWidth;
      if (w < 120) return;
      const maxR = Math.max(CARD_MIN_RIGHT_PX, w - CARD_MIN_LEFT_PX - CARD_SPLITTER_COL_PX);
      setRightWidth((rw) => clamp(rw, CARD_MIN_RIGHT_PX, maxR));
    };
    apply();
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    return () => ro.disconnect();
  }, [isLg, leftPaneCollapsed, rightPaneCollapsed, card?.id, panelFullscreen, panelSize.w]);

  useEffect(() => {
    if (!panelResizing) return;
    const onMove = (e: MouseEvent) => {
      const st = panelResizeRef.current;
      if (!st) return;
      const dw = e.clientX - st.startX;
      const dh = e.clientY - st.startY;
      setPanelSize({
        w: clamp(Math.round(st.startW + dw), 720, 1600),
        h: clamp(Math.round(st.startH + dh), 520, 900),
      });
    };
    const onUp = () => {
      setPanelResizing(false);
      panelResizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setPanelHasCustomSize(true);
      try {
        localStorage.setItem(
          `ioterra.cardModal.size.${props.viewer.id}`,
          JSON.stringify({ w: panelSize.w, h: panelSize.h, rightW: rightWidth }),
        );
      } catch {
        // ignore
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [panelResizing, panelSize.w, panelSize.h, props.viewer.id, rightWidth]);

  const persist = async (
    override?: Partial<{
      description: string;
      details: string | null;
      assignee: string | null;
      customer: string | null;
      dueDate: string | null;
      importance: Importance;
      paused: boolean;
    }>,
  ): Promise<boolean> => {
    if (!card) return false;
    if (!canEditCard) return true;
    if (deleting) return true;
    if (persistInFlightRef.current) return await persistInFlightRef.current;
    setSaveError(null);

    const p = (async () => {
      try {
        const dueDateIso = (() => {
          const raw = override?.dueDate !== undefined ? override.dueDate : dueDate;
          if (!raw) return null;
          const d = new Date(raw);
          if (Number.isNaN(d.getTime())) throw new Error("Неверный формат даты/времени.");
          return d.toISOString();
        })();

        await Api.updateCard(card.id, {
          description: override?.description ?? (title.trim() || "Без названия"),
          details: override?.details ?? (details.trim() ? details.trim() : null),
          ...(canManageCard ? { assignee: override?.assignee ?? (assignee.trim() ? assignee.trim() : null) } : {}),
          ...(canManageCard
            ? {
                customer: (() => {
                  const raw = override?.customer !== undefined ? override.customer : customer;
                  if (raw == null || String(raw).trim() === "") return null;
                  return String(raw).trim();
                })(),
              }
            : {}),
          dueDate: dueDateIso,
          importance: override?.importance ?? importance,
          paused: override?.paused ?? paused,
        });
        return true;
      } catch (e) {
        setSaveError((e as Error).message);
        return false;
      } finally {
        persistInFlightRef.current = null;
      }
    })();

    persistInFlightRef.current = p;
    return await p;
  };

  /** Как у комментария: повторное нажатие «карандаш» сохраняет и выходит из режима правки. */
  const toggleDetailsEditing = () => {
    if (!canEditCard || !card) return;
    if (!detailsEditing) {
      resetDetailsTools();
      detailsCaretRef.current = details.length;
      setDetailsEditing(true);
      return;
    }
    void persist().then((ok) => {
      if (ok) {
        resetDetailsTools();
        setDetailsEditing(false);
      }
    });
  };

  const applyAssigneeEmail = (email: string) => {
    if (!canManageCard) return;
    setAssignee(email);
    setParticipantMenuUserId(null);
    void persist({ assignee: email.trim() ? email.trim() : null });
  };

  const closeAndRefresh = async () => {
    if (deleting) {
      props.onClose();
      return;
    }
    const ok = await persist();
    if (!ok) return; // keep modal open so user sees "Не сохранено"
    await props.onChanged(); // refresh board + card data in parent
    props.onClose();
  };

  const updateDetailsDraft = (next: string, cursor: number) => {
    const c = Math.max(0, Math.min(cursor, next.length));
    detailsCaretRef.current = c;
    setDetails(next);
    const beforeCursor = next.slice(0, c);
    const mentionMatch = beforeCursor.match(/(^|\s)@([^\s@]*)$/);
    if (!mentionMatch) {
      setDetailsMentionOpen(false);
      setDetailsMentionQuery("");
      setDetailsMentionStart(null);
      return;
    }
    setDetailsCardLinkOpen(false);
    setDetailsMentionOpen(true);
    setDetailsMentionQuery(mentionMatch[2] ?? "");
    setDetailsMentionStart(c - (mentionMatch[2]?.length ?? 0) - 1);
  };

  const insertAttachmentMarkdownIntoDetails = (markdown: string) => {
    const textarea = detailsTextareaRef.current;
    const body = details;
    const caret = detailsCaretRef.current;
    const start = Math.max(0, Math.min(caret, body.length));
    const next = body.slice(0, start) + markdown + body.slice(start);
    const cursor = start + markdown.length;
    updateDetailsDraft(next, cursor);
    window.setTimeout(() => {
      textarea?.focus();
      textarea?.setSelectionRange(cursor, cursor);
    }, 0);
  };

  const insertAttachmentMarkdownIntoComment = (mode: "new" | "edit", markdown: string) => {
    const textarea = mode === "edit" ? editingCommentTextareaRef.current : commentTextareaRef.current;
    const body = mode === "edit" ? editingCommentBody : commentBody;
    const caret = mode === "edit" ? editingCommentCaretRef.current : commentCaretRef.current;
    const start = Math.max(0, Math.min(caret, body.length));
    const end = start;
    const next = body.slice(0, start) + markdown + body.slice(end);
    const cursor = start + markdown.length;
    updateCommentDraft(next, cursor, mode);
    window.setTimeout(() => {
      textarea?.focus();
      textarea?.setSelectionRange(cursor, cursor);
    }, 0);
  };

  const onAttachmentFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !card) return;
    const t = uploadTargetRef.current;
    if (t.kind === "card") {
      setUploadSelectedName(f.name);
      void Api.uploadAttachment(card.id, f)
        .then(() => {
          setUploadSelectedName("");
          return props.onChanged();
        })
        .catch((err) => {
          setUploadSelectedName("");
          setSaveError((err as Error).message);
        });
      return;
    }
    setUploadSelectedName(f.name);
    setSaveError(null);
    void Api.uploadAttachment(card.id, f, t.kind === "editComment" ? { commentId: t.commentId } : undefined)
      .then((res) => {
        const att = res.attachment as { id: string; filename: string; mimeType: string };
        const md = markdownForUploadedAttachment(att);
        if (t.kind === "editComment") insertAttachmentMarkdownIntoComment("edit", md);
        else if (t.kind === "details") insertAttachmentMarkdownIntoDetails(md);
        else insertAttachmentMarkdownIntoComment("new", md);
        setUploadSelectedName("");
        return props.onChanged();
      })
      .catch((err) => {
        setUploadSelectedName("");
        setSaveError((err as Error).message);
      });
  };

  const updateCommentDraft = (next: string, cursor: number, mode: "new" | "edit" = "new") => {
    const c = Math.max(0, Math.min(cursor, next.length));
    if (mode === "edit") {
      editingCommentCaretRef.current = c;
      setEditingCommentBody(next);
    } else {
      commentCaretRef.current = c;
      setCommentBody(next);
    }
    const beforeCursor = next.slice(0, cursor);
    const mentionMatch = beforeCursor.match(/(^|\s)@([^\s@]*)$/);
    if (!mentionMatch) {
      if (mode === "edit") {
        setEditingCommentMentionOpen(false);
        setEditingCommentMentionQuery("");
        setEditingCommentMentionStart(null);
      } else {
        setCommentMentionOpen(false);
        setCommentMentionQuery("");
        setCommentMentionStart(null);
      }
      return;
    }
    if (mode === "edit") {
      setEditingCommentCardLinkOpen(false);
      setEditingCommentMentionOpen(true);
      setEditingCommentMentionQuery(mentionMatch[2] ?? "");
      setEditingCommentMentionStart(cursor - (mentionMatch[2]?.length ?? 0) - 1);
    } else {
      setCommentCardLinkOpen(false);
      setCommentMentionOpen(true);
      setCommentMentionQuery(mentionMatch[2] ?? "");
      setCommentMentionStart(cursor - (mentionMatch[2]?.length ?? 0) - 1);
    }
  };

  const insertCommentMention = (user: Pick<User, "id" | "email" | "name" | "avatarPreset" | "avatarUploadName">, mode: "new" | "edit" = "new") => {
    const textarea = mode === "edit" ? editingCommentTextareaRef.current : commentTextareaRef.current;
    const body = mode === "edit" ? editingCommentBody : commentBody;
    const query = mode === "edit" ? editingCommentMentionQuery : commentMentionQuery;
    const mentionStart = mode === "edit" ? editingCommentMentionStart : commentMentionStart;
    const caret = mode === "edit" ? editingCommentCaretRef.current : commentCaretRef.current;
    const cursor = Math.max(0, Math.min(caret, body.length));
    const start = mentionStart ?? Math.max(0, cursor - query.length - 1);
    const label = user.name || user.email;
    const next = `${body.slice(0, start)}@${label} ${body.slice(cursor)}`;
    if (mode === "edit") {
      updateCommentDraft(next, start + label.length + 2, "edit");
      setEditingCommentMentionOpen(false);
      setEditingCommentMentionQuery("");
      setEditingCommentMentionStart(null);
    } else {
      updateCommentDraft(next, start + label.length + 2);
      setCommentMentionOpen(false);
      setCommentMentionQuery("");
      setCommentMentionStart(null);
    }
    window.setTimeout(() => {
      const pos = start + label.length + 2;
      textarea?.focus();
      textarea?.setSelectionRange(pos, pos);
    }, 0);
  };

  const insertDetailsMention = (user: Pick<User, "id" | "email" | "name" | "avatarPreset" | "avatarUploadName">) => {
    const textarea = detailsTextareaRef.current;
    const body = details;
    const query = detailsMentionQuery;
    const mentionStart = detailsMentionStart;
    const caret = detailsCaretRef.current;
    const cursor = Math.max(0, Math.min(caret, body.length));
    const start = mentionStart ?? Math.max(0, cursor - query.length - 1);
    const label = user.name || user.email;
    const next = `${body.slice(0, start)}@${label} ${body.slice(cursor)}`;
    updateDetailsDraft(next, start + label.length + 2);
    resetDetailsTools();
    window.setTimeout(() => {
      const pos = start + label.length + 2;
      textarea?.focus();
      textarea?.setSelectionRange(pos, pos);
    }, 0);
  };

  const insertCardLink = (hit: CardSearchHit, mode: "new" | "edit" | "details" = "new") => {
    if (!props.boardId) return;
    if (mode === "details") {
      const textarea = detailsTextareaRef.current;
      const body = details;
      const caret = detailsCaretRef.current;
      const cursor = Math.max(0, Math.min(caret, body.length));
      const link = getCardShareLink(props.boardId, hit.id);
      const insertion = `${hit.description}: ${link}`;
      const prefix = body.slice(0, cursor);
      const suffix = body.slice(cursor);
      const needsLeadingSpace = prefix.length > 0 && !/\s$/.test(prefix);
      const needsTrailingSpace = suffix.length > 0 && !/^\s/.test(suffix);
      const next = `${prefix}${needsLeadingSpace ? " " : ""}${insertion}${needsTrailingSpace ? " " : ""}${suffix}`;
      const pos = prefix.length + (needsLeadingSpace ? 1 : 0) + insertion.length + (needsTrailingSpace ? 1 : 0);
      updateDetailsDraft(next, pos);
      setDetailsCardLinkOpen(false);
      setDetailsCardLinkQuery("");
      setDetailsCardLinkResults([]);
      window.setTimeout(() => {
        textarea?.focus();
        textarea?.setSelectionRange(pos, pos);
      }, 0);
      return;
    }
    const textarea = mode === "edit" ? editingCommentTextareaRef.current : commentTextareaRef.current;
    const body = mode === "edit" ? editingCommentBody : commentBody;
    const caret = mode === "edit" ? editingCommentCaretRef.current : commentCaretRef.current;
    const cursor = Math.max(0, Math.min(caret, body.length));
    const link = getCardShareLink(props.boardId, hit.id);
    const insertion = `${hit.description}: ${link}`;
    const prefix = body.slice(0, cursor);
    const suffix = body.slice(cursor);
    const needsLeadingSpace = prefix.length > 0 && !/\s$/.test(prefix);
    const needsTrailingSpace = suffix.length > 0 && !/^\s/.test(suffix);
    const next = `${prefix}${needsLeadingSpace ? " " : ""}${insertion}${needsTrailingSpace ? " " : ""}${suffix}`;
    const pos = prefix.length + (needsLeadingSpace ? 1 : 0) + insertion.length + (needsTrailingSpace ? 1 : 0);
    if (mode === "edit") {
      updateCommentDraft(next, pos, "edit");
      setEditingCommentCardLinkOpen(false);
      setEditingCommentCardLinkQuery("");
      setEditingCommentCardLinkResults([]);
    } else {
      updateCommentDraft(next, pos);
      setCommentCardLinkOpen(false);
      setCommentCardLinkQuery("");
      setCommentCardLinkResults([]);
    }
    window.setTimeout(() => {
      textarea?.focus();
      textarea?.setSelectionRange(pos, pos);
    }, 0);
  };

  const submitComment = () => {
    if (!card) return;
    const body = commentBody.trim();
    if (!body) return;
    const attachmentIds = extractAttachmentIdsFromMarkdown(commentBody);
    void Api.addComment(card.id, {
      body,
      ...(attachmentIds.length ? { attachmentIds } : {}),
    })
      .then(() => {
        setCommentBody("");
        commentCaretRef.current = 0;
        setCommentMentionOpen(false);
        setCommentCardLinkOpen(false);
        return props.onChanged();
      })
      .catch((err) => setSaveError((err as Error).message));
  };

  const resetEditingCommentTools = () => {
    setEditingCommentMentionOpen(false);
    setEditingCommentMentionQuery("");
    setEditingCommentMentionStart(null);
    setEditingCommentCardLinkOpen(false);
    setEditingCommentCardLinkQuery("");
    setEditingCommentCardLinkResults([]);
  };

  const resetEditingComment = () => {
    setEditingCommentId(null);
    setEditingCommentBody("");
    editingCommentCaretRef.current = 0;
    resetEditingCommentTools();
  };

  /** Сохранить непустой черновик и выйти; пустой — выйти без запроса. Возвращает false при ошибке API. */
  const saveEditingCommentIfDirty = async (commentId: string): Promise<boolean> => {
    const body = editingCommentBody.trim();
    if (!body) {
      resetEditingComment();
      return true;
    }
    try {
      setSaveError(null);
      await Api.updateComment(commentId, { body });
      resetEditingComment();
      await props.onChanged();
      return true;
    } catch (e) {
      setSaveError((e as Error).message);
      return false;
    }
  };

  const openOrToggleCommentEditor = (c: CardComment) => {
    if (editingCommentId === c.id) {
      void saveEditingCommentIfDirty(c.id);
      return;
    }
    if (editingCommentId && editingCommentId !== c.id) {
      void saveEditingCommentIfDirty(editingCommentId).then((ok) => {
        if (!ok) return;
        setEditingCommentId(c.id);
        setEditingCommentBody(c.body ?? "");
        editingCommentCaretRef.current = (c.body ?? "").length;
        resetEditingCommentTools();
      });
      return;
    }
    setEditingCommentId(c.id);
    setEditingCommentBody(c.body ?? "");
    editingCommentCaretRef.current = (c.body ?? "").length;
    resetEditingCommentTools();
  };

  const commentMentionUsers = props.allUsers.filter((u) => {
    const q = commentMentionQuery.trim().toLowerCase();
    if (!q) return true;
    return (u.name ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
  });

  const editingCommentMentionUsers = props.allUsers.filter((u) => {
    const q = editingCommentMentionQuery.trim().toLowerCase();
    if (!q) return true;
    return (u.name ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
  });

  const detailsMentionUsers = props.allUsers.filter((u) => {
    const q = detailsMentionQuery.trim().toLowerCase();
    if (!q) return true;
    return (u.name ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
  });

  const cardModalIconAdd =
    "grid place-items-center rounded-lg border-2 border-teal-300/80 bg-white text-slate-700 shadow-sm transition-colors hover:bg-teal-50/70 hover:text-[#246c7c] hover:border-teal-500";
  const cardModalIconAddEmphasis =
    "grid place-items-center rounded-xl border-2 border-[#246c7c]/55 bg-white text-[#246c7c] shadow-sm transition-colors hover:bg-teal-50/80 hover:border-[#246c7c] disabled:pointer-events-none disabled:opacity-50";
  const cardModalIconDanger =
    "grid place-items-center rounded-lg border-2 border-rose-300 bg-white text-rose-600 shadow-sm transition-colors hover:bg-rose-50 hover:border-rose-400";

  if (!props.open) return null;

  if (!card) {
    return (
      <Modal open={true} title="Загрузка…" onClose={props.onClose}>
        <div className="text-sm text-slate-700">Загрузка…</div>
      </Modal>
    );
  }

  return (
    <Modal
      open={props.open}
      onClose={() => {
        if (deleting) {
          props.onClose();
          return;
        }
        void closeAndRefresh();
      }}
      showCloseButton={false}
      fillViewport={panelFullscreen}
      bodyClassName="flex min-h-0 flex-col overflow-x-hidden overflow-y-hidden"
      headerClassName="bg-gradient-to-b from-slate-100 to-slate-50"
      panelClassName={classNames("max-w-none", panelFullscreen && "rounded-none border border-slate-200")}
      panelStyle={
        panelFullscreen
          ? { width: "100%", height: "100%", maxHeight: "100%" }
          : {
              width: Math.min(panelSize.w, window.innerWidth - 32),
              height: Math.min(panelSize.h, window.innerHeight - 32),
            }
      }
      panelOverlay={
        panelFullscreen ? null : (
          <div
            className="absolute bottom-1 right-1 h-5 w-5 cursor-se-resize select-none"
            title="Изменить размер"
            onMouseDown={(e) => {
              panelResizeRef.current = { startX: e.clientX, startY: e.clientY, startW: panelSize.w, startH: panelSize.h };
              setPanelResizing(true);
              setPanelHasCustomSize(true);
              document.body.style.cursor = "se-resize";
              document.body.style.userSelect = "none";
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <div className="absolute inset-0">
              <div className="absolute bottom-0 right-0 h-[10px] w-[10px] border-b-2 border-r-2 border-slate-300" />
              <div className="absolute bottom-1 right-1 h-[8px] w-[8px] border-b-2 border-r-2 border-slate-200" />
            </div>
          </div>
        )
      }
      headerLeft={
        <div className="flex min-w-0 items-center gap-3">
          <img
            src="/ioterra.svg"
            alt=""
            className="h-9 w-9 shrink-0"
            width={36}
            height={36}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <input
              className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-semibold text-slate-900 outline-none focus:border-slate-200 focus:bg-white read-only:cursor-default read-only:focus:border-transparent read-only:focus:bg-transparent"
              value={title}
              readOnly={!canEditCard}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void persist()}
              placeholder="Название карточки"
            />
            {saveError ? <div className="mt-2 text-xs text-rose-700">{saveError}</div> : null}
          </div>
        </div>
      }
      headerRight={
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={classNames(
              "rounded-md p-1 transition-colors",
              favorite
                ? "bg-amber-100 text-amber-600 ring-1 ring-amber-300/80 hover:bg-amber-200/90"
                : "text-amber-500 hover:bg-amber-50 hover:text-amber-600",
            )}
            title={favorite ? "Убрать из избранного" : "В избранное"}
            aria-label={favorite ? "Убрать из избранного" : "В избранное"}
            onClick={() => {
              if (!card) return;
              setSaveError(null);
              const next = !favorite;
              setFavorite(next);
              void (next ? Api.addFavorite(card.id) : Api.removeFavorite(card.id))
                .then(() => props.onChanged())
                .catch((e) => {
                  setFavorite(!next);
                  setSaveError((e as Error).message);
                });
            }}
          >
            {favorite ? <IconStarFilled className="h-3.5 w-3.5" /> : <IconStarOutline className="h-3.5 w-3.5" />}
          </button>
          {(props.boardId && props.onShareLink) || canEditCard ? (
            <div className="relative" ref={headerActionsRef}>
              <button
                type="button"
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                title="Действия"
                aria-label="Действия"
                aria-expanded={headerActionsOpen}
                onClick={() => setHeaderActionsOpen((v) => !v)}
              >
                <IconMoreVertical className="h-5 w-5" />
              </button>
              {headerActionsOpen ? (
                <div className="absolute right-0 top-full z-30 mt-1 min-w-[2.5rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  {props.boardId && props.onShareLink ? (
                    <button
                      type="button"
                      className="flex w-full items-center justify-center px-3 py-2 text-slate-700 hover:bg-slate-50"
                      title="Поделиться"
                      aria-label="Поделиться"
                      onClick={() => {
                        setHeaderActionsOpen(false);
                        const link = getCardShareLink(props.boardId!, card.id);
                        navigator.clipboard.writeText(link).then(
                          () => props.onShareLink?.(card.description ?? "", link),
                          () => props.onShareLink?.(card.description ?? "", link),
                        );
                      }}
                    >
                      <IconShare className="h-4 w-4 shrink-0" />
                    </button>
                  ) : null}
                  {canEditCard ? (
                    <button
                      type="button"
                      className="flex w-full items-center justify-center px-3 py-2 text-slate-700 hover:bg-slate-50"
                      title="В архив"
                      aria-label="В архив"
                      onClick={() => {
                        setHeaderActionsOpen(false);
                        void Api.archiveCard(card.id)
                          .then(async () => {
                            await props.onDeleted();
                            props.onClose();
                          })
                          .catch((e) => setSaveError((e as Error).message));
                      }}
                    >
                      <IconArchive className="h-4 w-4 shrink-0" />
                    </button>
                  ) : null}
                  {canEditCard ? (
                    <button
                      type="button"
                      className="flex w-full items-center justify-center border-t border-slate-100 px-3 py-2 text-rose-700 hover:bg-rose-50"
                      title="Удалить карточку"
                      aria-label="Удалить карточку"
                      onClick={() => {
                        setHeaderActionsOpen(false);
                        if (
                          !confirm(
                            "Вы точно хотите удалить эту карточку? Это действие нельзя отменить.",
                          )
                        )
                          return;
                        setSaveError(null);
                        setDeleting(true);
                        void Api.deleteCard(card.id)
                          .then(async () => {
                            await props.onDeleted();
                            props.onClose();
                          })
                          .catch((e) => {
                            setDeleting(false);
                            setSaveError((e as Error).message);
                          });
                      }}
                    >
                      <IconTrash className="h-4 w-4 shrink-0 text-rose-600" />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <IconButton
            size="compact"
            title={panelFullscreen ? "Обычный размер окна" : "На весь экран"}
            aria-label={panelFullscreen ? "Обычный размер окна" : "На весь экран"}
            onClick={() => setPanelFullscreen((v) => !v)}
          >
            {panelFullscreen ? <IconShrinkPanel className="h-3.5 w-3.5" /> : <IconExpandPanel className="h-3.5 w-3.5" />}
          </IconButton>
          <IconButton
            size="compact"
            title="Закрыть"
            onClick={() => {
              if (deleting) {
                props.onClose();
                return;
              }
              void closeAndRefresh();
            }}
          >
            <IconX className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      }
    >
      <div
        ref={cardLayoutRef}
        className={classNames(
          "flex min-h-0 w-full flex-1 flex-col",
          isLg ? "lg:flex-row lg:items-stretch lg:gap-0" : "gap-4",
        )}
      >
        {canEditCard ? (
          <input ref={uploadInputRef} type="file" className="sr-only" onChange={onAttachmentFileInputChange} aria-hidden />
        ) : null}
        {(!isLg || !leftPaneCollapsed) ? (
        <div
          className={classNames(
            "flex min-h-0 min-w-0 max-w-full flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto pr-0 lg:overflow-y-auto",
            isLg && "lg:min-w-0 lg:basis-0 lg:pr-1",
            isLg && !rightPaneCollapsed && !leftPaneCollapsed && "lg:flex-1",
            isLg && rightPaneCollapsed && "lg:flex-1",
          )}
        >
          <div className="shrink-0 rounded-2xl border border-slate-200 bg-white p-2">
            <div className="mb-1.5 text-sm font-semibold text-slate-900">Параметры</div>
            <div className="grid gap-[2px]">
              <div className={cardParamRowClass}>
                <span className="shrink-0 text-slate-600">Автор:</span>
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  {authorDisplay ? (
                    <AvatarImg user={authorDisplay} size={18} />
                  ) : (
                    <div className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border border-slate-200 bg-slate-200 text-[9px] font-medium text-slate-500">
                      ?
                    </div>
                  )}
                  <span className="min-w-0 truncate font-medium text-slate-800">
                    {authorDisplay ? authorDisplay.name || authorDisplay.email : "Не указано"}
                  </span>
                  <span className="shrink-0 text-slate-500">{format(new Date(card.createdAt), "yyyy-MM-dd HH:mm")}</span>
                </div>
              </div>
              <CardModalUserEmailField
                label="Заказчик"
                compact
                valueEmail={customer}
                onPick={setCustomer}
                isOpen={customerSelectOpen}
                setIsOpen={setCustomerSelectOpen}
                onBeforeOpen={() => {}}
                users={props.allUsers}
                canManage={canManageCard}
                containerRef={customerSelectRef}
                onPersist={() => void persist()}
              />
              <div className={cardParamRowClass}>
                <span className="shrink-0 text-slate-600">Пауза:</span>
                <div className="min-w-0 flex-1">
                  {canEditCard ? (
                    <button
                      type="button"
                      className={classNames(
                        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-snug",
                        paused ? "bg-amber-200 text-amber-950" : "border border-amber-200 bg-white text-amber-900 hover:bg-amber-50",
                      )}
                      title={paused ? "Снять паузу" : "Пауза"}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={() => {
                        const next = !paused;
                        setPaused(next);
                        setSaveError(null);
                        void persist({ paused: next });
                      }}
                    >
                      <span
                        className={classNames(
                          "grid h-3 w-3 place-items-center rounded border text-[9px]",
                          paused ? "border-amber-400 bg-amber-100" : "border-amber-200 bg-white",
                        )}
                        aria-hidden
                      >
                        {paused ? "✓" : ""}
                      </span>
                      {paused ? "На паузе" : "Нет"}
                    </button>
                  ) : (
                    <span className="text-slate-800">{paused ? "Да" : "Нет"}</span>
                  )}
                </div>
              </div>
              <div className={cardParamRowClass}>
                <span className="shrink-0 text-slate-600">Колонка:</span>
                <div className="min-w-0 flex-1">
                  {canEditCard ? (
                    <select
                      className="w-full max-w-full rounded border-0 bg-transparent py-0 text-[11px] font-medium text-slate-800 outline-none focus:ring-1 focus:ring-slate-300"
                      value={card.column.id}
                      onChange={(e) => {
                        const toColumnId = e.target.value;
                        if (toColumnId === card.column.id) return;
                        setSaveError(null);
                        void Api.moveCard(card.id, { toColumnId, toIndex: 0 })
                          .then(() => void props.onChanged())
                          .catch((err) => setSaveError((err as Error).message));
                      }}
                    >
                      {props.columns.map((col) => (
                        <option key={col.id} value={col.id}>
                          {col.title}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="font-medium text-slate-800">{card.column.title}</span>
                  )}
                </div>
              </div>
              <div className={cardParamRowClass}>
                <span className="shrink-0 text-slate-600">Важность:</span>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                  {canEditCard ? (
                    <>
                      <select
                        className="rounded border-0 bg-transparent py-0 text-[11px] font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-slate-300"
                        value={importance}
                        onChange={(e) => {
                          const next = e.target.value as Importance;
                          setImportance(next);
                          setSaveError(null);
                          void Api.updateCard(card.id, { importance: next }).catch((err) => setSaveError((err as Error).message));
                        }}
                      >
                        <option value="LOW">Низкая</option>
                        <option value="MEDIUM">Средняя</option>
                        <option value="HIGH">Высокая</option>
                      </select>
                      <span
                        className={classNames("h-2.5 w-2.5 shrink-0 rounded-sm border border-slate-200/80", importanceBadge(importance))}
                        title={importanceLabel(importance)}
                        aria-hidden
                      />
                    </>
                  ) : (
                    <span className={classNames("rounded px-1 py-px text-[11px] font-semibold leading-snug", importanceBadge(importance))}>
                      {importanceLabel(importance)}
                    </span>
                  )}
                </div>
              </div>
              <div className={cardParamRowClass}>
                <span className="shrink-0 text-slate-600">Срок исполнения:</span>
                <div className="min-w-0 flex-1">
                  <input
                    type="datetime-local"
                    className="w-full max-w-[14rem] rounded border-0 bg-transparent py-0 text-[11px] text-slate-800 outline-none focus:ring-1 focus:ring-slate-300 read-only:cursor-default disabled:opacity-70"
                    value={dueDate}
                    readOnly={!canEditCard}
                    disabled={!canEditCard}
                    onChange={(e) => setDueDate(e.target.value)}
                    onBlur={() => void persist()}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-col overflow-x-hidden rounded-2xl border border-slate-200 bg-white p-2">
            <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2 pr-0.5">
              <div className="text-sm font-semibold text-slate-900">Описание</div>
              {canEditCard ? (
                <button
                  type="button"
                  className={classNames(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-lg border text-slate-800 transition-colors",
                    detailsEditing
                      ? "border-[#246c7c]/40 bg-[#246c7c]/12 text-[#1a4d58] ring-1 ring-[#246c7c]/25"
                      : "border-slate-200 bg-white hover:bg-slate-50",
                  )}
                  onClick={toggleDetailsEditing}
                  title={detailsEditing ? "Сохранить и закрыть правку" : "Редактировать"}
                  aria-label={detailsEditing ? "Сохранить и закрыть правку" : "Редактировать"}
                  aria-pressed={detailsEditing}
                >
                  <IconEdit className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <div
              className={classNames(
                "overflow-x-hidden",
                detailsEditing ? "pb-1" : "max-h-[min(60vh,28rem)] overflow-y-auto",
              )}
            >
              {canEditCard && detailsEditing ? (
                <div className="relative" ref={detailsComposerRef}>
                  <div className="space-y-1">
                    <MarkdownRichEditor
                      ref={detailsTextareaRef}
                      value={details}
                      onChange={(v, c) => updateDetailsDraft(v, c ?? v.length)}
                      minHeight="100px"
                      ariaLabel="Описание карточки"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/90 px-2 py-1.5">
                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          className="grid h-6 w-6 place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                          title="Добавить файл"
                          aria-label="Добавить файл"
                          onClick={() => {
                            uploadTargetRef.current = { kind: "details" };
                            uploadInputRef.current?.click();
                          }}
                        >
                          <IconPaperclip className="h-3.5 w-3.5" />
                        </button>
                        <div className="relative">
                          <button
                            type="button"
                            className="grid h-6 w-6 place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                            title="Добавить ссылку на карточку"
                            aria-label="Добавить ссылку на карточку"
                            onClick={() => {
                              setDetailsMentionOpen(false);
                              setDetailsCardLinkOpen((v) => !v);
                            }}
                          >
                            <IconLink className="h-3.5 w-3.5" />
                          </button>
                          {detailsCardLinkOpen ? (
                            <div className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                              <div className="border-b border-slate-100 p-2">
                                <input
                                  type="text"
                                  className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-[#246c7c]"
                                  placeholder="Найти карточку..."
                                  value={detailsCardLinkQuery}
                                  onChange={(e) => setDetailsCardLinkQuery(e.target.value)}
                                  autoFocus
                                />
                              </div>
                              <div className="max-h-56 overflow-auto py-1">
                                {detailsCardLinkSearching ? (
                                  <div className="px-3 py-3 text-sm text-slate-500">Ищем...</div>
                                ) : detailsCardLinkQuery.trim() && detailsCardLinkResults.length === 0 ? (
                                  <div className="px-3 py-3 text-sm text-slate-500">Ничего не найдено</div>
                                ) : (
                                  detailsCardLinkResults.map((hit) => (
                                    <button
                                      key={hit.id}
                                      type="button"
                                      className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                                      onClick={() => insertCardLink(hit, "details")}
                                    >
                                      <div className="truncate font-medium text-slate-900">{hit.description}</div>
                                      <div className="mt-0.5 text-xs text-slate-500">{hit.columnTitle}</div>
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="grid h-6 w-6 place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                          title="Упомянуть пользователя"
                          aria-label="Упомянуть пользователя"
                          onClick={() => {
                            const cursor = Math.max(0, Math.min(detailsCaretRef.current, details.length));
                            const prefix = details.slice(0, cursor);
                            const suffix = details.slice(cursor);
                            const needsSpace = prefix.length > 0 && !/\s$/.test(prefix);
                            const next = `${prefix}${needsSpace ? " " : ""}@${suffix}`;
                            const nextCursor = prefix.length + (needsSpace ? 1 : 0) + 1;
                            updateDetailsDraft(next, nextCursor);
                            window.setTimeout(() => {
                              detailsTextareaRef.current?.focus();
                              detailsTextareaRef.current?.setSelectionRange(nextCursor, nextCursor);
                            }, 0);
                          }}
                        >
                          <IconAt className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                  {detailsMentionOpen ? (
                    <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                      {detailsMentionUsers.length === 0 ? (
                        <div className="px-3 py-3 text-sm text-slate-500">Нет пользователей</div>
                      ) : (
                        detailsMentionUsers.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
                            onClick={() => insertDetailsMention(u)}
                          >
                            <AvatarImg user={u} size={24} />
                            <span className="min-w-0 flex-1 truncate">{u.name || u.email}</span>
                            <span className="hidden truncate text-xs text-slate-500 sm:block">{u.email}</span>
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-xl border border-slate-100 bg-slate-50/90 p-2">
                  <MarkdownHtmlBlock source={details} />
                </div>
              )}
            </div>
            {canEditCard && detailsEditing ? (
              <div className="mt-2 flex shrink-0 justify-end border-t border-slate-100 pt-2">
                <button
                  type="button"
                  className="grid h-6 w-6 place-items-center rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                  onClick={() => {
                    setDetails(card.details ?? "");
                    detailsCaretRef.current = (card.details ?? "").length;
                    resetDetailsTools();
                    setDetailsEditing(false);
                  }}
                  title="Отмена"
                  aria-label="Отмена"
                >
                  <IconX className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
          </div>

          <div className="shrink-0 rounded-2xl border border-slate-200 bg-white p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">Участники и ответственный</div>
                {canManageCard ? (
                  <button
                    type="button"
                    className={classNames(cardModalIconAdd, "h-6 w-6")}
                    title="Добавить участника"
                    aria-label="Добавить участника"
                    onClick={() => setParticipantAddOpen((v) => !v)}
                  >
                    <IconPlus className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              {participantAddOpen && canManageCard ? (
                <div className="mt-2 flex flex-col gap-2" ref={participantAddRef}>
                  <div className="flex items-center gap-2">
                    <div className="relative min-w-0 flex-1">
                      <input
                        type="text"
                        className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-3 pr-9 text-sm outline-none focus:border-[#246c7c]"
                        placeholder="Поиск пользователя…"
                        value={participantAddSearch}
                        onChange={(e) => setParticipantAddSearch(e.target.value)}
                        autoFocus
                        aria-label="Поиск пользователя"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden>
                        🔍
                      </span>
                    </div>
                    <button
                      type="button"
                      className={classNames(cardModalIconAddEmphasis, "h-6 w-6 shrink-0")}
                      disabled={!participantAddUserId}
                      title="Добавить участника"
                      aria-label="Добавить участника"
                      onClick={() => {
                        if (!canManageCard) return;
                        if (!card) return;
                        const userId = participantAddUserId;
                        if (!userId) return;
                        setParticipantError(null);
                        void Api.addParticipant(card.id, { userId })
                          .then((d) => {
                            const added = (d as any).participant as {
                              id: string;
                              email: string;
                              name: string;
                              avatarPreset?: string | null;
                              avatarUploadName?: string | null;
                            };
                            setParticipants((prev) =>
                              prev.some((p) => p.user.id === added.id) ? prev : [...prev, { user: added }],
                            );
                            setParticipantAddUserId("");
                            setParticipantAddOpen(false);
                            setParticipantAddSearch("");
                            return props.onChanged();
                          })
                          .catch((err) => setParticipantError((err as Error).message));
                      }}
                    >
                      <IconPlus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="max-h-48 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-sm">
                    {(() => {
                      const q = participantAddSearch.trim().toLowerCase();
                      const available = props.allUsers
                        .filter((u) => !participants.some((p) => p.user.id === u.id))
                        .filter(
                          (u) =>
                            !q ||
                            (u.name ?? "").toLowerCase().includes(q) ||
                            (u.email ?? "").toLowerCase().includes(q),
                        );
                      return available.length === 0 ? (
                        <div className="px-3 py-4 text-center text-sm text-slate-500">Нет пользователей</div>
                      ) : (
                        available.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            role="option"
                            aria-selected={participantAddUserId === u.id}
                            className={classNames(
                              "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50",
                              participantAddUserId === u.id && "bg-slate-100",
                            )}
                            onClick={() => setParticipantAddUserId((prev) => (prev === u.id ? "" : u.id))}
                          >
                            <AvatarImg user={u} size={24} />
                            <span className="min-w-0 flex-1 truncate">{u.name || u.email}</span>
                          </button>
                        ))
                      );
                    })()}
                  </div>
                </div>
              ) : null}
              {participantError ? <div className="mt-2 text-xs text-rose-700">{participantError}</div> : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {participantChips.length === 0 ? (
                  <span className="text-xs text-slate-500">Нет ответственного и участников.</span>
                ) : (
                  participantChips.map(({ user: u, isAssignee }) => {
                    const inParticipants = participants.some((p) => p.user.id === u.id);
                    const menuOpen = participantMenuUserId === u.id;
                    return (
                      <div key={`${u.id}-${isAssignee ? "a" : "p"}`} className="relative">
                        <div
                          className={classNames(
                            "inline-flex max-w-[220px] items-center gap-1 rounded-full border bg-white py-0.5 pl-0.5 pr-1.5 text-xs shadow-sm",
                            isAssignee ? "border-amber-400 ring-1 ring-amber-200" : "border-slate-200",
                          )}
                          title={u.email}
                        >
                          <AvatarImg user={u} size={26} />
                          <span className="min-w-0 truncate font-medium text-slate-800">{u.name || u.email}</span>
                          {isAssignee ? (
                            <span className="shrink-0 rounded bg-amber-100 px-1 py-px text-[9px] font-bold uppercase text-amber-900">
                              Отв.
                            </span>
                          ) : null}
                          {canManageCard ? (
                            <button
                              type="button"
                              className="ml-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                              title="Действия"
                              aria-label="Действия"
                              data-participant-chip-menu
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                setParticipantMenuUserId((prev) => (prev === u.id ? null : u.id));
                              }}
                            >
                              <IconMoreVertical className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                        {menuOpen && canManageCard ? (
                          <div
                            data-participant-chip-menu
                            className="absolute left-0 top-full z-40 mt-1 min-w-[11rem] rounded-lg border border-slate-200 bg-white py-1 text-xs shadow-lg"
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            {u.id !== "legacy-assignee" && !isAssignee ? (
                              <button
                                type="button"
                                className="flex w-full px-3 py-2 text-left hover:bg-slate-50"
                                onClick={() => applyAssigneeEmail(u.email)}
                              >
                                Сделать ответственным
                              </button>
                            ) : null}
                            {isAssignee ? (
                              <button
                                type="button"
                                className="flex w-full px-3 py-2 text-left hover:bg-slate-50"
                                onClick={() => {
                                  setParticipantMenuUserId(null);
                                  applyAssigneeEmail("");
                                }}
                              >
                                Снять ответственного
                              </button>
                            ) : null}
                            {inParticipants ? (
                              <button
                                type="button"
                                className="flex w-full px-3 py-2 text-left text-rose-700 hover:bg-rose-50"
                                onClick={() => {
                                  if (!card) return;
                                  setParticipantMenuUserId(null);
                                  setParticipantError(null);
                                  void Api.removeParticipant(card.id, u.id)
                                    .then(async () => {
                                      setParticipants((prev) => prev.filter((x) => x.user.id !== u.id));
                                      if (assignee.trim() === u.email) {
                                        setAssignee("");
                                        await persist({ assignee: null });
                                      }
                                      await props.onChanged();
                                    })
                                    .catch((er) => setParticipantError((er as Error).message));
                                }}
                              >
                                Удалить из участников
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
          </div>

          <div className="flex min-h-32 shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-2">
            <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">Вложения</div>
              {canEditCard ? (
                <button
                  type="button"
                  className={classNames(cardModalIconAdd, "h-6 w-6")}
                  onClick={() => {
                    uploadTargetRef.current = { kind: "card" };
                    uploadInputRef.current?.click();
                  }}
                  title="Добавить файл"
                  aria-label="Добавить файл"
                >
                  <IconPlus className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            {uploadSelectedName ? (
              <div className="mt-1 shrink-0 truncate text-xs text-slate-500" title={uploadSelectedName}>
                {compactFileName(uploadSelectedName, 70)}
              </div>
            ) : null}
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
              <div className="grid gap-2">
              {card.attachments.length === 0 ? (
                <div className="text-xs text-slate-500">Пока нет файлов.</div>
              ) : (
                card.attachments.map((a) => (
                  <div
                    key={a.id}
                    className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-900" title={a.filename}>
                        {compactFileName(a.filename, 70)}
                      </div>
                      <div className="text-xs text-slate-500">{Math.round(a.size / 1024)} KB</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <a
                        className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                        href={Api.downloadAttachmentUrl(a.id)}
                        target="_blank"
                        rel="noreferrer"
                        title="Скачать"
                        aria-label="Скачать"
                      >
                        <IconDownload />
                      </a>
                      {canEditCard ? (
                        <button
                          type="button"
                          className={classNames(cardModalIconDanger, "h-6 w-6")}
                          onClick={() => void Api.deleteAttachment(a.id).then(props.onChanged)}
                          title="Удалить"
                          aria-label="Удалить"
                        >
                          <IconTrash className="h-3.5 w-3.5 text-rose-600" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
              </div>
            </div>
          </div>
        </div>
        ) : isLg ? (
          <button
            type="button"
            className="flex w-7 shrink-0 flex-col items-center justify-center border-r border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
            title="Показать параметры и описание"
            aria-label="Показать левую панель"
            onClick={() => setLeftPaneCollapsed(false)}
          >
            <IconChevronRight className="h-4 w-4" />
          </button>
        ) : null}

        {isLg && !leftPaneCollapsed && !rightPaneCollapsed ? (
          <div className="relative flex min-h-0 w-5 shrink-0 flex-col items-stretch border-x border-slate-200/80 bg-slate-50/90 py-0.5">
            <button
              type="button"
              className="mx-auto grid h-5 w-5 shrink-0 place-items-center rounded text-slate-500 hover:bg-white hover:text-slate-800"
              title="Свернуть левую колонку"
              aria-label="Свернуть левую колонку"
              onClick={collapseLeftPane}
            >
              <IconChevronLeft className="h-3.5 w-3.5" />
            </button>
            <div
              className="relative mx-auto min-h-[120px] flex-1 cursor-col-resize px-0.5"
              onMouseDown={(e) => {
                dragStateRef.current = { startX: e.clientX, startW: rightWidth };
                setDragging(true);
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <div
                className={classNames(
                  "pointer-events-none absolute inset-y-0.5 left-1/2 w-px -translate-x-1/2 bg-slate-300",
                  dragging && "bg-[#246c7c]/80",
                )}
              />
            </div>
            <button
              type="button"
              className="mx-auto grid h-5 w-5 shrink-0 place-items-center rounded text-slate-500 hover:bg-white hover:text-slate-800"
              title="Свернуть комментарии"
              aria-label="Свернуть комментарии"
              onClick={collapseRightPane}
            >
              <IconChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        {isLg && !leftPaneCollapsed && rightPaneCollapsed ? (
          <button
            type="button"
            className="flex w-7 shrink-0 flex-col items-center justify-center border-l border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
            title="Показать комментарии"
            aria-label="Показать комментарии"
            onClick={() => setRightPaneCollapsed(false)}
          >
            <IconChevronLeft className="h-4 w-4" />
          </button>
        ) : null}

        {(!isLg || !rightPaneCollapsed) ? (
        <div
          className={classNames(
            "flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-2",
            isLg && leftPaneCollapsed && "min-w-0 flex-1",
            isLg && !leftPaneCollapsed && "min-w-0 shrink-0",
            !isLg && "w-full flex-1",
          )}
          style={isLg && !leftPaneCollapsed ? { width: rightWidth } : undefined}
        >
          <div className="mb-1.5 shrink-0 text-sm font-semibold text-slate-900">Комментарии</div>
          {canEditCard ? (
            <div className="mb-2 grid shrink-0 gap-2" ref={commentComposerRef}>
              <div className="relative flex items-start gap-2">
                <AvatarImg user={props.viewer} size={24} />
                <div className="min-w-0 flex-1 space-y-1">
                  <MarkdownRichEditor
                    ref={commentTextareaRef}
                    value={commentBody}
                    onChange={(v, c) => updateCommentDraft(v, c ?? v.length)}
                    minHeight="100px"
                    ariaLabel="Текст комментария"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/90 px-2 py-1.5">
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        className="grid h-6 w-6 place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        title="Добавить файл"
                        aria-label="Добавить файл"
                        onClick={() => {
                          uploadTargetRef.current = { kind: "newComment" };
                          uploadInputRef.current?.click();
                        }}
                      >
                        <IconPaperclip className="h-3.5 w-3.5" />
                      </button>
                      <div className="relative">
                        <button
                          type="button"
                          className="grid h-6 w-6 place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                          title="Добавить ссылку на карточку"
                          aria-label="Добавить ссылку на карточку"
                          onClick={() => {
                            setCommentMentionOpen(false);
                            setCommentCardLinkOpen((v) => !v);
                          }}
                        >
                          <IconLink className="h-3.5 w-3.5" />
                        </button>
                        {commentCardLinkOpen ? (
                          <div className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                            <div className="border-b border-slate-100 p-2">
                              <input
                                type="text"
                                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-[#246c7c]"
                                placeholder="Найти карточку..."
                                value={commentCardLinkQuery}
                                onChange={(e) => setCommentCardLinkQuery(e.target.value)}
                                autoFocus
                              />
                            </div>
                            <div className="max-h-56 overflow-auto py-1">
                              {commentCardLinkSearching ? (
                                <div className="px-3 py-3 text-sm text-slate-500">Ищем...</div>
                              ) : commentCardLinkQuery.trim() && commentCardLinkResults.length === 0 ? (
                                <div className="px-3 py-3 text-sm text-slate-500">Ничего не найдено</div>
                              ) : (
                                commentCardLinkResults.map((hit) => (
                                  <button
                                    key={hit.id}
                                    type="button"
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                                    onClick={() => insertCardLink(hit)}
                                  >
                                    <div className="truncate font-medium text-slate-900">{hit.description}</div>
                                    <div className="mt-0.5 text-xs text-slate-500">{hit.columnTitle}</div>
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="grid h-6 w-6 place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        title="Упомянуть пользователя"
                        aria-label="Упомянуть пользователя"
                        onClick={() => {
                          const cursor = Math.max(0, Math.min(commentCaretRef.current, commentBody.length));
                          const prefix = commentBody.slice(0, cursor);
                          const suffix = commentBody.slice(cursor);
                          const needsSpace = prefix.length > 0 && !/\s$/.test(prefix);
                          const next = `${prefix}${needsSpace ? " " : ""}@${suffix}`;
                          const nextCursor = prefix.length + (needsSpace ? 1 : 0) + 1;
                          updateCommentDraft(next, nextCursor);
                          window.setTimeout(() => {
                            commentTextareaRef.current?.focus();
                            commentTextareaRef.current?.setSelectionRange(nextCursor, nextCursor);
                          }, 0);
                        }}
                      >
                        <IconAt className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <button
                      type="button"
                      className={classNames(cardModalIconAddEmphasis, "h-6 w-6")}
                      disabled={!commentBody.trim()}
                      title="Добавить комментарий"
                      aria-label="Добавить комментарий"
                      onClick={submitComment}
                    >
                      <IconPlus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {commentMentionOpen ? (
                  <div className="absolute left-8 right-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                    {commentMentionUsers.length === 0 ? (
                      <div className="px-3 py-3 text-sm text-slate-500">Нет пользователей</div>
                    ) : (
                      commentMentionUsers.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
                          onClick={() => insertCommentMention(u)}
                        >
                          <AvatarImg user={u} size={24} />
                          <span className="min-w-0 flex-1 truncate">{u.name || u.email}</span>
                          <span className="hidden truncate text-xs text-slate-500 sm:block">{u.email}</span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
              {uploadSelectedName ? (
                <div className="ml-8 truncate text-xs text-slate-500" title={uploadSelectedName}>
                  {compactFileName(uploadSelectedName, 70)}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
            <div className="grid gap-2">
            {card.comments.length === 0 ? (
              <div className="text-xs text-slate-500">Комментариев нет.</div>
            ) : (
              card.comments.map((c) => (
                <div key={c.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 text-xs text-slate-600">
                      {(() => {
                        const authorId = (c as any).authorId as string | null | undefined;
                        const u = authorId ? (userById.get(authorId) ?? { id: authorId, name: c.author ?? undefined }) : null;
                        return (
                          <div className="flex min-w-0 items-center gap-2">
                            {u ? <AvatarImg user={u} size={18} /> : null}
                            <span className="min-w-0 truncate">
                              {c.author ? <span className="font-semibold text-slate-900">{c.author}</span> : "Аноним"} •{" "}
                              {format(new Date(c.createdAt), "yyyy-MM-dd HH:mm")}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                    {(() => {
                      const authorId = (c as any).authorId as string | null | undefined;
                      const canManage =
                        canEditCard && (props.viewer.role === "ADMIN" || (!!authorId && authorId === props.viewer.id));
                      if (!canManage) return null;
                      return (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className={classNames(
                              "grid h-6 w-6 place-items-center rounded-lg border text-slate-800 transition-colors",
                              editingCommentId === c.id
                                ? "border-[#246c7c]/40 bg-[#246c7c]/12 text-[#1a4d58] ring-1 ring-[#246c7c]/25"
                                : "border-slate-200 bg-white hover:bg-slate-50",
                            )}
                            onClick={() => openOrToggleCommentEditor(c)}
                            title="Редактировать"
                            aria-label="Редактировать"
                            aria-pressed={editingCommentId === c.id}
                          >
                            <IconEdit className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className={classNames(cardModalIconDanger, "h-6 w-6")}
                            onClick={() => {
                              if (editingCommentId === c.id) resetEditingComment();
                              void Api.deleteComment(c.id).then(props.onChanged);
                            }}
                            title="Удалить"
                            aria-label="Удалить"
                          >
                            <IconTrash className="h-3.5 w-3.5 text-rose-600" />
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                  {editingCommentId === c.id ? (
                    <div className="relative mt-2 grid gap-2" ref={editingCommentComposerRef}>
                      <div className="space-y-1">
                        <MarkdownRichEditor
                          ref={editingCommentTextareaRef}
                          value={editingCommentBody}
                          onChange={(v, c) => updateCommentDraft(v, c ?? v.length, "edit")}
                          minHeight="100px"
                          ariaLabel="Редактирование комментария"
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/90 px-2 py-1.5">
                          <div className="flex flex-wrap items-center gap-1">
                            <button
                              type="button"
                              className="grid h-6 w-6 place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                              title="Добавить файл"
                              aria-label="Добавить файл"
                              onClick={() => {
                                uploadTargetRef.current = { kind: "editComment", commentId: c.id };
                                uploadInputRef.current?.click();
                              }}
                            >
                              <IconPaperclip className="h-3.5 w-3.5" />
                            </button>
                            <div className="relative">
                              <button
                                type="button"
                                className="grid h-6 w-6 place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                                title="Добавить ссылку на карточку"
                                aria-label="Добавить ссылку на карточку"
                                onClick={() => {
                                  setEditingCommentMentionOpen(false);
                                  setEditingCommentCardLinkOpen((v) => !v);
                                }}
                              >
                                <IconLink className="h-3.5 w-3.5" />
                              </button>
                              {editingCommentCardLinkOpen ? (
                                <div className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                                  <div className="border-b border-slate-100 p-2">
                                    <input
                                      type="text"
                                      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-[#246c7c]"
                                      placeholder="Найти карточку..."
                                      value={editingCommentCardLinkQuery}
                                      onChange={(e) => setEditingCommentCardLinkQuery(e.target.value)}
                                      autoFocus
                                    />
                                  </div>
                                  <div className="max-h-56 overflow-auto py-1">
                                    {editingCommentCardLinkSearching ? (
                                      <div className="px-3 py-3 text-sm text-slate-500">Ищем...</div>
                                    ) : editingCommentCardLinkQuery.trim() && editingCommentCardLinkResults.length === 0 ? (
                                      <div className="px-3 py-3 text-sm text-slate-500">Ничего не найдено</div>
                                    ) : (
                                      editingCommentCardLinkResults.map((hit) => (
                                        <button
                                          key={hit.id}
                                          type="button"
                                          className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                                          onClick={() => insertCardLink(hit, "edit")}
                                        >
                                          <div className="truncate font-medium text-slate-900">{hit.description}</div>
                                          <div className="mt-0.5 text-xs text-slate-500">{hit.columnTitle}</div>
                                        </button>
                                      ))
                                    )}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              className="grid h-6 w-6 place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                              title="Упомянуть пользователя"
                              aria-label="Упомянуть пользователя"
                              onClick={() => {
                                const cursor = Math.max(0, Math.min(editingCommentCaretRef.current, editingCommentBody.length));
                                const prefix = editingCommentBody.slice(0, cursor);
                                const suffix = editingCommentBody.slice(cursor);
                                const needsSpace = prefix.length > 0 && !/\s$/.test(prefix);
                                const next = `${prefix}${needsSpace ? " " : ""}@${suffix}`;
                                const nextCursor = prefix.length + (needsSpace ? 1 : 0) + 1;
                                updateCommentDraft(next, nextCursor, "edit");
                                window.setTimeout(() => {
                                  editingCommentTextareaRef.current?.focus();
                                  editingCommentTextareaRef.current?.setSelectionRange(nextCursor, nextCursor);
                                }, 0);
                              }}
                            >
                              <IconAt className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <button
                            type="button"
                            className="grid h-6 w-6 place-items-center rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                            title="Отмена"
                            aria-label="Отмена"
                            onClick={() => resetEditingComment()}
                          >
                            <IconX className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {editingCommentMentionOpen ? (
                        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                          {editingCommentMentionUsers.length === 0 ? (
                            <div className="px-3 py-3 text-sm text-slate-500">Нет пользователей</div>
                          ) : (
                            editingCommentMentionUsers.map((u) => (
                              <button
                                key={u.id}
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
                                onClick={() => insertCommentMention(u, "edit")}
                              >
                                <AvatarImg user={u} size={24} />
                                <span className="min-w-0 flex-1 truncate">{u.name || u.email}</span>
                                <span className="hidden truncate text-xs text-slate-500 sm:block">{u.email}</span>
                              </button>
                            ))
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <MarkdownHtmlBlock source={c.body} className="mt-2" />
                  )}
                </div>
              ))
            )}
            </div>
          </div>

        </div>
        ) : null}
      </div>
    </Modal>
  );
}
