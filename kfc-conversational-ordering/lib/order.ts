import {
  createMatchId,
  formatVnd,
  getCatalogEntry,
  getMenuOption,
  type MenuOption,
} from "./menu";
import {
  computeVoucherDiscount,
  isFreeDelivery,
  type VoucherDiscountType,
} from "./vouchers";

export type OrderStage =
  | "browsing"
  | "cart"
  | "quoted"
  | "otp_requested"
  | "confirmed"
  | "placed"
  | "handoff";

export type FulfillmentMode = "pickup" | "delivery";

export type GuardrailCode =
  | "missing_search_match"
  | "invalid_match_id"
  | "unknown_catalog_item"
  | "unavailable_catalog_item"
  | "invalid_quantity"
  | "invalid_option"
  | "unknown_cart_line";

export class CartGuardrailError extends Error {
  code: GuardrailCode;

  constructor(code: GuardrailCode, message: string) {
    super(message);
    this.name = "CartGuardrailError";
    this.code = code;
  }
}

export type CartLineOption = MenuOption & {
  displayPriceDelta: string;
};

export type CartLine = {
  lineId: string;
  catalogId: string;
  matchId: string;
  source: "search_menu";
  name: string;
  vietnameseName: string;
  quantity: number;
  unitPriceVnd: number;
  options: CartLineOption[];
  totalPriceVnd: number;
  displayUnitPrice: string;
  displayTotalPrice: string;
};

// The voucher stored on the order is the *rule*, not a frozen discount amount.
// calculateTotals recomputes the discount from this rule against the current
// subtotal on every mutation, so apply-order no longer affects the result.
export type VoucherApplication = {
  code: string;
  description: string;
  discountType: VoucherDiscountType;
  minimumSubtotalVnd: number;
  percent?: number;
  fixedVnd?: number;
  maxDiscountVnd?: number;
  // Provenance: "user" = the customer asked for this code; "auto" = the system
  // picked the best eligible voucher at quote time. Only "auto" vouchers may be
  // upgraded/replaced by a later auto-apply — a user's choice always wins.
  appliedBy?: "auto" | "user";
};

export type LoyaltyRedemption = {
  customerId: string;
  pointsBalance: number;
  pointsRedeemed: number;
  discountVnd: number;
  displayDiscount: string;
};

export type OrderQuote = {
  fulfillment: FulfillmentMode;
  address?: string;
  deliveryFeeVnd: number;
  etaMinutes: number;
  displayDeliveryFee: string;
};

// Display-only OTP metadata. The secret code and the authoritative verified
// flag live server-side in lib/otp.ts — this `verified` field is a UI hint only
// and is NEVER trusted for placing an order (see placeOrder's otpVerified arg).
export type OtpState = {
  maskedPhone: string;
  requestedAt: string;
  expiresAt?: string;
  verified: boolean;
};

export type PlacedOrder = {
  orderNumber: string;
  createdAt: string;
  paymentMethod: "cod" | "card_at_door" | "wallet";
  omsStatus: "accepted";
  // How the order cleared confirmation: a real OTP verify, or a risk-based skip
  // for a trusted repeat customer. Persisted (rides the order payload into the
  // OMS record) so /backend's Orders module can badge it.
  otpMode?: "verified" | "trusted_skip";
};

export type Handoff = {
  reason: string;
  ticketId: string;
  summary: string;
  createdAt: string;
};

export type OrderTotals = {
  subtotalVnd: number;
  voucherDiscountVnd: number;
  loyaltyDiscountVnd: number;
  deliveryFeeVnd: number;
  totalVnd: number;
  displaySubtotal: string;
  displayVoucherDiscount: string;
  displayLoyaltyDiscount: string;
  displayDeliveryFee: string;
  displayTotal: string;
};

export type Order = {
  orderId: string;
  channel: "web" | "messenger";
  stage: OrderStage;
  customerId?: string;
  cart: CartLine[];
  voucher?: VoucherApplication;
  loyalty?: LoyaltyRedemption;
  quote?: OrderQuote;
  otp?: OtpState;
  placedOrder?: PlacedOrder;
  handoff?: Handoff;
  totals: OrderTotals;
  updatedAt: string;
};

export type AddToCartInput = {
  catalogId: string;
  matchId: string;
  source: "search_menu";
  quantity: number;
  optionIds?: string[];
};

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyTotals(): OrderTotals {
  return {
    subtotalVnd: 0,
    voucherDiscountVnd: 0,
    loyaltyDiscountVnd: 0,
    deliveryFeeVnd: 0,
    totalVnd: 0,
    displaySubtotal: formatVnd(0),
    displayVoucherDiscount: formatVnd(0),
    displayLoyaltyDiscount: formatVnd(0),
    displayDeliveryFee: formatVnd(0),
    displayTotal: formatVnd(0),
  };
}

export function createOrder(channel: Order["channel"] = "web"): Order {
  return {
    orderId: makeId("kfc_order"),
    channel,
    stage: "browsing",
    cart: [],
    totals: emptyTotals(),
    updatedAt: nowIso(),
  };
}

export function calculateTotals(order: Order): OrderTotals {
  const subtotalVnd = order.cart.reduce((sum, line) => sum + line.totalPriceVnd, 0);

  // Recompute the voucher discount from its rule every time — never frozen.
  const voucherDiscountVnd = order.voucher
    ? Math.min(computeVoucherDiscount(order.voucher, subtotalVnd), subtotalVnd)
    : 0;

  const loyaltyDiscountVnd = Math.min(
    order.loyalty?.discountVnd ?? 0,
    Math.max(0, subtotalVnd - voucherDiscountVnd),
  );

  // FREESHIP's delivery-fee waiver is applied here (not at apply-voucher time),
  // so a voucher applied before OR after quote_order still waives the fee.
  const baseDeliveryFeeVnd = order.quote?.deliveryFeeVnd ?? 0;
  const voucherWaivesDelivery = order.voucher
    ? isFreeDelivery(order.voucher) && subtotalVnd >= order.voucher.minimumSubtotalVnd
    : false;
  const deliveryFeeVnd = voucherWaivesDelivery ? 0 : baseDeliveryFeeVnd;

  const totalVnd = Math.max(0, subtotalVnd - voucherDiscountVnd - loyaltyDiscountVnd + deliveryFeeVnd);

  return {
    subtotalVnd,
    voucherDiscountVnd,
    loyaltyDiscountVnd,
    deliveryFeeVnd,
    totalVnd,
    displaySubtotal: formatVnd(subtotalVnd),
    displayVoucherDiscount: formatVnd(voucherDiscountVnd),
    displayLoyaltyDiscount: formatVnd(loyaltyDiscountVnd),
    displayDeliveryFee: formatVnd(deliveryFeeVnd),
    displayTotal: formatVnd(totalVnd),
  };
}

export function repriceOrder(order: Order): Order {
  return {
    ...order,
    totals: calculateTotals(order),
    updatedAt: nowIso(),
  };
}

function normalizeOptionIds(optionIds: string[] = []) {
  return [...new Set(optionIds)].sort();
}

function lineKey(catalogId: string, optionIds: string[]) {
  return `${catalogId}:${normalizeOptionIds(optionIds).join(",")}`;
}

function validateCartInput(input: AddToCartInput) {
  if (input.source !== "search_menu") {
    throw new CartGuardrailError(
      "missing_search_match",
      "Cart lines must come from a search_menu result.",
    );
  }

  if (!input.matchId || input.matchId !== createMatchId(input.catalogId)) {
    throw new CartGuardrailError(
      "invalid_match_id",
      "The cart line matchId does not match the menu catalog item.",
    );
  }

  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 20) {
    throw new CartGuardrailError("invalid_quantity", "Quantity must be an integer between 1 and 20.");
  }

  const item = getCatalogEntry(input.catalogId);
  if (!item) {
    throw new CartGuardrailError("unknown_catalog_item", "Catalog item was not found.");
  }

  if (!item.available) {
    throw new CartGuardrailError("unavailable_catalog_item", "Catalog item is unavailable.");
  }

  for (const optionId of input.optionIds ?? []) {
    if (!getMenuOption(item, optionId)) {
      throw new CartGuardrailError("invalid_option", `Option ${optionId} is not available for ${item.name}.`);
    }
  }

  return item;
}

export function addToCart(order: Order, input: AddToCartInput): Order {
  const item = validateCartInput(input);
  const optionIds = normalizeOptionIds(input.optionIds);
  const options = optionIds.map((optionId) => {
    const option = getMenuOption(item, optionId);
    if (!option) {
      throw new CartGuardrailError("invalid_option", `Option ${optionId} is not available for ${item.name}.`);
    }
    return { ...option, displayPriceDelta: formatVnd(option.priceDeltaVnd) };
  });
  const optionTotal = options.reduce((sum, option) => sum + option.priceDeltaVnd, 0);
  const unitPriceVnd = item.priceVnd + optionTotal;
  const existingKey = lineKey(item.id, optionIds);
  const cart = [...order.cart];
  const existingIndex = cart.findIndex((line) =>
    lineKey(
      line.catalogId,
      line.options.map((option) => option.id),
    ) === existingKey
  );

  if (existingIndex >= 0) {
    const existing = cart[existingIndex];
    const quantity = existing.quantity + input.quantity;
    const totalPriceVnd = unitPriceVnd * quantity;
    cart[existingIndex] = {
      ...existing,
      quantity,
      totalPriceVnd,
      displayTotalPrice: formatVnd(totalPriceVnd),
    };
  } else {
    const totalPriceVnd = unitPriceVnd * input.quantity;
    cart.push({
      lineId: makeId("line"),
      catalogId: item.id,
      matchId: input.matchId,
      source: "search_menu",
      name: item.name,
      vietnameseName: item.vietnameseName,
      quantity: input.quantity,
      unitPriceVnd,
      options,
      totalPriceVnd,
      displayUnitPrice: formatVnd(unitPriceVnd),
      displayTotalPrice: formatVnd(totalPriceVnd),
    });
  }

  return repriceOrder({
    ...order,
    cart,
    stage: order.stage === "browsing" ? "cart" : order.stage,
  });
}

export function updateCartLine(order: Order, lineId: string, quantity: number): Order {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 20) {
    throw new CartGuardrailError("invalid_quantity", "Quantity must be an integer between 0 and 20.");
  }

  const index = order.cart.findIndex((line) => line.lineId === lineId);
  if (index < 0) {
    throw new CartGuardrailError("unknown_cart_line", "Cart line was not found.");
  }

  const cart = [...order.cart];
  if (quantity === 0) {
    cart.splice(index, 1);
  } else {
    const line = cart[index];
    const totalPriceVnd = line.unitPriceVnd * quantity;
    cart[index] = {
      ...line,
      quantity,
      totalPriceVnd,
      displayTotalPrice: formatVnd(totalPriceVnd),
    };
  }

  const stage = cart.length ? order.stage : order.stage === "placed" || order.stage === "handoff" ? order.stage : "browsing";
  return repriceOrder({ ...order, cart, stage });
}

export function setVoucher(order: Order, voucher?: VoucherApplication): Order {
  return repriceOrder({ ...order, voucher, stage: order.cart.length ? "cart" : order.stage });
}

export function setLoyalty(order: Order, loyalty?: LoyaltyRedemption): Order {
  return repriceOrder({ ...order, loyalty, stage: order.cart.length ? "cart" : order.stage });
}

export function setQuote(order: Order, quote: OrderQuote): Order {
  return repriceOrder({ ...order, quote, stage: "quoted" });
}

export function setOtpRequested(order: Order, otp: OtpState): Order {
  return repriceOrder({ ...order, otp, stage: "otp_requested" });
}

export function setOtpVerified(order: Order): Order {
  if (!order.otp) return order;
  return repriceOrder({
    ...order,
    otp: { ...order.otp, verified: true },
    stage: "confirmed",
  });
}

export function setPlacedOrder(order: Order, placedOrder: PlacedOrder): Order {
  return repriceOrder({ ...order, placedOrder, stage: "placed" });
}

export function setHandoff(order: Order, handoff: Handoff): Order {
  return repriceOrder({ ...order, handoff, stage: "handoff" });
}

export function compactOrderState(order: Order) {
  return {
    orderId: order.orderId,
    stage: order.stage,
    items: order.cart.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      total: line.displayTotalPrice,
    })),
    voucher: order.voucher?.code ?? null,
    loyaltyRedeemed: order.loyalty?.pointsRedeemed ?? 0,
    fulfillment: order.quote?.fulfillment ?? null,
    total: order.totals.displayTotal,
    otpVerified: Boolean(order.otp?.verified),
    otpMode: order.placedOrder?.otpMode ?? null,
    orderNumber: order.placedOrder?.orderNumber ?? null,
    handoffTicket: order.handoff?.ticketId ?? null,
  };
}

export type RevalidationResult = {
  order: Order;
  rejected: Array<{ catalogId: string; reason: GuardrailCode }>;
};

/**
 * Rebuild every cart line from the authoritative catalog. The server calls this
 * on any Order reconstructed from client-supplied messages so a crafted request
 * cannot inject a forged line (unknown item, fake name, or tampered price). Any
 * line that does not resolve to an available catalog entry with a valid matchId
 * and options is dropped. Prices/names are always taken from the catalog, never
 * from the client. Discounts and totals are then recomputed.
 */
export function revalidateOrder(order: Order): RevalidationResult {
  const rejected: RevalidationResult["rejected"] = [];
  const cart: CartLine[] = [];

  for (const line of order.cart ?? []) {
    const item = getCatalogEntry(line.catalogId);
    if (!item) {
      rejected.push({ catalogId: line.catalogId, reason: "unknown_catalog_item" });
      continue;
    }
    if (!item.available) {
      rejected.push({ catalogId: line.catalogId, reason: "unavailable_catalog_item" });
      continue;
    }
    if (line.matchId !== createMatchId(line.catalogId)) {
      rejected.push({ catalogId: line.catalogId, reason: "invalid_match_id" });
      continue;
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 20) {
      rejected.push({ catalogId: line.catalogId, reason: "invalid_quantity" });
      continue;
    }

    // Re-derive options strictly from the catalog — ignore any client-sent
    // option pricing/names.
    const optionIds = normalizeOptionIds((line.options ?? []).map((option) => option.id));
    let optionsValid = true;
    const options: CartLineOption[] = [];
    for (const optionId of optionIds) {
      const option = getMenuOption(item, optionId);
      if (!option) {
        optionsValid = false;
        break;
      }
      options.push({ ...option, displayPriceDelta: formatVnd(option.priceDeltaVnd) });
    }
    if (!optionsValid) {
      rejected.push({ catalogId: line.catalogId, reason: "invalid_option" });
      continue;
    }

    const optionTotal = options.reduce((sum, option) => sum + option.priceDeltaVnd, 0);
    const unitPriceVnd = item.priceVnd + optionTotal;
    const totalPriceVnd = unitPriceVnd * line.quantity;

    cart.push({
      lineId: line.lineId || makeId("line"),
      catalogId: item.id,
      matchId: createMatchId(item.id),
      source: "search_menu",
      name: item.name,
      vietnameseName: item.vietnameseName,
      quantity: line.quantity,
      unitPriceVnd,
      options,
      totalPriceVnd,
      displayUnitPrice: formatVnd(unitPriceVnd),
      displayTotalPrice: formatVnd(totalPriceVnd),
    });
  }

  return { order: repriceOrder({ ...order, cart }), rejected };
}

export function summarizeOrder(order: Order) {
  const itemSummary = order.cart.length
    ? order.cart.map((line) => `${line.quantity}x ${line.name}`).join(", ")
    : "empty cart";
  const voucher = order.voucher ? `Voucher ${order.voucher.code} applied. ` : "";
  const loyalty = order.loyalty ? `${order.loyalty.pointsRedeemed} loyalty points redeemed. ` : "";
  return `${itemSummary}. ${voucher}${loyalty}Total ${order.totals.displayTotal}. Stage ${order.stage}.`;
}
