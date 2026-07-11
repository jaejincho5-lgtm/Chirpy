// Live world signals for HCMC. Weather auto-derives the recommender's
// clear/rainy/hot signal from Open-Meteo (no API key); the operator override
// from /backend still wins for demo steering. Module-level cache: one fetch per
// ~10 min per warm instance. On failure, fall back to the last good value,
// then to a benign "clear".

import type { WeatherSignal } from "./reco/context";
import { getCalendarNote } from "./vn-calendar";

export type WorldState = {
  weather: WeatherSignal;
  temperatureC: number | null;
  isRaining: boolean;
  calendarNote: string | null;
  source: "live" | "fallback";
  fetchedAt: string;
};

const HCMC = { latitude: 10.762, longitude: 106.66 };
const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

// WMO weather codes that mean precipitation: drizzle 51-57, rain 61-67,
// rain showers 80-82, thunderstorm 95-99.
function isPrecipCode(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99);
}

/** Pure mapping — exported for tests. */
export function weatherFromObservation(weatherCode: number, rainMm: number, tempC: number): WeatherSignal {
  if (isPrecipCode(weatherCode) || rainMm > 0.1) return "rainy";
  if (tempC >= 33) return "hot";
  return "clear";
}

let cache: { state: WorldState; at: number } | null = null;
let inFlight = false;

function currentDate(): Date {
  // HCMC is UTC+7. Shift into VN wall-clock in UTC space, then rebuild a Date
  // whose LOCAL getters return those components — vn-calendar reads local
  // getters, so the naive +7h shift was only right on a UTC host (Vercel) and
  // double-shifted on a UTC+7 dev laptop (11:30 read as 18:30).
  const shifted = new Date(Date.now() + 7 * 3600 * 1000);
  return new Date(
    shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(),
    shifted.getUTCHours(), shifted.getUTCMinutes(), shifted.getUTCSeconds(),
  );
}

// Background refresh — never awaited by a request. Populates the cache so the
// NEXT turn sees live weather; the current turn is never blocked on the network.
function refreshWeather(): void {
  if (inFlight) return;
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return;
  inFlight = true;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${HCMC.latitude}&longitude=${HCMC.longitude}` +
    `&current=temperature_2m,precipitation,rain,weather_code&timezone=Asia%2FHo_Chi_Minh`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  void fetch(url, { signal: controller.signal })
    .then(async (res) => {
      if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
      const json = (await res.json()) as {
        current?: { temperature_2m?: number; precipitation?: number; rain?: number; weather_code?: number };
      };
      const cur = json.current ?? {};
      const tempC = typeof cur.temperature_2m === "number" ? cur.temperature_2m : 30;
      const rainMm = typeof cur.rain === "number" ? cur.rain : (cur.precipitation ?? 0);
      const code = typeof cur.weather_code === "number" ? cur.weather_code : 0;
      cache = {
        state: {
          weather: weatherFromObservation(code, rainMm, tempC),
          temperatureC: Math.round(tempC),
          isRaining: isPrecipCode(code) || rainMm > 0.1,
          calendarNote: null,
          source: "live",
          fetchedAt: new Date().toISOString(),
        },
        at: Date.now(),
      };
    })
    .catch(() => undefined)
    .finally(() => {
      clearTimeout(timer);
      inFlight = false;
    });
}

// Non-blocking: returns the cached (or default) weather instantly and kicks off
// a background refresh when stale. The calendar note is always recomputed (cheap).
export async function getWorldState(): Promise<WorldState> {
  const calendarNote = getCalendarNote(currentDate());
  refreshWeather();
  if (cache) return { ...cache.state, calendarNote };
  return {
    weather: "clear",
    temperatureC: null,
    isRaining: false,
    calendarNote,
    source: "fallback",
    fetchedAt: new Date().toISOString(),
  };
}

/** One compact Vietnamese line describing today's real conditions. */
export function describeWorld(state: WorldState): string {
  const parts: string[] = [];
  const temp = state.temperatureC !== null ? ` ${state.temperatureC}°C` : "";
  if (state.weather === "rainy") parts.push(`Thời tiết TP.HCM: đang mưa${temp}.`);
  else if (state.weather === "hot") parts.push(`Thời tiết TP.HCM: nắng nóng${temp}.`);
  else parts.push(`Thời tiết TP.HCM: khô ráo${temp}.`);
  if (state.calendarNote) parts.push(state.calendarNote);
  return parts.join(" ");
}
