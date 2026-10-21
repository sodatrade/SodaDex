import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { TokenIcon } from '../src/components/TokenIcon'

it('uses the same small icon frame for an unknown token and falls back when its image fails', () => {
  const { container, rerender } = render(<TokenIcon address="0x1111111111111111111111111111111111111111" symbol="sFAB" small />)
  expect(screen.getByText('SF')).toHaveClass('asset-icon', 'small')
  rerender(<TokenIcon address="0x74b7f16337b8972027f6196a17a631ac6de26d22" symbol="USDC" small />)
  const image = container.querySelector('img')!
  expect(image).toBeInTheDocument()
  fireEvent.error(image)
  expect(container.querySelector('img')).not.toBeInTheDocument()
  expect(screen.getByText('US')).toHaveClass('asset-icon', 'small')
})
