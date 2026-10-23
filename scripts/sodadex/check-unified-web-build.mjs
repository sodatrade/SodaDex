import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function miningMountProfile(value = '1952-mining-test') {
  if (value !== '1952-mining-test' && value !== '196-mining-test') throw new Error('Invalid mining mount profile')
  return value
}
export function checkUnifiedWebBuild(root, selectedProfile = '1952-mining-test') {
  const profile = miningMountProfile(selectedProfile), chainId = profile === '196-mining-test' ? 196 : 1952
  const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'))
  const dex = read('network-build.json'), mining = read('mining/network-build.json')
  if (dex.id !== '196-test' || dex.chainId !== 196 || dex.mount !== '/' ||
      mining.id !== profile || mining.chainId !== chainId || mining.mount !== '/mining/') throw new Error('Invalid unified network builds')
  if (read('preferences-script.json').hash !== read('mining/preferences-script.json').hash) throw new Error('CSP preference hashes differ')
  const html = fs.readFileSync(path.join(root, 'mining/index.html'), 'utf8')
  if (!html.includes('src="/mining/assets/')) throw new Error('Mining script must use its isolated mount')
  return { unified: true, dexChainId: 196, miningProfileId: profile, miningChainId: chainId, mount: '/mining/', cspVerified: true }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../standalone/web/dist')
  console.log(JSON.stringify(checkUnifiedWebBuild(root, miningMountProfile(process.env.SODADEX_MINING_MOUNT_PROFILE))))
}
