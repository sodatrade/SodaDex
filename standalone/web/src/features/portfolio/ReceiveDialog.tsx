import { useRef, useState, type ReactElement } from 'react'
import type { Address } from 'viem'
import { Dialog } from '../../components/Dialog'
import { Button } from '../../components/primitives'
import { workspaceMessages } from '../../i18n/workspace'
import { usePreferences } from '../../preferences/context'
export function ReceiveDialog({ address, onClose }: { address: Address; onClose: () => void }): ReactElement {
  const { locale } = usePreferences(), m = workspaceMessages(locale)
  const [copied, setCopied] = useState<'copied' | 'copyFailed'>()
  const input = useRef<HTMLInputElement>(null)
  const copy = async (): Promise<void> => {
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(address); setCopied('copied')
    } catch { setCopied('copyFailed'); input.current?.focus(); input.current?.select() }
  }
  return <Dialog title={m.receive} description={m.receiveNote} onClose={onClose}>
    <dl className="review-details"><div><dt>{m.network}</dt><dd>X Layer · 196</dd></div></dl>
    <label className="portfolio-receive-address">{m.address}<input ref={input} readOnly value={address} onFocus={(event) => event.target.select()} /></label>
    <Button appearance="primary" className="swap-action" onClick={() => void copy()}>{m.copy}</Button>
    {copied && <p role="status">{m[copied]}</p>}
  </Dialog>
}
