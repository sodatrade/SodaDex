import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
  value: function showModal(this: HTMLDialogElement): void {
    this.setAttribute('open', '')
  },
})
Object.defineProperty(HTMLDialogElement.prototype, 'close', {
  value: function close(this: HTMLDialogElement): void {
    if (!this.open) {
      return
    }
    this.removeAttribute('open')
    queueMicrotask(() => this.dispatchEvent(new Event('close')))
  },
})
afterEach(() => {
  cleanup()
})
