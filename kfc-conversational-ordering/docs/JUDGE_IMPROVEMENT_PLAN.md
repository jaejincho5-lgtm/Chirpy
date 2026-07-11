# Judge-Focused App Improvement Plan

## Summary

Optimize the app around the judge's stated buying logic: conversation enters Messenger, the system routes it into FAQ or ordering, ordering becomes almost frictionless, the app emits a confidential-format-safe OMS handoff payload, and staff can manage fulfillment in the backend.

The primary demo upgrade is a Quick Order path so a customer can type or say:

```text
combo 9, 099999999, 123 Nguyen Hue
```

The app should immediately build a validated cart, ask for or trigger confirmation, and show the order in the staff backend.

## Key Changes

- Add an explicit intent router before the full LLM path:
  - `faq`: current `matchFaq` fast path.
  - `quick_order`: deterministic parser for compact order messages with item alias, phone, and address.
  - `ordering`: existing agent state machine.
  - `handoff`: human escalation when intent is unclear or the customer asks for staff.
- Add `lib/quick-order.ts`:
  - Parse `combo 9`, `combo9`, `c9`, and `#9` as a seeded livestream alias for `combo-zinger`.
  - Extract Vietnamese phone-like digit strings and the remaining address.
  - Validate the mapped catalog item through existing `addToCart` guardrails.
  - Quote delivery, request OTP, and return the same `Order` object shape used by `/user`, `/voice`, and Messenger.
- Replace "mock OMS" language with a confidential OMS adapter story:
  - Rename outward-facing copy/tool descriptions to "OMS handoff" or "internal OMS queue."
  - Keep the app's internal generic JSON as the demo payload.
  - Add an `omsPayload` field to placed order events that is intentionally generic: order number, channel, items, totals, fulfillment, customer phone/address, and status.
  - State in README/backend copy that KFC's real OMS format is NDA-confidential and this adapter is where their mapping would go.
- Improve `/backend` Orders module for staff:
  - Show a clear OMS payload preview per order.
  - Show customer phone/address when present.
  - Keep existing stage buttons: `placed -> preparing -> ready -> completed/cancelled`.
  - Add a short status timeline so judges see staff-side operations, not just a table.
- Improve Messenger path:
  - Run the same quick-order parser inside `forwardToAgent` before invoking the LLM.
  - If quick order succeeds and `MESSENGER_TOKEN` is set, send the confirmation reply through Messenger.
  - If quick order is incomplete, reply with one missing field only: item, phone, or address.

## Public Interfaces and Types

- Add `QuickOrderResult`:
  - `matched: boolean`
  - `missing?: "item" | "phone" | "address"`
  - `order?: Order`
  - `reply: string`
- Extend order metadata to carry checkout details:
  - `phone?: string`
  - Continue using `OrderQuote.address` for delivery address.
- Extend OMS event payload for placement:

```ts
{
  omsPayload: {
    orderNumber: string;
    channel: "web" | "messenger";
    customerId: string | null;
    items: Array<{ catalogId: string; name: string; quantity: number; unitPriceVnd: number }>;
    totals: OrderTotals;
    fulfillment: FulfillmentMode;
    phone?: string;
    address?: string;
    status: "placed";
  };
}
```

- Add optional API route support:
  - `/api/agent` checks quick order before `streamText`.
  - `/api/webhook/messenger` quick-order path uses the same helper.

## Test Plan

- Unit tests:
  - `combo 9, 099999999, 123 Nguyen Hue` creates a cart with `combo-zinger`, quote delivery, phone, address, and OTP requested.
  - Missing phone asks only for phone.
  - Missing address asks only for address.
  - Unknown alias falls through to normal agent ordering.
  - Forged quick-order catalog IDs cannot bypass `addToCart`.
- Backend tests:
  - Placed order persists to `kfc_orders`.
  - OMS event includes generic `omsPayload`.
  - Staff status transitions still reject invalid jumps.
- Channel eval:
  - Simulated Messenger POST with quick-order text returns a confirmation without duplicate cart state.
  - Multi-turn quick order works: `combo 9` -> phone -> address.
- Manual demo acceptance:
  - `/user`: paste `combo 9, 099999999, 123 Nguyen Hue`; receipt appears.
  - `/voice`: speak the same phrase; receipt appears and ambassador reads confirmation.
  - `/backend`: order appears in Orders module with payload preview and staff status buttons.
  - Messenger webhook simulation returns the same confirmation.

## Assumptions

- Primary target is the judge demo, with enough architecture polish to explain production integration.
- `combo 9` is treated as a livestream/campaign alias, not an official KFC catalog number; demo seed maps it to `combo-zinger`.
- Real KFC OMS formatting stays out of scope because it is NDA-confidential; the app exposes a generic adapter boundary and payload preview instead.
- Payment remains out of scope; OTP-confirmed order creation plus staff OMS status management is the demo endpoint.
