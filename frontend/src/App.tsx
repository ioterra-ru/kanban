import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { format } from "date-fns";

import { Api } from "./api";
import type { Board, BoardColumn, CardDetail, CardSummary, ColumnId, Importance, User } from "./types";
import { compactFileName, compactMiddle } from "./utils/files";
import { AVATAR_PRESETS, autoAvatarPreset, avatarSrc } from "./utils/avatar";

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// compactMiddle/compactFileName are in ./utils/files

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

function Modal(props: {
  open: boolean;
  title?: string;
  headerLeft?: React.ReactNode;
  headerRight?: React.ReactNode;
  showCloseButton?: boolean;
  panelClassName?: string;
  panelStyle?: React.CSSProperties;
  panelOverlay?: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!props.open) return null;
  const showClose = props.showCloseButton ?? true;
  const headerLeft = props.headerLeft ?? (props.title ? <div className="text-lg font-semibold">{props.title}</div> : null);
  const headerRight =
    props.headerRight ??
    (showClose ? (
      <button
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50"
        onClick={props.onClose}
      >
        Закрыть
      </button>
    ) : null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        className={classNames(
          "relative flex w-full max-w-5xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl",
          props.panelStyle?.height ? "" : "max-h-[80vh]",
          props.panelClassName,
        )}
        style={props.panelStyle}
      >
        {(headerLeft || headerRight) && (
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4">
            <div className="min-w-0 flex-1">{headerLeft}</div>
            <div className="shrink-0">{headerRight}</div>
          </div>
        )}
        <div className="flex-1 overflow-x-hidden overflow-y-auto p-4">{props.children}</div>
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
        "min-h-[120px] rounded-xl border border-slate-200 bg-white p-2",
        isOver && "ring-2 ring-[#246c7c]",
      )}
    >
      {props.children}
    </div>
  );
}

function CardTile(props: {
  card: CardSummary;
  assigneeDisplay?: string | null;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.card.id,
    data: { columnId: props.card.column },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={classNames(
        "group rounded-xl border-2 bg-white p-3 shadow-sm",
        cardBorderClass(props.card.importance),
        isDragging && "opacity-50",
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
            {props.assigneeDisplay ? <span>Ответственный: {props.assigneeDisplay}</span> : null}
            {props.card.dueDate ? (
              <span>Срок: {format(new Date(props.card.dueDate), "dd.MM.yyyy HH:mm")}</span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={classNames("rounded-md px-2 py-0.5 text-[11px] font-semibold", importanceBadge(props.card.importance))}>
            {importanceLabel(props.card.importance)}
          </span>
          {props.card.paused ? (
            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
              Пауза
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
        <button
          className="rounded-md px-2 py-1 hover:bg-slate-50 hover:text-slate-900"
          onClick={(e) => {
            e.stopPropagation();
            props.onClick();
          }}
        >
          Открыть
        </button>
        <span>💬 {props.card.commentCount}</span>
        <span>📎 {props.card.attachmentCount}</span>
      </div>
    </div>
  );
}

function toDateTimeLocalValue(iso: string | null) {
  if (!iso) return "";
  return format(new Date(iso), "yyyy-MM-dd'T'HH:mm");
}

function App() {
  const [me, setMe] = useState<{ user: User | null; twoFactorPassed: boolean } | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usersOpen, setUsersOpen] = useState(false);
  const [allUsers, setAllUsers] = useState<Array<Pick<User, "id" | "email" | "name">> | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [currentBoardId, setCurrentBoardId] = useState<string | null>(null);
  const [boardsOpen, setBoardsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const [activeCardId, setActiveCardId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createColumn, setCreateColumn] = useState<ColumnId>("BACKLOG");
  const [createTitle, setCreateTitle] = useState("");
  const [createDetails, setCreateDetails] = useState("");

  const [cardOpen, setCardOpen] = useState(false);
  const [cardDetail, setCardDetail] = useState<CardDetail | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const cardsById = useMemo(() => {
    const m = new Map<string, CardSummary>();
    for (const col of columns) for (const c of col.cards) m.set(c.id, c);
    return m;
  }, [columns]);

  const userNameByEmail = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of allUsers ?? []) m.set(u.email, u.name);
    return m;
  }, [allUsers]);

  const assigneeDisplay = (assignee: string | null) => {
    if (!assignee) return null;
    if (assignee.includes("@")) return userNameByEmail.get(assignee) ?? assignee;
    return assignee;
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

  useEffect(() => {
    if (!me) return;
    const ok = !!me.user && me.user.totpEnabled && me.twoFactorPassed && !me.user.mustChangePassword;
    if (!ok) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        const b = await Api.listBoards();
        setBoards(b.boards as any);
        const nextBoardId = b.currentBoardId ?? b.boards[0]?.id ?? null;
        if (nextBoardId && nextBoardId !== b.currentBoardId) {
          await Api.selectBoard({ boardId: nextBoardId });
        }
        setCurrentBoardId(nextBoardId);
        await Promise.all([
          reload(),
          Api.listAllUsers()
            .then((d) => setAllUsers(d.users as any))
            .catch(() => setAllUsers([])),
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, [me?.user?.id, me?.twoFactorPassed, me?.user?.totpEnabled, me?.user?.mustChangePassword]);

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

  if (!me.user.totpEnabled) {
    return <TwoFaSetupView onDone={loadMe} />;
  }

  if (!me.twoFactorPassed) {
    return <TwoFaVerifyView onDone={loadMe} />;
  }

  const findColumnForCard = (cardId: string): { columnId: ColumnId; index: number } | null => {
    for (const col of columns) {
      const idx = col.cards.findIndex((c) => c.id === cardId);
      if (idx >= 0) return { columnId: col.id, index: idx };
    }
    return null;
  };

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
      setCardOpen(true);
      const data = await Api.fetchCard(id);
      setCardDetail(data.card);
    } catch (e) {
      setError((e as Error).message);
      setCardOpen(false);
    }
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center text-slate-700">Загрузка…</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/ioterra.svg" alt="ИоТерра" className="h-8 w-8" />
            <div className="leading-tight">
              <div className="text-2xl font-extrabold text-slate-900">
                {boards.find((b) => b.id === currentBoardId)?.name ?? "Доска"}
              </div>
              <div className="text-sm font-semibold text-slate-500">ИоТерра-Канбан</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 md:flex">
              <AvatarImg user={me.user} size={24} />
              <span className="font-semibold">{me.user.name}</span>
              <span className="text-slate-400">•</span>
              <span className="text-slate-500">{me.user.role === "ADMIN" ? "Администратор" : "Участник"}</span>
            </div>
            {boards.length ? (
              <select
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-[#246c7c]"
                value={currentBoardId ?? ""}
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) return;
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
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              className="rounded-xl bg-[#246c7c] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              onClick={() => {
                setCreateColumn("BACKLOG");
                setCreateTitle("");
                setCreateDetails("");
                setCreateOpen(true);
              }}
            >
              + Карточка
            </button>
            <button
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              onClick={() => setProfileOpen(true)}
            >
              Кабинет
            </button>
            <button
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              onClick={() => void Api.logout().then(loadMe)}
            >
              Выйти
            </button>
          </div>
        </div>
        {error ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
      </header>

      <main className="flex-1 overflow-auto p-5">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={(e) => setActiveCardId(String(e.active.id))}
          onDragEnd={(e) => {
            const activeId = String(e.active.id);
            const overId = e.over?.id ? String(e.over.id) : null;
            setActiveCardId(null);
            if (!overId) return;

            const from = findColumnForCard(activeId);
            if (!from) return;

            let toColumn: ColumnId | null = null;
            let toIndex = 0;

            if (overId.startsWith("column:")) {
              toColumn = overId.replace("column:", "") as ColumnId;
              const dest = columns.find((c) => c.id === toColumn);
              toIndex = dest ? dest.cards.length : 0;
            } else {
              const over = findColumnForCard(overId);
              if (!over) return;
              toColumn = over.columnId;
              toIndex = over.index;
            }

            if (toColumn === from.columnId && toIndex === from.index) return;

            moveLocally(activeId, toColumn, toIndex);
            void Api.moveCard(activeId, { toColumn, toIndex }).catch(async () => {
              await reload();
            });
          }}
        >
          <div className="flex min-w-[1200px] gap-4">
            {columns.map((col) => (
              <section key={col.id} className="w-[340px] shrink-0">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">
                    {col.title} <span className="text-slate-500">({col.cards.length})</span>
                  </div>
                  <button
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 hover:bg-slate-50"
                    onClick={() => {
                      setCreateColumn(col.id);
                      setCreateTitle("");
                      setCreateDetails("");
                      setCreateOpen(true);
                    }}
                  >
                    +
                  </button>
                </div>

                <ColumnDropZone id={col.id}>
                  <SortableContext items={col.cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                    <div className="flex flex-col gap-2">
                      {col.cards.map((card) => (
                        <CardTile
                          key={card.id}
                          card={card}
                          assigneeDisplay={assigneeDisplay(card.assignee)}
                          onClick={() => void onOpenCard(card.id)}
                        />
                      ))}
                      {col.cards.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                          Перетащите сюда карточку или добавьте новую.
                        </div>
                      ) : null}
                    </div>
                  </SortableContext>
                </ColumnDropZone>
              </section>
            ))}
          </div>

          <DragOverlay>
            {activeCardId && cardsById.get(activeCardId) ? (
              <div className="w-[340px]">
                <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xl">
                  <div className="text-sm font-semibold">{cardsById.get(activeCardId)!.description}</div>
                  {assigneeDisplay(cardsById.get(activeCardId)!.assignee) ? (
                    <div className="mt-1 text-xs text-slate-600">
                      Ответственный: {assigneeDisplay(cardsById.get(activeCardId)!.assignee)}
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
            <div className="text-xs text-slate-600">Колонка</div>
            <select
              className="rounded-xl border border-slate-200 bg-white p-2 text-sm outline-none focus:border-[#246c7c]"
              value={createColumn}
              onChange={(e) => setCreateColumn(e.target.value as ColumnId)}
            >
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end">
            <button
              className="rounded-xl bg-[#246c7c] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              disabled={!createTitle.trim()}
              onClick={() => {
                const title = createTitle.trim();
                if (!title) return;
                const details = createDetails.trim() ? createDetails.trim() : null;
                void Api.createCard({ description: title, details, column: createColumn }).then(async () => {
                  setCreateOpen(false);
                  await reload();
                });
              }}
            >
              Создать
            </button>
          </div>
        </div>
      </Modal>

      <CardModal
        open={cardOpen}
        card={cardDetail}
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

      <BoardsModal
        open={boardsOpen}
        onClose={() => setBoardsOpen(false)}
        boards={boards}
        onUpdated={async () => {
          const b = await Api.listBoards();
          setBoards(b.boards as any);
          setCurrentBoardId(b.currentBoardId ?? null);
        }}
      />

      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        me={me.user}
        boards={boards}
        onOpenBoards={() => setBoardsOpen(true)}
        onOpenUsers={() => setUsersOpen(true)}
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

      <UsersModal open={usersOpen} onClose={() => setUsersOpen(false)} />
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
        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-[#246c7c] disabled:opacity-50"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <img src={`/avatars/${selectedKey}.svg`} alt="" className="h-6 w-6 rounded-full border border-slate-200 bg-white" />
        <span>{selectedLabel}</span>
        <span className="ml-1 text-slate-400">{open ? "▴" : "▾"}</span>
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-20 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="max-h-64 overflow-auto p-1">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
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
              <span className="flex-1">Авто</span>
              {selected === "" ? <IconCheck className="h-4 w-4 text-[#246c7c]" /> : null}
            </button>
            {AVATAR_PRESETS.map((k) => (
              <button
                key={k}
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
                onClick={() => {
                  props.onChange(k);
                  setOpen(false);
                }}
                role="option"
                aria-selected={selected === k}
              >
                <img src={`/avatars/${k}.svg`} alt="" className="h-6 w-6 rounded-full border border-slate-200 bg-white" />
                <span className="flex-1">{k.toUpperCase()}</span>
                {selected === k ? <IconCheck className="h-4 w-4 text-[#246c7c]" /> : null}
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
  onClick: () => void;
  variant?: "default" | "danger" | "brand";
  children: React.ReactNode;
}) {
  const variant = props.variant ?? "default";
  const cls =
    variant === "brand"
      ? "bg-[#246c7c] text-white hover:opacity-90"
      : variant === "danger"
        ? "bg-[#ac4c1c] text-white hover:opacity-90"
        : "bg-white text-slate-800 hover:bg-slate-50";

  return (
    <button
      type="button"
      className={`grid h-10 w-10 place-items-center rounded-xl border border-slate-200 ${cls}`}
      onClick={props.onClick}
      title={props.title}
      aria-label={props.title}
    >
      {props.children}
    </button>
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
  const [submitting, setSubmitting] = useState(false);

  const friendlyAuthError = (msg: string) => {
    if (msg.includes("Invalid credentials")) return "Неверный логин или пароль.";
    if (msg.includes("Two-factor required")) return "Введите код 2FA и повторите вход.";
    if (msg.includes("2FA setup required")) return "Для пользователя требуется настроить 2FA (обратитесь к администратору).";
    if (msg.includes("Password reset not available"))
      return "Для этой учетной записи сброс пароля по коду 2FA недоступен. Обратитесь к администратору.";
    if (msg.includes("Invalid code")) return "Неверный код 2FA.";
    if (msg.includes("Timeout")) return "Сервер не отвечает. Подождите и попробуйте ещё раз (или перезапустите контейнеры).";
    if (msg.includes("502") || msg.toLowerCase().includes("bad gateway"))
      return "Сервер временно недоступен. Подождите и попробуйте ещё раз (или перезапустите контейнеры).";
    if (msg.toLowerCase().includes("failed to fetch") || msg.toLowerCase().includes("network"))
      return "Ошибка сети. Проверьте подключение и попробуйте ещё раз.";
    return "Ошибка входа. Проверьте данные и попробуйте ещё раз.";
  };

  return (
    <CenteredShell title="ИоТерра-Канбан">
      <div className="grid gap-3">
        <div className="text-sm text-slate-600">{mode === "login" ? "Вход" : "Восстановление пароля"}</div>
        <div className="text-xs text-slate-500">По умолчанию: логин <span className="font-mono">admin</span>, пароль <span className="font-mono">admin</span>.</div>
        <div
          className={`rounded-xl border px-3 py-2 text-sm ${
            error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-transparent bg-transparent text-transparent"
          } max-h-24 overflow-auto whitespace-pre-wrap break-words`}
          aria-live="polite"
        >
          {error ?? " "}
        </div>
        {mode === "login" ? (
          <>
            <label className="grid gap-1">
              <div className="text-xs text-slate-600">Логин</div>
              <input
                className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="admin или email"
                autoComplete="username"
              />
            </label>
            <label className="grid gap-1">
              <div className="text-xs text-slate-600">Пароль</div>
              <input
                type="password"
                className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
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
              className="rounded-xl bg-[#246c7c] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              disabled={submitting}
              onClick={() => {
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
              {submitting ? "Вход…" : "Войти"}
            </button>
            <button
              className="text-sm font-semibold text-[#246c7c] underline underline-offset-4 hover:opacity-80"
              onClick={() => {
                setError(null);
                setFpOk(false);
                setMode("forgot");
                setFpLogin(login.trim());
                setFpCode("");
                setFpP1("");
                setFpP2("");
              }}
              type="button"
            >
              Забыли пароль?
            </button>
          </>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              Если у вас включена 2FA, вы можете сменить пароль по коду из приложения-аутентификатора. Если 2FA не включена — обратитесь к администратору.
            </div>
            {fpOk ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                Пароль изменён. Теперь вы можете войти.
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
            <label className="grid gap-1">
              <div className="text-xs text-slate-600">Код 2FA</div>
              <input
                className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
                value={fpCode}
                onChange={(e) => setFpCode(e.target.value)}
                placeholder="123456"
              />
            </label>
            <input
              type="password"
              className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
              placeholder="Новый пароль (мин. 8)"
              value={fpP1}
              onChange={(e) => setFpP1(e.target.value)}
              autoComplete="new-password"
            />
            <input
              type="password"
              className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
              placeholder="Повторите пароль"
              value={fpP2}
              onChange={(e) => setFpP2(e.target.value)}
              autoComplete="new-password"
            />
            <button
              className="rounded-xl bg-[#246c7c] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              disabled={fpOk || !fpLogin.trim() || fpCode.trim().length < 6 || !fpP1 || fpP1 !== fpP2 || fpP1.length < 8 || submitting}
              onClick={() => {
                setError(null);
                setSubmitting(true);
                void Api.resetPasswordByTotp({ login: fpLogin.trim(), code: fpCode.trim(), newPassword: fpP1 })
                  .then(() => setFpOk(true))
                  .catch((e) => setError(friendlyAuthError((e as Error).message)))
                  .finally(() => setSubmitting(false));
              }}
            >
              {submitting ? "Смена…" : "Сменить пароль"}
            </button>
            <button
              className="text-sm font-semibold text-slate-700 underline underline-offset-4 hover:opacity-80"
              onClick={() => {
                setError(null);
                setFpOk(false);
                setMode("login");
              }}
              type="button"
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
        <input
          type="password"
          className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
          placeholder="Новый пароль"
          value={p1}
          onChange={(e) => setP1(e.target.value)}
          autoComplete="new-password"
        />
        <input
          type="password"
          className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
          placeholder="Повторите пароль"
          value={p2}
          onChange={(e) => setP2(e.target.value)}
          autoComplete="new-password"
        />
        <button
          className="rounded-xl bg-[#246c7c] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          disabled={ok || !p1 || p1 !== p2 || p1.length < 8}
          onClick={() => {
            setError(null);
            void Api.resetPasswordByToken({ token: props.token, newPassword: p1 })
              .then(() => setOk(true))
              .catch((e) => setError((e as Error).message));
          }}
        >
          Сменить пароль
        </button>
        <button
          className="text-sm font-semibold text-slate-700 underline underline-offset-4 hover:opacity-80"
          onClick={props.onDone}
          type="button"
        >
          Перейти ко входу
        </button>
      </div>
    </CenteredShell>
  );
}

function ChangePasswordView(props: { onDone: () => Promise<void> | void }) {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <CenteredShell title="Смена пароля">
      <div className="grid gap-3">
        <div className="text-sm text-slate-600">Задайте новый пароль (минимум 8 символов).</div>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
        <input type="password" className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]" placeholder="Новый пароль" value={p1} onChange={(e) => setP1(e.target.value)} />
        <input type="password" className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]" placeholder="Повторите пароль" value={p2} onChange={(e) => setP2(e.target.value)} />
        <button
          className="rounded-xl bg-[#246c7c] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          disabled={!p1 || p1 !== p2 || p1.length < 8}
          onClick={() => {
            setError(null);
            void Api.changePassword({ newPassword: p1 })
              .then(() => props.onDone())
              .catch((e) => setError((e as Error).message));
          }}
        >
          Сохранить пароль
        </button>
      </div>
    </CenteredShell>
  );
}

function TwoFaSetupView(props: { onDone: () => Promise<void> | void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <CenteredShell title="Настройка 2FA">
      <div className="grid gap-3">
        <div className="text-sm text-slate-600">Отсканируйте QR-код в приложении-аутентификаторе и введите код.</div>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
        {!qr ? (
          <button
            className="rounded-xl bg-[#246c7c] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            onClick={() => {
              setError(null);
              void Api.twoFaSetup()
                .then((d) => setQr(d.qrDataUrl))
                .catch((e) => setError((e as Error).message));
            }}
          >
            Сгенерировать QR-код
          </button>
        ) : (
          <div className="grid gap-2">
            <img src={qr} alt="QR для 2FA" className="mx-auto w-48 rounded-xl border border-slate-200 bg-white p-2" />
            <input className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Код 2FA" />
            <button
              className="rounded-xl bg-[#246c7c] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              disabled={code.trim().length < 6}
              onClick={() => {
                setError(null);
                void Api.twoFaEnable({ code: code.trim() })
                  .then(() => props.onDone())
                  .catch((e) => setError((e as Error).message));
              }}
            >
              Включить 2FA
            </button>
          </div>
        )}
      </div>
    </CenteredShell>
  );
}

function TwoFaVerifyView(props: { onDone: () => Promise<void> | void }) {
  const [code, setCode] = useState("");
  const [rememberDevice, setRememberDevice] = useState(true);
  const [error, setError] = useState<string | null>(null);
  return (
    <CenteredShell title="Подтверждение 2FA">
      <div className="grid gap-3">
        <div className="text-sm text-slate-600">Введите код из приложения-аутентификатора.</div>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
        <input className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 text-sm text-slate-800">
          <input type="checkbox" checked={rememberDevice} onChange={(e) => setRememberDevice(e.target.checked)} />
          <span>Не спрашивать код на этом устройстве 30 дней</span>
        </label>
        <button
          className="rounded-xl bg-[#246c7c] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          disabled={code.trim().length < 6}
          onClick={() => {
            setError(null);
            void Api.twoFaVerify({ code: code.trim(), rememberDevice })
              .then(() => props.onDone())
              .catch((e) => setError((e as Error).message));
          }}
        >
          Подтвердить
        </button>
      </div>
    </CenteredShell>
  );
}

function UsersModal(props: { open: boolean; onClose: () => void }) {
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
    }>
    | null
  >(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [error, setError] = useState<string | null>(null);
  const [boardsForUser, setBoardsForUser] = useState<{ id: string; name: string; email: string } | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setError(null);
    void Api.listUsers()
      .then((d) => setUsers(d.users as any))
      .catch((e) => setError((e as Error).message));
  }, [props.open]);

  return (
    <>
      <Modal open={props.open} title="Пользователи" onClose={props.onClose}>
        <div className="grid gap-3">
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
          <div className="text-xs text-slate-600">
            При создании задайте стартовый пароль. При первом входе пользователь будет обязан сменить пароль.
          </div>
          <div className="text-xs text-slate-500">
            Для системного администратора доступны только смена почты и пароля (в т.ч. через «Кабинет»).
          </div>

          <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-2">
            <input
              className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
              placeholder="Имя (необязательно)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              type="password"
              className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
              placeholder="Стартовый пароль (мин. 8)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <select
                className="flex-1 rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
              >
                <option value="MEMBER">Участник</option>
                <option value="ADMIN">Администратор</option>
              </select>
              <button
                className="grid h-10 w-10 place-items-center rounded-xl bg-[#246c7c] text-lg font-bold text-white hover:opacity-90 disabled:opacity-50"
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
                  })
                    .then(() => {
                      setEmail("");
                      setName("");
                      setPassword("");
                      return Api.listUsers();
                    })
                    .then((d) => setUsers(d.users as any))
                    .catch((e) => setError((e as Error).message));
                }}
              >
                +
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white">
            <div className="grid grid-cols-[1fr_1fr_120px_70px_56px_90px_44px] gap-2 border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">
              <div>Имя</div>
              <div>Email</div>
              <div>Роль</div>
              <div>2FA</div>
              <div>Пароль</div>
              <div>Доски</div>
              <div />
            </div>
            <div className="max-h-[40vh] overflow-auto">
              {(users ?? []).map((u) => (
                <div key={u.id} className="grid grid-cols-[1fr_1fr_120px_70px_56px_90px_44px] items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm text-slate-800">
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
                          const next = e.target.value as "ADMIN" | "MEMBER";
                          setError(null);
                          void Api.adminUpdateUser(u.id, { role: next })
                            .then(() => Api.listUsers())
                            .then((d) => setUsers(d.users as any))
                            .catch((err) => setError((err as Error).message));
                        }}
                      >
                        <option value="MEMBER">Участник</option>
                        <option value="ADMIN">Админ</option>
                      </select>
                    )}
                  </div>
                  <div>{u.totpEnabled ? "Да" : "Нет"}</div>
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
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                      onClick={() => setBoardsForUser({ id: u.id, name: u.name, email: u.email })}
                      title="Доступ к доскам"
                    >
                      Доски
                    </button>
                  )}
                  {u.isSystem ? (
                    <button
                      className="grid h-8 w-8 cursor-not-allowed place-items-center rounded-lg border border-slate-200 bg-slate-50 text-base font-bold text-slate-400"
                      title="Нельзя удалить системного администратора"
                      aria-label="Нельзя удалить системного администратора"
                      onClick={() => {
                        setError("Нельзя удалить системного администратора. Можно изменить только почту и пароль.");
                      }}
                    >
                      −
                    </button>
                  ) : (
                    <button
                      className="grid h-8 w-8 place-items-center rounded-lg border border-rose-200 bg-white text-base font-bold text-rose-700 hover:bg-rose-50"
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
                      −
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
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
                        setBoards((prev) => (prev ? prev.map((x) => (x.id === b.id ? { ...x, hasAccess: next } : x)) : prev));
                        if (next && !defaultBoardId) setDefaultBoardId(b.id);
                        if (!next && defaultBoardId === b.id) {
                          const fallback = boards.find((x) => x.id !== b.id && x.hasAccess)?.id ?? "";
                          setDefaultBoardId(fallback);
                        }
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
                onChange={(e) => setDefaultBoardId(e.target.value)}
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

            <div className="flex justify-end">
              <button
                className="rounded-xl bg-[#246c7c] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                disabled={selectedIds.size === 0 || !defaultBoardId || !selectedIds.has(defaultBoardId)}
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  void Api.adminSetUserBoards(user.id, { boardIds: Array.from(selectedIds), defaultBoardId })
                    .then(() => props.onClose())
                    .catch((e) => setError((e as Error).message))
                    .finally(() => setLoading(false));
                }}
              >
                Сохранить
              </button>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function ProfileModal(props: {
  open: boolean;
  onClose: () => void;
  me: User;
  boards: Board[];
  onOpenBoards: () => void;
  onOpenUsers: () => void;
  onUpdated: () => Promise<void>;
}) {
  const [name, setName] = useState(props.me.name);
  const [email, setEmail] = useState(props.me.email);
  const [defaultBoardId, setDefaultBoardId] = useState<string>(props.me.defaultBoardId ?? "");
  const [avatarPreset, setAvatarPreset] = useState<string>(props.me.avatarPreset ?? "");
  const [avatarUploadName, setAvatarUploadName] = useState<string | null>(props.me.avatarUploadName ?? null);
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

  useEffect(() => {
    if (!props.open) return;
    setName(props.me.name);
    setEmail(props.me.email);
    setDefaultBoardId(props.me.defaultBoardId ?? "");
    setAvatarPreset(props.me.avatarPreset ?? "");
    setAvatarUploadName(props.me.avatarUploadName ?? null);
    setError(null);
  }, [props.open, props.me.avatarPreset, props.me.avatarUploadName, props.me.defaultBoardId, props.me.email, props.me.id, props.me.name]);

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

  if (!props.open) return null;

  return (
    <Modal open={true} title="Личный кабинет" onClose={props.onClose}>
      <div className="grid gap-3">
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
                onChange={(v) => setAvatarPreset(v)}
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
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                disabled={saving || uploadingAvatar}
                onClick={() => avatarFileRef.current?.click()}
              >
                Загрузить фото
              </button>

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

        {props.me.role === "ADMIN" ? (
          <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Администрирование</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                onClick={() => {
                  props.onClose();
                  props.onOpenBoards();
                }}
              >
                Доски
              </button>
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                onClick={() => {
                  props.onClose();
                  props.onOpenUsers();
                }}
              >
                Пользователи
              </button>
            </div>

            <div className="mt-1 rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-2 text-xs font-semibold text-slate-600">Почта</div>
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={mailEnabled}
                  disabled={mailLoading || mailSaving}
                  onChange={(e) => setMailEnabled(e.target.checked)}
                />
                <span>Использовать уведомления по почте</span>
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
                      onChange={(e) => setMailSecure(e.target.checked)}
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
                        placeholder="user@example.com"
                        disabled={mailLoading || mailSaving || mailTesting}
                      />
                    </label>
                    <label className="grid gap-1">
                      <div className="text-xs text-slate-600">Пароль</div>
                      <input
                        type="password"
                        className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]"
                        value={mailPass}
                        onChange={(e) => setMailPass(e.target.value)}
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
                    <button
                      type="button"
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                      disabled={mailLoading || mailSaving || mailTesting}
                      onClick={() => {
                        setError(null);
                        setMailTest(null);
                        setMailTesting(true);
                        const portNum = Number(mailPort);
                        void Api.testMailSettings({
                          host: mailHost.trim(),
                          port: Number.isFinite(portNum) ? portNum : null,
                          secure: mailSecure,
                          user: mailUser.trim(),
                          from: mailFrom.trim(),
                          ...(mailPass.trim() ? { pass: mailPass } : {}),
                        })
                          .then((r) => {
                            if (r.ok) setMailTest({ ok: true, message: "Соединение установлено. Аутентификация успешна." });
                            else setMailTest({ ok: false, message: `Ошибка: ${r.error ?? "неизвестно"}` });
                          })
                          .catch((e) => setMailTest({ ok: false, message: `Ошибка: ${(e as Error).message}` }))
                          .finally(() => setMailTesting(false));
                      }}
                    >
                      {mailTesting ? "Проверка…" : "Проверить соединение"}
                    </button>
                    <button
                      type="button"
                      className="rounded-xl bg-[#246c7c] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                      disabled={mailLoading || mailSaving || mailTesting}
                      onClick={() => {
                        setError(null);
                        setMailTest(null);
                        setMailSaving(true);
                        const portNum = Number(mailPort);
                        void Api.updateMailSettings({
                          enabled: true,
                          host: mailHost.trim(),
                          port: Number.isFinite(portNum) ? portNum : null,
                          secure: mailSecure,
                          user: mailUser.trim(),
                          from: mailFrom.trim(),
                          ...(mailPass.trim() ? { pass: mailPass } : {}),
                        })
                          .then((r) => {
                            setMailPass("");
                            setMailPassSet(!!r.settings.passSet);
                          })
                          .catch((e) => setError((e as Error).message))
                          .finally(() => setMailSaving(false));
                      }}
                    >
                      Сохранить настройки почты
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                    disabled={mailLoading || mailSaving}
                    onClick={() => {
                      setError(null);
                      setMailSaving(true);
                      void Api.updateMailSettings({ enabled: false })
                        .catch((e) => setError((e as Error).message))
                        .finally(() => setMailSaving(false));
                    }}
                  >
                    Сохранить (выключить)
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : null}

        <label className="grid gap-1">
          <div className="text-xs text-slate-600">Имя</div>
          <input className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <div className="text-xs text-slate-600">Email</div>
          <input className="rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-[#246c7c]" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <div className="text-xs text-slate-600">Доска по умолчанию</div>
          <select
            className="rounded-xl border border-slate-200 bg-white p-2 text-sm outline-none focus:border-[#246c7c]"
            value={defaultBoardId}
            onChange={(e) => setDefaultBoardId(e.target.value)}
          >
            {props.boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex justify-end">
          <button
            className="rounded-xl bg-[#246c7c] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            disabled={saving || uploadingAvatar || !name.trim() || !email.trim()}
            onClick={() => {
              setSaving(true);
              setError(null);
              const payload: { name?: string; email?: string; defaultBoardId?: string; avatarPreset?: string | null } = {};
              if (name.trim() !== (props.me.name ?? "")) payload.name = name.trim();
              if (email.trim() !== (props.me.email ?? "")) payload.email = email.trim();
              if (defaultBoardId && defaultBoardId !== (props.me.defaultBoardId ?? "")) payload.defaultBoardId = defaultBoardId;
              const nextAvatarPreset = avatarPreset ? avatarPreset : null;
              const prevAvatarPreset = props.me.avatarPreset ? props.me.avatarPreset : null;
              if (nextAvatarPreset !== prevAvatarPreset) payload.avatarPreset = nextAvatarPreset;

              void Api.updateProfile(payload)
                .then(() => props.onUpdated())
                .then(() => props.onClose())
                .catch((e) => setError((e as Error).message))
                .finally(() => setSaving(false));
            }}
          >
            Сохранить
          </button>
        </div>
      </div>
    </Modal>
  );
}

function BoardsModal(props: { open: boolean; onClose: () => void; boards: Board[]; onUpdated: () => Promise<void> }) {
  const DEFAULT_BOARD_ID = "00000000-0000-0000-0000-000000000001";
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createMemberIds, setCreateMemberIds] = useState<string[]>([]);

  const [edit, setEdit] = useState<Record<string, { name: string; description: string; memberIds: string[] }>>({});
  const [allUsers, setAllUsers] = useState<Array<{ id: string; email: string; name: string; role: string }> | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
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

  if (!props.open) return null;

  const usersForMembers = allUsers ?? [];

  const toggleId = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  return (
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
              className="grid h-10 w-10 place-items-center rounded-xl bg-[#246c7c] text-lg font-bold text-white hover:opacity-90 disabled:opacity-50"
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
              title="Создать"
              aria-label="Создать"
            >
              +
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

              const membersChanged =
                usersForMembers.length > 0 && b.memberIds
                  ? JSON.stringify([...e.memberIds].sort()) !== JSON.stringify([...(b.memberIds ?? [])].sort())
                  : false;
              const changed =
                e.name.trim() !== b.name ||
                (e.description.trim() || "") !== ((b.description ?? "") as string) ||
                membersChanged;

              return (
                <div key={b.id} className="bg-white">
                  <button
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                    onClick={() => setExpandedId((prev) => (prev === b.id ? null : b.id))}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">{b.name}</div>
                    </div>
                    <div className="shrink-0 text-slate-400">{isOpen ? "▴" : "▾"}</div>
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
                                      onChange={() =>
                                        setEdit((prev) => ({
                                          ...prev,
                                          [b.id]: { ...(prev[b.id] ?? e), memberIds: toggleId((prev[b.id] ?? e).memberIds, u.id) },
                                        }))
                                      }
                                    />
                                    <span className="truncate">{u.name || u.email}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          </div>
                        ) : null}

                        <div className="flex items-center justify-end gap-2">
                          <button
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                            disabled={!e.name.trim() || !changed}
                            onClick={() => {
                              setError(null);
                              void Api.updateBoard(b.id, {
                                name: e.name.trim(),
                                description: e.description.trim() ? e.description.trim() : null,
                                ...(usersForMembers.length ? { memberIds: e.memberIds } : {}),
                              })
                                .then(() => props.onUpdated())
                                .catch((err) => setError((err as Error).message));
                            }}
                          >
                            Сохранить
                          </button>
                          <IconButton
                            title={b.id === DEFAULT_BOARD_ID ? "Нельзя удалить основную доску" : "Удалить доску"}
                            variant="danger"
                            onClick={() => {
                              if (b.id === DEFAULT_BOARD_ID) return;
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
    </Modal>
  );
}

function CardModal(props: {
  open: boolean;
  card: CardDetail | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
  viewer: User;
  allUsers: Array<Pick<User, "id" | "email" | "name">>;
}) {
  const card = props.card;
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const persistInFlightRef = useRef<Promise<boolean> | null>(null);

  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [importance, setImportance] = useState<Importance>("MEDIUM");
  const [paused, setPaused] = useState(false);
  const [uploadSelectedName, setUploadSelectedName] = useState<string>("");

  const [commentBody, setCommentBody] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState<string>("");

  const [participants, setParticipants] = useState<Array<{ user: Pick<User, "id" | "email" | "name"> }>>([]);
  const [participantAddOpen, setParticipantAddOpen] = useState(false);
  const [participantAddUserId, setParticipantAddUserId] = useState("");
  const [participantError, setParticipantError] = useState<string | null>(null);

  const [rightWidth, setRightWidth] = useState(420);
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{ startX: number; startW: number } | null>(null);
  const [isLg, setIsLg] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [panelSize, setPanelSize] = useState<{ w: number; h: number }>({ w: 1120, h: 740 });
  const [panelHasCustomSize, setPanelHasCustomSize] = useState(false);
  const [panelResizing, setPanelResizing] = useState(false);
  const panelResizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const lastLoadedIdRef = useRef<string | null>(null);

  const canManageCard =
    !!card && (props.viewer.role === "ADMIN" || ((card as any).authorId as string | null | undefined) === props.viewer.id);

  useEffect(() => {
    if (!card) return;
    setTitle(card.description ?? "");
    setDetails(card.details ?? "");
    setAssignee(card.assignee ?? "");
    setDueDate(toDateTimeLocalValue(card.dueDate));
    setImportance(card.importance);
    setPaused(card.paused);
    setParticipants((card.participants as any) ?? []);
    setParticipantAddOpen(false);
    setParticipantAddUserId("");
    setParticipantError(null);
    setSaveError(null);
    setDeleting(false);
    setEditingCommentId(null);
    setEditingCommentBody("");

    // restore per-user sizes
    try {
      const raw = localStorage.getItem(`ioterra.cardModal.size.${props.viewer.id}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { w?: number; h?: number; rightW?: number };
        const nextW = typeof parsed.w === "number" ? parsed.w : panelSize.w;
        const nextH = typeof parsed.h === "number" ? parsed.h : panelSize.h;
        const nextRightW = typeof parsed.rightW === "number" ? parsed.rightW : rightWidth;
        setPanelSize({ w: clamp(nextW, 720, 1600), h: clamp(nextH, 520, 900) });
        setRightWidth(clamp(nextRightW, 240, 1100));
        setPanelHasCustomSize(true);
      }
    } catch {
      // ignore
    }
    lastLoadedIdRef.current = card.id;
  }, [card?.id]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setIsLg(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const st = dragStateRef.current;
      if (!st) return;
      const delta = e.clientX - st.startX;
      const next = Math.round(st.startW - delta);
      const minLeft = 320;
      const maxRight = Math.max(360, panelSize.w - minLeft - 20);
      setRightWidth(clamp(next, 240, Math.min(1100, maxRight)));
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
      dueDate: string | null;
      importance: Importance;
      paused: boolean;
    }>,
  ): Promise<boolean> => {
    if (!card) return false;
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
      panelClassName="max-w-none"
      panelStyle={{
        width: Math.min(panelSize.w, window.innerWidth - 32),
        ...(panelHasCustomSize || panelResizing
          ? { height: Math.min(panelSize.h, window.innerHeight - 32) }
          : { maxHeight: window.innerHeight - 32 }),
      }}
      panelOverlay={
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
          {/* diagonal lines like textarea resize grip */}
          <div className="absolute inset-0">
            <div className="absolute bottom-0 right-0 h-[10px] w-[10px] border-b-2 border-r-2 border-slate-300" />
            <div className="absolute bottom-1 right-1 h-[8px] w-[8px] border-b-2 border-r-2 border-slate-200" />
          </div>
        </div>
      }
      headerLeft={
        <div className="min-w-0">
          <input
            className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-semibold text-slate-900 outline-none focus:border-slate-200 focus:bg-white"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void persist()}
            placeholder="Название карточки"
          />
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="rounded-md bg-slate-100 px-2 py-0.5">Код: {card.id.slice(0, 8)}</span>
            <span className="rounded-md bg-slate-100 px-2 py-0.5">Статус: {card.column}</span>
            <span className={classNames("rounded-md px-2 py-0.5 font-semibold", importanceBadge(importance))}>
              {importanceLabel(importance)}
            </span>
            <button
              type="button"
              className={classNames(
                "inline-flex items-center gap-2 rounded-md px-2 py-0.5 font-semibold",
                paused ? "bg-amber-100 text-amber-900" : "border border-amber-200 bg-white text-amber-900 hover:bg-amber-50",
              )}
              title="Пауза"
              onMouseDown={(e) => {
                // Prevent title input blur -> persist() race which can overwrite paused state.
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
                  "grid h-4 w-4 place-items-center rounded border",
                  paused ? "border-amber-300 bg-amber-200" : "border-amber-200 bg-white",
                )}
                aria-hidden="true"
              >
                {paused ? "✓" : ""}
              </span>
              Пауза
            </button>
            {saveError ? <span className="rounded-md bg-rose-50 px-2 py-0.5 text-rose-800">Не сохранено</span> : null}
          </div>
        </div>
      }
      headerRight={
        <div className="flex items-center gap-2">
          <IconButton
            title="Закрыть"
            onClick={() => {
              if (deleting) {
                props.onClose();
                return;
              }
              void closeAndRefresh();
            }}
          >
            <IconX className="h-5 w-5" />
          </IconButton>
          <IconButton
            title="Удалить карточку"
            variant="danger"
            onClick={() => {
              if (!confirm("Удалить карточку?")) return;
              setSaveError(null);
              setDeleting(true);
              void Api.deleteCard(card.id)
                .then(async () => {
                  await props.onDeleted(); // only reload board; do not refetch deleted card
                  props.onClose();
                })
                .catch((e) => {
                  setDeleting(false);
                  setSaveError((e as Error).message);
                });
            }}
          >
            <IconTrash className="h-5 w-5" />
          </IconButton>
        </div>
      }
    >
      <div
        className="grid gap-4 lg:gap-0"
        style={
          isLg
            ? {
                gridTemplateColumns: `minmax(0, 1fr) ${dragging ? "12px" : "10px"} ${rightWidth}px`,
              }
            : undefined
        }
      >
        {/* Left */}
        <div className="grid gap-4 pr-0 lg:pr-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-2 text-sm font-semibold text-slate-900">Описание</div>
            <textarea
              className="min-h-[140px] w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-[#246c7c]"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              onBlur={() => void persist()}
              placeholder="Введите описание…"
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">Свойства</div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <div className="text-xs text-slate-600">Ответственный</div>
                <select
                  className="rounded-xl border border-slate-200 bg-white p-2 text-sm outline-none focus:border-[#246c7c]"
                  value={assignee}
                  disabled={!canManageCard}
                  onChange={(e) => {
                    if (!canManageCard) return;
                    setAssignee(e.target.value);
                    setTimeout(() => void persist(), 0);
                  }}
                >
                  <option value="">—</option>
                  {assignee && !props.allUsers.some((u) => u.email === assignee) ? (
                    <option value={assignee}>{assignee}</option>
                  ) : null}
                  {props.allUsers.map((u) => (
                    <option key={u.id} value={u.email}>
                      {u.name || u.email}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-1">
                <div className="text-xs text-slate-600">Срок исполнения</div>
                <input
                  type="datetime-local"
                  className="w-full rounded-xl border border-slate-200 bg-white p-2 text-sm outline-none focus:border-[#246c7c]"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  onBlur={() => void persist()}
                />
              </div>

              <label className="grid gap-1">
                <div className="text-xs text-slate-600">Важность</div>
                <div className="flex items-center gap-2">
                  <select
                    className="flex-1 rounded-xl border border-slate-200 bg-white p-2 text-sm font-semibold outline-none focus:border-[#246c7c]"
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
                    className={classNames("h-9 w-10 rounded-xl border border-slate-200", importanceBadge(importance))}
                    title={importanceLabel(importance)}
                    aria-label={importanceLabel(importance)}
                  />
                </div>
              </label>
            </div>

            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-slate-700">Участники</div>
                {canManageCard ? (
                  <button
                    type="button"
                    className="grid h-8 w-8 place-items-center rounded-lg bg-[#246c7c] text-white hover:opacity-90"
                    title="Добавить участника"
                    aria-label="Добавить участника"
                    onClick={() => setParticipantAddOpen((v) => !v)}
                  >
                    +
                  </button>
                ) : null}
              </div>
              {participantAddOpen && canManageCard ? (
                <div className="mt-2 flex items-center gap-2">
                  <select
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-2 text-sm outline-none focus:border-[#246c7c]"
                    value={participantAddUserId}
                    onChange={(e) => setParticipantAddUserId(e.target.value)}
                  >
                    <option value="">Выберите пользователя…</option>
                    {props.allUsers
                      .filter((u) => !participants.some((p) => p.user.id === u.id))
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name || u.email}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    className="grid h-10 w-10 place-items-center rounded-xl bg-[#246c7c] text-white hover:opacity-90 disabled:opacity-50"
                    disabled={!participantAddUserId}
                    title="Добавить"
                    aria-label="Добавить"
                    onClick={() => {
                      if (!canManageCard) return;
                      if (!card) return;
                      const userId = participantAddUserId;
                      if (!userId) return;
                      setParticipantError(null);
                      void Api.addParticipant(card.id, { userId })
                        .then((d) => {
                          const added = (d as any).participant as { id: string; email: string; name: string };
                          setParticipants((prev) =>
                            prev.some((p) => p.user.id === added.id) ? prev : [...prev, { user: added }],
                          );
                          setParticipantAddUserId("");
                          setParticipantAddOpen(false);
                          return props.onChanged();
                        })
                        .catch((err) => setParticipantError((err as Error).message));
                    }}
                  >
                    +
                  </button>
                </div>
              ) : null}
              {participantError ? <div className="mt-2 text-xs text-rose-700">{participantError}</div> : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {participants.length === 0 ? (
                  <div className="text-xs text-slate-500">Участников нет.</div>
                ) : (
                  participants.map((p) => (
                    <div
                      key={p.user.id}
                      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-800"
                      title={p.user.email}
                    >
                      <div className="max-w-[320px] truncate">
                        {p.user.name || p.user.email}
                      </div>
                      {canManageCard ? (
                        <button
                          type="button"
                          className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                          title="Удалить участника"
                          aria-label="Удалить участника"
                          onClick={() => {
                            if (!card) return;
                            setParticipantError(null);
                            void Api.removeParticipant(card.id, p.user.id)
                              .then(() => {
                                setParticipants((prev) => prev.filter((x) => x.user.id !== p.user.id));
                                return props.onChanged();
                              })
                              .catch((e) => setParticipantError((e as Error).message));
                          }}
                        >
                          <IconTrash className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">Вложения</div>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-lg bg-[#246c7c] text-white hover:opacity-90"
                onClick={() => uploadInputRef.current?.click()}
                title="Добавить файл"
              >
                +
              </button>
            </div>
            <input
              ref={uploadInputRef}
              type="file"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUploadSelectedName(f.name);
                e.target.value = "";
                void Api.uploadAttachment(card.id, f).then(() => {
                  setUploadSelectedName("");
                  return props.onChanged();
                });
              }}
            />
            {uploadSelectedName ? (
              <div className="mt-1 truncate text-xs text-slate-500" title={uploadSelectedName}>
                {compactFileName(uploadSelectedName, 70)}
              </div>
            ) : null}
            <div className="mt-3 grid gap-2">
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
                      <button
                        type="button"
                        className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                        onClick={() => void Api.deleteAttachment(a.id).then(props.onChanged)}
                        title="Удалить"
                        aria-label="Удалить"
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Splitter */}
        <div className="relative hidden lg:block">
          <div
            className="absolute inset-0 mx-auto w-[10px] cursor-col-resize"
            onMouseDown={(e) => {
              dragStateRef.current = { startX: e.clientX, startW: rightWidth };
              setDragging(true);
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
          >
            <div className="mx-auto h-full w-[2px] bg-slate-200" />
          </div>
        </div>

        {/* Right */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-2 text-sm font-semibold text-slate-900">Комментарии</div>
          <div className="grid max-h-[420px] gap-2 overflow-auto pr-1">
            {card.comments.length === 0 ? (
              <div className="text-xs text-slate-500">Комментариев нет.</div>
            ) : (
              card.comments.map((c) => (
                <div key={c.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 text-xs text-slate-600">
                      <span className="truncate">
                        {c.author ? <span className="font-semibold text-slate-900">{c.author}</span> : "Аноним"} •{" "}
                        {format(new Date(c.createdAt), "yyyy-MM-dd HH:mm")}
                      </span>
                    </div>
                    {(() => {
                      const authorId = (c as any).authorId as string | null | undefined;
                      const canManage = props.viewer.role === "ADMIN" || (!!authorId && authorId === props.viewer.id);
                      if (!canManage) return null;
                      return (
                        <div className="flex items-center gap-2">
                          <button
                            className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                            onClick={() => {
                              setEditingCommentId(c.id);
                              setEditingCommentBody(c.body ?? "");
                            }}
                            title="Редактировать"
                            aria-label="Редактировать"
                          >
                            <IconEdit />
                          </button>
                          <button
                            className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                            onClick={() => void Api.deleteComment(c.id).then(props.onChanged)}
                            title="Удалить"
                            aria-label="Удалить"
                          >
                            <IconTrash />
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                  {editingCommentId === c.id ? (
                    <div className="mt-2 grid gap-2">
                      <textarea
                        className="min-h-[80px] rounded-xl border border-slate-200 bg-white p-2 text-sm outline-none focus:border-[#246c7c]"
                        value={editingCommentBody}
                        onChange={(e) => setEditingCommentBody(e.target.value)}
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                          title="Отмена"
                          aria-label="Отмена"
                          onClick={() => {
                            setEditingCommentId(null);
                            setEditingCommentBody("");
                          }}
                        >
                          <IconX className="h-5 w-5" />
                        </button>
                        <button
                          className="grid h-9 w-9 place-items-center rounded-xl bg-[#246c7c] text-white hover:opacity-90 disabled:opacity-50"
                          disabled={!editingCommentBody.trim()}
                          title="Сохранить"
                          aria-label="Сохранить"
                          onClick={() => {
                            const body = editingCommentBody.trim();
                            if (!body) return;
                            void Api.updateComment(c.id, { body }).then(() => {
                              setEditingCommentId(null);
                              setEditingCommentBody("");
                              return props.onChanged();
                            });
                          }}
                        >
                          <IconCheck className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 whitespace-pre-wrap text-sm text-slate-900">{c.body}</div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="mt-3 grid gap-2">
            <div className="flex items-start gap-2">
              <textarea
                className="min-h-[80px] flex-1 rounded-xl border border-slate-200 bg-white p-2 text-sm outline-none focus:border-[#246c7c]"
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Текст комментария…"
              />
              <button
                className="grid h-10 w-10 place-items-center rounded-xl bg-[#246c7c] text-lg font-semibold text-white hover:opacity-90 disabled:opacity-50"
                disabled={!commentBody.trim()}
                title="Добавить комментарий"
                aria-label="Добавить комментарий"
                onClick={() => {
                  const body = commentBody.trim();
                  if (!body) return;
                  void Api.addComment(card.id, { body }).then(() => {
                    setCommentBody("");
                    return props.onChanged();
                  });
                }}
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
