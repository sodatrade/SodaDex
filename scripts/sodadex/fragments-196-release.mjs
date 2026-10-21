// Exports only verified public TEST identities; never accepts local-fork addresses.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
const require=createRequire(new URL('../../standalone/web/package.json',import.meta.url))
const {createPublicClient,http,keccak256}=require('viem')
const root=path.resolve(import.meta.dirname,'../..'),folder=path.join(root,'deployments/xlayer-196-fragments-test')
const journal=process.argv.includes('--pool-v3')?'pool-v3/public-journal.json':'public-journal.json'
const run=JSON.parse(fs.readFileSync(path.join(folder,journal)))
if((!run.completed&&!run.deploymentVerified)||!run.publicDeployed||run.localOnly||run.pending||run.productionTouched||run.chainId!==196||run.rows.some(row=>row.status!=='success'))throw Error('Completed public TEST journal required')
const client=createPublicClient({transport:http('https://rpc.ignix.bot/rpc/196')})
if(await client.getChainId()!==196)throw Error('Wrong chain')
const old=JSON.parse(fs.readFileSync(path.join(root,'deployments/xlayer-196-mining-test/public-2026-10-18/addresses.json'))).contracts
const integration={testDependencies:Object.fromEntries(['fab','mining','circuits','nftFactory'].map(k=>[k,old[k]])),rpcUrl:'https://rpc.ignix.bot/rpc/196',chainId:196,environment:'independent-test',status:run.completed?'ACCEPTED':'ACCEPTANCE_PENDING',journal,productionTouched:false,owner:run.owner,treasury:run.treasury,fromBlock:run.rows[0].blockNumber,contracts:{}}
for(const [name,identity]of Object.entries(run.contracts)){
 if(keccak256(await client.getCode({address:identity.address,blockNumber:BigInt(run.rows.at(-1).blockNumber)}))!==identity.runtimeHash)throw Error(`Runtime mismatch ${name}`)
 const a=JSON.parse(fs.readFileSync(path.join(os.homedir(),`XTruthWorkspace/contract/out/${name}.sol/${name}.json`)))
 integration.contracts[name]={...identity,abi:a.abi}
}
const manifest={chainId:196,pool:run.contracts.SodaPool.address,vault:run.contracts.SodaVault.address,policy:run.contracts.SodaPolicy.address,rewards:run.contracts.IgnixLpRewards.address,locker:run.contracts.SodaLocker.address,fromBlock:run.rows[0].blockNumber}
for(const[file,value]of[['integration.json',integration],['frontend-manifest.json',manifest]])fs.writeFileSync(path.join(folder,file),JSON.stringify(value,null,2)+'\n')
const build=spawnSync('npm',['run','build'],{cwd:path.join(root,'standalone/web'),stdio:'inherit',env:{...process.env,VITE_SODADEX_NETWORK_PROFILE:'196-test',VITE_SODADEX_FRAGMENTS_DEPLOYMENT:JSON.stringify(manifest),SODADEX_WEB_MOUNT:'/'}})
if(build.status!==0)throw Error('Frontend build failed')
const config=JSON.parse(fs.readFileSync(path.join(root,'standalone/worker/wrangler.jsonc')))
if(config.name!=='sodadex-preview')throw Error('Not TEST site')
config.alias={...(config.alias??{}),viem:'./node_modules/viem/_esm/index.js'}
config.vars={SODADEX_MINING_MOUNT:'disabled',SODADEX_FRAGMENTS_DEPLOYMENT:JSON.stringify(manifest)}
fs.writeFileSync(path.join(root,'standalone/worker/wrangler.fragments-196-test.jsonc'),JSON.stringify(config,null,2)+'\n')
console.log(JSON.stringify({verified:true,manifest,publication:'Ready for wrangler deploy --config wrangler.fragments-196-test.jsonc'}))
