import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkUnifiedWebBuild, miningMountProfile } from './check-unified-web-build.mjs'

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../standalone/web')
const profile = miningMountProfile(process.env.SODADEX_MINING_MOUNT_PROFILE)
if (profile === '196-mining-test') {
  const manifest = JSON.parse(process.env.SODADEX_MINING_196_DEPLOYMENT ?? 'null')
  if (!manifest || manifest.profileId !== profile || manifest.chainId !== 196 || manifest.state !== 'ready')
    throw new Error('196 mining build requires an explicit ready deployment manifest')
}
for (const [network, mount, outDir] of [['196-test', '/', 'dist'], [profile, '/mining/', 'dist/mining']]) {
  const result = spawnSync(process.execPath, [path.join(web, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', outDir], {
    cwd: web, stdio: 'inherit', env: { ...process.env, VITE_SODADEX_NETWORK_PROFILE: network, SODADEX_WEB_MOUNT: mount },
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log(JSON.stringify(checkUnifiedWebBuild(path.join(web, 'dist'), profile)))
