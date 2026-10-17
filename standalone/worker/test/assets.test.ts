import { describe, expect, it, vi } from 'vitest'
import html from '../../web/dist/index.html?raw'
import worker from '../src/index'

describe('built preference bootstrap authorization', () => {
  it('authorizes the exact inline bootstrap served with the HTML', async () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
      .filter((match) => !/\bsrc\s*=/.test(match[1]))
      .map((match) => match[2])
    expect(scripts).toHaveLength(1)
    const assets = vi.fn().mockResolvedValue(new Response(html, { headers: { 'Content-Type': 'text/html' } }))
    const response = await worker.fetch(new Request('https://soda.example/'), { ASSETS: { fetch: assets } })
    const contentSecurityPolicy = response.headers.get('Content-Security-Policy') ?? ''
    const scriptPolicy = contentSecurityPolicy.split(';').find((directive) => directive.trim().startsWith('script-src'))
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scripts[0]))
    const hash = btoa(String.fromCharCode(...new Uint8Array(digest)))
    expect(scriptPolicy).toBe(` script-src 'self' 'sha256-${hash}'`)
    expect(scriptPolicy).not.toContain('unsafe-inline')
    expect(await response.text()).toBe(html)
    expect(assets).toHaveBeenCalledOnce()
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })
})
