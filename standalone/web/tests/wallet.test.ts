import { describe, expect, it, vi } from 'vitest'
import { RPC_URL } from '../src/domain/assets'
import { connectWallet, firstAccount, switchToXLayer, type Eip1193Provider } from '../src/lib/wallet'

const address = '0x1111111111111111111111111111111111111111'

describe('wallet consent and chain handling', () => {
  it('connects only by requesting accounts and reading chain ID', async () => {
    const request = vi.fn().mockResolvedValueOnce([address]).mockResolvedValueOnce('0xc4')
    const session = await connectWallet({ id: 'test', name: 'Test wallet', provider: { request } })
    expect(session.address).toBe(address)
    expect(session.chainId).toBe(196)
    expect(request.mock.calls.map(([args]) => args.method)).toEqual(['eth_requestAccounts', 'eth_chainId'])
  })
  it('rejects malformed wallet accounts', async () => {
    expect(firstAccount(['bad'])).toBeUndefined()
    await expect(
      connectWallet({ id: 'test', name: 'Test wallet', provider: { request: vi.fn().mockResolvedValue(['bad']) } }),
    ).rejects.toThrow('钱包未提供')
  })
  it('adds only the selected X Layer RPC when the wallet does not know this chain', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce({ code: 4902 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('0xc4')
    expect(await switchToXLayer({ request })).toBe(196)
    expect(request.mock.calls[1][0]).toMatchObject({
      method: 'wallet_addEthereumChain',
      params: [{ chainId: '0xc4', rpcUrls: [RPC_URL] }],
    })
    expect(request.mock.calls.map(([args]) => args.method)).not.toContain('eth_sendTransaction')
  })
  it('does not add a chain after user rejects switching', async () => {
    const request = vi.fn().mockRejectedValue({ code: 4001 })
    await expect(switchToXLayer({ request } as Eip1193Provider)).rejects.toEqual({ code: 4001 })
    expect(request).toHaveBeenCalledTimes(1)
  })
})
