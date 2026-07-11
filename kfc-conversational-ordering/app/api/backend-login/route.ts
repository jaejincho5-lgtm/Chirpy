import { NextResponse } from "next/server";
import { OPS_AUTH_COOKIE, opsAuthToken, opsPassword } from "@/lib/ops-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Exchanges the /backend password for the ops cookie proxy.ts checks. A flat
// 350ms delay on every attempt keeps brute-forcing impractical without a
// rate-limit table; the cookie lives 12h so one login covers the demo day.

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
  await new Promise((resolve) => setTimeout(resolve, 350));

  if (typeof body?.password !== "string" || body.password !== opsPassword()) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(OPS_AUTH_COOKIE, await opsAuthToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
