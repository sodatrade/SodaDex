export interface IndexBlock { number: number; hash: string; timestamp: number }
export interface ChainIndexStatus {
  schemaVersion: 1; chainId: number; deploymentVersion: string; head: IndexBlock | null
  indexedThrough: number; fromBlock: number; syncing: boolean; lastError: string | null; generation: number
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const uint = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const hash = (value: unknown): value is string => typeof value === 'string' && /^0x[\da-f]{64}$/i.test(value)
export function indexBlock(value: unknown): boolean {
  return value === null || (record(value) && uint(value.number) && hash(value.hash) && uint(value.timestamp))
}
export function validIndexStatus(value: unknown, chainId: number, deploymentVersion?: string): value is ChainIndexStatus {
  return record(value) && value.schemaVersion === 1 && value.chainId === chainId &&
    typeof value.deploymentVersion === 'string' && (!deploymentVersion || value.deploymentVersion === deploymentVersion) &&
    indexBlock(value.head) && uint(value.fromBlock) && uint(value.indexedThrough) && uint(value.generation) &&
    value.indexedThrough >= value.fromBlock - 1 && (!record(value.head) || Number(value.head.number) >= value.indexedThrough) &&
    typeof value.syncing === 'boolean' && (value.lastError === null || typeof value.lastError === 'string')
}
