import { redeemVoiceLink, signChannelEcho, type RedeemResult } from "@/lib/voice-links";
import { deriveProfile } from "@/lib/profile";
import { getCatalogEntry } from "@/lib/menu";

// Redeem a Chirpy magic link (GET ?t=). Valid → the shared identity + a
// personalized greeting + a signed channelEcho the /voice page passes back so a
// placed order's receipt can echo to Messenger. Invalid/expired/used → 410 with
// only a reason; the customerId is NEVER leaked on failure.
async function buildGreeting(customerId: string): Promise<string> {
  const profile = await deriveProfile(customerId).catch(() => null);
  if (profile?.usual) {
    const item = getCatalogEntry(profile.usual.catalogId);
    const name = item?.name ?? "phần quen";
    return `Chào mừng quay lại! Phần như mọi khi của mình (${name}), em nhớ rồi, nói "như mọi khi" là em lên đơn liền nha.`;
  }
  return "Chào mừng anh/chị đến với Đại sứ Gà KFC! Mình muốn dùng gì hôm nay để em gợi ý nhé? 🐔";
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t");
  if (!token) return Response.json({ ok: false, reason: "not_found" }, { status: 410 });

  const redeemed = await redeemVoiceLink(token).catch(
    (): RedeemResult => ({ ok: false, reason: "not_found" }),
  );
  if (!redeemed.ok) {
    return Response.json({ ok: false, reason: redeemed.reason }, { status: 410 });
  }

  const greeting = await buildGreeting(redeemed.customerId);
  const channelEcho = signChannelEcho(redeemed.conversationKey);
  return Response.json({ ok: true, customerId: redeemed.customerId, channelEcho, greeting });
}
