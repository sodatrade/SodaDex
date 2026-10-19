import { QueryClient } from '@tanstack/svelte-query'
import { act, render, screen, within } from '@testing-library/svelte'
// bits-ui keeps body pointer-events off until exit animations end, which jsdom never runs.
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.svelte'
import { POOLS } from '../src/trading/config'

const deploymentReady = POOLS.ready
const user = (): ReturnType<typeof userEvent.setup> =>
  userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
function renderAt(path: string): void {
  history.replaceState(null, '', path)
  render(App, { props: { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) } })
}
const nav = (): HTMLElement => screen.getByRole('navigation', { name: '主导航' })
const swapVisible = (): boolean => !screen.getByRole('region', { name: '资产兑换', hidden: true }).closest('[hidden]')

beforeEach(() => {
  POOLS.ready = false
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: '0xc4' }))))
})
afterEach(() => {
  POOLS.ready = deploymentReady
  vi.unstubAllGlobals()
})

describe('page URLs', () => {
  it('renders each page from its own path and marks the current menu link', () => {
    renderAt('/pools')
    expect(screen.getByRole('heading', { name: '为流动，留出更多可能。' })).toBeVisible()
    expect(swapVisible()).toBe(false)
    expect(within(nav()).getByRole('link', { name: '流动性' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav()).getByRole('link', { name: '兑换' })).toHaveAttribute('href', '/')
    expect(within(nav()).getByRole('link', { name: '资产' })).toHaveAttribute('href', '/assets')
  })

  it('navigates in place with real URLs and follows browser back and forward', async () => {
    renderAt('/')
    await user().click(within(nav()).getByRole('link', { name: '资产' }))
    expect(location.pathname).toBe('/assets')
    expect(screen.getByRole('heading', { name: '认识你的链上资产。' })).toBeVisible()
    await user().click(within(nav()).getByRole('link', { name: '流动性' }))
    expect(location.pathname).toBe('/pools')
    await act(() => {
      history.back()
    })
    await vi.waitFor(() => expect(location.pathname).toBe('/assets'))
    expect(screen.getByRole('heading', { name: '认识你的链上资产。' })).toBeVisible()
    await act(() => {
      history.forward()
    })
    await vi.waitFor(() => expect(screen.getByRole('heading', { name: '为流动，留出更多可能。' })).toBeVisible())
  })

  it('keeps the swap form mounted across pages so its input survives navigation', async () => {
    renderAt('/')
    const card = screen.getByRole('region', { name: '资产兑换' })
    await user().type(within(card).getByLabelText('支付'), '0.25')
    await user().click(within(nav()).getByRole('link', { name: '流动性' }))
    await user().click(within(nav()).getByRole('link', { name: '兑换' }))
    expect(location.pathname).toBe('/')
    expect(within(card).getByLabelText('支付')).toHaveValue('0.25')
  })

  it('opens a shared asset link with that asset selected and focused', async () => {
    renderAt('/assets?asset=wokb')
    await vi.waitFor(() => expect(screen.getByRole('group', { name: '已选资产 WOKB' })).toHaveFocus())
  })

  it('treats an unknown asset query as no selection', () => {
    renderAt('/assets?asset=<script>')
    expect(screen.queryByRole('group', { name: /已选资产/ })).not.toBeInTheDocument()
  })

  it('sends unknown paths to the swap page and rewrites the URL', () => {
    renderAt('/nope/deep?x=1')
    expect(location.pathname).toBe('/')
    expect(swapVisible()).toBe(true)
  })

  it('leaves modified clicks to the browser so links can open in a new tab', async () => {
    renderAt('/')
    const link = within(nav()).getByRole('link', { name: '流动性' })
    let prevented: boolean | undefined
    link.addEventListener('click', (event) => {
      prevented = event.defaultPrevented
      event.preventDefault() // jsdom would otherwise attempt a real navigation
    })
    await user().keyboard('{Meta>}')
    await user().click(link)
    await user().keyboard('{/Meta}')
    expect(prevented).toBe(false)
    expect(location.pathname).toBe('/')
  })
})
