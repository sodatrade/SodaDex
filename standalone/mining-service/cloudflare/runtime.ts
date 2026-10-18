export interface SqlStorage {
  sql: { exec(query: string, ...bindings: (string | number | null)[]): { toArray(): Record<string, unknown>[] } }
  transactionSync<T>(operation: () => T): T
  sync(): Promise<void>
  getAlarm(): Promise<number | null>
  setAlarm(timestamp: number): Promise<void>
  deleteAlarm(): Promise<void>
}
export interface ObjectState { storage: SqlStorage }
export interface MiningNamespace { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } }
export interface MiningEnv {
  MINING_1952?: MiningNamespace
  MINING_196?: MiningNamespace
  MINING_NETWORK_PROFILE?: '1952-mining-test' | '196-mining-test'
  MINING_196_DEPLOYMENT?: string; MINING_EXPECTED_SIGNER?: string
  MINING_PUBLIC_ORIGIN: string; MINING_ADDITIONAL_PUBLIC_ORIGINS?: string; MINING_ADMISSION_ENABLED?: string; MINING_EXECUTION_ENABLED?: string
  MINING_SIGNER_PRIVATE_KEY?: string; MINING_KEEPER_PRIVATE_KEY?: string; MINING_KEEPER_ADDRESS?: string
  MINING_GAS_CAP_WEI?: string; MINING_MAX_GAS_PER_TRANSACTION?: string; MINING_MAX_GAS_PRICE_WEI?: string
  MINING_EXPIRED_RECOVERY_HASH?: string; MINING_POLL_MS?: string; MINING_OPERATING_POLICY?: string
}
