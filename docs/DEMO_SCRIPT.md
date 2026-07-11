# Chirpy Demo Script — Round 1 (60s) + Finals extension (90s)

Storyline in one line: **a regular customer gets lunch in 3 sentences — the agent remembers her, reads the weather, saves her money, and proves every decision live.**

---

## Pre-flight checklist (do this 30+ min before your slot)

- [ ] **Push + redeploy.** The "cho 1 combo 1" fast-path fix (`04755e3`) is committed but NOT pushed — prod still has the bug until you deploy.
- [ ] **Voice status.** ELEVENLABS_API_KEY was not reaching prod (TTS 503). Either fix the env var in Vercel and redeploy, or accept the browser-voice fallback — the script below keeps voice as **output only** (chicken speaks, you never rely on the mic in a noisy room).
- [ ] **Seed Linh.** Place 1–2 orders as `linh` on /user so "như mọi khi" and the taste profile card have data. Do this fresh on the demo deployment.
- [ ] **Send one real Messenger message** to the Page so Director's "Messenger (thật)" mirror has a live conversation as backup evidence.
- [ ] **Open two windows, same browser:** left = `/user`, right = `/backend` → Director tab (password). They sync over BroadcastChannel — same browser, same origin, or the mirror stays empty.
- [ ] **Director presets:** Khách hàng = **Linh, khách quen** · Thời tiết = **Mưa** · Thời điểm = **Trưa**. Toggle these BEFORE the demo starts, not during.
- [ ] Hard-reload both tabs. Close everything else. Notifications off. Screen zoom ~125% so the tool trace is readable from the judges' seats.
- [ ] Run the 60s script twice, out loud, with a timer.

**Screen layout:** `/user` (the customer) on the left ~60%, Director on the right ~40%. Judges must see the tool trace the whole time — that's your Agentic AI score sitting on screen.

---

## The 60-second demo (Round 1)

Speak the **bold narration**; type the `monospace` Vietnamese lines into /user. Never wait in silence — while the agent streams, you point at the Director trace.

| Time | You do | You say (narration) |
|---:|---|---|
| 0–10s | Gesture at the split screen. Director already shows: rainy, lunchtime, Linh. | **"This is Linh — a real KFC regular. Rainy lunchtime in Ho Chi Minh City. Watch the left screen as the customer, and the right screen — every decision the agent actually makes, live."** |
| 10–20s | Type: `như mọi khi` | **"Three words: 'the usual.' No app, no menu, no scrolling."** → cart fills with her usual order. Point right: **"There — it recalled her taste profile and repriced from the real KFC catalog. It cannot invent a price."** |
| 20–35s | Agent suggests hot seaweed soup. Point at the `suggest_addons` line in the trace. | **"It's raining, so it suggests hot soup — that's live weather steering a tool decision, not a canned upsell. And it already applied her best voucher automatically. She never has to know the code exists."** |
| 35–45s | Type: `ok chốt đơn giao như cũ nha` | **"She confirms in one sentence. She's a trusted regular going to her saved address — so no OTP friction. Checkout is these two messages."** |
| 45–55s | Order confirmed → receipt card renders. Point at receipt, then the profile card on Director. | **"Order placed. And the agent got smarter: her profile just updated — usual order, spice preference, what she's declined, so it never nags her twice."** |
| 55–60s | Point at the trace one last time. | **"Every line on the right is a real tool call — menu, prices, voucher math. Total AI cost for this whole conversation: about the price of one French fry. That's an agent a fast-food chain can actually afford to run."** |

**End frozen on the receipt + trace.** Do not click anything else. Hand back to the closer.

### Timing discipline
- If the model is slow on a turn, DO NOT retype or apologize — narrate the trace ("you can see it searching the menu right now, that's a real call").
- If you're at 50s and the confirm hasn't landed, skip the profile beat and go straight to the cost line.

---

## Finals extension (+30s, only if you reach Top 5 / Top 1)

Run the 60s script, then:

| Time | You do | You say |
|---:|---|---|
| +0–15s | On Director, click **"Kịch bản: Pepsi hết hàng"**, then in /user type: `thêm 1 pepsi` | **"Now the store runs out of Pepsi mid-conversation. Watch — it doesn't dead-end, it recovers: checks stock, offers the closest substitute at the real price."** |
| +15–30s | Messenger phone in hand OR Director's "Messenger (thật)" mirror. Show the `.chirpy` magic link → the talking chicken that already knows her. | **"And the same identity travels: from Messenger chat, one magic link opens our voice ambassador — a talking chicken that already knows her name, her points, her usual. Order by voice at a red light; the receipt lands back in her Messenger."** |

Voice is a **show, don't risk** beat: let the chicken SPEAK (output), don't demo the mic (input) in a loud room. Tap the chicken to make it repeat if the room missed it.

---

## Fallback ladder (rehearse these, in order)

1. **Voice TTS 503 / silent chicken** → tap the chicken (repeat), turn on "Phụ đề" subtitles, keep talking: "premium voice fell back to the browser voice — by design, it never goes silent."
2. **/user tab dies** → Director's "Messenger (thật)" mirror + your phone: run the same order over real Messenger. It's arguably MORE impressive ("this is the live Facebook Page").
3. **Everything dies** → narrate the storyline from memory over the seeded Messenger conversation screenshots. Never debug on stage.

---

## One-liners to have loaded for Q&A (15–25s each)

- **"Why an agent, not a chatbot?"** — It plans and acts: 17 tools — search menu, reprice cart, optimize combos, apply vouchers, check stock, trigger OTP, hand off to a human. The chat is just the interface; the tool trace you saw is the product.
- **"What's real?"** — Real KFC Vietnam menu and prices, real Messenger Page, real weather API, real SMS OTP, real loyalty math. Payment is the next integration — we stop at the confirmed order, and we say so.
- **"Hallucinated prices?"** — Structurally impossible: every price comes from a catalog tool call; the model can't sell what search_menu doesn't return. 21 test suites guard the money math.
- **"Unit economics?"** — Common questions are answered from a never-wrong local cache in ~1ms with zero tokens; the LLM only wakes for real ordering. You saw the per-session cost on screen.
- **"Why can't ChatGPT do this?"** — It has no cart, no OTP, no stock, no loyalty ledger, no human takeover, and no memory of Linh. We built the operational half a restaurant actually needs.
