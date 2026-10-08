'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { node, route, variant, stop } = require('./fixtures/phase10-synthetic-network');
const { manifest, materializeResearchTransport, researchFields } = require('../src/services/pamana-journey/research-transport');
const { planningContext, eligibilityForContext, accessPolicy } = require('../src/services/pamana-journey/planning-context');
const { attachCorridorConnectors, projectPoint, sectionAllowed } = require('../src/services/pamana-journey/corridor-connectors');
const { buildTransportGraph } = require('../src/services/pamana-journey/graph-builder');
const { planJourneysWithWalkingCandidates } = require('../src/services/pamana-journey/walking-journey-service');
const { planJourneys } = require('../src/services/pamana-journey/journey-planner');
const { orchestrateTripPlan } = require('../src/services/pamana-journey/trip-plan-orchestrator');
const { resultKey } = require('../src/services/pamana-journey/journey-result-deduplicator');
const { getPinArea, containsPoint } = require('../src/services/pamana-journey/pin-area');
const { cases } = require('./helpers/connected-acceptance-cases');
const context = planningContext('RESEARCH_PREVIEW', { PAMANA_DEMO_MODE_ENABLED: 'true', PAMANA_RESEARCH_PREVIEW_ENABLED: 'true', PAMANA_RESEARCH_SIMULATED_OBSERVATIONS_ENABLED: 'true' });
function fixture() {
  const codes = ['RCH-PSU-MEXICO-FRONT', 'RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER', 'RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF', 'RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD'];
  const nodes = codes.map(code => { const reference = manifest.nodes.find(n => n.node_code === code); return node(code, reference); });
  const [psu, mexico, sm, rob] = nodes;
  const edge = (code, direction, parent, from, to, length, transfers) => variant(code, direction, route(parent), [
    stop(code, from, 1, { dropoff_allowed: false, transfer_allowed: transfers, distance_from_variant_start_m: 0 }),
    stop(code, to, 2, { pickup_allowed: false, transfer_allowed: transfers, distance_from_variant_start_m: length }),
  ]);
  return { nodes, variants: [edge('RCH-SJ-SMROB-OUT','OUTBOUND','RCH-SJ-SMROB',psu,sm,10694,false),
    edge('RCH-SJ-SMROB-IN','INBOUND','RCH-SJ-SMROB',rob,psu,11165,false),
    edge('PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT','OUTBOUND','RCH-ARAYAT-SF-VIA-STAANA-MEXICO',mexico,sm,3007,true)] };
}
// Synthetic pedestrian fixture, deliberately not UI or field acceptance.
const router = { routeWalk: async ({ from, to, signal }) => signal?.aborted ? { ok: false, error: { code: 'ROUTING_CANCELLED' } } : ({ ok: true, value: {
  type: 'WALK', from, to, distanceMeters: Math.hypot((from.lat - to.lat)*111000,(from.lng-to.lng)*107000)*1.1,
  durationSeconds: Math.hypot((from.lat-to.lat)*111000,(from.lng-to.lng)*107000),
  geometry: { type: 'LineString', coordinates: [[from.lng,from.lat],[to.lng,to.lat]] }, instructions: [], source: 'GEOAPIFY', calculatedAt: new Date().toISOString(),
} }) };
const servicesFor = data => ({ loadEligibleCoordinateNodes: async () => data.nodes, loadEligibleTransportGraphData: async () => data,
  loadEligibleDisruptions: async () => [], loadFareAndServiceData: async () => ({ fareRules: [], servicePatterns: [] }), loadOperationalData: async () => ({ operationalRecords: [] }) });
test('all four flag combinations require both server flags and explicit mode', () => {
  for (const demo of ['true','false']) for (const preview of ['true','false']) {
    const env = { PAMANA_DEMO_MODE_ENABLED: demo, PAMANA_RESEARCH_PREVIEW_ENABLED: preview };
    assert.equal(planningContext('OPERATIONAL',env).researchPreview,false);
    if (demo === 'true' && preview === 'true') assert.equal(planningContext('RESEARCH_PREVIEW',env).researchPreview,true);
    else assert.throws(() => planningContext('RESEARCH_PREVIEW',env),/DISABLED/);
  }
});
test('research evidence needs registered scope, stays REAL, and never gains operational verification', () => {
  const evidence = researchFields();
  assert.equal(eligibilityForContext(evidence,{context}).eligible,true);
  assert.equal(eligibilityForContext(evidence,{context:planningContext()}).eligible,false);
  for (const patch of [{researchEvidenceId:'unregistered'},{data_mode:'SIMULATED'},{previewReviewed:false},{source_reference:''}]) assert.equal(eligibilityForContext({...evidence,...patch},{context}).eligible,false);
  assert.equal(evidence.verified_at,null); assert.equal(evidence.planning_enabled,false);
  assert.equal(manifest.observedAt,null);
});
test('separate walk policy is configurable and invalid ordering fails', () => {
  assert.deepEqual(accessPolicy({}),{preferredWalkMeters:500,maximumWalkMeters:1500,candidateRadiusMeters:1500});
  assert.throws(()=>accessPolicy({PREFERRED_WALK_TO_TRANSIT_METERS:1800,MAX_WALK_TO_TRANSIT_METERS:1500}));
});
for (const example of cases) test(`AUTOMATED FIXTURE ${example.id}: exact endpoints and connected research journey`, async () => {
  const data = fixture(), before = JSON.stringify(data);
  const response = await orchestrateTripPlan(example.request,{services:servicesFor(data),router,context});
  assert.equal(response.status,'JOURNEYS_FOUND'); assert.deepEqual(response.request.origin,example.request.origin); assert.deepEqual(response.request.destination,example.request.destination);
  assert.equal(JSON.stringify(data),before);
  assert.ok(response.journeys.every(j=>j.dataQuality.dataModes.every(m=>m==='REAL')));
  assert.equal(new Set(response.journeys.map(resultKey)).size, response.journeys.length, 'each returned passenger itinerary must be distinct');
  assert.equal(response.meta.journeyCount, response.journeys.length);
  for (const choice of Object.values(response.recommendations)) if (choice.journeyId) assert.ok(response.journeys.some(j => j.id === choice.journeyId));
  const rides = response.journeys.flatMap(j=>j.legs.filter(l=>l.type==='TRANSIT'));
  if (['G','H','I','J','K'].includes(example.id)) assert.ok(rides.every(l=>l.direction==='INBOUND'));
  if (['H','I','J','K'].includes(example.id)) assert.ok(rides.some(l=>l.boardAt.connector?.temporary));
  if (example.id === 'J') assert.ok(rides.some(l=>l.variant.code==='CSF-ARAYAT-ROB-IN'));
  if (example.id === 'I') assert.ok(rides.some(l=>l.variant.code==='CSF-CITY-ROB-IN'));
});
test('multiple intermediate destinations use one service; section roles and direction cannot leak', () => {
  const data=fixture(); const request=cases.find(c=>c.id==='H').request;
  const research=materializeResearchTransport(data,data.nodes,request,context);
  const connected=attachCorridorConnectors(research.graphData,research.nodes,request,{context,sections:research.sections});
  const incoming=connected.graphData.variants.filter(v=>v.direction==='INBOUND');
  assert.equal(incoming.filter(v=>v.variant_code==='CSF-CITY-ROB-IN').length,1);
  assert.notDeepEqual(manifest.variants.find(v=>v.variant_code==='CSF-CITY-ROB-IN').geometry_geojson.coordinates,manifest.variants.find(v=>v.variant_code==='CSF-SM-PALENGKE-OUT').geometry_geojson.coordinates.slice().reverse());
  const section=manifest.sections.find(s=>s.variantCode==='CSF-CITY-ROB-IN'); const service=incoming.find(v=>v.variant_code===section.variantCode);
  assert.equal(sectionAllowed(section,service,'ACCESS',context),true); assert.equal(sectionAllowed(section,service,'EGRESS',context),false);
  assert.equal(sectionAllowed(section,service,'ACCESS',planningContext()),false);
  const routeCodes=incoming.filter(v=>['CSF-CITY-ROB-IN','CSF-ARAYAT-ROB-IN'].includes(v.variant_code)).map(v=>v.variant_code);
  assert.equal(new Set(routeCodes).size,2);
});
test('Robinson transfer overlay is preview-scoped and leaves stored permissions untouched', () => {
  const data=fixture(), original=data.variants.find(v=>v.variant_code==='RCH-SJ-SMROB-IN');
  const request=cases.find(c=>c.id==='G').request;
  const normal=materializeResearchTransport(data,data.nodes,request,planningContext());
  assert.equal(normal.graphData.variants.find(v=>v.variant_code===original.variant_code).route_variant_stops[0].transfer_allowed,false);
  const preview=materializeResearchTransport(data,data.nodes,request,context);
  assert.equal(preview.graphData.variants.find(v=>v.variant_code===original.variant_code).route_variant_stops[0].transfer_allowed,true);
  assert.equal(original.route_variant_stops[0].transfer_allowed,false);
});

test('code reuse requires compatible identity and coordinates within fifteen metres', () => {
  const data = fixture(), request = cases[0].request;
  data.nodes.find(n => n.node_code === 'RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD').latitude += 0.001;
  assert.throws(() => materializeResearchTransport(data, data.nodes, request, context), /IDENTITY_REVIEW_REQUIRED/);
});
test('one initial feeder plus three public rides counts three vehicle changes, never allows a final feeder', () => {
  const points=['O','A','B','C','D'].map(c=>node(c));
  const variants=points.slice(0,-1).map((point,i)=>variant(`LEG${i}`,'OUTBOUND',route(`LEG${i}`,i===0?'TRICYCLE':'PUJ_TRADITIONAL'),[
    stop(`LEG${i}`,point,1,{dropoff_allowed:false,transfer_allowed:true}),stop(`LEG${i}`,points[i+1],2,{pickup_allowed:false,transfer_allowed:true})]));
  const graph=buildTransportGraph({variants});
  const result=planJourneys(graph,{candidateBoardingNodeIds:[points[0].id],candidateDestinationNodeIds:[points[4].id],maxTransfers:2,maxPublicRides:3,allowInitialFeeder:true});
  assert.equal(result.length,1); assert.equal(result[0].legs.length,4); assert.equal(result[0].transferCount,3);
  variants[3].route.transport_mode='TRICYCLE'; assert.equal(planJourneys(buildTransportGraph({variants}),{candidateBoardingNodeIds:[points[0].id],candidateDestinationNodeIds:[points[4].id],maxTransfers:2,maxPublicRides:3,allowInitialFeeder:true}).length,0);
});
test('required SM pedestrian failure excludes dependent service while retaining Mexico alternative', async () => {
  const data=fixture(); const request=cases.find(c=>c.id==='C').request;
  const sm=manifest.nodes.find(n=>n.node_code==='RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF');
  const terminal=manifest.nodes.find(n=>n.node_code==='CSF-SM-TERMINAL-BOARD');
  const response=await orchestrateTripPlan(request,{services:servicesFor(data),context,router:{routeWalk: async args => args.from.lat === sm.latitude && args.to.lat === terminal.latitude ? {ok:false,error:{code:'TRANSFER_WALK_UNAVAILABLE'}} : router.routeWalk(args)}});
  assert.equal(response.status,'JOURNEYS_FOUND'); assert.ok(response.journeys.every(j=>!j.legs.some(l=>l.type==='TRANSIT'&&l.variant.code==='CSF-SM-PALENGKE-OUT')));
});
test('research overlay and simulated observations never enter operational results', async () => {
  const data=fixture(); const request={...cases[0].request,planningMode:'OPERATIONAL'};
  const response=await orchestrateTripPlan(request,{services:servicesFor(data),router,context:planningContext()});
  assert.ok(response.journeys.every(j=>!j.dataQuality.researchPreview&&j.durationSummary.totalJourneyDurationSeconds===null));
});
test('San Fernando geographic permission remains separate; a city point cannot become a San Juan feeder', () => {
  const area=getPinArea({enabled:true,includeSanFernando:false});
  assert.equal(containsPoint(area.boundary.geometry,cases.find(c=>c.id==='K').request.origin),false);
  const data=fixture(), request={...cases.find(c=>c.id==='K').request,accessPreference:'AUTO'};
  assert.ok(materializeResearchTransport(data,data.nodes,request,context).graphData.variants.every(v=>v.variant_code!=='RCH-SAN-JUAN-INITIAL-FEEDER'));
});

test('a San Juan pin never fabricates unreported feeder coverage', () => {
  const data=fixture(), request={...cases.find(c=>c.id==='B').request,accessPreference:'FEEDER'};
  assert.ok(materializeResearchTransport(data,data.nodes,request,context).graphData.variants.every(v=>v.route.transport_mode!=='TRICYCLE'));
});

test('FEEDER uses an eligible stored tricycle, WALK_ONLY excludes it', async () => {
  const data=fixture(), [psu,mexico]=data.nodes;
  data.variants.push(variant('SUPPORTED-FEEDER','OUTBOUND',route('SUPPORTED-FEEDER','TRICYCLE'),[
    stop('SUPPORTED-FEEDER',psu,1,{dropoff_allowed:false,transfer_allowed:true}),
    stop('SUPPORTED-FEEDER',mexico,2,{pickup_allowed:false,transfer_allowed:true})]));
  for(const preference of ['FEEDER','WALK_ONLY']) {
    const result=await orchestrateTripPlan({...cases[0].request,accessPreference:preference},{services:servicesFor(data),router,context});
    assert.ok(result.journeys.length>0);
    assert.equal(result.journeys.some(j=>j.legs.find(l=>l.type==='TRANSIT').transportMode==='TRICYCLE'),preference==='FEEDER');
    if(preference==='WALK_ONLY') assert.ok(result.journeys.some(j=>j.legs.find(l=>l.type==='TRANSIT').boardAt.nodeCode==='RCH-PSU-MEXICO-FRONT'), 'a shared feeder/jeepney point must retain its jeepney boarding');
  }
});

test('JBL alternatives are distinct across AUTO, walking, feeder and discount contexts', async () => {
  const { landmark } = require('./helpers/connected-acceptance-cases');
  const data = fixture(), [psu, mexico] = data.nodes;
  data.variants.push(variant('SUPPORTED-FEEDER','OUTBOUND',route('SUPPORTED-FEEDER','TRICYCLE'),[
    stop('SUPPORTED-FEEDER',psu,1,{dropoff_allowed:false,transfer_allowed:true}),
    stop('SUPPORTED-FEEDER',mexico,2,{pickup_allowed:false,transfer_allowed:true})]));
  for (const accessPreference of ['AUTO', 'WALK_ONLY', 'FEEDER']) for (const passengerCategory of ['REGULAR', 'STUDENT', 'SENIOR', 'PWD']) {
    const request = { ...cases[1].request, destination: landmark('JBL'), accessPreference, passengerCategory };
    const response = await orchestrateTripPlan(request, { services: servicesFor(data), router, context });
    assert.equal(response.status, 'JOURNEYS_FOUND');
    const mexicoDirect = response.journeys.filter(j => j.legs.some(l => l.type === 'TRANSIT'
      && ['CSF-MEXICO-MARKET-OUT','CSF-MEXICO-SFELAPCO-OUT'].includes(l.variant.code)));
    assert.ok(mexicoDirect.length > 0);
    assert.equal(new Set(mexicoDirect.map(j => resultKey(j, { accessAlternatives: true }))).size, mexicoDirect.length, `${accessPreference}/${passengerCategory}`);
    assert.equal(new Set(response.journeys.map(resultKey)).size, response.journeys.length);
    assert.ok(response.journeys.some(j => j.id === response.recommendations.recommended.journeyId));
  }
});
