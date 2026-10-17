# Order API v1

All responses are JSON with `Cache-Control: no-store`. Only the configured exact browser origin is allowed; requests without `Origin` support a trusted same-origin proxy. RPC URLs, settlement configuration and signing keys are never accepted through HTTP. POST body limit: 16,384 bytes. No endpoint returns order signatures or signed transaction bytes.

Canonical wire order and typed-data helpers: `../order-types.ts`. Stable DTOs: `src/types.ts`. Amounts, nonces and block numbers use decimal strings; timestamps are Unix seconds; addresses and hashes use `0x` hex. Prices are never substituted for the signed `minAmountOut`.

## GET /v1/status

```ts
{
  schemaVersion: 1,
  service: 'sodadex-orders', chainId: 196,
  settlement: Address | null, permit2: Address, wrappedNative: Address,
  testDeployment: true,
  executionEnabled: boolean, acceptingOrders: boolean,
  reason: 'NOT_DEPLOYED' | 'CHAIN_UNAVAILABLE' | 'EXECUTION_PAUSED' | null
}
```

HTTP 200 describes readiness; it does not imply execution is enabled. The current undeployed configuration has `settlement: null`, both booleans false, and reason `NOT_DEPLOYED`.

A ready settlement with execution disabled retains its address and returns `EXECUTION_PAUSED`, with both booleans false. New admission is paused. Existing idempotent submissions and public reads remain available, including authoritative cancellation/expiry checks.

## POST /v1/orders

Body must contain exactly `{order: SodaLimitOrder, signature: Hex}`. All nested order fields are strict. The service binds chain 196, configured settlement, canonical Permit2 witness domain, own SodaDEX contracts, hookless pool key and the signed receiver. Input is ERC20; native output uses the zero address. A new order must have an unused settlement/Permit2 nonce and expiry after the observed chain timestamp. EOA and ERC1271 signatures are verified with the pinned public client.

HTTP 201 creates; HTTP 200 returns the existing identical order. Responses have `{schemaVersion: 1, order: PublicOrder}`. Idempotent submission cannot replace signature or overwrite filled, cancelled or expired status. Different signed contents with the same maker/nonce return 409.

```ts
type PublicOrder = {
  id: Hex // complete Permit2 EIP-712 digest, not OrderFilled.orderHash
  order: SodaLimitOrder
  status: 'open' | 'pending' | 'filled' | 'cancelled' | 'expired'
  reason: 'awaiting_price' | 'simulation_failed' | 'execution_disabled'
    | 'gas_budget' | 'broadcast_unknown' | 'transaction_reverted'
    | 'chain_unavailable' | null
  txHash: Hex | null
  createdAt: number
  updatedAt: number
  observation: null | {
    blockNumber: string
    blockHash: Hex
    timestamp: number
  }
}
```

`OrderFilled.orderHash` is the SodaLimitOrder struct hash. `id` is the complete Permit2 signing digest; the receipt adapter checks the two against their distinct canonical definitions.

## GET /v1/orders/:id

Returns `{schemaVersion: 1, order: PublicOrder}`, or 404 `NOT_FOUND`. Refreshes settlement nonce and chain expiry before returning. A temporary upstream failure preserves the stored record and marks nonterminal orders `chain_unavailable`. Observed terminal states are preserved; a conflicting later observation is marked for verification instead of silently reopening an order.

## GET /v1/orders?maker=...&limit=...&cursor=...

`maker` is required; `limit` is 1–100, default 50. `cursor` is the preceding response's `nextCursor`, passed unchanged. Descending insertion order, limited to the requested maker:

```ts
{schemaVersion: 1, orders: PublicOrder[], nextCursor: string | null}
```

List results are stored observations; the keeper periodically refreshes nonterminal state. Read a single order to request a fresh chain observation. `nextCursor: null` means no older rows in this local store, not a complete scan of all on-chain orders. The service does not discover signatures from chain.

## Errors and cancellation

Errors have exactly `{error: string, code: string}` with sanitized messages.

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | Body, domain binding, fields or pagination is invalid |
| 400 | `ORDER_EXPIRED` | New order expired at observed chain time |
| 401 | `INVALID_SIGNATURE` | Signature does not authorize this exact order |
| 403 | `ORIGIN_FORBIDDEN` | Browser Origin does not match configuration |
| 404 | `NOT_FOUND` | Order digest is not in this store |
| 405 | `METHOD_NOT_ALLOWED` | Unsupported action, including HTTP cancellation/deletion |
| 409 | `NONCE_CONFLICT` | Another local order already owns maker/nonce |
| 409 | `NONCE_UNAVAILABLE` | Settlement or Permit2 nonce already consumed |
| 413 | `BODY_TOO_LARGE` | Request exceeds 16,384 bytes |
| 415 | `JSON_REQUIRED` | Submission is not JSON |
| 503 | `NOT_DEPLOYED` | Settlement address is not configured |
| 503 | `CHAIN_UNAVAILABLE` | Readiness or authoritative chain reads failed |
| 503 | `EXECUTION_PAUSED` | New order admission is paused; old records remain readable |

Only a maker wallet's actual settlement `cancel(nonce)` transaction cancels an order. HTTP removal or an unsigned cancellation request has no authority. A submitted signature may remain usable by other keepers until on-chain cancellation, expiry or fill.
