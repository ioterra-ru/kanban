export function compactMiddle(text: string, maxLen: number) {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  if (maxLen < 10) return `${t.slice(0, maxLen - 1)}…`;
  const head = Math.ceil((maxLen - 1) * 0.6);
  const tail = maxLen - 1 - head;
  return `${t.slice(0, head)}…${t.slice(-tail)}`;
}

export function compactFileName(filename: string, maxLen = 52) {
  const name = filename.trim();
  if (name.length <= maxLen) return name;
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === name.length - 1) return compactMiddle(name, maxLen);
  const base = name.slice(0, lastDot);
  const ext = name.slice(lastDot + 1);
  const extPart = `.${ext}`;
  const allowedBaseLen = maxLen - extPart.length;
  if (allowedBaseLen <= 4) return compactMiddle(name, maxLen);
  return `${compactMiddle(base, allowedBaseLen)}${extPart}`;
}

