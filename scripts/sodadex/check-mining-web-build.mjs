import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'))
const profile = read('standalone/web/dist-mining-1952/network-build.json')
if (profile.id !== '1952-mining-test' || profile.chainId !== 1952) throw new Error('Refusing to upload a different network build')
const shared = read('standalone/web/dist/preferences-script.json'), mining = read('standalone/web/dist-mining-1952/preferences-script.json')
if (shared.hash !== mining.hash) throw new Error('Worker CSP hash differs from the 1952 assets; rebuild both before publishing')
console.log(JSON.stringify({ chainId: 1952, buildVerified: true, productionTouched: false }))
