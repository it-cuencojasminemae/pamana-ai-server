'use strict';

// Hand-authored minimal DTO contracts, never captured account/database records.
// Amounts are explicit expected approved-pilot fares, not recomputed by an AI.
const NAMES = { psu: 'PSU Mexico Front', sm: 'SM City Pampanga Main Gate',
  rob: 'Robinsons Arayat Gate', mexico: 'Mexico Bayan / Sta. Monica' };
function ride(key, from, to, amount, mode = 'PUJ_TRADITIONAL', signboard = 'SM Pampanga') {
  return { type: 'TRANSIT', transportMode: mode, boardAt: { name: NAMES[from] },
    alightAt: { name: NAMES[to] }, signboard,
    route: { id: `fixture-route-${key}`, code: `RCH-FIXTURE-${key}` },
    variant: { id: `fixture-variant-${key}`, code: `RCH-FIXTURE-${key}-OUT` },
    fare: { status: 'KNOWN', currency: 'PHP', payableFare: amount,
      sourceType: mode === 'TRICYCLE' ? 'DEMO_ESTIMATE' : 'SYSTEM_CALCULATED' },
    service: { status: 'UNKNOWN' }, availability: { status: 'UNKNOWN', wait: { status: 'UNKNOWN' } } };
}
function journey(key, legs, total, transfers) {
  return { id: `fixture-journey-${key}`, transferCount: transfers,
    modes: [...new Set(legs.map(leg => leg.transportMode))],
    legs: legs.map((leg, i) => ({ ...leg, sequence: i + 1 })),
    fareSummary: { totalStatus: 'KNOWN', totalFare: total, knownSubtotal: total, currency: 'PHP' },
    durationSummary: { status: 'UNKNOWN', totalJourneyDurationSeconds: null },
    availabilitySummary: { status: 'UNKNOWN' },
    dataQuality: { planningEligible: true, dataModes: ['REAL'] }, warnings: [] };
}
function passengerCases() {
  return ['REGULAR', 'STUDENT'].flatMap(category => {
    const student = category === 'STUDENT';
    const direct = journey(`${category}-direct`, [ride('direct', 'psu', 'sm', student ? 22 : 27)], student ? 22 : 27, 0);
    const transfer = journey(`${category}-transfer`, [ride('tricycle', 'psu', 'mexico', 100, 'TRICYCLE', null),
      ride('onward', 'mexico', 'sm', student ? 11 : 14)], student ? 111 : 114, 1);
    const inbound = journey(`${category}-inbound`, [ride('inbound', 'rob', 'psu', student ? 23 : 28, 'PUJ_TRADITIONAL', 'SAN JUAN')], student ? 23 : 28, 0);
    const onward = journey(`${category}-onward`, [ride('onward', 'mexico', 'sm', student ? 11 : 14)], student ? 11 : 14, 0);
    const tricycle = journey(`${category}-tricycle`, [ride('tricycle', 'psu', 'mexico', 100, 'TRICYCLE', null)], 100, 0);
    return [[direct, transfer], [inbound], [onward], [tricycle]].map(journeys => ({ category, response: { journeys } }));
  });
}
module.exports = { passengerCases };
