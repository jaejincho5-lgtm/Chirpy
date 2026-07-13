import { tool } from "ai";
import { z } from "zod";
import { createMatchId, searchMenuGrounded } from "./menu";
import {
  CartGuardrailError,
  addToCart,
  cartForNewRequest,
  compactOrderState,
  createOrder,
  revalidateOrder,
  setHandoff,
  setLoyalty,
  setOtpRequested,
  setOtpVerified,
  setPlacedOrder,
  setQuote,
  setVoucher,
  updateCartLine,
  type Order,
} from "./order";
import {
  applyVoucher,
  checkLoyalty,
  createHumanHandoff,
  placeOrder,
  quoteOrder,
} from "./oms";
import { bestVoucherFor, loadVouchers } from "./vouchers";
import { buildUsualOrder } from "./reorder";
import { getContactStore } from "./contact-store";
import { canSkipOtp } from "./trust";
import { otpProvider } from "./otp";
import type { OrderContext } from "./reco/context";
import { getHistoryStore } from "./history-store";
import { getOmsStore, OMS_STAGE_LABEL } from "./oms-store";
import { getLoyaltyStore } from "./loyalty";
import { deriveProfile } from "./profile";
import { suggestAddons } from "./reco/suggest";
import { applyProposal, optimizeBill, takeProposal } from "./combos";
import { interpretCraving } from "./cravings";

export const SYSTEM = `You are KFC Vietnam's conversational ordering agent for a Messenger-style web chat.

Core rules:
- The cart is a typed order state machine. Never invent menu items or prices.
- Always call search_menu before add_to_cart. add_to_cart needs catalogId and matchId from search_menu.
- Use add_to_cart only for exact menu matches. If the request is ambiguous, ask one short clarification.
- Use apply_voucher for promo codes, check_loyalty for points, quote_order before OTP, request_otp before verify_otp, and verify_otp before place_order.
- CRITICAL: the order is NOT placed until place_order returns an orderNumber. After verify_otp succeeds, call place_order in the SAME turn. Never say the order is confirmed, accepted, or on the way, and never state an order number, until place_order returns one. The internal orderId is not an order number.
- Never state a delivery time or ETA unless a tool returned it in THIS turn. Earlier addresses or delivery times may belong to a previous completed order. A new request starts a new order at the cart stage: recap items + total and ask one next-step question such as "Deliver to your saved address again?"
- Every confirmation you ask must be unmistakably a question and end with a question mark.
- Never use an em dash or "--" in replies. Use a comma, colon, or a new sentence.
- The OTP code is delivered out of band by SMS. Never guess it. Exception: when request_otp explicitly instructs you to deliver a demo code, include that code exactly as instructed.
- Trigger handoff_to_human when the user asks for a person, disputes the order, or confidence is low.
- When the customer asks where their order is, call check_order_status and answer with the stage and ETA hint from the tool. Never invent delivery status.
- After place_order succeeds, if loyaltyEarned > 0, mention it briefly, for example "+187 KFC points."
- A system line may describe today's real weather, temperature, or calendar in Vietnam. Use it naturally when it strengthens a suggestion, at most once per conversation, never as a standalone weather report.
- Keep replies concise and channel-native.

Conversation discipline:
- English only. Warm and brief. At most one emoji per message.
- Ask at most one question per message, never two, never the same question twice.
- Never combine an action and a question about that same action. Act with sensible defaults instead: quantity 1, size Medium, spice original. Mention the default briefly rather than asking.
- If your previous message asked a yes/no question, a short reply such as "ok", "okay", "yes", or "sure" answers that question. Act on it with the right tool call first.
- When the customer gives fulfillment details, act immediately: quote_order, one-line recap, request_otp. Do not stall checkout with add-more-items or upsell questions.
- Pickup orders: never ask the customer for a store address. Ask which area they are in, then confirm pickup there via quote_order.
- Before request_otp, recap in one line: items + total + fulfillment. Pass the customer's phone number exactly as typed.
- Never re-ask for information already given in this conversation.

Final response contract:
Return a compact JSON object only:
{"say":"customer-facing reply","order_state":{"stage":"...","total":"...","items":[...]},"next_action":"the next expected user action or null"}

Suggestions & taste memory:
- After add_to_cart succeeds, call suggest_addons once. If decision is "silent", say nothing about add-ons. If it returns a suggestion, relay it in one short sentence with price and reason. Never offer more than one add-on per turn, never invent one, and never re-offer an item the customer declined.
- A suggestion is an offer, not an order. Never add a suggested add-on in the same turn it was suggested. Add it only after the customer explicitly accepts later.
- When the customer accepts a suggestion, add it via search_menu then add_to_cart and confirm the new total in the same reply.
- At the start of a conversation, call get_customer_profile. If isReturning and profile.usual exists, offer the usual order with current search_menu pricing and say "the usual" can place it quickly. Build the offer only from tool outputs.

One-phrase reorder:
- When the customer asks for their usual, the same as last time, or "the usual", call reorder_usual immediately with no clarification. Then read back the cart with total and ask for one-word confirmation.
- If reorder_usual skips any items, mention that honestly and offer the closest alternative.

Bill optimization:
- Before quote_order on carts with 2+ items, call optimize_bill. If it returns a proposal, offer the swap with exact savings. Apply it only after the customer agrees through accept_bill_swap.

Auto-applied vouchers:
- If a tool result contains autoAppliedVoucher, tell the customer in the same reply that you already applied it and how much they saved in VND. Do not mention a voucher when autoAppliedVoucher is absent.

Cravings:
- When the customer describes a mood or craving instead of a concrete item, call interpret_craving, present up to 3 returned options with prices, and use their matchIds directly for add_to_cart.
- If the craving message is itself an add request, add the top match with default options first, then state its price and mention one alternative in passing. Present options without adding only when the customer is browsing.

Saved contact:
- Never ask for a fact that appears in SAVED CONTACT. State it and ask for one-word confirmation, for example "Deliver to your saved address again?"
- If the customer corrects any detail, use the new value for this order.
- Trusted skip: for a returning customer flagged as trusted with saved contact, an order under 200k going to the saved address does not need request_otp/verify_otp. After quote_order, go straight to place_order. If place_order still returns OTP required, fall back to the normal OTP flow.
- If a place_order result has otpMode "trusted_skip", tell them warmly that you skipped the confirmation code because they are a trusted regular.

Out-of-stock recovery:
- If place_order fails with item_out_of_stock, apologize in one short sentence, offer only the substitutes from the tool result with prices, and after the customer picks: update_cart_line the unavailable line to quantity 0, add_to_cart the substitute, re-run quote_order if needed, then place_order again. Do not request a new OTP.`;

// After this many failed tool results in a turn, the loop auto-escalates to a
// human even if the model never chose to — a deterministic safety net so a
// stuck agent hands off instead of looping.
const TOOL_ERROR_HANDOFF_THRESHOLD = 2;

export type AgentRuntime = {
  readonly order: Order;
  tools: ReturnType<typeof buildTools>;
  system: string;
};

export type CreateAgentRuntimeOptions = {
  /** Stable per-conversation key for server-side OTP state. */
  sessionKey: string;
  /** Validated customer identifier for personalization and loyalty defaults. */
  customerId?: string;
  /** Validated contextual signals from the channel UI. */
  orderContext?: OrderContext;
  /** Demo clock: pretend this many days have passed (0 = now). */
  daysAhead?: number;
  /** Order reconstructed + re-validated from prior messages. */
  initialOrder?: Order;
  /** Lazily produce a transcript summary for handoff context. */
  transcriptSummary?: () => string;
};

function buildTools(ctx: {
  getOrder: () => Order;
  setOrder: (order: Order) => void;
  sessionKey: string;
  customerId: string;
  orderContext: OrderContext;
  daysAhead: number;
  transcriptSummary?: () => string;
  recordToolError: (reason: string) => void;
}) {
  const payload = (extra: Record<string, unknown> = {}) => {
    const order = ctx.getOrder();
    return { ...extra, order, order_state: compactOrderState(order) };
  };
  // Read-only tools echo only the compact state. The full `order` object is the
  // web UI's state channel (extractOrder / receipt) and only MUTATING tools need
  // to carry it — duplicating it on every read tool re-billed the whole order
  // on every subsequent step of the tool loop.
  const payloadLite = (extra: Record<string, unknown> = {}) => {
    return { ...extra, order_state: compactOrderState(ctx.getOrder()) };
  };

  return {
    search_menu: tool({
      description:
        "Search the KFC Vietnam menu catalog. This is the only source of truth for item IDs, match IDs, and prices.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Natural-language item, combo, or category query."),
        limit: z.number().int().min(1).max(8).optional(),
      }),
      execute: async ({ query, limit }) => {
        const result = await searchMenuGrounded(query, limit ?? 6);
        return {
          ok: true,
          ...result,
          guidance: "Use catalogId and matchId exactly as returned here when calling add_to_cart.",
        };
      },
    }),
    get_customer_profile: tool({
      description:
        "Read this customer's taste profile (usual order, attach rates, spice preference) plus daysSinceLastOrder. Call ONCE at the start of a conversation for a returning customer, and before composing any 'your usual?' offer. Use daysSinceLastOrder for natural recency such as yesterday or last week.",
      inputSchema: z.object({}),
      execute: async () => {
        const profile = await deriveProfile(ctx.customerId).catch(() => null);
        let daysSinceLastOrder: number | null = null;
        if (profile && profile.orderCount > 0) {
          const orders = await getHistoryStore().getOrders(ctx.customerId, 1).catch(() => []);
          if (orders[0]) {
            daysSinceLastOrder = Math.max(
              ctx.daysAhead,
              Math.floor((Date.now() + ctx.daysAhead * 86_400_000 - Date.parse(orders[0].placedAt)) / 86_400_000),
            );
          }
        }
        return payloadLite({ ok: true, profile, daysSinceLastOrder, isReturning: (profile?.orderCount ?? 0) >= 1 });
      },
    }),
    add_to_cart: tool({
      description:
        "Add a searched menu item to the order. Rejects any line that does not carry a search_menu matchId.",
      inputSchema: z.object({
        catalogId: z.string().describe("catalogId from search_menu"),
        matchId: z.string().describe("matchId from search_menu"),
        quantity: z.number().int().min(1).max(20).default(1),
        optionIds: z.array(z.string()).optional().describe("Optional menu option IDs from search_menu."),
      }),
      execute: async ({ catalogId, matchId, quantity, optionIds }) => {
        try {
          ctx.setOrder(
            addToCart(cartForNewRequest(ctx.getOrder()), {
              catalogId,
              matchId,
              quantity,
              optionIds,
              source: "search_menu",
            }),
          );
          return payload({ ok: true, added: { catalogId, quantity, optionIds: optionIds ?? [] } });
        } catch (error) {
          if (error instanceof CartGuardrailError) {
            ctx.recordToolError(`add_to_cart:${error.code}`);
            return payload({ ok: false, code: error.code, message: error.message });
          }
          throw error;
        }
      },
    }),
    suggest_addons: tool({
      description:
        "Suggest at most one add-on for the current cart, from mined co-purchase rules blended with this customer's taste profile. Call after add_to_cart. Respect decision:'silent' - do not invent a suggestion.",
      inputSchema: z.object({}),
      execute: async () => {
        const order = ctx.getOrder();
        if (["otp_requested", "confirmed", "placed", "handoff"].includes(order.stage)) {
          return payload({
            ok: true,
            decision: "silent",
            suggestion: null,
            debug: { reason: "late_order_stage" },
          });
        }
        const profile = await deriveProfile(ctx.customerId).catch(() => null);
        const result = suggestAddons(
          order.cart.map((line) => ({ catalogId: line.catalogId, quantity: line.quantity })),
          ctx.orderContext,
          profile,
        );
        return payloadLite({ ok: true, ...result });
      },
    }),
    update_cart_line: tool({
      description: "Update or remove a cart line by server-issued lineId. Quantity 0 removes the line.",
      inputSchema: z.object({
        lineId: z.string(),
        quantity: z.number().int().min(0).max(20),
      }),
      execute: async ({ lineId, quantity }) => {
        try {
          ctx.setOrder(updateCartLine(ctx.getOrder(), lineId, quantity));
          return payload({ ok: true, updated: { lineId, quantity } });
        } catch (error) {
          if (error instanceof CartGuardrailError) {
            ctx.recordToolError(`update_cart_line:${error.code}`);
            return payload({ ok: false, code: error.code, message: error.message });
          }
          throw error;
        }
      },
    }),
    optimize_bill: tool({
      description:
        "Find a deterministic combo swap that lowers the current bill. Return a proposal token for accept_bill_swap.",
      inputSchema: z.object({}),
      execute: async () => {
        const proposal = optimizeBill(ctx.getOrder());
        return payloadLite({ ok: true, proposal });
      },
    }),
    accept_bill_swap: tool({
      description: "Apply a previously proposed bill optimization swap by server-side swapId.",
      inputSchema: z.object({
        swapId: z.string(),
      }),
      execute: async ({ swapId }) => {
        const proposal = takeProposal(swapId);
        if (!proposal) {
          ctx.recordToolError("accept_bill_swap:swap_expired");
          return payload({ ok: false, code: "swap_expired", message: "The bill swap proposal expired." });
        }
        ctx.setOrder(applyProposal(ctx.getOrder(), proposal));
        return payload({ ok: true, proposal });
      },
    }),
    interpret_craving: tool({
      description:
        "Map a vague craving ('gion gion spicy spicy, duoi 100k') to up to 3 real menu items with valid matchIds. Use when the user describes a mood/craving instead of a menu item. Results are add_to_cart-ready.",
      inputSchema: z.object({ craving: z.string().min(2) }),
      execute: async ({ craving }) => payloadLite({ ok: true, ...interpretCraving(craving) }),
    }),
    reorder_usual: tool({
      description:
        "Replay the customer's usual/last order into the cart in ONE turn. Call IMMEDIATELY (no clarifying question) when they ask for their usual, the same as last time, or same as always. No parameters, the customer comes from the runtime context.",
      inputSchema: z.object({}),
      execute: async () => {
        const result = await buildUsualOrder(ctx.customerId);
        if (!result.ok) {
          return payloadLite({ ok: false, reason: result.reason });
        }
        let order = cartForNewRequest(ctx.getOrder());
        const applied: string[] = [];
        for (const line of result.lines) {
          order = addToCart(order, {
            source: "search_menu",
            catalogId: line.catalogId,
            matchId: createMatchId(line.catalogId),
            quantity: line.quantity,
            optionIds: line.optionIds,
          });
          applied.push(line.name);
        }
        ctx.setOrder(order);
        return payload({
          ok: true,
          source: result.source,
          applied,
          skipped: result.skipped,
          summary: result.summary,
        });
      },
    }),
    apply_voucher: tool({
      description: "Validate and apply a voucher code through the mock OMS promotion service.",
      inputSchema: z.object({
        code: z.string().min(2).describe("Voucher code, for example KFC20."),
      }),
      execute: async ({ code }) => {
        const result = await applyVoucher(ctx.getOrder(), code);
        if (result.ok) ctx.setOrder(result.order);
        else ctx.recordToolError(`apply_voucher:${code}`);
        return payload({
          ok: result.ok,
          code: code.toUpperCase(),
          message: result.message,
          voucher: result.ok ? result.voucher : undefined,
        });
      },
    }),
    check_loyalty: tool({
      description: "Check KFC loyalty points and optionally redeem the best mock redemption.",
      inputSchema: z.object({
        customerId: z.string().optional(),
        redeem: z.boolean().default(false),
      }),
      execute: async ({ customerId, redeem }) => {
        const checkedCustomerId = customerId ?? ctx.customerId;
        const result = await checkLoyalty(checkedCustomerId, redeem);
        if (redeem) ctx.setOrder(setLoyalty(ctx.getOrder(), result.redemption));
        return payload({
          ok: true,
          customerId: checkedCustomerId,
          pointsBalance: result.pointsBalance,
          redeemOptions: result.redeemOptions,
          redeemed: redeem ? result.redemption : undefined,
        });
      },
    }),
    quote_order: tool({
      description: "Quote fulfillment, delivery fee, ETA, and recomputed order total.",
      inputSchema: z.object({
        fulfillment: z.enum(["pickup", "delivery"]).default("delivery"),
        address: z.string().optional(),
      }),
      execute: async ({ fulfillment, address }) => {
        const quote = quoteOrder(ctx.getOrder(), fulfillment, address);
        let order = setQuote(ctx.getOrder(), quote);

        // Auto-apply the best eligible voucher the customer never had to know
        // about. A user-applied code (appliedBy === "user") is untouchable; a
        // previously auto-applied one may be upgraded to a now-better option.
        let autoAppliedVoucher: { code: string; savedVnd: number } | undefined;
        const current = order.voucher;
        if (!current || current.appliedBy === "auto") {
          const best = bestVoucherFor(order, await loadVouchers());
          if (best && best.rule.code !== current?.code) {
            order = setVoucher(order, {
              code: best.rule.code,
              description: best.rule.description,
              discountType: best.rule.discountType,
              minimumSubtotalVnd: best.rule.minimumSubtotalVnd,
              percent: best.rule.percent,
              fixedVnd: best.rule.fixedVnd,
              maxDiscountVnd: best.rule.maxDiscountVnd,
              appliedBy: "auto",
            });
            autoAppliedVoucher = { code: best.rule.code, savedVnd: best.savedVnd };
          }
        }

        ctx.setOrder(order);
        return payload({ ok: true, quote, autoAppliedVoucher });
      },
    }),
    request_otp: tool({
      description:
        "Request an OTP before order placement. The code is sent to the customer's phone and is never returned here.",
      inputSchema: z.object({
        phone: z.string().default("+84901234567"),
      }),
      execute: async ({ phone }) => {
        const requested = await otpProvider.request(ctx.sessionKey, phone);
        // Capture the phone the customer just gave for zero-re-entry next time.
        // Fire-and-forget — never blocks or fails the OTP request.
        void getContactStore().saveContact(ctx.customerId, { phone }).catch(() => {});
        if (!requested.ok) {
          // Rate limit / cooldown — user impatience, NOT a tool failure. Do not
          // recordToolError (must never auto-escalate to a human for this).
          return payloadLite({
            ok: false,
            code: requested.code,
            message: `Could not send a new code yet. Wait ${requested.retryInSeconds}s and try again.`,
          });
        }
        ctx.setOrder(
          setOtpRequested(ctx.getOrder(), {
            maskedPhone: requested.maskedPhone,
            requestedAt: requested.requestedAt,
            expiresAt: requested.expiresAt,
            verified: false,
          }),
        );
        return payload({
          ok: true,
          maskedPhone: requested.maskedPhone,
          expiresAt: requested.expiresAt,
          smsSent: requested.smsSent,
          // devCode only present when OTP_EXPOSE_DEV_CODE=1 AND no real SMS went
          // out — in that demo mode this chat IS the delivery channel, so the
          // agent hands the code to the customer (clearly labeled demo).
          devCode: requested.devCode,
          message: requested.devCode
            ? `OTP sent to ${requested.maskedPhone}. DEMO MODE: the SMS gateway is mocked, so YOU must deliver the code. Include this code verbatim in your reply, labeled as a demo code: ${requested.devCode}`
            : requested.smsSent
              ? `OTP sent by SMS to ${requested.maskedPhone}.`
              : `OTP sent to ${requested.maskedPhone}.`,
        });
      },
    }),
    verify_otp: tool({
      description: "Verify the OTP the customer received. The code is checked server-side.",
      inputSchema: z.object({
        code: z.string().min(4),
      }),
      execute: async ({ code }) => {
        const result = await otpProvider.verify(ctx.sessionKey, code);
        if (result.ok) ctx.setOrder(setOtpVerified(ctx.getOrder()));
        else ctx.recordToolError(`verify_otp:${result.code}`);
        return payload({ ok: result.ok, message: result.message });
      },
    }),
    place_order: tool({
      description: "Create the order in the mock OMS after OTP is verified.",
      inputSchema: z.object({
        paymentMethod: z.enum(["cod", "card_at_door", "wallet"]).default("cod"),
      }),
      execute: async ({ paymentMethod }) => {
        // Server-derived OTP verification — never trusts client order.otp.verified.
        const serverVerified = await otpProvider.isVerified(ctx.sessionKey);
        const order = ctx.getOrder();

        // Risk-based OTP skip for trusted repeats. Recomputed here from the
        // server's own history + saved contact + the actual order, so the
        // grant is unforgeable — placeOrder's otpVerified check still runs, it
        // just receives a legitimately-derived true. New address / big ticket
        // never qualifies (see canSkipOtp) and takes the full OTP.
        let otpMode: "verified" | "trusted_skip" = "verified";
        let otpVerified = serverVerified;
        if (!serverVerified) {
          try {
            const [contact, priorOrders] = await Promise.all([
              getContactStore().getContact(ctx.customerId),
              getHistoryStore().getOrders(ctx.customerId, 25),
            ]);
            if (canSkipOtp({ customerId: ctx.customerId, order, contact, completedOrderCount: priorOrders.length })) {
              otpVerified = true;
              otpMode = "trusted_skip";
            }
          } catch {
            // Trust check failed to load — fall back to requiring the real OTP.
          }
        }

        const result = placeOrder(order, paymentMethod, otpVerified);
        if (result.ok) {
          const placed = setPlacedOrder(order, { ...result.placedOrder, otpMode });
          ctx.setOrder(placed);

          // Write-on-success: persist this order's contact facts (address +
          // fulfillment mode) so the next order is confirm-only. Overwrite-on-
          // newer handles "customer moved". Fire-and-forget.
          void getContactStore()
            .saveContact(ctx.customerId, {
              address: placed.quote?.address,
              fulfillment: placed.quote?.fulfillment,
            })
            .catch(() => {});
          try {
            await getHistoryStore().recordOrder({
              customerId: ctx.customerId,
              orderId: result.placedOrder.orderNumber,
              placedAt: result.placedOrder.createdAt,
              context: ctx.orderContext,
              lines: placed.cart.map((line) => ({
                catalogId: line.catalogId,
                quantity: line.quantity,
                optionIds: line.options.map((option) => option.id),
              })),
              totalVnd: placed.totals.totalVnd,
            });
          } catch (error) {
            console.warn("Failed to record customer history", error);
          }

          // Durable OMS record + lifecycle start (kfc_orders / kfc_order_events).
          try {
            await getOmsStore().createOrder(placed, result.placedOrder.orderNumber);
          } catch (error) {
            console.warn("Failed to persist OMS order", error);
          }

          // Loyalty settlement: debit any redemption, then earn on the final total.
          let loyaltyEarned = 0;
          try {
            const loyalty = getLoyaltyStore();
            if (placed.loyalty && placed.loyalty.pointsRedeemed > 0) {
              await loyalty.redeem(ctx.customerId, placed.loyalty.pointsRedeemed, result.placedOrder.orderNumber);
            }
            loyaltyEarned = await loyalty.earn(ctx.customerId, placed.totals.totalVnd, result.placedOrder.orderNumber);
          } catch (error) {
            console.warn("Failed to settle loyalty", error);
          }

          return payload({ ...result, loyaltyEarned, otpMode });
        } else if (!("code" in result) || result.code !== "item_out_of_stock") {
          ctx.recordToolError("place_order");
        }
        return payload(result);
      },
    }),
    check_order_status: tool({
      description:
        "Look up the customer's order in the OMS: current stage (placed/preparing/ready/completed/cancelled) and timeline. Use when the customer asks where their order is. orderNumber optional, omit to use their most recent order.",
      inputSchema: z.object({ orderNumber: z.string().optional() }),
      execute: async ({ orderNumber }) => {
        const store = getOmsStore();
        const record = orderNumber
          ? await store.getByOrderNumber(orderNumber.trim().toUpperCase())
          : await store.latestForCustomer(ctx.customerId);
        if (!record) {
          // Not an error for the auto-handoff net — a guest with no orders
          // asking about an order must not trip escalation.
          return payloadLite({ ok: false, code: "order_not_found", message: "No order found for this customer." });
        }
        const events = await store.getEvents(record.id);
        const label = OMS_STAGE_LABEL[record.stage];
        return payloadLite({
          ok: true,
          orderNumber: record.omsOrderNumber,
          stage: record.stage,
          stageVietnamese: label.vi,
          etaHint: label.etaHint,
          itemsSummary: record.itemsSummary,
          totalVnd: record.totalVnd,
          timeline: events.map((e) => ({ event: e.eventType, at: e.createdAt })),
        });
      },
    }),
    handoff_to_human: tool({
      description: "Escalate the conversation to a human agent with order and transcript context.",
      inputSchema: z.object({
        reason: z.string().min(3),
      }),
      execute: async ({ reason }) => {
        const handoff = createHumanHandoff(ctx.getOrder(), reason, ctx.transcriptSummary?.());
        ctx.setOrder(setHandoff(ctx.getOrder(), handoff));
        return payload({ ok: true, handoff });
      },
    }),
  };
}

export function createAgentRuntime(options: CreateAgentRuntimeOptions): AgentRuntime {
  const customerId = options.customerId ?? "guest";
  const orderContext = options.orderContext ?? { weather: "clear", hour: new Date().getHours() };
  const daysAhead = options.daysAhead ?? 0;
  let order: Order = { ...(options.initialOrder ?? createOrder("web")), customerId };
  let toolErrors = 0;

  const ctx = {
    getOrder: () => order,
    setOrder: (next: Order) => {
      order = { ...next, customerId };
    },
    sessionKey: options.sessionKey,
    customerId,
    orderContext,
    daysAhead,
    transcriptSummary: options.transcriptSummary,
    recordToolError: (reason: string) => {
      toolErrors += 1;
      if (toolErrors >= TOOL_ERROR_HANDOFF_THRESHOLD && !order.handoff) {
        const handoff = createHumanHandoff(
          order,
          `Auto-escalated after repeated tool errors (${reason}).`,
          options.transcriptSummary?.(),
        );
        order = setHandoff(order, handoff);
      }
    },
  };

  const tools = buildTools(ctx);

  return {
    get order() {
      return order;
    },
    tools,
    system: SYSTEM,
  };
}

/**
 * Re-validate an Order reconstructed from client-supplied messages. Every cart
 * line is rebuilt from the authoritative catalog (name + price + options), so
 * forged lines are dropped before they can influence a place_order.
 */
export function sanitizeReconstructedOrder(order: Order) {
  return revalidateOrder(order);
}
