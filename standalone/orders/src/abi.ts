import { parseAbi } from 'viem'
export const ORDER_TUPLE = '(uint256 chainId,address settlement,address maker,address inputToken,address outputToken,uint256 amountIn,uint256 minAmountOut,address receiver,uint256 nonce,uint256 expiry,uint8 protocol,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) pool)'
export const SETTLEMENT_ABI = parseAbi([
  `function execute(${ORDER_TUPLE} order,bytes signature) returns(uint256 received)`,
  `function orderDigest(${ORDER_TUPLE} order) view returns(bytes32)`,
  'function nonceStatus(address,uint256) view returns(uint8)',
  'function CHAIN_ID() view returns(uint256)', 'function TEST_DEPLOYMENT() view returns(bool)',
  'function PERMIT2() view returns(address)', 'function WOKB() view returns(address)', 'function ROUTER() view returns(address)',
  'function FACTORY() view returns(address)', 'function POOL_MANAGER() view returns(address)', 'function STATE_VIEW() view returns(address)',
  'event OrderFilled(bytes32 indexed orderHash,address indexed maker,uint256 indexed nonce,address keeper,address inputToken,address outputToken,uint256 amountIn,uint256 amountOut,address receiver)',
  'event OrderCancelled(address indexed maker,uint256 indexed nonce)',
  'error OutputAmountMismatch()',
  // Pinned Universal Router / IV4Router errors can bubble through execute.
  'error ExecutionFailed(uint256 commandIndex,bytes message)',
  'error V3TooLittleReceived()',
  'error V4TooLittleReceived(uint256 minAmountOutReceived,uint256 amountReceived)',
])
export const PERMIT_ABI = parseAbi(['function nonceBitmap(address,uint256) view returns(uint256)'])
