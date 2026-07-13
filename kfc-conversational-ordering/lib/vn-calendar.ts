// Deterministic Vietnam calendar notes for the agent's world line. No fetch —
// a lookup over fixed-date holidays plus paydays and weekend timing. Kept short
// because each note lands in a single prompt line, not marketing copy.

// Fixed solar-calendar dates (month-day → note). Lunar New Year / Mid-Autumn are
// lunar; the 2026 solar dates are hard-coded for this year's demo.
const FIXED_DATES: Record<string, string> = {
  "01-01": "Today is New Year's Day.",
  "02-14": "Today is Valentine's Day, a popular day for meals for two.",
  "02-16": "Lunar New Year, delivery may be slower than usual.",
  "02-17": "Lunar New Year, happy new year!",
  "02-18": "Lunar New Year, happy new year!",
  "02-19": "Lunar New Year, happy new year!",
  "03-08": "Today is International Women's Day.",
  "04-30": "Today is Vietnam Reunification Day.",
  "05-01": "Today is International Workers' Day.",
  "06-01": "Today is Children's Day, family combos are popular.",
  "09-02": "Today is Vietnam National Day.",
  "09-25": "Today is Mid-Autumn Festival.",
  "10-20": "Today is Vietnamese Women's Day.",
  "12-24": "Christmas Eve, dinner orders are popular tonight.",
  "12-25": "Today is Christmas.",
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * One short English note for today's date, or null. Priority: named holiday
 * > payday > weekend-evening. Accepts an injected Date for testability.
 */
export function getCalendarNote(date: Date): string | null {
  const key = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  if (FIXED_DATES[key]) return FIXED_DATES[key];

  const day = date.getDate();
  if (day === 1 || day === 15) return "Today is payday 🎉";

  const dow = date.getDay(); // 0 Sun … 6 Sat
  const hour = date.getHours();
  if (dow === 5 && hour >= 17) return "Friday evening, the weekend is starting.";
  if (dow === 6 || dow === 0) return "Weekend, a good time for friends and family.";

  return null;
}
