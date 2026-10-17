import policy from './trading-policy.json'

/** Pool deployment readiness and permission to start a public trade are independent. */
export function publicSwapsEnabled(): boolean {
  return policy.schemaVersion === 1 && policy.publicSwapsEnabled === true
}
