import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FIXED, validateConfig, type OrdersConfig } from './config.ts'
import { OrderStore } from './store.ts'
import { ViemOrderChain } from './chain.ts'
import { OrdersService } from './service.ts'
import { OrdersKeeper } from './keeper.ts'
import { createOrdersServer } from './server.ts'
import type { Address } from 'viem'
function main(): void {
  process.umask(0o077)
  const localTest = process.env.ORDERS_LOCAL_TEST === 'true'
  const configuredSettlement = process.env.ORDERS_LOCAL_SETTLEMENT
  if (configuredSettlement && !localTest) throw Error('Remote settlement is not deployed')
  const budget = process.env.ORDERS_GAS_BUDGET_WEI ?? '0'
  if (!/^(0|[1-9][0-9]*)$/.test(budget)) throw Error('Invalid orders gas budget')
  const config: OrdersConfig = validateConfig({ settlement: configuredSettlement as Address ?? null, rpcUrl: process.env.ORDERS_RPC_URL ?? FIXED.rpcUrl, publicOrigin: process.env.ORDERS_PUBLIC_ORIGIN ?? 'http://127.0.0.1:3031', databasePath: process.env.ORDERS_DB_PATH ?? resolve(fileURLToPath(new URL('../.data/orders.sqlite', import.meta.url))), executionEnabled: process.env.ORDERS_EXECUTION_ENABLED === 'true', gasBudgetWei: BigInt(budget), localTest })
  if (config.executionEnabled) throw Error('CLI execution is disabled; inject a signer explicitly through the OrdersKeeper application API')
  const port = Number(process.env.ORDERS_PORT ?? '3031'), interval = Number(process.env.ORDERS_POLL_MS ?? '10000')
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || !Number.isSafeInteger(interval) || interval < 1000) throw Error('Invalid orders listener or polling interval')
  const store = new OrderStore(config.databasePath), chain = new ViemOrderChain(config), service = new OrdersService(config, store, chain), keeper = new OrdersKeeper(config, store, chain)
  const server = createOrdersServer(service)
  const timer = setInterval(() => { void keeper.runOnce().catch(() => { console.warn('Order keeper read cycle failed') }) }, interval)
  timer.unref()
  server.listen(port, '127.0.0.1', () => { console.log(`SodaDEX orders listening on 127.0.0.1:${port}; execution disabled`) })
  const stop = (): void => { clearInterval(timer); server.close(() => { store.close() }) }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
}
try { main() } catch { console.error('Orders configuration/startup failed; check the dedicated database, local origin and deployment configuration'); process.exitCode = 1 }
