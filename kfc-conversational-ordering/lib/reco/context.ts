export type WeatherSignal = "clear" | "rainy" | "hot";
export type Daypart = "breakfast" | "lunch" | "afternoon" | "evening";

export type KioskContext = {
  storeId: string;
  hour: number;
  dayOfWeek: number;
  weather: WeatherSignal;
  promo: "none" | "family_share" | "snack_hour";
};

export type OrderContext = Partial<KioskContext> & Pick<KioskContext, "hour" | "weather">;

export type ContextProfile = KioskContext & {
  daypart: Daypart;
  isWeekend: boolean;
  label: string;
};

export function getDaypart(hour: number): Daypart {
  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 14) return "lunch";
  if (hour >= 14 && hour < 18) return "afternoon";
  return "evening";
}

export function normalizeContext(input: Partial<KioskContext> = {}): ContextProfile {
  const hour = clampHour(input.hour ?? 12);
  const dayOfWeek = clampDay(input.dayOfWeek ?? 5);
  const weather = input.weather === "rainy" || input.weather === "hot" ? input.weather : "clear";
  const promo = input.promo === "family_share" || input.promo === "snack_hour" ? input.promo : "none";
  const daypart = getDaypart(hour);

  return {
    storeId: input.storeId?.trim() || "HCM-D1-KIOSK-07",
    hour,
    dayOfWeek,
    weather,
    promo,
    daypart,
    isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
    label: `${formatHour(hour)} ${daypart} / ${weather}${promo === "none" ? "" : ` / ${promo.replace("_", " ")}`}`,
  };
}

export function formatHour(hour: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelveHour = hour % 12 || 12;
  return `${twelveHour}:00 ${suffix}`;
}

export function describeContext(context: Partial<KioskContext>) {
  return normalizeContext(context).label;
}

function clampHour(hour: number) {
  if (!Number.isFinite(hour)) return 12;
  return Math.min(23, Math.max(0, Math.round(hour)));
}

function clampDay(day: number) {
  if (!Number.isFinite(day)) return 5;
  return Math.min(6, Math.max(0, Math.round(day)));
}
