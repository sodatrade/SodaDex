import { formatUnits, parseUnits, toHex, type Hex } from 'viem'
import { sameMiningAddress, type MiningTransaction, type MiningWriteRole } from '../../../mining-calls'
import type { MiningAddress, MiningProductDeployment, MiningProject } from '../../../mining-products'
import { miningData, miningUint, productRead, type MiningRpc } from './protocol'
import { curveOutput, liquidityAmounts, minimumMiningAmount, taxedV2Output } from './quotes'

export type MiningAction = 'fragmentBuy' | 'fragmentSell' | 'depositMiner' | 'redeemMiner' | 'fragmentAdd' | 'fragmentRemove' |
  'projectBuy' | 'projectSell' | 'projectAdd' | 'projectRemove' | 'burnBoost' | 'getTestFab' | 'buyMiner'
export interface MiningPlan {
  action: string; calls: { tx: MiningTransaction; approval: boolean }[]
  details: { label: 'input' | 'output' | 'minimum' | 'maximum' | 'assetA' | 'assetB'; value: string }[]
  block: bigint
}
export interface MiningPlanInput {
  deployment: MiningProductDeployment; read: MiningRpc; account: MiningAddress; action: MiningAction
  amount: string; secondAmount?: string; slippageBps: number; project?: MiningProject
}
export function miningAmount(text: string, decimals: number): bigint {
  if (!new RegExp(`^(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,${decimals}})?$`).test(text)) throw new Error('miningEmptyAmount')
  const amount = parseUnits(text, decimals)
  if (amount <= 0n || amount >= (1n << 256n) - 1n) throw new Error('miningEmptyAmount')
  return amount
}
export async function buildMiningPlan(i: MiningPlanInput): Promise<MiningPlan> {
  const { deployment: d, read, account, action, slippageBps: slip } = i, c = d.contracts
  if (!Number.isInteger(slip) || slip < 0 || slip >= 10_000) throw new Error('miningInvalidSlippage')
  const rawBlock = await read('eth_blockNumber')
  if (typeof rawBlock !== 'string' || !/^0x[0-9a-fA-F]+$/.test(rawBlock)) throw new Error('miningReadFailed')
  const block = BigInt(rawBlock), at = rawBlock
  const calls: MiningPlan['calls'] = [], details: MiningPlan['details'] = []
  const query = (to: MiningAddress, role: Parameters<typeof productRead>[2], name: string, args: readonly unknown[] = []): Promise<unknown> => productRead(read, to, role, name, args, at)
  const uint = async (to: MiningAddress, role: Parameters<typeof query>[1], name: string, args: readonly unknown[] = []): Promise<bigint> => miningUint(await query(to, role, name, args))
  const add = (to: MiningAddress, role: MiningWriteRole, name: string, args: readonly unknown[], approval = false, value: Hex = '0x0'): void => {
    calls.push({ tx: { from: account, to, value, data: miningData(role, name, args) }, approval })
  }
  const allowance = async (token: MiningAddress, spender: MiningAddress, amount: bigint): Promise<void> => {
    const role = sameMiningAddress(token, c.fab.address) ? 'fab' : sameMiningAddress(token, c.fragmentVault.address) ? 'fragmentVault'
      : d.projects.some((p) => p.pair && sameMiningAddress(token, p.pair.address)) ? 'pair' : 'projectToken'
    const balance = await uint(token, role, 'balanceOf', [account])
    if (balance < amount) throw new Error('miningAssetBalance')
    const approved = await uint(token, role, 'allowance', [account, spender])
    if (approved < amount) {
      if (approved !== 0n) add(token, 'token', 'approve', [spender, 0n], true)
      add(token, 'token', 'approve', [spender, amount], true)
    }
  }
  const show = (label: MiningPlan['details'][number]['label'], value: bigint, decimals: number, symbol: string): void => {
    details.push({ label, value: `${formatUnits(value, decimals)} ${symbol}` })
  }
  // Match the existing Uniswap LP deadline; the wallet always confirms the concrete deadline.
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)
  if (await query(c.mining.address, 'mining', 'paused') !== false) throw new Error('miningSourcePaused')
  if (action === 'getTestFab') {
    const input = miningAmount(i.amount, 18), path = [c.wrappedNative.address, c.fab.address]
    const amounts = await query(c.router.address, 'router', 'getAmountsOut', [input, path])
    if (!Array.isArray(amounts) || amounts.length !== 2) throw new Error('miningReadFailed')
    const output = miningUint(amounts[1]), minimum = minimumMiningAmount(output, slip)
    add(c.router.address, 'router', 'swapExactETHForTokens', [minimum, path, account, deadline], false, toHex(input))
    show('input', input, 18, d.chainId === 196 ? 'OKB' : 'TEST-OKB'); show('output', output, 8, 'TEST-FAB'); show('minimum', minimum, 8, 'TEST-FAB')
  } else if (action === 'buyMiner') {
    if (!/^(0|[1-9][0-9]*)$/.test(i.amount)) throw new Error('miningInvalidMiner')
    const id = BigInt(i.amount), listing = await query(c.circuitMarket.address, 'circuitMarket', 'listingView', [id])
    if (!Array.isArray(listing) || listing.length !== 6 || listing[5] !== true || typeof listing[0] !== 'string' ||
      sameMiningAddress(listing[0], account) || !sameMiningAddress(String(listing[1]), c.circuits.address) ||
      await query(c.fragmentVault.address, 'fragmentVault', 'admissibleMiner', [listing[2]]) !== true) throw new Error('miningInvalidMiner')
    const price = miningUint(listing[3])
    if (price === 0n) throw new Error('miningInvalidMiner')
    add(c.minerBuyer.address, 'minerBuyer', 'buy', [id, listing[2], price], false, toHex(price)); show('input', price, 18, d.chainId === 196 ? 'OKB' : 'TEST-OKB')
    details.push({ label: 'output', value: `NFT #${listing[2]}` })
  } else if (action === 'fragmentBuy' || action === 'fragmentSell') {
    const shareIn = action === 'fragmentSell', input = miningAmount(i.amount, shareIn ? 18 : 8)
    const output = await uint(c.fragmentPool.address, 'fragmentPool', 'quoteExactIn', [shareIn, input])
    const minimum = minimumMiningAmount(output, slip)
    await allowance(shareIn ? c.fragmentVault.address : c.fab.address, c.fragmentPool.address, input)
    add(c.fragmentPool.address, 'fragmentPool', 'swapExactIn', [shareIn, input, minimum, deadline])
    show('input', input, shareIn ? 18 : 8, shareIn ? 'TEST-fFAB' : 'TEST-FAB')
    show('output', output, shareIn ? 8 : 18, shareIn ? 'TEST-FAB' : 'TEST-fFAB')
    show('minimum', minimum, shareIn ? 8 : 18, shareIn ? 'TEST-FAB' : 'TEST-fFAB')
  } else if (action === 'depositMiner' || action === 'redeemMiner') {
    if (!/^(0|[1-9][0-9]*)$/.test(i.amount)) throw new Error('miningInvalidMiner')
    const id = BigInt(i.amount), deposit = action === 'depositMiner'
    if (deposit) {
      const count = await uint(c.fragmentVault.address, 'fragmentVault', 'minerCount')
      const capacity = await query(c.fragmentVault.address, 'fragmentVault', 'MAX_MINERS')
      if (typeof capacity !== 'number' || count >= BigInt(capacity)) throw new Error('miningMinerCapacity')
      const owner = await query(c.circuits.address, 'circuits', 'ownerOf', [id])
      if (typeof owner !== 'string' || !sameMiningAddress(owner, account) ||
          await query(c.fragmentVault.address, 'fragmentVault', 'admissibleMiner', [id]) !== true) throw new Error('miningInvalidMiner')
      const approved = await query(c.circuits.address, 'circuits', 'getApproved', [id])
      const all = await query(c.circuits.address, 'circuits', 'isApprovedForAll', [account, c.fragmentVault.address])
      if (all !== true && (typeof approved !== 'string' || !sameMiningAddress(approved, c.fragmentVault.address))) add(c.circuits.address, 'circuits', 'approve', [c.fragmentVault.address, id], true)
    }
    const preview = await uint(c.fragmentVault.address, 'fragmentVault', deposit ? 'previewDeposit' : 'previewRedeem', [id])
    let bound = deposit ? minimumMiningAmount(preview, slip) : (preview * BigInt(10_000 + slip) + 9999n) / 10_000n
    if (!deposit) {
      const balance = await uint(c.fragmentVault.address, 'fragmentVault', 'balanceOf', [account])
      if (balance < preview) throw new Error('miningAssetBalance')
      if (bound > balance) bound = balance
    }
    add(c.fragmentVault.address, 'fragmentVault', deposit ? 'deposit' : 'redeem', [id, bound])
    show(deposit ? 'minimum' : 'maximum', bound, 18, 'TEST-fFAB')
  } else if (action.startsWith('fragment') || action === 'projectAdd' || action === 'projectRemove') {
    const fragment = action.startsWith('fragment'), addLp = action.endsWith('Add'), p = i.project
    if (!fragment && !p?.pair) throw new Error('miningNoLiquidity')
    const asset = fragment ? c.fragmentVault.address : p!.token.address, pool = fragment ? c.fragmentPool.address : p!.pair!.address
    let reserveA: bigint, reserveB: bigint
    if (fragment) [reserveA, reserveB] = await Promise.all([
      uint(pool, 'fragmentPool', 'reserveShares'), uint(pool, 'fragmentPool', 'reserveFab')])
    else [reserveA, reserveB] = await pairReserves(read, pool, asset, at)
    const symbol = fragment ? 'TEST-fFAB' : p!.symbol, target = fragment ? pool : c.liquidityHelper.address
    if (addLp) {
      const desiredA = miningAmount(i.amount, 18), desiredB = miningAmount(i.secondAmount ?? '', 8)
      const [a, b] = liquidityAmounts(desiredA, desiredB, reserveA, reserveB)
      const minA = minimumMiningAmount(a, slip), minB = minimumMiningAmount(b, slip)
      await allowance(asset, target, fragment ? a : desiredA); await allowance(c.fab.address, target, fragment ? b : desiredB)
      add(target, fragment ? 'fragmentPool' : 'liquidityHelper', 'addLiquidity', fragment
        ? [a, b, minA, minB, deadline] : [asset, desiredA, desiredB, minA, minB, deadline])
      show('assetA', a, 18, symbol); show('assetB', b, 8, 'TEST-FAB')
    } else {
      const lp = miningAmount(i.amount, 18), supply = await uint(pool, fragment ? 'fragmentPool' : 'pair', 'totalSupply')
      if (supply === 0n || await uint(pool, fragment ? 'fragmentPool' : 'pair', 'balanceOf', [account]) < lp) throw new Error('miningAssetBalance')
      const a = lp * reserveA / supply, b = lp * reserveB / supply
      if (!fragment) await allowance(pool, target, lp)
      add(target, fragment ? 'fragmentPool' : 'liquidityHelper', 'removeLiquidity', fragment
        ? [lp, minimumMiningAmount(a, slip), minimumMiningAmount(b, slip), deadline]
        : [asset, lp, minimumMiningAmount(a, slip), minimumMiningAmount(b, slip), deadline])
      show('assetA', a, 18, symbol); show('assetB', b, 8, 'TEST-FAB')
    }
  } else {
    const p = i.project
    if (!p) throw new Error('miningInvalidAction')
    if (action === 'burnBoost') {
      const amount = miningAmount(i.amount, 18)
      if (await query(p.token.address, 'projectToken', 'unlocked') !== true || await query(p.holder.address, 'holder', 'excluded', [account]) !== false)
        throw new Error('miningBurnUnavailable')
      const cursor = await uint(p.holder.address, 'holder', 'expiryCursor'), count = await uint(p.holder.address, 'holder', 'burnCreditCount')
      if (cursor < count) {
        const header = await read('eth_getBlockByNumber', [at, false])
        if (!header || typeof header !== 'object' || !('timestamp' in header) || typeof header.timestamp !== 'string' ||
            !/^0x[0-9a-fA-F]+$/.test(header.timestamp)) throw new Error('miningReadFailed')
        const credit = await query(p.holder.address, 'holder', 'burnCredit', [cursor])
        if (!credit || typeof credit !== 'object' || !('expiresAt' in credit) ||
            BigInt(String(credit.expiresAt)) <= BigInt(header.timestamp)) throw new Error('miningHistoryPending')
      }
      const balance = await uint(p.token.address, 'projectToken', 'balanceOf', [account]), credit = await uint(p.holder.address, 'holder', 'activeCredit', [account])
      if (credit > balance || amount > (balance - credit) / 2n) throw new Error('miningBurnLimit')
      await allowance(p.token.address, p.holder.address, amount)
      add(p.holder.address, 'holder', 'burnForBoost', [amount]); show('input', amount, 18, p.symbol)
    } else {
      const buy = action === 'projectBuy', amount = miningAmount(i.amount, buy ? 8 : 18)
      const unlocked = await query(p.token.address, 'projectToken', 'unlocked')
      let output: bigint
      if (unlocked === true) {
        if (!p.pair) throw new Error('miningNoLiquidity')
        const [reserveToken, reserveFab] = await pairReserves(read, p.pair.address, p.token.address, at)
        const exempt = await query(p.token.address, 'projectToken', 'taxExempt', [account])
        const tax = exempt === true ? 0n : BigInt(await query(p.token.address, 'projectToken', buy ? 'taxBuyBps' : 'taxSellBps') as number)
        output = taxedV2Output(amount, reserveFab, reserveToken, buy, tax)
        await allowance(buy ? c.fab.address : p.token.address, c.router.address, amount)
        add(c.router.address, 'router', 'swapExactTokensForTokensSupportingFeeOnTransferTokens',
          [amount, minimumMiningAmount(output, slip), buy ? [c.fab.address, p.token.address] : [p.token.address, c.fab.address], account, deadline])
      } else if (unlocked === false) {
        const state = await query(c.manager.address, 'manager', 'tokens', [p.token.address])
        if (!Array.isArray(state) || state.length !== 16 || !sameMiningAddress(String(state[5]), c.fab.address)) throw new Error('miningReadFailed')
        output = curveOutput({ buyFee: BigInt(state[1]), sellFee: BigInt(state[2]), buyTax: BigInt(state[3]), sellTax: BigInt(state[4]),
          snipe: await uint(c.manager.address, 'manager', 'snipeBpsNow', [p.token.address]), vQuote: state[9], vToken: state[10], sold: state[11], sellable: state[13] }, buy, amount)
        await allowance(buy ? c.fab.address : p.token.address, c.manager.address, amount)
        add(c.manager.address, 'manager', buy ? 'buy' : 'sell', [p.token.address, amount, minimumMiningAmount(output, slip)])
      } else throw new Error('miningReadFailed')
      show('input', amount, buy ? 8 : 18, buy ? 'TEST-FAB' : p.symbol)
      show('output', output, buy ? 18 : 8, buy ? p.symbol : 'TEST-FAB')
      show('minimum', minimumMiningAmount(output, slip), buy ? 18 : 8, buy ? p.symbol : 'TEST-FAB')
    }
  }
  return { action, calls, details, block }
}

async function pairReserves(read: MiningRpc, pool: MiningAddress, asset: MiningAddress, at: string): Promise<[bigint, bigint]> {
  const [reserves, token0] = await Promise.all([productRead(read, pool, 'pair', 'getReserves', [], at), productRead(read, pool, 'pair', 'token0', [], at)])
  if (!Array.isArray(reserves) || reserves.length !== 3 || typeof token0 !== 'string') throw new Error('miningReadFailed')
  const [a, b] = [miningUint(reserves[0]), miningUint(reserves[1])]
  return sameMiningAddress(token0, asset) ? [a, b] : [b, a]
}

export function simpleMiningPlan(from: MiningAddress, to: MiningAddress, role: MiningWriteRole, action: string,
  name: string, args: readonly unknown[] = []): MiningPlan {
  return { action, block: 0n, details: [], calls: [{ tx: { from, to, value: '0x0', data: miningData(role, name, args) as Hex }, approval: false }] }
}
