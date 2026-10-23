import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// The web and gateway must publish the same existing TEST fragment contracts.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const config = JSON.parse(fs.readFileSync(path.join(root, 'standalone/worker/wrangler.fragments-196-test.jsonc'), 'utf8'))
const raw = config.vars?.SODADEX_FRAGMENTS_DEPLOYMENT
const deployment = JSON.parse(raw)
if (deployment.chainId !== 196 || !deployment.pool || !deployment.vault || !deployment.policy) throw Error('Existing 196 TEST fragment deployment required')
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
  cwd: path.join(root, 'standalone/web'), stdio: 'inherit',
  env: { ...process.env, VITE_SODADEX_NETWORK_PROFILE: '196-test', VITE_SODADEX_FRAGMENTS_DEPLOYMENT: raw },
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
fs.writeFileSync(path.join(root, 'standalone/web/dist/fragment-build.json'), JSON.stringify(deployment) + '\n')
