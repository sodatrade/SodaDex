// Run with: playwright-cli -s=sodadex-acceptance open <local-or-test-site-url>
// Then: playwright-cli -s=sodadex-acceptance run-code --filename=standalone/acceptance/smoke.js
// This suite uses an injected mock wallet and mock RPC; it never signs or sends transactions.
// oxlint-disable-next-line no-unused-expressions -- playwright-cli evaluates this required function expression.
async (page) => {
  const target = new URL(page.url()).origin
  const checks = []
  const check = (condition, name) => {
    if (!condition) throw new Error(name)
    checks.push(name)
  }
  await page.context().addInitScript(() => {
    const listeners = new Map()
    const state = { chain: '0xc4', address: '0x1111111111111111111111111111111111111111', calls: [] }
    const emit = (event, value) => { for (const listener of listeners.get(event) ?? []) listener(value) }
    window.sodaAcceptanceFixture = { state, emit }
    window.ethereum = {
      isMetaMask: true,
      on(event, listener) { listeners.set(event, [...(listeners.get(event) ?? []), listener]) },
      removeListener(event, listener) { listeners.set(event, (listeners.get(event) ?? []).filter((item) => item !== listener)) },
      async request({ method }) {
        state.calls.push(method)
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [state.address]
        if (method === 'eth_chainId') return state.chain
        if (method === 'wallet_switchEthereumChain') { state.chain = '0xc4'; emit('chainChanged', state.chain); return null }
        throw new Error('Unexpected wallet operation: ' + method)
      },
    }
  })
  await page.route('**/api/rpc', async (route) => {
    const body = route.request().postDataJSON()
    const result = body.method === 'eth_chainId' ? '0xc4' : body.method === 'eth_blockNumber' ? '0x12345' : '0xde0b6b3a7640000'
    await route.fulfill({ json: { jsonrpc: '2.0', id: body.id, result } })
  })
  await page.goto(target)
  await page.getByText('X Layer 已连接', { exact: true }).waitFor()
  check(await page.getByText(/X Layer 主网/).isVisible(), 'mainnet test notice remains visible')
  for (const [width, height] of [[1440, 1000], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height })
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no horizontal overflow at ${width}px`)
    check(await page.getByLabel('支付', { exact: true }).isVisible(), `amount input available at ${width}px`)
  }
  await page.getByRole('button', { name: '选择支付资产，当前 OKB' }).click()
  await page.getByRole('textbox', { name: '搜索资产名称或合约地址' }).fill('unknown')
  await page.getByText(/没有匹配的资产/).waitFor()
  check(await page.getByText(/没有匹配的资产/).isVisible(), 'asset search has an honest empty state')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  check(await page.getByRole('dialog').count() === 0, 'Escape closes asset dialog')
  await page.getByRole('button', { name: '切换支付与接收资产' }).click()
  await page.getByRole('button', { name: '选择支付资产，当前 WOKB' }).waitFor()
  check(await page.getByRole('button', { name: '选择支付资产，当前 WOKB' }).isVisible(), 'direction switch updates payment asset')
  await page.getByRole('button', { name: '兑换设置', exact: true }).click()
  await page.getByRole('radio', { name: /V4/ }).check()
  await page.getByRole('button', { name: '关闭对话框' }).click()
  await page.getByRole('button', { name: /路由 · V4/ }).waitFor()
  check(await page.getByRole('button', { name: /路由 · V4/ }).isVisible(), 'protocol preference updates route control')
  const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  await page.getByRole('button', { name: '切换浅色外观' }).click()
  const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  check(dark !== light, 'theme changes actual page background')
  await page.getByRole('button', { name: '切换深色外观' }).click()
  await page.getByRole('banner').getByRole('button', { name: '连接钱包' }).click()
  await page.getByRole('button', { name: /浏览器钱包|MetaMask/ }).click()
  await page.getByText('X Layer · 已连接', { exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭对话框' }).click()
  await page.getByText('余额 1', { exact: true }).first().waitFor()
  const unavailable = page.getByRole('button', { name: '测试合约准备中', exact: true })
  check(await unavailable.isDisabled(), 'connected wallet cannot trade before contract deployment')
  await page.getByLabel('支付', { exact: true }).fill('2')
  await page.locator('#sell-amount[aria-invalid="true"]').waitFor()
  check(await page.getByLabel('支付', { exact: true }).getAttribute('aria-invalid') === 'true', 'amount above balance is rejected')
  await page.evaluate(() => { window.sodaAcceptanceFixture.state.chain = '0x1'; window.sodaAcceptanceFixture.emit('chainChanged', '0x1') })
  await page.getByRole('button', { name: '切换到 X Layer' }).waitFor()
  check(await page.getByText('余额 —', { exact: true }).count() === 2, 'wrong chain hides X Layer balances')
  await page.getByRole('button', { name: '切换到 X Layer' }).click()
  await page.getByText('余额 1', { exact: true }).first().waitFor()
  await page.evaluate(() => window.sodaAcceptanceFixture.emit('accountsChanged', []))
  await page.getByRole('banner').getByRole('button', { name: '连接钱包' }).waitFor()
  check(await page.getByText('余额 —', { exact: true }).count() === 2, 'revoked account clears balances')
  const calls = await page.evaluate(() => window.sodaAcceptanceFixture.state.calls)
  check(calls.every((method) => ['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'wallet_switchEthereumChain'].includes(method)), 'no signing or transaction wallet methods used')
  await page.unroute('**/api/rpc')
  await page.route('**/api/rpc', (route) => route.fulfill({ status: 502, json: { error: 'fixture unavailable' } }))
  await page.reload()
  await page.getByText('节点暂不可用', { exact: true }).waitFor()
  check(await page.getByRole('button', { name: '重试', exact: true }).isVisible(), 'RPC failure exposes retry without fake online state')
  await page.unroute('**/api/rpc')
  return { passed: checks.length, checks, walletCalls: calls, evidence: 'mock-wallet and mock-RPC browser acceptance; no blockchain writes' }
}
