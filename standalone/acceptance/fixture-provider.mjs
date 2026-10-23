import { readFile } from 'node:fs/promises'

const script = await readFile(new URL('./fixture-provider.js', import.meta.url), 'utf8')
const style = '.soda-local-fixture-label{position:fixed;bottom:8px;left:8px;z-index:1000;padding:6px 10px;border:1px solid #716778;border-radius:6px;background:#fff;color:#302b35;font:11px/1.4 system-ui;pointer-events:none}'
const scriptPath = '/fixture-provider.js'
const stylePath = '/fixture-provider.css'

/** Only the localhost acceptance servers import this module. */
export function fixtureProviderResponse(pathname, method) {
  if (method !== 'GET' || (pathname !== scriptPath && pathname !== stylePath)) return undefined
  return new Response(pathname === scriptPath ? script : style, { headers: {
    'Content-Type': pathname === scriptPath ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } })
}

export function injectFixtureProvider(html) {
  if (!html.includes('</head>') || html.includes(scriptPath)) throw Error('Expected one unmodified application HTML entry')
  return html.replace('</head>', `<link rel="stylesheet" href="${stylePath}"><script defer src="${scriptPath}"></script></head>`)
}
