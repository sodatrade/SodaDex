import type { ReactElement } from 'react'
import { Button, Icon } from '../../components/primitives'

/** Shared entry point for ordinary and configured miner pools. */
export function PoolManageButton({ label, disabled, onClick }: {
  label: string
  disabled?: boolean
  onClick: () => void
}): ReactElement {
  return <Button className="lp-manage-button" aria-haspopup="dialog" disabled={disabled} onClick={onClick}>
    {label}<span className="lp-manage-chevron"><Icon name="chevron" size={14} /></span>
  </Button>
}
