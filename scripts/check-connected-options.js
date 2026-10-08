'use strict';
const fs=require('node:fs'), assert=require('node:assert/strict');
const {cases}=require('./helpers/connected-acceptance-cases');
assert.match(process.env.PAMANA_TEST_USERNAME||'',/^phase24-browser-[0-9-]+$/);
(async()=>{
  const base='http://127.0.0.1:1338';
  const login=await fetch(base+'/api/auth/local',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:process.env.PAMANA_TEST_USERNAME,password:process.env.PAMANA_TEST_PASSWORD})});
  assert.equal(login.status,200);const auth=await login.json(),headers={Authorization:'Bearer '+auth.jwt,'Content-Type':'application/json'};
  const report={executedAt:new Date().toISOString(),kind:'AUTHENTICATED_HTTP_NOT_UI',examples:[]};
  for(const [id,request] of [['STUDENT_C',{...cases[2].request,passengerCategory:'STUDENT'}],['SUPPORTED_PSU_FEEDER',{...cases[0].request,accessPreference:'FEEDER'}],['SAN_JUAN_ACCESS_TO_STORED_FEEDER',{...cases[1].request,accessPreference:'FEEDER'}]]){
    const response=await fetch(base+'/api/pamana-ai/trip-plan',{method:'POST',headers,body:JSON.stringify({...request,departureAt:new Date().toISOString()})});
    const body=await response.json();assert.equal(response.status,200);
    assert.equal(body.status,'JOURNEYS_FOUND');const selected=body.journeys.find(j=>j.id===body.recommendations.recommended.journeyId);
    if(id==='STUDENT_C')assert.equal(selected.fareSummary.totalFare,28);
    else {assert.equal(selected.legs.find(l=>l.type==='TRANSIT').transportMode,'TRICYCLE');assert.equal(selected.legs.find(l=>l.type==='TRANSIT').boardAt.nodeCode,'RCH-PSU-MEXICO-FRONT');assert.ok(body.journeys.every(j=>j.legs.every(l=>l.type!=='TRANSIT'||l.variant.code!=='RCH-SAN-JUAN-INITIAL-FEEDER')));}
    report.examples.push({id,request,status:response.status,body});console.log(id,body.status);
  }
  fs.writeFileSync('documentation/connected-options-results.json',JSON.stringify(report,null,2)+'\n');
})().catch(error=>{console.error(error.message);process.exitCode=1});
