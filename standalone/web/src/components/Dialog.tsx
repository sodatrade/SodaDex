import { useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react'
import { Button, Icon } from './primitives'

interface DialogProps {
  title: string
  description?: string
  children: ReactNode
  onClose: () => void
}

export function Dialog({ title, description, children, onClose }: DialogProps): ReactElement {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()

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
    >
      <div className="soda-dialog-body">
        <header className="dialog-header">
          <h2 id={`${id}-title`}>{title}</h2>
          <Button appearance="icon" aria-label="关闭对话框" onClick={onClose}>
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
