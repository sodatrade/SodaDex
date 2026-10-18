import { decodeFunctionData, encodeFunctionData, keccak256, parseAbi, type Address, type Hex } from 'viem'
import { miningAbi, miningTargets, validMiningProductCall, sameMiningAddress } from '../../standalone/mining-calls'
import { verifyMiningBase, resolveMiningProject, miningDiscoveryRead, type MiningDiscoveryRpc } from '../../standalone/mining-discovery'
import type { MiningProductDeployment } from '../../standalone/mining-products'

const setupAbi=parseAbi([
  'function approve(address,uint256) returns(bool)',
  'function addLiquidityETH(address,uint256,uint256,uint256,address,uint256) payable returns(uint256,uint256,uint256)',
  'function list(address,uint256,uint256) returns(uint256)',
])
type Tx={from:Address;to:Address;data:Hex;value:Hex}
/** CLI policy for the exact single-project 196 acceptance. Never accepts browser roots. */
export function wallet196Policy(initial:MiningProductDeployment,rpc:MiningDiscoveryRpc,owner:Address,signer:Address) {
  let deployment=initial
  const c=initial.contracts,eq=sameMiningAddress
  const read=(to:Address,signature:string,args:readonly unknown[]=[])=>miningDiscoveryRead(rpc,to,signature,args)
  function decode(tx:Tx,purpose:string) {
    const target=miningTargets(deployment).find(t=>eq(t.identity.address,tx.to))
    if(!target?.write)return null
    try{
      const abi=purpose==='setup'?setupAbi:miningAbi(target.write,'write')
      const result=decodeFunctionData({abi,data:tx.data})
      if(encodeFunctionData({abi,functionName:result.functionName,args:result.args}).toLowerCase()!==tx.data.toLowerCase())return null
      return result
    }catch{return null}
  }
  function fabPrincipal(tx:Tx,purpose:string):bigint {
    const decoded=decode(tx,purpose);if(!decoded)return 0n
    const a=decoded.args as readonly unknown[],name=decoded.functionName
    if(eq(tx.to,c.manager.address)&&name==='buy')return a[1] as bigint
    if(eq(tx.to,c.router.address)&&name==='addLiquidityETH')return a[1] as bigint
    if(eq(tx.to,c.router.address)&&name==='swapExactTokensForTokensSupportingFeeOnTransferTokens'&&eq((a[2] as Address[])[0],c.fab.address))return a[0] as bigint
    if(eq(tx.to,c.fragmentPool.address)&&name==='addLiquidity')return a[1] as bigint
    if(eq(tx.to,c.fragmentPool.address)&&name==='swapExactIn'&&a[0]===false)return a[1] as bigint
    if(eq(tx.to,c.liquidityHelper.address)&&name==='addLiquidity')return a[2] as bigint
    return 0n
  }
  async function validate(tx:Tx,purpose:string):Promise<boolean> {
    if(!eq(tx.from,owner))return false
    const decoded=decode(tx,purpose);if(!decoded)return false
    const a=decoded.args as readonly unknown[],name=decoded.functionName,value=BigInt(tx.value)
    if(purpose==='setup') {
      const deadline=(v:unknown)=>typeof v==='bigint'&&v>BigInt(Math.floor(Date.now()/1000))&&v<=BigInt(Math.floor(Date.now()/1000)+3600)
      const seedApproval=eq(tx.to,c.fab.address)&&name==='approve'&&eq(a[0] as Address,c.router.address)&&a[1]===100000000000n&&value===0n
      const seed=eq(tx.to,c.router.address)&&name==='addLiquidityETH'&&eq(a[0] as Address,c.fab.address)&&a[1]===100000000000n&&a[2]===100000000000n&&a[3]===10000000000n&&eq(a[4] as Address,owner)&&deadline(a[5])&&value===10000000000n
      const nftApproval=eq(tx.to,c.circuits.address)&&name==='approve'&&eq(a[0] as Address,c.circuitMarket.address)&&[3n,5n].includes(a[1] as bigint)&&value===0n
      const list=eq(tx.to,c.circuitMarket.address)&&name==='list'&&eq(a[0] as Address,c.circuits.address)&&[3n,5n].includes(a[1] as bigint)&&a[2]===1000000n&&value===0n
      if(!seedApproval&&!seed&&!nftApproval&&!list)return false
    } else if(purpose!=='wallet'||!validMiningProductCall(tx,deployment,true))return false
    const target=miningTargets(deployment).find(t=>eq(t.identity.address,tx.to))!
    const code=await rpc.request('eth_getCode',[tx.to,'latest'])
    if(typeof code!=='string'||keccak256(code as Hex)!==target.identity.runtimeKeccak256)return false
    if(name==='approve') {
      const amount=a[1] as bigint
      if(eq(tx.to,c.circuits.address)) {
        if(![3n,4n,5n].includes(amount)||!eq(await read(tx.to,'function ownerOf(uint256) view returns(address)',[amount]) as Address,owner))return false
      } else {
        if(amount<0n||amount>=((1n<<256n)-1n))return false
        if(eq(tx.to,c.fab.address)){if(amount>670000000000n)return false}
        else if(amount>(await read(tx.to,'function balanceOf(address) view returns(uint256)',[owner]) as bigint))return false
      }
    }
    return true
  }
  return {validate,fabPrincipal,validBrowserCall:validMiningProductCall,get deployment(){return deployment},
    verify:()=>verifyMiningBase(rpc,deployment,signer),
    async refreshProject(token:Address) {
      const block=await verifyMiningBase(rpc,initial,signer)
      const project=await resolveMiningProject(rpc,initial,token,signer,block)
      if(deployment.projects.length&&!eq(deployment.projects[0].token.address,token))throw new Error('Only one acceptance project is approved')
      deployment={...initial,projects:[project]};return deployment
    },
  }
}
