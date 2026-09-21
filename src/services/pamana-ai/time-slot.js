'use strict';

/**
 * Phase 13 - AI Data Foundation: shared time-slot normalization.
 *
 * Produces the same "HH:00-HH:00" one-hour-bucket format already used by
 * passenger-demand-observation.time_slot and by the existing
 * services/pamana-ai/time-slots.js (Phase 13.2, used by the Phase 15 demand
 * service) - so output from this utility is directly comparable to stored
 * demand data. That existing file only takes a bare hour number; this one
 * additionally accepts a Date, a timestamp, or an ISO string, since the AI
 * workstream needs to normalize timestamps coming from several different
 * places (Trip.started_at, PassengerReport.reported_at,
 * VehicleLocation.recorded_at), not just an already-known hour.
 *
 * Deliberately left independent of time-slots.js rather than merged into it:
 * that file backs live Phase 15 demand-prediction code, which is out of
 * scope to touch for this Phase 13 task.
 */

const HOURS_IN_DAY = 24;

const pad = (n) => String(n).padStart(2, '0');

/**
 * @param {number} hour - any integer; wrapped into 0-23 (negatives wrap too).
 * @returns {string} e.g. "06:00-07:00", or "23:00-00:00" for the midnight boundary.
 */
function slotForHour(hour) {
  if (typeof hour !== 'number' || !Number.isFinite(hour)) {
    throw new TypeError(`time-slot: expected a finite number for hour, got ${hour}`);
  }
  const normalizedHour = ((Math.trunc(hour) % HOURS_IN_DAY) + HOURS_IN_DAY) % HOURS_IN_DAY;
  const nextHour = (normalizedHour + 1) % HOURS_IN_DAY;
  return `${pad(normalizedHour)}:00-${pad(nextHour)}:00`;
}

function toDate(input) {
  if (input instanceof Date) return input;
  if (typeof input === 'number') return new Date(input);
  if (typeof input === 'string') {
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) {
      throw new TypeError(`time-slot: could not parse "${input}" as a date/time.`);
    }
    return parsed;
  }
  throw new TypeError('time-slot: expected a Date, timestamp (ms), ISO string, or 0-23 hour number.');
}

/**
 * Normalizes a Date, timestamp (ms), ISO string, or bare 0-23 hour into a
 * fixed hourly time slot, in the server's local time zone.
 *
 * A plain integer 0-23 is treated as "hour of day" rather than a millisecond
 * timestamp - a real Unix-ms timestamp that small would be within seconds of
 * 1970-01-01, never a legitimate PAMANA input, so the ambiguity is safe to
 * resolve this way. Anything else numeric is treated as milliseconds.
 *
 * @param {Date|number|string} input
 * @returns {string}
 */
function timeSlotFor(input) {
  if (typeof input === 'number' && Number.isInteger(input) && input >= 0 && input <= 23) {
    return slotForHour(input);
  }
  return slotForHour(toDate(input).getHours());
}

module.exports = { timeSlotFor, slotForHour };
