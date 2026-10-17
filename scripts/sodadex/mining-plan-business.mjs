// Stateful acceptance against the hard-coded local fork only. No public signer/broadcaster.
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { decodeEventLog, encodeAbiParameters, encodeFunctionData, keccak256, parseAbiParameters, stringToHex } from 'viem'
import { productArtifact, sourceArtifact } from './mining-plan-artifacts.mjs'
import { curveOutput, liquidityAmounts } from '../../standalone/mining-math.ts'

const FAB = 100_000_000n, A = 10n ** 18n
const ceil = (a, b) => (a + b - 1n) / b
const minimum = (q) => { if (q <= 1n) throw new Error('Quote too small'); return q * 995n / 1000n }
const same = (a, b) => a.toLowerCase() === b.toLowerCase()

export async function exerciseMiningProducts(plan, root, s) {
  if (!plan.miners || plan.business) throw new Error('Business rehearsal requires prepared miners and a fresh business state')
  const pabi = (name) => productArtifact(root, name).value.abi
  const managerAbi = pabi('IgnixManager'), farmAbi = pabi('FabMiningFarm'), vaultAbi = pabi('MiningProjectVault')
  const marketAbi = sourceArtifact(root, 'CircuitMarket').value.abi
  const tx = (label, address, abi, name, args) => plan.send(label, address, encodeFunctionData({ abi, functionName: name, args }))
  const now = async () => BigInt((await plan.rpc('eth_getBlockByNumber', ['pending', false])).timestamp)
  const deadline = async () => await now() + 600n
  const bal = (address, account = plan.owner) => plan.call(address, 'function balanceOf(address) view returns(uint256)', [account])
  const approve = (address, spender, amount) => plan.write('Bounded test asset approval', address, 'function approve(address,uint256) returns(bool)', [spender, amount])
  const sign = (digest, raw) => {
    const folder = path.join(os.homedir(), '.local/share/sodadex/wallets/xlayer-1952-mining-authorizer')
    const args = ['wallet', 'sign', '--keystore', path.join(folder, 'authorizer'), '--password-file', path.join(folder, 'password'), ...(raw ? ['--no-hash'] : []), digest]
    const signature = execFileSync('cast', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('Invalid local admission signature')
    return signature
  }
  const event = (receipt, address, abi, name) => {
    for (const log of receipt.logs.filter((l) => same(l.address, address))) {
      try { const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics }); if (decoded.eventName === name) return decoded.args } catch {}
    }
    throw new Error(`Missing event ${name}`)
  }
  let fabPrincipal = 0n, nativePrincipal = 0n
  const spend = (fab = 0n, native = 0n) => {
    fabPrincipal += fab; nativePrincipal += native
    if (fabPrincipal > 10_000n * FAB || nativePrincipal > 1_000_000_000_000_000n) throw new Error('Test principal limit exceeded')
    plan.businessPrincipal = { fabRaw: String(fabPrincipal), nativeWei: String(nativePrincipal) }; plan.save()
  }
  const check = (value, message) => { if (!value) throw new Error(message) }
  const curveQuote = async (token, buy, amount) => {
    const st = await plan.readAbi(s.manager, managerAbi, 'tokens', [token])
    const snipe = await plan.call(s.manager, 'function snipeBpsNow(address) view returns(uint256)', [token])
    return curveOutput({ buyFee: BigInt(st[1]), sellFee: BigInt(st[2]), buyTax: BigInt(st[3]), sellTax: BigInt(st[4]),
      snipe, vQuote: st[9], vToken: st[10], sold: st[11], sellable: st[13] }, buy, amount)
  }
  const seedFab = 1000n * FAB, seedNative = 100_000_000_000_000n
  spend(seedFab, seedNative)
  await approve(s.fab, s.router, seedFab)
  await plan.write('Seed real TEST FAB/native liquidity', s.router,
    'function addLiquidityETH(address,uint256,uint256,uint256,address,uint256) payable returns(uint256,uint256,uint256)',
    [s.fab, seedFab, seedFab, seedNative, plan.owner, await deadline()], seedNative)
  const create = managerAbi.find((i) => i.name === 'createToken'), zero = `0x${'0'.repeat(64)}`
  const p = { name: 'SodaDEX TEST FAB Mining', symbol: 'TEST-A', metadataURI: '', salt: keccak256(stringToHex('sodadex-1952-mining-phase2-v1')),
    quote: s.fab, graduation: 5000n * FAB, buyFeeBps: 100, sellFeeBps: 100, taxBuyBps: 100, taxSellBps: 100,
    snipeStartBps: 0, snipeMins: 0, listingFee: 0n, firstBuy: 0n, founderBps: 0, founderSecs: 0, founderRoot: zero }
  const data = encodeAbiParameters(parseAbiParameters('uint16,uint16,uint16,uint16'), [100, 100, 100, 0])
  const expiry = await now() + 3600n
  const payload = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }, { type: 'address' }, create.inputs[0],
    ...parseAbiParameters('uint16,bytes,uint64,address,uint8,uint64,uint24,address')],
  [1952n, s.manager, plan.owner, p, 0, data, expiry, s.miningFactory, 1, 86400n, 0, s.launchFactory]))
  const launched = await tx('Signed genuine test fundraiser launch', s.manager, managerAbi, 'createToken',
    [p, 0, data, expiry, s.miningFactory, 1, 86400n, sign(payload, false)])
  const created = event(launched, s.manager, managerAbi, 'TokenCreated'), token = created.token, vault = created.vault, holder = created.tracker
  check(same(await plan.call(vault, 'function tracker() view returns(address)'), holder), 'Tracker binding mismatch')
  // Reserve only the known curve funding ceiling; actual final gross is checked below.
  await approve(s.fab, s.manager, 6000n * FAB)
  const first = 500n * FAB; spend(first)
  await tx('Fundraiser curve purchase', s.manager, managerAbi, 'buy', [token, first, minimum(await curveQuote(token, true, first))])
  const initialTokens = await bal(token)
  await approve(token, s.manager, initialTokens / 2n)
  await tx('Fundraiser curve sale', s.manager, managerAbi, 'sell', [token, initialTokens / 2n, minimum(await curveQuote(token, false, initialTokens / 2n))])
  await plan.write('Recognise actual curve tax', vault, 'function sync()')
  await plan.write('Fund shared miner procurement', vault, 'function fundFarm()')
  await plan.write('Approve test miner sale', s.circuits, 'function approve(address,uint256)', [s.circuitMarket, BigInt(plan.miners.farm)])
  const listingReceipt = await tx('List ordinary miner for farm procurement', s.circuitMarket, marketAbi, 'list', [s.circuits, BigInt(plan.miners.farm), 10_000_000_000n])
  const listed = event(listingReceipt, s.circuitMarket, marketAbi, 'Listed')
  const listingId = listed.listingId ?? listed.id
  check(typeof listingId === 'bigint', 'Missing market listing ID')
  const purchase = { listingId, minerId: BigInt(plan.miners.farm), nativePrice: 10_000_000_000n, maxFab: FAB, nonce: 1n, deadline: await now() + 60n }
  spend(FAB, purchase.nativePrice)
  const digest = await plan.readAbi(s.farm, farmAbi, 'purchaseDigest', [purchase])
  await tx('Signed farm miner procurement', s.farm, farmAbi, 'buyMiner', [purchase, sign(digest, true)])
  check(same(await plan.call(s.circuits, 'function ownerOf(uint256) view returns(address)', [purchase.minerId]), s.farm), 'Farm NFT custody failed')
  await plan.advanceRewards(60)
  const beforeClaim = await bal(s.fab)
  await plan.write('Harvest and claim pre-graduation holder FAB', holder, 'function harvestAndClaim() returns(uint256)')
  check(await bal(s.fab) > beforeClaim, 'Pre-graduation dividends were not paid')
  const state = await plan.readAbi(s.manager, managerAbi, 'tokens', [token])
  const left = state[13] - state[11], required = ceil(state[9] * left, state[10] - left), gross = ceil(required * 10000n, 9800n)
  spend(gross)
  await tx('Graduate genuine V2 test project', s.manager, managerAbi, 'buy', [token, gross, left])
  const pair = await plan.call(s.manager, 'function pairOf(address) view returns(address)', [token])
  check(BigInt(pair) !== 0n && await bal(pair, s.v2Locker) > 0n, 'Graduation LP custody failed')
  const protectedUntil = await plan.call(token, 'function protectionEndsAt() view returns(uint256)')
  check(await plan.call(token, 'function protectionActive() view returns(bool)') === true, 'Mandatory protection missing')
  const addFab = FAB / 100n, addTokens = 1_000_000n * A; spend(addFab)
  await approve(token, s.helper, addTokens); await approve(s.fab, s.helper, addFab)
  const tokenFirst = same(await plan.call(pair, 'function token0() view returns(address)'), token)
  const reserves = await plan.call(pair, 'function getReserves() view returns(uint112,uint112,uint32)')
  const [lpToken, lpFab] = liquidityAmounts(addTokens, addFab, reserves[tokenFirst ? 0 : 1], reserves[tokenFirst ? 1 : 0])
  await plan.write('Add project LP during protection', s.helper, 'function addLiquidity(address,uint256,uint256,uint256,uint256,uint256) returns(uint256,uint256,uint256)',
    [token, addTokens, addFab, lpToken * 975n / 1000n, lpFab * 975n / 1000n, await deadline()])
  const projectLp = await bal(pair)
  await approve(pair, s.helper, projectLp)
  await plan.write('Remove newly added project LP', s.helper, 'function removeLiquidity(address,uint256,uint256,uint256,uint256) returns(uint256,uint256)',
    [token, projectLp, lpToken * 975n / 1000n, lpFab * 975n / 1000n, await deadline()])
  check(await bal(pair) === 0n, 'Project LP removal failed')
  // Keep one miner and usable reserves in the fragment product after acceptance.
  await plan.write('Approve fragment backing miner', s.circuits, 'function approve(address,uint256)', [s.fragmentVault, BigInt(plan.miners.fragment)])
  await plan.write('Deposit actual fragment backing', s.fragmentVault, 'function deposit(uint256,uint256) returns(uint256)', [BigInt(plan.miners.fragment), 6000n * A])
  await approve(s.fragmentVault, s.fragmentPool, 3011n * A); await approve(s.fab, s.fragmentPool, 302n * FAB)
  spend(300n * FAB)
  await plan.write('Seed backed fragment liquidity', s.fragmentPool, 'function addLiquidity(uint256,uint256,uint256,uint256,uint256) returns(uint256)',
    [3000n * A, 300n * FAB, 3000n * A, 300n * FAB, await deadline()])
  const seedLp = await bal(s.fragmentPool)
  spend(FAB / 1000n)
  const fragmentQuote = (direction, amount) => plan.call(s.fragmentPool, 'function quoteExactIn(bool,uint256) view returns(uint256)', [direction, amount])
  await plan.write('Buy backed fragments', s.fragmentPool, 'function swapExactIn(bool,uint256,uint256,uint256) returns(uint256)', [false, FAB / 1000n, minimum(await fragmentQuote(false, FAB / 1000n)), await deadline()])
  await plan.write('Sell backed fragments', s.fragmentPool, 'function swapExactIn(bool,uint256,uint256,uint256) returns(uint256)', [true, A / 200n, minimum(await fragmentQuote(true, A / 200n)), await deadline()])
  spend(FAB)
  const fragmentReserves = await Promise.all([plan.call(s.fragmentPool, 'function reserveShares() view returns(uint256)'), plan.call(s.fragmentPool, 'function reserveFab() view returns(uint256)')])
  const [fragmentA, fragmentB] = liquidityAmounts(10n * A, FAB, ...fragmentReserves)
  await plan.write('Add fragment LP', s.fragmentPool, 'function addLiquidity(uint256,uint256,uint256,uint256,uint256) returns(uint256)', [10n * A, FAB, fragmentA * 975n / 1000n, fragmentB * 975n / 1000n, await deadline()])
  await plan.write('Remove newly added fragment LP', s.fragmentPool, 'function removeLiquidity(uint256,uint256,uint256,uint256) returns(uint256,uint256)',
    [await bal(s.fragmentPool) - seedLp, fragmentA * 975n / 1000n, fragmentB * 975n / 1000n, await deadline()])
  await plan.write('Approve user miner for deposit test', s.circuits, 'function approve(address,uint256)', [s.fragmentVault, BigInt(plan.miners.user)])
  await plan.write('Deposit second ordinary miner', s.fragmentVault, 'function deposit(uint256,uint256) returns(uint256)', [BigInt(plan.miners.user), 1n])
  const redeem = await plan.call(s.fragmentVault, 'function previewRedeem(uint256) view returns(uint256)', [BigInt(plan.miners.user)])
  await plan.write('Redeem second miner', s.fragmentVault, 'function redeem(uint256,uint256) returns(uint256)', [BigInt(plan.miners.user), redeem])
  await plan.write('Approve retail test miner listing', s.circuits, 'function approve(address,uint256)', [s.circuitMarket, BigInt(plan.miners.user)])
  const retail = await tx('Leave user-purchasable test miner', s.circuitMarket, marketAbi, 'list', [s.circuits, BigInt(plan.miners.user), 10_000_000_000n])
  const retailEvent = event(retail, s.circuitMarket, marketAbi, 'Listed'), retailId = retailEvent.listingId ?? retailEvent.id
  // Taxed V2 tokens support taxed swaps during protection. Exercise the real branch.
  const swapIn = FAB / 1000n, swapPath = [s.fab, token]; spend(swapIn)
  await approve(s.fab, s.router, swapIn)
  const quoted = await plan.call(s.router, 'function getAmountsOut(uint256,address[]) view returns(uint256[])', [swapIn, swapPath])
  await plan.write('Graduated taxed V2 project buy during protection', s.router,
    'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)',
    [swapIn, minimum(quoted[1] - quoted[1] / 100n), swapPath, plan.owner, await deadline()])
  await approve(token, s.router, A)
  const reverse = await plan.call(s.router, 'function getAmountsOut(uint256,address[]) view returns(uint256[])', [A - A / 100n, [token, s.fab]])
  await plan.write('Graduated project sell', s.router, 'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)',
    [A, minimum(reverse[1]), [token, s.fab], plan.owner, await deadline()])
  await plan.write('Harvest locked LP trading fees', s.v2Locker, 'function harvest(address) returns(uint256)', [pair])
  const creatorFees = await plan.call(s.v2Locker, 'function accrued(address,address) view returns(uint256)', [plan.owner, s.fab])
  check(creatorFees > 0n, 'No creator LP fee accrual')
  await plan.write('Claim creator locked LP fees', s.v2Locker, 'function claim(address)', [s.fab])
  const tax = await bal(token, vault), taxQuote = await plan.call(s.router, 'function getAmountsOut(uint256,address[]) view returns(uint256[])', [tax - tax / 100n, [token, s.fab]])
  const conversion = { input: tax, minimumFab: minimum(taxQuote[1]), nonce: 1n, deadline: await now() + 60n }
  check(tax > 0n, 'No actual graduated token tax')
  const conversionDigest = await plan.readAbi(vault, vaultAbi, 'conversionDigest', [conversion])
  await tx('Convert actual project tax to FAB', vault, vaultAbi, 'convertTax', [conversion, sign(conversionDigest, true)])
  await plan.write('Recognise converted tax', vault, 'function sync()')
  await plan.write('Reinvest converted tax in farm budget', vault, 'function fundFarm()')
  await approve(token, holder, A)
  await plan.write('Burn project token for seven-day credit', holder, 'function burnForBoost(uint256)', [A])
  check(await plan.call(holder, 'function activeCredit(address) view returns(uint256)', [plan.owner]) === A, 'Burn credit missing')
  for (const [label, target] of [['Fragment holders', s.fragmentVault], ['Fragment LP holders', s.fragmentPool], ['Project holders', holder]]) {
    await plan.write(`${label}: harvest actual FAB`, target, 'function harvest()')
    const prior = await bal(s.fab)
    await plan.write(`${label}: claim paid FAB`, target, 'function claimFor(address) returns(uint256)', [plan.owner])
    check(await bal(s.fab) > prior, `${label} claim did not pay`)
  }
  for (const [label, target, signature, args] of [
    ['Curve platform fees', s.manager, 'function claimPlatformFees(address)', [s.fab]],
    ['Mining project platform tax', vault, 'function payPlatform()', []],
    ['Locked LP platform fees', s.v2Locker, 'function claimPlatform(address)', [s.fab]],
    ['Fragment platform fees', s.fragmentPool, 'function payPlatform()', []],
  ]) {
    const before = await bal(s.fab)
    await plan.write(label, target, signature, args)
    check(await bal(s.fab) > before, `${label} were not paid to the fixed platform`)
  }
  plan.business = { completed: true, token, vault, holder, pair, retailListingIds: [String(retailId)],
    protectionSeconds: 86400, protectionEndsAt: String(protectedUntil), taxedV2SwapsDuringProtection: true,
    fabPrincipalUpperBound: String(fabPrincipal), nativePrincipalUpperBound: String(nativePrincipal), productionTouched: false }
  plan.save()
}
