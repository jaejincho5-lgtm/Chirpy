import assert from "node:assert/strict";
import { weatherFromObservation } from "../lib/worldstate";
import { getCalendarNote } from "../lib/vn-calendar";

// --- WMO weather-code → signal mapping (pure) --------------------------------

// Rain shower code 80 → rainy regardless of temperature.
assert.equal(weatherFromObservation(80, 0, 34), "rainy", "rain shower code maps to rainy");
// Measured rain over threshold → rainy even with a clear code.
assert.equal(weatherFromObservation(0, 0.5, 30), "rainy", "measured rain maps to rainy");
// Hot, dry, clear code → hot.
assert.equal(weatherFromObservation(0, 0, 35), "hot", "33°C+ dry maps to hot");
// Mild dry → clear.
assert.equal(weatherFromObservation(1, 0, 28), "clear", "mild dry maps to clear");
// Thunderstorm boundary.
assert.equal(weatherFromObservation(95, 0, 31), "rainy", "thunderstorm code maps to rainy");
// Drizzle boundary.
assert.equal(weatherFromObservation(51, 0, 31), "rainy", "drizzle code maps to rainy");

// --- Calendar notes ----------------------------------------------------------

// Known holiday (National Day, Sep 2).
assert.ok(getCalendarNote(new Date(2026, 8, 2, 12)), "Sep 2 returns a holiday note");
assert.match(getCalendarNote(new Date(2026, 8, 2, 12)) ?? "", /Vietnam National Day/, "Sep 2 is Vietnam National Day");

// Payday (the 15th, an ordinary Tuesday).
assert.match(getCalendarNote(new Date(2026, 6, 15, 12)) ?? "", /payday/, "the 15th is payday");

// A plain weekday, non-payday → null.
assert.equal(getCalendarNote(new Date(2026, 6, 7, 12)), null, "a plain Tuesday returns null");

console.log("worldstate + calendar tests passed");
