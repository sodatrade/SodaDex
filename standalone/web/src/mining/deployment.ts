import { miningDeploymentForProfile } from '../../../mining-products'
import { NETWORK } from '../network'
declare const __MINING_196_DEPLOYMENT__: unknown
export const MINING_PRODUCTS = miningDeploymentForProfile(NETWORK.id === '196-mining-test' ? NETWORK.id : '1952-mining-test',
  typeof __MINING_196_DEPLOYMENT__ === 'undefined' ? undefined : __MINING_196_DEPLOYMENT__)

/** The 196 mining profile spends real native OKB, unlike the 1952 faucet asset. */
export const MINING_NATIVE_SYMBOL = NETWORK.id === '196-mining-test' ? 'OKB' : 'TEST-OKB'
