// Demo data seeder — fills Supabase with a believable morning of activity so
// /backend reads as a live store: a mixed-stage OMS queue, loyalty
// members, taste history, suggestion take-rate, and agent turns for the KPIs.
//
// Carts are built through the REAL createOrder/addToCart helpers so every
// price, option, and total matches the catalog — nothing is hand-typed.
// Re-runnable: all rows are keyed by kfc_order_demo_* / demo customer ids and
// wiped before re-inserting.
//
//   npx tsx db/seed-demo.ts

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local ourselves so the script runs with plain `npx tsx`.
for (const line of readFileSync(resolve(import.meta.dirname, "../.env.local"), "utf8").split("\n")) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
}

const { createOrder, addToCart, setQuote, setVoucher, setPlacedOrder } = await import("../lib/order");
const { createMatchId } = await import("../lib/menu");
const { supabaseAdmin } = await import("../lib/supabase");
type Order = import("../lib/order").Order;
type OmsStage = import("../lib/oms-store").OmsStage;

const DEMO_CUSTOMERS = ["lan.nguyen", "minh.tran", "thu.pham", "quang.le", "hoa.vo", "duc.hoang"] as const;

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const KFC20 = {
  code: "KFC20",
  description: "20% off chicken and combo orders, capped at 60,000 VND",
  discountType: "percent" as const,
  minimumSubtotalVnd: 80000,
  percent: 20,
  maxDiscountVnd: 60000,
  appliedBy: "auto" as const,
};

type CartSpec = Array<{ id: string; qty: number; opts?: string[] }>;

type Scenario = {
  n: number; // → kfc_order_demo_<n> + order number suffix
  customer: string | null;
  channel: "web" | "messenger";
  stage: OmsStage;
  placedMinAgo: number;
  cart: CartSpec;
  voucher?: boolean;
  fulfillment: "delivery" | "pickup";
  otpMode: "verified" | "trusted_skip";
};

// The queue the judges will see: fresh orders on top, a kitchen mid-shift
// below, a couple of finished tickets, one cancellation.
const SCENARIOS: Scenario[] = [
  { n: 1, customer: "lan.nguyen", channel: "messenger", stage: "placed", placedMinAgo: 3, fulfillment: "delivery", otpMode: "trusted_skip",
    cart: [{ id: "combo-family-4", qty: 1, opts: ["spice-spicy", "drink-pepsi"] }, { id: "egg-tart", qty: 4 }] },
  { n: 2, customer: "duc.hoang", channel: "web", stage: "placed", placedMinAgo: 6, fulfillment: "pickup", otpMode: "verified",
    cart: [{ id: "zinger-burger", qty: 2, opts: ["no-mayo"] }, { id: "pepsi-std", qty: 2 }] },
  { n: 3, customer: null, channel: "web", stage: "placed", placedMinAgo: 9, fulfillment: "delivery", otpMode: "verified",
    cart: [{ id: "popcorn-regular", qty: 1 }, { id: "fries-regular", qty: 1, opts: ["fries-large"] }] },
  { n: 4, customer: "minh.tran", channel: "messenger", stage: "preparing", placedMinAgo: 14, fulfillment: "delivery", otpMode: "trusted_skip", voucher: true,
    cart: [{ id: "combo-zinger", qty: 1, opts: ["drink-pepsi"] }, { id: "tenders-3pc", qty: 1, opts: ["spice-spicy"] }] },
  { n: 5, customer: "thu.pham", channel: "web", stage: "preparing", placedMinAgo: 18, fulfillment: "pickup", otpMode: "verified",
    cart: [{ id: "fried-chicken-rice", qty: 2, opts: ["spice-spicy"] }, { id: "seaweed-soup", qty: 2 }] },
  { n: 6, customer: "hoa.vo", channel: "messenger", stage: "preparing", placedMinAgo: 22, fulfillment: "delivery", otpMode: "trusted_skip",
    cart: [{ id: "combo-couple", qty: 1, opts: ["spice-original", "drink-7up"] }] },
  { n: 7, customer: "quang.le", channel: "web", stage: "ready", placedMinAgo: 31, fulfillment: "pickup", otpMode: "verified",
    cart: [{ id: "fried-chicken-2pc", qty: 1, opts: ["spice-spicy"] }, { id: "coleslaw", qty: 1 }, { id: "pepsi-medium", qty: 1 }] },
  { n: 8, customer: "lan.nguyen", channel: "messenger", stage: "ready", placedMinAgo: 38, fulfillment: "delivery", otpMode: "trusted_skip",
    cart: [{ id: "shrimp-burger", qty: 1 }, { id: "7up-medium", qty: 1 }, { id: "egg-tart", qty: 2 }] },
  { n: 9, customer: "minh.tran", channel: "web", stage: "completed", placedMinAgo: 74, fulfillment: "delivery", otpMode: "verified", voucher: true,
    cart: [{ id: "combo-party-6", qty: 1, opts: ["spice-spicy", "drink-pepsi"] }] },
  { n: 10, customer: "thu.pham", channel: "messenger", stage: "completed", placedMinAgo: 102, fulfillment: "pickup", otpMode: "trusted_skip",
    cart: [{ id: "burger-ga-yo", qty: 2 }, { id: "fries-regular", qty: 2 }] },
  { n: 11, customer: "hoa.vo", channel: "web", stage: "completed", placedMinAgo: 128, fulfillment: "delivery", otpMode: "verified",
    cart: [{ id: "combo-classic", qty: 2, opts: ["spice-original", "drink-pepsi", "side-fries"] }] },
  { n: 12, customer: "duc.hoang", channel: "messenger", stage: "cancelled", placedMinAgo: 51, fulfillment: "delivery", otpMode: "verified",
    cart: [{ id: "fried-chicken-1pc", qty: 3, opts: ["spice-original"] }] },
];

// Stage timeline offsets (minutes after placement) — drives kfc_order_events.
const STAGE_TIMELINE: Record<OmsStage, Array<{ stage: OmsStage; afterMin: number }>> = {
  placed: [{ stage: "placed", afterMin: 0 }],
  preparing: [{ stage: "placed", afterMin: 0 }, { stage: "preparing", afterMin: 3 }],
  ready: [{ stage: "placed", afterMin: 0 }, { stage: "preparing", afterMin: 3 }, { stage: "ready", afterMin: 13 }],
  completed: [
    { stage: "placed", afterMin: 0 },
    { stage: "preparing", afterMin: 3 },
    { stage: "ready", afterMin: 13 },
    { stage: "completed", afterMin: 24 },
  ],
  cancelled: [{ stage: "placed", afterMin: 0 }, { stage: "cancelled", afterMin: 4 }],
};

function buildOrder(s: Scenario): { payload: Order; omsOrderNumber: string; createdAt: string; updatedAt: string } {
  let order = createOrder(s.channel);
  for (const line of s.cart) {
    order = addToCart(order, {
      catalogId: line.id,
      matchId: createMatchId(line.id),
      source: "search_menu",
      quantity: line.qty,
      optionIds: line.opts,
    });
  }
  if (s.voucher) order = setVoucher(order, KFC20);
  order = setQuote(
    order,
    s.fulfillment === "delivery"
      ? { fulfillment: "delivery", address: "12 Main Street, District 1, Ho Chi Minh City", deliveryFeeVnd: 15000, etaMinutes: 28, displayDeliveryFee: "15,000 VND" }
      : { fulfillment: "pickup", deliveryFeeVnd: 0, etaMinutes: 15, displayDeliveryFee: "0 VND" },
  );
  const createdAt = minutesAgo(s.placedMinAgo);
  const omsOrderNumber = `KFCVN-${createdAt.slice(2, 10).replace(/-/g, "")}-${String(4200 + s.n * 37).padStart(4, "0")}`;
  order = setPlacedOrder(order, {
    orderNumber: omsOrderNumber,
    createdAt,
    paymentMethod: s.n % 3 === 0 ? "card_at_door" : "cod",
    omsStatus: "accepted",
    otpMode: s.otpMode,
  });
  order = {
    ...order,
    orderId: `kfc_order_demo_${String(s.n).padStart(3, "0")}`,
    customerId: s.customer ?? undefined,
    updatedAt: createdAt,
  };
  const timeline = STAGE_TIMELINE[s.stage];
  const updatedAt = minutesAgo(s.placedMinAgo - timeline[timeline.length - 1].afterMin);
  return { payload: order, omsOrderNumber, createdAt, updatedAt };
}

async function main() {
  const db = supabaseAdmin();
  const customers = [...DEMO_CUSTOMERS];

  // ---- wipe previous demo rows (events cascade off kfc_orders) -------------
  await db.from("kfc_orders").delete().like("id", "kfc_order_demo_%");
  for (const table of ["kfc_customer_history", "kfc_suggestion_events", "kfc_agent_turns", "kfc_loyalty_events", "kfc_loyalty"]) {
    const { error } = await db.from(table).delete().in("customer_id", customers);
    if (error) throw new Error(`${table} wipe: ${error.message}`);
  }

  // ---- orders + lifecycle events -------------------------------------------
  const built = SCENARIOS.map((s) => ({ s, ...buildOrder(s) }));
  const { error: ordersError } = await db.from("kfc_orders").insert(
    built.map(({ s, payload, omsOrderNumber, createdAt, updatedAt }) => ({
      id: payload.orderId,
      channel: s.channel,
      customer_id: s.customer,
      stage: s.stage,
      order_payload: payload,
      oms_order_number: omsOrderNumber,
      total_vnd: payload.totals.totalVnd,
      created_at: createdAt,
      updated_at: updatedAt,
    })),
  );
  if (ordersError) throw new Error(`kfc_orders: ${ordersError.message}`);

  const eventRows = built.flatMap(({ s, payload, omsOrderNumber }) =>
    STAGE_TIMELINE[s.stage].map((step) => ({
      order_id: payload.orderId,
      event_type: step.stage,
      event_payload:
        step.stage === "placed"
          ? { omsOrderNumber, totalVnd: payload.totals.totalVnd }
          : step.stage === "cancelled"
            ? { note: "Customer changed their mind and cancelled before the kitchen accepted it." }
            : {},
      created_at: minutesAgo(s.placedMinAgo - step.afterMin),
    })),
  );
  const { error: eventsError } = await db.from("kfc_order_events").insert(eventRows);
  if (eventsError) throw new Error(`kfc_order_events: ${eventsError.message}`);

  // ---- loyalty members ------------------------------------------------------
  const loyalty = [
    { customer_id: "lan.nguyen", points: 12400, lifetime_points: 48200 },
    { customer_id: "minh.tran", points: 8750, lifetime_points: 31900 },
    { customer_id: "thu.pham", points: 5200, lifetime_points: 17800 },
    { customer_id: "quang.le", points: 3100, lifetime_points: 9600 },
    { customer_id: "hoa.vo", points: 1950, lifetime_points: 6400 },
    { customer_id: "duc.hoang", points: 640, lifetime_points: 640 },
  ].map((row, i) => ({ ...row, updated_at: minutesAgo(20 + i * 30) }));
  const { error: loyaltyError } = await db.from("kfc_loyalty").upsert(loyalty);
  if (loyaltyError) throw new Error(`kfc_loyalty: ${loyaltyError.message}`);

  const loyaltyEvents = built
    .filter(({ s }) => s.stage === "completed" && s.customer)
    .map(({ s, payload }) => ({
      customer_id: s.customer,
      delta: Math.floor(payload.totals.totalVnd / 100),
      reason: "earn",
      order_id: payload.orderId,
      created_at: minutesAgo(s.placedMinAgo - 24),
    }));
  const { error: loyaltyEventsError } = await db.from("kfc_loyalty_events").insert(loyaltyEvents);
  if (loyaltyEventsError) throw new Error(`kfc_loyalty_events: ${loyaltyEventsError.message}`);

  // ---- taste history (feeds profile/reco) — completed orders + older visits -
  const historyRows = [
    ...built
      .filter(({ s }) => s.stage === "completed" && s.customer)
      .map(({ s, payload }) => ({
        customer_id: s.customer,
        order_id: payload.orderId,
        context: { hour: new Date(Date.parse(payload.updatedAt)).getHours(), weather: "hot" },
        lines: payload.cart.map((l) => ({ catalogId: l.catalogId, quantity: l.quantity, optionIds: l.options.map((o) => o.id) })),
        total_vnd: payload.totals.totalVnd,
        created_at: minutesAgo(s.placedMinAgo),
      })),
    // A few prior visits so returning customers have a "usual".
    ...[
      { c: "lan.nguyen", id: "combo-family-4", opts: ["spice-spicy", "drink-pepsi"], total: 315000, daysAgo: 4 },
      { c: "lan.nguyen", id: "combo-family-4", opts: ["spice-spicy", "drink-pepsi"], total: 315000, daysAgo: 11 },
      { c: "minh.tran", id: "combo-zinger", opts: ["drink-pepsi"], total: 89000, daysAgo: 3 },
      { c: "thu.pham", id: "fried-chicken-rice", opts: ["spice-spicy"], total: 90000, daysAgo: 6 },
      { c: "quang.le", id: "fried-chicken-2pc", opts: ["spice-spicy"], total: 99000, daysAgo: 8 },
    ].map((v, i) => ({
      customer_id: v.c,
      order_id: `kfc_order_demo_hist_${i + 1}`,
      context: { hour: 12, weather: "clear" },
      lines: [{ catalogId: v.id, quantity: 1, optionIds: v.opts }],
      total_vnd: v.total,
      created_at: minutesAgo(v.daysAgo * 24 * 60),
    })),
  ];
  const { error: historyError } = await db.from("kfc_customer_history").insert(historyRows);
  if (historyError) throw new Error(`kfc_customer_history: ${historyError.message}`);

  // ---- suggestion events (take-rate KPI) ------------------------------------
  const suggestionRows = [
    { c: "lan.nguyen", id: "egg-tart", action: "accepted", min: 3 },
    { c: "minh.tran", id: "tenders-3pc", action: "accepted", min: 14 },
    { c: "thu.pham", id: "seaweed-soup", action: "accepted", min: 18 },
    { c: "quang.le", id: "coleslaw", action: "accepted", min: 31 },
    { c: "hoa.vo", id: "egg-tart", action: "declined", min: 22 },
    { c: "duc.hoang", id: "fries-regular", action: "declined", min: 6 },
    { c: "lan.nguyen", id: "pepsi-std", action: "accepted", min: 38 },
    { c: "minh.tran", id: "egg-tart", action: "declined", min: 74 },
  ].map((s) => ({ customer_id: s.c, catalog_id: s.id, action: s.action, created_at: minutesAgo(s.min) }));
  const { error: suggestionError } = await db.from("kfc_suggestion_events").insert(suggestionRows);
  if (suggestionError) throw new Error(`kfc_suggestion_events: ${suggestionError.message}`);

  // ---- agent turns (console KPIs: latency, tokens, cost) --------------------
  const model = process.env.AGENT_MODEL || "anthropic/claude-haiku-4-5";
  const TURNS: Array<[string, "web" | "messenger", string, string, string[], number]> = [
    ["lan.nguyen", "messenger", "Can I get the family combo like last time?", "Sure, Lan. Family Combo for 4 with spicy chicken and Pepsi like usual. Want to add 4 egg tarts again?", ["get_profile", "search_menu", "add_to_cart"], 3],
    ["lan.nguyen", "messenger", "Yes, add them", "Done. Four egg tarts are in the cart. Total is 353,000 VND, delivered to 12 Main Street as before?", ["add_to_cart", "quote_order"], 3],
    ["duc.hoang", "web", "2 Zinger burgers no mayo and 2 Pepsis", "Done. 2 Zinger Burgers with no mayo plus 2 Pepsi. Total is 146,000 VND. Pickup or delivery?", ["search_menu", "add_to_cart"], 6],
    ["duc.hoang", "web", "Pickup", "Your order is in the kitchen, order KFCVN-260712-4274. It should be ready for pickup in about 15 minutes.", ["quote_order", "request_otp", "place_order"], 6],
    ["minh.tran", "messenger", "Zinger combo plus 3 spicy tenders", "Done. I applied KFC20 for you and saved 26,200 VND. Total is 119,800 VND.", ["search_menu", "add_to_cart", "apply_voucher"], 14],
    ["thu.pham", "web", "2 spicy fried chicken rice and 2 seaweed soups", "Done. 2 spicy Fried Chicken Rice plus 2 Seaweed Soup, total 118,000 VND. What pickup time would you like?", ["search_menu", "add_to_cart"], 18],
    ["hoa.vo", "messenger", "Is the couple combo on promo?", "Yes. Couple's Bucket is 155,000 VND. I can build it with original chicken and 7Up like you prefer.", ["search_menu", "get_profile"], 22],
    ["quang.le", "web", "2 spicy fried chicken, 1 coleslaw, 1 medium Pepsi", "Done. Total is 117,000 VND. Pickup order should be ready in about 15 minutes.", ["search_menu", "add_to_cart", "place_order"], 31],
    ["lan.nguyen", "messenger", "Where is my order?", "Your Shrimp Burger order is out for delivery and the driver is almost there.", ["check_order_status"], 36],
    ["minh.tran", "web", "Order a party combo for 6 delivered to the office", "Done. Party Combo for 6 with spicy chicken, KFC20 applied for 60,000 VND off, total 469,000 VND. Delivery to 45 Market Street before 12:00.", ["search_menu", "add_to_cart", "apply_voucher", "quote_order", "place_order"], 74],
    ["thu.pham", "messenger", "2 Burger GaYo for pickup", "Done. 2 Burger GaYo plus 2 fries, total 142,000 VND. Should I place the order?", ["search_menu", "add_to_cart", "place_order"], 102],
    ["duc.hoang", "messenger", "Please cancel my chicken order", "I cancelled your 3-piece chicken order. No fee was charged.", ["check_order_status", "cancel_order"], 47],
  ];
  const turnRows = TURNS.map(([customer, channel, userText, replyText, tools, min], i) => ({
    convo_key: channel === "messenger" ? `messenger:demo_${customer}` : null,
    customer_id: customer,
    channel,
    model,
    user_text: userText,
    reply_text: replyText,
    tool_calls: tools,
    input_tokens: 2600 + ((i * 313) % 1400),
    cached_input_tokens: 1900 + ((i * 211) % 1100),
    cache_write_tokens: i % 4 === 0 ? 850 : 0,
    output_tokens: 140 + ((i * 97) % 260),
    latency_ms: 950 + ((i * 419) % 1600),
    // Stagger by a few seconds per row — two turns in the same minute must not
    // share an identical timestamp (the console keys rows by time + customer).
    created_at: new Date(Date.now() - min * 60_000 - i * 8_000).toISOString(),
  }));
  const { error: turnsError } = await db.from("kfc_agent_turns").insert(turnRows);
  if (turnsError) throw new Error(`kfc_agent_turns: ${turnsError.message}`);

  console.log(
    `Seeded ${built.length} orders (${eventRows.length} events), ${loyalty.length} loyalty members, ` +
      `${historyRows.length} history rows, ${suggestionRows.length} suggestion events, ${turnRows.length} agent turns.`,
  );
  for (const { s, payload, omsOrderNumber } of built) {
    console.log(`  ${omsOrderNumber}  ${s.stage.padEnd(9)} ${(s.customer ?? "guest").padEnd(11)} ${payload.totals.displayTotal.padStart(12)}  ${payload.cart.map((l) => `${l.quantity}x ${l.name}`).join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
