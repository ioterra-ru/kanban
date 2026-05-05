/** Минимальный безопасный рендер подмножества Markdown в HTML (без внешних пакетов). */

import { isSafeAttachmentDownloadPath } from "../utils/commentAttachments";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatInline(s: string): string {
  const slots: string[] = [];
  const pushSlot = (html: string) => {
    const i = slots.length;
    slots.push(html);
    return `\0SLOT${i}\0`;
  };

  let x = s;
  x = x.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full, alt, url) => {
    const u = String(url).trim();
    if (!isSafeAttachmentDownloadPath(u)) return full;
    return pushSlot(
      `<img src="${escapeHtml(u)}" alt="${escapeHtml(String(alt))}" class="my-1 max-h-64 max-w-full rounded border border-slate-200 object-contain" loading="lazy" />`,
    );
  });
  x = x.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (full, label, url) => {
    const u = String(url).trim();
    if (!isSafeAttachmentDownloadPath(u)) return full;
    return pushSlot(
      `<a href="${escapeHtml(u)}" download class="text-[#246c7c] underline">${escapeHtml(String(label))}</a>`,
    );
  });

  x = escapeHtml(x);
  x = x.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  x = x.replace(/__(.+?)__/g, "<strong>$1</strong>");
  x = x.replace(/_([^_]+)_/g, "<em>$1</em>");
  x = x.replace(/`([^`]+)`/g, "<code class=\"rounded bg-slate-100 px-1 py-0.5 text-[0.9em]\">$1</code>");
  for (let i = 0; i < slots.length; i++) {
    x = x.replace(`\0SLOT${i}\0`, slots[i]);
  }
  return x;
}

export function renderMarkdownPreview(md: string): string {
  const raw = md ?? "";
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };

  for (let line of lines) {
    const trimmed = line.trimEnd();
    if (/^###\s+/.test(trimmed)) {
      closeLists();
      out.push(`<h3 class="mt-3 text-base font-bold text-slate-900">${formatInline(trimmed.replace(/^###\s+/, ""))}</h3>`);
      continue;
    }
    if (/^##\s+/.test(trimmed)) {
      closeLists();
      out.push(`<h2 class="mt-3 text-lg font-bold text-slate-900">${formatInline(trimmed.replace(/^##\s+/, ""))}</h2>`);
      continue;
    }
    if (/^#\s+/.test(trimmed)) {
      closeLists();
      out.push(`<h1 class="mt-3 text-xl font-bold text-slate-900">${formatInline(trimmed.replace(/^#\s+/, ""))}</h1>`);
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      closeLists();
      out.push(
        `<blockquote class="my-2 border-l-4 border-slate-300 pl-3 text-slate-700 italic">${formatInline(quote[1] ?? "")}</blockquote>`,
      );
      continue;
    }
    const ul = /^-\s+(.+)$/.exec(trimmed);
    if (ul) {
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        out.push('<ul class="my-2 list-disc pl-5 text-slate-800">');
        inUl = true;
      }
      out.push(`<li class="my-0.5">${formatInline(ul[1] ?? "")}</li>`);
      continue;
    }
    const ol = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (ol) {
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        out.push('<ol class="my-2 list-decimal pl-5 text-slate-800">');
        inOl = true;
      }
      out.push(`<li class="my-0.5">${formatInline(ol[1] ?? "")}</li>`);
      continue;
    }

    closeLists();
    if (trimmed === "") {
      out.push('<div class="h-2"></div>');
    } else {
      out.push(`<p class="my-1.5 leading-relaxed text-slate-800">${formatInline(trimmed)}</p>`);
    }
  }
  closeLists();
  return out.join("");
}
