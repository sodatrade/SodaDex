// Real UI and compiled Worker against an owned, offline Anvil only.
// oxlint-disable-next-line no-unused-expressions -- Playwright CLI executes this function expression.
async page => {
  const origin = new URL(page.url()).origin
  if (origin !== 'http://127.0.0.1:4185') throw Error('Owned V2 browser fixture required')
  const status = await (await page.request.get(origin + '/fixture-status')).json()
  if (status.mode !== 'owned-anvil-fork' || status.chainId !== 196 || status.transactions.length) throw Error('Fresh owned Anvil required')
  const rows = [], word = value => value.replace(/^0x/, '').padStart(64, '0')
  let sequence = 0
  const read = async (method, params = []) => {
    const response = await page.request.post(origin + '/api/rpc', { headers: { Origin: origin }, data: { jsonrpc: '2.0', id: ++sequence, method, params } })
    const body = await response.json()
    if (!response.ok() || body.error) throw Error('Read rejected: ' + method + ' ' + JSON.stringify(body.error))
    return body.result
  }
  const current = async () => (await (await page.request.get(origin + '/fixture-status')).json()).transactions
  const receiptRows = async (start, action) => {
    const txs = (await current()).slice(start)
    if (!txs.length) throw Error('No UI transaction: ' + action)
    const receipts = []
    for (const tx of txs) {
      const r = await read('eth_getTransactionReceipt', [tx.hash])
      if (r.status !== '0x1' || r.from.toLowerCase() !== status.owner.toLowerCase()) throw Error('Receipt failed')
      receipts.push({ ...tx, gasUsed: r.gasUsed, effectiveGasPrice: r.effectiveGasPrice })
    }
    rows.push({ action, receipts })
    return receipts
  }
  const balance = async token => BigInt(token === 'native' ? await read('eth_getBalance', [status.owner, 'latest']) :
    await read('eth_call', [{ to: token, data: '0x70a08231' + word(status.owner) }, 'latest']))
  const pairCall = async () => await read('eth_call', [{ to: status.contracts.v2Factory,
    data: '0xe6a43905' + word(status.stable) + word(status.wrappedNative) }, 'latest'])
  if (BigInt(await pairCall()) !== 0n) throw Error('Pair already exists')
  await page.goto(origin + '/#pool'); await page.reload()
  await page.getByRole('navigation', { name: 'SodaDEX', exact: true }).waitFor()
  if (await page.getByRole('button', { name: '连接钱包', exact: true }).count()) {
    await page.getByRole('button', { name: '连接钱包', exact: true }).click()
    await page.getByRole('dialog').locator('button').filter({ hasText: '本地 Anvil 测试钱包' }).click()
    await page.locator('.wallet-address').waitFor()
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  }
  await page.getByRole('button', { name: '创建池 / 新仓位', exact: true }).click()
  await page.getByRole('radio', { name: 'V2', exact: true }).click()
  await page.getByRole('button', { name: '查找 / 配置池子', exact: true }).click()
  const manage = () => page.getByRole('dialog', { name: '管理流动性', exact: true })
  const confirm = async action => {
    const start = (await current()).length, d = manage()
    await d.getByRole('button', { name: '预览流动性操作', exact: true }).click()
    await d.getByRole('button', { name: '确认并打开钱包', exact: true }).click()
    await d.getByText('操作已确认，正在刷新仓位', { exact: true }).waitFor({ timeout: 60000 })
    const result = await receiptRows(start, action)
    await d.getByRole('button', { name: '关闭', exact: true }).click()
    return result
  }
  await manage().getByRole('textbox', { name: 'USD₮0', exact: true }).fill('0.0001')
  await manage().getByRole('textbox', { name: 'OKB', exact: true }).fill('0.0000001')
  await confirm('create-and-first-add')
  const pair = '0x' + (await pairCall()).slice(-40)
  const first = await balance(pair)
  if (first <= 0n) throw Error('Missing initial LP')
  const openPair = async () => {
    await page.getByRole('button', { name: '池子', exact: true }).click()
    const row = page.getByRole('row').filter({ hasText: 'V2 · 0.3%' })
    await row.getByRole('button', { name: '管理流动性', exact: true }).click({ timeout: 60000 })
  }
  await openPair()
  await manage().getByRole('textbox', { name: 'USD₮0', exact: true }).fill('0.0001')
  await manage().getByRole('textbox', { name: 'OKB', exact: true }).fill('0.0000002')
  const beforeAdd = await balance('native'), added = await confirm('proportional-add-and-refund')
  const gas = added.reduce((sum, r) => sum + BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice), 0n)
  if (beforeAdd - await balance('native') - gas !== 100000000000n || await balance(pair) <= first) throw Error('Deposit/refund failed')
  await page.getByRole('button', { name: '我的仓位', exact: true }).click()
  await page.locator('.lp-position-list').getByText('V2', { exact: true }).waitFor({ timeout: 60000 })
  // Reload clears React-query's confirmed-pool cache: Swap must discover V2 from the directory.
  await page.goto(origin + '/#swap'); await page.reload()
  await page.getByRole('button', { name: '兑换设置', exact: true }).click()
  await page.getByRole('radio', { name: 'V2', exact: true }).click()
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  for (const reverse of [false, true]) {
    if (reverse) await page.getByRole('button', { name: '切换支付与接收资产', exact: true }).click()
    await page.locator('#swap-sell-amount').fill(reverse ? '0.000002' : '0.00000001')
    await page.getByRole('button', { name: '预览兑换', exact: true }).click({ timeout: 60000 })
    const d = page.getByRole('dialog', { name: '预览兑换', exact: true })
    const before = await balance(reverse ? 'native' : status.stable), start = (await current()).length
    await d.getByRole('button', { name: '确认兑换', exact: true }).click()
    await d.getByText('兑换已确认，余额已刷新', { exact: true }).waitFor({ timeout: 60000 })
    const txs = await receiptRows(start, reverse ? 'token-to-okb' : 'okb-to-token')
    const fee = txs.reduce((sum, r) => sum + BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice), 0n)
    if (await balance(reverse ? 'native' : status.stable) + (reverse ? fee : 0n) <= before) throw Error('Swap output did not increase')
    await d.getByRole('button', { name: '关闭', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Pool', exact: true }).click()
  for (const half of [true, false]) {
    await openPair()
    await manage().getByRole('button', { name: '减少流动性', exact: true }).click()
    const before = await balance(pair)
    if (half) {
      const value = before / 2n
      await manage().getByRole('textbox', { name: '流动性 · LP', exact: true }).fill(`${value / 10n ** 18n}.${(value % 10n ** 18n).toString().padStart(18, '0')}`)
    } else await manage().getByRole('button', { name: '全部 LP', exact: true }).click()
    await confirm(half ? 'remove-half' : 'remove-all')
    const after = await balance(pair)
    if (half ? after <= 0n || after >= before : after !== 0n) throw Error('Removal failed')
  }
  const supply = BigInt(await read('eth_call', [{ to: pair, data: '0x18160ddd' }, 'latest']))
  if (supply !== 1000n) throw Error('Minimum locked LP invariant failed')
  return { mode: 'owned-offline-browser', protocol: 'v2', publicChainWrites: 0, pair, owner: status.owner,
    firstLp: String(first), finalUserLp: String(await balance(pair)), minimumLockedLp: String(supply), rows }
}
