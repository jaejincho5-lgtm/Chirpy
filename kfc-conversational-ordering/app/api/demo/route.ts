import { z } from "zod";
import { setChannelWeather, clearChannelWeather, setOutOfStock } from "@/lib/demo";
import { getCatalogEntry } from "@/lib/menu";

const demoSchema = z.object({
  outOfStock: z.array(z.string()).max(20).optional(),
  // Channel-path weather: lets /backend steer the Messenger agent's context.
  // "live" clears the override so the agent uses real Open-Meteo weather.
  weather: z.enum(["clear", "rainy", "hot", "live"]).optional(),
});

function enabled() {
  return process.env.DEMO_CONTROLS === "1" || process.env.NODE_ENV !== "production";
}

export async function POST(req: Request) {
  if (!enabled()) return Response.json({ ok: false }, { status: 404 });

  const parsed = demoSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ ok: false, message: "Invalid demo request." }, { status: 400 });
  }

  for (const catalogId of parsed.data.outOfStock ?? []) {
    if (!getCatalogEntry(catalogId)) {
      return Response.json({ ok: false, message: `Unknown catalog item ${catalogId}.` }, { status: 400 });
    }
  }

  if (parsed.data.outOfStock) setOutOfStock(parsed.data.outOfStock);
  if (parsed.data.weather === "live") clearChannelWeather();
  else if (parsed.data.weather) setChannelWeather(parsed.data.weather);
  return Response.json({ ok: true, outOfStock: parsed.data.outOfStock, weather: parsed.data.weather });
}
