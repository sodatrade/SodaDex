import fs from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The active publish lane contains only the DEX. Historical mining builds stay archived.
export function checkDexWebBuild(root) {
  const network = JSON.parse(fs.readFileSync(path.join(root, 'network-build.json'), 'utf8'))
  if (network.id !== '196-test' || network.chainId !== 196 || network.mount !== '/') throw Error('DEX build must target the existing 196 test deployment')
  if (fs.existsSync(path.join(root, 'mining'))) throw Error('Retired mining assets must not be published')
  const configPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../standalone/worker/wrangler.fragments-196-test.jsonc')
  const expected = JSON.parse(JSON.parse(fs.readFileSync(configPath, 'utf8')).vars.SODADEX_FRAGMENTS_DEPLOYMENT)
  const fragments = JSON.parse(fs.readFileSync(path.join(root, 'fragment-build.json'), 'utf8'))
  if (JSON.stringify(fragments) !== JSON.stringify(expected)) throw Error('Web fragment deployment must match the TEST gateway')
  const preferences = JSON.parse(fs.readFileSync(path.join(root, 'preferences-script.json'), 'utf8'))
  if (typeof preferences.hash !== 'string' || !preferences.hash.startsWith('sha256-')) throw Error('Missing preference CSP hash')
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => 'sha256-' + createHash('sha256').update(match[1]).digest('base64'))
  if (!hashes.includes(preferences.hash)) throw Error('Preference CSP hash does not match the built HTML')
  return { dexChainId: 196, miningRetired: true, fragmentDeploymentVerified: true, cspVerified: true }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(checkDexWebBuild(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../standalone/web/dist'))))
