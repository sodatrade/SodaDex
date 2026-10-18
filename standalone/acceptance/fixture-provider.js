// Served only by the owned localhost acceptance servers, never bundled in the app.
// It exposes no key and forwards writes to the servers' existing guarded boundary.
;(async () => {
  if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1' || !location.port) return
  const endpoint = (path) => new URL(path, location.origin).href
  const failure = (message, code = 4200) => Object.assign(new Error(message), { code })
  try {
    const response = await fetch(endpoint('/fixture-status'), { cache: 'no-store', credentials: 'omit' })
    if (!response.ok) throw failure('Local fixture unavailable')
    const fixture = await response.json()
    const account = fixture.mode === 'owned-anvil-fork' ? fixture.owner
      : fixture.mode === 'owned-orders-anvil' ? fixture.maker : undefined
    if (fixture.chainId !== 196 || typeof account !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(account))
      throw failure('Unsupported local fixture identity')
    const consentKey = `sodadex-local-fixture:${account.toLowerCase()}`
    let connected = sessionStorage.getItem(consentKey) === 'connected'
    const listeners = new Map()
    const calls = []
    const provider = Object.freeze({
      async request({ method, params = [] }) {
        calls.push(method)
        if (method === 'eth_requestAccounts') {
          connected = true
          sessionStorage.setItem(consentKey, 'connected')
          return [account]
        }
        if (method === 'eth_accounts') return connected ? [account] : []
        if (method === 'eth_chainId') return '0xc4'
        if (method === 'wallet_switchEthereumChain' && params.length === 1 && params[0]?.chainId === '0xc4') return null
        if (!connected) throw failure('Connect the local test wallet first', 4100)
        if (method !== 'eth_sendTransaction' && !(method === 'eth_signTypedData_v4' && fixture.mode === 'owned-orders-anvil'))
          throw failure('Only the owned local fixture methods are supported')
        const result = await fetch(endpoint('/fixture-wallet'), {
          method: 'POST', credentials: 'omit',
          headers: { 'Content-Type': 'application/json', 'X-SodaDex-Fixture': '1' },
          body: JSON.stringify({ method, params }),
        })
        const body = await result.json()
        if (!result.ok || body.error || typeof body.result !== 'string') throw failure('Local fixture rejected the request')
        return body.result
      },
      on(event, listener) {
        if (!listeners.has(event)) listeners.set(event, new Set())
        listeners.get(event).add(listener)
      },
      removeListener(event, listener) { listeners.get(event)?.delete(listener) },
    })
    const info = Object.freeze({
      uuid: 'b1ddc89c-8154-4e55-9006-faa09639a196',
      name: '本地 Anvil 测试钱包', rdns: 'local.sodadex.anvil',
      icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"%3E%3Crect width="32" height="32" rx="8" fill="%233c3344"/%3E%3Ctext x="16" y="23" text-anchor="middle" fill="white" font-size="22"%3EA%3C/text%3E%3C/svg%3E',
    })
    const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }))
    window.addEventListener('eip6963:requestProvider', announce)
    // Read-only diagnostics; no browser-control API or arbitrary RPC escape hatch.
    Object.defineProperty(window, 'sodaLocalFixtureCalls', { get: () => [...calls] })
    announce()
    const label = document.createElement('aside')
    label.className = 'soda-local-fixture-label'
    label.setAttribute('role', 'note')
    label.textContent = '本地 Anvil 测试 · 链标识 196 · 不连接公链'
    document.body.append(label)
  } catch (error) {
    console.error('Local acceptance wallet unavailable:', error instanceof Error ? error.message : 'Invalid fixture')
  }
})()
