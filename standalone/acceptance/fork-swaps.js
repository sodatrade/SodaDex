// Owned localhost Anvil only. No keystore, signature, or remote transaction transport.
async (page) => {
  const origin = new URL(page.url()).origin
  if (origin !== 'http://127.0.0.1:4173') throw new Error('Owned local fixture required')
  const status = await (await page.request.get(origin + '/fixture-status')).json()
  if (status.mode !== 'owned-anvil-fork') throw new Error('Fork mode missing')
  await page.context().addInitScript(({ owner, origin }) => {
    window.sodaForkWalletCalls = []
    window.ethereum = {
      isMetaMask: true,
      on() {}, removeListener() {},
      async request({ method, params }) {
        window.sodaForkWalletCalls.push(method)
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [owner]
        if (method === 'eth_chainId') return '0xc4'
        if (method !== 'eth_sendTransaction') throw new Error('Unexpected wallet method: ' + method)
        const response = await fetch(origin + '/fixture-wallet', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SodaDex-Fixture': '1' },
          body: JSON.stringify({ method, params }),
        })
        const result = await response.json()
        if (!response.ok || result.error) throw new Error('Owned fork rejected wallet request')
        return result.result
      },
    }
  }, { owner: status.owner, origin })
  await page.reload()
  await page.getByText('V3 / V4 测试池已开放', { exact: true }).waitFor()
  await page.getByRole('banner').getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('button', { name: /浏览器钱包|MetaMask/ }).click()
  await page.getByText('X Layer · 已连接', { exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  let requestId = 0
  const read = async (method, params) => {
    const response = await page.request.post(origin + '/api/rpc', {
      maxRetries: 2, headers: { Origin: origin }, data: { jsonrpc: '2.0', id: ++requestId, method, params },
    })
    const body = await response.json()
    if (!response.ok() || body.error) throw new Error('Owned fork read failed: ' + method)
    return body.result
  }
  const units = (text, decimals) => {
    const [whole, fraction = ''] = text.split(' ')[0].split('.')
    return BigInt(whole + fraction.padEnd(decimals, '0'))
  }
  const balance = async () => {
    const data = '0x70a08231' + status.owner.slice(2).toLowerCase().padStart(64, '0')
    return {
      native: BigInt(await read('eth_getBalance', [status.owner, 'latest'])),
      stable: BigInt(await read('eth_call', [{ to: status.stable, data }, 'latest'])),
      wrapped: BigInt(await read('eth_call', [{ to: status.wrappedNative, data }, 'latest'])),
    }
  }
  const signed = (hex) => { const n = BigInt('0x' + hex); return n >= 2n ** 255n ? n - 2n ** 256n : n }
  const results = []
  for (const protocol of ['V3', 'V4']) {
    await page.getByRole('button', { name: '兑换设置', exact: true }).click()
    await page.getByRole('radio', { name: new RegExp(protocol) }).check()
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
    for (const direction of ['forward', 'reverse']) {
      const before = await balance()
      const started = (await (await page.request.get(origin + '/fixture-status')).json()).transactions.length
      const amount = direction === 'forward' ? '0.000001' : '0.0001'
      await page.getByLabel('支付', { exact: true }).fill(amount)
      await page.getByRole('button', { name: '预览兑换', exact: true }).click({ timeout: 60000 })
      const dialog = page.getByRole('dialog', { name: '预览兑换', exact: true })
      await dialog.waitFor()
      const review = await dialog.locator('.review-details').innerText()
      const minimum = units(await dialog.locator('.review-details dd').first().innerText(), direction === 'forward' ? 6 : 18)
      await dialog.getByRole('button', { name: '确认兑换', exact: true }).click()
      await dialog.getByText('兑换已确认，余额已刷新', { exact: true }).waitFor({ timeout: 120000 })
      const href = await dialog.locator('.transaction-link').getAttribute('href')
      const hash = href.split('/tx/')[1]
      const completed = await (await page.request.get(origin + '/fixture-status')).json()
      const receipts = await Promise.all(completed.transactions.slice(started).map((tx) => read('eth_getTransactionReceipt', [tx.hash])))
      if (receipts.some((r) => r?.status !== '0x1' || r.from.toLowerCase() !== status.owner.toLowerCase())) throw new Error('Fork transaction did not succeed')
      const receipt = receipts.find((r) => r.transactionHash === hash)
      if (!receipt || receipt.to.toLowerCase() !== status.contracts.universalRouter.toLowerCase()) throw new Error('Wrong swap receipt')
      const v4 = protocol === 'V4'
      const topic = v4 ? '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f' : '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67'
      const pool = (v4 ? status.contracts.v4PoolManager : status.v3Pool).toLowerCase()
      const events = receipt.logs.filter((log) => log.address.toLowerCase() === pool && log.topics[0] === topic && (!v4 || log.topics[1] === status.v4PoolId))
      if (events.length !== 1) throw new Error('Expected own-pool Swap event missing')
      const after = await balance()
      const gas = receipts.reduce((sum, r) => sum + BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice), 0n)
      const native = after.native - before.native + gas, stable = after.stable - before.stable
      const amounts = [signed(events[0].data.slice(2, 66)), signed(events[0].data.slice(66, 130))]
      const expected = v4 ? [native, stable] : [-stable, -native]
      if (amounts.some((n, i) => n !== expected[i]) || after.wrapped !== 0n) throw new Error('Swap event and actual owner balances differ')
      if (direction === 'forward' ? native !== -1000000000000n || stable < minimum : stable !== -100n || native < minimum) throw new Error('Exact input or reviewed minimum was not met')
      results.push({ protocol, direction, amount, review, hash, minimumRaw: String(minimum), nativeDeltaExcludingGas: String(native), stableDeltaRaw: String(stable), swapEventVerified: true, receipt: { status: receipt.status, to: receipt.to, logs: receipt.logs.length } })
      await dialog.getByRole('button', { name: '关闭对话框', exact: true }).first().click()
      await page.getByRole('button', { name: '切换支付与接收资产', exact: true }).click()
    }
  }
  const finished = await (await page.request.get(origin + '/fixture-status')).json()
  const calls = await page.evaluate(() => window.sodaForkWalletCalls)
  if (results.length !== 4 || calls.some((method) => !['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'eth_sendTransaction'].includes(method))) throw new Error('Incomplete UI swaps or unexpected wallet methods')
  return { passedSwaps: 4, evidence: 'real browser + compiled Worker guard + owned Anvil contracts; fixture deployment mappings; no real-chain writes', results, submittedTransactions: finished.transactions.slice(status.transactions.length), walletCalls: calls }
}
