// Public UI rollout: retain V4 integration code while exposing only V2/V3.
export const VISIBLE_POOL_PROTOCOLS = ['v2', 'v3'] as const
export const VISIBLE_POSITION_PROTOCOLS = ['v3'] as const
export function isVisibleProtocol(protocol: string): boolean {
  return VISIBLE_POOL_PROTOCOLS.some(value => value === protocol)
}
