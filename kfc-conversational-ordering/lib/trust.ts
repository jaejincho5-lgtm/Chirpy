// Risk-based OTP skip for trusted repeat customers. A pure, unit-testable
// predicate: the ONLY thing that decides whether a returning customer's small,
// same-address order may skip the confirmation code. It composes WITH the OTP
// provider — the place_order path feeds its result into the SAME server-side
// otpVerified check placeOrder already trusts (never a client value), so this
// can only ever GRANT trust on facts the server recomputed, never bypass the
// check itself.

import type { Order } from "./order";
import type { CustomerContact } from "./contact-store";
import { normalize } from "./faq-cache";

/** Orders at/above this total always take the full OTP, however trusted. */
export const TRUSTED_SKIP_MAX_TOTAL_VND = 200_000;

/** Default ON for the demo; documented in .env.local. Unset ⇒ full OTP always. */
export function trustedSkipEnabled(): boolean {
  return process.env.TRUSTED_SKIP_OTP === "1";
}

/** Diacritic-stripped, whitespace-collapsed equality (normalize already does both). */
function addressesMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const na = normalize(a);
  const nb = normalize(b);
  return na.length > 0 && na === nb;
}

export type CanSkipOtpInput = {
  customerId: string;
  order: Order;
  contact: CustomerContact | null;
  completedOrderCount: number;
};

/**
 * True ONLY when every trust condition holds: the feature is enabled, the
 * customer has completed ≥1 order before, this order is under the ceiling, a
 * saved contact exists, AND — for delivery — the address matches the saved one
 * (pickup compares the saved fulfillment mode instead). A new address or a big
 * ticket ⇒ false ⇒ the normal OTP flow runs untouched.
 */
export function canSkipOtp(input: CanSkipOtpInput): boolean {
  if (!trustedSkipEnabled()) return false;
  if (!input.contact) return false;
  if (input.completedOrderCount < 1) return false;
  if (input.order.totals.totalVnd >= TRUSTED_SKIP_MAX_TOTAL_VND) return false;

  const fulfillment = input.order.quote?.fulfillment;
  if (fulfillment === "pickup") {
    return input.contact.fulfillment === "pickup";
  }
  // Delivery (default): the destination must be the trusted, saved address.
  return addressesMatch(input.order.quote?.address, input.contact.address);
}
