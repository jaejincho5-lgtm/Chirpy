# Demo Runbook — exact clicks, in order

Operator sheet for the person driving. What to *say* is in [DEMO_SCRIPT.md](./DEMO_SCRIPT.md); this is only what to *click and type*, in sequence. Practice until you can do it without reading.

**Golden rule:** after ANY completed order, click **"Khách quay lại, chat mới"** before demoing the next order. (The old doubling bug — same-chat reorders merging into the placed cart — is FIXED in code via `cartForNewRequest`, but a fresh chat still demos cleaner: no scrollback, fresh receipt.)

---

## Setup (do once, ~10 min before your slot)

| # | Where | Do |
|---|---|---|
| 1 | Browser | Open **`/user`** in left window (~60% width), **`/backend`** in right window (~40%), same browser. Enter backend password. Stay on the **Đạo diễn (Director)** tab. |
| 2 | Director | Confirm the right panel says the link is live (transcript mirrors /user). If it says "Mở /user trong tab khác…", both windows are not in the same browser — fix that first. |
| 3 | Director → Khách hàng | Select **"Linh, khách quen"** |
| 4 | Director → Thời tiết | Click **"Mưa"** |
| 5 | Director → Thời điểm | Click **"Trưa"** |
| 6 | Director → Đồng hồ demo | Click **"Hôm nay"** |
| 7 | Director | Confirm **"Kịch bản: Pepsi hết hàng" is OFF** (button not highlighted). If lit, click it once to turn off. |
| 8 | /user | **Seed check:** does the "Hồ sơ vị giác" card on Director show a usual order for Linh? If NOT: place one full order in /user now (`Cho mình 1 burger zinger và khoai tây` → add Pepsi → address → OTP), then click **"Khách quay lại, chat mới"**. |
| 9 | /user | Chat should now be **empty**. You are ready. Touch nothing else. |

---

## Round 1 — the 60-second run (2 typed messages, 0 clicks)

Everything is pre-set. During the 60 seconds you only type in /user and point at the Director screen.

| # | Where | Do |
|---|---|---|
| 1 | /user | Type: `như mọi khi` → Enter. (Cart fills with Linh's usual.) |
| 2 | — | While it streams: point at the tool trace (right screen). Agent will suggest hot soup (rain) and mention the auto-voucher. |
| 3 | /user | Type: `ok chốt đơn giao như cũ nha` → Enter. (Trusted regular → no OTP → order places.) |
| 4 | — | STOP. Freeze on receipt + trace. Do not click or type anything else. |

**If asked to "try something" after:** click **"Khách quay lại, chat mới"** FIRST, then let them type. Avoid "cho 1 combo 1" phrasing unless the latest deploy includes commit `04755e3`.

---

## Finals only — the +30s extension (in this exact order)

### Beat A: out-of-stock recovery

| # | Where | Do |
|---|---|---|
| 1 | Director | Click **"Khách quay lại, chat mới"** (fresh chat — avoids the doubling bug). |
| 2 | Director | Click **"Kịch bản: Pepsi hết hàng"** (turns red/active). |
| 3 | /user | Type: `thêm 1 pepsi` → Enter. Agent hits the stock wall and offers a substitute with real prices. |
| 4 | Director | **Click "Kịch bản: Pepsi hết hàng" again to turn it OFF.** (If you forget, Pepsi is dead for every conversation after — including judge freestyle.) |

### Beat B: proactive nudge + one-phrase reorder

| # | Where | Do |
|---|---|---|
| 5 | Director | Click **"Khách quay lại, chat mới"** again (must be a fresh chat with an empty cart). |
| 6 | Director → Đồng hồ demo | Click **"Tuần sau"** (fakes "7 days since her last order" so the nudge has a reason). |
| 7 | Director | Click **"Gửi tin chủ động (nudge)"** — **ONCE. Never twice.** (A second press visibly violates the "max 1/week" policy printed on the button.) |
| 8 | /user | Nudge message appears. Type: `như cũ` → Enter. Order places in one phrase, 1x quantities. |
| 9 | Director → Đồng hồ demo | Click **"Hôm nay"** to restore, in case of Q&A freestyle. |

---

## Panic buttons

| Symptom | Do |
|---|---|
| Cart shows 2x of everything | You skipped a "Khách quay lại, chat mới". Click it now, say "let me show you as a returning customer", type `như mọi khi` — clean retry in one line. |
| Nudge fired but reorder doubled | Same cause, same recovery as above. |
| Weather suggestion didn't appear | Check Thời tiết is on **Mưa** (not Live — live weather may be sunny). Re-send the order message. |
| /user transcript not mirroring on Director | Same-browser check; reload the /backend tab; the bus reconnects on load. |
| Everything frozen | Switch Director's mirror to **"Messenger (thật)"** and run the order from your phone on the real Page. |

## The three buttons — cheat line

- **Gửi tin chủ động (nudge)** = "the AI texts *you* first" — press once, only after setting clock to Tuần sau.
- **Khách quay lại, chat mới** = "same customer, new day" — your reset-between-beats button; keeps memory, clears cart. When in doubt, press this.
- **Kịch bản: Pepsi hết hàng** = stage prop for the recovery beat — ON before, **OFF after**, every time.
