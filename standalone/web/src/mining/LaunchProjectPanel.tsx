import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { stringToHex, type Hex } from 'viem'
import type { MiningProductDeployment } from '../../../mining-products'
import { Dialog } from '../components/Dialog'
import { Button, Surface } from '../components/primitives'
import type { WalletController } from '../lib/useWallet'
import { firstAccount, type WalletIdentity } from '../lib/wallet'
import { rpc } from '../lib/readRpc'
import { usePreferences } from '../preferences/context'
import { executeMiningCall, type MiningStage } from './execution'
import type { MiningSubmission } from './journal'
import { miningMessages } from './messages'
import { createLaunchChallenge, loadOnlineStatus, miningOnlineHash, normalizeOnlineLaunchForm, prepareOnlineLaunch,
  registerOnlineLaunch, type MiningLaunchPreview, type MiningLaunchRegistration } from './onlineApi'
import { onlineMessages } from './onlineMessages'
import './online.css'

interface PendingLaunch { hash?: Hex; unknown?: true }
interface Props {
  deployment: MiningProductDeployment; wallet: WalletController; disabled: boolean
  onBusy: (busy: boolean) => void; onSubmission: (entry: MiningSubmission) => void
  onRegistered: (registered: MiningLaunchRegistration) => void
}
const pendingKey = (version: string, from: string): string => `sodadex:1952:mining-online:${version}:${from.toLowerCase()}:launch`
function readPending(version: string, from: string | undefined): PendingLaunch | undefined {
  if (!from) return
  try {
    const value: unknown = JSON.parse(localStorage.getItem(pendingKey(version, from)) ?? 'null')
    if (value && typeof value === 'object' && 'hash' in value && miningOnlineHash(value.hash)) return { hash: value.hash }
    if (value && typeof value === 'object' && 'unknown' in value && value.unknown === true) return { unknown: true }
  } catch { /* The in-memory hash remains visible if browser storage is unavailable. */ }
}
export function LaunchProjectPanel({ deployment: d, wallet, disabled, onBusy, onSubmission, onRegistered }: Props): ReactElement {
  const { locale } = usePreferences(), m = onlineMessages(locale), common = miningMessages(locale)
  const account = wallet.session?.chainId === 1952 ? wallet.session.address : undefined
  const [name, setName] = useState(''), [symbol, setSymbol] = useState(''), [metadataURI, setMetadata] = useState('')
  const [preview, setPreview] = useState<MiningLaunchPreview>(), [stage, setStage] = useState<MiningStage | 'authenticating' | 'preparing' | 'registering'>()
  const [pending, setPending] = useState(() => readPending(d.version, account)), [hashInput, setHashInput] = useState('')
  const [error, setError] = useState<string>(), [busy, setBusy] = useState(false), [storageFailed, setStorageFailed] = useState(false)
  const active = useRef<MiningLaunchPreview | undefined>(undefined), inFlight = useRef(false), mounted = useRef(true)
  const status = useQuery({ queryKey: ['mining-online-status', d.version], queryFn: () => loadOnlineStatus(d), retry: false, refetchInterval: 10_000 })
  useEffect(() => { active.current = undefined; setPreview(undefined); setPending(readPending(d.version, account)); setHashInput(''); setError(undefined) }, [account, d.version])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current = undefined } }, [])
  const message = (code: string): string => code in m ? m[code as keyof typeof m] : code in common ? common[code as keyof typeof common] : m.onlineServiceUnavailable
  const fail = (cause: unknown): void => setError(cause instanceof Error ? cause.message : 'onlineServiceUnavailable')
  const persist = (from: string, value: PendingLaunch | undefined): void => {
    try { if (value) localStorage.setItem(pendingKey(d.version, from), JSON.stringify(value)); else localStorage.removeItem(pendingKey(d.version, from)) }
    catch { setStorageFailed(true) }
    if (wallet.getIdentity()?.address.toLowerCase() === from.toLowerCase()) { setPending(value); setHashInput(value?.hash ?? '') }
  }
  const assertIdentity = (identity: WalletIdentity): void => {
    const current = wallet.getIdentity()
    if (!mounted.current || !current || current.chainId !== 1952 || current.provider !== identity.provider || current.revision !== identity.revision ||
        current.address.toLowerCase() !== identity.address.toLowerCase()) throw new Error('onlineIdentityChanged')
  }
  const authenticate = async (): Promise<void> => {
    const identity = wallet.getIdentity()
    if (inFlight.current || disabled || !status.data?.admissionEnabled || pending || !identity) return
    inFlight.current = true; setBusy(true); onBusy(true); setError(undefined)
    try {
      assertIdentity(identity)
      const form = normalizeOnlineLaunchForm({ name, symbol, metadataURI }), requestId = crypto.randomUUID()
      const challenge = await createLaunchChallenge(d, identity.address, requestId, form); assertIdentity(identity)
      const chain = await identity.provider.request({ method: 'eth_chainId' }); assertIdentity(identity)
      const accounts = await identity.provider.request({ method: 'eth_accounts' }); assertIdentity(identity)
      if (chain !== '0x7a0' || firstAccount(accounts)?.toLowerCase() !== identity.address.toLowerCase()) throw new Error('onlineIdentityChanged')
      if (challenge.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('onlineExpired')
      setStage('authenticating')
      const signature = await identity.provider.request({ method: 'personal_sign', params: [stringToHex(challenge.message), identity.address] }); assertIdentity(identity)
      if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('onlineInvalidResponse')
      if (challenge.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('onlineExpired')
      setStage('preparing')
      const prepared = await prepareOnlineLaunch(d, identity.address, challenge, signature as Hex); assertIdentity(identity)
      active.current = prepared; setPreview(prepared); setStage(undefined)
    } catch (cause) {
      fail(cause && typeof cause === 'object' && 'code' in cause && cause.code === 4001 ? new Error('miningRejected') : cause)
      setStage(undefined)
    } finally { inFlight.current = false; setBusy(false); onBusy(false) }
  }
  const register = async (hash: Hex, identity: WalletIdentity): Promise<void> => {
    setStage('registering')
    try {
      assertIdentity(identity)
      const registered = await registerOnlineLaunch(d, hash); assertIdentity(identity)
      persist(identity.address, undefined)
      onRegistered(registered); setStage(undefined)
    } catch { setError('onlineRegistrationFailed'); setStage(undefined) }
  }
  const submit = async (): Promise<void> => {
    const identity = wallet.getIdentity(), prepared = preview
    if (inFlight.current || disabled || !identity || !prepared || pending) return
    inFlight.current = true; setBusy(true); onBusy(true); setError(undefined)
    let sentHash: Hex | undefined
    try {
      assertIdentity(identity)
      if (prepared.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('onlineExpired')
      // A reload while the wallet is sending must never automatically resend this launch.
      persist(identity.address, { unknown: true })
      const entry = await executeMiningCall({ deployment: d, identity, getIdentity: wallet.getIdentity, read: rpc,
        isCurrent: () => mounted.current && active.current === prepared && prepared.expiresAt > Math.floor(Date.now() / 1000), onStage: setStage,
        onSubmission: (record) => { sentHash = record.hash; persist(identity.address, { hash: record.hash }); onSubmission(record) },
      }, prepared.tx, 'launchProject')
      assertIdentity(identity)
      active.current = undefined; setPreview(undefined); await register(entry.hash, identity)
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : ''
      if (code === 'miningReverted' || (!sentHash && code !== 'miningSubmissionUnknown')) persist(identity.address, undefined)
      active.current = undefined; setPreview(undefined); setStage(undefined); fail(cause)
    } finally { inFlight.current = false; setBusy(false); onBusy(false) }
  }
  const recover = async (): Promise<void> => {
    const hash = pending?.hash ?? hashInput, identity = wallet.getIdentity()
    if (inFlight.current || !identity || !miningOnlineHash(hash)) return
    inFlight.current = true; setBusy(true); onBusy(true); setError(undefined)
    try { persist(identity.address, { hash }); await register(hash, identity) }
    finally { inFlight.current = false; setBusy(false); onBusy(false) }
  }
  return <Surface className="mining-online-panel" aria-labelledby="mining-launch-title">
    <header className="mining-online-heading"><div><h2 id="mining-launch-title">{m.launchTitle}</h2><p>{m.launchIntro}</p></div></header>
    {status.isPending && <p role="status">{m.serviceLoading}</p>}
    {status.isError && <p role="alert">{m.onlineServiceUnavailable}</p>}
    {status.data?.admissionEnabled === false && <p role="status">{m.admissionDisabled}</p>}
    {error && <p role="alert">{message(error)}</p>}
    {pending && <div className="mining-online-recovery">
      <p role="status">{pending.hash ? m.submitted : m.unknown}</p>
      {pending.hash ? <p className="mining-online-address"><a href={`https://www.oklink.com/xlayer-test/tx/${pending.hash}`} target="_blank" rel="noreferrer">{pending.hash}</a></p> : <>
        <label htmlFor="mining-launch-recovery">{m.resumeHash}</label><input id="mining-launch-recovery" value={hashInput} onChange={(e) => setHashInput(e.target.value.trim())} disabled={busy} autoComplete="off" />
      </>}
      <div className="mining-button-row"><Button appearance="primary" disabled={busy || !account || !miningOnlineHash(pending.hash ?? hashInput)} onClick={() => void recover()}>{m.register}</Button>
        {pending.unknown && <Button disabled={busy || !account} onClick={() => { if (account) persist(account, undefined); setError(undefined) }}>{m.restart}</Button>}</div>
    </div>}
    <div className="mining-online-grid"><form className="mining-online-form" onSubmit={(e) => { e.preventDefault(); void authenticate() }}>
      <label htmlFor="mining-launch-name">{m.name}</label><input id="mining-launch-name" required value={name} disabled={busy || !!pending} placeholder="TEST My FAB project" autoComplete="off" onChange={(e) => { setName(e.target.value); setPreview(undefined); active.current = undefined }} />
      <label htmlFor="mining-launch-symbol">{m.symbol}</label><input id="mining-launch-symbol" required value={symbol} disabled={busy || !!pending} placeholder="TEST-FABX" autoComplete="off" onChange={(e) => { setSymbol(e.target.value); setPreview(undefined); active.current = undefined }} />
      <label htmlFor="mining-launch-metadata">{m.metadata}</label><input id="mining-launch-metadata" value={metadataURI} disabled={busy || !!pending} placeholder="https:// / ipfs://" autoComplete="off" onChange={(e) => { setMetadata(e.target.value); setPreview(undefined); active.current = undefined }} />
      <small>{m.normalized}</small><Button type="submit" appearance="primary" disabled={disabled || busy || !!pending || !status.data?.admissionEnabled || status.isError || !name.trim() || !symbol.trim()}>{m.signature}</Button>
    </form><aside className="mining-online-policy"><h3>{m.fixedRules}</h3><dl>
      <div><dt>{m.graduation}</dt><dd>5,000 TEST-FAB</dd></div><div><dt>{m.curveFee}</dt><dd>{m.feeValue}</dd></div>
      <div><dt>{m.transferTax}</dt><dd>{m.feeValue}</dd></div><div><dt>{m.taxSplit}</dt><dd>{m.protocolShare}</dd></div>
      <div><dt>{m.protection}</dt><dd>{m.protectionValue}</dd></div>
    </dl><p>{m.issueCost}</p></aside></div>
    {stage && <p role="status">{stage in m ? m[stage as keyof typeof m] : common[stage as MiningStage]}</p>}
    {storageFailed && <p role="alert">{common.storageFailed} {pending?.hash}</p>}
    {preview && <Dialog title={m.launchReview} description={common.testOnly} onEscape={() => busy} onClose={() => { if (!busy) { active.current = undefined; setPreview(undefined) } }}>
      <dl className="review-details mining-online-review">{[[m.name, preview.form.name], [m.symbol, preview.form.symbol], [m.metadata, preview.form.metadataURI || '—'],
        [m.wallet, preview.tx.from], [m.target, preview.tx.to], [m.value, '0 TEST-OKB'], [m.graduation, '5,000 TEST-FAB'], [m.curveFee, m.feeValue],
        [m.transferTax, m.feeValue], [m.taxSplit, m.protocolShare], [m.protection, m.protectionValue], [m.expires, new Date(preview.expiresAt * 1000).toLocaleString(locale)]].map(([label, value]) =>
        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="mining-button-row"><Button appearance="primary" disabled={busy || disabled || !!pending} onClick={() => void submit()}>{m.confirm}</Button>
        <Button disabled={busy} onClick={() => { setPreview(undefined); active.current = undefined }}>{m.cancel}</Button></div>
      {stage && <p role="status">{stage in m ? m[stage as keyof typeof m] : common[stage as MiningStage]}</p>}{error && <p role="alert">{message(error)}</p>}
    </Dialog>}
  </Surface>
}
