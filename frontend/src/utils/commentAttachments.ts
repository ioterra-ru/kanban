/** UUID paths /api/attachments/:id/download produced by this app for comment files. */
const ATTACHMENT_PATH_RE =
  /^\/api\/attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/download$/i;

export function isSafeAttachmentDownloadPath(pathOrUrl: string): boolean {
  const t = pathOrUrl.trim();
  if (ATTACHMENT_PATH_RE.test(t)) return true;
  try {
    const u = new URL(t);
    return ATTACHMENT_PATH_RE.test(u.pathname);
  } catch {
    return false;
  }
}

export function extractAttachmentIdsFromMarkdown(body: string): string[] {
  const ids = new Set<string>();
  const re = /\/api\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/download/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1]) ids.add(m[1].toLowerCase());
  }
  return [...ids];
}

export function markdownForUploadedAttachment(att: { id: string; filename: string; mimeType: string }): string {
  const path = `/api/attachments/${att.id}/download`;
  const label = att.filename.replace(/[[\]]/g, "");
  if (att.mimeType.startsWith("image/")) return `\n\n![${label}](${path})\n`;
  return `\n\n[${label}](${path})\n`;
}
