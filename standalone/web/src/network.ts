import { networkProfile } from '../../network-profile'

/** Build-time selection, never a URL parameter or a browser-storage preference. */
export const NETWORK = networkProfile(import.meta.env.VITE_SODADEX_NETWORK_PROFILE)
export const CHAIN_ID = NETWORK.chainId
export const RPC_URL = NETWORK.rpcUrl
export const EXPLORER_URL = NETWORK.explorerUrl
