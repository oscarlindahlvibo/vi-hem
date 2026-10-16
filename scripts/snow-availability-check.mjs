import fs from "node:fs";
import ts from "typescript";
import assert from "node:assert/strict";
const source = ts.transpileModule(
  fs.readFileSync("src/modules/snow/availability.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const {
  addDays,
  weekStart,
  calendarDay,
  capacitySegments,
  dutyConflict,
  geometryParts,
  parseMinute,
  validateSlots,
} = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
assert.equal(addDays("2025-12-31", 1), "2026-01-01");
assert.equal(weekStart("2026-10-18"), "2026-10-12");
assert.equal(calendarDay(new Date("2026-10-15T23:00:00Z")), "2026-10-16");
assert.equal(parseMinute("24:00"), 1440);
assert.throws(() => parseMinute("24:01"));
assert.throws(() => parseMinute("2:05"));
assert.throws(() => validateSlots([[600, 500]]));
assert.throws(() =>
  validateSlots([
    [0, 600],
    [500, 900],
  ]),
);
const date = "2026-10-16";
const people = ["a", "b", "c", "d"].map((id) => ({ id, name: id }));
const data = {
  people,
  days: [
    { user_id: "b", work_date: date, status: "partial", slots: [[0, 720]] },
    { user_id: "c", work_date: date, status: "partial", slots: [[720, 1440]] },
    { user_id: "d", work_date: date, status: "available", slots: [[0, 1440]] },
  ],
  shifts: [
    {
      id: "jour",
      user_id: "a",
      starts_at: "2026-10-15T22:00:00Z",
      ends_at: "2026-10-16T22:00:00Z",
    },
  ],
  absences: [],
};
let parts = capacitySegments(data, date);
assert.deepEqual(
  parts.map((p) => p.people.length),
  [3, 3],
);
assert.equal(Math.min(...parts.map((p) => p.people.length)), 3);
data.days.push({
  user_id: "a",
  work_date: date,
  status: "available",
  slots: [[0, 1440]],
});
assert.equal(
  capacitySegments(data, date)[0].people.filter((p) => p.id === "a").length,
  1,
);
data.days[0].slots = [[0, 660]];
parts = capacitySegments(data, date);
assert.equal(parts.find((p) => p.start === 660).people.length, 2);
assert.equal(parts.find((p) => p.start === 660).end, 720);
data.days.push({
  user_id: "a",
  work_date: date,
  status: "unavailable",
  slots: [],
});
data.days = data.days.filter(
  (d) => !(d.user_id === "a" && d.status === "available"),
);
assert(dutyConflict(data, date, "a"));
assert(!capacitySegments(data, date)[0].people.some((p) => p.id === "a"));
data.absences = [{ user_id: "d", start_date: date, end_date: date }];
assert(!capacitySegments(data, date)[0].people.some((p) => p.id === "d"));
assert.deepEqual(
  capacitySegments(
    {
      people: [people[0]],
      days: [],
      absences: [],
      shifts: [
        {
          id: "dst",
          user_id: "a",
          starts_at: "2026-10-24T22:00:00Z",
          ends_at: "2026-10-25T23:00:00Z",
        },
      ],
    },
    "2026-10-25",
  ).map((p) => [p.start, p.end, p.people.length]),
  [[0, 1440, 1]],
);
assert.equal(
  capacitySegments({ people, days: [], shifts: [], absences: [] }, date)[0]
    .people.length,
  0,
);
console.log(
  "PASS snow availability: simultaneous coverage/gaps, no jour double-count, unavailable/absence conflicts, Swedish dates/year boundary/DST and interval validation",
);
