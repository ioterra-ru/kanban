import { forwardRef, useCallback, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { renderMarkdownPreview } from "../markdown/renderPreview";

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function IconMarkdownSource(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={props.className ?? "h-4 w-4"}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
    </svg>
  );
}

function IconPreview(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={props.className ?? "h-4 w-4"}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function insertTextarea(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  onValue: (next: string, cursor: number) => void,
): void {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const v = textarea.value;
  const sel = v.slice(start, end);
  const next = v.slice(0, start) + before + sel + after + v.slice(end);
  const cursor = start + before.length + sel.length;
  onValue(next, cursor);
  window.requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(cursor, cursor);
  });
}

function insertLinePrefix(textarea: HTMLTextAreaElement, prefix: string, onValue: (next: string, cursor: number) => void): void {
  const v = textarea.value;
  const start = textarea.selectionStart;
  const lineStart = v.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = v.indexOf("\n", start);
  const end = lineEnd === -1 ? v.length : lineEnd;
  const line = v.slice(lineStart, end);
  const stripped = line.replace(/^(#{1,3}\s+|-\s+|\d+\.\s+|>\s?)/, "");
  const nextLine = prefix + stripped;
  const next = v.slice(0, lineStart) + nextLine + v.slice(end);
  const newPos = lineStart + nextLine.length;
  onValue(next, newPos);
  window.requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(newPos, newPos);
  });
}

type TabMode = "markdown" | "visual";

export type MarkdownRichEditorProps = {
  value: string;
  onChange: (v: string, selectionStart?: number) => void;
  readOnly?: boolean;
  minHeight?: string;
  onBlur?: () => void;
  /** Подпись для панели вкладок (доступность). */
  ariaLabel?: string;
};

export const MarkdownRichEditor = forwardRef<HTMLTextAreaElement, MarkdownRichEditorProps>(function MarkdownRichEditor(props, ref) {
  const id = useId();
  const taRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => taRef.current as HTMLTextAreaElement, []);
  const [tab, setTab] = useState<TabMode>("markdown");

  const previewHtml = useMemo(() => renderMarkdownPreview(props.value), [props.value]);

  const run = useCallback(
    (fn: (ta: HTMLTextAreaElement) => void) => {
      if (props.readOnly) return;
      const ta = taRef.current;
      if (!ta) return;
      fn(ta);
    },
    [props.readOnly],
  );
  const emit = props.onChange;

  if (props.readOnly) {
    return (
      <div
        className="prose-markdown min-h-[4rem] rounded-b-xl border-t border-slate-100 bg-white px-2 py-2 text-sm [&_a]:text-[#246c7c] [&_a]:underline"
        dangerouslySetInnerHTML={{ __html: previewHtml }}
      />
    );
  }

  const btn =
    "rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40";

  return (
    <div className="rounded-xl border border-slate-200 bg-white focus-within:border-[#246c7c]">
      <div
        className={classNames(
          "flex flex-wrap items-center gap-2 border-b border-slate-100 px-2 py-1",
          tab === "markdown" ? "justify-between" : "justify-end",
        )}
      >
        {tab === "markdown" ? (
          <div className="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label={props.ariaLabel ?? "Форматирование"}>
            <button type="button" className={btn} title="Заголовок 1" onClick={() => run((ta) => insertLinePrefix(ta, "# ", emit))}>
              H1
            </button>
            <button type="button" className={btn} title="Заголовок 2" onClick={() => run((ta) => insertLinePrefix(ta, "## ", emit))}>
              H2
            </button>
            <button type="button" className={btn} title="Заголовок 3" onClick={() => run((ta) => insertLinePrefix(ta, "### ", emit))}>
              H3
            </button>
            <span className="mx-0.5 h-4 w-px bg-slate-200" aria-hidden />
            <button type="button" className={btn} title="Жирный" onClick={() => run((ta) => insertTextarea(ta, "**", "**", emit))}>
              B
            </button>
            <button type="button" className={btn} title="Курсив" onClick={() => run((ta) => insertTextarea(ta, "_", "_", emit))}>
              I
            </button>
            <button type="button" className={btn} title="Код" onClick={() => run((ta) => insertTextarea(ta, "`", "`", emit))}>
              code
            </button>
            <span className="mx-0.5 h-4 w-px bg-slate-200" aria-hidden />
            <button type="button" className={btn} title="Маркированный список" onClick={() => run((ta) => insertLinePrefix(ta, "- ", emit))}>
              •
            </button>
            <button type="button" className={btn} title="Нумерованный список" onClick={() => run((ta) => insertLinePrefix(ta, "1. ", emit))}>
              1.
            </button>
            <button type="button" className={btn} title="Цитата" onClick={() => run((ta) => insertLinePrefix(ta, "> ", emit))}>
              “
            </button>
          </div>
        ) : null}
        <div className="flex shrink-0 rounded-lg border border-slate-200/90 bg-slate-50/80 p-0.5">
          <button
            type="button"
            id={`${id}-tab-md`}
            title="Разметка"
            aria-label="Разметка"
            className={classNames(
              "grid place-items-center rounded-md p-1.5 transition-colors",
              tab === "markdown"
                ? "bg-[#246c7c]/12 text-[#1a4d58] ring-1 ring-[#246c7c]/20"
                : "text-slate-600 hover:bg-white/80 hover:text-slate-800",
            )}
            onClick={() => setTab("markdown")}
          >
            <IconMarkdownSource />
          </button>
          <button
            type="button"
            id={`${id}-tab-vis`}
            title="Просмотр"
            aria-label="Просмотр"
            className={classNames(
              "grid place-items-center rounded-md p-1.5 transition-colors",
              tab === "visual"
                ? "bg-[#246c7c]/12 text-[#1a4d58] ring-1 ring-[#246c7c]/20"
                : "text-slate-600 hover:bg-white/80 hover:text-slate-800",
            )}
            onClick={() => setTab("visual")}
          >
            <IconPreview />
          </button>
        </div>
      </div>
      {tab === "markdown" ? (
        <textarea
          ref={taRef}
          className="w-full resize-y border-0 bg-transparent p-2 text-sm text-slate-900 outline-none"
          style={{ minHeight: props.minHeight ?? "140px" }}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value, e.target.selectionStart)}
          onSelect={(e) => props.onChange(e.currentTarget.value, e.currentTarget.selectionStart)}
          onBlur={() => props.onBlur?.()}
          aria-labelledby={`${id}-tab-md`}
        />
      ) : (
        <div
          className="prose-markdown max-h-[min(50vh,28rem)] min-h-[8rem] overflow-auto border-t border-slate-100 px-2 py-2 text-sm [&_a]:text-[#246c7c] [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
          aria-labelledby={`${id}-tab-vis`}
        />
      )}
    </div>
  );
});

export function MarkdownHtmlBlock(props: { source: string; className?: string }) {
  const html = useMemo(() => renderMarkdownPreview(props.source), [props.source]);
  return (
    <div
      className={classNames(
        "prose-markdown text-sm leading-relaxed text-slate-800 [&_a]:text-[#246c7c] [&_a]:underline",
        props.className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
