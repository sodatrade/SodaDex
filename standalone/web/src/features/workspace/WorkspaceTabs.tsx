import { useId, type ReactElement } from 'react'
export function WorkspaceTabs<T extends string>({ label, tabs, value, onChange }: {
  label: string; tabs: readonly { id: T; name: string }[]; value: T; onChange: (tab: T) => void
}): ReactElement {
  const id = useId()
  return <div className="workspace-tabs" role="tablist" aria-label={label} onKeyDown={(e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const at = tabs.findIndex(t => t.id === value)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1
      : (at + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    onChange(tabs[next].id)
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus()
  }}>{tabs.map(tab => <button id={`${id}-${tab.id}`} key={tab.id} role="tab" aria-selected={value === tab.id}
    tabIndex={value === tab.id ? 0 : -1} onClick={() => onChange(tab.id)}>{tab.name}</button>)}</div>
}
