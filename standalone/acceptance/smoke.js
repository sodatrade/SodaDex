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
    const word = (value) => BigInt(value).toString(16).padStart(64, '0')
    let result = '0x0'
    if (body.method === 'eth_chainId') result = '0xc4'
    else if (body.method === 'eth_blockNumber') result = '0x12345'
    else if (body.method === 'eth_getBalance') result = '0xde0b6b3a7640000'
    else if (body.method === 'eth_getBlockByNumber') result = { timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16) }
    else if (body.method === 'eth_call') {
      const call = body.params[0]
      if (call.data.startsWith('0x70a08231')) result = '0x' + word(call.to.toLowerCase() === '0x779ded0c9e1022225f8e0630b35a9b54be713736' ? 1000000n : 1000000000000000000n)
      else if (call.data.startsWith('0xc6a5026a')) result = '0x' + [1000000n, 0n, 0n, 100000n].map(word).join('')
      else if (call.data.startsWith('0xaa9d21cb')) result = '0x' + [1000000n, 100000n].map(word).join('')
    }
    await route.fulfill({ json: { jsonrpc: '2.0', id: body.id, result } })
  })
  await page.goto(target)
  await page.evaluate(() => localStorage.removeItem('sodadex.preferences.v1'))
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.reload()
  await page.getByText('X Layer 已连接', { exact: true }).waitFor()
  check(await page.locator('html').getAttribute('data-theme') === 'light', 'new visitors default to day theme even when their system is dark')
  check(await page.getByText(/X Layer 主网/).isVisible(), 'mainnet test notice remains visible')
  const poolsReady = await page.getByText('V3 / V4 测试池已开放', { exact: true }).count() === 1
  await page.waitForFunction(() => [...document.querySelectorAll('.asset-icon img, .network-icon')].every((img) => img.complete && img.naturalWidth > 0))
  check(await page.getByRole('button', { name: '选择支付资产，当前 OKB', exact: true }).locator('img').getAttribute('src') === '/assets/okb.png', 'native OKB uses its locally served official icon')
  check(await page.getByRole('button', { name: '选择接收资产，当前 USD₮0', exact: true }).locator('img').getAttribute('src') === '/assets/usdt0.png', 'USD₮0 uses the official X Layer token-list icon')
  check(await page.getByRole('banner').locator('img[src="/assets/xlayer.svg"]').count() === 1, 'network selector uses the official X Layer mark')
  for (const [width, height] of [[1440, 1000], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height })
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no horizontal overflow at ${width}px`)
    check(await page.getByLabel('支付', { exact: true }).isVisible(), `amount input available at ${width}px`)
    check(await page.getByRole('button', { name: '搜索', exact: true }).isVisible(), `global search available at ${width}px`)
    check(await page.getByRole('button', { name: '偏好设置', exact: true }).isVisible(), `preferences available at ${width}px`)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  const globalSearch = page.getByRole('textbox', { name: '搜索名称、代号或地址' })
  await globalSearch.fill('unknown')
  await page.getByText('没有匹配的结果', { exact: true }).waitFor()
  check(await page.getByText('没有匹配的结果', { exact: true }).isVisible(), 'global search has an honest empty state')
  await page.keyboard.press('Escape')
  check(await globalSearch.inputValue() === '' && await globalSearch.evaluate((input) => input === document.activeElement), 'first Escape clears search and keeps input focus')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  check(await page.getByRole('dialog').count() === 0, 'second Escape closes global search')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await page.getByRole('button', { name: '流动池', exact: true }).click()
  if (poolsReady) {
    check(await page.getByRole('button', { name: /OKB \/ USD₮0 · V3 \+ V4/ }).isVisible(), 'pool search exposes the verified two-protocol deployment')
  } else {
    check(await page.getByText('暂无可搜索的测试池。', { exact: true }).isVisible(), 'pending pool search does not invent a deployment')
  }
  await page.getByRole('button', { name: '钱包', exact: true }).click()
  await globalSearch.fill('0x1111111111111111111111111111111111111111')
  const addressLink = page.getByRole('link', { name: /在区块浏览器查看/ })
  await addressLink.waitFor()
  check(await addressLink.getAttribute('href') === 'https://www.oklink.com/xlayer/address/0x1111111111111111111111111111111111111111', 'complete address opens the fixed X Layer explorer')
  await globalSearch.fill('0xinvalid')
  check(await addressLink.count() === 0, 'invalid addresses do not create explorer results')
  await page.getByRole('button', { name: '代币', exact: true }).click()
  await globalSearch.fill('0xe538905cf8410324e03A5A23C1c177a474D59b2b')
  await page.getByRole('button', { name: /WOKB.*包装/ }).click()
  await page.getByRole('group', { name: '已选资产 WOKB', exact: true }).waitFor()
  check(await page.locator('#asset-wokb').evaluate((row) => row === document.activeElement), 'token search selects and focuses the real asset row')
  check(await page.getByLabel('价格（CNY） · 价格数据待接入', { exact: true }).count() === 3, 'currency display keeps missing prices unavailable')
  await page.getByRole('button', { name: '兑换', exact: true }).click()
  await page.getByRole('button', { name: '选择支付资产，当前 OKB' }).click()
  await page.getByRole('textbox', { name: '搜索资产名称或合约地址' }).fill('unknown')
  await page.getByText(/没有匹配的资产/).waitFor()
  check(await page.getByText(/没有匹配的资产/).isVisible(), 'asset search has an honest empty state')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  check(await page.getByRole('dialog').count() === 0, 'Escape closes asset dialog')
  await page.getByRole('button', { name: '切换支付与接收资产' }).click()
  await page.getByRole('button', { name: '选择支付资产，当前 USD₮0' }).waitFor()
  check(await page.getByRole('button', { name: '选择支付资产，当前 USD₮0' }).isVisible(), 'direction switch updates payment asset')
  await page.getByRole('button', { name: '切换支付与接收资产' }).click()
  await page.getByRole('button', { name: '兑换设置', exact: true }).click()
  await page.getByRole('radio', { name: /V4/ }).check()
  await page.getByRole('button', { name: '关闭对话框' }).click()
  await page.getByRole('button', { name: /路由 · V4/ }).waitFor()
  check(await page.getByRole('button', { name: /路由 · V4/ }).isVisible(), 'protocol preference updates route control')
  const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  await page.getByRole('banner').getByRole('button', { name: '连接钱包' }).click()
  await page.getByRole('button', { name: /浏览器钱包|MetaMask/ }).click()
  await page.getByText('X Layer · 已连接', { exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭对话框' }).click()
  await page.getByText('余额 1', { exact: true }).first().waitFor()
  const unavailable = page.getByRole('button', { name: poolsReady ? '输入数量' : '测试池准备中', exact: true })
  check(await unavailable.isDisabled(), 'empty amount or a pending pool cannot start a swap')
  await page.getByLabel('支付', { exact: true }).fill('2')
  await page.locator('#sell-amount[aria-invalid="true"]').waitFor()
  check(await page.getByLabel('支付', { exact: true }).getAttribute('aria-invalid') === 'true', 'amount above balance is rejected')
  await page.getByLabel('支付', { exact: true }).fill('1.000000000000000001')
  check(await page.getByLabel('支付', { exact: true }).getAttribute('aria-invalid') === 'true', 'one wei above balance is rejected without floating point rounding')
  const amount = '0.123456789012345678'
  await page.getByLabel('支付', { exact: true }).fill(amount)
  if (poolsReady) {
    await page.getByRole('button', { name: '预览兑换', exact: true }).click()
    await page.getByRole('dialog', { name: '预览兑换' }).waitFor()
    check(await page.getByText('0.995 USD₮0', { exact: true }).isVisible(), 'review renders the six-decimal quote minimum at 0.5% slippage')
    check(await page.getByRole('button', { name: '确认兑换', exact: true }).isEnabled(), 'ready pool reaches a separate explicit wallet confirmation')
    await page.getByRole('button', { name: '关闭对话框' }).click()
  } else {
    check(await page.getByRole('button', { name: '测试池准备中', exact: true }).isDisabled(), 'valid input cannot bypass pending pool status')
  }
  await page.getByRole('button', { name: '偏好设置', exact: true }).click()
  await page.getByRole('combobox', { name: '展示货币', exact: true }).selectOption('USD')
  await page.getByRole('combobox', { name: '语言', exact: true }).selectOption('en')
  await page.getByRole('radio', { name: 'Night', exact: true }).check()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  check(await page.locator('html').getAttribute('lang') === 'en', 'English updates document language')
  check(await page.evaluate(() => getComputedStyle(document.body).backgroundColor) !== light, 'night theme changes the page background')
  check(await page.getByLabel('Pay', { exact: true }).inputValue() === amount, 'English and currency/theme changes preserve precise input')
  check(await page.getByRole('button', { name: 'Choose pay asset, currently OKB', exact: true }).isVisible(), 'English preferences preserve asset direction')
  check(await page.getByRole('button', { name: 'Route · V4', exact: true }).isVisible(), 'English preferences preserve V4 choice')
  check(await page.getByRole('banner').getByRole('button', { name: '0x1111…1111', exact: true }).isVisible(), 'English preferences preserve wallet connection')
  await page.getByRole('button', { name: 'Preferences', exact: true }).click()
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('yue-HK')
  await page.getByRole('combobox', { name: '顯示貨幣', exact: true }).selectOption('HKD')
  await page.getByRole('radio', { name: '日間', exact: true }).check()
  await page.getByRole('button', { name: '關閉對話框', exact: true }).click()
  check(await page.locator('html').getAttribute('lang') === 'yue-HK', 'Cantonese updates document language')
  check(await page.getByLabel('支付', { exact: true }).inputValue() === amount && await page.getByRole('button', { name: '路由 · V4', exact: true }).isVisible(), 'Cantonese preferences preserve input and protocol')
  await page.getByRole('button', { name: '資產', exact: true }).click()
  check(await page.getByLabel('價格（HKD） · 價格數據未接入', { exact: true }).count() === 3, 'HKD selection changes currency labels without fabricated FX values')
  await page.getByRole('button', { name: '兌換', exact: true }).click()
  await page.getByRole('button', { name: '偏好設定', exact: true }).click()
  await page.getByRole('combobox', { name: '語言', exact: true }).selectOption('zh-CN')
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
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
  await page.getByRole('button', { name: '偏好设置', exact: true }).click()
  await page.getByRole('radio', { name: '夜间', exact: true }).check()
  await page.reload()
  check(await page.locator('html').getAttribute('data-theme') === 'dark', 'manual night preference survives reload')
  await page.getByRole('button', { name: '偏好设置', exact: true }).click()
  check(await page.getByRole('combobox', { name: '展示货币', exact: true }).inputValue() === 'HKD', 'currency preference survives reload')
  await page.getByRole('combobox', { name: '语言', exact: true }).selectOption('en')
  await page.getByRole('radio', { name: 'Day', exact: true }).check()
  await page.reload()
  await page.getByRole('button', { name: 'Preferences', exact: true }).waitFor()
  check(await page.locator('html').getAttribute('lang') === 'en' && await page.locator('html').getAttribute('data-theme') === 'light', 'language and manual day preference survive reload')
  await page.getByRole('button', { name: 'Preferences', exact: true }).click()
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('zh-CN')
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.unroute('**/api/rpc')
  await page.route('**/api/rpc', (route) => route.fulfill({ status: 502, json: { error: 'fixture unavailable' } }))
  await page.reload()
  await page.getByText('节点暂不可用', { exact: true }).waitFor()
  check(await page.getByRole('button', { name: '重试', exact: true }).isVisible(), 'RPC failure exposes retry without fake online state')
  await page.unroute('**/api/rpc')
  return { passed: checks.length, checks, walletCalls: calls, poolState: poolsReady ? 'ready' : 'pending', evidence: 'mock-wallet and mock-RPC browser acceptance; no signing or blockchain writes' }
}
