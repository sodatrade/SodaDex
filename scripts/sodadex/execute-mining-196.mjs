#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { PublicMining196 } from './mining-196-public.mjs'
import { load196Artifacts } from './mining-196-artifacts.mjs'
import { prepare196Stack } from './mining-196-stack.mjs'
import { prepareMiningNfts } from './mining-plan-nfts.mjs'
import { fileSha } from './mining-plan-artifacts.mjs'
import { keccak256 } from 'viem'

const { values:v } = parseArgs({options:{root:{type:'string'},rehearsal:{type:'string'},artifacts:{type:'string'},approval:{type:'string'},journal:{type:'string'},'execute-196-test':{type:'boolean',default:false}}})
for(const key of ['root','rehearsal','artifacts','approval','journal']) if(!v[key]) throw new Error(`Required --${key}`)
const rehearsal=JSON.parse(fs.readFileSync(v.rehearsal)),approval=JSON.parse(fs.readFileSync(v.approval))
if(!v['execute-196-test']) { console.log(JSON.stringify({broadcast:false,planHash:fileSha(JSON.stringify(rehearsal)),transactions:55,remainingBusinessOperations:54}));process.exit(0) }
const {resolve}=load196Artifacts(v.artifacts)
const runner=new PublicMining196({root:path.resolve(v.root),output:path.resolve(v.journal),rehearsal,resolveArtifact:resolve,approval})
try {
  await runner.start()
  const reuse=Object.fromEntries(Object.entries(rehearsal.reuseProof).map(([role,item])=>[role,item.address]))
  await prepare196Stack(runner,v.root,rehearsal.stack.signer,resolve,reuse)
  await prepareMiningNfts(runner,v.root,runner.stack)
  if(runner.rows.length!==55) throw new Error('Incomplete deployment/inventory boundary')
  for(const [name,record] of Object.entries(runner.contracts)) {
    const expected=rehearsal.contracts[name]
    if(!expected || expected.address.toLowerCase()!==record.address.toLowerCase() || expected.runtimeKeccak256!==record.runtimeKeccak256) throw new Error(`Public runtime differs from final rehearsal: ${name}`)
  }
  const template=JSON.parse(fs.readFileSync(v.rehearsal+'.deployment.json'))
  for(const [role,identity] of Object.entries(template.contracts)) {
    const verify=async id=>{if(keccak256(await runner.rpc('eth_getCode',[id.address,'latest']))!==id.runtimeKeccak256)throw new Error(`Public identity mismatch: ${role}`)}
    await verify(identity)
    if(identity.implementation) {
      await verify(identity.implementation)
      const word=await runner.rpc('eth_getStorageAt',[identity.address,'0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc','latest'])
      if(word.slice(-40).toLowerCase()!==identity.implementation.address.slice(2).toLowerCase())throw new Error('Public proxy binding mismatch')
    }
    if(identity.beacon){await verify(identity.beacon);await verify(identity.beacon.implementation)
      if((await runner.call(identity.beacon.address,'function implementation() view returns(address)')).toLowerCase()!==identity.beacon.implementation.address.toLowerCase())throw new Error('Public beacon implementation mismatch')}
  }
  const manifest={...template,version:`test196-${BigInt(runner.rows[0].blockNumber)}`,genesisBlock:String(BigInt(runner.rows[0].blockNumber)),projects:[],testListingIds:[],localOnly:false,publicDeployment:true}
  fs.writeFileSync(v.journal+'.deployment.json',JSON.stringify(manifest,null,2)+'\n')
  runner.phase='deployment-and-inventory-complete';runner.save()
  console.log(JSON.stringify({chainId:196,testOnly:true,transactions:55,actualGasWei:String(runner.actualFees),publicManifest:v.journal+'.deployment.json',businessAcceptance:'pending frontend and keeper'}))
} catch(error) {
  runner.failure=error instanceof Error?error.message:String(error)
  if(runner.journalOwned)runner.save()
  console.error(runner.failure);process.exitCode=1
}
