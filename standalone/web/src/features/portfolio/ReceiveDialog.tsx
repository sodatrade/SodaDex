import { useState, type ReactElement } from 'react'
import type { Address } from 'viem'
import { Dialog } from '../../components/Dialog'
import { Button } from '../../components/primitives'
import { workspaceMessages } from '../../i18n/workspace'
import { usePreferences } from '../../preferences/context'
export function ReceiveDialog({ address, onClose }: { address: Address; onClose: () => void }): ReactElement {
  const { locale } = usePreferences(), m = workspaceMessages(locale)
  const [copied, setCopied] = useState<'copied' | 'copyFailed'>()
  return <Dialog title={m.receive} description={m.receiveNote} onClose={onClose}>
    <dl className="review-details"><div><dt>{m.network}</dt><dd>X Layer · 196</dd></div>
      <div><dt>{m.address}</dt><dd className="address-full">{address}</dd></div></dl>
    <Button appearance="primary" className="swap-action" onClick={() => {
      if (!navigator.clipboard) { setCopied('copyFailed'); return }
      void navigator.clipboard.writeText(address).then(() => setCopied('copied'), () => setCopied('copyFailed'))
    }}>{m.copy}</Button>{copied && <p role="status">{m[copied]}</p>}
  </Dialog>
}
