'use strict';
const fs=require('node:fs'); const assert=require('node:assert/strict');
const {cases}=require('./helpers/connected-acceptance-cases');
const base=process.env.PAMANA_TEST_API_URL||'http://127.0.0.1:1338';
assert.match(base,/^http:\/\/(?:localhost|127\.0\.0\.1):133[78]$/);
assert.match(process.env.PAMANA_TEST_USERNAME||'',/^phase24-browser-[0-9-]+$/);
async function main(){
  const auth=await fetch(base+'/api/auth/local',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:process.env.PAMANA_TEST_USERNAME,password:process.env.PAMANA_TEST_PASSWORD})});
  const session=await auth.json();assert.equal(auth.status,200); const headers={Authorization:'Bearer '+session.jwt,'Content-Type':'application/json'};
  const request=async(path,body)=>{const start=Date.now();const response=await fetch(base+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {httpStatus:response.status,elapsedMs:Date.now()-start,body:await response.json()}};
  const report={executedAt:new Date().toISOString(),kind:'AUTHENTICATED_HTTP_NOT_UI',capabilities:await request('/api/pamana-ai/planning-capabilities'),cases:[]};
  for(const item of cases){
    const original={...item.request,departureAt:new Date().toISOString()};const plan=await request('/api/pamana-ai/trip-plan',original);assert.equal(plan.httpStatus,200);
    const selected=plan.body.journeys.find(j=>item.id==='I'?j.legs.some(l=>l.type==='TRANSIT'&&l.variant.code==='CSF-CITY-ROB-IN'):item.id==='J'?j.legs.some(l=>l.type==='TRANSIT'&&l.variant.code==='CSF-ARAYAT-ROB-IN'):j.id===plan.body.recommendations.recommended.journeyId);
    assert.ok(selected,`case ${item.id} journey missing`);
    const body={request:original,journeyId:selected.id};const details=await request('/api/pamana-ai/journey-details',body), estimate=await request('/api/pamana-ai/travel-time',body);
    assert.equal(details.body.status,'READY'); report.cases.push({id:item.id,request:original,plan,details,estimate});console.log(`${item.id}: plan=${plan.httpStatus}/${plan.elapsedMs}ms details=${details.httpStatus}/${details.body.status} time=${estimate.httpStatus}/${estimate.body.status}`);
  }
  const original={...cases[0].request,departureAt:new Date().toISOString()};
  report.tamperedDetails=await request('/api/pamana-ai/journey-details',{request:original,journeyId:'client-invented-route'});
  report.tamperedEstimate=await request('/api/pamana-ai/travel-time',{request:original,journeyId:'client-invented-route'});
  assert.notEqual(report.tamperedDetails.body.status,'READY'); assert.notEqual(report.tamperedEstimate.body.status,'COMPLETE');
  report.operational=[];
  for(const code of ['RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF','RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD']) {
    const manifest=require('../src/services/pamana-journey/data/connected-research-manifest.json');const point=manifest.nodes.find(n=>n.node_code===code);
    const origin={lat:original.origin.lat,lng:original.origin.lng,label:'PSU Mexico',source:'GEOAPIFY'};
    const destination={lat:point.latitude,lng:point.longitude,label:point.name,source:'GEOAPIFY'};
    const plan=await request('/api/pamana-ai/trip-plan',{...original,origin,destination,planningMode:'OPERATIONAL',accessPreference:'AUTO'});
    assert.equal(plan.body.status,'JOURNEYS_FOUND');
    assert.ok(plan.body.journeys.every(j=>!j.dataQuality.researchPreview&&j.durationSummary.totalJourneyDurationSeconds===null&&j.legs.every(l=>l.availability.evidenceClass!=='SIMULATED')));
    report.operational.push({code,plan});
  }
  report.anonymousStatus=(await fetch(base+'/api/pamana-ai/planning-capabilities')).status;assert.equal(report.anonymousStatus,403);
  fs.writeFileSync('documentation/connected-http-results.json',JSON.stringify(report,null,2)+'\n');
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
