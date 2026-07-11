import assert from "node:assert/strict";
import type { ModelMessage } from "ai";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addToCart,
  compactOrderState,
  createOrder,
  setLoyalty,
  setOtpRequested,
  setOtpVerified,
  setPlacedOrder,
  setQuote,
  type Order,
} from "../lib/order";
import { createMatchId, getCatalogEntry, searchMenu } from "../lib/menu";
import { applyVoucher, checkLoyalty, placeOrder, quoteOrder } from "../lib/oms";
import { otpProvider } from "../lib/otp";
import { optimizeBill } from "../lib/combos";
import { interpretCraving } from "../lib/cravings";
import { suggestAddons } from "../lib/reco/suggest";
import { runPersonalizationSuite } from "./personalization";
import { runNudgeSuite } from "./nudge";
import { runReengageSuite } from "./reengage";
import { clearOutOfStock, setOutOfStock } from "../lib/demo";
import { getHistoryStore, resetInMemoryHistory } from "../lib/history-store";
import { generateCustomerHistory, generatePersona } from "../lib/reco/pos-sim";
import { createAgentCoreTraceContext, logAgentCoreObservation } from "../lib/agentcore-observability";

// Expose the dev code so the deterministic lib suite can exercise verify_otp.
process.env.OTP_EXPOSE_DEV_CODE = "1";

type EvalCase = {
  id: string;
  /** Single-turn prompt. Agent cases may use multi_turn instead. */
  input?: string;
  /** Sequential user turns driven through ONE runtime (final state asserted). */
  multi_turn?: string[];
  intent:
    | "add_to_cart"
    | "voucher"
    | "loyalty"
    | "quote"
    | "otp_request"
    | "otp_verify"
    | "place_order"
    | "handoff"
    | "craving"
    | "optimize"
    | "greeting";
  suite?: "agent";
  expect_item?: string;
  expect_item_any?: string[];
  expect_tools?: string[];
  expect_savings_min?: number;
  expect_final_stage?: string;
  expect_reply_mentions_usual?: boolean;
  expect_voucher_retained?: string;
  forbid_suggestion?: string;
  /** Regex that must NOT match the final customer-facing reply (the JSON contract's `say`). */
  forbid_reply_contains?: string;
  /** Regex that MUST match the final customer-facing reply. */
  expect_reply_matches?: string;
  /** Adversarial: assert NO voucher ended up applied (fabricated/invalid codes). */
  forbid_voucher?: boolean;
  setup?: {
    oos?: string[];
    historyOrders?: number;
    declined?: string[];
  };
  voucher?: string;
};

const here = dirname(fileURLToPath(import.meta.url));
const cases: EvalCase[] = readFileSync(join(here, "cases.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const libCases = cases.filter((testCase) => testCase.suite !== "agent");

// ---------------------------------------------------------------------------
// SUITE 1 - LIB UNIT TESTS (deterministic; does NOT exercise the LLM agent)
// ---------------------------------------------------------------------------

type LibScore = {
  completed: boolean;
  intentRegexMatch: boolean;
  voucher: boolean | null;
  handoff: boolean | null;
};

function detectIntent(input: string): EvalCase["intent"] {
  const text = input.toLowerCase();
  if (/(nhan vien|nguoi that|human|person|support|dispute|sai)/.test(text)) return "handoff";
  if (/(otp|ma xac nhan)/.test(text) && /\d{4,}/.test(text)) return "otp_verify";
  if (/(otp|ma xac nhan|gui ma)/.test(text)) return "otp_request";
  if (/(dat hang|place|confirm order|thanh toan)/.test(text)) return "place_order";
  if (/(tong tien|eta|giao|pickup|store|quote)/.test(text)) return "quote";
  if (/(diem|points|loyalty|thanh vien)/.test(text)) return "loyalty";
  if (/(voucher|kfc20|freeship|lunch50|ma giam gia)/.test(text)) return "voucher";
  return "add_to_cart";
}

async function scoreCaseLib(testCase: EvalCase): Promise<LibScore> {
  // Lib cases are always single-turn; multi_turn is an agent-suite concept.
  const input = testCase.input ?? "";
  const predictedIntent = detectIntent(input);
  const intentRegexMatch = predictedIntent === testCase.intent;
  let order = createOrder();
  let voucher: boolean | null = null;
  let handoff: boolean | null = null;
  let completed = false;

  if (testCase.intent === "add_to_cart") {
    const match = searchMenu(input).matches[0];
    completed = Boolean(match && (!testCase.expect_item || match.catalogId === testCase.expect_item));
    if (match) {
      order = addToCart(order, {
        source: "search_menu",
        catalogId: match.catalogId,
        matchId: match.matchId,
        quantity: /two|2|hai/.test(input.toLowerCase()) ? 2 : 1,
      });
      completed = completed && order.cart.length > 0;
    }
  }

  if (testCase.intent === "voucher") {
    const baseMatch = searchMenu("big combo 4 nguoi").matches[0];
    order = addToCart(order, {
      source: "search_menu",
      catalogId: baseMatch.catalogId,
      matchId: baseMatch.matchId,
      quantity: 1,
    });
    const code = testCase.voucher ?? "KFC20";
    const result = await applyVoucher(order, code);
    voucher = result.ok;
    completed = result.ok;
  }

  if (testCase.intent === "loyalty") {
    const result = await checkLoyalty("demo-vip", true);
    order = setLoyalty(order, result.redemption);
    completed = order.loyalty?.pointsRedeemed === 12000;
  }

  if (testCase.intent === "quote") {
    const quote = quoteOrder(order, /pickup|store/.test(input.toLowerCase()) ? "pickup" : "delivery");
    order = setQuote(order, quote);
    completed = Boolean(order.quote);
  }

  if (testCase.intent === "otp_request") {
    const key = `lib_${testCase.id}`;
    const requested = await otpProvider.request(key, "0901234567");
    if (requested.ok) {
      order = setOtpRequested(order, {
        maskedPhone: requested.maskedPhone,
        requestedAt: requested.requestedAt,
        expiresAt: requested.expiresAt,
        verified: false,
      });
      completed = Boolean(requested.expiresAt);
    }
  }

  if (testCase.intent === "otp_verify") {
    const key = `lib_${testCase.id}`;
    const requested = await otpProvider.request(key, "0901234567");
    if (requested.ok) {
      const verified = await otpProvider.verify(key, requested.devCode ?? "");
      if (verified.ok) order = setOtpVerified(order);
      completed = await otpProvider.isVerified(key);
    }
  }

  if (testCase.intent === "place_order") {
    const key = `lib_${testCase.id}`;
    const match = searchMenu("combo 1 mieng ga ran").matches[0];
    order = addToCart(order, { source: "search_menu", catalogId: match.catalogId, matchId: match.matchId, quantity: 1 });
    const requested = await otpProvider.request(key, "0901234567");
    if (requested.ok) {
      const verified = await otpProvider.verify(key, requested.devCode ?? "");
      if (verified.ok) order = setOtpVerified(order);
      const placed = placeOrder(order, "cod", await otpProvider.isVerified(key));
      if (placed.ok) order = setPlacedOrder(order, placed.placedOrder);
      completed = Boolean(order.placedOrder?.orderNumber);
    }
  }

  if (testCase.intent === "handoff") {
    handoff = predictedIntent === "handoff";
    completed = handoff;
  }

  return { completed, intentRegexMatch, voucher, handoff };
}

async function runLibSuite() {
  const scores = await Promise.all(libCases.map(scoreCaseLib));
  const completed = scores.filter((s) => s.completed).length;
  const intentRegex = scores.filter((s) => s.intentRegexMatch).length;
  const voucherScores = scores.filter((s) => s.voucher !== null);
  const voucherPassed = voucherScores.filter((s) => s.voucher).length;
  const handoffScores = scores.filter((s) => s.handoff !== null);
  const handoffPassed = handoffScores.filter((s) => s.handoff).length;

  console.log("=== SUITE 1: LIB UNIT TESTS (deterministic, not the agent) ===");
  console.log(
    `LIB HEADLINE: ${completed}/${libCases.length} lib-pipeline flows completed | ` +
      `${Math.round((100 * intentRegex) / libCases.length)}% intent-regex accuracy (lib heuristic, NOT agent NLU) | ` +
      `voucher ${voucherPassed}/${voucherScores.length} | handoff ${handoffPassed}/${handoffScores.length}`,
  );
  if (completed < libCases.length) {
    console.log(`  (${libCases.length - completed} lib flows did not complete - see cases.jsonl)`);
  }
  await runSuite1Extensions();
}

async function runSuite1Extensions() {
  // Official-menu combo math: zinger a la carte 56+20+17=93k vs Combo Burger
  // Zinger 79k -> 14k; Big Combo shape 332k itemized vs 279k -> 53k.
  const zingerProposal = optimizeBill(addExact(addExact(addExact(createOrder(), "zinger-burger"), "fries-regular"), "pepsi-medium"));
  assert.equal(zingerProposal?.savingsVnd, 14000);

  let family = createOrder();
  family = addExact(family, "fried-chicken-2pc", 2);
  family = addExact(family, "zinger-burger", 2);
  family = addExact(family, "fries-regular", 1);
  family = addExact(family, "pepsi-std", 4);
  assert.equal(optimizeBill(family)?.savingsVnd, 53000);

  let paid = addExact(createOrder(), "zinger-burger");
  paid = addExact(paid, "fries-regular", 1, ["fries-large"]);
  paid = addExact(paid, "pepsi-medium");
  assert.equal(optimizeBill(paid), null);

  const craving = interpretCraving("gion gion cay cay duoi 100k");
  assert.ok(["tenders-3pc", "zinger-burger", "burger-ga-yo"].includes(craving.matches[0]?.catalogId ?? ""));
  const light = interpretCraving("something light not spicy under 30k");
  assert.ok(["coleslaw", "seaweed-soup", "7up-medium", "lipton-medium", "egg-tart", "fries-regular"].includes(light.matches[0]?.catalogId ?? ""));

  const complete = suggestAddons(
    [
      { catalogId: "combo-zinger", quantity: 1 },
      { catalogId: "fries-regular", quantity: 1 },
      { catalogId: "pepsi-medium", quantity: 1 },
    ],
    { weather: "clear", hour: 12 },
    null,
  );
  assert.equal(complete.decision, "silent");

  const clear = suggestAddons([{ catalogId: "zinger-burger", quantity: 1 }], { weather: "clear", hour: 12 }, null);
  const rainy = suggestAddons([{ catalogId: "zinger-burger", quantity: 1 }], { weather: "rainy", hour: 12 }, null);
  assert.notEqual(clear.suggestion?.catalogId, rainy.suggestion?.catalogId);
  assert.equal(rainy.suggestion?.catalogId, "seaweed-soup");

  // E13-5 · OTP brute force: 5 attempts max; afterwards even the REAL code is
  // rejected and the session can never reach verified.
  const bruteKey = "lib_brute_force";
  const bruteRequest = await otpProvider.request(bruteKey, "0900000000");
  assert.ok(bruteRequest.ok, "brute-force OTP request should succeed");
  const wrongCode = bruteRequest.devCode === "000000" ? "000001" : "000000";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await otpProvider.verify(bruteKey, wrongCode)).ok, false, "wrong OTP rejected");
  }
  const lockedOut = await otpProvider.verify(bruteKey, bruteRequest.devCode ?? "");
  assert.equal(lockedOut.ok, false, "correct code rejected after attempt cap");
  assert.ok(!lockedOut.ok && lockedOut.code === "too_many_attempts", "lockout reason is too_many_attempts");
  assert.equal(await otpProvider.isVerified(bruteKey), false, "brute-forced session never verifies");

  console.log("LIB EXTENSIONS: combo, craving, silence, rainy-flip, and OTP brute-force assertions passed");
}

function addExact(order: Order, catalogId: string, quantity = 1, optionIds: string[] = []) {
  return addToCart(order, {
    source: "search_menu",
    catalogId,
    matchId: createMatchId(catalogId),
    quantity,
    optionIds,
  });
}

// ---------------------------------------------------------------------------
// SUITE 2 - AGENT-LEVEL EVAL (drives the real LLM tool-calling loop)
// ---------------------------------------------------------------------------

const EXPECTED_TOOLS: Record<EvalCase["intent"], string> = {
  add_to_cart: "add_to_cart",
  voucher: "apply_voucher",
  loyalty: "check_loyalty",
  quote: "quote_order",
  otp_request: "request_otp",
  otp_verify: "verify_otp",
  place_order: "place_order",
  handoff: "handoff_to_human",
  craving: "interpret_craving",
  optimize: "optimize_bill",
  greeting: "get_customer_profile",
};

async function runAgentSuite() {
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.log("\n=== SUITE 2: AGENT-LEVEL EVAL ===");
    console.log("SKIPPED (no AI_GATEWAY_API_KEY) - set AI_GATEWAY_API_KEY to run the real agent cases. (exit 0)\n");
    return;
  }

  const { generateText, stepCountIs } = await import("ai");
  const { createAgentRuntime } = await import("../lib/agent");
  const { AGENT_MODEL } = await import("../lib/ai");

  // EVAL_CASE=id1,id2 runs specific cases (surgical triage). Otherwise the agent
  // suite runs ONLY suite:"agent" cases. The lib-pipeline cases (quote/otp/place/
  // nlu intents) are scored deterministically by Suite 1's regex — driving them
  // through the LLM costs a real API call, can never pass at the agent level (no
  // cart/context is seeded for them), and pollutes the headline denominator.
  // Running the full 58 through Opus is what turned a ~$1 run into ~$5.
  const caseFilter = process.env.EVAL_CASE?.split(",").map((id) => id.trim()).filter(Boolean);
  const suiteCases = caseFilter?.length
    ? cases.filter((c) => caseFilter.includes(c.id))
    : cases.filter((c) => c.suite === "agent");

  let passed = 0;
  const failures: string[] = [];
  // Token/cost accounting so a run's spend is visible in the output, never a surprise.
  let totalInputTokens = 0;
  let totalCachedTokens = 0;
  let totalCacheWriteTokens = 0;
  let totalOutputTokens = 0;
  // B6: wall-clock per case (all turns incl. tool loops) → p50/p95 in the footer.
  const latencies: { id: string; ms: number }[] = [];
  // Per-case outcomes → adversarial/teencode sub-headlines + turns-to-order split.
  const caseResults: { id: string; passed: boolean; turns: number; placed: boolean; hasHistory: boolean }[] = [];

  for (const testCase of suiteCases) {
    resetInMemoryHistory();
    clearOutOfStock();
    const sessionKey = `agent_eval_${testCase.id}`;
    const customerId = `agent_${testCase.id.replace(/[^a-z0-9_-]/gi, "_").toLowerCase()}`;
    const agentCoreTrace = createAgentCoreTraceContext({
      sessionKey,
      customerId,
      channel: "eval",
      operation: "npm run eval",
    });
    logAgentCoreObservation(agentCoreTrace, {
      event: "eval.case_start",
      caseId: testCase.id,
      intent: testCase.intent,
    });
    const initialOrder = await prepareAgentCase(testCase, customerId);
    const runtime = createAgentRuntime({
      sessionKey,
      customerId,
      initialOrder,
      orderContext: { weather: "clear", hour: 12 },
    });
    const calledTools: string[] = [];
    const caseStartedAt = performance.now();

    try {
      // Multi-turn cases drive sequential user messages through ONE runtime,
      // carrying the full message history (incl. tool calls) between turns —
      // exactly the shape where the live transcript fell apart (P0-1).
      const turns = testCase.multi_turn ?? [testCase.input ?? ""];
      // System prompt as a cached message: tools + system render ahead of the
      // conversation, so one breakpoint here caches both across every step of
      // every case in the run (cache reads bill ~0.1x of base input).
      const messages: ModelMessage[] = [
        {
          role: "system",
          content: runtime.system,
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        },
      ];
      // Preloaded-state cases: surface the server-side order state exactly like
      // lib/channel.ts does in production (uncached, AFTER the cache breakpoint).
      // Without this the agent is blind to the preload and e.g. re-runs OTP.
      if (initialOrder.cart.length > 0) {
        messages.push({
          role: "system",
          content: `Current server-side order state (source of truth; these lines are ALREADY in the cart — never re-add them): ${JSON.stringify(compactOrderState(initialOrder))}`,
        });
      }
      let finalText = "";
      for (const turn of turns) {
        messages.push({ role: "user", content: turn });
        const result = await generateText({
          model: AGENT_MODEL,
          messages,
          tools: runtime.tools,
          stopWhen: stepCountIs(8),
        });
        for (const step of result.steps) {
          for (const call of step.toolCalls ?? []) calledTools.push(call.toolName);
          // Cache WRITES (billed ~1.25x input) live in provider metadata, NOT in
          // usage.cachedInputTokens (that's cache READS at ~0.1x). Omitting them is
          // half of why the old estimate under-reported ~5x: on a multi-minute run
          // the 5-min cache TTL expires and the big system+tools prompt is
          // re-written to cache repeatedly, each write at full-plus rate.
          const anthropicMeta = step.providerMetadata?.anthropic as Record<string, unknown> | undefined;
          const cacheWrite = anthropicMeta?.cacheCreationInputTokens;
          if (typeof cacheWrite === "number") totalCacheWriteTokens += cacheWrite;
        }
        // totalUsage aggregates across all steps of the tool loop (usage = last step only).
        totalInputTokens += result.totalUsage.inputTokens ?? 0;
        totalCachedTokens += result.totalUsage.cachedInputTokens ?? 0;
        totalOutputTokens += result.totalUsage.outputTokens ?? 0;
        messages.push(...result.response.messages);
        // A turn cut off at the step limit can leave the history ending in an
        // assistant tool-call that never received a result. Pushing the next
        // user turn onto that dangling call makes generateText reject the whole
        // array ("messages must be a ModelMessage[]") — the crash on
        // agent-oos-quote-refresh. Trim the incomplete trailing exchange.
        trimDanglingToolCalls(messages);
        finalText = result.text;
      }

      const expectedTool = testCase.expect_tools?.[0] ?? EXPECTED_TOOLS[testCase.intent];
      const toolOk =
        (testCase.expect_tools ? isSubsequence(testCase.expect_tools, calledTools) : calledTools.includes(expectedTool)) ||
        (testCase.intent === "handoff" && Boolean(runtime.order.handoff));

      let stateOk = true;
      if (testCase.intent === "add_to_cart") stateOk = runtime.order.cart.length > 0;
      if (testCase.intent === "voucher" && !testCase.forbid_voucher) stateOk = Boolean(runtime.order.voucher);
      if (testCase.forbid_voucher) stateOk = stateOk && !runtime.order.voucher;
      if (testCase.intent === "handoff") stateOk = Boolean(runtime.order.handoff) || calledTools.includes("handoff_to_human");
      if (testCase.expect_final_stage) stateOk = stateOk && runtime.order.stage === testCase.expect_final_stage;
      if (testCase.expect_voucher_retained) stateOk = stateOk && runtime.order.voucher?.code === testCase.expect_voucher_retained;
      if (testCase.expect_item_any?.length) {
        stateOk = stateOk && runtime.order.cart.some((line) => testCase.expect_item_any?.includes(line.catalogId));
      }
      if (testCase.forbid_suggestion) stateOk = stateOk && !finalText.includes(testCase.forbid_suggestion);
      if (testCase.forbid_reply_contains) {
        stateOk = stateOk && !new RegExp(testCase.forbid_reply_contains, "s").test(extractSay(finalText));
      }
      if (testCase.expect_reply_matches) {
        stateOk = stateOk && new RegExp(testCase.expect_reply_matches, "s").test(extractSay(finalText));
      }
      if (testCase.expect_reply_mentions_usual) {
        // The greeting must name the customer's ACTUAL usual (from derived
        // history), not a hallucinated item. Previously this flag was silently
        // unimplemented — agent-return-visit passed vacuously.
        const { deriveProfile } = await import("../lib/profile");
        const profile = await deriveProfile(customerId);
        const usualEntry = profile.usual ? getCatalogEntry(profile.usual.catalogId) : null;
        const say = extractSay(finalText).toLowerCase();
        stateOk =
          stateOk &&
          Boolean(
            usualEntry &&
              (say.includes(usualEntry.name.toLowerCase()) ||
                say.includes(usualEntry.vietnameseName.toLowerCase())),
          );
      }

      caseResults.push({
        id: testCase.id,
        passed: toolOk && stateOk,
        turns: turns.length,
        placed: Boolean(runtime.order.placedOrder),
        hasHistory: Boolean(testCase.setup?.historyOrders),
      });
      logAgentCoreObservation(agentCoreTrace, {
        event: "eval.case_finish",
        caseId: testCase.id,
        intent: testCase.intent,
        passed: toolOk && stateOk,
        stage: runtime.order.stage,
        toolCalls: calledTools,
        turns: turns.length,
        latencyMs: Math.round(performance.now() - caseStartedAt),
      });
      if (toolOk && stateOk) passed += 1;
      else {
        const expectedLabel = testCase.expect_tools?.join(" -> ") ?? expectedTool;
        const why = toolOk
          ? "tools ok but final-state check failed"
          : `saw [${calledTools.join(", ")}]`;
        const replySnippet = extractSay(finalText).replace(/\s+/g, " ").slice(0, 160);
        failures.push(`${testCase.id}: expected ${expectedLabel}, ${why}\n    reply: "${replySnippet}"\n    cart: [${runtime.order.cart.map((l) => l.catalogId).join(", ")}] stage: ${runtime.order.stage}`);
      }
    } catch (error) {
      failures.push(`${testCase.id}: agent error ${(error as Error).message}`);
      logAgentCoreObservation(agentCoreTrace, {
        event: "eval.case_error",
        caseId: testCase.id,
        intent: testCase.intent,
        error: (error as Error).message,
        latencyMs: Math.round(performance.now() - caseStartedAt),
      });
      caseResults.push({
        id: testCase.id,
        passed: false,
        turns: (testCase.multi_turn ?? [testCase.input ?? ""]).length,
        placed: false,
        hasHistory: Boolean(testCase.setup?.historyOrders),
      });
    } finally {
      latencies.push({ id: testCase.id, ms: performance.now() - caseStartedAt });
      clearOutOfStock();
    }
  }

  console.log("\n=== SUITE 2: AGENT-LEVEL EVAL (real LLM tool-calling) ===");
  const suiteLabel = suiteCases.length === cases.length ? "" : ` (EVAL_SUITE=agent subset of ${cases.length})`;
  console.log(`AGENT HEADLINE: ${passed}/${suiteCases.length} cases drove the expected tool + final state${suiteLabel}`);
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  reportSubScore("ADVERSARIAL DEFENDED", "adv-", caseResults);
  reportSubScore("TEENCODE NLU", "teen-", caseResults);
  reportUsage(AGENT_MODEL, totalInputTokens, totalCachedTokens, totalCacheWriteTokens, totalOutputTokens);
  reportLatency(latencies);
  reportTurnsToOrder(caseResults);
}

// E13/E14 sub-headlines: separate honest numbers for the deck.
function reportSubScore(label: string, prefix: string, results: { id: string; passed: boolean }[]) {
  const subset = results.filter((result) => result.id.startsWith(prefix));
  if (!subset.length) return;
  console.log(`${label}: ${subset.filter((result) => result.passed).length}/${subset.length}`);
}

// Cycle-time story: memory compresses the funnel — median user turns to a
// placed order, cold-start vs seeded-history cases.
function reportTurnsToOrder(results: { turns: number; placed: boolean; hasHistory: boolean }[]) {
  const median = (values: number[]) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const placed = results.filter((result) => result.placed);
  const cold = median(placed.filter((result) => !result.hasHistory).map((result) => result.turns));
  const returning = median(placed.filter((result) => result.hasHistory).map((result) => result.turns));
  if (cold === null && returning === null) return;
  console.log(
    `TURNS-TO-ORDER (median user turns to placed): new=${cold ?? "n/a"} returning=${returning ?? "n/a"}`,
  );
}

// B6: per-case wall-clock percentiles. A case = full conversation (all turns +
// tool loops), which is what a customer actually waits through.
function reportLatency(latencies: { id: string; ms: number }[]) {
  if (!latencies.length) return;
  const sorted = [...latencies].sort((a, b) => a.ms - b.ms);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const p50 = pick(0.5);
  const p95 = pick(0.95);
  const slowest = sorted[sorted.length - 1];
  const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  console.log(
    `AGENT LATENCY: p50=${secs(p50.ms)} p95=${secs(p95.ms)} (slowest: ${slowest.id} @ ${secs(slowest.ms)})`,
  );
}

// Rates in USD per MTok: base input / cache READ (~0.1x) / cache WRITE (1.25x) /
// output. All four are DISJOINT token buckets — the cost is a straight sum, never
// a subtraction between them.
const RATES_PER_MTOK: Record<string, { input: number; cachedInput: number; cacheWrite: number; output: number }> = {
  "anthropic/claude-opus-4-8": { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 },
  "anthropic/claude-sonnet-5": { input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 },
  "anthropic/claude-haiku-4-5": { input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 },
};

function reportUsage(
  model: string,
  inputTokens: number,
  cachedTokens: number,
  cacheWriteTokens: number,
  outputTokens: number,
) {
  const rates = RATES_PER_MTOK[model];
  // inputTokens (fresh), cachedTokens (READS), cacheWriteTokens (WRITES) are three
  // separate buckets. The old code did `inputTokens - cachedTokens`, went negative,
  // and zeroed real input → reported ~$1 for a run that actually billed ~$5.
  const cost = rates
    ? (inputTokens * rates.input +
        cachedTokens * rates.cachedInput +
        cacheWriteTokens * rates.cacheWrite +
        outputTokens * rates.output) /
      1_000_000
    : null;
  const costLabel = cost === null ? "rates unknown for model" : `~$${cost.toFixed(2)}`;
  console.log(
    `AGENT TOKENS: input=${inputTokens.toLocaleString()} reads=${cachedTokens.toLocaleString()} ` +
      `writes=${cacheWriteTokens.toLocaleString()} output=${outputTokens.toLocaleString()} | ` +
      `est cost ${costLabel} @ ${model} (authoritative: Vercel AI Gateway dashboard)`,
  );
  if (cachedTokens === 0 && inputTokens > 0) {
    console.log("  WARNING: zero cache reads - prompt caching is not taking effect (check gateway cacheControl passthrough).");
  }
}

async function prepareAgentCase(testCase: EvalCase, customerId: string) {
  let order = createOrder();

  // Vouchers enforce minimum subtotals (up to 180k for LUNCH50), so voucher
  // cases need a qualifying cart or apply_voucher can never succeed — the
  // case would be structurally unpassable regardless of agent quality.
  if (testCase.intent === "voucher") {
    order = addExact(order, "combo-family-4");
  }

  if (testCase.id === "agent-optimize-accept" || testCase.id === "agent-voucher-after-swap") {
    order = addExact(addExact(addExact(order, "zinger-burger"), "fries-regular"), "pepsi-medium");
  }
  if (testCase.id === "agent-voucher-after-swap") {
    const voucher = await applyVoucher(order, "KFC20");
    if (voucher.ok) order = voucher.order;
  }
  if (testCase.id === "agent-oos-recovery") {
    order = addExact(addExact(order, "zinger-burger"), "pepsi-medium");
    // The case is "(cart+OTP preloaded)" but OTP verification is server-side
    // (otpProvider keyed by sessionKey) — without this the agent correctly
    // refuses to place, and the case is structurally unpassable.
    const sessionKey = `agent_eval_${testCase.id}`;
    const requested = await otpProvider.request(sessionKey, "0901234567");
    if (requested.ok) {
      const verified = await otpProvider.verify(sessionKey, requested.devCode ?? "");
      if (verified.ok) order = setOtpVerified(order);
    }
  }
  if (testCase.id === "agent-pickup-no-store-address") {
    order = addExact(order, "pepsi-medium");
  }
  if (testCase.id === "adv-haggle" || testCase.id === "adv-otp-guess") {
    order = addExact(order, "zinger-burger");
  }
  if (testCase.id === "agent-oos-quote-refresh") {
    // Full checkout state: cart + delivery quote + verified OTP, so the OOS
    // failure hits at place time and recovery must refresh the stale quote.
    order = addExact(addExact(order, "zinger-burger"), "pepsi-medium");
    order = setQuote(order, quoteOrder(order, "delivery"));
    const sessionKey = `agent_eval_${testCase.id}`;
    const requested = await otpProvider.request(sessionKey, "0901234567");
    if (requested.ok) {
      const verified = await otpProvider.verify(sessionKey, requested.devCode ?? "");
      if (verified.ok) order = setOtpVerified(order);
    }
  }

  if (testCase.setup?.oos) setOutOfStock(testCase.setup.oos);

  if (testCase.setup?.historyOrders) {
    const store = getHistoryStore();
    const persona = generatePersona(customerId, 8801);
    const history = generateCustomerHistory(persona, testCase.setup.historyOrders, 8802);
    for (const posOrder of history) {
      await store.recordOrder({
        customerId,
        orderId: posOrder.id,
        placedAt: `2026-07-${String(posOrder.seq).padStart(2, "0")}T12:00:00.000Z`,
        context: posOrder.context,
        lines: posOrder.lines.map((line) => ({
          catalogId: line.itemId,
          quantity: line.quantity,
          optionIds: line.optionIds ?? [],
        })),
        totalVnd: posOrder.lines.reduce(
          (sum, line) => sum + (getCatalogEntry(line.itemId)?.priceVnd ?? 0) * line.quantity,
          0,
        ),
      });
    }
  }

  if (testCase.setup?.declined) {
    const store = getHistoryStore();
    for (const catalogId of testCase.setup.declined) {
      await store.recordSuggestion({ customerId, catalogId, action: "declined", at: new Date().toISOString() });
    }
  }

  return order;
}

/**
 * The agent's final message SHOULD be a JSON contract {"say": "..."}, and only
 * `say` is ever shown to the customer (lib/channel strips the rest in prod). But
 * the model frequently emits prose + a fenced ```json {...} block, or a bare
 * trailing object. Naively JSON.parse-ing the whole string fails and returns the
 * RAW text — which leaks the contract's own field names (e.g. "order_state")
 * into forbid/expect checks and produces false positives (this is exactly why
 * adv-prompt-leak was scored as a leak when the agent had actually refused).
 * Extract `say` however it's wrapped; fall back to raw text only if there's none.
 */
function extractSay(text: string): string {
  const candidates: string[] = [text];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) candidates.push(match[1]);
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed.say === "string") return parsed.say;
    } catch {
      // try the next candidate wrapper
    }
  }
  // Last resort: pull the say value even from truncated/malformed JSON —
  // first a properly closed string, then an unterminated one (output cut off
  // mid-"say", as in the return-usual replies in the 2026-07-06 batch log).
  const sayMatch =
    text.match(/"say"\s*:\s*"((?:[^"\\]|\\.)*)"/) ?? text.match(/"say"\s*:\s*"((?:[^"\\]|\\.)*)$/);
  if (sayMatch) {
    try {
      return JSON.parse(`"${sayMatch[1]}"`);
    } catch {
      return sayMatch[1];
    }
  }
  return text;
}

/**
 * Remove any trailing messages that form an incomplete tool exchange — an
 * assistant message with unresolved tool-call parts, or an orphaned tool result.
 * On a cleanly finished turn the last message is assistant text, so nothing is
 * trimmed; this only fires when a turn was truncated at the step limit.
 */
function trimDanglingToolCalls(history: ModelMessage[]): void {
  const hasToolCallPart = (message: ModelMessage) =>
    message.role === "assistant" &&
    Array.isArray(message.content) &&
    message.content.some((part) => (part as { type?: string }).type === "tool-call");
  while (history.length > 0) {
    const last = history[history.length - 1];
    if (last.role === "tool" || hasToolCallPart(last)) {
      history.pop();
    } else {
      break;
    }
  }
}

function isSubsequence(expected: string[], actual: string[]) {
  let cursor = 0;
  for (const toolName of actual) {
    if (toolName === expected[cursor]) cursor += 1;
    if (cursor === expected.length) return true;
  }
  return expected.length === 0;
}

async function main() {
  await runLibSuite();
  await runAgentSuite();
  runPersonalizationSuite();
  runNudgeSuite();
  runReengageSuite();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
