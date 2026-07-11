// SMS delivery for OTP. Twilio REST (no SDK — one fetch). Env-gated:
// TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM. When unset, sendSms
// reports {sent:false, reason:"not_configured"} and the OTP layer falls back to
// demo delivery (dev code in chat behind OTP_EXPOSE_DEV_CODE). Never throws.

export function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM,
  );
}

/** Normalize a Vietnamese phone number to E.164 (+84…). */
export function normalizeVnPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("84")) return `+${digits}`;
  if (digits.startsWith("0")) return `+84${digits.slice(1)}`;
  if (raw.trim().startsWith("+")) return `+${digits}`;
  return `+${digits}`;
}

const SEND_TIMEOUT_MS = 10_000;

export async function sendSms(phone: string, body: string): Promise<{ sent: boolean; reason?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) return { sent: false, reason: "not_configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: normalizeVnPhone(phone), From: from, Body: body }).toString(),
      signal: controller.signal,
    });
    if (res.ok) return { sent: true };
    return { sent: false, reason: `twilio_${res.status}` };
  } catch (error) {
    return { sent: false, reason: (error as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
