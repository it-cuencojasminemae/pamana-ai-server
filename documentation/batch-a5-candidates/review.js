import { Map, Marker, Popup, NavigationControl, ScaleControl, LngLatBounds } from '/vendor/maplibre-gl.mjs';

const $ = id => document.getElementById(id);
const notes = new globalThis.Map();
const routes = new globalThis.Map();
const money = n => `PHP ${n}`;
const number = n => n.toLocaleString('en', { maximumFractionDigits: 2 });
const reviewQuestions = {
  'RCH-SJ-SMROB-OUT': ['Does this follow the road actually used by the San Juan / SM Pampanga jeep?', 'Does the approach reach the correct SM Main Gate drop-off rather than a private or unsuitable mall road?'],
  'RCH-SJ-SMROB-IN': ['Does boarding begin at the correct Robinsons Starmills Arayat Gate loading area?', 'Does this independently generated path follow a realistic San Juan-bound corridor and legal turns?'],
  'PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT': ['Does this follow the road used by Arayat / San Fernando-bound jeepneys from Mexico Bayan?', 'Is the Mexico Bayan departure and SM Main Gate approach suitable for the actual jeep?'],
  'PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT': ['Does this path look reasonable for the PSU → Mexico Bayan tricycle connection?', 'Are its roads and turns appropriate for a tricycle? Driving distance does not change the PHP 100 demo fare.'],
};
let report, map, current, markers = [];
function paragraph(parent, text, className) {
  const p = document.createElement('p'); p.textContent = text; if (className) p.className = className; parent.append(p);
}
function list(parent, texts) {
  parent.replaceChildren(); for (const text of texts) { const li = document.createElement('li'); li.textContent = text; parent.append(li); }
}
function table(parent, rows) {
  const t = document.createElement('table');
  for (const row of rows) { const tr = document.createElement('tr'); for (const value of row) { const td = document.createElement('td'); td.textContent = value; tr.append(td); } t.append(tr); }
  parent.append(t);
}
function lines(geometry) { return geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates; }
function fitCoordinates(coordinates) {
  const bounds = new LngLatBounds(); coordinates.forEach(p => bounds.extend(p)); map.fitBounds(bounds, { padding: 70, maxZoom: 17, duration: 500 });
}
function saveNotes() { if (current) notes.set(current.variant_code, { decision: $('decision').value, notes: $('review-notes').value }); }
function render(candidate) {
  $('summary').replaceChildren(); $('fares').replaceChildren(); $('steps').replaceChildren();
  paragraph($('summary'), `${candidate.origin.name} → ${candidate.destination.name}`);
  paragraph($('summary'), `${candidate.direction} · GEOAPIFY drive / balanced · CANDIDATE ROAD DISTANCE`, 'muted');
  const dl = document.createElement('dl');
  for (const [label, value] of [
    ['Provider road distance', `${number(candidate.candidate_distance_m)} m / ${number(candidate.candidate_distance_km)} km`],
    ['Measured road segments', `${number(candidate.geometry_measured_distance_m)} m`],
    ['Measured − provider', `${number(candidate.measured_minus_provider_distance_m)} m (${number(candidate.measured_difference_percent)}%)`],
    ['Free-flow driving time', `${number(candidate.candidate_duration_s / 60)} min`],
    ['Origin / destination snapping', `${number(candidate.origin_road_snap_gap_m)} / ${number(candidate.destination_road_snap_gap_m)} m`],
    ['Vehicle legs / transfers', candidate.variant_code.includes('TRICYCLE') ? '1 / 0 (connection leg)' : '1 / 0'],
  ]) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; dl.append(dt, dd); }
  $('summary').append(dl);
  const f = candidate.fare_preview;
  if (f.status === 'DEMO_ESTIMATE') paragraph($('fares'), 'PHP 100 · DEMO_ESTIMATE · fixed; distance is not used for fare.', 'warning');
  else {
    paragraph($('fares'), 'CANDIDATE_FARE_PREVIEW', 'tag');
    table($('fares'), [['Policy', 'Raw', 'Regular', '20% discounted'], ...['PUJ_TRADITIONAL', 'PUJ_MODERN'].map(mode => [
      mode === 'PUJ_TRADITIONAL' ? 'Traditional' : 'Modern', f[mode].raw_calculation_php.toFixed(5), money(f[mode].regular_php), money(f[mode].discounted_php),
    ])]);
    paragraph($('fares'), 'Regular = Math.round(raw). Discounted = Math.round(raw × 0.8). Preview uses provider road distance, not endpoint separation.', 'muted');
  }
  list($('questions'), [...reviewQuestions[candidate.variant_code],
    'Check for shortcuts, private roads, unsuitable access lanes or roads the vehicle would not normally use.',
    'Are precise, evidenced intermediate road waypoints needed to follow the actual corridor?']);
  list($('warnings'), candidate.warnings);
  candidate.road_steps.forEach((step, i) => {
    const button = document.createElement('button'); button.textContent = `${i + 1}. ${step.name || 'Unnamed road'} · ${step.road_class || 'class unknown'} · ${number(step.distance_m || 0)} m${step.instruction ? ` · ${step.instruction}` : ''}`;
    button.addEventListener('click', () => {
      const geometry = routes.get(candidate.variant_code).features[0].geometry;
      const roadLines = lines(geometry), line = roadLines[step.leg_index];
      if (line && Number.isInteger(step.from_index) && Number.isInteger(step.to_index)) {
        const coords = line.slice(step.from_index, step.to_index + 1); if (coords.length >= 2) fitCoordinates(coords);
      }
    }); $('steps').append(button);
  });
  $('download').href = `/${candidate.geojson_filename}`;
  const previous = notes.get(candidate.variant_code); $('decision').value = previous?.decision || 'PENDING_MANUAL_REVIEW'; $('review-notes').value = previous?.notes || '';
}
function mapCandidate(candidate) {
  const geojson = routes.get(candidate.variant_code);
  map.getSource('candidate').setData(geojson);
  const lineParts = lines(geojson.features[0].geometry);
  const first = lineParts[0][0], last = lineParts.at(-1).at(-1);
  const gaps = { type: 'FeatureCollection', features: [
    [candidate.origin_coordinates, first], [last, candidate.destination_coordinates],
  ].map(coordinates => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })) };
  map.getSource('gaps').setData(gaps);
  markers.forEach(m => m.remove()); markers = [];
  const nodes = new globalThis.Map(report.database_before.variants.flatMap(v => v.stops.map(n => [n.node_code, n])));
  for (const node of nodes.values()) {
    const origin = node.node_code === candidate.origin_node_code, destination = node.node_code === candidate.destination_node_code;
    const el = document.createElement('div'); el.className = 'node-label'; el.textContent = `${origin ? 'O · ' : destination ? 'D · ' : ''}${node.node_code.includes('PSU') ? 'PSU' : node.node_code.includes('SM-PAMPANGA') ? 'SM Main Gate' : node.node_code.includes('ROB-') ? 'Robinsons Arayat Gate' : 'Mexico Bayan'}`;
    el.style.borderColor = origin ? '#16866f' : destination ? '#d84148' : '#3e72a8';
    const popup = document.createElement('div'); popup.textContent = `${node.name} · ${node.verification_status} · ${node.data_mode} · ${node.latitude}, ${node.longitude}`;
    markers.push(new Marker({ element: el, anchor: 'bottom', offset: [0, -10] }).setLngLat([node.longitude, node.latitude]).setPopup(new Popup().setDOMContent(popup)).addTo(map));
    markers.push(new Marker({ color: origin ? '#16866f' : destination ? '#d84148' : '#3e72a8', scale: .65 }).setLngLat([node.longitude, node.latitude]).addTo(map));
  }
  fitCoordinates([...lineParts.flat(), candidate.origin_coordinates, candidate.destination_coordinates]);
  $('status').textContent = `Ready · ${candidate.variant_code} · independent request ${candidate.request_id.slice(0, 8)} · pending review`;
}
function selectCandidate() {
  saveNotes(); current = report.variants.find(v => v.variant_code === $('variant').value); render(current); mapCandidate(current);
}
async function start() {
  report = await (await fetch('/report.json')).json();
  for (const v of report.variants) {
    routes.set(v.variant_code, await (await fetch(`/${v.geojson_filename}`)).json());
    const option = document.createElement('option'); option.value = v.variant_code; option.textContent = v.variant_code; $('variant').append(option);
  }
  const totals = report.multi_leg_journey.totals_php;
  paragraph($('multi'), 'CANDIDATE_FARE_PREVIEW · 2 vehicle legs · 1 transfer. Tricycle PHP 100 DEMO_ESTIMATE + candidate Mexico Bayan → SM jeep fare.');
  table($('multi'), [['Jeep policy', 'Regular total', 'Discounted total'], ['Traditional', money(totals.PUJ_TRADITIONAL.regular), money(totals.PUJ_TRADITIONAL.discounted)], ['Modern', money(totals.PUJ_MODERN.regular), money(totals.PUJ_MODERN.discounted)]]);
  map = new Map({ container: 'map', center: [120.71, 15.09], zoom: 12, style: {
    version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' } },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  } });
  map.addControl(new NavigationControl()); map.addControl(new ScaleControl());
  map.on('error', () => { $('status').textContent = 'Map or basemap error. Candidate numbers and files remain available; check network/WebGL and reload.'; });
  map.on('load', () => {
    const empty = { type: 'FeatureCollection', features: [] };
    map.addSource('candidate', { type: 'geojson', data: empty }); map.addSource('gaps', { type: 'geojson', data: empty });
    map.addLayer({ id: 'candidate-outline', type: 'line', source: 'candidate', paint: { 'line-color': '#ffffff', 'line-width': 9 } });
    map.addLayer({ id: 'candidate-line', type: 'line', source: 'candidate', paint: { 'line-color': '#7843bc', 'line-width': 5 } });
    map.addLayer({ id: 'snapping-gaps', type: 'line', source: 'gaps', paint: { 'line-color': '#e29122', 'line-width': 3, 'line-dasharray': [2, 2] } });
    // Image arrows avoid remote glyph/font services and show travel direction.
    const canvas = document.createElement('canvas'); canvas.width = 30; canvas.height = 20;
    const ctx = canvas.getContext('2d'); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(7, 3); ctx.lineTo(15, 10); ctx.lineTo(7, 17); ctx.stroke();
    map.addImage('direction-arrow', ctx.getImageData(0, 0, 30, 20));
    map.addLayer({ id: 'direction', type: 'symbol', source: 'candidate', layout: { 'symbol-placement': 'line', 'symbol-spacing': 90, 'icon-image': 'direction-arrow', 'icon-allow-overlap': true } });
    selectCandidate(); $('variant').addEventListener('change', selectCandidate);
  });
  $('fit').addEventListener('click', () => { if (current) mapCandidate(current); });
  $('export-notes').addEventListener('click', () => {
    saveNotes(); const blob = new Blob([JSON.stringify({ phase: 'BATCH_A.5A', reviewed_at: new Date().toISOString(),
      generated_at: report.generated_at, database_application: false,
      candidates: report.variants.map(v => ({ variant_code: v.variant_code, request_id: v.request_id,
        geometry_file: v.geojson_filename, ...notes.get(v.variant_code) || { decision: 'PENDING_MANUAL_REVIEW', notes: '' } })),
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'batch-a5-manual-review-notes.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
start().catch(() => { $('status').textContent = 'Could not initialize review. Start the local server and verify candidate files and installed MapLibre dependency.'; });
