import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Pagination, usePagination } from '../src/components/Pagination'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'

function List({ count }: { count: number }): React.ReactElement {
  const pagination = usePagination(Array.from({ length: count }, (_, i) => i + 1))
  return <PreferencesProvider><ol>{pagination.items.map((n) => <li key={n}>Record {n}</li>)}</ol><Pagination {...pagination} /></PreferencesProvider>
}
describe('loaded-record pagination', () => {
  it('keeps the nearest valid page after a refresh removes records', async () => {
    const { rerender } = render(<List count={24} />), user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '下一页' }))
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    rerender(<List count={13} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Record 11')
    rerender(<List count={24} />)
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Record 11')
    await user.click(screen.getByRole('button', { name: '上一页' }))
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Record 1')
    rerender(<List count={0} />)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
})
