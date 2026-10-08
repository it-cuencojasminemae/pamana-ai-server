'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { containsPoint, validBoundary } = require('../src/services/pamana-journey/pin-area');
const sourceUrl = 'https://portal.georisk.gov.ph/arcgis/rest/services/PSA/Barangay/MapServer/4';

(async () => {
  const url = new URL(sourceUrl + '/query');
  url.searchParams.set('where', "prov_name='Pampanga' AND UPPER(city_name) LIKE '%SAN FERNANDO%'");
  url.searchParams.set('outFields', 'city_name,prov_name,brgy_name,city_code,psgc_10d');
  url.searchParams.set('outSR', '4326'); url.searchParams.set('f', 'geojson'); url.searchParams.set('returnGeometry', 'true');
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('BOUNDARY_SOURCE_UNAVAILABLE');
  const catalog = await response.json();
  const features = catalog.features;
  if (!Array.isArray(features) || features.length !== 35 || features.some(f => f.properties.prov_name !== 'Pampanga' || !/San Fernando/i.test(f.properties.city_name) || !validBoundary(f.geometry))) throw new Error('BOUNDARY_IDENTITY_OR_COUNT_INVALID');
  const codes = [...new Set(features.map(f => f.properties.city_code))];
  if (codes.length !== 1) throw new Error('AMBIGUOUS_CITY_IDENTITY');
  // Preserve the full source rings, including holes. Multipolygon membership
  // tests the constituent barangays without inventing a bounding rectangle.
  const boundary = { type: 'Feature', properties: { city_name: features[0].properties.city_name, prov_name: 'Pampanga', city_code: codes[0], barangayCount: features.length },
    geometry: { type: 'MultiPolygon', coordinates: features.flatMap(f => f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) } };
  const referencePoints = [
    { name: 'City Proper return loading', lat: 15.029006842709281, lng: 120.69283148014446, expectedInside: true },
    { name: 'Victory Liner reference', lat: 15.039373960293801, lng: 120.68311389238005, expectedInside: true },
    { name: 'McDonalds reference', lat: 15.04124663498475, lng: 120.68364202268374, expectedInside: true },
    { name: 'San Juan terminal outside the city', lat: 15.117429648993976, lng: 120.7024058913807, expectedInside: false },
  ];
  if (!referencePoints.every(point => containsPoint(boundary.geometry, point) === point.expectedInside)) throw new Error('BOUNDARY_REFERENCE_MISMATCH');
  const verification = { status: 'VERIFIED_INDICATIVE', cityCode: codes[0], barangayCount: features.length,
    geometrySha256: createHash('sha256').update(JSON.stringify(boundary.geometry)).digest('hex'), source: 'PSA via DOST GeoRisk Philippines', sourceUrl,
    verifiedAt: new Date().toISOString(), referencePoints,
    notice: 'Indicative June 2016 barangay boundaries based on PSA 2015 census; geographic pin authorization only, not a legal survey or transport verification.' };
  if (process.argv.includes('--apply')) {
    const directory = path.join(__dirname, '../src/services/pamana-journey/data');
    fs.writeFileSync(path.join(directory, 'san-fernando-psa-boundary.geojson'), JSON.stringify(boundary) + '\n');
    fs.writeFileSync(path.join(directory, 'san-fernando-boundary-verification.json'), JSON.stringify(verification, null, 2) + '\n');
  }
  console.log(JSON.stringify({ applied: process.argv.includes('--apply'), city: boundary.properties, verification }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
