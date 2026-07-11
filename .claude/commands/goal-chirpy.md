---
description: "The Chirpy handoff: '.chirpy' in Messenger mints a magic link to /voice with the SAME identity, and the voice order's receipt lands back in the chat"
---

You are building the **flagship demo feature** of `kfc-conversational-ordering/`: a Messenger user
types `.chirpy`, instantly receives a unique link, taps it, and `/voice` opens **already knowing
who they are** — same cart, taste memory, and loyalty as the chat. When their voice order places,
the receipt is sent back into the Messenger thread. One identity, two modalities, zero re-entry.
All work happens inside `kfc-conversational-ordering/`.

## Context (read these files first)

- `lib/channel.ts` — normalizes inbound Messenger text and forwards to the agent. It ALREADY has
  a deterministic pre-LLM intercept (the "dừng" opt-out) — your trigger uses the same pattern and
  the same placement (before the LLM, zero latency/cost). It also owns `sendChannelReply` (Messenger
  Graph API when `MESSENGER_TOKEN` is set; otherwise the reply is returned in the webhook response
  for simulation — that's how you'll test locally).
- `lib/convo-store.ts` — conversations keyed `messenger:<senderId>`, stable customer id
  `msgr_<senderId>`. That customer id is what all taste memory/loyalty accrues to.
- `app/voice/page.tsx` — currently hardcodes `customerId = "voice_guest"` (~line 26). That
  hardcode is the only wall between chat and voice.
- Existing store pattern to copy: look at `lib/reengage-store.ts` or `lib/convo-store.ts` —
  Supabase table when env is present, in-memory `Map` fallback otherwise. Follow it exactly.
- `app/api/profile/route.ts` + `lib/profile.ts` — `TasteProfile` with `usual` (used for the
  personalized greeting).
- `lib/faq-cache.ts` exports `normalize()` (diacritic-stripping) — use it for trigger matching.

## Task

1. **`lib/voice-links.ts`** — new store, following the project's store pattern:
   - `mintVoiceLink(customerId, conversationKey)` → `{ token, expiresAt }`. Token: 24+ hex chars
     from `crypto.randomBytes`. TTL **10 minutes**. Fields: `token`, `customerId`,
     `conversationKey`, `expiresAt`, `usedAt`.
   - `redeemVoiceLink(token)` → validates (exists, not expired, `usedAt` null), stamps `usedAt`,
     returns `{ customerId, conversationKey }` or a typed failure reason. **Single-use.**
   - Supabase table `kfc_voice_links` (add the SQL to the project's schema location in `db/`;
     apply it if a Supabase connection is available, otherwise note it in the commit — the
     in-memory fallback fully works for local demo).
2. **Messenger trigger** in `lib/channel.ts`, placed with the "dừng" intercept (BEFORE the LLM):
   - Match on `normalize(text)`: exact `chirpy` / `.chirpy`, or contains `noi chuyen voi chirpy`
     / `goi dien` / `voice`. Keep it conservative — false positives hijack real orders.
   - On match: mint a link for this conversation's `msgr_<senderId>` + conversation key; reply
     (via the existing reply path) with:
     *"Bấm vào đây để nói chuyện với em nhé — em nhớ đơn của mình rồi 🐔 <link>"*.
   - Base URL: `NEXT_PUBLIC_APP_URL` env → else `https://${process.env.VERCEL_URL}` → else
     `http://localhost:3000`. Never run the agent for this message.
3. **Redemption route `app/api/voice-link/route.ts`** (GET `?t=`):
   - Valid → `{ ok: true, customerId, conversationKey, greeting }` where `greeting` is built
     server-side from the taste profile: if `usual` exists, e.g. *"Chào mừng quay lại! Phần như
     mọi khi của mình — <item name> — em nhớ rồi, nói 'như mọi khi' là em lên đơn liền nha."*;
     else a warm generic greeting. (Resolve the item name via the catalog helpers in `lib/menu.ts`.)
   - Invalid/expired/used → `{ ok: false, reason }` with 410. Never leak the customerId on failure.
4. **`/voice` accepts the token** in `app/voice/page.tsx`:
   - Read `t` from the URL (`useSearchParams` — mind Next's requirement to wrap in `<Suspense>`,
     or read `window.location.search` in an effect, whichever fits the existing structure).
   - If present: call `/api/voice-link?t=` on mount. Success → replace the `"voice_guest"`
     customerId with the real one (make `customerId` state settable), set + SPEAK the returned
     greeting, and stash `conversationKey` in state. Failure → show *"Link đã hết hạn — nhắn
     'chirpy' trong Messenger để lấy link mới nhé"* and continue as guest.
   - Pass `conversationKey` through to the agent request body (add `channelEcho: conversationKey`
     alongside `customerId` in `prepareSendMessagesRequest`).
5. **Receipt back to chat.** In the `/api/agent` route (`app/api/agent/route.ts`): when a request
   carries `channelEcho` AND during this turn the order transitions to `placed` (inspect how the
   route/agent exposes the final order state — reuse whatever the existing code uses to know an
   order placed, e.g. the `place_order` tool result), fire-and-forget `sendChannelReply` to that
   conversation with a compact receipt: order number, line items, total, *"Đặt qua giọng nói với
   Chirpy 🎙️"*. Guard: echo at most once per placed order; failures logged, never break the reply.
6. **Security notes to honor:** token single-use + 10-min TTL + unguessable; `channelEcho` must
   be validated server-side (only accept it when it matches the conversationKey stored on the
   redeemed token — simplest: have `/api/voice-link` return a short-lived signed value, or
   re-verify token→conversation mapping server-side on the agent request). Do not let an
   arbitrary client body spam arbitrary Messenger threads.

## Acceptance checklist

- [ ] Local webhook simulation (no Messenger token → reply comes back in the HTTP response):
      `curl -X POST http://localhost:3000/api/webhook/messenger -H "Content-Type: application/json" -d '{"entry":[{"messaging":[{"sender":{"id":"demo_linh"},"message":{"text":".chirpy"}}]}]}'`
      → response contains a `/voice?t=...` link. The agent/LLM was NOT invoked (verify via logs).
- [ ] Opening that link: `/voice` greets with the personalized line (seed `msgr_demo_linh` with an
      order first so `usual` exists) and speaks it.
- [ ] The same link a second time → the expired-link message, page still usable as guest.
- [ ] Place an order through `/voice` after redeeming → server logs a `sendChannelReply` receipt
      attempt for `messenger:demo_linh` (delivery needs the real token; the attempt + payload in
      logs is the local proof).
- [ ] An ordinary order message ("cho mình 1 zinger") does NOT trigger the link.
- [ ] `npx tsc --noEmit`, `npm test`, `npm run build` pass.

## Verify, then commit

Walk the curl → link → voice → receipt path end-to-end locally. Commit:
`feat(chirpy): magic-link chat→voice handoff with shared identity + receipt echo to Messenger`.
