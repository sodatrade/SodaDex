import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../standalone/web/dist')
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'))
const dex = read('network-build.json'), mining = read('mining/network-build.json')
if (dex.id !== '196-test' || dex.chainId !== 196 || dex.mount !== '/' ||
    mining.id !== '1952-mining-test' || mining.chainId !== 1952 || mining.mount !== '/mining/') throw new Error('Invalid unified network builds')
if (read('preferences-script.json').hash !== read('mining/preferences-script.json').hash) throw new Error('CSP preference hashes differ')
const html = fs.readFileSync(path.join(root, 'mining/index.html'), 'utf8')
if (!html.includes('src="/mining/assets/')) throw new Error('Mining script must use its isolated mount')
console.log(JSON.stringify({ unified: true, dexChainId: 196, miningChainId: 1952, mount: '/mining/', cspVerified: true }))
