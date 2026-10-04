import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {SOURCE,FORMAT,emptyRow,parseDraft,checkDraft,makeDraft} from '../site/lab-model.js';
const publicBundle=JSON.parse(readFileSync(new URL('../site/runs/reference-va-bldg28.bundle.json',import.meta.url)));
const reference=publicBundle.tasks[0].answer.quantities.find(q=>q.item==='VCT-1');
// Public self-reported quantity used solely to test serialization. This is not an answer key or a new measured result.
const draft={agent:'UI validation, not an agent evaluation',calibration:'See existing public bundle; not independently recalibrated by this test.',notes:'Serialization of public reference evidence only; no new takeoff performed.',quantities:[{roomId:'Public reference finish total',finish:reference.item,value:String(reference.value),unit:'sf',evidence:'site/runs/reference-va-bldg28.bundle.json: existing self-reported quantity'}]};
const raw=()=>({...draft,quantities:draft.quantities.map(q=>({...q})),format:FORMAT,source:SOURCE});
test('published PDF is byte-identical to the existing real source',()=>{
 const pdf=readFileSync(new URL('../site/'+SOURCE.pdf,import.meta.url));
 assert.equal(createHash('sha256').update(pdf).digest('hex'),SOURCE.sha256);
 assert.deepEqual(pdf,readFileSync(new URL('../tasks/div9/va-bldg28/assets/va-stcloud-bldg28-finish.pdf',import.meta.url)));
});
test('retired synthetic drawings are not deployed',()=>{
 assert.equal(existsSync(new URL('../site/practice/d9-area-1.svg',import.meta.url)),false);
 assert.equal(existsSync(new URL('../site/practice/d9-area-1.task.json',import.meta.url)),false);
});
test('source identity is required before accepting an import',()=>{
 const data=raw();data.source={...SOURCE,sha256:'different-drawing'};assert.throws(()=>parseDraft(data),/exact VA Building/);
});
test('signed run bundles are directed to the inspector, not interpreted as drafts',()=>assert.throws(()=>parseDraft(publicBundle),/Evidence inspector/));
test('empty work never passes completeness checks',()=>assert.equal(checkDraft({agent:'',calibration:'',notes:'',quantities:[emptyRow()]}).length,5));
test('valid public-reference evidence can round-trip without claiming accuracy',()=>{
 assert.deepEqual(checkDraft(draft),[]);assert.deepEqual(parseDraft(makeDraft(draft)),draft);
});
test('wrong units are rejected, not silently converted',()=>{const data=raw();data.quantities[0].unit='sy';assert.throws(()=>parseDraft(data),/unit "sf"/);});
test('missing citations prevent a complete submission',()=>{const data=raw();data.quantities[0].evidence='';assert.match(checkDraft(data).join(' '),/source evidence/);});
test('nonfinite, empty, negative and zero areas fail',()=>{
 for(const value of ['','Infinity','NaN','-1','0']){const data=raw();data.quantities[0].value=value;assert.match(checkDraft(data).join(' '),/positive measured area/);}
});
test('duplicate finish and region rows require resolution',()=>{const data=raw();data.quantities.push({...data.quantities[0]});assert.match(checkDraft(data).join(' '),/duplicate/);});
test('import cannot inject grades, credentials or arbitrary fields into exports',()=>{
 const data=raw();data.apiKey='not-a-real-key';data.status='certified';data.score=0;data.quantities[0].secret='exclude';
 const exported=makeDraft(data);assert.equal(exported.status,'unverified');assert.equal(exported.assessment.accuracy,'not-scored');assert.equal(exported.assessment.certification,'not-issued');
 assert.equal('apiKey' in exported,false);assert.equal('score' in exported,false);assert.equal('secret' in exported.quantities[0],false);
});
test('oversized row collections are rejected',()=>{const data=raw();data.quantities=Array.from({length:201},()=>draft.quantities[0]);assert.throws(()=>parseDraft(data),/200/);});
