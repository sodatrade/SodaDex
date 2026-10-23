/** Owned localhost fixture only. It has no upstream RPC URL and never loads a wallet key. */
import { execFile, spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { encodeAbiParameters, keccak256, pad, toHex, type Hex } from 'viem'
interface FixtureOptions {
  fixturePath: string
  stateViewCodePath?: string
  port?: number
}
export async function startLiquidityFork(options: FixtureOptions): Promise<{
  port: number
  pid: number
  request: (method: string, params?: unknown[]) => Promise<unknown>
  stop: () => void
}> {
  const fixture = JSON.parse(await readFile(options.fixturePath, 'utf8')) as { source: string; state: string }
  if (fixture.source !== 'owned-local-rehearsal' || !/^0x[0-9a-f]+$/i.test(fixture.state))
    throw Error('Owned rehearsal fixture required')
  let port = options.port
  if (port === undefined) {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as { port: number }).port
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid local port')
  const child = spawn(
    'anvil',
    [
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--chain-id',
      '196',
      '--accounts',
      '0',
      '--auto-impersonate',
      '--silent',
    ],
    { stdio: 'ignore' },
  )
  const stop = (): void => {
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  const request = async (method: string, params: unknown[] = []): Promise<unknown> => {
    if (child.exitCode !== null) throw Error('Owned Anvil exited')
    const response = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    const data = (await response.json()) as { result?: unknown; error?: unknown }
    if (data.error) throw Error(JSON.stringify(data.error))
    return data.result
  }
  try {
    for (let i = 0; i < 100; i++) {
      try {
        await request('eth_chainId')
        break
      } catch {
        await new Promise((r) => setTimeout(r, 30))
      }
    }
    const listener = await promisify(execFile)('lsof', ['-nP', `-iTCP@127.0.0.1:${port}`, '-sTCP:LISTEN', '-t'])
    if (listener.stdout.trim() !== String(child.pid) || child.exitCode !== null)
      throw Error('Owned Anvil listener required')
    if (
      !String(await request('web3_clientVersion'))
        .toLowerCase()
        .includes('anvil')
    )
      throw Error('Anvil client required')
    await request('anvil_loadState', [fixture.state])
    const deployment = JSON.parse(
      await readFile(
        resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'deployments', 'xlayer-test', 'active.json'),
        'utf8',
      ),
    ) as {
      chainId: number
      phase: string
      owner: string
      contracts: { v3Factory: string; v3PositionManager: string; v4StateView: string }
    }
    if (deployment.chainId !== 196 || deployment.phase !== 'test') throw Error('Chain-196 test configuration required')
    if (options.stateViewCodePath) {
      const code = JSON.parse(await readFile(options.stateViewCodePath, 'utf8')) as { result: Hex }
      if (!/^0x[0-9a-f]+$/i.test(code.result)) throw Error('StateView runtime fixture required')
      await request('anvil_setCode', [deployment.contracts.v4StateView, code.result])
    }
    // The old dump omitted this constructor-set mapping entry (PoolDeployer slots 0..2, owner slot 3).
    const slot = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [500n, 4n]))
    await request('anvil_setStorageAt', [deployment.contracts.v3Factory, slot, pad(toHex(10), { size: 32 })])
    await request('anvil_setChainId', [196])
    await request('anvil_setBalance', [deployment.owner, '0x56bc75e2d63100000'])
    await request('evm_setNextBlockTimestamp', [Math.floor(Date.now() / 1000)])
    await request('evm_mine')
    // Local rehearsal predates the later real deployment. Align event-scan chronology.
    await request('anvil_mine', [toHex(1024), toHex(1)])
    if (
      (await request('eth_chainId')) !== '0xc4' ||
      (await request('eth_getCode', [deployment.contracts.v3PositionManager, 'latest'])) === '0x' ||
      (await request('eth_getCode', [deployment.contracts.v4StateView, 'latest'])) === '0x'
    )
      throw Error('Fixture contract validation failed')
    return { port, pid: child.pid!, request, stop }
  } catch (cause) {
    stop()
    throw cause
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const fixturePath = process.env.SODADEX_LP_FORK_STATE
  if (!fixturePath) throw Error('SODADEX_LP_FORK_STATE required')
  const fork = await startLiquidityFork({
    fixturePath,
    stateViewCodePath: process.env.SODADEX_LP_STATEVIEW_CODE,
    port: process.env.SODADEX_LP_PORT ? Number(process.env.SODADEX_LP_PORT) : undefined,
  })
  process.stdout.write(
    JSON.stringify({ mode: 'owned-local-lp-fixture', chainId: 196, port: fork.port, pid: fork.pid }) + '\n',
  )
  const close = (): void => {
    fork.stop()
    process.exit(0)
  }
  process.once('SIGTERM', close)
  process.once('SIGINT', close)
  await new Promise<void>(() => {})
}
