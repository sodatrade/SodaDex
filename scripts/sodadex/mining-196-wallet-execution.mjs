import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { keccak256, toHex } from 'viem'
import { PublicMining196, TOTAL_CAP } from './mining-196-public.mjs'
import { validateSignedMiningTransaction } from './mining-public-execution.mjs'

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const pause = () => new Promise(resolve => setTimeout(resolve, 1000))
export const NATIVE_CAP = 11000000000n
export const KEEPER_CAP = 80000000000000n

/** Explicit CLI execution only. The browser cannot call this module or obtain keys. */
export class Mining196WalletExecution {
  constructor({ root, file, deploymentJournal, rehearsal, approval, validateIntent, fabPrincipal, keeper }) {
    if (!deploymentJournal.publicTestContracts || deploymentJournal.chainId !== 196 ||
        deploymentJournal.phase !== 'deployment-and-inventory-complete' || deploymentJournal.pending ||
        deploymentJournal.failure || deploymentJournal.transactions.length !== 55 ||
        deploymentJournal.transactions.some(r => r.status !== '0x1') ||
        approval.approved !== true || approval.totalOwnerOutlayCapWei !== String(TOTAL_CAP) ||
        deploymentJournal.planHash !== approval.planHash || !same(deploymentJournal.owner,rehearsal.owner) || typeof validateIntent !== 'function' || typeof fabPrincipal !== 'function' ||
        !/^0x[0-9a-fA-F]{40}$/.test(keeper) || same(keeper, rehearsal.owner) || same(keeper, rehearsal.stack.signer))
      throw new Error('Complete approved public deployment and restricted validator required')
    this.file = file; this.owner = rehearsal.owner; this.keeper = keeper; this.validateIntent = validateIntent;this.fabPrincipal=fabPrincipal
    this.base = deploymentJournal; this.rpcClient = new PublicMining196({root, output:file, rehearsal, approval})
    this.state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {
      schemaVersion:1, chainId:196, planHash:approval.planHash, owner:this.owner, keeper,
      baseFeesWei:deploymentJournal.actualFeesWei, startNonce:String(BigInt(deploymentJournal.startNonce)+55n),
      gasWei:'0', nativeWei:'0', keeperFundingWei:'0', fabPrincipalRaw:'0', transactions:[], pending:null,
    }
    if (this.state.chainId !== 196 || this.state.planHash !== approval.planHash || !same(this.state.owner,this.owner) ||
        !same(this.state.keeper,keeper) || this.state.baseFeesWei !== deploymentJournal.actualFeesWei ||
        this.state.startNonce !== String(BigInt(deploymentJournal.startNonce)+55n)) throw new Error('Existing wallet ledger identity changed')
    this.assertBudget(0n,0n,0n)
  }
  save() {
    fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.state,null,2)+'\n',{mode:0o600})
    fs.renameSync(this.file+'.tmp',this.file)
  }
  assertBudget(gas, native, funding) {
    const s=this.state
    if (BigInt(s.nativeWei)+native>NATIVE_CAP || BigInt(s.keeperFundingWei)+funding>KEEPER_CAP ||
        BigInt(s.baseFeesWei)+BigInt(s.gasWei)+BigInt(s.nativeWei)+BigInt(s.keeperFundingWei)+gas+native+funding>TOTAL_CAP)
      throw new Error('196 total outlay or principal cap exceeded')
  }
  async execute(tx, purpose='wallet') {
    const lock=this.file+'.lock', descriptor=fs.openSync(lock,'wx',0o600)
    try {
      if(fs.existsSync(this.file) && JSON.stringify(JSON.parse(fs.readFileSync(this.file)))!==JSON.stringify(this.state))
        throw new Error('Wallet ledger changed; reload before preparing another intent')
      return await this.#executeLocked(tx,purpose)
    } finally { fs.closeSync(descriptor);fs.unlinkSync(lock) }
  }
  async #executeLocked(tx, purpose) {
    if (this.state.pending || this.state.failure) throw new Error('Reconcile retained pending/failure; never replay automatically')
    if (!['wallet','setup','keeper-funding'].includes(purpose) || !tx || typeof tx!=='object' ||
        Object.keys(tx).some(k=>!['from','to','data','value','chainId'].includes(k)) || !same(tx.from,this.owner) ||
        tx.chainId!==undefined && BigInt(tx.chainId)!==196n || !/^0x[0-9a-fA-F]{40}$/.test(tx.to) ||
        !/^0x(?:[0-9a-fA-F]{2})*$/.test(tx.data??'0x') || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(tx.value??'0x0'))
      throw new Error('Malformed or wrong-chain wallet intent')
    const value=BigInt(tx.value??'0x0'), data=tx.data??'0x'
    const fab=purpose==='keeper-funding'?0n:BigInt(this.fabPrincipal(tx,purpose))
    // Reserve 1 TEST-FAB for the separately budgeted backend miner purchase.
    if(fab<0n||BigInt(this.state.fabPrincipalRaw)+fab>669900000000n)throw new Error('TEST-FAB principal cap exceeded')
    const funding=purpose==='keeper-funding'?value:0n, native=purpose==='keeper-funding'?0n:value
    if (purpose==='keeper-funding') {
      if(!same(tx.to,this.keeper)||data!=='0x'||value!==KEEPER_CAP||BigInt(this.state.keeperFundingWei)!==0n)
        throw new Error('Only the single approved keeper funding is allowed')
    } else if (!await this.validateIntent({from:this.owner,to:tx.to,data,value:toHex(value)},purpose)) {
      throw new Error('Intent is outside the isolated test acceptance')
    }
    const rpc=(m,p)=>this.rpcClient.rpc(m,p), nonce=BigInt(this.state.startNonce)+BigInt(this.state.transactions.length)
    // A canonical final block fixes its entire ancestry, including earlier cost receipts.
    await this.checkAnchor(this.base.transactions.at(-1).receipt)
    if(this.state.transactions.length)await this.checkAnchor(this.state.transactions.at(-1).receipt)
    if(await rpc('eth_chainId')!=='0xc4' || BigInt(await rpc('eth_getTransactionCount',[this.owner,'latest']))!==nonce ||
        BigInt(await rpc('eth_getTransactionCount',[this.owner,'pending']))!==nonce) throw new Error('Chain/nonce drift')
    const call={from:this.owner,to:tx.to,data,value:toHex(value)}
    await rpc('eth_call',[call,'pending'])
    const estimate=BigInt(await rpc('eth_estimateGas',[call,'pending']))
    const gas=purpose==='keeper-funding'?21000n:(estimate*120n+99n)/100n, price=21000000n
    if(gas<estimate)throw new Error('Funding is no longer a plain native transfer')
    this.assertBudget(gas*price,native,funding)
    await this.rpcClient.checkFeeModel(BigInt(data.length/2+256),gas)
    if(BigInt(await rpc('eth_getBalance',[this.owner,'pending']))<value+gas*price)throw new Error('Insufficient balance')
    const raw=await this.signIntent({nonce,gas,price,value,to:tx.to,data})
    const hash=await validateSignedMiningTransaction(raw,{from:this.owner,to:tx.to,data,value,nonce,gas,gasPrice:price,chainId:196})
    await this.rpcClient.checkFeeModel(BigInt((raw.length-2)/2),gas)
    this.state.pending={hash,purpose,nonce:String(nonce),to:tx.to,dataKeccak256:keccak256(data),value:String(value),fabPrincipalRaw:String(fab),gas:String(gas),submission:'unknown'}
    this.save()
    if(!same(await rpc('eth_sendRawTransaction',[raw]),hash))throw new Error('Unknown submission; retain pending hash')
    this.state.pending.submission='broadcast';this.save()
    let receipt
    for(let i=0;i<180;i++) {
      receipt=await rpc('eth_getTransactionReceipt',[hash])
      if(receipt&&BigInt(await rpc('eth_blockNumber'))>BigInt(receipt.blockNumber))break
      receipt=null;await pause()
    }
    if(!receipt)throw new Error('Pending receipt retained')
    const block=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]), again=await rpc('eth_getTransactionReceipt',[hash])
    if(!again||again.blockHash!==receipt.blockHash||block.hash!==receipt.blockHash||!same(receipt.from,this.owner)||
        !same(receipt.to,tx.to)||!same(receipt.transactionHash,hash)||BigInt(receipt.gasUsed)>gas||BigInt(receipt.effectiveGasPrice)!==price)
      throw new Error('Receipt identity changed; retain pending')
    const extra=BigInt(receipt.l1Fee??0)+BigInt(receipt.operatorFee??0), paid=BigInt(receipt.gasUsed)*price+extra
    this.state.gasWei=String(BigInt(this.state.gasWei)+paid)
    if(receipt.status==='0x1') {
      this.state.nativeWei=String(BigInt(this.state.nativeWei)+native)
      this.state.keeperFundingWei=String(BigInt(this.state.keeperFundingWei)+funding)
      this.state.fabPrincipalRaw=String(BigInt(this.state.fabPrincipalRaw)+fab)
    }
    this.state.transactions.push({...this.state.pending,receipt,feeWei:String(paid)})
    this.state.pending=null
    if(receipt.status!=='0x1'||extra!==0n||BigInt(receipt.operatorFeeScalar??0)!==0n||BigInt(receipt.operatorFeeConstant??0)!==0n)
      this.state.failure='Failed receipt or changed fee model; stop and reconcile'
    this.save();this.assertBudget(0n,0n,0n)
    if(this.state.failure)throw new Error(this.state.failure)
    return hash
  }
  async checkAnchor(saved) {
    if(!saved)throw new Error('Missing settled receipt anchor')
    const live=await this.rpcClient.rpc('eth_getTransactionReceipt',[saved.transactionHash])
    const header=await this.rpcClient.rpc('eth_getBlockByNumber',[saved.blockNumber,false])
    const fields=['transactionHash','blockHash','blockNumber','status','gasUsed','effectiveGasPrice','l1Fee','operatorFee','operatorFeeScalar','operatorFeeConstant']
    if(!live||!header||header.hash!==saved.blockHash||fields.some(k=>(live[k]??'0x0')!==(saved[k]??'0x0')))
      throw new Error('Settled cost anchor changed; reconcile before another transaction')
  }
  async signIntent({nonce,gas,price,value,to,data}) {
    const folder=path.join(os.homedir(),'.local/share/sodadex/wallets/xlayer-test-owner')
    return execFileSync('cast',['mktx','--rpc-url','https://rpc.ignix.bot/rpc/196','--chain','196','--legacy',
      '--nonce',String(nonce),'--gas-limit',String(gas),'--gas-price',String(price),'--value',String(value),
      '--keystore',path.join(folder,'owner'),'--password-file',path.join(folder,'password'),to,data],
      {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
  }
}
