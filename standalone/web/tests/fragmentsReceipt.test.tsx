import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { TransactionReview } from '../src/fragments/TransactionReview'
import { messages } from '../src/fragments/messages'
import * as clientModule from '../src/fragments/client'
import type { FragmentDeployment } from '../src/fragments/config'
import type { WalletController } from '../src/lib/useWallet'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'

it('rechecks a broadcast receipt after timeout without sending the transaction again', async () => {
  const account='0x1111111111111111111111111111111111111111' as const
  const hash=`0x${'a'.repeat(64)}` as const
  const request=vi.fn(async ({method}: {method:string})=>method==='eth_accounts'?[account]:method==='eth_chainId'?'0x7a0':hash)
  const identity={address:account,chainId:1952,revision:1,provider:{request}}
  const wallet={getIdentity:()=>identity} as unknown as WalletController
  const waitForTransactionReceipt=vi.fn().mockRejectedValueOnce(new Error('RPC timeout')).mockResolvedValue({status:'success'})
  const client={call:vi.fn().mockResolvedValue({}),estimateGas:vi.fn().mockResolvedValue(500000n),waitForTransactionReceipt} as unknown as clientModule.FragmentClient
  vi.spyOn(clientModule,'verifyDeployment').mockResolvedValue({rewards:account,preciseLiquidity:true,mirrorVault:false})
  const done=vi.fn()
  render(<PreferencesProvider><TransactionReview tx={{to:account,account,data:'0x',value:0n,chainId:1952,label:'Test'}} deployment={{} as FragmentDeployment} wallet={wallet} client={client} m={messages('en')} onClose={()=>{}} onSuccess={done}/></PreferencesProvider>)
  await userEvent.click(screen.getByRole('button',{name:'Confirm in wallet'}))
  expect(await screen.findByRole('alert')).toHaveTextContent('Transaction status is not confirmed. Check your wallet before submitting again.')
  await userEvent.click(screen.getByRole('button',{name:'Refresh'}))
  await waitFor(()=>expect(done).toHaveBeenCalledWith(hash))
  expect(request.mock.calls.filter(([arg])=>arg.method==='eth_sendTransaction')).toHaveLength(1)
  expect(request).toHaveBeenCalledWith({method:'eth_sendTransaction',params:[expect.objectContaining({gas:'0x16e360'})]})
  expect(waitForTransactionReceipt).toHaveBeenCalledTimes(2)
})
