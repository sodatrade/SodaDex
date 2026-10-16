import { parseAbi } from 'viem'
import reference from '../../../deployments/xlayer-reference.json'
import tokenList from '../../reference-tokens.json'
export { reference, tokenList }
export const V2_FACTORY = parseAbi(['function getPair(address,address) view returns(address)'])
export const V2_PAIR = parseAbi(['function getReserves() view returns(uint112,uint112,uint32)', 'function totalSupply() view returns(uint256)'])
export const V3_FEES = [100, 500, 3000, 10000] as const
export const V4_KEYS = [{ fee: 100, tickSpacing: 1 }, { fee: 500, tickSpacing: 10 }, { fee: 3000, tickSpacing: 60 }, { fee: 10000, tickSpacing: 200 }] as const
