import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {encodeFunctionData,encodeAbiParameters,keccak256,parseAbi} from 'viem'
const bundle=await build({entryPoints:['scripts/sodadex/mining-196-wallet-policy.ts'],bundle:true,platform:'node',format:'esm',write:false})
const {wallet196Policy}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64'))
const names=['fab','mining','circuits','circuitMarket','nftFactory','manager','launchFactory','registry','miningFactory','farm','router','v2Factory','wrappedNative','v2Locker','liquidityHelper','fragmentVault','fragmentPool','minerBuyer']
const addr=n=>'0x'+n.toString(16).padStart(40,'0'),owner=addr(100),signer=addr(101)
const contracts=Object.fromEntries(names.map((name,i)=>[name,{address:addr(i+1),runtimeKeccak256:keccak256('0x00')}]))
const d={schemaVersion:1,chainId:196,profileId:'196-mining-test',state:'ready',version:'test196-1',genesisBlock:'1',templateId:0,contracts,projects:[],testListingIds:[],localOnly:false,publicDeployment:true}
const rpc={request:async m=>m==='eth_getCode'?'0x00':encodeAbiParameters([{type:'uint256'}],[1n])}
const policy=wallet196Policy(d,rpc,owner,signer)
const call=(role,sig,args,value='0x0')=>({from:owner,to:contracts[role].address,data:encodeFunctionData({abi:parseAbi([sig]),functionName:sig.match(/function (\w+)/)[1],args}),value})
test('only exact tiny native/FAB seed is accepted for operator setup',async()=>{
  const tx=call('router','function addLiquidityETH(address,uint256,uint256,uint256,address,uint256)',[contracts.fab.address,100000000000n,100000000000n,10000000000n,owner,BigInt(Math.floor(Date.now()/1000)+600)],'0x2540be400')
  assert.equal(await policy.validate(tx,'setup'),true)
  assert.equal(policy.fabPrincipal(tx,'setup'),100000000000n)
  assert.equal(await policy.validate({...tx,value:'0x2540be401'},'setup'),false)
  assert.equal(await policy.validate({...tx,data:tx.data+'00'},'setup'),false)
})
test('arbitrary recipient, token transfer and unlimited approvals are denied',async()=>{
  const approve=call('fab','function approve(address,uint256)',[contracts.manager.address,670000000000n])
  assert.equal(await policy.validate(approve,'wallet'),true)
  assert.equal(await policy.validate({...approve,from:addr(999)},'wallet'),false)
  assert.equal(await policy.validate(call('fab','function approve(address,uint256)',[contracts.manager.address,(1n<<256n)-1n]),'wallet'),false)
  assert.equal(await policy.validate(call('fab','function transfer(address,uint256)',[owner,1n]),'wallet'),false)
})
test('non-FAB approval cannot exceed current owned balance',async()=>{
  const tx=call('fragmentVault','function approve(address,uint256)',[contracts.fragmentPool.address,2n])
  assert.equal(await policy.validate(tx,'wallet'),false)
})
test('FAB input principal includes fragment swap and liquidity supply',()=>{
  assert.equal(policy.fabPrincipal(call('fragmentPool','function swapExactIn(bool,uint256,uint256,uint256)',[false,1000n,1n,9999999999n]),'wallet'),1000n)
  assert.equal(policy.fabPrincipal(call('fragmentPool','function addLiquidity(uint256,uint256,uint256,uint256,uint256)',[10n,20n,1n,1n,9999999999n]),'wallet'),20n)
})
test('market listing uses the compiled uint96 price selector and rejects uint256 alias',async()=>{
  const {sourceArtifact}=await import('./mining-plan-artifacts.mjs')
  const abi=sourceArtifact(process.cwd(),'CircuitMarket').value.abi
  const data=encodeFunctionData({abi,functionName:'list',args:[contracts.circuits.address,3n,1000000n]})
  assert.equal(await policy.validate({from:owner,to:contracts.circuitMarket.address,data,value:'0x0'},'setup'),true)
  assert.equal(await policy.validate(call('circuitMarket','function list(address,uint256,uint256)',[contracts.circuits.address,3n,1000000n]),'setup'),false)
})
