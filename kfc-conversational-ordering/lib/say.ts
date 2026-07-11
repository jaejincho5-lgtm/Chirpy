// Pure text helpers for extracting the customer-facing prose from an agent
// reply. The model sometimes speaks first, then appends its JSON contract
// (optionally in a ```json fence). Callers get the clean prose only, never raw
// JSON, and no markdown. Lives in its own module (no node:crypto import) so it
// is safe to use in client bundles — the /voice page speaks extractSay(text).

export function extractSay(text: string): string {
  return stripMarkdown(extractProse(text));
}

function stripMarkdown(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "");
}

function extractProse(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/);
  if (fence && typeof fence.index === "number") {
    const prose = trimmed.slice(0, fence.index).trim();
    try {
      const parsed = JSON.parse(fence[1]) as { say?: string };
      if (typeof parsed.say === "string") return prose || parsed.say;
    } catch {
      // fall through
    }
    if (prose) return prose;
  }
  // Unfenced trailing contract: prose followed by a raw {"say": ...} object.
  const marker = trimmed.search(/\{\s*"say"\s*:/);
  if (marker > 0) {
    const prose = trimmed.slice(0, marker).trim();
    const tail = trimmed.slice(marker);
    try {
      const parsed = JSON.parse(tail.slice(0, tail.lastIndexOf("}") + 1)) as { say?: string };
      if (typeof parsed.say === "string") return prose || parsed.say;
    } catch {
      // fall through to prose
    }
    if (prose) return prose;
  }
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { say?: string };
      if (typeof parsed.say === "string") return parsed.say;
    } catch {
      // fall through
    }
  }
  return text;
}
