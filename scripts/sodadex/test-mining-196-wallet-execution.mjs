import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {Mining196WalletExecution,KEEPER_CAP,NATIVE_CAP} from './mining-196-wallet-execution.mjs'
import {privateKeyToAccount} from 'viem/accounts'
import {keccak256} from 'viem'
const owner='0x1111111111111111111111111111111111111111',keeper='0x2222222222222222222222222222222222222222'
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mining196-wallet-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const config={root:process.cwd(),file:path.join(dir,'ledger.json'),keeper,validateIntent:async()=>false,
    rehearsal:{owner,feeCap:'21000000',stack:{signer:'0x3333333333333333333333333333333333333333'}},
    approval:{approved:true,totalOwnerOutlayCapWei:'2600000000000000',planHash:'bound'},
    deploymentJournal:{owner,chainId:196,publicTestContracts:true,phase:'deployment-and-inventory-complete',
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
function simulated(t,status='0x1') {
  const {config}=fixture(t),account=privateKeyToAccount('0x'+'01'.padStart(64,'0'))
  config.rehearsal.owner=account.address;config.deploymentJournal.owner=account.address;config.validateIntent=async()=>true
  const anchor={transactionHash:'0x'+'a'.repeat(64),blockNumber:'0x10',blockHash:'0x'+'b'.repeat(64),status:'0x1',gasUsed:'0x1',effectiveGasPrice:'0x1406f40'}
  config.deploymentJournal.transactions[54].receipt=anchor
  const runner=new Mining196WalletExecution(config);let sent=0,current
  runner.signIntent=({nonce,gas,price,value,to,data})=>account.signTransaction({chainId:196,type:'legacy',nonce:Number(nonce),gas,gasPrice:price,value,to,data})
  runner.rpcClient.checkFeeModel=async()=>{}
  runner.rpcClient.rpc=async(method,params=[])=>{
    if(method==='eth_chainId')return '0xc4'
    if(method==='eth_getTransactionCount')return '0x5e'
    if(method==='eth_getTransactionReceipt')return params[0]===anchor.transactionHash?anchor:current
    if(method==='eth_getBlockByNumber')return {hash:params[0]==='0x10'?anchor.blockHash:'0x'+'c'.repeat(64)}
    if(method==='eth_blockNumber')return '0x12'
    if(method==='eth_call')return '0x'
    if(method==='eth_estimateGas')return '0x5208'
    if(method==='eth_getBalance')return '0x100000000000000000'
    if(method==='eth_sendRawTransaction') {
      sent++;const hash=keccak256(params[0]);current={transactionHash:hash,blockNumber:'0x11',blockHash:'0x'+'c'.repeat(64),status,
        from:account.address,to:keeper,gasUsed:'0x5208',effectiveGasPrice:'0x1406f40'};return hash
    }
    throw new Error('Unexpected RPC '+method)
  }
  return {runner,tx:{from:account.address,to:keeper,data:'0x',value:'0x0'},sent:()=>sent}
}
test('successful simulated broadcast records receipt and charges actual gas once',async t=>{
  const {runner,tx,sent}=simulated(t)
  const hash=await runner.execute(tx);assert.equal(sent(),1)
  assert.equal(runner.state.transactions[0].receipt.transactionHash,hash)
  assert.equal(runner.state.gasWei,String(21000n*21000000n));assert.equal(runner.state.pending,null)
})
test('failed receipt still charges gas and prohibits another send',async t=>{
  const {runner,tx,sent}=simulated(t,'0x0')
  await assert.rejects(runner.execute(tx),/Failed receipt/)
  assert.equal(runner.state.gasWei,String(21000n*21000000n))
  await assert.rejects(runner.execute(tx),/Reconcile retained/);assert.equal(sent(),1)
})
test('changed canonical cost anchor rejects before signing or broadcasting',async t=>{
  const {runner,tx,sent}=simulated(t),rpc=runner.rpcClient.rpc
  runner.rpcClient.rpc=(method,params)=>method==='eth_getBlockByNumber'?Promise.resolve({hash:'reorg'}):rpc(method,params)
  await assert.rejects(runner.execute(tx),/cost anchor changed/);assert.equal(sent(),0)
})
test('ambiguous submission leaves the saved hash and never automatically resends',async t=>{
  const {runner,tx}=simulated(t),rpc=runner.rpcClient.rpc;let submissions=0
  runner.rpcClient.rpc=(method,params)=>{if(method==='eth_sendRawTransaction'){submissions++;throw new Error('transport failed')}return rpc(method,params)}
  await assert.rejects(runner.execute(tx),/transport failed/)
  assert.match(runner.state.pending.hash,/^0x[0-9a-f]{64}$/)
  await assert.rejects(runner.execute(tx),/Reconcile retained/);assert.equal(submissions,1)
})
