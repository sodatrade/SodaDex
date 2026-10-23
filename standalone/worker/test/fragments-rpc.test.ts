import { describe, expect, it, vi } from 'vitest'
import { encodeFunctionData, parseAbi } from 'viem'
import { fragmentsRpc, fragmentManifest, validFragmentRpc } from '../src/fragments-rpc'
import { poolAbi, tokenAbi, ignixIncomeAbi, mirrorVaultAbi } from '../../web/src/fragments/abi'
const pool='0x1111111111111111111111111111111111111111',vault='0x2222222222222222222222222222222222222222',rewards='0x3333333333333333333333333333333333333333',user='0x4444444444444444444444444444444444444444'
const manifest={chainId:196,pool,vault,rewards}
describe('fragment RPC deployment boundary',()=>{
 it('only exposes reads for the manifest-bound IGNIX income account',()=>{
  const income='0x5555555555555555555555555555555555555555', m={...manifest,income,ignixTreasury:user}
  const data=encodeFunctionData({abi:ignixIncomeAbi,functionName:'RECIPIENT'})
  expect(validFragmentRpc('eth_call',[{to:income,data},'latest'],m)).toBe(true)
  expect(validFragmentRpc('eth_call',[{to:income,data},'latest'],manifest)).toBe(false)
  expect(validFragmentRpc('eth_call',[{to:user,data},'latest'],m)).toBe(false)
  const claim=encodeFunctionData({abi:parseAbi(['function claimLpFab() returns(uint256)']),functionName:'claimLpFab'})
  expect(validFragmentRpc('eth_call',[{from:user,to:income,data:claim},'latest'],m)).toBe(false)
  expect(fragmentManifest(JSON.stringify({...manifest,income}))).toBeUndefined()
 })
 it('accepts quotes and pending simulation for this pool only',()=>{
  const data=encodeFunctionData({abi:poolAbi,functionName:'quote',args:[false,1n]})
  expect(validFragmentRpc('eth_call',[{to:pool,data},'latest'],manifest)).toBe(true)
  expect(validFragmentRpc('eth_call',[{to:user,data},'latest'],manifest)).toBe(false)
  const swap=encodeFunctionData({abi:poolAbi,functionName:'swap',args:[false,1n,1n,999999n]})
  expect(validFragmentRpc('eth_estimateGas',[{from:user,to:pool,data:swap,value:'0x1'},'pending'],manifest)).toBe(true)
  expect(validFragmentRpc('eth_call',[{from:user,to:pool,data:swap},'latest',{}],manifest)).toBe(false)
 })
 it('rejects signing, broadcast, foreign approvals and malformed manifests',()=>{
  expect(validFragmentRpc('eth_sendRawTransaction',['0x00'],manifest)).toBe(false)
  const data=encodeFunctionData({abi:tokenAbi,functionName:'approve',args:[user,1n]})
  expect(validFragmentRpc('eth_call',[{from:user,to:vault,data},'latest'],manifest)).toBe(false)
  expect(fragmentManifest(JSON.stringify({...manifest,chainId:1952}))).toBeUndefined()
 })
 it('allows MirrorVault views on the bound vault, never its writes',()=>{
  const read=encodeFunctionData({abi:mirrorVaultAbi,functionName:'totalEligibleWeight'})
  expect(validFragmentRpc('eth_call',[{to:vault,data:read},'latest'],manifest)).toBe(true)
  expect(validFragmentRpc('eth_call',[{to:user,data:read},'latest'],manifest)).toBe(false)
  const write=encodeFunctionData({abi:parseAbi(['function finalizeRedeem(uint256) returns(uint256)']),functionName:'finalizeRedeem',args:[1n]})
  expect(validFragmentRpc('eth_call',[{from:user,to:vault,data:write},'latest'],manifest)).toBe(false)
 })
 it('bounds history and prevents state override',()=>{
  expect(validFragmentRpc('eth_getLogs',[{address:pool,fromBlock:'0x0',toBlock:'0x7d0',topics:[]}],manifest)).toBe(true)
  expect(validFragmentRpc('eth_getLogs',[{address:pool,fromBlock:'0x0',toBlock:'0x7d1',topics:[]}],manifest)).toBe(false)
 })
 it('uses the fixed RPC and does not forward the browser Origin',async()=>{
  const upstream=vi.fn().mockResolvedValue(Response.json({jsonrpc:'2.0',id:1,result:'0xc4'}))
  const req=new Request('https://test.example/api/fragments/rpc',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://test.example'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId'})})
  expect((await fragmentsRpc(req,JSON.stringify(manifest),upstream)).status).toBe(200)
  expect(upstream.mock.calls[0][0]).toBe('https://rpc.ignix.bot/rpc/196')
  expect(upstream.mock.calls[0][1].headers).not.toHaveProperty('Origin')
  expect(JSON.parse(upstream.mock.calls[0][1].body).params).toEqual([])
 })
})
