import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { MarketPanel } from '../src/fragments/MarketPanel'
import { readMarket, tradePrice, type Trade } from '../src/fragments/market'
import { messages } from '../src/fragments/messages'
import { deploymentKey, type FragmentDeployment } from '../src/fragments/config'
const d:FragmentDeployment={chainId:196,pool:`0x${'11'.repeat(20)}`,vault:`0x${'22'.repeat(20)}`,policy:`0x${'33'.repeat(20)}`,fromBlock:100n,rpcUrl:'https://rpc.test'}
const rows:Trade[]=Array.from({length:23},(_,i)=>({id:String(i),transactionHash:`0x${i.toString(16).padStart(64,'0')}`,timestamp:1700000000+i*60,blockNumber:100+i,shareIn:false,input:'100000000',output:'300000000000000000',platformFee:'150000',lpFee:'350000'}))
const cursor='11111111-1111-1111-1111-111111111111',cursor2='22222222-2222-2222-2222-222222222222'
function data(offset=0){return {chainId:196,pool:d.pool,trades:rows.slice(offset,offset+10),chart:rows,nextCursor:offset===0?cursor:offset===10?cursor2:null,index:{syncing:false,lastError:null,indexedThrough:5000,generation:0},asOf:{timestamp:1700000100}}}
function mount(deployment: FragmentDeployment = d): QueryClient {
  const client = new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<QueryClientProvider client={client}><MarketPanel deployment={deployment} m={messages('en')}/></QueryClientProvider>)
  return client
}
describe('persistent fragment market UI',()=>{
  it('labels production history and prices with the deployed FABS symbol', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(data()))
    mount({ ...d, fabs: d.vault })
    await screen.findByRole('group', { name: 'Pool price' })
    expect(screen.getByText('OKB / FABS')).toBeVisible()
    expect(screen.getByText(/price per FABS/)).toBeVisible()
    expect(within(screen.getByRole('table')).getAllByText('FABS')).toHaveLength(10)
    expect(document.body.textContent).not.toContain('sFAB')
  })
  it('loads chart from indexed API and navigates 10/10/3 without log scanning',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async url=>Response.json(data(String(url).includes(cursor2)?20:String(url).includes(cursor)?10:0)))
    mount();await screen.findByRole('group',{name:'Pool price'})
    const count=()=>within(screen.getByRole('table')).getAllByRole('row').length-1
    expect(count()).toBe(10)
    await userEvent.click(screen.getByRole('button',{name:'Next'}));await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));expect(count()).toBe(10)
    await userEvent.click(screen.getByRole('button',{name:'Next'}));await waitFor(()=>expect(count()).toBe(3));expect(screen.getByRole('button',{name:'Next'})).toBeDisabled()
    await userEvent.click(screen.getByRole('button',{name:'Previous'}));await waitFor(()=>expect(count()).toBe(10))
    expect(fetch.mock.calls.every(([url])=>String(url).startsWith('/api/fragments/market'))).toBe(true)
  })
  it('distinguishes synchronizing empty data from no trades and rejects wrong pool or oversized pages',async()=>{
    vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({...data(),chart:[],trades:[],index:{...data().index,syncing:true}}))
    mount();await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Syncing trades'));expect(screen.queryByText('No records')).not.toBeInTheDocument()
    vi.mocked(fetch).mockResolvedValue(Response.json({...data(),pool:d.vault}))
    await expect(readMarket(d,undefined,new AbortController().signal)).rejects.toThrow('Invalid')
    vi.mocked(fetch).mockResolvedValue(Response.json({...data(),trades:rows}))
    await expect(readMarket(d,undefined,new AbortController().signal)).rejects.toThrow('Invalid')
  })
  it('keeps the chart following new trades while the user reads an older history page',async()=>{
    vi.spyOn(globalThis,'fetch').mockImplementation(async url=>Response.json(data(String(url).includes(cursor)?10:0)))
    const client=mount();await screen.findByRole('group',{name:'Pool price'})
    await userEvent.click(screen.getByRole('button',{name:'Next'}))
    await waitFor(()=>expect(screen.getAllByRole('link')[0]).toHaveAttribute('href',expect.stringContaining(rows[10].transactionHash)))
    const next={...rows[22],id:'new',timestamp:rows[22].timestamp+60,input:'200000000'}
    client.setQueryData(['fragment-market',deploymentKey(d),undefined],{...data(),chart:[...rows,next]})
    await waitFor(()=>expect(screen.getAllByRole('button',{name:/Trade point/})).toHaveLength(24))
    expect(screen.getAllByRole('link')[0]).toHaveAttribute('href',expect.stringContaining(rows[10].transactionHash))
  })
  it('recovers the latest chart and trade list after the first request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline')).mockResolvedValue(Response.json(data()))
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('Market unavailable')
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByRole('group', { name: 'Pool price' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(11)
  })
  it('returns to the latest page after an expired history cursor without losing the chart', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async url => String(url).includes(cursor)
      ? new Response(null, { status: 409 }) : Response.json(data()))
    mount()
    await screen.findByRole('group', { name: 'Pool price' })
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('History updated')
    expect(screen.getAllByRole('button', { name: /Trade point/ })).toHaveLength(23)
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getAllByRole('link')[0]).toHaveAttribute('href', expect.stringContaining(rows[0].transactionHash))
  })
  it('uses executed OKB amounts excluding fees in both directions',()=>{
    expect(tradePrice(rows[0])).toBeCloseTo(99500000/3e17,15)
    expect(tradePrice({...rows[0],shareIn:true,input:'300000000000000000',output:'99002500'})).toBeCloseTo(99502500/3e17,15)
  })
})
