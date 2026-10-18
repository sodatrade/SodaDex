import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {Mining196WalletExecution,KEEPER_CAP,NATIVE_CAP} from './mining-196-wallet-execution.mjs'
const owner='0x1111111111111111111111111111111111111111',keeper='0x2222222222222222222222222222222222222222'
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mining196-wallet-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const config={root:process.cwd(),file:path.join(dir,'ledger.json'),keeper,validateIntent:async()=>false,
    rehearsal:{owner,feeCap:'21000000',stack:{signer:'0x3333333333333333333333333333333333333333'}},
    approval:{approved:true,totalOwnerOutlayCapWei:'2600000000000000',planHash:'bound'},
    deploymentJournal:{chainId:196,publicTestContracts:true,phase:'deployment-and-inventory-complete',
      transactions:Array.from({length:55},()=>({status:'0x1'})),planHash:'bound',actualFeesWei:'1500000000000000',startNonce:'39'}}
  const runner=new Mining196WalletExecution(config);runner.rpcClient.rpc=async()=>{throw new Error('RPC should not be reached')}
  return {runner,config}
}
test('requires completed successful deployment before any wallet action',t=>{
  const {config}=fixture(t);config.deploymentJournal.transactions[0].status='0x0'
  assert.throws(()=>new Mining196WalletExecution(config),/Complete approved/)
})
test('total cap includes deployment, new fees and full keeper funding exactly once',t=>{
  const {runner}=fixture(t);runner.state.gasWei='1019990000000000';runner.state.keeperFundingWei=String(KEEPER_CAP)
  assert.doesNotThrow(()=>runner.assertBudget(0n,0n,0n))
  assert.throws(()=>runner.assertBudget(10000000001n,0n,0n),/cap exceeded/)
  assert.throws(()=>runner.assertBudget(0n,NATIVE_CAP+1n,0n),/cap exceeded/)
  assert.throws(()=>runner.assertBudget(0n,0n,1n),/cap exceeded/)
})
test('wrong chain, unknown calls and unapproved funding are rejected before RPC',async t=>{
  const {runner}=fixture(t),tx={from:owner,to:keeper,data:'0x',value:'0x0'}
  await assert.rejects(runner.execute({...tx,chainId:'0x7a0'}),/wrong-chain/)
  await assert.rejects(runner.execute(tx),/outside/)
  await assert.rejects(runner.execute({...tx,value:'0x1'},'keeper-funding'),/single approved/)
  assert.equal(fs.existsSync(runner.file+'.lock'),false)
})
test('persisted pending cannot replay and cumulative fees survive reload',async t=>{
  const {runner,config}=fixture(t);runner.state.gasWei='123';runner.state.pending={hash:'retained'};runner.save()
  const restored=new Mining196WalletExecution(config)
  assert.equal(restored.state.gasWei,'123')
  await assert.rejects(restored.execute({}),/Reconcile retained/)
})
test('another writer or changed persisted ledger stops execution',async t=>{
  const {runner}=fixture(t);fs.writeFileSync(runner.file+'.lock','')
  await assert.rejects(runner.execute({}),/EEXIST/);fs.unlinkSync(runner.file+'.lock')
  runner.save();const changed={...runner.state,gasWei:'100'};fs.writeFileSync(runner.file,JSON.stringify(changed))
  await assert.rejects(runner.execute({}),/ledger changed/)
})
