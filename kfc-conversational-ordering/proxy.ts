import { NextResponse, type NextRequest } from "next/server";
import { OPS_AUTH_COOKIE, opsAuthToken } from "@/lib/ops-auth";

// Password gate for the operator surface. Everything the customer phone or
// external services touch stays open: /api/agent, /api/tts, /api/menu,
// /api/voice-link, /api/feedback, /api/nudge, /api/followup (Vercel cron) and
// /api/webhook/messenger. Gated: /backend pages + the ops-only APIs below.

const OPS_PAGE = /^\/backend(?!\/login)/;

const OPS_APIS = [
  "/api/console",
  "/api/console-state",
  "/api/stats",
  "/api/orders",
  "/api/vouchers",
  "/api/broadcast",
  "/api/demo",
  "/api/reengage",
  "/api/loyalty",
  "/api/profile",
  "/api/answer-cache",
];

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPage = OPS_PAGE.test(pathname);
  const isApi = OPS_APIS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isPage && !isApi) return NextResponse.next();

  const cookie = req.cookies.get(OPS_AUTH_COOKIE)?.value;
  if (cookie && cookie === (await opsAuthToken())) return NextResponse.next();

  if (isApi) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const login = req.nextUrl.clone();
  login.pathname = "/backend/login";
  login.search = "";
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/backend/:path*",
    "/api/console/:path*",
    "/api/console-state/:path*",
    "/api/stats/:path*",
    "/api/orders/:path*",
    "/api/vouchers/:path*",
    "/api/broadcast/:path*",
    "/api/demo/:path*",
    "/api/reengage/:path*",
    "/api/loyalty/:path*",
    "/api/profile/:path*",
    "/api/answer-cache/:path*",
  ],
};
