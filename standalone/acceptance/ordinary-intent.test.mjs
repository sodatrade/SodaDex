import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { assertAcceptanceBudget, assertAcceptanceProgress, assertNextIntent, canonicalIntentData } from './ordinary-intent.mjs'
const require=createRequire(new URL('../web/package.json',import.meta.url)),v=require('viem')
const owner='0x6ecf746b078d46391f8C425B150153212F7C0545',target='0x1f85377930011B701dd2940c526e32FD3aDaB730'
const abi=v.parseAbi(['function multicall(bytes[]) payable returns(bytes[])','function modifyLiquidities(bytes,uint256) payable','function execute(bytes,bytes[],uint256) payable','function approve(address,address,uint160,uint48)'])
const modify=(bytes,deadline)=>v.encodeFunctionData({abi,functionName:'modifyLiquidities',args:[bytes,deadline]})
const multi=data=>v.encodeFunctionData({abi,functionName:'multicall',args:[[data]]})
test('only the dynamic deadline changes; nested V4 action bytes remain exact',()=>{
 const step={to:target,value:'10',data:multi(modify('0x1234',100n))},tx={from:owner,to:target,value:'0xa',chainId:'0xc4',data:multi(modify('0x1234',1500n))}
 assert.doesNotThrow(()=>assertNextIntent(tx,step,owner,1000n))
 assert.throws(()=>assertNextIntent({...tx,data:multi(modify('0x1235',1500n))},step,owner,1000n))
 for(const changed of[{value:'11'},{from:target},{to:owner},{chainId:'0x1'},{nonce:'0x1'},{gasPrice:'0x1'}])assert.throws(()=>assertNextIntent({...tx,...changed},step,owner,1000n))
})
test('expired or long-lived deadlines are rejected before matching',()=>{
 for(const deadline of[1000n,999n,1601n])assert.throws(()=>canonicalIntentData(modify('0x1234',deadline),1000n))
})
test('trailing ABI bytes cannot be hidden by time normalization',()=>{
 assert.throws(()=>canonicalIntentData(modify('0x1234',1500n)+'00',1000n))
})
test('V3 mint binds amounts, recipient and pool while accepting a fresh deadline',()=>{
 const mintAbi=v.parseAbi(['function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns(uint256,uint128,uint256,uint256)'])
 const input={token0:owner,token1:target,fee:500,tickLower:-10,tickUpper:10,amount0Desired:10n,amount1Desired:10n,amount0Min:9n,amount1Min:9n,recipient:owner,deadline:1500n}
 const encode=x=>v.encodeFunctionData({abi:mintAbi,functionName:'mint',args:[x]})
 const expected=canonicalIntentData(encode(input),1000n)
 assert.equal(expected,canonicalIntentData(encode({...input,deadline:1501n}),1000n))
 for(const change of[{recipient:target},{amount0Desired:11n},{amount0Min:8n},{fee:3000},{tickLower:-20}])assert.notEqual(expected,canonicalIntentData(encode({...input,...change}),1000n))
})
test('Router recipient/commands/limits bytes cannot change with its deadline',()=>{
 const encode=(commands,inputs,deadline)=>v.encodeFunctionData({abi,functionName:'execute',args:[commands,inputs,deadline]})
 const expected=canonicalIntentData(encode('0x00',['0x1234'],1500n),1000n)
 assert.equal(expected,canonicalIntentData(encode('0x00',['0x1234'],1501n),1000n))
 assert.notEqual(expected,canonicalIntentData(encode('0x00',['0x1235'],1500n),1000n))
 assert.notEqual(expected,canonicalIntentData(encode('0x01',['0x1234'],1500n),1000n))
})
test('Permit2 changes only expiration; spender, token and amount remain bound',()=>{
 const encode=(spender,amount,expiry)=>v.encodeFunctionData({abi,functionName:'approve',args:[owner,spender,amount,expiry]})
 const expected=canonicalIntentData(encode(target,100n,1500),1000n)
 assert.equal(expected,canonicalIntentData(encode(target,100n,1501),1000n))
 assert.notEqual(expected,canonicalIntentData(encode(target,101n,1500),1000n))
 assert.notEqual(expected,canonicalIntentData(encode(owner,100n,1500),1000n))
})
test('gas, gross native inputs, token inputs and total caps are independent stops',()=>{
 const state={gasSpentWei:'60',nonGasSpentWei:'10',fabSpentRaw:'80'},step={plannedGasLimit:'10',value:'5',maximumFabSpendRaw:'10'}
 const caps={maxGasPriceWei:'3',gasCapWei:'90',nonGasCapWei:'15',totalCapWei:'105',maxTestTokenApprovalsRaw:'90'}
 assert.doesNotThrow(()=>assertAcceptanceBudget(state,step,3n,caps))
 for(const changed of[{gasCapWei:'89'},{nonGasCapWei:'14'},{totalCapWei:'104'},{maxTestTokenApprovalsRaw:'89'}])assert.throws(()=>assertAcceptanceBudget(state,step,3n,{...caps,...changed}))
 assert.throws(()=>assertAcceptanceBudget(state,step,4n,caps))
 // A withdrawal cannot reopen the gross-input allowance recorded in the journal.
 assert.throws(()=>assertAcceptanceBudget({...state,nonGasSpentWei:'15'},step,1n,caps))
})
test('pending, uncertain, reverted and changed nonce states cannot advance',()=>{
 const plan={startNonce:168,rows:[{},{}]},state={rows:[{status:'success'}],pending:null,stopped:false}
 assert.doesNotThrow(()=>assertAcceptanceProgress(state,plan,169,169))
 for(const changed of[{pending:{hash:'0x1234'}},{stopped:true},{rows:[{status:'reverted'}]}])assert.throws(()=>assertAcceptanceProgress({...state,...changed},plan,169,169))
 assert.throws(()=>assertAcceptanceProgress(state,plan,170,170))
 assert.throws(()=>assertAcceptanceProgress(state,plan,169,170))
})
