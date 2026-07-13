// Reply-length personalization. A judge's note: "learn whether the customer
// responds better to shorter or longer text." The honest, deterministic signal
// we already have is how the customer THEMSELVES types — a one-word "combo 9"
// texter wants a one-line reply; someone who writes full sentences tolerates a
// warmer, fuller answer. We mirror their verbosity.
//
// Pure + no storage: the web chat resends its whole history each turn and the
// channel path loads it from the convo store, so the caller just hands us the
// user's messages and we return a system-prompt hint (or null for the neutral
// middle, so the base prompt's own "concise" rule stands).

export type ReplyStyle = "terse" | "normal" | "expansive";

/** Mean character length of the customer's own messages, or null if none yet. */
export function averageUserMessageLength(userTexts: string[]): number | null {
  const lengths = userTexts.map((t) => t.trim().length).filter((n) => n > 0);
  if (lengths.length === 0) return null;
  return lengths.reduce((sum, n) => sum + n, 0) / lengths.length;
}

/**
 * Classify the customer's texting style. Thresholds tuned for ordering chat:
 * "ok"/"combo 9" (~2-8 chars) -> terse; a normal request like
 * "add one fried chicken combo and one pepsi" (~40) -> normal; a descriptive paragraph
 * (80+) -> expansive.
 */
export function replyStyleFor(userTexts: string[]): ReplyStyle {
  const avg = averageUserMessageLength(userTexts);
  if (avg === null) return "normal";
  if (avg <= 24) return "terse";
  if (avg >= 80) return "expansive";
  return "normal";
}

/** System-prompt line steering reply length, or null for the neutral default. */
export function verbosityHint(userTexts: string[]): string | null {
  switch (replyStyleFor(userTexts)) {
    case "terse":
      return "Customer style: very terse. Reply in one short sentence, direct and practical, max 1 emoji.";
    case "expansive":
      return "Customer style: detailed. You may answer warmly with 2-3 concise sentences, but do not ramble.";
    case "normal":
      return null;
  }
}
