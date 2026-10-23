#!/usr/bin/env node
// Build a loopback-only runtime. It contains public dummy accounts, never local owner keys.
import { build } from '../../standalone/worker/node_modules/esbuild/lib/main.js'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = path.join(root, 'standalone/mining-service/.data/local.mjs')
await build({ entryPoints: [path.join(root, 'standalone/mining-service/local/index.ts')], outfile: output,
  bundle: true, platform: 'node', format: 'esm', packages: 'external', external: ['viem', 'viem/*'], tsconfigRaw: {} })
const child = spawn(process.execPath, [output], { cwd: root, stdio: 'inherit', env: { PATH: process.env.PATH } })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', code => { process.exitCode = code ?? 1 })
