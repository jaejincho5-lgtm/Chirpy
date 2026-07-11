// Channel-path eval — drives the REAL webhook route (simulation mode) against a
// running dev server, asserting the class of bugs Suite 2 cannot see: cross-turn
// state reconstruction. The 2026-07-05 duplicate-cart bug lived exactly here.
//
// SPEND-GATED: every turn is a live LLM call through the server's AGENT_MODEL.
// Requires CHANNEL_EVAL=1 + a running server (BASE_URL, default localhost:3000).
// Cost ≈ $0.01–0.05 on Haiku for all scenarios.

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

type WebhookReply = {
  ok: boolean;
  results?: Array<{ forwarded: boolean; reply?: string; note?: string }>;
};

async function sendTurn(senderId: string, text: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/webhook/messenger`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry: [{ messaging: [{ sender: { id: senderId }, message: { text } }] }] }),
  });
  if (!response.ok) throw new Error(`webhook HTTP ${response.status}`);
  const payload = (await response.json()) as WebhookReply;
  const result = payload.results?.[0];
  if (!result?.forwarded || !result.reply) throw new Error(`not forwarded: ${result?.note ?? "no result"}`);
  return result.reply;
}

type Scenario = {
  id: string;
  turns: string[];
  /** Runs against all replies joined; return an error string or null. */
  check: (replies: string[]) => string | null;
};

// Duplicate detector: the same quantity-bearing item name appearing with an
// inflated count in the FINAL recap (e.g. "2 Pepsi" after ordering one).
const SCENARIOS: Scenario[] = [
  {
    id: "channel-no-dup-cart",
    turns: ["cho 1 pepsi", "them 1 khoai tay chien", "tong don cua minh la gi?"],
    check: (replies) => {
      const final = replies[replies.length - 1].toLowerCase();
      if (/2\s*(x\s*)?pepsi|pepsi\s*x\s*2/.test(final)) return "Pepsi duplicated across turns";
      if (/2\s*(x\s*)?khoai|khoai[^.]{0,12}x\s*2/.test(final)) return "fries duplicated across turns";
      return null;
    },
  },
  {
    id: "channel-short-yes-continuity",
    turns: ["cho 1 zinger burger", "okay"],
    check: (replies) => {
      const final = replies[replies.length - 1];
      // "okay" must resolve the pending question, not restart the conversation.
      if (/bạn muốn gọi món gì|menu hôm nay/i.test(final)) return "conversation state lost after short yes";
      return null;
    },
  },
  {
    id: "channel-otp-flow",
    turns: ["cho 1 ga ran 2 mieng", "giao quan 1 nha, sdt 0905551234"],
    check: (replies) => {
      const final = replies[replies.length - 1];
      if (!/otp|mã xác nhận/i.test(final)) return "checkout did not reach OTP step";
      if (/\+84/.test(final)) return "phone number was reformatted to +84";
      return null;
    },
  },
];

async function main() {
  if (process.env.CHANNEL_EVAL !== "1") {
    console.log("CHANNEL EVAL: skipped (set CHANNEL_EVAL=1 with a running server — costs live LLM calls).");
    return;
  }
  const alive = await fetch(BASE_URL).then((r) => r.ok, () => false);
  if (!alive) {
    console.error(`CHANNEL EVAL: server not reachable at ${BASE_URL}`);
    process.exitCode = 1;
    return;
  }

  let passed = 0;
  for (const scenario of SCENARIOS) {
    const senderId = `chaneval_${scenario.id}_${process.pid}_${Math.floor(performance.now())}`;
    try {
      const replies: string[] = [];
      for (const turn of scenario.turns) replies.push(await sendTurn(senderId, turn));
      const problem = scenario.check(replies);
      if (problem) {
        console.log(`  FAIL ${scenario.id}: ${problem}\n    final reply: "${replies[replies.length - 1].slice(0, 140)}"`);
      } else {
        passed += 1;
        console.log(`  PASS ${scenario.id}`);
      }
    } catch (error) {
      console.log(`  FAIL ${scenario.id}: ${(error as Error).message}`);
    }
  }
  console.log(`CHANNEL EVAL: ${passed}/${SCENARIOS.length} scenarios clean (server model: whatever AGENT_MODEL the server runs)`);
  if (passed < SCENARIOS.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
