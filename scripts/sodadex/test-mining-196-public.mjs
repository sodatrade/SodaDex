import test from 'node:test'
import assert from 'node:assert/strict'
import { privateKeyToAccount } from 'viem/accounts'
import { validateSignedMiningTransaction } from './mining-public-execution.mjs'
import { PublicMining196, GAS_CAP, TOTAL_CAP } from './mining-196-public.mjs'

test('196 signed transaction rejects default 1952 domain and binds every field', async()=>{
  const account=privateKeyToAccount('0x'+'01'.repeat(32))
  const transaction={type:'legacy',chainId:196,nonce:0,gas:21000n,gasPrice:21000000n,to:account.address,value:0n,data:'0x'}
  const raw=await account.signTransaction(transaction)
  const expected={...transaction,from:account.address}
  await validateSignedMiningTransaction(raw,expected)
  await assert.rejects(validateSignedMiningTransaction(raw,{...expected,chainId:1952}))
  await assert.rejects(validateSignedMiningTransaction(raw,{...expected,value:1n}))
})
test('unapproved public plan fails before any RPC or signing',async()=>{
  const runner=new PublicMining196({root:'/unused',output:'/unused',rehearsal:{owner:'0x'+'01'.repeat(20),feeCap:'21000000'},approval:{},resolveArtifact:()=>{throw Error('unexpected')}})
  runner.rpc=()=>{throw Error('unexpected RPC')}
  await assert.rejects(runner.start(),/Approved exact 196/)
})
test('deployment signer rejects native value and business rows before opening a keystore',async()=>{
  const runner=new PublicMining196({root:'/unused',output:'/unused',rehearsal:{owner:'0x'+'01'.repeat(20),feeCap:'21000000'},approval:{}})
  await assert.rejects(runner.signIntent({value:1n}),/first 55/)
  runner.rows=Array(55).fill({})
  await assert.rejects(runner.signIntent({value:0n}),/first 55/)
})
test('budget reserves keeper residual, transfer gas and principal within total cap',()=>{
  assert.equal(TOTAL_CAP,2600000000000000n)
  assert.equal(GAS_CAP+11000000000n+441000000000n+(80000000000000n-70675227000000n),TOTAL_CAP)
})
