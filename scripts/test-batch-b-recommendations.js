'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { recommendJourneys } = require('../src/services/pamana-journey/journey-recommendations');
const payloads = { results: require('./fixtures/passenger-journeys').passengerCases() };
const regular = payloads.results.find(r => r.category === 'REGULAR' && r.response.journeys.length === 2).response.journeys;

test('categories use approved fare expectations and preserve planner order and objects', () => {
  const before = JSON.stringify(regular), ranks = recommendJourneys(regular);
  assert.equal(ranks.recommended.journeyId, regular[0].id);
  assert.equal(ranks.cheapest.journeyId, regular[0].id);
  assert.equal(ranks.fewestTransfers.journeyId, regular[0].id);
  assert.deepEqual(ranks.fastest, { journeyId: null, unavailableReason: 'TIME_DATA_UNAVAILABLE' });
  assert.equal(JSON.stringify(regular), before);
});
test('cheapest is calculated by backend payable total; discounted context is preserved', () => {
  const student = payloads.results.find(r => r.category === 'STUDENT' && r.response.journeys.length === 2).response.journeys;
  assert.equal(recommendJourneys(student).cheapest.journeyId, student[0].id);
  const reversedCosts = structuredClone(regular); reversedCosts[0].fareSummary.totalFare = 150;
  assert.equal(recommendJourneys(reversedCosts).cheapest.journeyId, reversedCosts[1].id);
  assert.equal(recommendJourneys(reversedCosts).recommended.journeyId, reversedCosts[0].id);
});
test('unknown fares or mixed currencies cannot claim cheapest', () => {
  for (const change of [j => { j.fareSummary.totalStatus = 'PARTIAL'; }, j => { j.fareSummary.totalFare = null; }, j => { j.fareSummary.currency = 'USD'; }]) {
    const options = structuredClone(regular); change(options[1]);
    assert.deepEqual(recommendJourneys(options).cheapest, { journeyId: null, unavailableReason: 'FARE_DATA_UNAVAILABLE' });
  }
});
test('only complete total travel times permit fastest, never known walking time', () => {
  assert.equal(recommendJourneys(regular).fastest.journeyId, null);
  const options = structuredClone(regular); options[0].durationSummary.totalJourneyDurationSeconds = 1000; options[1].durationSummary.totalJourneyDurationSeconds = 900;
  assert.equal(recommendJourneys(options).fastest.journeyId, options[1].id);
  options[1].durationSummary.totalJourneyDurationSeconds = null;
  assert.equal(recommendJourneys(options).fastest.journeyId, null);
});
test('fewest transfers is based on returned transfer count, with stable ties', () => {
  const options = structuredClone(regular).reverse();
  assert.equal(recommendJourneys(options).fewestTransfers.journeyId, regular[0].id);
  options[0].transferCount = 0;
  assert.equal(recommendJourneys(options).fewestTransfers.journeyId, options[0].id);
});
test('empty, simulated, ineligible or structurally incomplete options are not selected', () => {
  for (const mutate of [j => { j.dataQuality.planningEligible = false; }, j => { j.dataQuality.dataModes = ['SIMULATED']; }, j => { j.legs.find(l => l.type === 'TRANSIT').boardAt = null; }]) {
    const options = structuredClone(regular); mutate(options[0]);
    assert.equal(recommendJourneys(options).recommended.journeyId, options[1].id);
  }
  for (const entry of Object.values(recommendJourneys([]))) assert.deepEqual(entry, { journeyId: null, unavailableReason: 'NO_VALID_JOURNEY' });
});
