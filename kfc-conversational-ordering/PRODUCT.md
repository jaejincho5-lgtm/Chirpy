# Product

## Register

product

## Users

Three audiences, in priority order:
1. **Hackathon judges** (AABW pitch day 2026-07-12): watching a projector 3–10m away in a
   bright hall, and trying the live Messenger bot on their own phones. They need to *see the
   agent think* and never see it break.
2. **KFC customers** on Messenger and the web demo phone: ordering in English on mobile,
   hungry and impatient.
3. **KFC store operators** using the /backend console: dense information workers advancing
   orders, toggling stock, watching the live agent-ops feed during the demo.

## Product Purpose

Conversational ordering for KFC Vietnam: customers order real menu items at real prices by
chatting or talking. The agent grounds every price in the catalog, applies vouchers and
loyalty, verifies with OTP, and knows when to hand off to a human. The /backend console is
the staff-facing control room; /decisions is an explainability showcase of the suggestion
engine. Success tomorrow = a flawless 60-second demo; success after = a deployable pilot.

## Brand Personality

Warm, quick, trustworthy. Friendly English, never corporate-stiff, at most one emoji per message. The stage
aesthetic is committed KFC red on a warm cream canvas; Messenger blue lives only inside the
phone so the chat reads as the customer's real channel. The operator console is calm and
dense (Odoo-like), not playful.

## Anti-references

- Generic AI-chatbot gloss: gradient text, glassmorphism, purple-blue SaaS gradients.
- Sterile enterprise dashboards with identical KPI card grids.
- Anything that reads "template" — this is a hand-rolled system and should look it.
- Toy demos: fake data vibes, lorem ipsum, untranslated English strings in the customer path.

## Design Principles

1. **Projector-first**: judges read this from meters away — sizes, contrast, and motion must
   land at distance; nothing critical lives in 12px text.
2. **Show the agent thinking**: tool calls, cache hits, and decisions are demo material —
   surface them honestly, never as decoration.
3. **Never dead-end**: every failure (mic, TTS, API, stock) degrades to a working path with a
   English instruction, on screen.
4. **English is the product language**: type and copy must render clearly with stable line
   breaking; technical terms are kept where established.
5. **Demo-safe over ideal**: the night-before bar is "cannot break"; polish is additive, flows
   and interactions stay proven.

## Accessibility & Inclusion

WCAG AA contrast for all text; visible keyboard focus on every interactive element;
`prefers-reduced-motion` respected (already established in globals.css); touch targets
44px+ on customer surfaces; `aria-live` for chat streams; broad Latin font subsets
(IBM Plex Mono swap already made, never reintroduce narrow character coverage).
