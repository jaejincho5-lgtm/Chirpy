// Which menu items did the ambassador just talk about? Pure helper behind the
// /voice item popups (docs/FEATURE_ITEM_POPUPS.md). No NLP: the agent surfaces
// items only through search_menu / interpret_craving tool calls, whose outputs
// already sit in the useChat message parts — we read those, then keep the ones
// the spoken line actually names (fallback: top-3 by score when the model
// paraphrased). Client-safe: no node imports (same constraint as lib/say.ts).

import { normalizeText, type MenuMatch } from "./menu";
import { extractSay } from "./say";

export type VoicePart = { type?: string; state?: string; output?: unknown; text?: string };
export type VoiceMessage = { id?: string; role?: string; parts?: VoicePart[] };

// reorder_usual is deliberately excluded (§5.2): it puts items straight in the
// cart, and the receipt animation already covers that.
const SURFACING_TOOLS = new Set(["tool-search_menu", "tool-interpret_craving"]);
const FALLBACK_COUNT = 3;

function lastAssistantMessage(messages: VoiceMessage[]): VoiceMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") return messages[i];
  }
  return null;
}

/** The id of the assistant turn the popups are keyed on (null before any reply). */
export function lastAssistantId(messages: VoiceMessage[]): string | null {
  return lastAssistantMessage(messages)?.id ?? null;
}

/**
 * Items the agent surfaced in its most recent turn. Dedupes by catalogId across
 * tools, prefers items named in the spoken say text, falls back to the top
 * FALLBACK_COUNT by score when the text names none, caps at `max`.
 */
export function surfacedItems(messages: VoiceMessage[], max = 4): MenuMatch[] {
  const assistant = lastAssistantMessage(messages);
  if (!assistant || max <= 0) return [];

  const found = new Map<string, MenuMatch>();
  for (const part of assistant.parts ?? []) {
    if (!part?.type || !SURFACING_TOOLS.has(part.type)) continue;
    // Streaming parts carry state ("input-available" etc.) before the tool
    // result exists; only a completed output counts.
    if (part.state !== undefined && part.state !== "output-available") continue;
    if (!part.output || typeof part.output !== "object") continue;
    const matches = (part.output as { matches?: unknown }).matches;
    if (!Array.isArray(matches)) continue;
    for (const raw of matches) {
      const match = raw as Partial<MenuMatch> | null;
      if (!match || typeof match.catalogId !== "string" || typeof match.name !== "string") continue;
      if (!found.has(match.catalogId)) found.set(match.catalogId, match as MenuMatch);
    }
  }
  if (!found.size) return [];

  const say = normalizeText(
    extractSay(
      (assistant.parts ?? [])
        .filter((part) => part?.type === "text")
        .map((part) => part.text ?? "")
        .join(""),
    ),
  );

  const all = [...found.values()];
  const named = say
    ? all.filter((match) => {
        const name = normalizeText(match.name ?? "");
        const vietnamese = normalizeText(match.vietnameseName ?? "");
        return (name.length > 0 && say.includes(name)) || (vietnamese.length > 0 && say.includes(vietnamese));
      })
    : [];

  const chosen = (named.length ? named : all).slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  // Paraphrase fallback stays small (§3.1): never a wall of 6 cards.
  return chosen.slice(0, named.length ? max : Math.min(max, FALLBACK_COUNT));
}
