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
    const prose = stripFenceArtifacts(trimmed.slice(0, marker));
    const tail = trimmed.slice(marker);
    try {
      const parsed = JSON.parse(tail.slice(0, tail.lastIndexOf("}") + 1)) as { say?: string };
      if (typeof parsed.say === "string") return prose || parsed.say;
    } catch {
      // fall through to prose
    }
    if (prose) return prose;
    return salvageSay(tail) ?? "";
  }
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { say?: string };
      if (typeof parsed.say === "string") return parsed.say;
    } catch {
      // fall through
    }
    return salvageSay(trimmed) ?? text;
  }
  return stripFenceArtifacts(trimmed) ? text : "";
}

// A reply cut off inside the contract leaves a dangling fence opener before the
// JSON — that opener is never prose, and speaking "json" aloud kills the voice.
function stripFenceArtifacts(text: string): string {
  return text.replace(/```(?:json)?\s*$/i, "").trim();
}

// Last-resort for a contract truncated mid-stream: pull the say string value
// out of unparseable JSON so the voice never reads raw JSON or fence markers.
function salvageSay(text: string): string | null {
  const match = text.match(/"say"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return null;
  }
}
