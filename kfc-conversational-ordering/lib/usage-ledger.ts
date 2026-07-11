// C9 — cost-per-order ledger. In-memory per serverless instance (same demo
// tradeoff as lib/otp.ts): on Fluid Compute a continuous demo session stays on
// one warm instance, which is all the /backend cost line needs. Durable
// per-turn records live in kfc_agent_turns (lib/turn-log.ts) — this map is
// just the fast live counter.

export type LedgerUsage = {
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
};

type LedgerEntry = {
  turns: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  model: string;
  lastAt: string;
};

// USD per MTok: base input / cache READ (~0.1x) / cache WRITE (1.25x) / output.
// Four DISJOINT buckets — cost is a straight sum, never a subtraction (the old
// `input - cached` version zeroed real input and under-reported ~5x on the
// 2026-07-06 Opus baseline; see eval/run.ts for the same fix).
const RATES_PER_MTOK: Record<
  string,
  { input: number; cachedInput: number; cacheWrite: number; output: number }
> = {
  "anthropic/claude-opus-4-8": { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 },
  "anthropic/claude-sonnet-5": { input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 },
  "anthropic/claude-haiku-4-5": { input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 },
  // OpenAI list prices (approx — verify against current openai.com/pricing).
  // OpenAI has no cache-WRITE surcharge and we never populate cacheWriteTokens
  // for it (that bucket is read from Anthropic metadata), so cacheWrite is inert.
  "openai/gpt-4o": { input: 2.5, cachedInput: 1.25, cacheWrite: 2.5, output: 10 },
  "openai/gpt-4o-mini": { input: 0.15, cachedInput: 0.075, cacheWrite: 0.15, output: 0.6 },
};

const USD_TO_VND = 25_400;

/** Straight-sum cost over the four disjoint buckets; null for unknown models. */
export function estimateCostUsd(
  model: string,
  buckets: { inputTokens: number; cachedInputTokens: number; cacheWriteTokens: number; outputTokens: number },
): number | null {
  const rates = RATES_PER_MTOK[model];
  if (!rates) return null;
  return (
    (buckets.inputTokens * rates.input +
      buckets.cachedInputTokens * rates.cachedInput +
      buckets.cacheWriteTokens * rates.cacheWrite +
      buckets.outputTokens * rates.output) /
    1_000_000
  );
}

export function usdToVnd(usd: number): number {
  return Math.round(usd * USD_TO_VND);
}

const ledger = new Map<string, LedgerEntry>();

/**
 * Cache WRITE tokens live in per-step provider metadata, not in totalUsage
 * (which only carries cache READS as cachedInputTokens). Sum them across the
 * tool-loop steps of a generateText/streamText result.
 */
export function sumCacheWriteTokens(
  steps: Array<{ providerMetadata?: Record<string, unknown> }> | undefined,
): number {
  let total = 0;
  for (const step of steps ?? []) {
    const anthropic = step.providerMetadata?.anthropic as Record<string, unknown> | undefined;
    const written = anthropic?.cacheCreationInputTokens;
    if (typeof written === "number") total += written;
  }
  return total;
}

export function recordUsage(customerId: string, model: string, usage: LedgerUsage) {
  const entry = ledger.get(customerId) ?? {
    turns: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    model,
    lastAt: new Date().toISOString(),
  };
  entry.turns += 1;
  entry.inputTokens += usage.inputTokens ?? 0;
  entry.cachedInputTokens += usage.cachedInputTokens ?? 0;
  entry.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
  entry.outputTokens += usage.outputTokens ?? 0;
  entry.model = model;
  entry.lastAt = new Date().toISOString();
  ledger.set(customerId, entry);
}

export type UsageSummary = {
  turns: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  model: string;
  estUsd: number | null;
  estVnd: number | null;
};

export function usageSummary(customerId: string): UsageSummary | null {
  const entry = ledger.get(customerId);
  if (!entry) return null;
  const estUsd = estimateCostUsd(entry.model, entry);
  return {
    turns: entry.turns,
    inputTokens: entry.inputTokens,
    cachedInputTokens: entry.cachedInputTokens,
    cacheWriteTokens: entry.cacheWriteTokens,
    outputTokens: entry.outputTokens,
    model: entry.model,
    estUsd,
    estVnd: estUsd === null ? null : usdToVnd(estUsd),
  };
}

export function resetUsage(customerId: string) {
  ledger.delete(customerId);
}
