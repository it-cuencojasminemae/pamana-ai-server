'use strict';

/**
 * Test cases for src/services/pamana-ai/time-slot.js. No test framework is
 * installed in this project, so this uses Node's built-in `assert` and runs
 * as a plain script, matching how the other scripts/ files run.
 *
 * Usage: node scripts/test-time-slot.js
 */

const assert = require('assert');
const { timeSlotFor, slotForHour } = require('../src/services/pamana-ai/time-slot');

let passed = 0;

function check(description, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${description}`);
}

console.log('slotForHour');
check('start of day (hour 0)', () => {
  assert.strictEqual(slotForHour(0), '00:00-01:00');
});
check('midnight boundary (hour 23 wraps to 00)', () => {
  assert.strictEqual(slotForHour(23), '23:00-00:00');
});
check('ordinary hour', () => {
  assert.strictEqual(slotForHour(6), '06:00-07:00');
});
check('noon', () => {
  assert.strictEqual(slotForHour(12), '12:00-13:00');
});
check('hour 24 wraps to 0', () => {
  assert.strictEqual(slotForHour(24), '00:00-01:00');
});
check('negative hour wraps backward', () => {
  assert.strictEqual(slotForHour(-1), '23:00-00:00');
});
check('non-integer hour is truncated, not rounded', () => {
  assert.strictEqual(slotForHour(6.9), '06:00-07:00');
});
check('non-numeric hour throws', () => {
  assert.throws(() => slotForHour('6'), TypeError);
});

console.log('timeSlotFor');
check('Date object at exact midnight', () => {
  assert.strictEqual(timeSlotFor(new Date(2026, 7, 29, 0, 0, 0)), '00:00-01:00');
});
check('Date object one second before midnight', () => {
  assert.strictEqual(timeSlotFor(new Date(2026, 7, 29, 23, 59, 59)), '23:00-00:00');
});
check('Date object at a slot boundary (exactly on the hour)', () => {
  assert.strictEqual(timeSlotFor(new Date(2026, 7, 29, 7, 0, 0)), '07:00-08:00');
});
check('Date object one minute before a slot boundary', () => {
  assert.strictEqual(timeSlotFor(new Date(2026, 7, 29, 6, 59, 0)), '06:00-07:00');
});
check('bare hour integer (0-23) is treated as hour-of-day', () => {
  assert.strictEqual(timeSlotFor(17), '17:00-18:00');
});
check('bare hour integer 0 is treated as hour-of-day, not epoch', () => {
  assert.strictEqual(timeSlotFor(0), '00:00-01:00');
});
check('ISO string input', () => {
  const d = new Date(2026, 7, 29, 14, 30, 0);
  assert.strictEqual(timeSlotFor(d.toISOString()), slotForHour(d.getHours()));
});
check('millisecond timestamp input (not in the 0-23 hour range)', () => {
  const d = new Date(2026, 7, 29, 9, 0, 0);
  assert.strictEqual(timeSlotFor(d.getTime()), '09:00-10:00');
});
check('unparseable string throws', () => {
  assert.throws(() => timeSlotFor('not-a-date'), TypeError);
});
check('unsupported input type throws', () => {
  assert.throws(() => timeSlotFor({}), TypeError);
});

console.log(`\n${passed} passed`);
