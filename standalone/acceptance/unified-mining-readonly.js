async (page) => {
  const origin = new URL(page.url()).origin
  if (!['http://127.0.0.1:8792', 'https://sodadex-preview.jsmsdx2025.workers.dev'].includes(origin)) throw new Error('Unexpected acceptance origin')
  const errors = [], reads = []
  page.on('pageerror', error => errors.push(String(error)))
  page.on('request', req => { if (new URL(req.url()).pathname.includes('/api/')) reads.push(new URL(req.url()).pathname) })
  // Isolated browser fixture; never connects to a real wallet and rejects all signing/broadcast methods.
  await page.context().addInitScript(() => {
    let chain = sessionStorage.getItem('acceptance.chain') || '0xc4'
    const listeners = {}
    window.ethereum = {
      request: async ({ method, params }) => {
        const calls = JSON.parse(sessionStorage.getItem('acceptance.calls') || '[]'); calls.push(method)
        sessionStorage.setItem('acceptance.calls', JSON.stringify(calls))
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return ['0x1111111111111111111111111111111111111111']
        if (method === 'eth_chainId') return chain
        if (method === 'wallet_switchEthereumChain') {
          chain = params[0].chainId; sessionStorage.setItem('acceptance.chain', chain)
          ;(listeners.chainChanged || []).forEach(fn => fn(chain)); return null
        }
        throw new Error('Read-only acceptance forbids ' + method)
      },
      on: (name, fn) => { (listeners[name] ||= []).push(fn) },
      removeListener: (name, fn) => { listeners[name] = (listeners[name] || []).filter(x => x !== fn) },
    }
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => { sessionStorage.clear(); localStorage.removeItem('sodadex.preferences.v1') })
  await page.goto(origin + '/#swap')
  await page.reload()
  await page.getByRole('banner').getByRole('button', { name: '连接钱包', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: /浏览器钱包/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: '关闭对话框' }).click()
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '矿机碎片' }).click()
  await page.waitForURL(origin + '/mining/#fragments')
  await page.getByRole('heading', { name: '矿机碎片', exact: true }).waitFor()
  await page.getByRole('button', { name: '切换到测试网 1952' }).click()
  if (origin.startsWith('https:')) await page.getByText('合约与实现版本已核验', { exact: true }).waitFor({ timeout: 60000 })
  if (await page.getByRole('button', { name: '切换到测试网 1952' }).count()) throw new Error('Chain switch not reflected')
  await page.getByRole('button', { name: '我的收益', exact: true }).click()
  await page.waitForURL(origin + '/mining/#positions')
  await page.goBack()
  await page.getByRole('heading', { name: '矿机碎片', exact: true }).waitFor()
  await page.reload()
  await page.getByRole('heading', { name: '矿机碎片', exact: true }).waitFor()
  await page.getByRole('banner').getByRole('button', { name: '偏好设置' }).click()
  await page.getByLabel('语言', { exact: true }).selectOption('en')
  await page.getByRole('radio', { name: 'Night', exact: true }).check()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('heading', { name: 'Miner shares', exact: true }).waitFor()
  const layouts = []
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, title: document.querySelector('h1')?.textContent }))
    if (layout.scroll > width) throw new Error('Horizontal page overflow at ' + width)
    layouts.push(layout)
    await page.screenshot({ path: '.analysis/unified-mining/fragments-' + width + '.png', fullPage: true })
  }
  await page.getByRole('banner').getByRole('button', { name: 'Preferences' }).click()
  await page.getByLabel('Language', { exact: true }).selectOption('yue-HK')
  await page.getByRole('button', { name: '關閉對話框' }).click()
  await page.getByRole('heading', { name: '礦機碎片', exact: true }).waitFor()
  await page.getByRole('navigation', { name: '主導覽' }).getByRole('link', { name: '募資分紅' }).click()
  await page.getByRole('heading', { name: '募資分紅', exact: true }).waitFor()
  await page.getByRole('banner').getByRole('button', { name: '偏好設定' }).click()
  await page.getByLabel('語言', { exact: true }).selectOption('zh-CN')
  await page.getByRole('radio', { name: '日间', exact: true }).check()
  await page.getByRole('button', { name: '关闭对话框' }).click()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: '.analysis/unified-mining/fundraising-light.png', fullPage: true })
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '交易', exact: true }).click()
  await page.waitForURL(origin + '/#swap')
  await page.getByRole('button', { name: '切换到 X Layer', exact: true }).waitFor()
  const state = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, locale: document.documentElement.lang, calls: JSON.parse(sessionStorage.getItem('acceptance.calls') || '[]') }))
  if (state.calls.some(m => /sign|send|approve/i.test(m))) throw new Error('Unexpected wallet write')
  if (state.calls.filter(m => m === 'eth_requestAccounts').length !== 1) throw new Error('Connection was not restored across paths')
  if (errors.length) throw new Error(errors.join('\n'))
  return { origin, layouts, state, routes: [...new Set(reads)], errors, financialWrites: 0 }
}
