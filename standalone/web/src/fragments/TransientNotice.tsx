import { useEffect, useRef, type ReactElement } from 'react'

export function TransientNotice({ message, id, onDismiss }: { message: string; id: number; onDismiss: () => void }): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = ref.current
    element?.showPopover?.()
    const timer = window.setTimeout(onDismiss, 1500)
    return () => { window.clearTimeout(timer); element?.hidePopover?.() }
  }, [id, onDismiss])
  return <div ref={ref} popover="manual" className="fragment-toast" role="alert" aria-atomic="true">{message}</div>
}
