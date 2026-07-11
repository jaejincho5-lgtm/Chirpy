import assert from "node:assert/strict";
import { averageUserMessageLength, replyStyleFor, verbosityHint } from "../lib/verbosity";
import { composeStatusMessage } from "../lib/status-push";

// --- reply-length learning (pure) --------------------------------------------

// No messages yet → neutral (base prompt's own "concise" rule stands).
assert.equal(averageUserMessageLength([]), null, "empty history has no average");
assert.equal(replyStyleFor([]), "normal", "no history → normal style");
assert.equal(verbosityHint([]), null, "no history → no override hint");

// One-word / compact texters → terse.
assert.equal(replyStyleFor(["ok"]), "terse", "one-word reply → terse");
assert.equal(replyStyleFor(["combo 9", "ok", "giao nhà"]), "terse", "short commands → terse");
assert.match(verbosityHint(["ok"]) ?? "", /cực ngắn/, "terse hint pushes for a very short reply");

// A normal ordering request sits in the neutral middle.
assert.equal(
  replyStyleFor(["cho mình 1 combo gà rán và 1 pepsi"]),
  "normal",
  "a normal request stays neutral",
);
assert.equal(verbosityHint(["cho mình 1 combo gà rán và 1 pepsi"]), null, "normal → no override");

// A descriptive paragraph → expansive.
const chatty =
  "Chào bạn, mình muốn đặt một phần gà rán giòn cho hai người ăn tối nay, kèm khoai tây và nước ngọt, giao tới nhà giúp mình nhé, cảm ơn nhiều";
assert.equal(replyStyleFor([chatty]), "expansive", "long descriptive message → expansive");
assert.match(verbosityHint([chatty]) ?? "", /diễn giải/, "expansive hint allows a fuller reply");

// The average is over non-empty messages; whitespace-only turns are ignored.
assert.equal(averageUserMessageLength(["ab", "  ", "cdef"]), 3, "blank turns excluded from the mean");

// --- proactive status messages (pure) ----------------------------------------

// `placed` is order creation, not a proactive announcement.
assert.equal(composeStatusMessage("placed", "KFC-123"), null, "placed is not proactively announced");

// Lifecycle stages produce a customer line naming the order number.
for (const stage of ["preparing", "ready", "completed", "cancelled"] as const) {
  const msg = composeStatusMessage(stage, "KFC-123");
  assert.ok(msg && msg.includes("KFC-123"), `${stage} message names the order number`);
}
assert.match(composeStatusMessage("preparing", "KFC-9") ?? "", /chuẩn bị/, "preparing mentions kitchen prep");
assert.match(composeStatusMessage("cancelled", "KFC-9") ?? "", /hủy/, "cancelled mentions cancellation");

console.log("verbosity + status-push tests passed");
