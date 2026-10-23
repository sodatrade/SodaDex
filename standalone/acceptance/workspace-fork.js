// Final-browser acceptance for the generic workspace.  Local fixture only.
async (page) => {
  const origin = new URL(page.url()).origin
  if (origin !== 'http://127.0.0.1:4173') throw new Error('Owned localhost fixture required')
  const fixture = await (await page.request.get(`${origin}/fixture-status`)).json()
  if (fixture.mode !== 'owned-anvil-fork' || fixture.owner.toLowerCase() !== '0x6ecf746b078d46391f8c425b150153212f7c0545') throw new Error('Unexpected fixture')
  const owner = fixture.owner, recipient = '0x1111111111111111111111111111111111111111'
  await page.context().addInitScript(() => {
    const walletOwner = '0x6ecf746b078d46391f8C425B150153212F7C0545', fixtureOrigin = 'http://127.0.0.1:4173'
    window.sodaGeneralWalletCalls = []
    window.ethereum = { isMetaMask: true, on() {}, removeListener() {}, async request({ method, params }) {
      window.sodaGeneralWalletCalls.push(method)
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [walletOwner]
      if (method === 'eth_chainId') return '0xc4'
      if (method !== 'eth_sendTransaction') throw new Error(`Unexpected wallet method ${method}`)
      const response = await fetch(`${fixtureOrigin}/fixture-wallet`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SodaDex-Fixture': '1' }, body: JSON.stringify({ method, params }) })
      const body = await response.json()
      if (!response.ok || body.error) throw new Error('Fixture rejected write')
      return body.result
    } }
  })
  await page.goto(`${origin}/#swap`); await page.reload()
  const checks = [], check = (value, name) => { if (!value) throw new Error(name); checks.push(name) }
  let id = 0
  const rpc = async (method, params) => {
    const response = await page.request.post(`${origin}/api/rpc`, { headers: { Origin: origin }, data: { jsonrpc: '2.0', id: ++id, method, params } })
    const body = await response.json(); if (!response.ok() || body.error) throw new Error(`RPC ${method}`); return body.result
  }
  const balance = async (address) => BigInt(await rpc('eth_getBalance', [address, 'latest']))
  const tokenBalance = async (token, address) => BigInt(await rpc('eth_call', [{ to: token, data: `0x70a08231${address.slice(2).toLowerCase().padStart(64, '0')}` }, 'latest']))
  const receipt = hash => rpc('eth_getTransactionReceipt', [hash])
  const txs = async () => (await (await page.request.get(`${origin}/fixture-status`)).json()).transactions
  const close = async () => { const button = page.getByRole('button', { name: '关闭对话框', exact: true }); if (await button.count()) await button.last().click() }
  const connect = async () => {
    await page.getByRole('banner').getByRole('button', { name: '连接钱包', exact: true }).click()
    await page.getByRole('button', { name: /浏览器钱包|MetaMask/ }).click()
    await page.getByText('X Layer · 已连接', { exact: true }).waitFor(); await close()
  }
  const transact = async (button, success) => {
    const before = (await txs()).length
    await button.click(); await page.getByText(success, { exact: true }).first().waitFor({ timeout: 45000 })
    const made = (await txs()).slice(before), receipts = await Promise.all(made.map(tx => receipt(tx.hash)))
    check(receipts.length > 0 && receipts.every(r => r.status === '0x1' && r.from.toLowerCase() === owner.toLowerCase()), `${success} has successful owned-fixture receipts`)
    return { made, receipts }
  }
  await page.getByRole('heading', { name: '交易', exact: true }).waitFor({ timeout: 60000 }); await connect()

  // Generic token picker: select WOKB, then restore native OKB for the pool pair.
  await page.getByRole('button', { name: '选择支付资产，当前 OKB', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选择币种', exact: true }); await picker.waitFor()
  await picker.getByRole('button', { name: /WOKB/ }).click()
  await page.getByRole('button', { name: '选择支付资产，当前 WOKB', exact: true }).waitFor()
  check(true, 'generic currency picker selects WOKB from the supported token catalog')
  await page.getByRole('button', { name: '选择支付资产，当前 WOKB', exact: true }).click()
  await page.getByRole('dialog', { name: '选择币种', exact: true }).getByRole('button', { name: /OKB/ }).first().click()
  await page.getByRole('button', { name: '选择支付资产，当前 OKB', exact: true }).waitFor()

  // Discover the two owned pools from the general route details and Explore/Pools tab.
  await page.getByLabel('你将支付', { exact: true }).fill('0.000001')
  await page.locator('.swap-quote-details summary').waitFor({ timeout: 60000 })
  await page.locator('.swap-quote-details summary').click()
  await page.getByText('在 SodaDEX V3 / V4 资金池中选择报价最优的单池路径。', { exact: true }).waitFor()
  check(true, 'generic swap discovers initialized SodaDEX V3 and V4 candidates')
  await page.getByRole('button', { name: '探索', exact: true }).click()
  await page.getByRole('button', { name: '资金池', exact: true }).click()
  const poolSelect = page.getByRole('combobox', { name: '流动性池', exact: true })
  await poolSelect.waitFor({ timeout: 60000 })
  const firstPool = await poolSelect.inputValue()
  await poolSelect.selectOption({ index: 1 })
  check(firstPool !== await poolSelect.inputValue(), 'Explore/Pools exposes selectable V3 and V4 owned protocol pools')
  await page.getByRole('button', { name: '交易', exact: true }).click()

  // V3/V4, native forward and stable reverse, with two explicit UI actions each.
  const swap = async (protocol, reverse) => {
    await page.getByRole('button', { name: /交易路径/ }).click()
    await page.getByRole('radio', { name: protocol.toUpperCase(), exact: true }).check(); await close()
    if (reverse) await page.getByRole('button', { name: '切换支付与接收资产', exact: true }).click()
    const amount = reverse ? '0.0001' : '0.000001'
    await page.getByLabel('你将支付', { exact: true }).fill(amount)
    await page.getByRole('button', { name: '预览兑换', exact: true }).click()
    const review = page.getByRole('dialog', { name: '预览兑换', exact: true }); await review.waitFor()
    await review.getByText('最少收到', { exact: true }).waitFor()
    const result = await transact(review.getByRole('button', { name: '确认兑换', exact: true }), '兑换已确认，余额已刷新')
    const router = result.receipts.find(r => r.to?.toLowerCase() === fixture.contracts.universalRouter.toLowerCase())
    check(!!router, `${protocol} ${reverse ? 'reverse' : 'forward'} quote executes through the router`)
    await review.getByRole('button', { name: '关闭', exact: true }).click()
    if (reverse) await page.getByRole('button', { name: '切换支付与接收资产', exact: true }).click()
    return router.transactionHash
  }
  const swaps = [await swap('v3', false), await swap('v3', true), await swap('v4', false), await swap('v4', true)]

  // Wrap then unwrap exact micro amount: no pool, approval, or router involved.
  const wrapAmount = 10000000000n, beforeWrap = await tokenBalance(fixture.wrappedNative, owner)
  await page.getByRole('button', { name: '选择接收资产，当前 USD₮0', exact: true }).click()
  await page.getByRole('dialog', { name: '选择币种', exact: true }).getByRole('button', { name: /WOKB/ }).click()
  await page.getByLabel('你将支付', { exact: true }).fill('0.00000001')
  await page.getByRole('button', { name: '包装', exact: true }).click()
  const wrapDialog = page.getByRole('dialog', { name: '包装', exact: true }); await wrapDialog.waitFor()
  const wrapped = await transact(wrapDialog.getByRole('button', { name: '确认兑换', exact: true }), '兑换已确认，余额已刷新')
  check(await tokenBalance(fixture.wrappedNative, owner) - beforeWrap === wrapAmount, 'wrap increases WOKB 1:1')
  await wrapDialog.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '切换支付与接收资产', exact: true }).click()
  await page.getByLabel('你将支付', { exact: true }).fill('0.00000001')
  await page.getByRole('button', { name: '解包', exact: true }).click()
  const unwrapDialog = page.getByRole('dialog', { name: '解包', exact: true }); await unwrapDialog.waitFor()
  const unwrapped = await transact(unwrapDialog.getByRole('button', { name: '确认兑换', exact: true }), '兑换已确认，余额已刷新')
  check(await tokenBalance(fixture.wrappedNative, owner) === beforeWrap, 'unwrap restores WOKB balance 1:1')
  await unwrapDialog.getByRole('button', { name: '关闭', exact: true }).click()

  // Portfolio native send: explicit review, recipient delta, and receipt.
  await page.getByRole('button', { name: '投资组合', exact: true }).click()
  await page.getByRole('button', { name: '发送', exact: true }).first().click()
  const send = page.getByRole('dialog', { name: /发送 OKB/ }); await send.waitFor()
  const fields = send.locator('input'); await fields.nth(0).fill(recipient); await fields.nth(1).fill('0.00000001')
  const recipientBefore = await balance(recipient)
  await send.getByRole('button', { name: '预览发送', exact: true }).click()
  await send.getByText('X Layer · 196', { exact: true }).waitFor()
  const sent = await transact(send.getByRole('button', { name: '确认并打开钱包', exact: true }), '发送已确认')
  check(await balance(recipient) - recipientBefore === wrapAmount, 'Send transfers native OKB to the reviewed recipient')
  check(sent.receipts.some(r => r.to?.toLowerCase() === recipient.toLowerCase()), 'Send receipt targets the reviewed recipient directly')
  const calls = await page.evaluate(() => window.sodaGeneralWalletCalls)
  check(calls.every(method => ['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'eth_sendTransaction'].includes(method)), 'wallet uses only fixture-safe EIP-1193 methods')
  return { passed: checks.length, checks, swaps, wrap: wrapped.made, unwrap: unwrapped.made, send: sent.made, walletCalls: calls,
    evidence: 'real browser + compiled Worker + owned local Anvil; no keystore or public-chain write' }
}
