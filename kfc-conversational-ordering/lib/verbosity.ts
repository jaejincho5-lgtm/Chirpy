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
 * Classify the customer's texting style. Thresholds tuned for Vietnamese
 * ordering chat: "ok"/"combo 9" (~2-8 chars) → terse; a normal request like
 * "cho mình 1 combo gà rán và 1 pepsi" (~34) → normal; a descriptive paragraph
 * (80+) → expansive.
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
      return "Phong cách khách: khách nhắn rất ngắn gọn — hãy trả lời cực ngắn, 1 câu, đi thẳng vào việc, không rào đón, tối đa 1 emoji.";
    case "expansive":
      return "Phong cách khách: khách nhắn dài và chi tiết — bạn có thể diễn giải ấm áp, đầy đủ hơn một chút (2-3 câu), nhưng vẫn không lan man.";
    case "normal":
      return null;
  }
}
