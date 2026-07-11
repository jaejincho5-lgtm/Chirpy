// Independent synthetic POS-log generator for Project COLONEL.
//
// This is the hand-authored "world" used for mining and held-out evaluation.
// It never consumes the recommendation engine.

import { getDaypart, type Daypart, type OrderContext, type WeatherSignal } from "./context";

export type PosLine = { itemId: string; quantity: number; optionIds?: string[] };
export type PosOrder = { id: string; customerId: string; seq: number; context: OrderContext; lines: PosLine[] };

const PRIMARY_POOL: Record<Daypart, string[]> = {
  breakfast: ["zinger-burger", "fried-chicken-rice", "fried-chicken-pasta"],
  lunch: ["zinger-burger", "fried-chicken-2pc", "fried-chicken-rice", "combo-zinger"],
  afternoon: ["tenders-3pc", "zinger-burger", "popcorn-regular", "fried-chicken-1pc"],
  evening: ["fried-chicken-2pc", "combo-family-4", "zinger-burger", "combo-classic"],
};

const ATTACH_BASE: Record<string, Record<string, number>> = {
  "zinger-burger": {
    "fries-regular": 0.42,
    "pepsi-medium": 0.38,
    "seaweed-soup": 0.08,
    "egg-tart": 0.10,
    "coleslaw": 0.07,
    "tenders-3pc": 0.09,
  },
  "fried-chicken-1pc": {
    "fries-regular": 0.35,
    "pepsi-medium": 0.33,
    "seaweed-soup": 0.10,
    "coleslaw": 0.12,
    "egg-tart": 0.08,
  },
  "fried-chicken-2pc": {
    "fries-regular": 0.40,
    "pepsi-medium": 0.36,
    "seaweed-soup": 0.11,
    "coleslaw": 0.10,
    "egg-tart": 0.09,
    "lipton-medium": 0.06,
  },
  "tenders-3pc": {
    "pepsi-medium": 0.44,
    "fries-regular": 0.30,
    "7up-medium": 0.10,
    "egg-tart": 0.07,
  },
  "popcorn-regular": {
    "pepsi-medium": 0.35,
    "fries-regular": 0.32,
    "lipton-medium": 0.14,
    "egg-tart": 0.12,
  },
  "shrimp-burger": {
    "fries-regular": 0.38,
    "pepsi-medium": 0.34,
    coleslaw: 0.11,
  },
  "fried-chicken-rice": {
    "7up-medium": 0.22,
    "pepsi-medium": 0.25,
    "seaweed-soup": 0.14,
    "egg-tart": 0.08,
  },
  "fried-chicken-pasta": {
    "lipton-medium": 0.20,
    "pepsi-medium": 0.24,
    "egg-tart": 0.14,
    "fries-regular": 0.18,
  },
  "combo-classic": {
    "egg-tart": 0.12,
    "seaweed-soup": 0.08,
    "tenders-3pc": 0.07,
  },
  "combo-zinger": {
    "egg-tart": 0.11,
    "seaweed-soup": 0.07,
    "tenders-3pc": 0.08,
  },
  "combo-family-4": {
    "egg-tart": 0.18,
    "lipton-medium": 0.15,
    "seaweed-soup": 0.12,
    coleslaw: 0.10,
  },
  "combo-party-6": {
    "egg-tart": 0.20,
    "lipton-medium": 0.16,
    "7up-medium": 0.14,
  },
};

const ALL_PRIMARIES = Object.keys(ATTACH_BASE);
const ATTACHABLES = Array.from(
  new Set(Object.values(ATTACH_BASE).flatMap((attachments) => Object.keys(attachments))),
).sort();
const DRINK_OR_SIDE = new Set(["fries-regular", "seaweed-soup", "coleslaw", "pepsi-medium", "7up-medium", "lipton-medium"]);
const SPICE_OPTION_ITEMS = new Set(["fried-chicken-1pc", "fried-chicken-2pc", "fried-chicken-rice"]);

export type Persona = {
  customerId: string;
  favoritePrimary: string;
  primaryLoyalty: number;
  attachMultiplier: Record<string, number>;
  spicePreference: "spicy" | "original" | "none";
  rainySoupBoost: number;
};

export function generatePosOrders(orderCount: number, seed: number): PosOrder[] {
  const random = seededRandom(seed);
  const orders: PosOrder[] = [];

  for (let index = 0; index < orderCount; index += 1) {
    const context = drawContext(random, index);
    const daypart = getDaypart(context.hour);
    const primary = pick(PRIMARY_POOL[daypart], random);
    const lines: PosLine[] = [{ itemId: primary, quantity: 1 }];

    for (const [itemId, base] of Object.entries(ATTACH_BASE[primary] ?? {})) {
      if (random() < contextualAttachProbability(primary, itemId, base, context, 0.85)) {
        lines.push({ itemId, quantity: randomQuantity(itemId, random) });
      }
    }

    orders.push({
      id: `POS-WALKIN-${String(index + 1).padStart(6, "0")}`,
      customerId: "walkin",
      seq: 0,
      context,
      lines: mergeLines(lines),
    });
  }

  return orders;
}

export function generatePersona(customerId: string, seed: number): Persona {
  const random = seededRandom((seed + hashString(customerId)) >>> 0);
  const attachMultiplier: Record<string, number> = {};

  for (const itemId of ATTACHABLES) {
    const normalish = Array.from({ length: 12 }, () => random()).reduce((sum, value) => sum + value, 0) - 6;
    attachMultiplier[itemId] = clamp(Math.exp(normalish * 0.7), 0.25, 3.0);
  }

  const spiceRoll = random();
  const spicePreference = spiceRoll < 0.35 ? "spicy" : spiceRoll < 0.75 ? "original" : "none";

  return {
    customerId,
    favoritePrimary: pick(ALL_PRIMARIES, random),
    primaryLoyalty: 0.55 + random() * 0.35,
    attachMultiplier,
    spicePreference,
    rainySoupBoost: 1.0 + random() * 2.0,
  };
}

export function generateCustomerHistory(persona: Persona, orderCount: number, seed: number): PosOrder[] {
  const random = seededRandom((seed + hashString(persona.customerId)) >>> 0);
  const orders: PosOrder[] = [];

  for (let index = 0; index < orderCount; index += 1) {
    const context = drawContext(random, index);
    const daypart = getDaypart(context.hour);
    const primary = random() < persona.primaryLoyalty ? persona.favoritePrimary : pick(PRIMARY_POOL[daypart], random);
    const lines: PosLine[] = [withPersonaOptions({ itemId: primary, quantity: 1 }, persona)];

    for (const [itemId, base] of Object.entries(ATTACH_BASE[primary] ?? {})) {
      const profileMultiplier = persona.attachMultiplier[itemId] ?? 1;
      const rainyBoost = context.weather === "rainy" && itemId === "seaweed-soup" ? persona.rainySoupBoost : 1;
      const probability = contextualAttachProbability(primary, itemId, base, context, 0.9) * profileMultiplier * rainyBoost;
      if (random() < clamp(probability, 0, 0.9)) {
        lines.push(withPersonaOptions({ itemId, quantity: randomQuantity(itemId, random) }, persona));
      }
    }

    orders.push({
      id: `POS-${persona.customerId}-${String(index + 1).padStart(4, "0")}`,
      customerId: persona.customerId,
      seq: index + 1,
      context,
      lines: mergeLines(lines),
    });
  }

  return orders;
}

export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function contextualAttachProbability(
  primary: string,
  itemId: string,
  base: number,
  context: OrderContext,
  max: number,
) {
  const daypart = getDaypart(context.hour);
  let probability = base;

  if (context.weather === "rainy") {
    if (itemId === "seaweed-soup") probability *= 2.2;
    if (itemId === "lipton-medium") probability *= 1.3;
    if (itemId === "pepsi-medium") probability *= 0.75;
    if (itemId === "coleslaw") probability *= 0.6;
  }

  if (daypart === "evening") {
    if (itemId === "egg-tart") probability *= 1.3;
    if (primary.startsWith("combo-")) probability *= 1.15;
  }

  if (daypart === "lunch" && itemId === "7up-medium") probability *= 1.2;

  return clamp(probability, 0, max);
}

function drawContext(random: () => number, index: number): OrderContext {
  const daypart = drawDaypart(random);
  return {
    storeId: "HCM-D1-KIOSK-07",
    hour: sampleHour(daypart, random),
    dayOfWeek: index % 7,
    weather: (random() < 0.3 ? "rainy" : "clear") as WeatherSignal,
    promo: "none",
  };
}

function drawDaypart(random: () => number): Daypart {
  const roll = random();
  if (roll < 0.1) return "breakfast";
  if (roll < 0.45) return "lunch";
  if (roll < 0.65) return "afternoon";
  return "evening";
}

function sampleHour(daypart: Daypart, random: () => number) {
  if (daypart === "breakfast") return 7 + Math.floor(random() * 4);
  if (daypart === "lunch") return 11 + Math.floor(random() * 3);
  if (daypart === "afternoon") return 14 + Math.floor(random() * 4);
  return 18 + Math.floor(random() * 5);
}

function randomQuantity(itemId: string, random: () => number) {
  return DRINK_OR_SIDE.has(itemId) && random() < 0.15 ? 2 : 1;
}

function withPersonaOptions(line: PosLine, persona: Persona): PosLine {
  if (persona.spicePreference !== "spicy" || !SPICE_OPTION_ITEMS.has(line.itemId)) return line;
  return { ...line, optionIds: ["spice-spicy"] };
}

function mergeLines(lines: PosLine[]) {
  const merged = new Map<string, PosLine>();
  for (const line of lines) {
    const key = `${line.itemId}:${(line.optionIds ?? []).join(",")}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += line.quantity;
    else merged.set(key, { ...line, optionIds: line.optionIds ? [...line.optionIds] : undefined });
  }
  return Array.from(merged.values());
}

function pick<T>(items: T[], random: () => number) {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
