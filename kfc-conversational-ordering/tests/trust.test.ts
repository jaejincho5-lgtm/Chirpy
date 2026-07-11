import assert from "node:assert/strict";
import { createOrder, type Order } from "../lib/order";
import {
  canSkipOtp,
  TRUSTED_SKIP_MAX_TOTAL_VND,
  type CanSkipOtpInput,
} from "../lib/trust";
import type { CustomerContact } from "../lib/contact-store";

function orderFor(totalVnd: number, address?: string): Order {
  const base = createOrder();
  return {
    ...base,
    totals: { ...base.totals, totalVnd },
    quote: {
      fulfillment: "delivery",
      address,
      deliveryFeeVnd: 15000,
      etaMinutes: 28,
      displayDeliveryFee: "15.000 VND",
    },
  };
}

const contact: CustomerContact = {
  customerId: "linh",
  name: "Linh",
  phone: "0901234567",
  address: "12 Nguyễn Huệ, Quận 1",
  fulfillment: "delivery",
  updatedAt: new Date().toISOString(),
};

const trustedInput: CanSkipOtpInput = {
  customerId: "linh",
  order: orderFor(150000, "12 Nguyen Hue, Quan 1"),
  contact,
  completedOrderCount: 2,
};

// --- flag is read at call time: off means never skip -------------------------

delete process.env.TRUSTED_SKIP_OTP;
assert.equal(canSkipOtp(trustedInput), false, "flag unset means OTP cannot be skipped");

process.env.TRUSTED_SKIP_OTP = "0";
assert.equal(canSkipOtp(trustedInput), false, "flag value other than 1 means OTP cannot be skipped");

// --- flag on plus all trust facts true means skip ----------------------------

process.env.TRUSTED_SKIP_OTP = "1";
assert.equal(
  canSkipOtp(trustedInput),
  true,
  "trusted repeat customer, small order, and normalized same address can skip OTP",
);

// --- total boundary: under 200k skips, at/above 200k never skips -------------

assert.equal(
  canSkipOtp({ ...trustedInput, order: orderFor(TRUSTED_SKIP_MAX_TOTAL_VND - 1, "12 Nguyễn Huệ, Quận 1") }),
  true,
  "total one VND below the boundary can skip",
);
assert.equal(
  canSkipOtp({ ...trustedInput, order: orderFor(TRUSTED_SKIP_MAX_TOTAL_VND, "12 Nguyễn Huệ, Quận 1") }),
  false,
  "total exactly at the boundary cannot skip",
);
assert.equal(
  canSkipOtp({ ...trustedInput, order: orderFor(TRUSTED_SKIP_MAX_TOTAL_VND + 1, "12 Nguyễn Huệ, Quận 1") }),
  false,
  "total one VND above the boundary cannot skip",
);

// --- each other condition failing individually means no skip -----------------

assert.equal(
  canSkipOtp({ ...trustedInput, completedOrderCount: 0 }),
  false,
  "no completed orders means no skip",
);
assert.equal(
  canSkipOtp({ ...trustedInput, contact: null }),
  false,
  "missing saved contact means no skip",
);
assert.equal(
  canSkipOtp({ ...trustedInput, contact: { ...contact, address: undefined } }),
  false,
  "missing saved address means no skip",
);
assert.equal(
  canSkipOtp({ ...trustedInput, order: orderFor(150000, undefined) }),
  false,
  "missing delivery address on the order means no skip",
);
assert.equal(
  canSkipOtp({ ...trustedInput, order: orderFor(150000, "99 Đường Khác, Quận 7") }),
  false,
  "mismatched delivery address means no skip",
);

delete process.env.TRUSTED_SKIP_OTP;
console.log("trust tests passed");
