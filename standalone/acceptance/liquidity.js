// Run with a browser already open at the owned fork fixture:
// playwright-cli -s=sodadex-core-lp-fork run-code --filename=standalone/acceptance/liquidity.js
// The fixture accepts wallet submissions only through /fixture-wallet and only
// forwards them to its disposable Anvil process after the compiled Worker gate.
// oxlint-disable-next-line no-unused-expressions -- playwright-cli evaluates this required function expression.
async (page) => {
  const origin = new URL(page.url()).origin
  if (origin !== 'http://127.0.0.1:4173') throw new Error('Owned local fixture required')
  const status = await (await page.request.get(origin + '/fixture-status')).json()
  if (status.mode !== 'owned-anvil-fork') throw new Error('Fork mode missing')

  if (status.owner.toLowerCase() !== '0x6ecf746b078d46391f8c425b150153212f7c0545')
    throw new Error('Unexpected owned fixture account')
  // playwright-cli does not pass addInitScript arguments consistently across
  // its process boundary. These are public, fixed localhost fixture values.
  await page.context().addInitScript(() => {
      const owner = '0x6ecf746b078d46391f8C425B150153212F7C0545'
      const fixtureOrigin = 'http://127.0.0.1:4173'
      window.sodaForkLiquidityWalletCalls = []
      window.ethereum = {
        isMetaMask: true,
        on() {}, removeListener() {},
        async request({ method, params }) {
          window.sodaForkLiquidityWalletCalls.push(method)
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [owner]
          if (method === 'eth_chainId') return '0xc4'
          if (method !== 'eth_sendTransaction') throw new Error('Unexpected wallet method: ' + method)
          const response = await fetch(fixtureOrigin + '/fixture-wallet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-SodaDex-Fixture': '1' },
            body: JSON.stringify({ method, params }),
          })
          const body = await response.json()
          if (!response.ok || body.error) throw new Error('Owned fork rejected wallet request')
          return body.result
        },
      }
  })

  await page.goto(origin + '/#pools')
  // A repeated CLI session can already be on this hash with a modal open.
  // Reload after registering the init script so each run starts from fresh UI state.
  await page.reload()
  const checks = []
  const check = (condition, name) => {
    if (!condition) throw new Error(name)
    checks.push(name)
  }
  const lower = (value) => value.toLowerCase()
  const same = (a, b) => lower(a) === lower(b)
  let requestId = 0
  const read = async (method, params) => {
    let failure
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await page.request.post(origin + '/api/rpc', {
          headers: { Origin: origin },
          data: { jsonrpc: '2.0', id: ++requestId, method, params },
        })
        const body = await response.json()
        if (!response.ok() || body.error) throw new Error(`Owned fork read rejected: ${method}`)
        return body.result
      } catch (cause) {
        failure = cause
        await page.waitForTimeout(150)
      }
    }
    throw failure
  }
  const word = (hex, index = 0) => BigInt('0x' + hex.slice(2 + index * 64, 2 + (index + 1) * 64))
  const topicAddress = (address) => '0x' + address.slice(2).toLowerCase().padStart(64, '0')
  const balanceOf = async (token, owner) =>
    BigInt(await read('eth_call', [{ to: token, data: '0x70a08231' + owner.slice(2).toLowerCase().padStart(64, '0') }, 'latest']))
  const balances = async () => ({
    native: BigInt(await read('eth_getBalance', [status.owner, 'latest'])),
    stable: await balanceOf(status.stable, status.owner),
    wrapped: await balanceOf(status.wrappedNative, status.owner),
  })
  const ownerOf = async (manager, tokenId) =>
    '0x' + (await read('eth_call', [{ to: manager, data: '0x6352211e' + tokenId.toString(16).padStart(64, '0') }, 'latest'])).slice(-40)
  const positionLiquidity = async (protocol, manager, tokenId) => {
    if (protocol === 'V4')
      return BigInt(await read('eth_call', [{ to: manager, data: '0x1efeed33' + tokenId.toString(16).padStart(64, '0') }, 'latest']))
    const data = await read('eth_call', [{ to: manager, data: '0x99fbab88' + tokenId.toString(16).padStart(64, '0') }, 'latest'])
    return word(data, 7)
  }
  const managerBalances = async (manager) => ({
    stable: await balanceOf(status.stable, manager),
    wrapped: await balanceOf(status.wrappedNative, manager),
    native: BigInt(await read('eth_getBalance', [manager, 'latest'])),
  })
  const receipt = async (hash) => read('eth_getTransactionReceipt', [hash])
  const receiptSet = async (start) => {
    const current = await (await page.request.get(origin + '/fixture-status')).json()
    const submitted = current.transactions.slice(start)
    const receipts = await Promise.all(submitted.map((entry) => receipt(entry.hash)))
    check(receipts.length === submitted.length && receipts.length > 0, 'wallet submission has fixture receipts')
    check(receipts.every((entry) => entry?.status === '0x1' && same(entry.from, status.owner)), 'every fixture receipt succeeded for the connected owner')
    return { submitted, receipts }
  }
  const gasPaid = (receipts) => receipts.reduce((sum, item) => sum + BigInt(item.gasUsed) * BigInt(item.effectiveGasPrice), 0n)
  const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  const mintedId = (receipts, manager) => {
    const log = receipts
      .flatMap((entry) => entry.logs)
      .find((entry) => same(entry.address, manager) && entry.topics[0] === transferTopic && entry.topics[2] === topicAddress(status.owner))
    if (!log?.topics[3]) throw new Error('Minted position NFT Transfer event missing')
    return BigInt(log.topics[3])
  }
  const lastLiquidityReceipt = (receipts, manager) => {
    const found = [...receipts].reverse().find((entry) => same(entry.to, manager))
    if (!found) throw new Error('Position manager receipt missing')
    return found
  }
  const close = async () => {
    const button = page.getByRole('button', { name: '关闭对话框', exact: true })
    if (await button.count()) await button.last().click()
  }
  const previewAndConfirm = async () => {
    await page.getByRole('button', { name: '预览流动性操作', exact: true }).click()
    const review = page.getByRole('dialog', { name: '确认流动性操作', exact: true })
    await review.waitFor({ timeout: 60_000 })
    await review.getByText('操作合约', { exact: true }).waitFor()
    await review.getByRole('button', { name: '确认并打开钱包', exact: true }).click()
    await review.getByText('操作已确认，正在刷新仓位', { exact: true }).waitFor({ timeout: 120_000 })
    await review.getByRole('button', { name: '关闭', exact: true }).click()
  }
  const positionCard = (protocol, tokenId) => page.locator('.lp-position').filter({ hasText: `${protocol} · #${tokenId}` })
  const amountFields = (dialog) => dialog.locator('input[inputmode="decimal"]')
  const operation = async (protocol) => {
    const manager = protocol === 'V3' ? status.contracts.v3PositionManager : status.contracts.v4PositionManager
    await page.getByRole('button', { name: '池子', exact: true }).click()
    const pool = page.locator('.lp-pool').filter({ hasText: `${protocol} ·` }).first()
    await pool.waitFor({ timeout: 60_000 })
    await pool.getByRole('button', { name: '查看池子', exact: true }).click()
    const details = page.getByRole('dialog', { name: '查看池子', exact: true })
    await details.waitFor()
    check(await details.getByText('已初始化', { exact: true }).isVisible(), `${protocol} fixture pool is initialized and browseable`)
    await details.getByRole('button', { name: '添加流动性', exact: true }).click()

    const create = page.getByRole('dialog', { name: '创建池 / 新仓位', exact: true })
    await create.waitFor()
    const createFields = amountFields(create)
    const amount0 = protocol === 'V3' ? '0.000005' : '0.00000001'
    const amount1 = protocol === 'V3' ? '0.00000001' : '0.000005'
    await createFields.nth(0).fill(amount0)
    await createFields.nth(1).fill(amount1)
    const beforeMint = await balances()
    const mintStart = (await (await page.request.get(origin + '/fixture-status')).json()).transactions.length
    await previewAndConfirm()
    const mint = await receiptSet(mintStart)
    const tokenId = mintedId(mint.receipts, manager)
    check(same(await ownerOf(manager, tokenId), status.owner), `${protocol} minted NFT belongs to the wallet`)
    const afterMint = await balances()
    check(afterMint.native <= beforeMint.native, `${protocol} mint charges only owned fixture funds and gas`)
    check(afterMint.stable <= beforeMint.stable, `${protocol} mint spends no unaccounted stable balance`)
    const initialLiquidity = await positionLiquidity(protocol, manager, tokenId)
    check(initialLiquidity > 0n, `${protocol} minted NFT has real nonzero liquidity`)
    await page.getByRole('button', { name: '我的仓位', exact: true }).click()
    const card = positionCard(protocol, tokenId)
    await card.waitFor({ timeout: 60_000 })
    check(await card.getByRole('link', { name: `查看 NFT · #${tokenId}`, exact: true }).count() === 1, `${protocol} NFT is visible in the position portfolio`)

    await card.getByRole('button', { name: '增加流动性', exact: true }).click()
    const increase = page.getByRole('dialog', { name: '增加流动性', exact: true })
    await increase.waitFor()
    const increaseFields = amountFields(increase)
    await increaseFields.nth(0).fill(amount0)
    await increaseFields.nth(1).fill(amount1)
    const increaseStart = (await (await page.request.get(origin + '/fixture-status')).json()).transactions.length
    await previewAndConfirm()
    const increased = await receiptSet(increaseStart)
    lastLiquidityReceipt(increased.receipts, manager)
    const grownLiquidity = await positionLiquidity(protocol, manager, tokenId)
    check(grownLiquidity > initialLiquidity, `${protocol} increase changed actual NFT liquidity`)
    const updated = positionCard(protocol, tokenId)
    await updated.getByRole('button', { name: '减少流动性', exact: true }).click()
    const partial = page.getByRole('dialog', { name: `减少流动性 · #${tokenId}`, exact: true })
    await partial.waitFor()
    await partial.locator('input[inputmode="decimal"]').first().fill('50')
    const beforePartial = await balances()
    const partialStart = (await (await page.request.get(origin + '/fixture-status')).json()).transactions.length
    await previewAndConfirm()
    const partialReceipts = await receiptSet(partialStart)
    lastLiquidityReceipt(partialReceipts.receipts, manager)
    const afterPartial = await balances()
    const partialNative = afterPartial.native - beforePartial.native + gasPaid(partialReceipts.receipts)
    const partialStable = afterPartial.stable - beforePartial.stable
    const remainingLiquidity = await positionLiquidity(protocol, manager, tokenId)
    check(remainingLiquidity > 0n && remainingLiquidity < grownLiquidity, `${protocol} partial removal leaves an owned residual NFT position`)
    check(partialNative >= 0n && partialStable >= 0n && (partialNative > 0n || partialStable > 0n), `${protocol} atomic partial removal returned position assets`)

    const finalCard = positionCard(protocol, tokenId)
    await finalCard.getByRole('button', { name: '减少流动性', exact: true }).click()
    const exit = page.getByRole('dialog', { name: `减少流动性 · #${tokenId}`, exact: true })
    await exit.waitFor()
    await exit.getByRole('button', { name: '全部移出', exact: true }).click()
    const beforeExit = await balances()
    const managerBefore = await managerBalances(manager)
    const exitStart = (await (await page.request.get(origin + '/fixture-status')).json()).transactions.length
    await previewAndConfirm()
    const exitReceipts = await receiptSet(exitStart)
    lastLiquidityReceipt(exitReceipts.receipts, manager)
    const afterExit = await balances()
    const managerAfter = await managerBalances(manager)
    const exitNative = afterExit.native - beforeExit.native + gasPaid(exitReceipts.receipts)
    const exitStable = afterExit.stable - beforeExit.stable
    check(await positionLiquidity(protocol, manager, tokenId) === 0n, `${protocol} full exit leaves no active liquidity in its NFT`)
    check(same(await ownerOf(manager, tokenId), status.owner), `${protocol} exited NFT ownership remains with the wallet`)
    check(exitNative >= 0n && exitStable >= 0n && (exitNative > 0n || exitStable > 0n), `${protocol} full exit atomically collects returned assets`)
    check(
      managerAfter.native === managerBefore.native && managerAfter.stable === managerBefore.stable && managerAfter.wrapped === managerBefore.wrapped,
      `${protocol} position manager retains no new test-operation residue`,
    )
    check((await balances()).wrapped === 0n, `${protocol} owner has no WOKB residue after native-asset settlement`)
    return {
      protocol,
      tokenId: tokenId.toString(),
      initialLiquidity: initialLiquidity.toString(),
      increasedLiquidity: grownLiquidity.toString(),
      finalLiquidity: '0',
      mint: mint.submitted,
      increase: increased.submitted,
      partial: partialReceipts.submitted,
      exit: exitReceipts.submitted,
      partialReturned: { nativeExcludingGas: partialNative.toString(), stable: partialStable.toString() },
      exitReturned: { nativeExcludingGas: exitNative.toString(), stable: exitStable.toString() },
    }
  }

  await page.getByRole('banner').getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: /浏览器钱包|MetaMask/ }).click()
  await page.getByText('X Layer · 已连接', { exact: true }).waitFor()
  await close()
  await page.getByRole('button', { name: '流动性', exact: true }).click()
  await page.getByRole('heading', { name: '让资产，为流动出一份力。', exact: true }).waitFor()
  const results = [await operation('V3'), await operation('V4')]
  const calls = await page.evaluate(() => window.sodaForkLiquidityWalletCalls)
  check(calls.includes('eth_sendTransaction'), 'browser wallet submitted real fixture transactions')
  check(calls.every((method) => ['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'eth_sendTransaction'].includes(method)), 'wallet used only expected EIP-1193 methods')
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'desktop liquidity flow has no horizontal overflow')
  await page.setViewportSize({ width: 390, height: 844 })
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile liquidity view has no horizontal overflow')
  const finished = await (await page.request.get(origin + '/fixture-status')).json()
  return {
    passedChecks: checks.length,
    checks,
    results,
    submittedTransactions: finished.transactions.slice(status.transactions.length),
    walletCalls: calls,
    evidence: 'real browser + compiled Worker LP gate + owned Anvil contracts; no real-chain write or wallet private key',
  }
}
