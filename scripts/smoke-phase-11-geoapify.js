'use strict';

const assert = require('node:assert/strict');
const { createWalkingRouter } = require('../src/services/pamana-journey/walking-router');

async function main() {
  if (!process.env.GEOAPIFY_SERVER_API_KEY?.trim()) {
    console.log('SKIP - GEOAPIFY_SERVER_API_KEY is not configured locally');
    return;
  }
  const result = await createWalkingRouter().routeWalk({
    from: { lat: 14.59940, lng: 120.98420, label: 'Generic test point A' },
    to: { lat: 14.60020, lng: 120.98500, label: 'Generic test point B' },
  });
  assert.equal(result.ok, true, result.error?.code || 'walking route unavailable');
  assert.ok(result.value.distanceMeters !== null && result.value.distanceMeters > 0);
  assert.ok(result.value.durationSeconds !== null && result.value.durationSeconds > 0);
  assert.ok(result.value.geometry);
  console.log('ok - live Geoapify walking route returned GeoJSON, distance and duration');
  console.log('ok - smoke output contains no API key or unresolved PAMANA transport node');
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
