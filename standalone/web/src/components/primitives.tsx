import { styled } from '@universe/mycelium/styled'
import type { ReactElement } from 'react'
import type { AssetId } from '../domain/assets'

// Use the current upstream styled subpath: ui/src no longer exports this factory.
export const Button = styled('button', {
  platform: 'web',
  base: 'button',
  variants: {
    appearance: {
      primary: 'button-primary',
      secondary: 'button-secondary',
      ghost: 'button-ghost',
      icon: 'button-icon',
    },
  },
  defaultVariants: { appearance: 'secondary' },
})

export const Surface = styled('section', { platform: 'web', base: 'surface' })

type IconName =
  | 'arrow'
  | 'chevron'
  | 'settings'
  | 'close'
  | 'wallet'
  | 'external'
  | 'copy'
  | 'check'
  | 'search'
  | 'more'
  | 'sun'
  | 'moon'
  | 'layers'
  | 'refresh'
  | 'alert'

export function Icon({ name, size = 20 }: { name: IconName; size?: number }): ReactElement {
  const paths: Record<IconName, ReactElement> = {
    more: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
    arrow: (
      <>
        <path d="M12 4v16m-6-6 6 6 6-6" />
      </>
    ),
    chevron: <path d="m7 10 5 5 5-5" />,
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="16" cy="17" r="3" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    wallet: (
      <>
        <path d="M20 8H5a2 2 0 0 1 0-4h13v4M4 8v11a1 1 0 0 0 1 1h15V8" />
        <path d="M16 12h5v4h-5z" />
      </>
    ),
    external: (
      <>
        <path d="M14 4h6v6m0-6L10 14" />
        <path d="M10 4H4v16h16v-6" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M16 8V4H4v12h4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </>
    ),
    moon: <path d="M20 14a8.5 8.5 0 0 1-10-10 8.5 8.5 0 1 0 10 10Z" />,
    layers: (
      <>
        <path d="m12 3 10 5-10 5L2 8l10-5Z" />
        <path d="m2 12 10 5 10-5M2 16l10 5 10-5" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M5 7a8 8 0 0 1 13-2l2 3M4 16l2 3a8 8 0 0 0 13-2" />
      </>
    ),
    alert: (
      <>
        <path d="m12 3 10 18H2L12 3Z" />
        <path d="M12 9v5m0 3v.1" />
      </>
    ),
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

export function SodaMark({ decorative = false }: { decorative?: boolean }): ReactElement {
  return (
    <svg
      className="soda-mark"
      viewBox="0 0 48 48"
      aria-hidden={decorative || undefined}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : 'SodaDex'}
    >
      <circle cx="20" cy="29" r="11" />
      <circle cx="35" cy="15" r="7" />
      <circle cx="17" cy="9" r="3.5" />
    </svg>
  )
}

export function AssetIcon({
  wrapped = false,
  small = false,
  assetId,
}: {
  wrapped?: boolean
  small?: boolean
  assetId?: AssetId
}): ReactElement {
  wrapped = assetId ? assetId === 'wokb' : wrapped
  return (
    <span className={`asset-icon${wrapped ? ' wrapped' : ''}${small ? ' small' : ''}`} aria-hidden="true">
      <img
        src={assetId === 'usdt0' ? '/assets/usdt0.png' : wrapped ? '/assets/wokb.png' : '/assets/okb.png'}
        alt=""
        width="42"
        height="42"
      />
      {wrapped && <span className="wrap-badge">W</span>}
    </span>
  )
}

export function NetworkIcon({ small = false }: { small?: boolean }): ReactElement {
  return (
    <img
      className={`network-icon${small ? ' small' : ''}`}
      src="/assets/xlayer.svg"
      alt=""
      aria-hidden="true"
      width={small ? 14 : 22}
      height={small ? 14 : 22}
    />
  )
}
