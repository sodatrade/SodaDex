import { useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react'
import { usePreferences } from '../preferences/context'
import { Button, Icon } from './primitives'

interface DialogProps {
  title: string
  description?: string
  children: ReactNode
  onClose: () => void
  onEscape?: () => boolean
}

export function Dialog({ title, description, children, onClose, onEscape }: DialogProps): ReactElement {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  const { t } = usePreferences()

  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    dialog?.querySelector<HTMLElement>('[data-dialog-autofocus]')?.focus()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      onClose={(event) => {
        // StrictMode reopens the dialog after effect cleanup. Ignore that queued close event.
        if (!event.currentTarget.open) {
          onClose()
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
      onCancel={(event) => {
        if (onEscape?.()) {
          event.preventDefault()
        }
      }}
    >
      <div className="soda-dialog-body">
        <header className="dialog-header">
          <h2 id={`${id}-title`}>{title}</h2>
          <Button appearance="icon" aria-label={t('closeDialog')} onClick={onClose}>
            <Icon name="close" />
          </Button>
        </header>
        {description && (
          <p id={`${id}-description`} className="dialog-description">
            {description}
          </p>
        )}
        {children}
      </div>
    </dialog>
  )
}
