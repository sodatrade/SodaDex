import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { HeaderPreferences } from '../src/components/HeaderPreferences'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { PREFERENCES_KEY } from '../src/preferences/model'

it('switches theme and language directly and retains the selection after remount', async () => {
  const user = userEvent.setup(), onCurrency = vi.fn()
  const first = render(<PreferencesProvider><HeaderPreferences onCurrency={onCurrency} /></PreferencesProvider>)
  expect(screen.getByRole('button', { name: '夜间' })).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: '日间' }))
  expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  await user.selectOptions(screen.getByLabelText('语言'), 'en')
  expect(document.documentElement).toHaveAttribute('lang', 'en')
  await user.click(screen.getByRole('button', { name: 'Display currency' }))
  expect(onCurrency).toHaveBeenCalledOnce()
  expect(JSON.parse(localStorage.getItem(PREFERENCES_KEY)!)).toMatchObject({ theme: 'light', locale: 'en' })
  first.unmount()
  render(<PreferencesProvider><HeaderPreferences onCurrency={onCurrency} /></PreferencesProvider>)
  expect(screen.getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByLabelText('Language')).toHaveValue('en')
})
