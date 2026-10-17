import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeFunctionData, encodeFunctionResult, parseAbi, type Abi, type Hex } from 'viem'
import { MINING_BASE, MINING_READ_SIGNATURES, type MiningBaseRole } from '../../mining-contracts'
import { networkProfile, publicNetworkProfile } from '../../network-profile'
import { MiningNetworkApp } from '../src/MiningNetworkApp'
import { getProfileNetworkStatus } from '../src/lib/networkStatus'
import { switchToXLayer, type Eip1193Provider } from '../src/lib/wallet'

// Readiness tests must retain their undeployed fixture after the public manifest
// switches to ready; deployed-product behavior has its own workspace tests.
vi.mock('../../../deployments/xlayer-1952/products.json', () => ({
  default: { schemaVersion: 1, state: 'pending', chainId: 1952 },
}))

vi.mock('../src/network', async () => {
  const { networkProfile } = await import('../../network-profile')
  const NETWORK = networkProfile('1952-mining-test')
  return { NETWORK, CHAIN_ID: NETWORK.chainId, RPC_URL: NETWORK.rpcUrl, EXPLORER_URL: NETWORK.explorerUrl }
})

const mining = networkProfile('1952-mining-test')
const fetchMock = vi.fn<typeof fetch>()
function contractResult(params: unknown[]): Hex {
  const tx = params[0] as { to: string; data: Hex }
  const role = (Object.keys(MINING_READ_SIGNATURES) as MiningBaseRole[]).find((name) => MINING_BASE[name].toLowerCase() === tx.to.toLowerCase())
  if (!role) throw new Error('Unexpected contract')
  const abi: Abi = parseAbi(MINING_READ_SIGNATURES[role])
  const decoded = decodeFunctionData({ abi, data: tx.data })
  const value = decoded.functionName === 'totalMined' ? 125_000_000n : decoded.functionName === 'balanceOf'
    ? role === 'fab' ? 300_000_000n : 1n : 2n
  return encodeFunctionResult({ abi, functionName: decoded.functionName, result: value })
}
beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async (url, options) => {
    if (url === '/api/network') return Response.json(publicNetworkProfile(mining))
    const request = JSON.parse(String(options?.body)) as { method: string; id: string; params: unknown[] }
    return Response.json({ jsonrpc: '2.0', id: request.id, result: request.method === 'eth_chainId' ? '0x7a0' : request.method === 'eth_call' ? contractResult(request.params) : '0x123' })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals(); delete (window as Window & { ethereum?: Eip1193Provider }).ethereum })

describe('1952 mining readiness entry', () => {
  it('shows the undeployed state, keeps light mode, and reads no mainnet contracts or orders', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    render(<QueryClientProvider client={client}><MiningNetworkApp /></QueryClientProvider>)
    expect(await screen.findByText(/X Layer 已连接/)).toBeVisible()
    expect(screen.getByRole('heading', { name: '矿机业务尚未部署就绪' })).toBeVisible()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(await screen.findByText('1.25 TEST-FAB')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'FAB 矿机基础合约已部署' })).toBeVisible()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/network', '/api/rpc', '/api/rpc', '/api/rpc', '/api/rpc', '/api/rpc'])
    const calls = fetchMock.mock.calls.filter(([url]) => url === '/api/rpc').map(([, options]) => JSON.parse(String(options?.body)).method)
    expect(calls).toEqual(['eth_chainId', 'eth_blockNumber', 'eth_call', 'eth_call', 'eth_call'])
    const reads = fetchMock.mock.calls.filter(([url, options]) => url === '/api/rpc' && JSON.parse(String(options?.body)).method === 'eth_call')
    expect(reads.every(([, options]) => JSON.parse(String(options?.body)).params[0].to === MINING_BASE.mining)).toBe(true)
    expect(screen.getByText(/不是你的可领取分红/)).toBeVisible()
    expect(screen.queryByRole('button', { name: '授权并签署订单' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '创建池 / 新仓位' })).not.toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '偏好设置' }))
    await user.selectOptions(screen.getByLabelText('语言'), 'en')
    expect(screen.getByRole('heading', { name: 'Mining testnet' })).toBeVisible()
    await user.selectOptions(screen.getByLabelText('Language'), 'yue-HK')
    expect(screen.getByRole('heading', { name: '礦機業務測試網' })).toBeVisible()
  })

  it('stops before RPC reads if the frontend is paired with the 196 Worker', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(publicNetworkProfile(networkProfile())))
    await expect(getProfileNetworkStatus()).rejects.toThrow('Mismatched')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('reads only the active 1952 wallet balance and clears it after switching accounts or chains', async () => {
    const first = '0x1111111111111111111111111111111111111111', second = '0x2222222222222222222222222222222222222222'
    const listeners = new Map<string, (value: unknown) => void>()
    let chain = '0xc4'
    const request = vi.fn().mockImplementation(async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return [first]
      if (method === 'eth_chainId') return chain
      if (method === 'wallet_switchEthereumChain') { chain = '0x7a0'; listeners.get('chainChanged')?.(chain); return null }
      throw new Error(`Unexpected wallet request: ${method}`)
    })
    ;(window as Window & { ethereum?: Eip1193Provider }).ethereum = { request,
      on: (event, listener) => { listeners.set(event, listener) }, removeListener: (event) => { listeners.delete(event) } }
    fetchMock.mockImplementation(async (url, options) => {
      if (url === '/api/network') return Response.json(publicNetworkProfile(mining))
      const body = JSON.parse(String(options?.body)) as { method: string; params: unknown[]; id: string }
      const result = body.method === 'eth_chainId' ? '0x7a0' : body.method === 'eth_call' ? contractResult(body.params) : body.method === 'eth_getBalance'
        ? body.params[0] === first ? '0x2c68af0bb140000' : '0x429d069189e0000' : '0x123'
      return Response.json({ jsonrpc: '2.0', id: body.id, result })
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    render(<QueryClientProvider client={client}><MiningNetworkApp /></QueryClientProvider>)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '连接钱包' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /浏览器钱包/ }))
    await user.click(await within(dialog).findByRole('button', { name: '切换到 X Layer' }))
    await user.click(within(dialog).getByRole('button', { name: '关闭对话框' }))
    expect(await screen.findByText('0.2 OKB')).toBeVisible()
    expect(await screen.findByText('3 TEST-FAB')).toBeVisible()
    act(() => listeners.get('accountsChanged')?.([second]))
    expect(await screen.findByText('0.3 OKB')).toBeVisible()
    expect(screen.queryByText('0.2 OKB')).not.toBeInTheDocument()
    act(() => listeners.get('chainChanged')?.('0xc4'))
    expect(screen.queryByText('0.3 OKB')).not.toBeInTheDocument()
    expect(screen.queryByText('3 TEST-FAB')).not.toBeInTheDocument()
    const balances = fetchMock.mock.calls.filter(([url, options]) => url === '/api/rpc' && JSON.parse(String(options?.body)).method === 'eth_getBalance')
    expect(balances.map(([, options]) => JSON.parse(String(options?.body)).params[0])).toEqual([first, second])
    expect(request.mock.calls.map(([value]) => value.method)).toEqual(['eth_requestAccounts', 'eth_chainId', 'wallet_switchEthereumChain', 'eth_chainId'])
  })

  it('adds only chain 1952 and its official RPC to a wallet', async () => {
    const request = vi.fn().mockRejectedValueOnce({ code: 4902 }).mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce('0x7a0')
    expect(await switchToXLayer({ request })).toBe(1952)
    expect(request.mock.calls[1][0]).toMatchObject({ method: 'wallet_addEthereumChain',
      params: [{ chainId: '0x7a0', chainName: 'X Layer Testnet', rpcUrls: [mining.rpcUrl], blockExplorerUrls: [mining.explorerUrl] }] })
    expect(request.mock.calls.map(([args]) => args.method)).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain', 'eth_chainId'])
  })

  it('does not load the legacy 196 asset list in the mining profile', async () => {
    await expect(import('../src/domain/assets')).rejects.toThrow('not deployed')
  })
})
