import { getAddress, isAddress, type Address } from 'viem'
/** Address-only preferences. Consumers must re-read decimals, name and symbol from chain. */
const STORAGE_KEY = 'sodadex.imported-tokens.196.v1'
export const TOKEN_CATALOG_CHANGED = 'sodadex:token-catalog'
export function readImportedTokenAddresses(): Address[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    const unique = new Map<string, Address>()
    for (const value of raw) if (typeof value === 'string' && isAddress(value, { strict: false })) unique.set(value.toLowerCase(), getAddress(value))
    return [...unique.values()]
  } catch { return [] }
}
function save(addresses: Address[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(addresses))
    window.dispatchEvent(new Event(TOKEN_CATALOG_CHANGED))
  } catch { /* A token can still be selected for this session when storage is unavailable. */ }
}
export function rememberToken(address: Address): void {
  if (!isAddress(address, { strict: false })) return
  const addresses = readImportedTokenAddresses()
  if (!addresses.some((a) => a.toLowerCase() === address.toLowerCase())) save([...addresses, getAddress(address)])
}
export function removeToken(address: Address): void {
  save(readImportedTokenAddresses().filter((a) => a.toLowerCase() !== address.toLowerCase()))
}
