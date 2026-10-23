import { resolveMiningProject, verifyMiningBase } from '../../mining-discovery.ts'
import type { Hex } from 'viem'
import type { Discovery } from '../src/types.ts'

/** Both proofs use the same canonical block; catalog data cannot replace build-pinned roots. */
export const discovery: Discovery = {
  async verifyBase(rpc, deployment, signer, block) {
    const proof = await verifyMiningBase(rpc, deployment, signer, block)
    return { ...proof, number: proof.number as Hex, hash: proof.hash as Hex }
  },
  resolveProject: resolveMiningProject,
}
