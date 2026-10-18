/** Build-owned mount point: callers cannot choose a network or upstream URL. */
export function apiPath(path: string): string {
  const base = import.meta.env.BASE_URL
  if (base !== '/' && base !== '/mining/') throw new Error('Unsupported SodaDEX mount')
  if (!path.startsWith('/api/')) throw new Error('Invalid API path')
  return `${base.slice(0, -1)}${path}`
}
