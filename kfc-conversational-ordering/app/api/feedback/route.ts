import { z } from "zod";
import { getCatalogEntry } from "@/lib/menu";
import { getHistoryStore } from "@/lib/history-store";

const feedbackSchema = z.object({
  customerId: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  catalogId: z.string().min(1),
  action: z.enum(["accepted", "declined"]),
});

export async function POST(req: Request) {
  const parsed = feedbackSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ ok: false, message: "Invalid feedback request." }, { status: 400 });
  }
  if (!getCatalogEntry(parsed.data.catalogId)) {
    return Response.json({ ok: false, message: "Invalid feedback request." }, { status: 400 });
  }

  await getHistoryStore().recordSuggestion({
    customerId: parsed.data.customerId,
    catalogId: parsed.data.catalogId,
    action: parsed.data.action,
    at: new Date().toISOString(),
  });

  return Response.json({ ok: true });
}
