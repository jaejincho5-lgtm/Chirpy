import assert from "node:assert/strict";
import { createOrder, type Order } from "../lib/order";
import { canSkipOtp } from "../lib/trust";
import {
  getContactStore,
  resetInMemoryContacts,
  type CustomerContact,
} from "../lib/contact-store";

function orderFor(totalVnd: number, fulfillment: "delivery" | "pickup", address?: string): Order {
  const base = createOrder();
  return {
    ...base,
    totals: { ...base.totals, totalVnd },
    quote: { fulfillment, address, deliveryFeeVnd: 15000, etaMinutes: 20, displayDeliveryFee: "15.000 ₫" },
  };
}

const contact: CustomerContact = {
  customerId: "linh",
  phone: "0901234567",
  address: "12 Nguyễn Huệ, Quận 1",
  fulfillment: "delivery",
  updatedAt: new Date().toISOString(),
};

const base = { customerId: "linh", contact, completedOrderCount: 3 };

// --- env OFF ⇒ always full OTP (identical to pre-feature behavior) -----------

delete process.env.TRUSTED_SKIP_OTP;
assert.equal(
  canSkipOtp({ ...base, order: orderFor(150000, "delivery", "12 Nguyen Hue, Quan 1") }),
  false,
  "TRUSTED_SKIP_OTP unset ⇒ never skip",
);

// --- all conditions true ⇒ skip (diacritic-insensitive address match) --------

process.env.TRUSTED_SKIP_OTP = "1";
assert.equal(
  canSkipOtp({ ...base, order: orderFor(150000, "delivery", "12 Nguyen Hue, Quan 1") }),
  true,
  "trusted repeat, small order, matching (diacritic-free) address ⇒ skip",
);

// --- each condition individually false ⇒ no skip -----------------------------

assert.equal(
  canSkipOtp({ ...base, completedOrderCount: 0, order: orderFor(150000, "delivery", "12 Nguyễn Huệ, Quận 1") }),
  false,
  "zero completed orders ⇒ no skip",
);
assert.equal(
  canSkipOtp({ ...base, order: orderFor(200000, "delivery", "12 Nguyễn Huệ, Quận 1") }),
  false,
  "total at/above 200k ⇒ no skip",
);
assert.equal(
  canSkipOtp({ ...base, order: orderFor(150000, "delivery", "99 Đường Khác, Quận 7") }),
  false,
  "new/mismatched address ⇒ no skip",
);
assert.equal(
  canSkipOtp({ ...base, contact: null, order: orderFor(150000, "delivery", "12 Nguyễn Huệ, Quận 1") }),
  false,
  "no saved contact ⇒ no skip",
);

// --- pickup compares fulfillment mode, not address ---------------------------

assert.equal(
  canSkipOtp({
    ...base,
    contact: { ...contact, fulfillment: "pickup" },
    order: orderFor(150000, "pickup", "Quận 1"),
  }),
  true,
  "pickup + saved pickup mode ⇒ skip",
);
assert.equal(
  canSkipOtp({
    ...base,
    contact: { ...contact, fulfillment: "delivery" },
    order: orderFor(150000, "pickup", "Quận 1"),
  }),
  false,
  "pickup order but saved mode is delivery ⇒ no skip",
);

// --- contact save/load roundtrip + overwrite-on-newer merge ------------------

resetInMemoryContacts();
await getContactStore().saveContact("cust_rt", { phone: "0900000000", address: "1 A Street", fulfillment: "delivery" });
const loaded = await getContactStore().getContact("cust_rt");
assert.equal(loaded?.address, "1 A Street", "address persisted");
assert.equal(loaded?.phone, "0900000000", "phone persisted");
assert.equal(loaded?.fulfillment, "delivery", "fulfillment persisted");

await getContactStore().saveContact("cust_rt", { address: "2 B Street" });
const merged = await getContactStore().getContact("cust_rt");
assert.equal(merged?.address, "2 B Street", "address updated on newer order");
assert.equal(merged?.phone, "0900000000", "a partial save keeps the prior phone");

// demo seed is present for the rehearsal customer
assert.ok((await getContactStore().getContact("msgr_demo_linh"))?.address, "demo contact seeded");

delete process.env.TRUSTED_SKIP_OTP;
console.log("zero-re-entry contact + OTP-skip tests passed");
