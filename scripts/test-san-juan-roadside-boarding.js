'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { node, route, variant, stop } = require('./fixtures/phase10-synthetic-network');
const { manifest, materializeResearchTransport } = require('../src/services/pamana-journey/research-transport');
const { planningContext } = require('../src/services/pamana-journey/planning-context');
const { attachCorridorConnectors, sectionAllowed, projectPoint } = require('../src/services/pamana-journey/corridor-connectors');
const { haversineMeters } = require('../src/services/pamana-journey/access-node-finder');
const { buildTransportGraph } = require('../src/services/pamana-journey/graph-builder');
const { planJourneysWithWalkingCandidates } = require('../src/services/pamana-journey/walking-journey-service');
const { orchestrateTripPlan } = require('../src/services/pamana-journey/trip-plan-orchestrator');
const { resultKey } = require('../src/services/pamana-journey/journey-result-deduplicator');
const { landmark, reference } = require('./helpers/connected-acceptance-cases');
const context = planningContext('RESEARCH_PREVIEW', { PAMANA_DEMO_MODE_ENABLED: 'true', PAMANA_RESEARCH_PREVIEW_ENABLED: 'true' });
const reportedPin = { lat: 15.126596409675953, lng: 120.69877588559318, label: 'Reported San Juan pin', source: 'MAP_PIN' };
const requestFor = origin => ({ origin, destination: landmark('JBL'), departureAt: '2026-10-08T04:00:00Z', passengerCategory: 'REGULAR', planningMode: 'RESEARCH_PREVIEW', accessPreference: 'AUTO' });

function fixture() {
  const codes = ['RCH-PSU-MEXICO-FRONT','RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER','RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF','RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD'];
  const nodes = codes.map(code => node(code, manifest.nodes.find(n => n.node_code === code)));
  const geometry = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/san-juan-approved-outbound.geojson'), 'utf8'));
  const code = 'RCH-SJ-SMROB-OUT';
  return { nodes, variants: [variant(code,'OUTBOUND',route('RCH-SJ-SMROB'),[
    stop(code,nodes[0],1,{dropoff_allowed:false,transfer_allowed:false}),
    stop(code,nodes[2],2,{pickup_allowed:false,transfer_allowed:false}),
  ],{geometry_source:'MANUAL_VERIFIED',geometry_geojson:geometry})] };
}

// A deterministic pedestrian-provider fixture, not field/safety verification.
const router = { routeWalk: async ({from,to}) => {
  const direct = haversineMeters(from,to);
  const distanceMeters = to.connector?.role === 'ACCESS' ? (direct < 20 ? 70 : direct + 35) : direct * 1.15;
  return { ok:true,value:{type:'WALK',from:{lat:from.lat,lng:from.lng,label:from.label||from.name},to:{lat:to.lat,lng:to.lng,label:to.label||to.name},
    distanceMeters,durationSeconds:distanceMeters / 1.3,geometry:{type:'LineString',coordinates:[[from.lng,from.lat],[from.lng,from.lat+0.00001],[to.lng,to.lat]]},
    instructions:[{text:'Follow the pedestrian road access.',distanceMeters,durationSeconds:distanceMeters/1.3}],source:'GEOAPIFY',calculatedAt:'2026-10-08T04:00:00Z'} };
} };
const servicesFor = data => ({loadEligibleCoordinateNodes:async()=>data.nodes,loadEligibleTransportGraphData:async()=>data,
  loadEligibleDisruptions:async()=>[],loadFareAndServiceData:async()=>({fareRules:[],servicePatterns:[]}),loadOperationalData:async()=>({operationalRecords:[]})});
const plan = (origin=reportedPin, overrides={}) => { const data=fixture(); return orchestrateTripPlan(requestFor(origin),{context,router,services:servicesFor(data),...overrides}); };
const firstRide = j => j.legs.find(l => l.type === 'TRANSIT');

test('A: exact reported pin and arbitrary nearby pins use the passing outbound services', async () => {
  for (const pin of [reportedPin,{...reportedPin,lat:15.1258,lng:120.6992},{...reportedPin,lat:15.1247,lng:120.6999}]) {
    const result=await plan(pin);
    assert.equal(result.status,'JOURNEYS_FOUND'); assert.deepEqual(result.request.origin,pin);
    const selected=result.journeys.find(j=>j.id===result.recommendations.recommended.journeyId);
    assert.equal(firstRide(selected).boardAt.connector?.temporary,true);
    assert.equal(firstRide(selected).boardAt.name,'San Juan main-road roadside pickup');
    assert.equal(firstRide(selected).direction,'OUTBOUND');
    const access=selected.legs.find(l=>l.type==='WALK'&&l.purpose==='ACCESS');
    assert.equal(access.from.lat,pin.lat);assert.equal(access.from.lng,pin.lng);
    assert.deepEqual(access.geometry.coordinates[0],[pin.lng,pin.lat]);
    assert.ok(access.distanceMeters>haversineMeters(pin,firstRide(selected).boardAt));
    assert.ok(result.journeys.some(j=>firstRide(j).variant.code==='RCH-SJ-MEXICO-OUT'&&firstRide(j).boardAt.connector?.temporary));
    assert.ok(result.journeys.some(j=>firstRide(j).variant.code==='RCH-SJ-SMROB-OUT'&&firstRide(j).boardAt.connector?.temporary));
  }
});

test('B/C: PSU and San Juan terminal remain valid when they have the best access', async () => {
  for (const code of ['RCH-PSU-MEXICO-FRONT','RCH-SAN-JUAN-TERMINAL']) {
    const result=await plan({...reference(code),source:'MAP_PIN',landmarkId:undefined});
    const mexico=result.journeys.find(j=>firstRide(j).variant.code==='RCH-SJ-MEXICO-OUT');
    assert.ok(mexico); assert.equal(firstRide(mexico).boardAt.nodeCode,code);
  }
});

test('D/E: absent permission, wrong direction and Operational cannot acquire this boarding section', () => {
  const data=fixture(),request=requestFor(reportedPin);
  const research=materializeResearchTransport(data,data.nodes,request,context);
  const sections=research.sections.filter(s=>s.id.endsWith('SAN-JUAN-BOARDING'));
  assert.equal(sections.length,2);assert.ok(sections.every(s=>s.permission==='BOARDING_ALLOWED'));
  for (const opts of [{context,sections:[]},{context:planningContext(),sections},{context,sections:sections.map(s=>({...s,direction:'INBOUND'}))}]) {
    const connected=attachCorridorConnectors(research.graphData,research.nodes,request,opts);
    assert.ok(connected.nodes.every(n=>!n.connector?.temporary));
  }
  const v=research.graphData.variants.find(v=>v.variant_code==='RCH-SJ-MEXICO-OUT');
  assert.equal(sectionAllowed(sections[0],v,'EGRESS',context),false);
  const operational=materializeResearchTransport(data,data.nodes,request,planningContext());
  assert.equal(operational.graphData,data);
});

test('F: failed or badly snapped pedestrian access falls back, without a straight-line substitute', async () => {
  for (const failure of ['UNAVAILABLE','BAD_ENDPOINT','HARD_CAP']) {
    const result=await plan(reportedPin,{router:{routeWalk:async args=>{
      if (args.to.connector?.role!=='ACCESS') return router.routeWalk(args);
      if (failure==='UNAVAILABLE') return {ok:false,error:{code:'WALKING_ROUTE_UNAVAILABLE'}};
      const value=(await router.routeWalk(args)).value;
      if (failure==='BAD_ENDPOINT') value.geometry.coordinates.at(-1)[0]+=0.001;
      else value.distanceMeters=1501;
      return {ok:true,value};
    }}});
    assert.equal(result.status,'JOURNEYS_FOUND');
    assert.ok(result.journeys.every(j=>!firstRide(j).boardAt.connector?.temporary));
  }
});

test('nearer geometric projection can lose to an alternative reached by a shorter pedestrian route', async () => {
  const data=fixture(),request=requestFor(reportedPin),research=materializeResearchTransport(data,data.nodes,request,context);
  const section=research.sections.find(s=>s.variantCode==='RCH-SJ-MEXICO-OUT');
  const v=research.graphData.variants.find(v=>v.variant_code===section.variantCode);
  const nearest=projectPoint(v.geometry_geojson.coordinates,reportedPin,section);
  const routed={routeWalk:async args=>{const r=await router.routeWalk(args);if(args.to.connector?.role==='ACCESS'){
    r.value.distanceMeters=Math.abs(args.to.connector.offsetMeters-nearest.offsetMeters)<1?350:140;r.value.durationSeconds=r.value.distanceMeters/1.3;
  }return r;}};
  const result=await plan(reportedPin,{router:routed});
  const mexico=result.journeys.find(j=>firstRide(j).variant.code==='RCH-SJ-MEXICO-OUT');
  assert.equal(firstRide(mexico).boardAt.connector?.temporary,true);
  assert.ok(Math.abs(firstRide(mexico).boardAt.connector.offsetMeters-nearest.offsetMeters)>50);
  assert.equal(mexico.legs.find(l=>l.type==='WALK'&&l.purpose==='ACCESS').distanceMeters,140);
});

test('G: boarding representatives remain distinct only when enriched passenger facts differ', async () => {
  const result=await plan();
  const keys=result.journeys.map(j=>resultKey(j,{accessAlternatives:true}));
  assert.equal(new Set(keys).size,keys.length);
  const permanent=structuredClone(result.journeys[0]);
  const boarding=firstRide(permanent);
  boarding.boardAt={...boarding.boardAt,nodeCode:'RCH-PSU-MEXICO-FRONT',name:'PSU frontage',connector:undefined};
  const access=permanent.legs.find(l=>l.type==='WALK'&&l.purpose==='ACCESS');
  access.distanceMeters+=190;access.durationSeconds+=150;
  assert.notEqual(resultKey(permanent),keys[0], 'a meaningful permanent boarding point remains a genuine alternative');
  const unavailable=structuredClone(permanent);firstRide(unavailable).availability.status='OUTSIDE_SERVICE';
  assert.notEqual(resultKey(unavailable,{accessAlternatives:true}),keys[0]);
  const cheaper=structuredClone(result.journeys[0]);cheaper.fareSummary.totalFare-=1;
  assert.notEqual(resultKey(cheaper,{accessAlternatives:true}),keys[0]);
  assert.ok(result.journeys.every(j=>j.transferCount===j.legs.filter(l=>l.type==='TRANSIT').length-1));
});

test('connectors remain request-local LOCAL_RESEARCH; source network is unchanged', async () => {
  const data=fixture(),before=JSON.stringify(data),request=requestFor(reportedPin);
  const research=materializeResearchTransport(data,data.nodes,request,context);
  const connected=attachCorridorConnectors(research.graphData,research.nodes,request,{context,sections:research.sections});
  const pickups=connected.nodes.filter(n=>n.connector?.role==='ACCESS');
  assert.ok(pickups.length>0);
  assert.ok(pickups.every(n=>n.node_type==='ROADSIDE_PICKUP'&&!n.planning_enabled&&n.verified_at===null&&n.verification_status==='RESEARCH_CANDIDATE'));
  assert.equal(JSON.stringify(data),before);
  const result=await planJourneysWithWalkingCandidates({origin:reportedPin,destination:request.destination,nodes:connected.nodes,graph:buildTransportGraph(connected.graphData,{context}),router,context,maxTransfers:2});
  assert.ok(result.journeys.length>0);
});
