const oos = new Set(
  (process.env.OOS_DEMO_ITEMS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

export function isOutOfStock(catalogId: string): boolean {
  return oos.has(catalogId);
}

export function setOutOfStock(ids: string[]): void {
  oos.clear();
  for (const id of ids) oos.add(id);
}

export function clearOutOfStock(): void {
  oos.clear();
}

// Channel-path weather OVERRIDE (world knowledge for Messenger, where there is
// no /user control panel). Set from /backend via /api/demo; read by
// lib/channel.ts. An operator override wins over live Open-Meteo weather but
// expires after an hour so a forgotten demo toggle doesn't distort real
// traffic indefinitely. In-memory like OOS — fine on a warm demo instance.
import type { WeatherSignal } from "./reco/context";

const OVERRIDE_TTL_MS = 60 * 60 * 1000; // operator steering lasts 1h
let channelWeatherOverride: { weather: WeatherSignal; setAt: number } | null = null;

/** The active operator override, or null when none/expired (→ use live weather). */
export function getChannelWeatherOverride(): WeatherSignal | null {
  if (!channelWeatherOverride) return null;
  if (Date.now() - channelWeatherOverride.setAt > OVERRIDE_TTL_MS) {
    channelWeatherOverride = null;
    return null;
  }
  return channelWeatherOverride.weather;
}

export function setChannelWeather(weather: WeatherSignal): void {
  channelWeatherOverride = { weather, setAt: Date.now() };
}

export function clearChannelWeather(): void {
  channelWeatherOverride = null;
}
