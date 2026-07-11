# What we've built — in plain language

Everything the KFC conversational-ordering product does today. Three parts: the customer's
experience, the smart stuff happening behind the scenes, and the control room for staff.

## What the customer experiences

**Order KFC by just chatting.** You message KFC on Messenger like you'd message a friend — "cho
mình 1 combo gà rán và 1 Pepsi" — and the assistant builds your order, shows prices, and confirms
it. No app download, no website. It works in Vietnamese, including slangy teen-speak and typing
without accent marks.

**It never makes up prices.** Every item and price comes from the real KFC Vietnam menu (we pulled
the official one — 37k fried chicken, 269k Party Bucket). The AI physically cannot invent a price
or a fake item; if it's not on the menu, it can't go in the cart.

**Vouchers and points without leaving the chat.** Say "áp mã KFC20" and the discount applies, and
the total updates. You earn real loyalty points on every order (1 point per 1,000₫) and can spend
them in the same conversation.

**Secure confirmation.** Before an order is placed, you get a one-time code by SMS (like a bank
does) so nobody can order on your behalf. It's rate-limited so it can't be abused.

**"Where's my order?"** After ordering, you can just ask and it tells you — placed, being prepared,
ready. The kitchen side actually moves the order through those stages.

**A talking chicken.** `/voice` is a virtual KFC ambassador — an animated chicken you *speak* to.
It listens in Vietnamese, talks back with a moving mouth, shows your order on screen, and does a
happy dance when your order is placed. Same brain as the chat, different face.

**It saves your order and money-saving tricks:**

- If you itemize things that are cheaper as a combo, it tells you — "these 9 pieces are 115k
  cheaper as the Party Bucket" — with real math.
- If something's out of stock, it doesn't dead-end; it offers the closest substitute and keeps your
  order alive.
- If you're stuck or upset, it hands you to a human with a summary of everything so far, so you
  don't repeat yourself.

## The smart stuff behind the scenes

**It remembers you.** Each Messenger user has a persistent identity. Your cart survives if you get
distracted mid-order, and over time it learns your taste — your usual order, whether you like
spicy, what sides you tend to add, and (importantly) what you've *declined*, so it stops suggesting
things you don't want.

**Suggestions that get better with data.** We proved it with numbers: recommendations personalized
to your history are about 7–9 percentage points more likely to be right than generic bestseller
suggestions.

**It knows the weather.** It pulls live Ho Chi Minh City weather — on a rainy evening it might
suggest hot soup; on a hot day, a cold drink. Real weather, not faked.

**It knows *when* to talk to you.** Two layers:

- *Which day:* if you usually order every 10 days and it's been 14, you're "lapsed" and worth a
  gentle nudge. Tested on simulated customers: 95% of nudges went to genuinely lapsed people, and
  no on-schedule customer got spammed.
- *What time:* it learns your personal ordering hour (you're an 11:30-lunch person) and would
  message ~12 minutes before it. Its guess gets sharper with every order — down to ~3 minutes off
  after 8 orders, versus hours off for a generic blast.
- It's polite about it: you can say "dừng" (stop) and it stops instantly, it mutes itself if you
  ignore it twice, it never messages at night, and it waits at least a week between nudges.

**Instant answers for common questions.** "What time do you open?" doesn't need to wake the
expensive AI — a curated answer library replies in a millisecond. It's built to *never* answer
wrong: anything involving your order, prices, or live data always goes to the real AI.

## The control room (for KFC staff)

A back-office dashboard with modules like a mini ERP: live order queue (advance orders through
preparing → ready), customer profiles with their taste history and points, voucher creation on/off
switches, stock toggles (mark items out of stock and watch the bot adapt), promo broadcasts to
customers, the re-engagement predictor with its reasoning shown, and a live view of every decision
the AI makes during a demo.

## Honesty footnotes

Payment itself is out of scope (we stop at the confirmed order — that's the next integration),
customer histories used for the learning proofs are synthetic (we don't have KFC's private data),
and Zalo was cut — it's Messenger only, which is live and working end-to-end with a real Facebook
page.

---

**The one-sentence version:** *people can order real KFC, with real prices, vouchers, and points,
by chatting or talking — and the system remembers them, learns their taste, and knows the right
moment to bring them back.*
