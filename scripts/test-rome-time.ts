import assert from "node:assert/strict";
import {
  addCalendarDays,
  dateKey,
  formatBriefingTime,
  isBriefingDue,
  parseBriefingTime,
  isReminderDue,
  tzParts,
  zonedLocalDate,
} from "../apps/web/utils/rome-time";

const start = new Date("2026-08-29T12:00:00.000Z");
assert.equal(isReminderDue(start, new Date("2026-08-29T11:44:59.000Z")), false);
assert.equal(isReminderDue(start, new Date("2026-08-29T11:45:00.000Z")), true);
assert.equal(isReminderDue(start, new Date("2026-08-29T11:59:00.000Z")), true);
assert.equal(isReminderDue(start, start), false);

const evening = zonedLocalDate({ year: 2026, month: 8, day: 29 }, 19, 59);
const twenty = zonedLocalDate({ year: 2026, month: 8, day: 29 }, 20, 0);
assert.equal(isBriefingDue(evening), false);
assert.equal(isBriefingDue(twenty), true);
const seventeenThirty = zonedLocalDate({ year: 2026, month: 8, day: 29 }, 17, 30);
assert.equal(isBriefingDue(zonedLocalDate({ year: 2026, month: 8, day: 29 }, 17, 29), 17 * 60 + 30), false);
assert.equal(isBriefingDue(seventeenThirty, 17 * 60 + 30), true);
assert.equal(formatBriefingTime(17 * 60 + 5), "17:05");
assert.equal(parseBriefingTime("07:45"), 7 * 60 + 45);
assert.equal(parseBriefingTime("24:00"), null);

const today = tzParts(twenty);
assert.equal(dateKey(today), "2026-08-29");
assert.deepEqual(addCalendarDays(today, 1), { year: 2026, month: 8, day: 30 });

console.log("rome-time tests passed");
