import { useEffect, useState, type ReactElement } from 'react'
import { usePreferences } from '../preferences/context'
import { Button } from './primitives'
import './pagination.css'

const PAGE_SIZE = 10

/** Pages already loaded records; it does not imply that the source history is complete. */
export function usePagination<T>(records: readonly T[], resetKey = ''): {
  items: readonly T[]; page: number; pages: number; total: number; start: number; end: number; setPage: (page: number) => void
} {
  const [selection, setSelection] = useState({ key: resetKey, page: 0 })
  const pages = Math.max(1, Math.ceil(records.length / PAGE_SIZE))
  useEffect(() => {
    setSelection((current) => {
      const page = current.key === resetKey ? Math.min(current.page, pages - 1) : 0
      return current.key === resetKey && current.page === page ? current : { key: resetKey, page }
    })
  }, [resetKey, pages])
  const page = selection.key === resetKey ? Math.min(selection.page, pages - 1) : 0
  const offset = page * PAGE_SIZE
  return { items: records.slice(offset, offset + PAGE_SIZE), page, pages, total: records.length,
    start: records.length ? offset + 1 : 0, end: Math.min(offset + PAGE_SIZE, records.length),
    setPage: (next) => setSelection({ key: resetKey, page: Math.max(0, Math.min(next, pages - 1)) }) }
}

export function Pagination({ page, pages, total, start, end, setPage }: ReturnType<typeof usePagination>): ReactElement | null {
  const { locale } = usePreferences()
  if (pages <= 1) return null
  const words = locale === 'en' ? { label: 'Pagination', previous: 'Previous', next: 'Next', count: `${start}–${end} of ${total}` }
    : locale === 'yue-HK' ? { label: '分頁', previous: '上一頁', next: '下一頁', count: `第 ${start}–${end} 項，共 ${total} 項` }
      : { label: '分页', previous: '上一页', next: '下一页', count: `第 ${start}–${end} 条，共 ${total} 条` }
  return <nav className="list-pagination" aria-label={words.label}>
    <span aria-live="polite">{words.count}</span>
    <div><Button disabled={page === 0} onClick={() => setPage(page - 1)}>{words.previous}</Button>
      <span>{page + 1} / {pages}</span>
      <Button disabled={page + 1 === pages} onClick={() => setPage(page + 1)}>{words.next}</Button></div>
  </nav>
}
