import type { Address, Hex } from 'viem'
import type { FragmentClient, Snapshot } from './client'
import type { FragmentDeployment } from './config'
import type { Messages } from './messages'
export interface ScreenProps {
  client: FragmentClient
  deployment: FragmentDeployment
  snapshot: Snapshot
  busy?: boolean
  account?: Address
  m: Messages
  prepare: (label: string, build: () => Promise<{to: Address; data: Hex; value?: bigint; label?: string}>) => void
}
