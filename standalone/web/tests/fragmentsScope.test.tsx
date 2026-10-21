import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { FragmentApp, fragmentTab } from '../src/fragments/FragmentApp'
import { minimum } from '../src/fragments/client'
import { deploymentKey, parseDeployment, type FragmentDeployment } from '../src/fragments/config'

describe('SodaDEX and IGNIX responsibility boundary', () => {
  it('exposes only DEX, Pool and My without mining or payout actions', async () => {
    render(<QueryClientProvider client={new QueryClient()}><FragmentApp /></QueryClientProvider>)
    const nav=screen.getByRole('navigation',{name:'SodaDEX'})
    expect(within(nav).getAllByRole('button').map(b=>b.textContent)).toEqual(['DEX','Pool','我的'])
    for(const tab of within(nav).getAllByRole('button')) {
      await userEvent.click(tab)
      expect(screen.queryByRole('button',{name:/存入矿机|赎回矿机|领取.*收益|分红|发行/})).not.toBeInTheDocument()
    }
  })
  it('does not revive removed pages through legacy URLs', () => {
    for(const hash of ['#launch','#fundraising','#orders','#explore','#history']) expect(fragmentTab(hash)).toBe('swap')
  })
  it('uses JSON-safe deployment keys including bigint block numbers', () => {
    const d = {chainId:1952,pool:'0x1',vault:'0x2',policy:'0x3',rpcUrl:'http://localhost',fromBlock:123n} as FragmentDeployment
    expect(()=>JSON.stringify(['fragment-snapshot',deploymentKey(d)])).not.toThrow()
    expect(deploymentKey(d)).toContain('123')
  })
  it('fails closed on missing or malformed deployment and invalid slippage', () => {
    expect(parseDeployment(undefined)).toBeUndefined()
    expect(()=>parseDeployment('{"chainId":0}')).toThrow()
    for(const value of [-1,10000,NaN,0.5]) expect(()=>minimum(1000n,value)).toThrow()
    expect(minimum(1000n,50)).toBe(995n)
  })
})
