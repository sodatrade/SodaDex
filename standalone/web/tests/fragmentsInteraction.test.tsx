import { act, render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { PoolScreen } from '../src/fragments/PoolScreen'
import { roundedContribution } from '../src/fragments/liquidityQuote'
import { TransientNotice } from '../src/fragments/TransientNotice'
import { messages } from '../src/fragments/messages'
import type { ScreenProps } from '../src/fragments/types'
import * as fragmentClient from '../src/fragments/client'
import { decodeFunctionData } from 'viem'
import { poolAbi } from '../src/fragments/abi'
import { PoolForm } from '../src/fragments/PoolForm'
import { MineScreen } from '../src/fragments/MineScreen'
const props = { m: messages('en'), snapshot: { okb: 1n, shares: 10n, lpBalance: 0n }, prepare: vi.fn() } as unknown as ScreenProps

describe('pool list and transient feedback', () => {
  it('shows asset and LP lists, with exact amounts and principal in read-only details', () => {
    const address = '0x2222222222222222222222222222222222222222'
    const account = '0x1111111111111111111111111111111111111111'
    render(<PreferencesProvider><MineScreen {...props} account={account} deployment={{pool:address,vault:address,policy:address,chainId:196,fromBlock:0n,rpcUrl:'https://rpc.test'}} snapshot={{...props.snapshot,okbBalance:123n,shareBalance:456n,lpBalance:20n,lpSupply:100n,okb:1000n,shares:2000n} as fragmentClient.Snapshot} /></PreferencesProvider>)
    expect(screen.getByRole('table',{name:'My assets'})).toBeVisible()
    expect(screen.getByRole('table',{name:'LP positions'})).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'View details OKB / sFAB'}))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('0.00000000000000002 sLP')
    expect(dialog).toHaveTextContent('0.0000000000000002 OKB')
    expect(dialog).toHaveTextContent('0.0000000000000004 sFAB')
    expect(props.prepare).not.toHaveBeenCalled()
  })
  it('prepares removal from fresh reserves rather than the prior trade snapshot', async () => {
    const snapshot = { ...props.snapshot, lpSupply:100n, lpBalance:50n, preciseLiquidity:true }
    const fresh = { ...snapshot, shares:2000n, okb:1000n }
    vi.spyOn(fragmentClient,'readSnapshot').mockResolvedValue(fresh as fragmentClient.Snapshot)
    const prepare = vi.fn()
    const address = '0x2222222222222222222222222222222222222222'
    render(<PoolForm {...props} snapshot={snapshot as fragmentClient.Snapshot} account="0x1111111111111111111111111111111111111111" deployment={{pool:address,vault:address,policy:address,chainId:196,fromBlock:0n,rpcUrl:'https://rpc.test'}} prepare={prepare}/>)
    fireEvent.click(screen.getByRole('button',{name:'Remove liquidity'}))
    fireEvent.change(screen.getByRole('textbox',{name:'LP amount'}),{target:{value:'0.00000000000000001'}})
    fireEvent.click(screen.getByRole('button',{name:'Preview transaction'}))
    const tx=await prepare.mock.calls[0][1]()
    expect(decodeFunctionData({abi:poolAbi,data:tx.data}).args).toEqual([10n,199n,99n,expect.any(BigInt)])
  })
  it('opens operations from a pool row and can return to the list', () => {
    render(<PreferencesProvider><PoolScreen {...props}/></PreferencesProvider>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name:'Manage liquidity OKB / sFAB'}))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', {name:'Add liquidity'})).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name:'Remove liquidity'}))
    expect(screen.getByRole('textbox', {name:'LP amount'})).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name:'关闭对话框'}))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('dismisses at 1500ms and restarts duration for repeated messages', () => {
    vi.useFakeTimers()
    const dismiss=vi.fn()
    const view=render(<TransientNotice message="Invalid amount" id={1} onDismiss={dismiss}/>)
    act(()=>vi.advanceTimersByTime(1000))
    view.rerender(<TransientNotice message="Invalid amount" id={2} onDismiss={dismiss}/>)
    act(()=>vi.advanceTimersByTime(1499)); expect(dismiss).not.toHaveBeenCalled()
    act(()=>vi.advanceTimersByTime(1)); expect(dismiss).toHaveBeenCalledOnce()
    view.unmount();vi.useRealTimers()
  })
})

it('matches LP rounding in the new pool and never quotes full input as actual spend', () => {
  expect(roundedContribution(17000n * 10n ** 18n, 1n, 9000n * 10n ** 18n + 1n, 1n, 1n)).toEqual({shares:9000n * 10n ** 18n + 1n,okb:1n})
  expect(roundedContribution(3n, 8n, 2n, 3n, 2n)).toEqual({shares:2n,okb:3n})
  expect(() => roundedContribution(1n,1n,100n,100n,1n)).toThrow('too small')
})
