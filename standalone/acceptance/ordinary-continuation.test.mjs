import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {assertContinuation,assertJournalTotals,assertRetainedPrefix} from './ordinary-continuation.mjs'
const dir=new URL('../../deployments/xlayer-test/ordinary-pools/',import.meta.url)
const read=name=>fs.readFileSync(new URL(name,dir))
const sha=text=>createHash('sha256').update(text).digest('hex')
const base=JSON.parse(read('final-rehearsal.json')),caps=JSON.parse(read('public-approval.json')),baseline=JSON.parse(read('public-journal-before-continuation.json')),child=JSON.parse(read('remaining-rehearsal.json')),continuation=JSON.parse(read('continuation.json'))
const hashes={base:sha(read('final-rehearsal.json')),approval:sha(read('public-approval.json')),baseline:sha(read('public-journal-before-continuation.json')),child:sha(read('remaining-rehearsal.json'))}
const permit2='0x000000000022D473030F116dDEE9F6B43aC78BA3',clone=x=>structuredClone(x)
const validate=(b=baseline,c=child,k=continuation,h=hashes,cap=caps)=>assertContinuation(base,c,b,k,h,permit2,cap)
test('one finite refresh preserves sixteen receipts, original nonce and all remaining actions',()=>{
 const plan=validate();assert.equal(plan.startNonce,168);assert.equal(plan.rows.length,25);assert.deepEqual(plan.rows.slice(0,16),base.rows.slice(0,16))
})
test('changed evidence, prefix, result, runtime or additional action is rejected',()=>{
 for(const field of Object.keys(hashes))assert.throws(()=>validate(baseline,child,continuation,{...hashes,[field]:'tampered'}))
 for(const mutate of[c=>c.rows.shift(),c=>c.rows.push(c.rows[0]),c=>c.results[0].tokenId='3',c=>c.runtimeHashes={}]){const c=clone(child);mutate(c);const k={...continuation,rows:[...base.rows.slice(0,16),...c.rows]};assert.throws(()=>validate(baseline,c,k))}
 const k=clone(continuation);k.rows[0].value='1';assert.throws(()=>validate(baseline,child,k))
})
test('pending, stopped, completed or reset accounting cannot activate',()=>{
 for(const change of[{pending:{hash:'0x1234'}},{stopped:true},{completed:true},{gasSpentWei:'0'},{nonGasSpentWei:'0'},{fabSpentRaw:'0'},{rows:[]}])assert.throws(()=>validate({...baseline,...change}))
})
test('extra approval cannot change amount, target or native input',()=>{
 for(const change of[{to:base.owner},{value:'1'},{maximumFabSpendRaw:'1'},{data:child.rows[0].data+'00'},{plannedGasLimit:'99999999'}]){
  const c=clone(child);Object.assign(c.rows[0],change);assert.throws(()=>validate(baseline,c,{...continuation,rows:[...base.rows.slice(0,16),...c.rows]}))
 }
})
test('remaining worst-case fees still accumulate with old actual fees',()=>{
 assert.throws(()=>validate(baseline,child,continuation,hashes,{...caps,gasCapWei:baseline.gasSpentWei}))
 assert.throws(()=>validate(baseline,child,continuation,hashes,{...caps,maxTestTokenApprovalsRaw:baseline.fabSpentRaw}))
})
test('activated journal retains prefix and cannot reset totals or change continuation',()=>{
 const state={...clone(baseline),continuationSha256:'hash',continuationActivatedAt:'now'}
 assert.doesNotThrow(()=>assertRetainedPrefix(state,baseline,'hash'))
 assert.throws(()=>assertRetainedPrefix(state,baseline,'other'))
 const edited=clone(state);edited.rows[0].hash='0x1234';assert.throws(()=>assertRetainedPrefix(edited,baseline,'hash'))
 assert.throws(()=>assertJournalTotals({...state,gasSpentWei:'0'}))
})
