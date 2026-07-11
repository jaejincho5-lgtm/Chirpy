# KFC Project — What It Does (Plain English)

One line: **you can order real KFC by chatting or talking — and it remembers you, saves you money, and knows when to bring you back.**

---

## 💬 Ordering by chat (Messenger)

- **Order like you're texting a friend.** Message the KFC page "cho mình 1 combo gà rán và 1 Pepsi" and the assistant builds your order, shows prices, and confirms. No app, no website, no account setup.
- **Understands real Vietnamese.** Slang, teen-speak, and typing without accent marks all work.
- **It can't make up prices.** Every item and price comes from the real KFC Vietnam menu. If it's not on the menu, it physically can't be sold to you.
- **Instant answers to common questions.** "What time do you open?", "what's on the menu?", "is there a spicy option?" are answered from a ready-made library (100+ curated Vietnamese Q&As, and still growing) in a millisecond — the expensive AI only wakes up when it's actually needed. There's a guard so this library can *never* give a wrong or made-up price.

## 🐔 Ordering by voice (the talking chicken)

- **A 3D chicken ambassador you talk to.** Open /voice, speak in Vietnamese, and it talks back with a real voice and a moving beak. Hands-free — perfect for a driver at a red light.
- **Tap the chicken to hear it again.** Missed what it said? One tap and it repeats itself. *(new)*
- **Subtitles are optional.** The screen stays clean by default; a "Phụ đề" button turns captions on if you want to read along. If anything goes wrong (no mic permission, etc.), instructions appear automatically so you're never stuck. *(new)*
- **It never goes silent or breaks.** If the premium voice service dies, it falls back to the browser's built-in voice. If your mic doesn't work, you can type instead.
- **It celebrates.** When your order is placed, the chicken does a happy dance and speaks your order number.

## 🔗 One identity across chat and voice

- **The magic link.** Type ".chirpy" in Messenger and you instantly get a link that opens the talking chicken — and it *already knows you*: your name, your usual order, your points. Zero re-typing.
- **The loop closes.** Order by voice, and the receipt lands back in your Messenger chat.

## 🧠 It remembers you

- **Your cart survives.** Get distracted mid-order? It's still there when you come back.
- **It learns your taste.** Your usual order, whether you like spicy, what sides you add — and what you've said no to, so it stops suggesting things you don't want.
- **Say "như mọi khi" ("the usual")** and your regular order is in the cart in one phrase.
- **Your details, once.** Name, phone, and address are asked one time. Every order after that confirms them with a single word.

## 💸 It saves you money (without being asked)

- **Best voucher applied automatically.** If a discount code applies to your order, it's used — you never have to know the code exists.
- **Combo math.** If the items in your cart are cheaper as a combo ("those 9 pieces are 115k cheaper as a Party Bucket"), it tells you, with real math.
- **Real loyalty points.** Earn 1 point per 1,000₫ on every order, spend them in the same conversation.

## 🔒 It's safe

- **A code by SMS before the order goes through** (like your bank does), so nobody can order on your behalf. Rate-limited so it can't be abused.
- **Trusted regulars skip the code** on small orders going to their saved address — checkout in seconds.
- **Stuck or upset? A human takes over.** Staff flip a switch in the dashboard's inbox and reply to you directly; while a human is handling you, the bot steps aside and stops answering. If the operator walks away, it quietly hands control back after a while so you're never left hanging. *(new)*

## 🌦️ It reads the room

- **Real weather.** On a rainy Ho Chi Minh City evening it suggests hot soup; on a scorching day, a cold drink. Live weather, not faked.
- **It knows *when* to message you.** If you usually order every 10 days and it's been 14, you get one gentle nudge — timed to your personal ordering hour (it learns you're an 11:30-lunch person and messages at 11:18). It never messages at night, backs off if you ignore it, and stops instantly if you say "dừng".
- **Left mid-order?** One polite follow-up: "Bạn còn đó không? Your cart's still here."

## 🖥️ The control room (for staff)

A back-office dashboard like a mini ERP:

- **Live order queue** — advance orders through preparing → ready; the customer gets a status message at each step.
- **Customer profiles** — taste history, points, last orders.
- **Voucher switches** — create or pause discount codes live.
- **Stock toggles** — mark an item out of stock and watch the bot instantly offer substitutes instead of dead-ending.
- **Promo broadcasts** — send an offer to recent customers in one click.
- **The director view** — watch every decision the AI makes, live, during a demo. Proof it's real, not smoke.

## ✅ Quality behind the scenes

- **21 automated test suites** guard the money math, the security rules, the "never answer wrong" cache, the reorder logic, and the voice pipeline — all green — plus a 5-part evaluation harness that scores the live AI, the personalization lift, and the message-timing accuracy.
- **Honest limits:** payment itself is the next integration (we stop at the confirmed order — no card is charged and no order reaches a real KFC kitchen); and the learning demos run on simulated customer history since we don't have KFC's private order data.
